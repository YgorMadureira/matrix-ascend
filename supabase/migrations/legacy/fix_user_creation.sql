-- ============================================================
-- SQL: CORREÇÃO COMPLETA DE CRIAÇÃO DE USUÁRIOS E PERFIS
-- ============================================================
-- Rode este script completo no Supabase SQL Editor:
-- https://supabase.com/dashboard/project/fezfsekzxtvozyemlncn/sql/new
-- ============================================================

-- 1. REMOVER CONSTRAINTS ANTIGAS QUE BLOQUEIAM ROLES NOVOS
-- (só aceitavam 'admin' e 'user', bloqueavam 'lider' e 'bpo')
ALTER TABLE public.users_profiles
  DROP CONSTRAINT IF EXISTS users_profiles_role_check;

-- Garante que a coluna role aceita todos os valores necessários
-- sem constraint rígida (a validação fica no frontend)
-- Se quiser manter validação no banco, use:
-- ALTER TABLE public.users_profiles 
--   ADD CONSTRAINT users_profiles_role_check 
--   CHECK (role IN ('admin', 'user', 'lider', 'bpo'));

-- 2. RECRIAR O TRIGGER DE AUTO-PERFIL (lê role e full_name do metadata)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    -- Lê full_name do metadata enviado pelo frontend, fallback = email
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    -- Lê role do metadata (admin, user, lider, bpo), fallback = 'user'
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Se o perfil já existe (criado pelo upsert do frontend), atualiza o role
    role = COALESCE(NEW.raw_user_meta_data->>'role', public.users_profiles.role),
    full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', public.users_profiles.full_name);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RECRIAR O TRIGGER ACOPLADO NO AUTH
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. VERIFICAR USUÁRIOS NO AUTH QUE NÃO TÊM PERFIL NA TABELA
-- (Útil para diagnosticar usuários criados antes do trigger existir)
-- Esta query mostra os auth users SEM perfil correspondente:
SELECT 
  au.id,
  au.email,
  au.created_at,
  au.raw_user_meta_data->>'role' as meta_role
FROM auth.users au
LEFT JOIN public.users_profiles up ON au.id = up.id
WHERE up.id IS NULL;

-- 5. SINCRONIZAR USUÁRIOS ÓRFÃOS (auth sem perfil)
-- Se a query acima retornar linhas, rode este INSERT para corrigir:
INSERT INTO public.users_profiles (id, email, full_name, role)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
  COALESCE(au.raw_user_meta_data->>'role', 'user')
FROM auth.users au
LEFT JOIN public.users_profiles up ON au.id = up.id
WHERE up.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- RESULTADO: 
-- ✅ Trigger recriado (lê role do metadata corretamente)
-- ✅ Constraint antiga removida (aceita bpo, lider, admin, user)
-- ✅ Usuários órfãos sincronizados
-- ✅ Novos usuários criados via Admin API terão login imediato
-- ============================================================
