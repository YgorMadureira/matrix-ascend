-- ============================================================
-- RLS: as funções de permissão rodam UMA vez por consulta, não por linha
-- ============================================================
-- Medido em 29/09/2026, com um usuário master, na tabela de assinaturas
-- (47.051 linhas):
--
--   select collaborator_id, training_type from trainings_completed
--   order by id limit 1000 offset 46000;
--
--   · política como estava ................. 927 ms
--   · mesma política, funções embrulhadas ..  47 ms
--
-- POR QUE
-- As políticas chamavam is_master(), current_user_socs(),
-- current_user_role() e auth.uid() "soltas". São funções STABLE e SECURITY
-- DEFINER: o Postgres não consegue embutir o corpo delas na consulta, então
-- as executa DE NOVO PARA CADA LINHA avaliada — cada chamada é uma ida ao
-- índice de users_profiles. Numa consulta que olha 47 mil assinaturas, são
-- 47 mil consultas escondidas só para descobrir, sempre com a mesma
-- resposta, se quem pergunta é master.
--
-- Com paginação por deslocamento (offset) o estrago multiplica: a página
-- 47 do Dashboard reavalia as 46 mil linhas das páginas anteriores. Somando
-- as 48 páginas de assinaturas, eram ~1,1 milhão de chamadas — uns 23
-- segundos de banco a cada abertura do Dashboard por um master.
--
-- O QUE MUDA
-- Só a forma: `is_master()` vira `(select public.is_master())`. Uma
-- subconsulta escalar sem dependência da linha vira um InitPlan — o
-- Postgres calcula uma vez no começo da consulta e reaproveita o valor em
-- todas as linhas. É a recomendação oficial do Supabase para RLS
-- ("wrap functions with SELECT").
--
-- O QUE NÃO MUDA
-- A regra. Cada política abaixo tem o MESMO nome, comando, papéis e a
-- MESMA expressão de antes, só com as chamadas embrulhadas. Essas funções
-- dependem apenas de quem está logado (auth.uid()), que não muda no meio
-- de uma consulta — calcular uma vez ou 47 mil vezes dá o mesmo resultado.
--
-- O `::text[]` depois de `(select public.current_user_socs())` não é
-- enfeite: sem o cast, `soc = any((select ...))` é lido pelo Postgres como
-- "soc igual a alguma LINHA da subconsulta" (comparando texto com o array
-- inteiro) e dá erro 42883. Com o cast, é o array que entra no ANY.
--
-- Conferência: o bloco no fim deste arquivo lista as políticas que ainda
-- chamam alguma dessas funções sem o embrulho (esperado: nenhuma).
--
-- Idempotente e atômico: tudo dentro de uma transação — ou todas as
-- políticas trocam, ou nenhuma.
-- ============================================================

begin;

-- ── collaborators ────────────────────────────────────────────
-- (a leitura é "public_read_collaborators", using true — não chama função
-- nenhuma e fica como está)
drop policy if exists "same_soc_write_collaborators"  on public.collaborators;
drop policy if exists "same_soc_update_collaborators" on public.collaborators;
drop policy if exists "same_soc_delete_collaborators" on public.collaborators;
create policy "same_soc_write_collaborators" on public.collaborators
  for insert to authenticated
  with check ((select public.is_master()) or soc = any((select public.current_user_socs())::text[]));
create policy "same_soc_update_collaborators" on public.collaborators
  for update to authenticated
  using      ((select public.is_master()) or soc = any((select public.current_user_socs())::text[]))
  with check ((select public.is_master()) or soc = any((select public.current_user_socs())::text[]));
create policy "same_soc_delete_collaborators" on public.collaborators
  for delete to authenticated
  using ((select public.is_master()) or soc = any((select public.current_user_socs())::text[]));

-- ── trainings_completed ──────────────────────────────────────
-- ⚠️ "anon_insert_trainings_completed" NÃO é tocada: é ela que sustenta o
-- check-in por QR Code sem login (SignPage). Ver 20260810_02.
drop policy if exists "same_soc_select_trainings_completed" on public.trainings_completed;
drop policy if exists "same_soc_write_trainings_completed"  on public.trainings_completed;
drop policy if exists "same_soc_update_trainings_completed" on public.trainings_completed;
drop policy if exists "same_soc_delete_trainings_completed" on public.trainings_completed;
create policy "same_soc_select_trainings_completed" on public.trainings_completed
  for select to authenticated
  using (
    (select public.is_master())
    or collaborator_id in (select c.id from public.collaborators c where c.soc = any((select public.current_user_socs())::text[]))
    -- assinaturas órfãs continuam visíveis para a unidade de origem (20260812_02)
    or (collaborator_id is null and collaborator_soc = any((select public.current_user_socs())::text[]))
  );
create policy "same_soc_write_trainings_completed" on public.trainings_completed
  for insert to authenticated
  with check (
    (select public.is_master())
    or collaborator_id in (select c.id from public.collaborators c where c.soc = any((select public.current_user_socs())::text[]))
  );
create policy "same_soc_update_trainings_completed" on public.trainings_completed
  for update to authenticated
  using (
    (select public.is_master())
    or collaborator_id in (select c.id from public.collaborators c where c.soc = any((select public.current_user_socs())::text[]))
  )
  with check (
    (select public.is_master())
    or collaborator_id in (select c.id from public.collaborators c where c.soc = any((select public.current_user_socs())::text[]))
  );
create policy "same_soc_delete_trainings_completed" on public.trainings_completed
  for delete to authenticated
  using (
    (select public.is_master())
    or collaborator_id in (select c.id from public.collaborators c where c.soc = any((select public.current_user_socs())::text[]))
  );

-- ── instructors / soc_micro_trainings / quiz_questions ───────
drop policy if exists "same_soc_write_instructors" on public.instructors;
create policy "same_soc_write_instructors" on public.instructors
  for all to authenticated
  using      ((select public.is_master()) or soc_name = any((select public.current_user_socs())::text[]))
  with check ((select public.is_master()) or soc_name = any((select public.current_user_socs())::text[]));

drop policy if exists "same_soc_soc_micro_trainings" on public.soc_micro_trainings;
create policy "same_soc_soc_micro_trainings" on public.soc_micro_trainings
  for all to authenticated
  using      ((select public.is_master()) or soc_name = any((select public.current_user_socs())::text[]))
  with check ((select public.is_master()) or soc_name = any((select public.current_user_socs())::text[]));

drop policy if exists "same_soc_quiz_questions" on public.quiz_questions;
create policy "same_soc_quiz_questions" on public.quiz_questions
  for all to authenticated
  using      ((select public.is_master()) or soc_name = any((select public.current_user_socs())::text[]))
  with check ((select public.is_master()) or soc_name = any((select public.current_user_socs())::text[]));

-- ── agenda de treinamentos ───────────────────────────────────
drop policy if exists "same_soc_training_schedules" on public.training_schedules;
create policy "same_soc_training_schedules" on public.training_schedules
  for all to authenticated
  using      ((select public.is_master()) or soc = any((select public.current_user_socs())::text[]))
  with check ((select public.is_master()) or soc = any((select public.current_user_socs())::text[]));

drop policy if exists "same_soc_training_schedule_enrollments" on public.training_schedule_enrollments;
create policy "same_soc_training_schedule_enrollments" on public.training_schedule_enrollments
  for all to authenticated
  using      ((select public.is_master()) or schedule_id in (select s.id from public.training_schedules s where s.soc = any((select public.current_user_socs())::text[])))
  with check ((select public.is_master()) or schedule_id in (select s.id from public.training_schedules s where s.soc = any((select public.current_user_socs())::text[])));

drop policy if exists "same_soc_schedule_audit_log" on public.schedule_audit_log;
create policy "same_soc_schedule_audit_log" on public.schedule_audit_log
  for all to authenticated
  using      ((select public.is_master()) or schedule_id in (select s.id from public.training_schedules s where s.soc = any((select public.current_user_socs())::text[])))
  with check ((select public.is_master()) or schedule_id in (select s.id from public.training_schedules s where s.soc = any((select public.current_user_socs())::text[])));

drop policy if exists "same_soc_training_scheduling_requests" on public.training_scheduling_requests;
create policy "same_soc_training_scheduling_requests" on public.training_scheduling_requests
  for all to authenticated
  using      ((select public.is_master()) or soc = any((select public.current_user_socs())::text[]))
  with check ((select public.is_master()) or soc = any((select public.current_user_socs())::text[]));

drop policy if exists "same_soc_request_collaborators" on public.training_scheduling_request_collaborators;
create policy "same_soc_request_collaborators" on public.training_scheduling_request_collaborators
  for all to authenticated
  using      ((select public.is_master()) or request_id in (select r.id from public.training_scheduling_requests r where r.soc = any((select public.current_user_socs())::text[])))
  with check ((select public.is_master()) or request_id in (select r.id from public.training_scheduling_requests r where r.soc = any((select public.current_user_socs())::text[])));

-- ── socs (leitura é "public_read_socs", using true — fica como está) ─
drop policy if exists "admin_write_socs" on public.socs;
create policy "admin_write_socs" on public.socs
  for all to authenticated
  using      ((select public.current_user_role()) = any (array['admin', 'master']))
  with check ((select public.current_user_role()) = any (array['admin', 'master']));

-- ── training_area_rules (leitura é "read_training_area_rules", true) ─
drop policy if exists "master_writes_training_area_rules" on public.training_area_rules;
create policy "master_writes_training_area_rules" on public.training_area_rules
  for all to authenticated
  using      ((select public.is_master()))
  with check ((select public.is_master()));

-- ── user_soc_access ──────────────────────────────────────────
drop policy if exists "read_own_soc_access"       on public.user_soc_access;
drop policy if exists "master_manages_soc_access" on public.user_soc_access;
create policy "read_own_soc_access" on public.user_soc_access
  for select to authenticated
  using ((select public.is_master()) or user_id = (select auth.uid()));
create policy "master_manages_soc_access" on public.user_soc_access
  for all to authenticated
  using      ((select public.is_master()))
  with check ((select public.is_master()));

-- ── users_profiles ───────────────────────────────────────────
-- A concessão do perfil MASTER continua exclusiva do gatilho
-- trg_guard_master_role — nada aqui mexe naquilo.
drop policy if exists "self_or_same_soc_select_profiles" on public.users_profiles;
drop policy if exists "self_update_profiles"             on public.users_profiles;
drop policy if exists "admin_insert_profiles"            on public.users_profiles;
drop policy if exists "admin_delete_profiles"            on public.users_profiles;
create policy "self_or_same_soc_select_profiles" on public.users_profiles
  for select to authenticated
  using (
    (select public.is_master())
    or id = (select auth.uid())
    or soc = any((select public.current_user_socs())::text[])
  );
create policy "self_update_profiles" on public.users_profiles
  for update to authenticated
  using (
    (select public.is_master())
    or id = (select auth.uid())
    or ((select public.current_user_role()) = 'admin' and soc = any((select public.current_user_socs())::text[]))
  )
  with check (
    (select public.is_master())
    or id = (select auth.uid())
    or ((select public.current_user_role()) = 'admin' and soc = any((select public.current_user_socs())::text[]))
  );
create policy "admin_insert_profiles" on public.users_profiles
  for insert to authenticated
  with check (
    (select public.is_master())
    or id = (select auth.uid())
    or ((select public.current_user_role()) = 'admin' and soc = any((select public.current_user_socs())::text[]))
  );
create policy "admin_delete_profiles" on public.users_profiles
  for delete to authenticated
  using (
    (select public.is_master())
    or ((select public.current_user_role()) = 'admin' and soc = any((select public.current_user_socs())::text[]))
  );

commit;

-- ── Conferência ──────────────────────────────────────────────
-- Políticas que ainda chamam uma dessas funções FORA de um (select ...).
-- Esperado: nenhuma linha. O Postgres guarda a forma embrulhada como
-- "( SELECT is_master() AS is_master)"; tirando essas ocorrências, não pode
-- sobrar chamada solta.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and (
    regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                   '\( SELECT (is_master|current_user_socs|current_user_role|current_user_soc|auth\.uid)\(\) AS \w+\)', '', 'g')
    ~ '(is_master|current_user_socs|current_user_role|current_user_soc|auth\.uid)\(\)'
  );
