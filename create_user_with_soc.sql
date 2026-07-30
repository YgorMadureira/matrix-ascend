-- ============================================================
-- SCRIPT SQL: CADASTRAR PERFIL DE USUÁRIO JÁ EXISTENTE NO AUTH
-- ============================================================
-- Use este script quando o usuário já foi criado via Supabase Auth
-- (Authentication > Users > Add User) e precisa de um perfil na
-- tabela public.users_profiles com o SOC correto.
--
-- Execute no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/fezfsekzxtvozyemlncn/sql/new
-- ============================================================

DO $$
DECLARE
  -- ✏️ EDITE OS VALORES ABAIXO:
  v_email         TEXT := 'novo.usuario@shopee.com'; -- Email usado para criar o usuário no Auth
  v_full_name     TEXT := 'Nome Completo do Usuário';-- Nome completo
  v_role          TEXT := 'lider';                    -- Permissão: 'admin', 'lider', 'bpo' ou 'user'
  v_soc           TEXT := 'SP6';                      -- SOC do usuário (ex: 'SP6', 'SP7', 'SP1', etc.)
  v_leader_key    TEXT := '';                         -- (Opcional) nome do líder para vincular o time

  -- Variável interna
  v_user_id       UUID;
BEGIN

  -- 1. Busca o ID do usuário criado no Auth pelo e-mail
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '❌ Usuário com e-mail "%" não encontrado no Auth. Verifique se ele foi criado corretamente.', v_email;
  END IF;

  -- 2. Insere ou atualiza o perfil na tabela pública
  INSERT INTO public.users_profiles (
    id,
    email,
    full_name,
    role,
    soc,
    leader_key
  ) VALUES (
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

  RAISE NOTICE '✅ Perfil do usuário "%" criado/atualizado com sucesso no SOC "%"! (ID: %)', v_email, v_soc, v_user_id;

END $$;

-- ============================================================
-- CONSULTA DE VERIFICAÇÃO (rode após para confirmar):
-- ============================================================
-- SELECT id, email, full_name, role, soc, leader_key
-- FROM public.users_profiles
-- WHERE email = 'novo.usuario@shopee.com';
