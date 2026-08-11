-- ============================================================
-- Gráfico "Desempenho por SOC" em Relatórios — comparativo entre
-- todas as unidades, sem baixar linhas individuais para o navegador.
-- ============================================================
-- Este gráfico é a ÚNICA parte da tela de Relatórios que deve mostrar
-- todas as 23 SOCs de uma vez — o resto da tela continua restrito à
-- SOC do usuário logado. A view abaixo devolve UMA LINHA POR SOC
-- (sigla, headcount operacional, treinados, %) e nunca uma linha por
-- pessoa: nenhum dado individual atravessa unidades.
--
-- Regra aplicada (mesma da tela, motor em src/lib/trainingRules.ts):
--   Áreas contadas: Recebimento, Processamento, Expedição, Tratativas
--   + ASM, mas SOMENTE nas SOCs com processo de sorting (socs.has_sorting).
--   "Treinado" = tem um registro em trainings_completed que acende a
--   área inteira (Onboarding PTS, ou "Treinamento Padrão SOC - <área>").
--   Onboarding administrativo (People/HSE/Security/Qualidade/Meio
--   Ambiente) NÃO conta — mesma regra do trainingRules.ts.
--
-- ⚠️ DECISÃO DELIBERADA DE SEGURANÇA — leia antes de alterar:
-- Esta view NÃO usa security_invoker. Isso é intencional: depois que a
-- migração 20260810_02 (isolamento de RLS por SOC) for aplicada, um
-- usuário autenticado só enxerga trainings_completed da própria SOC.
-- Se esta view respeitasse esse RLS, cada SOC veria as OUTRAS zeradas
-- (porque não teria permissão de leitura sobre os treinos delas), e o
-- gráfico comparativo deixaria de fazer sentido. Por isso a view roda
-- com o privilégio de quem a criou (padrão do Postgres), enxergando
-- todas as SOCs — mas ela SÓ expõe agregados (contagens e percentual),
-- nunca uma linha por colaborador. Não adicione colunas individuais
-- aqui sem reавaliar esse ponto.
-- ============================================================

-- Função auxiliar: dado um training_type (texto livre gravado pela
-- assinatura) e uma área, diz se aquele treinamento acende a área
-- inteira. Espelha training_unlocks_area / isAreaTrained do TS,
-- usando os textos das SOCs. Padrões testados contra os 15 tipos de
-- treinamento reais do banco em 10/08/2026 — nenhum falso positivo.
create or replace function public.training_unlocks_area(training_type text, area text)
returns boolean
language sql
immutable
as $$
  select case
    when training_type ilike '%onboarding%' and training_type ilike '%pts%' then
      area in ('RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO')
      or (area = 'ASM' and training_type ilike '%com sorter%')
    when training_type ilike '%onboarding%' then
      false
    when training_type ilike '%padr%o soc%' then
      (area = 'RECEBIMENTO' and training_type ilike '%recebimento%')
      or (area = 'PROCESSAMENTO' and training_type ilike '%processamento%')
      or (area = 'EXPEDIÇÃO' and training_type ilike '%expedi%')
      or (area = 'TRATATIVAS' and training_type ilike '%tratativa%')
      or (area = 'ASM' and training_type ilike '%asm%')
    else
      false
  end;
$$;

comment on function public.training_unlocks_area is
  'Espelha isAreaTrained() de src/lib/trainingRules.ts. Se a lista de treinamentos padrão mudar, atualize os dois lugares.';

create or replace view public.soc_performance_view as
with collab_area as (
  select
    c.id  as collaborator_id,
    c.soc as soc,
    case
      when c.sector ilike '%recebimento%'   then 'RECEBIMENTO'
      when c.sector ilike '%processamento%' then 'PROCESSAMENTO'
      when c.sector ilike '%expedi%'        then 'EXPEDIÇÃO'
      when c.sector ilike '%tratativa%'     then 'TRATATIVAS'
      when c.sector ~* '(^|[^a-z])asm([^a-z]|$)' then 'ASM'
      else null
    end as area
  from public.collaborators c
  where c.soc is not null and c.soc <> ''
),
eligible as (
  select ca.collaborator_id, ca.soc, ca.area
  from collab_area ca
  join public.socs s on s.name = ca.soc
  where ca.area is not null
    and (ca.area <> 'ASM' or coalesce(s.has_sorting, false))
)
select
  e.soc,
  count(*)::int as total_hc,
  count(*) filter (
    where exists (
      select 1 from public.trainings_completed tc
      where tc.collaborator_id = e.collaborator_id
        and public.training_unlocks_area(tc.training_type, e.area)
    )
  )::int as trained_hc,
  case when count(*) > 0 then
    round(
      (count(*) filter (
        where exists (
          select 1 from public.trainings_completed tc
          where tc.collaborator_id = e.collaborator_id
            and public.training_unlocks_area(tc.training_type, e.area)
        )
      ))::numeric / count(*) * 100,
    1)
  else 0 end as pct
from eligible e
group by e.soc;

grant select on public.soc_performance_view to authenticated;
grant execute on function public.training_unlocks_area(text, text) to authenticated;

-- Índice de apoio para o EXISTS acima (collaborators.soc/sector já usado
-- em outras telas, mas o filtro por sector aqui é novo).
create index if not exists idx_collaborators_sector on public.collaborators (sector);
