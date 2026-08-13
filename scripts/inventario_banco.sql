-- ============================================================
-- INVENTÁRIO COMPLETO DO BANCO
-- ============================================================
-- Objetivo: mapear TUDO que existe no banco — inclusive o que foi criado
-- por fora das nossas migrações (foi assim que apareceu o
-- unique_collaborator_idx em 13/08, um índice que nunca esteve em
-- nenhum arquivo deste repositório e quebrou a sincronização).
--
-- Este arquivo não visualiza nem altera dado nenhum de colaborador,
-- assinatura ou usuário — só olha para a ESTRUTURA do banco (schema).
--
-- COMO RODAR: são 5 blocos independentes. Rode CADA UM separadamente
-- (selecione o texto do bloco, sozinho, e clique Run) — se rodar o
-- arquivo inteiro de uma vez, o SQL Editor só mostra o resultado do
-- último. Depois de cada bloco, clique em "Download CSV" no resultado
-- (ou copie a tabela) e me envie os 5 arquivos/textos.
-- ============================================================


-- ── BLOCO A — Índices, constraints (PK/FK/UNIQUE/CHECK) e triggers ──
-- Este é o bloco que teria revelado o índice fantasma antes de ele
-- quebrar a sincronização.
select 'INDICE' as tipo, indexname as nome, tablename as tabela, indexdef as definicao
from pg_indexes
where schemaname = 'public'

union all

select 'CONSTRAINT', conname, conrelid::regclass::text, pg_get_constraintdef(oid)
from pg_constraint
where connamespace = 'public'::regnamespace

union all

select 'TRIGGER', tgname, tgrelid::regclass::text, pg_get_triggerdef(oid)
from pg_trigger
where not tgisinternal
  and tgrelid::regnamespace::text = 'public'

order by 1, 3, 2;


-- ── BLOCO B — Funções e views ────────────────────────────────────
-- security_type = DEFINER merece atenção: roda com privilégio do dono,
-- não de quem chama. É assim que as funções deste projeto (is_master,
-- current_user_soc etc.) conseguem ler tabelas protegidas por RLS.
select
  'FUNCAO' as tipo,
  p.proname as nome,
  case when p.prosecdef then 'SECURITY DEFINER' else 'security invoker' end as security_type,
  pg_get_functiondef(p.oid) as definicao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'

union all

select 'VIEW', table_name, null, view_definition
from information_schema.views
where table_schema = 'public'

order by 1, 2;


-- ── BLOCO C — Políticas de RLS + se RLS está ligado por tabela ────
-- Toda tabela sem nenhuma linha de RLS_ENABLED = 'ATIVO' está com
-- Row Level Security DESLIGADO — qualquer authenticated lê e escreve
-- sem restrição nenhuma nela, independente de política escrita.
select
  'POLITICA' as tipo,
  policyname as nome,
  tablename as tabela,
  'roles=' || array_to_string(roles, ',')
    || ' | comando=' || cmd
    || ' | using=' || coalesce(qual, '—')
    || ' | with_check=' || coalesce(with_check, '—') as definicao
from pg_policies
where schemaname = 'public'

union all

select
  'RLS_ENABLED',
  relname,
  null,
  case when relrowsecurity then 'ATIVO' else 'DESLIGADO ⚠' end
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'

order by 1, 2;


-- ── BLOCO D — Agendamentos (pg_cron) ──────────────────────────────
-- Deve aparecer só 1 linha: sync-gsheet-daily-5am, schedule '0 8 * * *'.
-- Qualquer outra linha aqui é um agendamento que ninguém documentou.
select jobid, jobname, schedule, active, command
from cron.job
order by jobname;


-- ── BLOCO E — Segredos guardados no Vault (só o NOME, nunca o valor) ──
-- Confirma que 'project_url' e 'service_role_key' existem — sem eles o
-- cron do bloco D não consegue chamar a Edge Function.
select id, name, description, created_at, updated_at
from vault.secrets
order by name;
