-- ============================================================
-- CORREÇÃO do incidente de 11/08/2026 (perda de colaboradores)
-- ============================================================
-- Rode este arquivo ANTES de publicar a nova versão da Edge Function.
--
-- O que deu errado, em ordem:
--   1. A migração 20260811_02 criou um índice único PARCIAL em opsid.
--      O Postgres NÃO aceita índice parcial como alvo de ON CONFLICT
--      (erro 42P10), então TODO lote com onConflict='opsid' falhava.
--   2. A planilha tem opsids repetidos de verdade — o valor "0" sozinho
--      aparece 88 vezes — então nem um índice único total funcionaria.
--   3. A planilha também tem 68 pares (nome, SOC) repetidos, o que fazia
--      lotes inteiros falharem com o erro 21000.
--   4. A função montava a lista de "quem está na planilha" a partir das
--      linhas que o upsert conseguiu gravar. Como quase nada gravou,
--      quase todo mundo virou "não está na planilha" e foi removido.
--
-- Correções: o índice de opsid sai (abaixo); a deduplicação e a lógica
-- de remoção foram corrigidas na Edge Function.
-- ============================================================

-- 1. Remove o índice único de opsid.
-- O dado de origem não garante opsid único, e ele nunca funcionou como
-- alvo de ON CONFLICT por ser parcial. A identidade do colaborador passa
-- a ser exclusivamente (name, soc), que é total e realmente única.
drop index if exists public.idx_collaborators_opsid_unique;

-- Índice comum (não único) — mantém a busca por opsid rápida sem impor
-- uma unicidade que a planilha não respeita.
create index if not exists idx_collaborators_opsid on public.collaborators (opsid);

-- 2. Confirma que (name, soc) continua único — é a chave do upsert.
create unique index if not exists idx_collaborators_name_soc_unique
  on public.collaborators (name, soc);

-- 3. Libera a trava de emergência acionada durante o incidente.
-- ⚠️ Só rode esta linha DEPOIS de publicar a Edge Function corrigida.
--    Enquanto a trava estiver ativa, nenhuma sincronização roda — nem o
--    cron das 05h, nem o botão manual.
-- update public.sync_locks set locked = false, locked_at = null, started_by = null
--   where id = 'gsheet_collaborators';

select '✅ Índice de opsid corrigido. Publique a Edge Function e só então libere a trava (linha comentada acima).' as status;
