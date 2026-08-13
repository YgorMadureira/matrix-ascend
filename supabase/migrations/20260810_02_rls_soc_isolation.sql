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
-- O PERFIL MASTER PASSA POR CIMA DE TODAS ELAS. Sem essa exceção, o
-- master — que existe justamente para enxergar todas as unidades —
-- seria bloqueado de tudo no instante em que este arquivo rodasse.
--
-- O QUE ELA NÃO TOCA: as políticas que permitem leitura pública (anon)
-- em socs/instructors/collaborators e o insert público em
-- trainings_completed continuam exatamente como estão — são elas que
-- sustentam a tela de assinatura por QR Code (SignPage), que roda sem
-- login. Restringir essas quebraria o check-in.
--
-- ORDEM: rode 20260812_03_perfil_master.sql ANTES deste arquivo.
-- Se 20260812_02 (snapshot do colaborador) também já tiver rodado, as
-- assinaturas órfãs voltam a ser visíveis para a SOC de origem — o
-- arquivo detecta sozinho e ajusta a política.
--
-- ANTES DE RODAR EM PRODUÇÃO:
--   1. Rode numa cópia/staging do banco primeiro, se tiver uma.
--   2. Teste o login de pelo menos um usuário de cada role
--      (master, admin, user, lider, bpo, pcp) depois de aplicar.
--   3. Teste o fluxo de assinatura por QR Code (/sign) sem estar logado.
--   4. Se algo quebrar, o bloco de ROLLBACK no final deste arquivo
--      restaura o modo permissivo anterior.
--
-- Não fiz — e não dá para fazer só com a anon key/service role — um
-- teste end-to-end com sessões reais de cada role antes desta migração
-- rodar. A validação acima é manual, na sua conta.
-- ============================================================

-- Helpers: leem o perfil do usuário autenticado. SECURITY DEFINER para
-- funcionar mesmo com RLS ativo em users_profiles — sem isso, a política
-- de users_profiles consultaria a própria tabela que ela protege.
-- (Repetidos de 20260812_03 de propósito: este arquivo precisa
-- funcionar sozinho, em qualquer ordem.)
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

create or replace function public.is_master()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select lower(trim(role)) = 'master' from public.users_profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.current_user_soc()  to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_master()         to authenticated;

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
  for insert to authenticated
  with check (public.is_master() or soc = public.current_user_soc());
create policy "same_soc_update_collaborators" on public.collaborators
  for update to authenticated
  using (public.is_master() or soc = public.current_user_soc())
  with check (public.is_master() or soc = public.current_user_soc());
create policy "same_soc_delete_collaborators" on public.collaborators
  for delete to authenticated
  using (public.is_master() or soc = public.current_user_soc());

-- ── instructors: leitura pública continua (SignPage), escrita vira same-soc ──
select pg_temp.drop_authenticated_policies('instructors');
create policy "public_read_instructors" on public.instructors
  for select using (true);
create policy "same_soc_write_instructors" on public.instructors
  for all to authenticated
  using (public.is_master() or soc_name = public.current_user_soc())
  with check (public.is_master() or soc_name = public.current_user_soc());

-- ── socs: leitura pública continua (SignPage); escrita fica para admin e master ──
select pg_temp.drop_authenticated_policies('socs');
create policy "public_read_socs" on public.socs
  for select using (true);
create policy "admin_write_socs" on public.socs
  for all to authenticated
  using (public.current_user_role() in ('admin', 'master'))
  with check (public.current_user_role() in ('admin', 'master'));

-- ── trainings_completed: sem leitura pública hoje — vira same-soc nos dois sentidos ──
-- ⚠️ CORRIGIDO em 13/08 depois do inventário completo do banco: esta nota
-- dizia "mantém o insert anônimo intocado porque aquela policy tem 'anon'
-- em roles". Falso — o inventário mostrou que a policy real
-- ("Permitir Insert Anonimo (Trainings)") foi criada SEM "to anon",
-- então o Postgres guarda o alcance dela como roles = {public}, não
-- {anon}. O helper acima só poupa quem tem 'anon' LITERALMENTE no
-- array — {public} não bate — então ela seria apagada por
-- drop_authenticated_policies() e NUNCA recriada. O check-in por QR Code
-- (SignPage, sem login) teria parado de funcionar no primeiro scan depois
-- desta migração, sem nenhum erro visível até alguém tentar assinar.
-- Corrigido recriando a policy explicitamente abaixo, restrita a "anon"
-- de verdade — o que também fecha uma folga que a versão antiga tinha:
-- "to public" cobria authenticated também, então qualquer usuário logado
-- conseguia inserir treinamento para colaborador de QUALQUER SOC por essa
-- policy, por fora da regra same-soc que a authenticated deveria seguir.
--
-- A leitura tem uma cláusula a mais quando a migração de snapshot
-- (20260812_02) já rodou: assinaturas cujo colaborador foi removido
-- ficam com collaborator_id nulo e sairiam da vista de todo mundo.
-- Com o snapshot, elas continuam visíveis para a unidade de origem.
select pg_temp.drop_authenticated_policies('trainings_completed');

do $$
declare
  tem_snapshot boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trainings_completed'
      and column_name = 'collaborator_soc'
  );
  regra text := 'public.is_master() or collaborator_id in (select id from public.collaborators where soc = public.current_user_soc())';
begin
  if tem_snapshot then
    regra := regra || ' or (collaborator_id is null and collaborator_soc = public.current_user_soc())';
    raise notice 'Snapshot detectado: assinaturas orfas ficam visiveis para a SOC de origem.';
  else
    raise notice 'Sem a coluna collaborator_soc — rode 20260812_02 para as assinaturas orfas voltarem a aparecer.';
  end if;

  execute format(
    'create policy "same_soc_select_trainings_completed" on public.trainings_completed for select to authenticated using (%s)',
    regra
  );
end $$;

-- Recriada explícita — ver a nota grande acima do porquê ela não pode
-- ficar por conta do helper de preservação.
create policy "anon_insert_trainings_completed" on public.trainings_completed
  for insert to anon
  with check (true);

create policy "same_soc_write_trainings_completed" on public.trainings_completed
  for insert to authenticated
  with check (public.is_master() or collaborator_id in (select id from public.collaborators where soc = public.current_user_soc()));
create policy "same_soc_update_trainings_completed" on public.trainings_completed
  for update to authenticated
  using (public.is_master() or collaborator_id in (select id from public.collaborators where soc = public.current_user_soc()))
  with check (public.is_master() or collaborator_id in (select id from public.collaborators where soc = public.current_user_soc()));
create policy "same_soc_delete_trainings_completed" on public.trainings_completed
  for delete to authenticated
  using (public.is_master() or collaborator_id in (select id from public.collaborators where soc = public.current_user_soc()));

-- ── soc_micro_trainings: same-soc completo ──
select pg_temp.drop_authenticated_policies('soc_micro_trainings');
create policy "same_soc_soc_micro_trainings" on public.soc_micro_trainings
  for all to authenticated
  using (public.is_master() or soc_name = public.current_user_soc())
  with check (public.is_master() or soc_name = public.current_user_soc());

-- ── quiz_questions: same-soc completo ──
select pg_temp.drop_authenticated_policies('quiz_questions');
create policy "same_soc_quiz_questions" on public.quiz_questions
  for all to authenticated
  using (public.is_master() or soc_name = public.current_user_soc())
  with check (public.is_master() or soc_name = public.current_user_soc());

-- ── training_schedules: same-soc completo ──
select pg_temp.drop_authenticated_policies('training_schedules');
create policy "same_soc_training_schedules" on public.training_schedules
  for all to authenticated
  using (public.is_master() or soc = public.current_user_soc())
  with check (public.is_master() or soc = public.current_user_soc());

-- ── training_schedule_enrollments: same-soc via schedule ──
select pg_temp.drop_authenticated_policies('training_schedule_enrollments');
create policy "same_soc_training_schedule_enrollments" on public.training_schedule_enrollments
  for all to authenticated
  using (public.is_master() or schedule_id in (select id from public.training_schedules where soc = public.current_user_soc()))
  with check (public.is_master() or schedule_id in (select id from public.training_schedules where soc = public.current_user_soc()));

-- ── training_scheduling_requests: same-soc completo ──
select pg_temp.drop_authenticated_policies('training_scheduling_requests');
create policy "same_soc_training_scheduling_requests" on public.training_scheduling_requests
  for all to authenticated
  using (public.is_master() or soc = public.current_user_soc())
  with check (public.is_master() or soc = public.current_user_soc());

-- ── training_scheduling_request_collaborators: same-soc via request ──
select pg_temp.drop_authenticated_policies('training_scheduling_request_collaborators');
create policy "same_soc_request_collaborators" on public.training_scheduling_request_collaborators
  for all to authenticated
  using (public.is_master() or request_id in (select id from public.training_scheduling_requests where soc = public.current_user_soc()))
  with check (public.is_master() or request_id in (select id from public.training_scheduling_requests where soc = public.current_user_soc()));

-- ── schedule_audit_log: same-soc via schedule (leitura e escrita) ──
select pg_temp.drop_authenticated_policies('schedule_audit_log');
create policy "same_soc_schedule_audit_log" on public.schedule_audit_log
  for all to authenticated
  using (public.is_master() or schedule_id in (select id from public.training_schedules where soc = public.current_user_soc()))
  with check (public.is_master() or schedule_id in (select id from public.training_schedules where soc = public.current_user_soc()));

-- ── users_profiles: cada um vê/edita o próprio perfil OU perfis da mesma SOC;
--    admin insere/exclui perfis da própria SOC; master faz tudo em qualquer SOC.
--    Quem pode conceder o perfil master é assunto do gatilho
--    trg_guard_master_role (20260812_03), não destas políticas.
select pg_temp.drop_authenticated_policies('users_profiles');
create policy "self_or_same_soc_select_profiles" on public.users_profiles
  for select to authenticated
  using (public.is_master() or id = auth.uid() or soc = public.current_user_soc());
create policy "self_update_profiles" on public.users_profiles
  for update to authenticated
  using (public.is_master() or id = auth.uid() or (public.current_user_role() = 'admin' and soc = public.current_user_soc()))
  with check (public.is_master() or id = auth.uid() or (public.current_user_role() = 'admin' and soc = public.current_user_soc()));
create policy "admin_insert_profiles" on public.users_profiles
  for insert to authenticated
  with check (public.is_master() or id = auth.uid() or (public.current_user_role() = 'admin' and soc = public.current_user_soc()));
create policy "admin_delete_profiles" on public.users_profiles
  for delete to authenticated
  using (public.is_master() or (public.current_user_role() = 'admin' and soc = public.current_user_soc()));

-- materials, folders, trainings, training_folders e quiz_attempts NÃO
-- entram aqui de propósito: o próprio código (MaterialsPage, TrainingsPage)
-- os trata como biblioteca compartilhada entre todas as SOCs, sem filtro
-- de soc em nenhuma tela. Restringi-los quebraria esse comportamento.

select '✅ Isolamento por SOC ativo. O perfil master passa por cima de todas as políticas.' as status;

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
