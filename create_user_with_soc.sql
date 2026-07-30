-- ============================================================
-- SCRIPT SQL: CRIAR/ATUALIZAR USUÁRIO COMPLETO COM SOC DIRETO NO BANCO
-- ============================================================
-- Execute no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/<seu-project-id>/sql/new
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Garante que as colunas necessárias existam na tabela pública
ALTER TABLE public.users_profiles
  ADD COLUMN IF NOT EXISTS soc TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS leader_key TEXT DEFAULT NULL;

DO $$
DECLARE
  -- ✏️ EDITE OS VALORES DO NOVO USUÁRIO ABAIXO:
  v_email         TEXT := 'teste.pe2@shopee.com';   -- E-mail para fazer login
  v_password      TEXT := 'Senha123@';              -- Senha de login
  v_full_name     TEXT := 'Teste PE2';              -- Nome completo
  v_role          TEXT := 'admin';                   -- Permissão: 'admin' | 'lider' | 'user' | 'bpo' | 'pcp'
  v_soc           TEXT := 'PE2';                     -- SOC: 'PE2', 'SP6', etc.
  v_leader_key    TEXT := '';                        -- Opcional (se role for 'lider')

  v_user_id       UUID;
  v_encrypted_pwd TEXT;
BEGIN

  -- 1. Criptografa a senha
  v_encrypted_pwd := extensions.crypt(v_password, extensions.gen_salt('bf', 10));

  -- 2. Verifica se o e-mail já existe em auth.users
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    -- Insere o novo usuário em auth.users
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted_pwd,
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('full_name', v_full_name, 'role', v_role, 'soc', v_soc),
      NOW(),
      NOW()
    );

    -- Insere a identidade de e-mail em auth.identities (para permitir login por email/senha)
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_user_id,
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email',
      NOW(), NOW(), NOW()
    );
  ELSE
    -- Se o usuário já existia, atualiza a senha e os metadados
    UPDATE auth.users
    SET 
      encrypted_password = v_encrypted_pwd,
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', v_full_name, 'role', v_role, 'soc', v_soc),
      updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  -- 3. Insere ou atualiza na tabela public.users_profiles
  INSERT INTO public.users_profiles (id, email, full_name, role, soc, leader_key)
  VALUES (
    v_user_id,
    v_email,
    v_full_name,
    v_role,
    v_soc,
    NULLIF(v_leader_key, '')
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    soc        = EXCLUDED.soc,
    leader_key = EXCLUDED.leader_key;

  RAISE NOTICE '✅ Usuário % cadastrado/atualizado com sucesso no SOC %! Login pronto com a senha: %', v_email, v_soc, v_password;
END $$;
