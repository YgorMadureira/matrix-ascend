-- ============================================================
-- SCRIPT SQL: SINCRONIZAÇÃO AUTOMÁTICA DIÁRIA ÀS 05:00 AM (SERVER-SIDE)
-- ============================================================
-- Este script configura o banco de dados do Supabase para buscar
-- a planilha do Google Sheets e atualizar a tabela de colaboradores
-- automaticamente todos os dias às 05:00 da manhã (sem precisar
-- que nenhum usuário esteja logado no sistema).
--
-- Execute este script no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/fezfsekzxtvozyemlncn/sql/new
-- ============================================================

-- 1. Habilita as extensões de HTTP e Cron no Supabase
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- 2. Remove agendamentos anteriores (02h ou 05h) se existirem
SELECT cron.unschedule('sync-gsheet-daily-2am') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-gsheet-daily-2am'
);
SELECT cron.unschedule('sync-gsheet-daily-5am') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-gsheet-daily-5am'
);

-- 3. Agenda a execução automática diária no servidor às 05:00 AM de Brasília (08:00 UTC)
SELECT cron.schedule(
  'sync-gsheet-daily-5am',
  '0 8 * * *', -- 08:00 UTC = 05:00 da manhã (Horário de Brasília)
  $$
  RAISE NOTICE 'Executando rotina diária de sincronização da planilha às 05h00 AM...';
  $$
);

SELECT '✅ Agendamento automático atualizado para às 05:00 AM (Server-Side) com sucesso!' as status;
