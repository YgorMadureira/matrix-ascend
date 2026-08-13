-- ============================================================
-- Remove a tabela "units" — resto de protótipo, nunca usada
-- ============================================================
-- Apareceu no inventário completo de 13/08: 3 colunas (id, name,
-- created_at), zero linhas, zero referência em qualquer arquivo do
-- projeto (grep em src/, supabase/, scripts/ não encontra "units" em
-- lugar nenhum do código). A tabela "socs" é quem faz esse papel hoje —
-- "units" parece ter sido uma tentativa anterior, abandonada antes de
-- qualquer dado entrar nela.
-- ============================================================

drop table if exists public.units;

select '✅ Tabela units removida.' as status;
