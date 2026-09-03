-- ============================================================
-- O espelho SQL volta a responder igual ao motor TypeScript
-- ============================================================
-- Esta migração SUBSTITUI a 20260902_02_onboarding_lideres.sql (que foi
-- consolidada aqui e removida do repositório). Rode só esta — ela contém
-- tudo o que aquela tinha, mais as correções de 03/09/2026. Se você já
-- tiver rodado a 02, não tem problema: esta refaz tudo por cima.
--
-- ⚠️ A REGRA MORA EM src/lib/trainingRules.ts. Este arquivo é o espelho.
-- Mudou lá? Mude aqui. Este arquivo existe porque a tela de Colaboradores
-- e o gráfico "Desempenho por SOC" leem do banco, não do TypeScript.
--
-- ── O QUE QUEBROU (achado em 03/09/2026) ────────────────────
-- O Aderson (SP2) aparecia CERTIFICADO na tela de Colaboradores e PENDENTE
-- na exportação de pendentes dos Relatórios, tendo UMA assinatura só:
-- "Onboarding Novos Colaboradores PTS".
--
-- Os dois lados liam esse nome diferente:
--   · aqui (training_unlocks_area): ilike '%onboarding%' AND ilike '%pts%'
--     — duas buscas independentes, em qualquer posição. Casava.
--   · no TypeScript (areasUnlockedBy): includes('ONBOARDING PTS') — exigia
--     a frase colada. NÃO casava, e o nome caía na regra 3 ("onboarding
--     administrativo, não credencia nada").
--
-- Resultado: 852 pessoas em 5 SOCs (SP2 748, CE3 36, PR1 31, PR4 30, SP8 7)
-- certificadas numa tela e pendentes na outra. SP2 mostrava 32,5% no
-- Dashboard e 77,9% em Colaboradores — a mesma unidade, no mesmo dia.
--
-- Decisão do Ygor em 03/09/2026: "Onboarding Novos Colaboradores PTS" é o
-- Onboarding PTS de verdade e credencia Recebimento + Processamento +
-- Expedição (não ASM — o nome não diz "Com Sorter"). Quem estava estrito
-- demais era o TypeScript, que foi afrouxado para aceitar as duas palavras
-- em qualquer posição.
--
-- ── O FURO INVERSO, QUE ESTA MIGRAÇÃO FECHA ─────────────────
-- Afrouxar não bastava, porque este lado tinha o problema contrário: ele
-- nunca descartou o CÓDIGO DO DOCUMENTO antes de comparar, e os códigos
-- contêm "PTS" — "SPX_BR_PTS_SOC_031". Um treinamento chamado, digamos,
-- "Onboarding SPX_BR_PTS_SOC_062" seria lido aqui como Onboarding PTS e
-- credenciaria três áreas indevidamente. O TypeScript já descartava esse
-- código (stripVersionAndCode); este lado não. Nenhum nome assim existe
-- hoje entre os 45 em uso — é uma bomba armada, e agora está desarmada.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

-- ── 1. Descarte do código do documento ───────────────────────
-- Espelha o trecho de stripVersionAndCode() que remove "SPX_BR_PTS_SOC_NNN".
-- A classe [^A-Za-z0-9] cobre os separadores reais ("_", "-", espaço) sem
-- depender do flag de caixa.
create or replace function public.strip_training_code(p_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    coalesce(p_text, ''),
    'SPX[^A-Za-z0-9]*BR[^A-Za-z0-9]*PTS[^A-Za-z0-9]*SOC[^A-Za-z0-9]*[0-9]+',
    ' ',
    'gi'
  );
$$;

comment on function public.strip_training_code(text) is
  'Remove o código do documento (SPX_BR_PTS_SOC_NNN) antes de comparar nomes de treinamento. Espelha stripVersionAndCode() de src/lib/trainingRules.ts — o "PTS" do código não pode ser confundido com o treinamento PTS.';

-- ── 2. Que áreas um treinamento credencia ────────────────────
-- Mesma regra de antes, com uma diferença: compara sobre o nome JÁ SEM o
-- código do documento.
create or replace function public.training_unlocks_area(training_type text, area text)
returns boolean
language sql
immutable
as $$
  select case
    when public.strip_training_code(training_type) ilike '%onboarding%'
     and public.strip_training_code(training_type) ilike '%pts%' then
      area in ('RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO')
      or (area = 'ASM' and training_type ilike '%com sorter%')
    when training_type ilike '%onboarding%' then false
    when training_type ilike '%padr%o soc%' then
      (area = 'RECEBIMENTO'   and training_type ilike '%recebimento%')
      or (area = 'PROCESSAMENTO' and training_type ilike '%processamento%')
      or (area = 'EXPEDIÇÃO'     and training_type ilike '%expedi%')
      or (area = 'TRATATIVAS'    and training_type ilike '%tratativa%')
      or (area = 'ASM'           and training_type ilike '%asm%')
    else false
  end;
$$;

comment on function public.training_unlocks_area(text, text) is
  'Espelha areasUnlockedBy() de src/lib/trainingRules.ts. "Onboarding" + "PTS" contam em qualquer posição do nome, depois de descartado o código do documento.';

-- ── 3. O setor efetivo da pessoa ─────────────────────────────
-- Espelha collaboratorArea() do TypeScript, que este lado nunca teve: até
-- agora o banco decidia a área só pelo texto do setor, sem saber se a
-- unidade tem Sorter nem o que a pessoa faz (activity). Devolve um SETOR
-- (texto), não uma área, para que training_matches_collaborator continue
-- recebendo o mesmo tipo de argumento de sempre.
--
--  · Setor "ASM" numa SOC SEM sorter é contradição no dado (a unidade não
--    tem Sorter). Decisão do Ygor em 03/09/2026: essa pessoa entra em
--    PROCESSAMENTO em todas as telas. Hoje é 1 pessoa (CE3).
--  · Quem o RH deixou em "Processamento" mas trabalha no Sorter é
--    identificado pela activity ("ASM | Chutes", "ASM - Looping C",
--    "ASM Nível 1") — só vale nas SOCs com sorter.
create or replace function public.collaborator_effective_sector(
  p_sector      text,
  p_has_sorting boolean,
  p_activity    text
)
returns text
language sql
immutable
as $$
  select case
    when public.collaborator_macro_area(p_sector) = 'ASM' then
      case when coalesce(p_has_sorting, false) then 'ASM' else 'PROCESSAMENTO' end
    when coalesce(p_has_sorting, false)
     and public.collaborator_macro_area(p_sector) = 'PROCESSAMENTO'
     -- ~* (e não ~): o TypeScript usa /^ASM\b/i, insensível a caixa.
     and p_activity ~* '^\s*ASM([^A-Za-z0-9_]|$)' then 'ASM'
    else p_sector
  end;
$$;

comment on function public.collaborator_effective_sector(text, boolean, text) is
  'Espelha collaboratorArea() de src/lib/trainingRules.ts. Resolve o setor real antes de perguntar se o treinamento credencia: ASM sem sorter vira Processamento; Processamento com activity de Sorter vira ASM.';

-- ── 4. Esta pessoa está treinada? ────────────────────────────
-- Espelha isCollaboratorTrained(). Ganhou p_is_leader (pedido de
-- 02/09/2026, consolidado aqui): líder com "Onboarding Líderes" está
-- treinado por essa via, independente de setor. É um OU a mais, não uma
-- troca — quem já estava treinado por outra via continua.
--
-- p_role e p_is_onboarding não são usados: a regra antiga casava o nome do
-- treinamento com o CARGO por substring, o que fazia "AUXILIAR DE
-- LOGISTICA" casar com quase tudo. Mantidos na assinatura para não quebrar
-- chamadas existentes.
create or replace function public.training_matches_collaborator(
  p_training_type text,
  p_sector        text,
  p_role          text,
  p_is_onboarding boolean,
  p_is_leader     boolean default false
)
returns boolean
language sql
immutable
as $$
  select case
    -- '%onboarding l%deres%' casa "Líderes" e "Lideres" — o % cobre o
    -- caractere acentuado, mesmo idioma já usado em '%padr%o soc%'.
    when p_is_leader and p_training_type ilike '%onboarding l%deres%' then true

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

comment on function public.training_matches_collaborator(text, text, text, boolean, boolean) is
  'Espelha isCollaboratorTrained() de src/lib/trainingRules.ts. A regra mora lá — mude lá primeiro, depois aqui. Receba o setor EFETIVO (ver collaborator_effective_sector), não o setor cru.';

-- ── 5. socs.name passa a ser único ───────────────────────────
-- As views abaixo passam a fazer join em socs para saber o has_sorting. Sem
-- unicidade, um nome repetido duplicaria as linhas de collaborators_status,
-- que é a view que a tela de Colaboradores inteira consome. Hoje não há
-- nenhum repetido (28 unidades) — o índice só impede que passe a haver.
create unique index if not exists idx_socs_name_unique on public.socs (name);

-- ── 6. collaborators_status ──────────────────────────────────
-- Mesmas colunas de 20260814_01, na mesma ordem (obrigatório para o
-- create or replace). O que muda: o join com socs, para conhecer o
-- has_sorting, e o setor efetivo indo para a função no lugar do setor cru.
create or replace view public.collaborators_status
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.opsid,
  c.gender,
  c.soc,
  c.sector,
  c.shift,
  c.leader,
  c.role,
  c.bpo,
  c.is_onboarding,
  c.admission_date,
  c.activity,
  coalesce(t.is_trained, false)                as is_trained,
  coalesce(t.onboarding_modules, '{}'::text[]) as onboarding_modules,
  c.email,
  c.is_leader,
  c.leader_id
from public.collaborators c
-- LEFT: colaborador cuja sigla de SOC não existe em socs continua aparecendo
-- na tela (has_sorting vira null → tratado como sem sorter). São 7 siglas
-- hoje, provavelmente erro de digitação na planilha — ver a nota em
-- 20260813_07. Some da view seria pior do que aparecer.
left join public.socs s on s.name = c.soc
left join lateral (
  select
    bool_or(
      public.training_matches_collaborator(
        tc.training_type,
        public.collaborator_effective_sector(c.sector, s.has_sorting, c.activity),
        c.role,
        c.is_onboarding,
        c.is_leader
      )
    ) as is_trained,
    array_agg(upper(tc.training_type))
      filter (where tc.training_type ilike '%onboarding%') as onboarding_modules
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true;

grant select on public.collaborators_status to authenticated;

-- ── 7. Gráfico "Desempenho por SOC" na mesma régua ───────────
-- ⚠️ Continua SEM security_invoker, de propósito — ver a nota extensa em
-- 20260811_01. Expõe só agregados por SOC, nunca linha por pessoa, e
-- precisa enxergar todas as unidades para o comparativo.
-- O join com socs aqui é INNER de propósito (diferente da view acima): as
-- 7 siglas que não existem em socs virariam barras soltas no gráfico.
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
    public.training_matches_collaborator(
      tc.training_type,
      public.collaborator_effective_sector(c.sector, s.has_sorting, c.activity),
      c.role,
      false,
      c.is_leader
    )
  ) as is_trained
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true
where c.soc is not null and c.soc <> ''
group by c.soc;

grant select on public.soc_performance_view to authenticated;

-- ── 8. Permissões ────────────────────────────────────────────
-- collaborators_status é security_invoker: quem consulta executa as funções
-- com o próprio usuário e precisa de EXECUTE. Funções novas nascem com
-- EXECUTE para PUBLIC, mas o repositório sempre concedeu explicitamente
-- (ver 20260812_04) — mantendo o padrão para não depender do default.
grant execute on function public.strip_training_code(text) to authenticated;
grant execute on function public.collaborator_effective_sector(text, boolean, text) to authenticated;
grant execute on function public.training_matches_collaborator(text, text, text, boolean, boolean) to authenticated;

-- ── 9. A versão antiga de 4 argumentos sai de cena ───────────
-- As duas views acima já não a usam. Deixá-la viva criaria ambiguidade com
-- a de 5 argumentos (a de 5 tem default no último), e uma chamada com 4
-- argumentos passaria a dar erro "function is not unique".
drop function if exists public.training_matches_collaborator(text, text, text, boolean);

-- ── Conferência ──────────────────────────────────────────────
-- Os percentuais abaixo devem bater com o Dashboard/Relatórios depois do
-- deploy do frontend. Valores esperados (medidos em 03/09/2026):
--   SP2 77,9% · CE3 76,4% · PR1 78,3% · PR4 76,2%
select
  '✅ Espelho SQL alinhado ao TypeScript.' as status,
  (select count(*) from public.trainings_completed
     where training_type ilike '%onboarding%' and training_type ilike '%pts%'
       and training_type not ilike '%onboarding pts%')                          as assinaturas_destravadas,
  (select count(*) from public.collaborators where is_leader)                   as lideres_cadastrados,
  (select count(*) from public.collaborators_status where is_leader and is_trained) as lideres_treinados;

select soc, total_hc, trained_hc, pct
from public.soc_performance_view
where soc in ('SP2', 'CE3', 'PR1', 'PR4')
order by soc;
