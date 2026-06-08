-- ============================================================
-- SQL: AUTOMATIZAÇÃO DE PERFIS DE USUÁRIOS (TRIGGER)
-- ============================================================
-- Este script faz com que TUDO o que for criado na autenticação 
-- (Auth) seja espelhado de forma automática e à prova de falhas 
-- para a tabela de Perfis Públicos (users_profiles).

-- 1. Cria a função inteligente que fará o espelhamento
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insere o novo usuário na tabela public.users_profiles
  INSERT INTO public.users_profiles (id, email, full_name, role, soc)
  VALUES (
    NEW.id,
    NEW.email,
    -- Pega o Full Name dos metadados (que seu front-end envia) ou usa o email de fallback
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    -- Pega a permissão específica 'admin' / 'lider' dos metadados, ou cai no padrão 'user'
    COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
    -- Pega a unidade operacional ou cai no padrão 'SP6'
    COALESCE(NEW.raw_user_meta_data->>'soc', 'SP6')
  )
  -- Se o perfil por algum milagre já existir, ignora para não dar erro
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Nota: SECURITY DEFINER garante que o Gatilho (Trigger) sempre 
-- tem permissão máxima de administrador do banco para escrever.

-- 2. Limpa o gatilho caso ele já tenha existido antes (prevenção)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 3. Acopla o gatilho na criação oficial de usuários do Supabase
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Está pronto! Seu banco de dados agora trabalha sozinho!
-- Rode isso uma vez no SQL Editor. 
-- ============================================================
