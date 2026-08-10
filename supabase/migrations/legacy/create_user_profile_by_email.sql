-- ============================================================
-- SCRIPT SQL: ATRIBUIR SOC E PERFIL A UM USUÁRIO DO AUTH
-- ============================================================
-- 1. Crie o usuário no painel do Supabase:
--    Dashboard -> Authentication -> Users -> Add User (Create User)
--
-- 2. Execute esta query no SQL Editor do Supabase preenchendo os dados:
-- ============================================================

-- Garante que as colunas necessárias existam
ALTER TABLE public.users_profiles
  ADD COLUMN IF NOT EXISTS soc TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS leader_key TEXT DEFAULT NULL;

DO $$
DECLARE
  -- ✏️ EDITE APENAS ESTES CAMPOS CONFORME O USUÁRIO CRIADO NO AUTH:
  v_email         TEXT := 'email.do.usuario@shopee.com'; -- ← Email usado ao criar no Auth
  v_full_name     TEXT := 'Nome Completo do Usuário';   -- ← Nome completo
  v_role          TEXT := 'admin';                      -- ← 'admin', 'lider', 'user', 'bpo', 'pcp'
  v_soc           TEXT := 'PE2';                        -- ← SOC do usuário (ex: 'PE2', 'SP8', 'SP6')
  v_leader_key    TEXT := '';                           -- ← Opcional (se for 'lider')

  v_user_id       UUID;
BEGIN

  -- 1. Localiza o ID do usuário criado no Auth pelo e-mail
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '❌ Usuário com e-mail "%" não foi encontrado no Auth! Crie o usuário primeiro no painel Authentication > Users.', v_email;
  END IF;

  -- 2. Insere ou atualiza o perfil na tabela pública (public.users_profiles)
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

  -- 3. Atualiza os metadados no Auth para ficar 100% sincronizado
  UPDATE auth.users
  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'full_name', v_full_name,
    'role',      v_role,
    'soc',       v_soc
  )
  WHERE id = v_user_id;

  RAISE NOTICE '✅ Perfil do usuário % configurado com sucesso no SOC % com a função %!', v_email, v_soc, v_role;
END $$;
