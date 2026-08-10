-- ============================================================
-- SQL: CORREÇÃO DE LIMITE DE PERFIL (CONSTRAINT CHECK)
-- ============================================================
-- Durante a criação do banco de dados, foi colocada uma trava chamada 
-- "users_profiles_role_check" que só aceitava as palavras "admin" e "user",
-- e bloqueava completamente qualquer cargo novo como "lider".

-- 1. Removemos a trava (Check Constraint) da coluna role
ALTER TABLE public.users_profiles
DROP CONSTRAINT IF EXISTS users_profiles_role_check;

-- Pronto! Agora o termo "lider" será salvo com sucesso sem cuspir erro!
