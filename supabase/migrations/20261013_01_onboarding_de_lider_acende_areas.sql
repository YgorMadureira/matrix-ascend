-- ============================================================
-- Onboarding de líder acende Recebimento, Processamento e Expedição
-- — só para quem é líder (13/10/2026)
-- ============================================================
-- Espelho da regra 3b de src/lib/trainingRules.ts. Aplique junto com a
-- publicação do site: enquanto um lado estiver na regra antiga e o outro na
-- nova, a tela de Colaboradores (que lê collaborators_status, daqui) e os
-- Relatórios/Dashboard (que calculam no navegador) mostram status
-- diferentes para os mesmos líderes.
--
-- ── O PROBLEMA ───────────────────────────────────────────────
-- A regra do líder exigia a frase "ONBOARDING LÍDERES" no nome do
-- treinamento. O nome que a operação passou a usar é "ONBOARDING LIDERANÇA
-- 2.0" (115 assinaturas em BA2, MG2, RJ1, RJ2, RJ6, SP6 e SP8) — não batia,
-- e 20 líderes que tinham assinado apareciam PENDENTES, 15 só em MG2.
--
-- ── A REGRA NOVA (pedido do master) ─────────────────────────
-- Para quem é líder (collaborators.is_leader), o onboarding de líder acende
-- RECEBIMENTO, PROCESSAMENTO e EXPEDIÇÃO — as mesmas três áreas do
-- Onboarding PTS. Para quem não é líder continua sendo onboarding
-- administrativo: não acende nada.
--
-- Substitui o atalho de 02/09/2026 ("líder com Onboarding Líderes está
-- treinado em qualquer setor"). A diferença prática é o líder de TRATATIVAS
-- ou de ASM: essas duas áreas nunca são acesas por onboarding, então ele
-- precisa do treinamento da área. Líder sem área operacional (Gestão,
-- Inbound/Outbound, sem setor) continua treinado só com o onboarding de
-- líder — para quem está fora das macro-áreas basta acender qualquer uma.
--
-- "Onboarding de líder" = o nome tem ONBOARDING e uma palavra que COMEÇA
-- com LIDER (líder, líderes, liderança), em qualquer posição. Sem
-- ONBOARDING não bate: "LIDERANÇA ATIVA - MIS SCAN" (PR1) é treinamento
-- específico.
--
-- A configuração da tela (training_area_rules) continua valendo por cima:
-- REMOVE tira a área do líder também; ADICIONA acrescenta para todo mundo.
--
-- ── O QUE MUDA NO BANCO ─────────────────────────────────────
--   · is_leader_onboarding(nome)                      — nova
--   · training_unlocks_area_para(nome, área, sorter, líder) — nova: "este
--     treinamento acende esta área PARA ESTA PESSOA?"
--   · training_credentials_area(...)                  — mesma assinatura,
--     corpo novo. É a única que as views collaborators_status e
--     soc_performance_view chamam, então nenhuma view precisa ser recriada.
--   · training_unlocks_area(nome, área, sorter)       — intocada: segue
--     respondendo a pergunta SEM a pessoa (colaborador comum).
--
-- Conferência depois de aplicar:  npx vite-node scripts/verificar_espelho.ts
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

-- Espelho de isLeaderOnboarding(). normalize_person_name() tira acento, põe
-- em maiúsculas e une espaços — o mesmo preparo que o normalizeText() do
-- TypeScript faz antes de comparar.
create or replace function public.is_leader_onboarding(p_training_type text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    public.normalize_person_name(p_training_type) like '%ONBOARDING%'
    and public.normalize_person_name(p_training_type) ~ '(^|[^A-Z0-9])LIDER',
    false
  );
$$;

comment on function public.is_leader_onboarding(text) is
  'O nome é de onboarding de líder? ONBOARDING + uma palavra que começa com LIDER (líder, líderes, liderança), em qualquer posição. Espelho de isLeaderOnboarding() em src/lib/trainingRules.ts. Ver 20261013_01.';

-- "Este treinamento acende esta área para esta pessoa?" — a regra embutida,
-- mais o onboarding de líder para quem é líder, com a configuração da tela
-- por cima (REMOVE vence, ADICIONA soma). A ordem do AND é de propósito: a
-- comparação do nome só roda para quem é líder e numa das três áreas.
create or replace function public.training_unlocks_area_para(
  p_training_type text,
  p_area          text,
  p_has_sorting   boolean,
  p_is_leader     boolean
)
returns boolean
language sql
stable
as $$
  select coalesce(
    public.training_area_override(p_training_type, p_area),
    public.training_unlocks_area_embutida(p_training_type, p_area, p_has_sorting)
    or (
      coalesce(p_is_leader, false)
      and p_area in ('RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO')
      and public.is_leader_onboarding(p_training_type)
    )
  );
$$;

comment on function public.training_unlocks_area_para(text, text, boolean, boolean) is
  'Este treinamento acende esta área PARA ESTA PESSOA? Regra embutida + onboarding de líder (Recebimento, Processamento e Expedição, só para is_leader) + configuração de training_area_rules por cima. Espelho de treinamentoCredenciaArea() em src/lib/trainingRules.ts. Ver 20261013_01.';

-- A pergunta canônica, por assinatura. Mesma estrutura de antes — grupo,
-- setor cadastrado, exceção do Sorter, e "qualquer área" para quem está
-- fora das macro-áreas —, agora perguntando por pessoa. Sai o atalho
-- "líder com Onboarding Líderes = treinado em qualquer setor".
create or replace function public.training_credentials_area(
  p_training_type text,
  p_area_grupo    text,
  p_area_setor    text,
  p_is_leader     boolean,
  p_has_sorting   boolean
)
returns boolean
language sql
stable
as $$
  select case
    when p_area_grupo is not null then
      public.training_unlocks_area_para(p_training_type, p_area_grupo, p_has_sorting, p_is_leader)
      or coalesce(public.training_unlocks_area_para(p_training_type, p_area_setor, p_has_sorting, p_is_leader), false)
      or (p_area_grupo = 'PROCESSAMENTO' and public.training_unlocks_area_para(p_training_type, 'ASM', p_has_sorting, p_is_leader))
    else
      public.training_unlocks_area_para(p_training_type, 'RECEBIMENTO', p_has_sorting, p_is_leader)
      or public.training_unlocks_area_para(p_training_type, 'PROCESSAMENTO', p_has_sorting, p_is_leader)
      or public.training_unlocks_area_para(p_training_type, 'EXPEDIÇÃO', p_has_sorting, p_is_leader)
      or public.training_unlocks_area_para(p_training_type, 'TRATATIVAS', p_has_sorting, p_is_leader)
      or public.training_unlocks_area_para(p_training_type, 'ASM', p_has_sorting, p_is_leader)
  end;
$$;

-- Mesmo acesso das funções irmãs: as views rodam como o usuário logado
-- (security_invoker), então ele precisa poder executá-las.
grant execute on function public.is_leader_onboarding(text) to authenticated, service_role;
grant execute on function public.training_unlocks_area_para(text, text, boolean, boolean) to authenticated, service_role;
