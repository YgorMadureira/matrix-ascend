-- ============================================================
-- SQL: ADICIONAR CAMPO soc EM users_profiles
-- ============================================================
-- Adiciona o campo soc para filtrar a visualização de todas
-- as telas da aplicação, atrelando os usuários atuais a 'SP6'.

-- 1. Adicionar a coluna soc
ALTER TABLE public.users_profiles
  ADD COLUMN IF NOT EXISTS soc TEXT DEFAULT NULL;

-- 2. Atualizar todos os usuários existentes para SP6
UPDATE public.users_profiles
SET soc = 'SP6'
WHERE soc IS NULL;

-- ============================================================
-- PRONTO! Rode no SQL Editor do Supabase.
-- ============================================================
