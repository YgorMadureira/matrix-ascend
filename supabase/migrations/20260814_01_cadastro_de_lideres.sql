-- ============================================================
-- Cadastro de líderes e vínculo com o time
-- ============================================================
-- Situação até 14/08/2026: "líder" não era um cadastro, era um texto
-- digitado na coluna collaborators.leader. Havia 659 valores distintos —
-- 411 e-mails e 248 nomes soltos, sem padrão — e apenas 22 deles tinham
-- qualquer registro correspondente no sistema. A aba "Líderes" da tela de
-- Colaboradores filtrava por cargo ("contém LÍDER/GERENTE/..."), e como só
-- 2 pessoas na base inteira tinham esse cargo, a aba aparecia vazia em
-- todas as unidades.
--
-- O que muda aqui:
--   · collaborators.email     — o e-mail do líder, que é a chave do vínculo
--                               (411 dos 659 valores de leader já são e-mail)
--   · collaborators.is_leader — marca quem é líder, no lugar de adivinhar
--                               pelo texto do cargo
--   · collaborators.leader_id — o vínculo RESOLVIDO: aponta para a linha do
--                               líder. A coluna `leader` continua existindo
--                               e recebendo o texto livre da planilha do RH;
--                               leader_id é a leitura confiável dele.
--
-- Líderes ficam na MESMA tabela dos colaboradores de propósito: assim eles
-- herdam sem nenhum trabalho extra a assinatura por QR Code, o status de
-- treinado (collaborators_status.is_trained) e a regra unificada de
-- 13/08 — em vez de precisarem de uma segunda cópia de tudo isso.
--
-- Decisão do time de operações (14/08/2026): líderes CONTAM no mesmo
-- percentual dos colaboradores — é um número só. Como quase nenhum líder
-- tem assinatura hoje, espere os percentuais das unidades caírem conforme
-- os líderes forem cadastrados.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

-- ── 1. Colunas novas ─────────────────────────────────────────
alter table public.collaborators add column if not exists email     text;
alter table public.collaborators add column if not exists is_leader boolean not null default false;
alter table public.collaborators add column if not exists leader_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'collaborators_leader_id_fkey' and conrelid = 'public.collaborators'::regclass
  ) then
    alter table public.collaborators
      add constraint collaborators_leader_id_fkey
      foreign key (leader_id) references public.collaborators(id) on delete set null;
  end if;
end $$;

comment on column public.collaborators.email     is 'E-mail corporativo. Nos líderes é a chave que liga ao time (casa com collaborators.leader dos liderados).';
comment on column public.collaborators.is_leader is 'Marca líderes/instrutores. Substitui a adivinhação pelo texto do cargo.';
comment on column public.collaborators.leader_id is 'Vínculo resolvido com a linha do líder. Preenchido por resolve_leader_links(); a coluna `leader` guarda o texto original da planilha.';

create index if not exists idx_collaborators_email     on public.collaborators (lower(email));
create index if not exists idx_collaborators_leader_id on public.collaborators (leader_id);
create index if not exists idx_collaborators_is_leader on public.collaborators (is_leader) where is_leader;

-- ── 2. Normalizador de nome ──────────────────────────────────
-- Sem depender da extensão unaccent (que pode não estar habilitada):
-- tira acento, caixa e espaço duplicado. Espelha normalizeText() de
-- src/lib/trainingRules.ts para nomes de pessoa.
create or replace function public.normalize_person_name(p_name text)
returns text
language sql
immutable
as $$
  select upper(trim(regexp_replace(
    translate(
      coalesce(p_name, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
    ),
    '\s+', ' ', 'g'
  )));
$$;

-- ── 3. Resolvedor do vínculo líder → time ────────────────────
-- Casa o texto livre de collaborators.leader com a linha de um líder:
--   1º por e-mail (cobre os 411 valores que já são e-mail)
--   2º por nome normalizado (cobre os 248 que são nome solto)
-- Só grava quando o casamento é ÚNICO: dois líderes com o mesmo nome
-- normalizado deixam o vínculo em branco em vez de apontar para o errado —
-- mesmo princípio de revincular_orfas.mjs, que não religa homônimo.
create or replace function public.resolve_leader_links()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with candidatos as (
    select
      c.id                as collab_id,
      min(l.id::text)::uuid as leader_id,
      count(*)            as n
    from public.collaborators c
    join public.collaborators l
      on l.is_leader
     and l.id <> c.id
     and (
       (coalesce(l.email, '') <> '' and lower(trim(c.leader)) = lower(trim(l.email)))
       or public.normalize_person_name(c.leader) = public.normalize_person_name(l.name)
     )
    where coalesce(trim(c.leader), '') <> ''
      and upper(trim(c.leader)) not in ('-', 'N/A', 'NA')
    group by c.id
  )
  update public.collaborators c
  set leader_id = cand.leader_id
  from candidatos cand
  where c.id = cand.collab_id
    and cand.n = 1
    and c.leader_id is distinct from cand.leader_id;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.resolve_leader_links() is
  'Preenche collaborators.leader_id a partir do texto livre em collaborators.leader. Rode depois de importar líderes ou de sincronizar a planilha do RH.';

grant execute on function public.resolve_leader_links() to authenticated;
grant execute on function public.normalize_person_name(text) to authenticated;

-- ── 4. A view ganha as colunas novas ─────────────────────────
-- A regra de is_trained continua a de 20260813_07 — líderes são avaliados
-- exatamente como qualquer colaborador, pelo setor deles.
--
-- ⚠️ As três colunas novas entram NO FIM da lista, depois de is_trained e
-- onboarding_modules. Não é estética: `create or replace view` só aceita
-- ACRESCENTAR colunas no final. Colocá-las no meio faz o Postgres entender
-- que você está renomeando as colunas seguintes e ele recusa com
-- "42P16: cannot change name of view column". A ordem não importa para a
-- aplicação, que seleciona sempre pelo nome.
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

-- ── Conferência ──────────────────────────────────────────────
select
  '✅ Cadastro de líderes pronto.' as status,
  (select count(*) from public.collaborators where is_leader)              as lideres_cadastrados,
  (select count(*) from public.collaborators where leader_id is not null)  as liderados_vinculados,
  (select count(distinct leader) from public.collaborators
     where coalesce(trim(leader), '') <> '' and leader_id is null)         as lideres_ainda_sem_cadastro;
