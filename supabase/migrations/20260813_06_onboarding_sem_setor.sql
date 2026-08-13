-- ============================================================
-- Onboarding conta como treinamento para quem ainda não tem setor
-- cadastrado
-- ============================================================
-- A regra 2 de training_matches_collaborator (20260812_04) só aceita um
-- treinamento "Onboarding ..." como válido quando o setor do colaborador
-- é um dos operacionais (Recebimento/Processamento/Expedição/Tratativas/
-- ASM) ou quando a flag is_onboarding está marcada. Um colaborador sem
-- setor preenchido não cai em nenhum dos dois casos — mesmo tendo
-- assinado o "Onboarding PTS", fica pendente.
--
-- Decisão do time de operações (13/08/2026): o Onboarding PTS cobre todas
-- as áreas, independente de qual seja o setor da pessoa — então, sem
-- setor cadastrado, a assinatura do onboarding já basta para considerar
-- treinada. Varredura no banco em 13/08 encontrou 2.884 colaboradores
-- sem setor, dos quais 1.504 já tinham "Onboarding PTS V3" assinado e
-- ficavam pendentes só por causa disso.
--
-- Não mexe no caso de setor preenchido com valor não-operacional (Apoio,
-- Almox, EHA etc.) — isso ficou de fora de propósito, são pessoas
-- treinadas em outra área e continuam pendentes na própria, o que é
-- esperado.
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
    -- 2. Onboarding vale para setor operacional, para quem ainda está em
    --    onboarding, ou para quem não tem setor cadastrado — o Onboarding
    --    PTS cobre todas as áreas, então sem setor não há como (nem por
    --    quê) exigir que o nome do treinamento bata com um setor específico.
    or (
      strpos(n.t, 'ONBOARDING') > 0
      and (
        n.s in ('RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'EXPEDICAO', 'TRATATIVAS', 'ASM')
        or n.s = ''
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
  'Porta a função isTrained de CollaboratorsPage.tsx. Se mudar aqui, mude lá também — as duas precisam dar o mesmo resultado. Regra 3 (ASM/Processamento) em 20260813_05, "sem setor" na regra 2 em 20260813_06.';

-- ── Conferência ──────────────────────────────────────────────
select
  '✅ Regra de onboarding sem setor aplicada.' as status,
  count(*) filter (where coalesce(sector, '') = '' and not is_trained) as sem_setor_pendentes_agora, -- esperado: cai bem perto de zero
  count(*) filter (
    where coalesce(sector, '') = '' and not is_trained
      and exists (
        select 1 from public.trainings_completed tc
        where tc.collaborator_id = collaborators_status.id
          and tc.training_type ilike '%onboarding%'
      )
  ) as ainda_deveriam_ter_virado_treinados -- esperado: 0
from public.collaborators_status;
