-- ============================================================
-- SQL: ATUALIZAR PERFIL PARA BPO
-- ============================================================
-- Substitua 'email_do_bpo@shopee.com' pelo email correto do 
-- usuário que deverá ter o acesso restrito.

UPDATE users_profiles 
SET role = 'bpo' 
WHERE email = 'email_do_bpo@shopee.com';

-- Caso haja alguma restrição no banco impedindo a palavra 'bpo', 
-- execute esta linha abaixo ANTES do UPDATE acima para remover a trava:
-- ALTER TABLE users_profiles DROP CONSTRAINT IF EXISTS users_profiles_role_check;
