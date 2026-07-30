-- ============================================================
-- SCRIPT SQL 1: RESETAR SENHA DIRETO NO BANCO DE DADOS
-- ============================================================
-- Execute no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/fezfsekzxtvozyemlncn/sql/new
-- ============================================================

-- 1. Garante que a extensão de criptografia (pgcrypto) existe
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  -- ✏️ DIGITE O EMAIL E A NOVA SENHA DESEJADA:
  v_email    TEXT := 'teste.pe2@shopee.com'; -- ← Email do usuário que quer alterar a senha
  v_new_pass TEXT := 'Senha123@';            -- ← Nova senha que ele usará para entrar

BEGIN
  -- Atualiza a senha criptografada no auth.users
  UPDATE auth.users
  SET 
    encrypted_password = extensions.crypt(v_new_pass, extensions.gen_salt('bf', 10)),
    updated_at = NOW(),
    raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"provider": "email", "providers": ["email"]}'::jsonb,
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) - 'must_change_password'
  WHERE email = v_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION '❌ Usuário com e-mail "%" não foi encontrado na tabela auth.users!', v_email;
  END IF;

  RAISE NOTICE '✅ Senha do usuário "%" atualizada com sucesso para "%"!', v_email, v_new_pass;
END $$;
