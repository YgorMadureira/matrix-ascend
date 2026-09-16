-- ============================================================
-- O treinamento do SETOR CADASTRADO sempre credencia
-- ============================================================
-- ⚠️ A REGRA MORA EM src/lib/trainingRules.ts. Este arquivo é o espelho.
--
-- ── O QUE ESTAVA ERRADO (achado em SP2 em 16/09/2026) ───────
-- O líder "Jeferson Martins" e a líder "Leticia Gardin Firmino", ambos com
-- setor PROCESSAMENTO em SP2, apareciam PENDENTES tendo feito o treinamento
-- do próprio setor. A Leticia é o caso mais evidente: tem os QUATRO
-- treinamentos de área assinados (Recebimento, Processamento, Expedição e
-- Tratativas) e ainda assim constava pendente.
--
-- A causa: os dois têm activity = "ASM". A regra de 02/09/2026 (ver
-- collaborator_effective_sector / collaboratorArea) promove quem tem
-- activity começando com "ASM" para a ÁREA ASM. Essa promoção foi criada
-- para a pessoa ser CONTADA no grupo certo (o card de ASM mostrava 0/0
-- enquanto a matriz mostrava os ticks acesos) — mas ela acabou também
-- ELEVANDO A EXIGÊNCIA: passou a cobrar o "Treinamento Padrão SOC - Sorter
-- (ASM)" e a ignorar o treinamento do setor onde a pessoa está cadastrada.
--
-- A regra era assimétrica: quem caía em PROCESSAMENTO era aceito pelo
-- treinamento de ASM (exceção do Sorter, de 20260813_05), mas o contrário
-- não valia.
--
-- Varredura em todos os SOCs: 10 pessoas afetadas, todas em SP2, todas
-- líderes, todas com setor PROCESSAMENTO + activity "ASM". Nenhum outro
-- SOC tinha o caso.
--
-- ── A REGRA NOVA ───────────────────────────────────────────
-- A pessoa é credenciada por QUALQUER uma das duas:
--   · o treinamento da área do GRUPO em que ela é contada (a que a activity
--     pode ter promovido para ASM) — comportamento de antes; ou
--   · o treinamento da área do SETOR em que ela está CADASTRADA.
-- A promoção por activity volta a fazer só o que foi criada para fazer:
-- mudar o grupo de contagem, nunca elevar a exigência.
--
-- ── MUDANÇA DE ASSINATURA (e por quê) ──────────────────────
-- Até aqui as views calculavam o setor efetivo ANTES de chamar esta função
-- e passavam o resultado como p_sector — ou seja, a função nunca via o
-- setor cadastrado, e por isso não tinha como aplicar a regra nova. Pior:
-- quem chamasse a função sem pré-calcular o setor efetivo recebia uma
-- resposta silenciosamente diferente.
--
-- Agora a função recebe o setor CRU e a activity, e calcula o setor efetivo
-- por dentro — virando um espelho 1:1 de isCollaboratorTrained(sector,
-- tipos, hasSorting, activity, isLeader). Nenhum chamador precisa saber que
-- "setor efetivo" existe. As versões antigas são removidas no fim para não
-- deixarem a regra velha acessível por uma porta lateral.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

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
  with ctx as (
    select
      -- Área do GRUPO: pode ter sido promovida para ASM pela activity, ou
      -- rebaixada de ASM para PROCESSAMENTO numa SOC sem Sorter.
      public.collaborator_macro_area(
        public.collaborator_effective_sector(p_sector, p_has_sorting, p_activity)
      ) as area_grupo,
      -- Área do SETOR CADASTRADO, sem nenhuma promoção.
      public.collaborator_macro_area(p_sector) as area_setor
  )
  select case
    -- '%onboarding l%deres%' casa "Líderes" e "Lideres" — o % cobre o
    -- caractere acentuado, mesmo idioma já usado em '%padr%o soc%'.
    when p_is_leader and p_training_type ilike '%onboarding l%deres%' then true

    when (select area_grupo from ctx) is not null then
      -- 1. o treinamento da área do grupo
      public.training_unlocks_area(p_training_type, (select area_grupo from ctx), p_has_sorting)
      -- 2. o treinamento do setor cadastrado (a correção de 16/09/2026)
      or coalesce(
           public.training_unlocks_area(p_training_type, (select area_setor from ctx), p_has_sorting),
           false
         )
      -- 3. Exceção do Sorter: nas SOCs com ASM quem trabalha no Sorter
      --    continua cadastrado em "Processamento", e o treinamento dele é o
      --    Sorter (ASM). Cobre quem a activity não identificou (ex: MG2,
      --    que não marca activity).
      or (
        (select area_grupo from ctx) = 'PROCESSAMENTO'
        and public.training_unlocks_area(p_training_type, 'ASM', p_has_sorting)
      )

    else
      -- Sem setor operacional (Apoio, Almox, EHA, em branco): basta um
      -- treinamento que acenda qualquer área, porque o Onboarding PTS cobre
      -- todas (decisão de 13/08/2026).
      public.training_unlocks_area(p_training_type, 'RECEBIMENTO', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'PROCESSAMENTO', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'EXPEDIÇÃO', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'TRATATIVAS', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'ASM', p_has_sorting)
  end;
$$;

comment on function public.training_matches_collaborator(text, text, text, boolean, boolean) is
  'Espelha isCollaboratorTrained() de src/lib/trainingRules.ts — mesmos insumos (setor CRU, activity, is_leader, has_sorting). A regra mora lá: mude lá primeiro, depois aqui. NÃO passe setor efetivo aqui; a função calcula sozinha.';

grant execute on function public.training_matches_collaborator(text, text, text, boolean, boolean) to authenticated;

-- ── collaborators_status ─────────────────────────────────────
-- Mesmas colunas de 20260814_01, na mesma ordem (obrigatório para o
-- create or replace). O que muda: passa c.sector CRU e c.activity, em vez
-- do setor efetivo pré-calculado.
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
-- na tela (has_sorting vira null → tratado como sem sorter).
left join public.socs s on s.name = c.soc
left join lateral (
  select
    bool_or(
      public.training_matches_collaborator(
        tc.training_type,
        c.sector,
        c.activity,
        c.is_leader,
        coalesce(s.has_sorting, false)
      )
    ) as is_trained,
    array_agg(upper(tc.training_type))
      filter (where tc.training_type ilike '%onboarding%') as onboarding_modules
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true;

grant select on public.collaborators_status to authenticated;

-- ── Gráfico "Desempenho por SOC" na mesma régua ──────────────
-- ⚠️ Continua SEM security_invoker, de propósito — ver a nota extensa em
-- 20260811_01. Expõe só agregados por SOC, nunca linha por pessoa.
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
      c.sector,
      c.activity,
      c.is_leader,
      coalesce(s.has_sorting, false)
    )
  ) as is_trained
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true
where c.soc is not null and c.soc <> ''
group by c.soc;

grant select on public.soc_performance_view to authenticated;

-- ── As assinaturas antigas da função saem de cena ────────────
-- As views acima já não as usam. Deixá-las vivas seria manter a regra
-- ANTIGA (a que ignora o setor cadastrado) acessível para qualquer chamada
-- que passasse os parâmetros no formato velho.
--
-- ⚠️ NÃO acrescente aqui um drop de (text, text, text, boolean, boolean):
-- o Postgres identifica função pelos TIPOS dos parâmetros, não pelos nomes,
-- e essa é exatamente a assinatura da função NOVA criada acima
-- (training_type, sector, activity, is_leader, has_sorting) — por
-- coincidência os mesmos tipos da versão velha de 5 parâmetros
-- (training_type, sector, role, is_onboarding, is_leader), que já foi
-- removida pela 20260903_01. Tentar dropar aqui derruba a migração inteira
-- com "2BP01: cannot drop function ... because other objects depend on it",
-- porque as duas views acima passam a depender dela.
drop function if exists public.training_matches_collaborator(text, text, text, boolean);
drop function if exists public.training_matches_collaborator(text, text, text, boolean, boolean, boolean);

-- ── Conferência ──────────────────────────────────────────────
-- Os 10 líderes de SP2 com setor PROCESSAMENTO + activity "ASM" devem
-- passar a contar como treinados.
select
  '✅ Setor cadastrado passa a credenciar.' as status,
  (
    select count(*)
    from public.collaborators c
    join public.socs s on s.name = c.soc
    where s.has_sorting
      and public.collaborator_macro_area(c.sector) = 'PROCESSAMENTO'
      and c.activity ~* '^\s*ASM([^A-Za-z0-9_]|$)'
  ) as pessoas_promovidas_para_asm_pela_activity,
  (
    select count(*)
    from public.collaborators_status cs
    join public.socs s on s.name = cs.soc
    where s.has_sorting
      and public.collaborator_macro_area(cs.sector) = 'PROCESSAMENTO'
      and cs.activity ~* '^\s*ASM([^A-Za-z0-9_]|$)'
      and cs.is_trained
  ) as dessas_quantas_estao_treinadas;

select soc, total_hc, trained_hc, pct
from public.soc_performance_view
where soc = 'SP2';
