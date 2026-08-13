-- ============================================================
-- Reaplica dois gatilhos que deveriam existir e não existem
-- ============================================================
-- Descoberto no inventário completo de 13/08/2026: as FUNÇÕES
-- guard_master_role() e snapshot_collaborator_on_training() existem no
-- banco (foram criadas pelas migrações 20260812_02 e 20260812_03), mas
-- os GATILHOS que deveriam chamá-las em trainings_completed e
-- users_profiles não existem. Rodar um inventário de pg_trigger
-- confirmou: zero gatilhos nessas duas tabelas. Não sabemos exatamente
-- em que ponto eles se perderam — o importante é que faltam agora.
--
-- Impacto de cada um estar faltando:
--
--  · trg_snapshot_collaborator (trainings_completed): sem ele, uma
--    assinatura nova criada pela tela normal (QR Code, Treinamentos) NÃO
--    grava automaticamente nome/OPS ID/SOC do colaborador. Se aquele
--    colaborador for removido depois, a assinatura vira órfã sem
--    identidade de novo — exatamente o problema que essa migração foi
--    criada para resolver. (Os registros da importação em massa de
--    12-13/08 estão OK: o script preencheu essas colunas manualmente.
--    É só o fluxo normal do dia a dia que ficou desprotegido.)
--
--  · trg_guard_master_role (users_profiles): sem ele, a única coisa
--    impedindo alguém de virar master é a tela esconder a opção e a
--    Edge Function admin-users recusar — nenhuma das duas impede uma
--    chamada direta à API. E o inventário também mostrou que a política
--    de RLS "Permitir atualização de perfil proprio" está com
--    using=true (não using = id = auth.uid()), ou seja, hoje QUALQUER
--    usuário autenticado pode dar UPDATE em QUALQUER linha de
--    users_profiles — inclusive na própria, trocando role para
--    'master'. Sem o gatilho, nada barra isso no banco.
--    ⚠️ Rode este arquivo o quanto antes — é uma escalada de privilégio
--    disponível agora mesmo para qualquer conta logada.
--
-- Idempotente: seguro rodar de novo, inclusive se os gatilhos já
-- existirem (o DROP IF EXISTS cobre isso).
-- ============================================================

drop trigger if exists trg_snapshot_collaborator on public.trainings_completed;
create trigger trg_snapshot_collaborator
  before insert or update of collaborator_id on public.trainings_completed
  for each row
  execute function public.snapshot_collaborator_on_training();

drop trigger if exists trg_guard_master_role on public.users_profiles;
create trigger trg_guard_master_role
  before insert or update of role on public.users_profiles
  for each row
  execute function public.guard_master_role();

select
  '✅ Gatilhos reaplicados.' as status,
  (select count(*) from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal
       and c.relname in ('trainings_completed', 'users_profiles')
       and t.tgname in ('trg_snapshot_collaborator', 'trg_guard_master_role')
  ) as gatilhos_confirmados_deve_ser_2;
