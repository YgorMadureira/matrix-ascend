-- ============================================================
-- SCRIPT SQL: CORRIGIR PERMISSÕES RLS DA TABELA users_profiles
-- ============================================================
-- Se o RLS estiver ativado na tabela users_profiles sem uma política
-- de leitura (SELECT), a aplicação não consegue ler o perfil do usuário
-- e a tela fica completamente em branco!
--
-- Execute no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/<seu-project-id>/sql/new
-- ============================================================

-- 1. Habilita o RLS na tabela
ALTER TABLE public.users_profiles ENABLE ROW LEVEL SECURITY;

-- 2. Remove políticas antigas que possam estar bloqueando
DROP POLICY IF EXISTS "Permitir leitura de perfis para autenticados" ON public.users_profiles;
DROP POLICY IF EXISTS "Permitir inserção de perfil proprio" ON public.users_profiles;
DROP POLICY IF EXISTS "Permitir atualização de perfil proprio" ON public.users_profiles;
DROP POLICY IF EXISTS "Permitir tudo para autenticados" ON public.users_profiles;

-- 3. Cria política para que TODOS os usuários autenticados possam LER os perfis
CREATE POLICY "Permitir leitura de perfis para autenticados"
  ON public.users_profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- 4. Cria política para que o próprio usuário possa INSERIR seu perfil
CREATE POLICY "Permitir inserção de perfil proprio"
  ON public.users_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 5. Cria política para que o próprio usuário possa ATUALIZAR seu perfil
CREATE POLICY "Permitir atualização de perfil proprio"
  ON public.users_profiles
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. Confirmação
RAISE NOTICE '✅ RLS da tabela users_profiles corrigido com sucesso!';
