-- ============================================================
-- FASE 5: isolamento real por SOC no RLS
-- ============================================================
-- ⚠️ ESTA É A MIGRAÇÃO DE MAIOR RISCO DO PACOTE. Leia antes de rodar:
--
-- O QUE ELA FAZ: hoje, qualquer usuário autenticado pode ler e escrever
-- em QUALQUER SOC via API (mesmo estando logado só como admin de SP5,
-- consegue editar colaboradores de SP8). As políticas de RLS existentes
-- foram criadas ao longo do tempo como "USING (true)" para authenticated
-- — o isolamento por SOC hoje só existe nos filtros da tela, nunca no
-- banco. Esta migração restringe ESCRITA (insert/update/delete) e, nas
-- tabelas que não precisam de acesso anônimo, também LEITURA, à SOC do
-- usuário logado.
--
-- O QUE ELA NÃO TOCA: as políticas que permitem leitura pública (anon)
-- em socs/instructors/collaborators e o insert público em
-- trainings_completed continuam exatamente como estão — são elas que
-- sustentam a tela de assinatura por QR Code (SignPage), que roda sem
-- login. Restringir essas quebraria o check-in.
--
-- ANTES DE RODAR EM PRODUÇÃO:
--   1. Rode numa cópia/staging do banco primeiro, se tiver uma.
--   2. Teste o login de pelo menos um usuário de cada role
--      (admin, user, lider, bpo, pcp) depois de aplicar.
--   3. Teste o fluxo de assinatura por QR Code (/sign) sem estar logado.
--   4. Se algo quebrar, o bloco de ROLLBACK no final deste arquivo
--      restaura o modo permissivo anterior.
--
-- Não fiz — e não dá para fazer só com a anon key/service role — um
-- teste end-to-end com sessões reais de cada role antes desta migração
-- rodar. A validação acima é manual, na sua conta.
-- ============================================================

-- Helpers: leem o perfil do usuário autenticado. SECURITY DEFINER para
-- funcionar mesmo com RLS ativo em users_profiles.
create or replace function public.current_user_soc()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select soc from public.users_profiles where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select lower(trim(role)) from public.users_profiles where id = auth.uid();
$$;

-- Remove TODAS as políticas de uma tabela para um conjunto de roles,
-- sem precisar saber os nomes exatos (várias foram criadas por scripts
-- diferentes ao longo do projeto). Nunca mexe em políticas que incluem
-- 'anon' — essas ficam de fora de propósito.
create or replace function pg_temp.drop_authenticated_policies(tbl text)
returns void language plpgsql as $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = tbl
      and not ('anon' = any(roles))
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
  end loop;
end;
$$;

-- ── collaborators: leitura pública continua (SignPage), escrita vira same-soc ──
select pg_temp.drop_authenticated_policies('collaborators');
create policy "public_read_collaborators" on public.collaborators
  for select using (true);
create policy "same_soc_write_collaborators" on public.collaborators
  for insert to authenticated with check (soc = public.current_user_soc());
create policy "same_soc_update_collaborators" on public.collaborators
  for update to authenticated using (soc = public.current_user_soc()) with check (soc = public.current_user_soc());
create policy "same_soc_delete_collaborators" on public.collaborators
  for delete to authenticated using (soc = public.current_user_soc());

-- ── instructors: leitura pública continua (SignPage), escrita vira same-soc ──
select pg_temp.drop_authenticated_policies('instructors');
create policy "public_read_instructors" on public.instructors
  for select using (true);
create policy "same_soc_write_instructors" on public.instructors
  for all to authenticated
  using (soc_name = public.current_user_soc())
  with check (soc_name = public.current_user_soc());

-- ── socs: leitura pública continua (SignPage); escrita fica só para admin ──
select pg_temp.drop_authenticated_policies('socs');
create policy "public_read_socs" on public.socs
  for select using (true);
create policy "admin_write_socs" on public.socs
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ── trainings_completed: sem leitura pública hoje — vira same-soc nos dois sentidos ──
-- Mantém o insert anônimo (QR Code) intocado: aquela policy tem 'anon' em
-- roles e não é removida pelo helper acima.
select pg_temp.drop_authenticated_policies('trainings_completed');
create policy "same_soc_select_trainings_completed" on public.trainings_completed
  for select to authenticated
  using (collaborator_id in (select id from public.collaborators where soc = public.current_user_soc()));
create policy "same_soc_write_trainings_completed" on public.trainings_completed
  for insert to authenticated
  with check (collaborator_id in (select id from public.collaborators where soc = public.current_user_soc()));
create policy "same_soc_update_trainings_completed" on public.trainings_completed
  for update to authenticated
  using (collaborator_id in (select id from public.collaborators where soc = public.current_user_soc()))
  with check (collaborator_id in (select id from public.collaborators where soc = public.current_user_soc()));
create policy "same_soc_delete_trainings_completed" on public.trainings_completed
  for delete to authenticated
  using (collaborator_id in (select id from public.collaborators where soc = public.current_user_soc()));

-- ── soc_micro_trainings: same-soc completo ──
select pg_temp.drop_authenticated_policies('soc_micro_trainings');
create policy "same_soc_soc_micro_trainings" on public.soc_micro_trainings
  for all to authenticated
  using (soc_name = public.current_user_soc())
  with check (soc_name = public.current_user_soc());

-- ── quiz_questions: same-soc completo ──
select pg_temp.drop_authenticated_policies('quiz_questions');
create policy "same_soc_quiz_questions" on public.quiz_questions
  for all to authenticated
  using (soc_name = public.current_user_soc())
  with check (soc_name = public.current_user_soc());

-- ── training_schedules: same-soc completo ──
select pg_temp.drop_authenticated_policies('training_schedules');
create policy "same_soc_training_schedules" on public.training_schedules
  for all to authenticated
  using (soc = public.current_user_soc())
  with check (soc = public.current_user_soc());

-- ── training_schedule_enrollments: same-soc via schedule ──
select pg_temp.drop_authenticated_policies('training_schedule_enrollments');
create policy "same_soc_training_schedule_enrollments" on public.training_schedule_enrollments
  for all to authenticated
  using (schedule_id in (select id from public.training_schedules where soc = public.current_user_soc()))
  with check (schedule_id in (select id from public.training_schedules where soc = public.current_user_soc()));

-- ── training_scheduling_requests: same-soc completo ──
select pg_temp.drop_authenticated_policies('training_scheduling_requests');
create policy "same_soc_training_scheduling_requests" on public.training_scheduling_requests
  for all to authenticated
  using (soc = public.current_user_soc())
  with check (soc = public.current_user_soc());

-- ── training_scheduling_request_collaborators: same-soc via request ──
select pg_temp.drop_authenticated_policies('training_scheduling_request_collaborators');
create policy "same_soc_request_collaborators" on public.training_scheduling_request_collaborators
  for all to authenticated
  using (request_id in (select id from public.training_scheduling_requests where soc = public.current_user_soc()))
  with check (request_id in (select id from public.training_scheduling_requests where soc = public.current_user_soc()));

-- ── schedule_audit_log: same-soc via schedule (leitura e escrita) ──
select pg_temp.drop_authenticated_policies('schedule_audit_log');
create policy "same_soc_schedule_audit_log" on public.schedule_audit_log
  for all to authenticated
  using (schedule_id in (select id from public.training_schedules where soc = public.current_user_soc()))
  with check (schedule_id in (select id from public.training_schedules where soc = public.current_user_soc()));

-- ── users_profiles: cada um vê/edita o próprio perfil OU perfis da mesma SOC;
--    somente admin pode inserir/excluir perfis (mesma SOC) ──
select pg_temp.drop_authenticated_policies('users_profiles');
create policy "self_or_same_soc_select_profiles" on public.users_profiles
  for select to authenticated
  using (id = auth.uid() or soc = public.current_user_soc());
create policy "self_update_profiles" on public.users_profiles
  for update to authenticated
  using (id = auth.uid() or (public.current_user_role() = 'admin' and soc = public.current_user_soc()))
  with check (id = auth.uid() or (public.current_user_role() = 'admin' and soc = public.current_user_soc()));
create policy "admin_insert_profiles" on public.users_profiles
  for insert to authenticated
  with check (id = auth.uid() or (public.current_user_role() = 'admin' and soc = public.current_user_soc()));
create policy "admin_delete_profiles" on public.users_profiles
  for delete to authenticated
  using (public.current_user_role() = 'admin' and soc = public.current_user_soc());

-- materials, folders, trainings, training_folders e quiz_attempts NÃO
-- entram aqui de propósito: o próprio código (MaterialsPage, TrainingsPage)
-- os trata como biblioteca compartilhada entre todas as SOCs, sem filtro
-- de soc em nenhuma tela. Restringi-los quebraria esse comportamento.

-- ============================================================
-- ROLLBACK — caso algo quebre, restaura o modo permissivo anterior
-- para as tabelas alteradas acima (mesma regra de antes: qualquer
-- authenticated pode ler/escrever tudo). Comentado por segurança —
-- remova os -- e rode se precisar reverter.
-- ============================================================
-- do $$
-- declare
--   t text;
--   pol record;
-- begin
--   foreach t in array array['collaborators','instructors','socs','trainings_completed',
--     'soc_micro_trainings','quiz_questions','training_schedules',
--     'training_schedule_enrollments','training_scheduling_requests',
--     'training_scheduling_request_collaborators','schedule_audit_log','users_profiles']
--   loop
--     for pol in
--       select policyname from pg_policies
--       where schemaname = 'public' and tablename = t and not ('anon' = any(roles))
--     loop
--       execute format('drop policy if exists %I on public.%I', pol.policyname, t);
--     end loop;
--     execute format('create policy "rollback_all_%s" on public.%I for all to authenticated using (true) with check (true)', t, t);
--     execute format('create policy "rollback_public_read_%s" on public.%I for select using (true)', t, t);
--   end loop;
-- end $$;
