-- ============================================================
-- Infraestrutura para o novo sync de colaboradores (server-side,
-- automático às 05h, sem depender de nenhum admin abrir a tela).
-- ============================================================
-- Substitui por completo o sync que rodava no navegador
-- (CollaboratorsPage.tsx handleGSheetSync). A partir de agora quem
-- sincroniza é a Edge Function supabase/functions/sync-collaborators,
-- chamada automaticamente pelo pg_cron às 05:00 (America/Sao_Paulo).
--
-- ⚠️ PASSO MANUAL OBRIGATÓRIO — sem ele o cron não dispara:
-- Depois de rodar este arquivo, rode (uma vez só) no SQL Editor,
-- SUBSTITUINDO pelos valores reais do seu projeto:
--
--   select vault.create_secret('https://SEU-PROJETO.supabase.co', 'project_url');
--   select vault.create_secret('SUA_SERVICE_ROLE_KEY_NOVA', 'service_role_key');
--
-- (Use a service_role key APÓS a rotação pendente da Fase 0 de uma
-- sessão anterior — nunca cole a chave antiga, já considerada exposta.
-- Não coloquei os valores aqui de propósito: este arquivo vai para o
-- git, e a Vault é justamente o lugar que não é versionado.)
-- ============================================================

-- ── 1. Chaves de match para o upsert em lote ────────────────────
-- OPS ID é a chave preferida; nem todo mundo tem, por isso o índice
-- é PARCIAL (só cobre quem tem OPS ID preenchido). Nome+SOC é a
-- chave reserva para quem não tem — igual ao que já era feito
-- manualmente no sync antigo, só que agora suporta upsert em lote.
create unique index if not exists idx_collaborators_opsid_unique
  on public.collaborators (opsid)
  where opsid is not null and opsid <> '';

create unique index if not exists idx_collaborators_name_soc_unique
  on public.collaborators (name, soc);

-- ── 2. FK de trainings_completed: CASCADE → SET NULL ────────────
-- Antes: apagar um colaborador apagava as assinaturas dele junto
-- (ON DELETE CASCADE, confirmado em produção). A partir de agora a
-- exclusão do colaborador (porque saiu da planilha) preserva o
-- registro do treinamento — só o vínculo com o colaborador some.
alter table public.trainings_completed
  alter column collaborator_id drop not null;

alter table public.trainings_completed
  drop constraint if exists trainings_completed_collaborator_id_fkey;

alter table public.trainings_completed
  add constraint trainings_completed_collaborator_id_fkey
  foreign key (collaborator_id) references public.collaborators(id)
  on delete set null;

comment on column public.trainings_completed.collaborator_id is
  'Pode ficar NULL se o colaborador foi removido da base (saiu da planilha). O registro do treinamento é preservado — só a ligação com o colaborador se perde.';

-- ── 3. Trava de concorrência no banco (substitui useRef/localStorage) ──
-- Vale para TODOS os navegadores e para o cron ao mesmo tempo — resolve
-- o problema de várias sincronizações rodando juntas.
create table if not exists public.sync_locks (
  id         text primary key,
  locked     boolean not null default false,
  locked_at  timestamptz,
  started_by text
);
insert into public.sync_locks (id, locked)
  values ('gsheet_collaborators', false)
  on conflict (id) do nothing;

alter table public.sync_locks enable row level security;
-- Só a Edge Function (service_role) mexe nessa tabela; ninguém mais precisa.

-- ── 4. Agendamento automático às 05:00 (America/Sao_Paulo = 08:00 UTC) ──
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname in ('sync-gsheet-daily-2am', 'sync-gsheet-daily-5am');

select cron.schedule(
  'sync-gsheet-daily-5am',
  '0 8 * * *', -- 08:00 UTC = 05:00 em Brasília (sem horário de verão desde 2019)
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-collaborators',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object('source', 'cron')
  );
  $$
);

select '✅ Infra de sync criada. Falta o passo manual da Vault descrito no topo do arquivo, e o deploy da Edge Function (supabase functions deploy sync-collaborators).' as status;
