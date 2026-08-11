-- ============================================================
-- RODE ESTE ARQUIVO LOGO DEPOIS DE RESTAURAR O BACKUP
-- ============================================================
-- Restaurar o banco volta o schema para como ele estava no momento do
-- backup — ou seja, DESFAZ as migrações rodadas depois disso. O ponto
-- mais perigoso: a chave estrangeira de trainings_completed volta a ser
-- ON DELETE CASCADE, e nesse estado apagar um colaborador apaga as
-- assinaturas dele junto.
--
-- Este arquivo recoloca tudo no estado correto de uma vez só. É
-- idempotente: pode rodar mesmo que parte já exista.
--
-- ORDEM RECOMENDADA:
--   1. Publicar a Edge Function corrigida  (antes do restore, de propósito —
--      assim, se o cron disparar, ele roda a versão segura)
--   2. Restaurar o backup pelo painel do Supabase
--   3. Rodar ESTE arquivo
--   4. Reinserir o pacote de resgate (resgate_pos_backup_11-08.json)
--   5. Testar o sync manualmente e só então deixar o cron seguir
-- ============================================================

-- ── 1. Assinatura não morre junto com o colaborador ─────────────
alter table public.trainings_completed
  alter column collaborator_id drop not null;

alter table public.trainings_completed
  drop constraint if exists trainings_completed_collaborator_id_fkey;

alter table public.trainings_completed
  add constraint trainings_completed_collaborator_id_fkey
  foreign key (collaborator_id) references public.collaborators(id)
  on delete set null;

-- ── 2. Chave de identidade do colaborador ───────────────────────
-- (name, soc) é a única chave total e confiável. O opsid NÃO entra:
-- a planilha repete opsid — o valor "0" sozinho aparece 88 vezes — e
-- índice parcial não serve como alvo de ON CONFLICT no Postgres (42P10).
-- Foi essa combinação que causou o incidente de 11/08.
drop index if exists public.idx_collaborators_opsid_unique;
create index if not exists idx_collaborators_opsid on public.collaborators (opsid);
create unique index if not exists idx_collaborators_name_soc_unique on public.collaborators (name, soc);
create index if not exists idx_collaborators_soc on public.collaborators (soc);
create index if not exists idx_collaborators_sector on public.collaborators (sector);

-- ── 3. Trava de concorrência do sync ────────────────────────────
create table if not exists public.sync_locks (
  id         text primary key,
  locked     boolean not null default false,
  locked_at  timestamptz,
  started_by text
);
alter table public.sync_locks enable row level security;

-- Entra TRAVADA de propósito: nada sincroniza até você testar e liberar.
insert into public.sync_locks (id, locked, started_by)
  values ('gsheet_collaborators', true, 'travado apos restauracao - liberar manualmente apos teste')
  on conflict (id) do update set locked = true,
    started_by = 'travado apos restauracao - liberar manualmente apos teste';

-- ── 4. Views das telas ──────────────────────────────────────────
create or replace view public.signatures_view
with (security_invoker = true) as
select
  tc.id, tc.collaborator_id, tc.training_type, tc.instructor_name,
  tc.completed_at, tc.created_at,
  (tc.signature_pdf_url is not null) as has_signature,
  c.name as collaborator_name, c.sector as collaborator_sector,
  c.soc as collaborator_soc, c.role as collaborator_role
from public.trainings_completed tc
join public.collaborators c on c.id = tc.collaborator_id;

grant select on public.signatures_view to authenticated;

create index if not exists idx_trainings_completed_collab_id    on public.trainings_completed (collaborator_id);
create index if not exists idx_trainings_completed_training     on public.trainings_completed (training_type);
create index if not exists idx_trainings_completed_instructor   on public.trainings_completed (instructor_name);
create index if not exists idx_trainings_completed_completed_at on public.trainings_completed (completed_at desc);

create or replace function public.training_unlocks_area(training_type text, area text)
returns boolean language sql immutable as $$
  select case
    when training_type ilike '%onboarding%' and training_type ilike '%pts%' then
      area in ('RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO')
      or (area = 'ASM' and training_type ilike '%com sorter%')
    when training_type ilike '%onboarding%' then false
    when training_type ilike '%padr%o soc%' then
      (area = 'RECEBIMENTO' and training_type ilike '%recebimento%')
      or (area = 'PROCESSAMENTO' and training_type ilike '%processamento%')
      or (area = 'EXPEDIÇÃO' and training_type ilike '%expedi%')
      or (area = 'TRATATIVAS' and training_type ilike '%tratativa%')
      or (area = 'ASM' and training_type ilike '%asm%')
    else false
  end;
$$;

create or replace view public.soc_performance_view as
with collab_area as (
  select c.id as collaborator_id, c.soc as soc,
    case
      when c.sector ilike '%recebimento%'   then 'RECEBIMENTO'
      when c.sector ilike '%processamento%' then 'PROCESSAMENTO'
      when c.sector ilike '%expedi%'        then 'EXPEDIÇÃO'
      when c.sector ilike '%tratativa%'     then 'TRATATIVAS'
      when c.sector ~* '(^|[^a-z])asm([^a-z]|$)' then 'ASM'
      else null
    end as area
  from public.collaborators c
  where c.soc is not null and c.soc <> ''
),
eligible as (
  select ca.collaborator_id, ca.soc, ca.area
  from collab_area ca
  join public.socs s on s.name = ca.soc
  where ca.area is not null and (ca.area <> 'ASM' or coalesce(s.has_sorting, false))
)
select e.soc,
  count(*)::int as total_hc,
  count(*) filter (where exists (
    select 1 from public.trainings_completed tc
    where tc.collaborator_id = e.collaborator_id
      and public.training_unlocks_area(tc.training_type, e.area))
  )::int as trained_hc,
  case when count(*) > 0 then round(
    (count(*) filter (where exists (
      select 1 from public.trainings_completed tc
      where tc.collaborator_id = e.collaborator_id
        and public.training_unlocks_area(tc.training_type, e.area))
    ))::numeric / count(*) * 100, 1)
  else 0 end as pct
from eligible e
group by e.soc;

grant select on public.soc_performance_view to authenticated;
grant execute on function public.training_unlocks_area(text, text) to authenticated;

-- ── 5. Agendamento diário às 05:00 (08:00 UTC) ──────────────────
-- Só recria o cron se a Vault já tiver os segredos; senão ele dispararia
-- chamadas sem autenticação. Se você restaurou para um ponto anterior à
-- criação dos segredos, refaça o vault.create_secret antes desta parte.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname in ('sync-gsheet-daily-2am','sync-gsheet-daily-5am');

select cron.schedule(
  'sync-gsheet-daily-5am',
  '0 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-collaborators',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object('source','cron')
  );
  $$
);

select '✅ Schema restaurado ao estado correto. O sync está TRAVADO — libere só depois de testar: update public.sync_locks set locked=false where id=''gsheet_collaborators'';' as status;
