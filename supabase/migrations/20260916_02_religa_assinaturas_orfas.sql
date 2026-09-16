-- ============================================================
-- Religação automática de assinaturas órfãs + vínculo de líderes sem timeout
-- ============================================================
-- ── 1. O PROBLEMA DAS ASSINATURAS ÓRFÃS (16/09/2026) ────────
-- Quando a sincronização com o Sheets remove alguém que sumiu da planilha
-- — mesmo que por um dia só, por uma aba sem acesso ou uma fonte quebrada —
-- a FK de trainings_completed (ON DELETE SET NULL) deixa as assinaturas da
-- pessoa soltas. Quando ela volta à planilha, é recriada com um id NOVO,
-- sem nenhuma assinatura vinculada, e passa a aparecer como PENDENTE.
--
-- Em 16/09/2026: das 2.032 pessoas inseridas pela sincronização do dia,
-- 385 já tinham existido antes, com 645 assinaturas soltas (RJ2 172
-- pessoas, SP6 77, SP7 38...). No banco inteiro havia 11.088 assinaturas
-- órfãs — parte de quem saiu de verdade, parte recuperável.
--
-- relink_orphan_trainings() é a ÚNICA implementação da religação. Quem
-- chama:
--   · supabase/functions/sync-collaborators — ao final de TODA sincronização
--     (automática e manual), para desfazer na hora qualquer remoção
--     indevida que tenha acontecido no meio do caminho;
--   · scripts/revincular_orfas.mjs — manualmente, com simulação.
--
-- ── REGRAS (conservadoras: religar a pessoa errada é pior do que deixar
--    a assinatura solta) ──────────────────────────────────────
-- A assinatura guarda uma cópia do nome, SOC e opsid de quem assinou
-- (colunas de snapshot, 20260812_02). O casamento usa essa cópia:
--   · com SOC gravada → nome normalizado (sem acento, espaços unidos,
--     maiúsculo) + SOC. Só religa se identifica EXATAMENTE UMA pessoa.
--   · sem SOC gravada → só religa se o nome normalizado for único na base
--     INTEIRA (um homônimo em outra unidade viraria erro de dado).
--   · trava de matrícula: se a assinatura e o colaborador encontrado têm
--     opsid válido (4+ dígitos, não só zeros) e os dígitos NÃO batem, é
--     outra pessoa com o mesmo nome — não religa.
-- Não há fallback para outra SOC: quem foi recriado em outra unidade fica
-- órfão, de propósito — não dá para distinguir de um homônimo.
--
-- ── 2. resolve_leader_links() ESTOURAVA O TEMPO ─────────────
-- A função original casava liderado × líder com um JOIN cuja condição era
-- "e-mail bate OU nome normalizado bate". Um OR na condição de junção
-- impede o Postgres de usar hash join: ele comparava cada um dos ~24 mil
-- colaboradores com cada líder, recalculando a normalização do nome a cada
-- comparação — milhões de chamadas de regexp. Resultado: "canceling
-- statement due to statement timeout" em toda chamada pela API, inclusive
-- a da sincronização. Era esse timeout que aparecia no resumo como
-- "1 lote(s) com erro" — e o vínculo líder → time nunca era atualizado.
--
-- A versão nova calcula cada normalização UMA vez e troca o OR por duas
-- junções de igualdade unidas por UNION. Mesmo resultado, linha por linha:
-- UNION deduplica o par (liderado, líder) exatamente como o OR fazia quando
-- e-mail e nome batiam no mesmo líder, então a contagem "casou com
-- exatamente um líder" continua idêntica.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

-- ── 1. Religação de assinaturas órfãs ────────────────────────
create or replace function public.relink_orphan_trainings(p_aplicar boolean default false)
returns table (
  training_id          text,
  nome                 text,
  soc                  text,
  training_type        text,
  novo_collaborator_id uuid,
  situacao             text
)
language sql
as $$
  with
  pessoas as (
    select
      c.id,
      public.normalize_person_name(c.name)                               as nome_norm,
      upper(trim(coalesce(c.soc, '')))                                   as soc_norm,
      nullif(regexp_replace(coalesce(c.opsid, ''), '\D', '', 'g'), '')   as opsid_dig
    from public.collaborators c
    where coalesce(trim(c.name), '') <> ''
  ),
  por_nome_soc as (
    select nome_norm, soc_norm, count(*) as n,
           min(id::text)::uuid as id, min(opsid_dig) as opsid_dig
    from pessoas
    group by nome_norm, soc_norm
  ),
  por_nome as (
    select nome_norm, count(*) as n,
           min(id::text)::uuid as id, min(opsid_dig) as opsid_dig
    from pessoas
    group by nome_norm
  ),
  orfas as (
    select
      tc.id                                                                         as tc_id,
      tc.collaborator_name                                                          as nome,
      nullif(upper(trim(coalesce(tc.collaborator_soc, ''))), '')                    as soc_norm,
      tc.training_type,
      public.normalize_person_name(tc.collaborator_name)                            as nome_norm,
      nullif(regexp_replace(coalesce(tc.collaborator_opsid, ''), '\D', '', 'g'), '') as opsid_dig
    from public.trainings_completed tc
    where tc.collaborator_id is null
      and coalesce(trim(tc.collaborator_name), '') <> ''
  ),
  candidatos as (
    select
      o.tc_id, o.nome, o.soc_norm, o.training_type, o.opsid_dig,
      case when o.soc_norm is not null then pns.n         else pn.n         end as n,
      case when o.soc_norm is not null then pns.id        else pn.id        end as alvo_id,
      case when o.soc_norm is not null then pns.opsid_dig else pn.opsid_dig end as alvo_opsid
    from orfas o
    left join por_nome_soc pns
      on o.soc_norm is not null
     and pns.nome_norm = o.nome_norm
     and pns.soc_norm  = o.soc_norm
    left join por_nome pn
      on o.soc_norm is null
     and pn.nome_norm = o.nome_norm
  ),
  classificadas as (
    select
      tc_id, nome, soc_norm, training_type,
      case when n = 1 then alvo_id end as novo_collaborator_id,
      case
        when n is null then 'sem_par'
        when n > 1     then 'ambiguo'
        when opsid_dig is not null and length(opsid_dig) >= 4 and opsid_dig !~ '^0+$'
         and alvo_opsid is not null and length(alvo_opsid) >= 4 and alvo_opsid !~ '^0+$'
         and opsid_dig <> alvo_opsid
                       then 'opsid_diverge'
        else                'religavel'
      end as situacao
    from candidatos
  ),
  -- CTE que grava: sempre executa até o fim, mesmo sem ser referenciada.
  -- O "collaborator_id is null" repetido aqui protege contra corrida com
  -- outra execução simultânea: nunca sobrescreve um vínculo que já exista.
  aplicadas as (
    update public.trainings_completed tc
    set collaborator_id = cl.novo_collaborator_id
    from classificadas cl
    where p_aplicar
      and cl.situacao = 'religavel'
      and tc.id = cl.tc_id
      and tc.collaborator_id is null
    returning tc.id
  )
  select tc_id::text, nome, soc_norm, training_type, novo_collaborator_id, situacao
  from classificadas;
$$;

comment on function public.relink_orphan_trainings(boolean) is
  'Religa assinaturas órfãs (collaborator_id NULL) ao colaborador atual, pelo snapshot de nome/SOC/opsid. p_aplicar=false só classifica; true grava. Chamada ao final de toda sincronização (sync-collaborators) e por scripts/revincular_orfas.mjs. Única implementação da regra — ver 20260916_02.';

-- Só a service_role (Edge Function e scripts) chama. Religar assinatura não
-- é ação de usuário da tela.
revoke all on function public.relink_orphan_trainings(boolean) from public, anon, authenticated;
grant execute on function public.relink_orphan_trainings(boolean) to service_role;

-- ── 2. Vínculo de líderes, sem OR na junção ──────────────────
create or replace function public.resolve_leader_links()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with
  lideres as (
    select id,
           lower(trim(email))                 as email_norm,
           public.normalize_person_name(name) as nome_norm
    from public.collaborators
    where is_leader
  ),
  liderados as (
    select id,
           lower(trim(leader))                  as leader_email_norm,
           public.normalize_person_name(leader) as leader_nome_norm
    from public.collaborators
    where coalesce(trim(leader), '') <> ''
      and upper(trim(leader)) not in ('-', 'N/A', 'NA')
  ),
  pares as (
    select c.id as collab_id, l.id as lider_id
    from liderados c
    join lideres l
      on l.email_norm <> ''
     and l.email_norm = c.leader_email_norm
     and l.id <> c.id
    union
    select c.id, l.id
    from liderados c
    join lideres l
      on l.nome_norm = c.leader_nome_norm
     and l.id <> c.id
  ),
  candidatos as (
    select collab_id, min(lider_id::text)::uuid as leader_id, count(*) as n
    from pares
    group by collab_id
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
  'Preenche collaborators.leader_id a partir do texto livre em collaborators.leader (1º e-mail, 2º nome normalizado; só grava se casar com exatamente um líder). Reescrita em 16/09/2026 sem OR na junção — a versão anterior estourava o statement timeout. Rode depois de importar líderes ou de sincronizar a planilha do RH.';

-- ── Conferência (só classifica, NÃO grava) ───────────────────
select situacao, count(*) as assinaturas
from public.relink_orphan_trainings(false)
group by situacao
order by assinaturas desc;
