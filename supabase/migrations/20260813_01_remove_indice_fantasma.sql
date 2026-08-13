-- ============================================================
-- Remove um índice único que nunca esteve em nenhuma migração nossa
-- ============================================================
-- Descoberto em 13/08/2026: a sincronização voltou "15 lote(s) não
-- gravaram". Reproduzindo o upsert manualmente, o erro real do Postgres
-- apontou para "unique_collaborator_idx" — um índice sobre
-- (nome normalizado, soc normalizada, data de admissão) que não existe
-- em nenhum arquivo deste repositório. Foi criado por fora, provavelmente
-- direto no painel do Supabase, antes de qualquer uma das migrações desta
-- série.
--
-- O problema: nosso upsert usa `ON CONFLICT (name, soc)`, mirando
-- idx_collaborators_name_soc_unique — o índice de identidade que
-- escolhemos DE PROPÓSITO depois do incidente de 11/08 (ver comentário
-- em supabase/functions/sync-collaborators/index.ts). O Postgres só
-- resolve automaticamente o conflito no índice indicado no ON CONFLICT;
-- um conflito em QUALQUER OUTRO índice único vira erro duro e aborta o
-- lote inteiro. Bastava um colaborador já cadastrado ter o nome grafado
-- com um espaço ou acento diferente do que está na planilha — mesma
-- pessoa, mesma unidade, mesma data de admissão — para o lote inteiro
-- falhar.
--
-- A trava de segurança escrita depois do incidente funcionou: como algum
-- lote falhou, a remoção foi cancelada por completo. Ninguém foi
-- removido. Mas 15 dos 78 lotes não atualizaram ninguém.
--
-- Por que remover em vez de ajustar o ON CONFLICT: a identidade do
-- colaborador é (nome, SOC) — decisão já tomada e documentada. Incluir
-- data de admissão na identidade está errado por definição: uma correção
-- de data, ou um re-admissão, não deveria criar "outra pessoa". Este
-- índice também não é usado por nenhuma consulta do sistema — é só uma
-- restrição de escrita que competia com a que já escolhemos.
-- ============================================================

drop index if exists public.unique_collaborator_idx;

select
  '✅ Índice fantasma removido. Rode a sincronização de novo — os 15 lotes que falharam devem gravar normalmente agora.' as status,
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'unique_collaborator_idx'
  ) as ainda_existe;
