-- ============================================================
-- Views de "treinado?" voltam a ser rápidas — mesma regra, outra forma
-- ============================================================
-- ⚠️ NÃO muda NENHUMA regra de negócio. O veredito de cada colaborador é
-- idêntico ao da 20260916_01 (setor cadastrado também credencia). Muda só
-- COMO o banco calcula.
--
-- ── O QUE REGREDIU (16/09/2026) ─────────────────────────────
-- Depois da 20260916_01, ler as views ficou lento demais:
--   · soc_performance_view (gráfico "Desempenho por SOC"): 8,0s — no limite
--     do timeout da API;
--   · collaborators_status com todas as SOCs: 0,4s na 1ª página, 3,4s na
--     10ª, crescendo até estourar nas páginas finais (a tela do master).
-- Por SOC (como a maioria dos usuários vê) continuava 0,5s.
--
-- A causa: a 20260916_01 escreveu training_matches_collaborator com um
-- bloco WITH e subconsultas. O Postgres só consegue EMBUTIR (inline) uma
-- função SQL na consulta que a chama quando o corpo é um único SELECT de
-- expressão — sem WITH, sem subconsulta. Não embutida, a função vira uma
-- mini-consulta executada à parte para CADA uma das ~40 mil assinaturas, e
-- ainda recalculava a área do colaborador a cada assinatura.
--
-- ── A FORMA NOVA ─────────────────────────────────────────────
-- A regra foi separada no que depende da PESSOA e no que depende da
-- ASSINATURA:
--   · collaborator_group_area(setor, has_sorting, activity) → a área do
--     grupo (espelha collaboratorArea do TypeScript). Calculada nas views
--     UMA vez por colaborador.
--   · training_credentials_area(tipo, area_grupo, area_setor, is_leader,
--     has_sorting) → esta assinatura credencia? Recebe as áreas já
--     resolvidas; todos os argumentos são colunas simples, então o Postgres
--     embute a função na consulta.
--   · training_matches_collaborator (mesma assinatura da 20260916_01)
--     continua existindo como a composição das duas — é o espelho 1:1 de
--     isCollaboratorTrained para uso avulso. As views não usam ela.
--
-- Por que o "offset 0" nas views: sem ele o Postgres "achata" o subselect
-- das áreas, e a coluna area_grupo volta a ser substituída pela expressão
-- inteira (vários ILIKE) dentro da regra por assinatura — que aparece
-- várias vezes no corpo da função. Argumento caro e repetido é exatamente
-- o que impede o Postgres de embutir a função. O "offset 0" mantém as
-- áreas como colunas prontas. NÃO remova.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

-- ── 1. Área do grupo do colaborador ──────────────────────────
-- Espelha collaboratorArea() de src/lib/trainingRules.ts:
--   · setor ASM numa SOC sem Sorter → PROCESSAMENTO (decisão de 03/09/2026)
--   · setor PROCESSAMENTO + activity começando com "ASM", numa SOC com
--     Sorter → ASM
--   · senão, a macro-área do próprio setor (ou NULL = fora das áreas)
create or replace function public.collaborator_group_area(
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
    else public.collaborator_macro_area(p_sector)
  end;
$$;

comment on function public.collaborator_group_area(text, boolean, text) is
  'Espelha collaboratorArea() de src/lib/trainingRules.ts: a área em que o colaborador é CONTADO. NULL = fora das macro-áreas (Apoio, Almox, sem setor).';

-- ── 2. Esta assinatura credencia? (áreas já resolvidas) ──────
-- Corpo de expressão única, sem WITH nem subconsulta: o Postgres embute.
create or replace function public.training_credentials_area(
  p_training_type text,
  p_area_grupo    text,
  p_area_setor    text,
  p_is_leader     boolean,
  p_has_sorting   boolean
)
returns boolean
language sql
immutable
as $$
  select case
    -- Onboarding Líderes credencia líder, independente de setor (02/09/2026).
    -- '%onboarding l%deres%' casa "Líderes" e "Lideres".
    when p_is_leader and p_training_type ilike '%onboarding l%deres%' then true

    when p_area_grupo is not null then
      -- 1. o treinamento da área do grupo
      public.training_unlocks_area(p_training_type, p_area_grupo, p_has_sorting)
      -- 2. o treinamento do SETOR CADASTRADO (16/09/2026): a promoção por
      --    activity muda o grupo de contagem, nunca eleva a exigência
      or coalesce(public.training_unlocks_area(p_training_type, p_area_setor, p_has_sorting), false)
      -- 3. exceção do Sorter: quem está em Processamento é credenciado pelo
      --    treinamento de ASM
      or (p_area_grupo = 'PROCESSAMENTO' and public.training_unlocks_area(p_training_type, 'ASM', p_has_sorting))

    else
      -- Sem setor operacional: basta um treinamento que acenda qualquer área.
      public.training_unlocks_area(p_training_type, 'RECEBIMENTO', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'PROCESSAMENTO', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'EXPEDIÇÃO', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'TRATATIVAS', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'ASM', p_has_sorting)
  end;
$$;

comment on function public.training_credentials_area(text, text, text, boolean, boolean) is
  'Parte "por assinatura" de isCollaboratorTrained() (src/lib/trainingRules.ts). Recebe as áreas já resolvidas por collaborator_group_area / collaborator_macro_area. Corpo de expressão única de propósito: é o que permite ao Postgres embuti-la nas views — ver 20260916_03.';

grant execute on function public.collaborator_group_area(text, boolean, text) to authenticated;
grant execute on function public.training_credentials_area(text, text, text, boolean, boolean) to authenticated;

-- ── 3. O espelho 1:1 continua existindo, agora como composição ──
-- Mesma assinatura e mesmos nomes de parâmetro da 20260916_01 — o
-- create or replace não precisa de drop.
create or replace function public.training_matches_collaborator(
  p_training_type text,
  p_sector        text,
  p_activity      text,
  p_is_leader     boolean,
  p_has_sorting   boolean
)
returns boolean
language sql
immutable
as $$
  select public.training_credentials_area(
    p_training_type,
    public.collaborator_group_area(p_sector, p_has_sorting, p_activity),
    public.collaborator_macro_area(p_sector),
    p_is_leader,
    p_has_sorting
  );
$$;

comment on function public.training_matches_collaborator(text, text, text, boolean, boolean) is
  'Espelha isCollaboratorTrained() de src/lib/trainingRules.ts — mesmos insumos (setor CRU, activity, is_leader, has_sorting). Para uso avulso: as views usam as partes (collaborator_group_area + training_credentials_area) para calcular a área uma vez por pessoa. A regra mora no TypeScript: mude lá primeiro.';

-- ── 4. collaborators_status ─────────────────────────────────
-- Mesmas colunas de 20260814_01, na mesma ordem (obrigatório para o
-- create or replace).
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
-- LEFT: sigla de SOC inexistente em socs continua aparecendo (sem sorter).
left join public.socs s on s.name = c.soc
-- Áreas UMA vez por colaborador. "offset 0" é proposital — ver cabeçalho.
cross join lateral (
  select
    public.collaborator_group_area(c.sector, coalesce(s.has_sorting, false), c.activity) as area_grupo,
    public.collaborator_macro_area(c.sector)                                             as area_setor,
    coalesce(s.has_sorting, false)                                                       as has_sorting
  offset 0
) a
left join lateral (
  select
    bool_or(
      public.training_credentials_area(tc.training_type, a.area_grupo, a.area_setor, c.is_leader, a.has_sorting)
    ) as is_trained,
    array_agg(upper(tc.training_type))
      filter (where tc.training_type ilike '%onboarding%') as onboarding_modules
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true;

grant select on public.collaborators_status to authenticated;

-- ── 5. Gráfico "Desempenho por SOC" ─────────────────────────
-- ⚠️ Continua SEM security_invoker, de propósito — ver 20260811_01.
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
cross join lateral (
  select
    public.collaborator_group_area(c.sector, coalesce(s.has_sorting, false), c.activity) as area_grupo,
    public.collaborator_macro_area(c.sector)                                             as area_setor,
    coalesce(s.has_sorting, false)                                                       as has_sorting
  offset 0
) a
left join lateral (
  select bool_or(
    public.training_credentials_area(tc.training_type, a.area_grupo, a.area_setor, c.is_leader, a.has_sorting)
  ) as is_trained
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true
where c.soc is not null and c.soc <> ''
group by c.soc;

grant select on public.soc_performance_view to authenticated;

-- ── Conferência ──────────────────────────────────────────────
-- A prova de que a regra não mudou não é esta tabela: é rodar, depois
-- desta migração, `npx vite-node scripts/verificar_espelho.ts` — ele compara
-- pessoa por pessoa o veredito do banco com o do TypeScript, e só consegue
-- terminar se a view estiver rápida de novo (ele lê as ~24 mil linhas).
select soc, total_hc, trained_hc, pct
from public.soc_performance_view
order by soc;
