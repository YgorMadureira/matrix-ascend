-- ============================================================
-- "Treinamento Padrão SOC - Sorter (ASM)" passa a valer como
-- onboarding do setor Processamento
-- ============================================================
-- Nas SOCs com ASM (MG2, RJ2, SP2, SP8), o colaborador do Sorter continua
-- cadastrado com sector = "Processamento" — é assim que o RH cadastra, e
-- é intencional (não é engano de digitação). O treinamento aplicado a ele,
-- porém, não se chama "Onboarding PTS", se chama "Treinamento Padrão SOC -
-- Sorter (ASM)" (ou "... - ASM").
--
-- A função training_matches_collaborator (criada em 20260812_04) não
-- reconhecia essa combinação:
--   regra 1 (nome do treinamento contém o setor) falha — o texto do
--     treinamento não cita "Processamento" em lugar nenhum;
--   regra 2 (Onboarding + setor operacional) falha — o texto não começa
--     com "Onboarding".
-- Resultado: a pessoa aparece na tela de Assinaturas (o registro existe e
-- está vinculado a ela) mas continua "pendente de treinamento" na tela de
-- Colaboradores e no Dashboard — o mesmo tipo de erro silencioso que o
-- commit e247317 já tinha corrigido do lado do TypeScript (áreas do
-- Dashboard), mas que ficou de fora aqui porque é uma função SQL
-- separada, com sua própria regra.
--
-- Caso descoberto por: BIANCA GONCALVES TEMISTOCLES (SP8) — assinou "06.
-- Treinamento Padrão SOC - Sorter (ASM)" em 13/08/2026 e ficou pendente.
-- Varredura no banco em 13/08/2026 encontrou 968 colaboradores no mesmo
-- caso (setor Processamento, com essa assinatura, marcados pendentes).
--
-- A regra nova (3) trata esse treinamento como o onboarding do Sorter:
-- conta para quem está no setor Processamento (ou, por segurança, setor
-- "ASM" — não há hoje colaborador cadastrado assim, mas normalizeMacroArea
-- em trainingRules.ts aceita esse valor) ou para quem está em onboarding.
-- Usa o mesmo idioma ILIKE '%padr%o soc%' que training_unlocks_area já usa
-- (supabase/migrations/20260811_01) para não depender de acento (PADRÃO
-- vs PADRAO).
-- ============================================================

create or replace function public.training_matches_collaborator(
  p_training_type text,
  p_sector        text,
  p_role          text,
  p_is_onboarding boolean
)
returns boolean
language sql
immutable
as $$
  with n as (
    select
      upper(coalesce(p_training_type, '')) as t,
      upper(coalesce(p_sector, ''))        as s,
      upper(coalesce(p_role, ''))          as r
  )
  select
    -- 1. Match direto: o nome do treinamento contém o setor (ou vice-versa)
    (n.s <> '' and (strpos(n.t, n.s) > 0 or strpos(n.s, n.t) > 0))
    -- 1b. Mesmo match, agora pelo cargo
    or (n.r <> '' and (strpos(n.t, n.r) > 0 or strpos(n.r, n.t) > 0))
    -- 2. Onboarding vale para setor operacional ou para quem ainda está em onboarding
    or (
      strpos(n.t, 'ONBOARDING') > 0
      and (
        n.s in ('RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'EXPEDICAO', 'TRATATIVAS', 'ASM')
        or coalesce(p_is_onboarding, false)
      )
    )
    -- 3. "Treinamento Padrão SOC - Sorter (ASM)" / "- ASM" é o onboarding do
    --    Sorter nas SOCs com ASM; o setor de quem faz esse treinamento
    --    continua "Processamento" no cadastro, então nem a 1 nem a 2 batem.
    or (
      p_training_type ilike '%padr%o soc%' and p_training_type ilike '%asm%'
      and (n.s in ('PROCESSAMENTO', 'ASM') or coalesce(p_is_onboarding, false))
    )
  from n;
$$;

comment on function public.training_matches_collaborator(text, text, text, boolean) is
  'Porta a função isTrained de CollaboratorsPage.tsx. Se mudar aqui, mude lá também — as duas precisam dar o mesmo resultado. Regra 3 (ASM/Processamento) adicionada em 20260813_04.';

-- ── Conferência ──────────────────────────────────────────────
-- collaborators_status usa esta função por baixo (não é materializada),
-- então o resultado já reflete a regra nova sem precisar recriar a view.
select
  '✅ Regra ASM/Processamento aplicada.' as status,
  count(*) filter (where sector = 'PROCESSAMENTO' and not is_trained)              as processamento_pendentes_agora,
  count(*) filter (
    where sector = 'PROCESSAMENTO' and not is_trained
      and exists (
        select 1 from public.trainings_completed tc
        where tc.collaborator_id = collaborators_status.id
          and tc.training_type ilike '%padr%o soc%' and tc.training_type ilike '%asm%'
      )
  ) as ainda_deveriam_ter_virado_treinados -- esperado: 0
from public.collaborators_status;
