-- ============================================================
-- collaborators_status — a tela de Colaboradores em 1 consulta
-- ============================================================
-- O problema: a tela precisa saber, de cada colaborador, se ele já está
-- treinado e quais módulos de onboarding assinou. Isso era calculado no
-- navegador, e para isso ela baixava TODOS os registros de treinamento
-- da unidade em lotes de 150 ids — cerca de 15 requisições para SP6.
--
-- Com o perfil master vendo "Todas as unidades", esse mesmo caminho
-- viraria ~130 requisições encadeadas para 19,5 mil colaboradores. Em
-- vez disso, o cálculo desce para o banco: a view devolve o colaborador
-- já com is_trained e a lista de módulos de onboarding, e a tela faz
-- uma consulta paginada só nela.
--
-- A regra de "treinado" abaixo é a MESMA que estava em
-- CollaboratorsPage.tsx (isTrained) — portada linha por linha, para a
-- tela não mudar de número ao trocar de fonte.
-- ============================================================

-- ── Regra de "este treinamento conta para este colaborador?" ────
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
  from n;
$$;

comment on function public.training_matches_collaborator(text, text, text, boolean) is
  'Porta a função isTrained de CollaboratorsPage.tsx. Se mudar aqui, mude lá também — as duas precisam dar o mesmo resultado.';

-- ── A view ──────────────────────────────────────────────────────
-- security_invoker: a view não dá acesso a nada além do que o próprio
-- usuário já enxergaria nas tabelas — importante para quando as
-- políticas de isolamento por SOC entrarem em vigor.
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
  coalesce(t.is_trained, false)            as is_trained,
  coalesce(t.onboarding_modules, '{}'::text[]) as onboarding_modules
from public.collaborators c
left join lateral (
  select
    bool_or(
      public.training_matches_collaborator(tc.training_type, c.sector, c.role, c.is_onboarding)
    ) as is_trained,
    array_agg(upper(tc.training_type))
      filter (where tc.training_type ilike '%onboarding%') as onboarding_modules
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true;

grant select on public.collaborators_status to authenticated;
grant execute on function public.training_matches_collaborator(text, text, text, boolean) to authenticated;

-- Sustentam o lateral join e a ordenação por nome da tela.
create index if not exists idx_trainings_completed_collab_id on public.trainings_completed (collaborator_id);
create index if not exists idx_collaborators_name             on public.collaborators (name);

select
  '✅ View criada.' as status,
  (select count(*) from public.collaborators_status) as colaboradores,
  (select count(*) from public.collaborators_status where is_trained) as treinados;
