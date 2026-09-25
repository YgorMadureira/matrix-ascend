-- ============================================================
-- Regras de área configuráveis pela tela (sem mexer no código)
-- ============================================================
-- ── POR QUE ─────────────────────────────────────────────────
-- Toda vez que a operação decide que um treinamento passa a cobrir uma área,
-- era preciso mexer em src/lib/trainingRules.ts, espelhar no SQL, testar e
-- publicar. Foi assim com "Onboarding Novos Colaboradores PTS" (03/09) e com
-- a exceção do Sorter. Pedido de 25/09/2026: o master declara isso na tela de
-- Configurações.
--
-- O caso que motivou: 190 colaboradores do setor ASM em RJ2 fizeram o
-- "ONBOARDING PTS V3" e apareciam pendentes, porque esse nome acende
-- Recebimento/Processamento/Expedição, mas não ASM. Conferido: aplicar essa
-- regra afeta exatamente essas 190 pessoas e mais ninguém em nenhuma unidade
-- com sorter.
--
-- ── O QUE ESTA TABELA É (e o que NÃO é) ─────────────────────
-- É ADITIVA: cada linha diz "este treinamento TAMBÉM credencia esta área".
-- Ela nunca REMOVE o que as regras do motor já concedem. Isso é de propósito:
-- uma configuração que pudesse tirar cobertura viraria uma segunda fonte de
-- verdade capaz de contradizer o motor em silêncio — exatamente o problema
-- que passamos o mês inteiro corrigindo. Para tirar cobertura, muda-se a
-- regra no motor, com teste.
--
-- O nome do treinamento casa por igualdade exata (já em maiúsculas: o
-- trigger abaixo normaliza, igual ao resto do banco desde 20260903_02), e a
-- tela oferece os nomes que existem em trainings_completed, para não haver
-- erro de digitação.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

create table if not exists public.training_area_rules (
  id            uuid primary key default gen_random_uuid(),
  training_name text not null,
  area          text not null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint training_area_rules_area_valida
    check (area in ('RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'ASM')),
  constraint training_area_rules_unica unique (training_name, area)
);

comment on table public.training_area_rules is
  'Regras ADITIVAS de cobertura: "este treinamento também credencia esta área". Mantida pelo master na tela de Configurações. Lida pelo motor TS (src/lib/trainingRules.ts, via registro carregado no início) e pelas views collaborators_status / soc_performance_view. Nunca remove cobertura — só acrescenta.';

-- Nome em maiúsculas, igual a trainings_completed.training_type — é o que
-- permite o join por igualdade simples nas views (ver 20260903_02).
create or replace function public.normalize_training_area_rules_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.training_name := upper(btrim(NEW.training_name));
  NEW.area          := upper(btrim(NEW.area));
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.training_area_rules;
create trigger trg_normalize_uppercase
  before insert or update on public.training_area_rules
  for each row
  execute function public.normalize_training_area_rules_uppercase();

-- ── Permissões ───────────────────────────────────────────────
-- Qualquer usuário autenticado LÊ (o Dashboard e os Relatórios precisam das
-- regras para calcular). Só o master ESCREVE.
alter table public.training_area_rules enable row level security;

drop policy if exists "read_training_area_rules" on public.training_area_rules;
create policy "read_training_area_rules" on public.training_area_rules
  for select to authenticated
  using (true);

drop policy if exists "master_writes_training_area_rules" on public.training_area_rules;
create policy "master_writes_training_area_rules" on public.training_area_rules
  for all to authenticated
  using (public.is_master())
  with check (public.is_master());

-- ── As views passam a considerar as regras ───────────────────
-- A regra entra como um JOIN, não como consulta dentro da função por linha:
-- training_credentials_area continua sendo uma expressão simples que o
-- Postgres embute na consulta (ver 20260916_03 — foi o que devolveu o
-- desempenho das views). A tabela é minúscula, então o join é barato.

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
left join public.socs s on s.name = c.soc
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
      -- regra configurada na tela: vale para a área do grupo OU a do setor
      or r.id is not null
    ) as is_trained,
    array_agg(upper(tc.training_type))
      filter (where tc.training_type ilike '%onboarding%') as onboarding_modules
  from public.trainings_completed tc
  left join public.training_area_rules r
    on r.training_name = tc.training_type
   and r.area in (a.area_grupo, a.area_setor)
  where tc.collaborator_id = c.id
) t on true;

grant select on public.collaborators_status to authenticated;

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
    or r.id is not null
  ) as is_trained
  from public.trainings_completed tc
  left join public.training_area_rules r
    on r.training_name = tc.training_type
   and r.area in (a.area_grupo, a.area_setor)
  where tc.collaborator_id = c.id
) t on true
where c.soc is not null and c.soc <> ''
group by c.soc;

grant select on public.soc_performance_view to authenticated;

-- ── Conferência ──────────────────────────────────────────────
select
  '✅ Regras de área configuráveis criadas.' as status,
  (select count(*) from public.training_area_rules) as regras_cadastradas;
