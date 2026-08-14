-- ============================================================
-- UMA REGRA SÓ: o banco passa a responder "treinado?" igual às telas
-- ============================================================
-- Em 13/08/2026 a mesma unidade (SC1) aparecia com três percentuais ao
-- mesmo tempo — 97,9% no Dashboard, 96% em Colaboradores e 99,1% em
-- Relatórios — e a exportação de pendentes trazia 2 pessoas onde a tela
-- listava 17. A causa: existiam SEIS implementações da mesma regra, três
-- em telas React e três aqui no banco, todas ligeiramente diferentes.
--
-- Agora a regra vive em src/lib/trainingRules.ts e este arquivo é o
-- espelho SQL dela, usado pela view collaborators_status (tela de
-- Colaboradores) e pela soc_performance_view (gráfico Desempenho por SOC).
--
-- A REGRA, como definida pelo time de operações em 13/08/2026:
--
--   · Onboarding PTS "Com Sorter"  → Recebimento + Processamento + Expedição + ASM
--   · Onboarding PTS (demais)      → Recebimento + Processamento + Expedição
--   · Onboarding administrativo    → não acende nada
--     (People/HSE/Security/Qualidade/Meio Ambiente)
--   · "Treinamento Padrão SOC - <área>" → aquela área inteira
--   · TRATATIVAS nunca é aceso por Onboarding — exige o treinamento próprio
--
--   · Quem está numa macro-área operacional está treinado quando tem um
--     treinamento que acende A ÁREA DELE. Ter feito o de outra área não
--     conta — era esse o furo que dava alguém do Recebimento como treinado
--     por ter assinado o de Processamento.
--   · Quem NÃO está numa macro-área (Apoio, Almox, EHA, sem setor) está
--     treinado quando tem qualquer treinamento que acenda qualquer área,
--     porque o Onboarding PTS cobre todas. Essas 3.331 pessoas passam a
--     contar no percentual — antes sumiam do Dashboard e dos Relatórios.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

-- ── 1. De que macro-área é este colaborador? ─────────────────
-- Espelha normalizeMacroArea() do TypeScript. Devolve null para quem não
-- está em nenhuma das cinco (Apoio, Almox, EHA, setor em branco).
create or replace function public.collaborator_macro_area(p_sector text)
returns text
language sql
immutable
as $$
  select case
    when p_sector ilike '%recebimento%'         then 'RECEBIMENTO'
    when p_sector ilike '%processamento%'       then 'PROCESSAMENTO'
    when p_sector ilike '%expedi%'              then 'EXPEDIÇÃO'
    when p_sector ilike '%tratativa%'           then 'TRATATIVAS'
    when p_sector ~* '(^|[^a-z])asm([^a-z]|$)'  then 'ASM'
    else null
  end;
$$;

comment on function public.collaborator_macro_area(text) is
  'Espelha normalizeMacroArea() de src/lib/trainingRules.ts.';

-- ── 2. Este treinamento torna este colaborador treinado? ─────
-- Espelha isCollaboratorTrained() do TypeScript. Continua sendo avaliada
-- um treinamento por vez (a view agrega com bool_or), o que dá o mesmo
-- resultado que a função do TS, que recebe a lista inteira.
--
-- p_role e p_is_onboarding não são mais usados: a regra antiga casava o
-- nome do treinamento com o CARGO da pessoa por substring, o que fazia
-- "AUXILIAR DE LOGISTICA" casar com quase tudo. A assinatura é mantida
-- para não quebrar quem já chama a função.
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
  select case
    when public.collaborator_macro_area(p_sector) is not null then
      public.training_unlocks_area(p_training_type, public.collaborator_macro_area(p_sector))
      -- Exceção do Sorter: nas SOCs com ASM quem trabalha no Sorter continua
      -- cadastrado em "Processamento", e o treinamento dele é o Sorter (ASM).
      or (
        public.collaborator_macro_area(p_sector) = 'PROCESSAMENTO'
        and public.training_unlocks_area(p_training_type, 'ASM')
      )
    else
      public.training_unlocks_area(p_training_type, 'RECEBIMENTO')
      or public.training_unlocks_area(p_training_type, 'PROCESSAMENTO')
      or public.training_unlocks_area(p_training_type, 'EXPEDIÇÃO')
      or public.training_unlocks_area(p_training_type, 'TRATATIVAS')
      or public.training_unlocks_area(p_training_type, 'ASM')
  end;
$$;

comment on function public.training_matches_collaborator(text, text, text, boolean) is
  'Espelha isCollaboratorTrained() de src/lib/trainingRules.ts. A regra mora lá — mude lá primeiro, depois aqui.';

-- ── 3. Gráfico "Desempenho por SOC" na mesma régua ───────────
-- Antes esta view contava SÓ quem estava numa macro-área operacional, o
-- que fazia o gráfico mostrar um percentual mais alto que a realidade da
-- unidade. Agora conta todo o headcount, igual às telas.
--
-- ⚠️ Continua SEM security_invoker, de propósito — ver a nota extensa em
-- 20260811_01. A view expõe apenas agregados por SOC, nunca linha por
-- pessoa, e precisa enxergar todas as unidades para o comparativo.
-- O join com socs é mantido de propósito: 7 siglas aparecem em
-- collaborators sem existir em socs (MG4 com 29 pessoas, e SP9/SP11/SP12/
-- SP15/SP16/SP17 com exatamente 1 cada — estas seis têm cara de erro de
-- digitação na planilha de origem). Sem o join elas virariam barras no
-- gráfico comparativo. Ficam de fora até serem cadastradas ou corrigidas.
create or replace view public.soc_performance_view as
select
  c.soc,
  count(*)::int                                   as total_hc,
  count(*) filter (where t.is_trained)::int       as trained_hc,
  case when count(*) > 0
    then round((count(*) filter (where t.is_trained))::numeric / count(*) * 100, 1)
    else 0
  end                                             as pct
from public.collaborators c
join public.socs s on s.name = c.soc
left join lateral (
  select bool_or(
    public.training_matches_collaborator(tc.training_type, c.sector, c.role, false)
  ) as is_trained
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true
where c.soc is not null and c.soc <> ''
group by c.soc;

grant select on public.soc_performance_view to authenticated;
grant execute on function public.collaborator_macro_area(text) to authenticated;

-- ── Conferência ──────────────────────────────────────────────
-- As duas linhas precisam bater: é o mesmo número que o Dashboard, a tela
-- de Colaboradores e os Relatórios passam a mostrar para SC1.
select
  '✅ Regra única aplicada.' as status,
  (select count(*) from public.collaborators_status where soc = 'SC1')                  as sc1_total,
  (select count(*) from public.collaborators_status where soc = 'SC1' and is_trained)   as sc1_treinados_view,
  (select trained_hc from public.soc_performance_view where soc = 'SC1')                as sc1_treinados_grafico,
  (select pct from public.soc_performance_view where soc = 'SC1')                       as sc1_pct;
