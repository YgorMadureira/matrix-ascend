-- ============================================================
-- Acesso a mais de uma unidade por usuário
-- ============================================================
-- Até aqui o escopo de um usuário era uma coluna só: users_profiles.soc.
-- Quem não fosse master ficava presa numa unidade, e todas as políticas de
-- RLS do banco perguntavam "soc = current_user_soc()".
--
-- Agora o master pode conceder unidades extras: o Guilherme continua com
-- SP24 como unidade base e ganha SP6 também. Ele escolhe uma por vez no
-- seletor do topo da tela, e nas unidades concedidas tem o MESMO poder do
-- cargo dele (decisão de 14/08/2026).
--
-- ⚠️ POR QUE UMA TABELA SEPARADA, E NÃO UMA COLUNA EM users_profiles
-- A política "self_update_profiles" (20260810_02) deixa cada usuário
-- editar o PRÓPRIO perfil — é o que permite trocar nome/senha. Se a lista
-- de unidades fosse uma coluna ali, qualquer usuário daria a si mesmo
-- acesso a todas as SOCs com um UPDATE, e a RLS obedeceria: o dado que
-- decide o acesso estaria dentro da linha que o próprio usuário controla.
-- Numa tabela à parte, a permissão de escrita é só do master, e a de
-- leitura é só da própria linha.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

-- ── 1. A tabela de concessões ────────────────────────────────
create table if not exists public.user_soc_access (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  soc        text        not null,
  granted_by uuid        references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, soc)
);

comment on table public.user_soc_access is
  'Unidades EXTRAS que um usuário pode acessar, além de users_profiles.soc. Só o master escreve aqui — ver política master_manages_soc_access.';

create index if not exists idx_user_soc_access_user on public.user_soc_access (user_id);

alter table public.user_soc_access enable row level security;

-- ── 2. As unidades que o usuário logado enxerga ──────────────
-- A unidade base (users_profiles.soc) + as concedidas. SECURITY DEFINER
-- porque precisa ler users_profiles e user_soc_access mesmo com RLS ativo,
-- pelo mesmo motivo de current_user_soc().
--
-- Master não entra aqui: para ele as políticas já respondem com
-- is_master(), que continua liberando tudo.
create or replace function public.current_user_socs()
returns text[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    array_agg(distinct s) filter (where s is not null and btrim(s) <> ''),
    '{}'::text[]
  )
  from (
    select soc as s from public.users_profiles where id = auth.uid()
    union
    select soc as s from public.user_soc_access where user_id = auth.uid()
  ) todas;
$$;

comment on function public.current_user_socs() is
  'Unidades que o usuário logado pode acessar: a base do perfil + as concedidas pelo master. Use nas políticas no lugar de current_user_soc().';

grant execute on function public.current_user_socs() to authenticated;

-- current_user_soc() continua existindo (a unidade BASE), porque telas e
-- políticas antigas ainda a chamam. Quem decide acesso deve usar a lista.

-- ── 3. Só o master concede acesso ────────────────────────────
-- Cada usuário lê as próprias concessões (a tela precisa montar o seletor),
-- mas escrever é privilégio do master. A service_role passa por cima da RLS
-- de propósito: é assim que a Edge Function admin-users administra usuários.
drop policy if exists "read_own_soc_access"        on public.user_soc_access;
drop policy if exists "master_manages_soc_access"  on public.user_soc_access;

create policy "read_own_soc_access" on public.user_soc_access
  for select to authenticated
  using (public.is_master() or user_id = auth.uid());

create policy "master_manages_soc_access" on public.user_soc_access
  for all to authenticated
  using (public.is_master())
  with check (public.is_master());

-- Defesa em profundidade, no mesmo espírito de trg_guard_master_role:
-- se um dia alguém desligar a RLS desta tabela por engano, o gatilho ainda
-- recusa a escrita de quem não é master.
create or replace function public.guard_soc_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() nulo = SQL Editor, migração ou service_role. Quem tem acesso
  -- direto ao banco já tem poder total; travar aqui só impediria a
  -- concessão inicial.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if not public.is_master() then
    raise exception 'Somente um usuário master pode conceder ou remover acesso a unidades.'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_soc_access on public.user_soc_access;
create trigger trg_guard_soc_access
  before insert or update or delete on public.user_soc_access
  for each row
  execute function public.guard_soc_access();

-- ── 4. As políticas passam a olhar a LISTA de unidades ───────
-- Mesma regra de antes, trocando "= a minha unidade" por "está entre as
-- minhas unidades". Onde havia is_master(), continua havendo.
--
-- Os nomes abaixo são os criados em 20260810_02 — precisam bater exatamente,
-- senão a política antiga (na coluna única) fica para trás convivendo com a
-- nova. Isso não abriria acesso indevido (a antiga é um subconjunto da
-- nova), mas deixaria a regra duplicada e confusa de auditar. A consulta de
-- conferência no fim deste arquivo denuncia qualquer sobra.

-- collaborators
drop policy if exists "same_soc_write_collaborators"  on public.collaborators;
drop policy if exists "same_soc_update_collaborators" on public.collaborators;
drop policy if exists "same_soc_delete_collaborators" on public.collaborators;
create policy "same_soc_write_collaborators" on public.collaborators
  for insert to authenticated
  with check (public.is_master() or soc = any(public.current_user_socs()));
create policy "same_soc_update_collaborators" on public.collaborators
  for update to authenticated
  using (public.is_master() or soc = any(public.current_user_socs()))
  with check (public.is_master() or soc = any(public.current_user_socs()));
create policy "same_soc_delete_collaborators" on public.collaborators
  for delete to authenticated
  using (public.is_master() or soc = any(public.current_user_socs()));

-- instructors
drop policy if exists "same_soc_write_instructors" on public.instructors;
create policy "same_soc_write_instructors" on public.instructors
  for all to authenticated
  using (public.is_master() or soc_name = any(public.current_user_socs()))
  with check (public.is_master() or soc_name = any(public.current_user_socs()));

-- soc_micro_trainings
drop policy if exists "same_soc_soc_micro_trainings" on public.soc_micro_trainings;
create policy "same_soc_soc_micro_trainings" on public.soc_micro_trainings
  for all to authenticated
  using (public.is_master() or soc_name = any(public.current_user_socs()))
  with check (public.is_master() or soc_name = any(public.current_user_socs()));

-- quiz_questions
drop policy if exists "same_soc_quiz_questions" on public.quiz_questions;
create policy "same_soc_quiz_questions" on public.quiz_questions
  for all to authenticated
  using (public.is_master() or soc_name = any(public.current_user_socs()))
  with check (public.is_master() or soc_name = any(public.current_user_socs()));

-- training_schedules
drop policy if exists "same_soc_training_schedules" on public.training_schedules;
create policy "same_soc_training_schedules" on public.training_schedules
  for all to authenticated
  using (public.is_master() or soc = any(public.current_user_socs()))
  with check (public.is_master() or soc = any(public.current_user_socs()));

-- training_schedule_enrollments (via schedule)
drop policy if exists "same_soc_training_schedule_enrollments" on public.training_schedule_enrollments;
create policy "same_soc_training_schedule_enrollments" on public.training_schedule_enrollments
  for all to authenticated
  using (public.is_master() or schedule_id in (select id from public.training_schedules where soc = any(public.current_user_socs())))
  with check (public.is_master() or schedule_id in (select id from public.training_schedules where soc = any(public.current_user_socs())));

-- training_scheduling_requests
drop policy if exists "same_soc_training_scheduling_requests" on public.training_scheduling_requests;
create policy "same_soc_training_scheduling_requests" on public.training_scheduling_requests
  for all to authenticated
  using (public.is_master() or soc = any(public.current_user_socs()))
  with check (public.is_master() or soc = any(public.current_user_socs()));

-- training_scheduling_request_collaborators (via request)
drop policy if exists "same_soc_request_collaborators" on public.training_scheduling_request_collaborators;
create policy "same_soc_request_collaborators" on public.training_scheduling_request_collaborators
  for all to authenticated
  using (public.is_master() or request_id in (select id from public.training_scheduling_requests where soc = any(public.current_user_socs())))
  with check (public.is_master() or request_id in (select id from public.training_scheduling_requests where soc = any(public.current_user_socs())));

-- schedule_audit_log (via schedule)
drop policy if exists "same_soc_schedule_audit_log" on public.schedule_audit_log;
create policy "same_soc_schedule_audit_log" on public.schedule_audit_log
  for all to authenticated
  using (public.is_master() or schedule_id in (select id from public.training_schedules where soc = any(public.current_user_socs())))
  with check (public.is_master() or schedule_id in (select id from public.training_schedules where soc = any(public.current_user_socs())));

-- trainings_completed: a leitura precisa continuar cobrindo as assinaturas
-- órfãs pelo snapshot de unidade (ver 20260812_02), senão elas somem da
-- vista da unidade de origem.
-- ⚠️ A policy "anon_insert_trainings_completed" NÃO é tocada aqui: é ela
-- que sustenta o check-in por QR Code sem login (SignPage). Ver a nota
-- extensa em 20260810_02 sobre como ela quase foi apagada por engano.
do $$
declare
  tem_snapshot boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trainings_completed'
      and column_name = 'collaborator_soc'
  );
  base text := 'public.is_master() or collaborator_id in (select id from public.collaborators where soc = any(public.current_user_socs()))';
  regra_select text := base;
begin
  if tem_snapshot then
    regra_select := base || ' or (collaborator_id is null and collaborator_soc = any(public.current_user_socs()))';
    raise notice 'Snapshot detectado: assinaturas orfas seguem visiveis para a unidade de origem.';
  end if;

  execute 'drop policy if exists "same_soc_select_trainings_completed" on public.trainings_completed';
  execute format('create policy "same_soc_select_trainings_completed" on public.trainings_completed for select to authenticated using (%s)', regra_select);

  execute 'drop policy if exists "same_soc_write_trainings_completed" on public.trainings_completed';
  execute format('create policy "same_soc_write_trainings_completed" on public.trainings_completed for insert to authenticated with check (%s)', base);

  execute 'drop policy if exists "same_soc_update_trainings_completed" on public.trainings_completed';
  execute format('create policy "same_soc_update_trainings_completed" on public.trainings_completed for update to authenticated using (%s) with check (%s)', base, base);

  execute 'drop policy if exists "same_soc_delete_trainings_completed" on public.trainings_completed';
  execute format('create policy "same_soc_delete_trainings_completed" on public.trainings_completed for delete to authenticated using (%s)', base);
end $$;

-- users_profiles: enxergar e administrar perfis das unidades que o usuário
-- alcança. A concessão do perfil MASTER continua sendo assunto exclusivo do
-- gatilho trg_guard_master_role — nada aqui afrouxa aquilo.
drop policy if exists "self_or_same_soc_select_profiles" on public.users_profiles;
drop policy if exists "self_update_profiles"             on public.users_profiles;
drop policy if exists "admin_insert_profiles"            on public.users_profiles;
drop policy if exists "admin_delete_profiles"            on public.users_profiles;

create policy "self_or_same_soc_select_profiles" on public.users_profiles
  for select to authenticated
  using (public.is_master() or id = auth.uid() or soc = any(public.current_user_socs()));
create policy "self_update_profiles" on public.users_profiles
  for update to authenticated
  using (public.is_master() or id = auth.uid() or (public.current_user_role() = 'admin' and soc = any(public.current_user_socs())))
  with check (public.is_master() or id = auth.uid() or (public.current_user_role() = 'admin' and soc = any(public.current_user_socs())));
create policy "admin_insert_profiles" on public.users_profiles
  for insert to authenticated
  with check (public.is_master() or id = auth.uid() or (public.current_user_role() = 'admin' and soc = any(public.current_user_socs())));
create policy "admin_delete_profiles" on public.users_profiles
  for delete to authenticated
  using (public.is_master() or (public.current_user_role() = 'admin' and soc = any(public.current_user_socs())));

-- ── Conferência ──────────────────────────────────────────────
-- `sobraram_na_coluna_unica` PRECISA dar 0. Qualquer linha aí é uma política
-- que continua presa a uma única unidade — provavelmente criada fora deste
-- repositório, como aconteceu com o índice fantasma em 13/08.
select
  '✅ Acesso multi-SOC pronto.' as status,
  (select count(*) from public.user_soc_access) as concessoes,
  (select count(*) from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%current_user_socs%') as usando_a_lista,
  (select count(*) from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'current_user_soc\(\)') as sobraram_na_coluna_unica;

-- Se a linha acima não vier zerada, esta lista diz exatamente quais são:
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'current_user_soc\(\)'
order by tablename, policyname;
