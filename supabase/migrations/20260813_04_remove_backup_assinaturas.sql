-- ============================================================
-- Remove a tabela de backup das assinaturas de 05/08
-- ============================================================
-- Criada manualmente antes de apagar os registros de trainings_completed
-- com completed_at = '05/08/2026 21:00'. Confirmado com o Ygor em
-- 13/08/2026 que já não é mais necessária.
-- ============================================================

drop table if exists public.backup_assinaturas_05_08;

select '✅ Tabela de backup removida.' as status;
