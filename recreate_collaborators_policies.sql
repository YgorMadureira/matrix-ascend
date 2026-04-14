-- ============================================================
-- SQL: RECRIAÇÃO LIMPA E SEGURA DAS POLÍTICAS DE COLABORADORES
-- ============================================================
-- Como as políticas gerais foram apagadas, a tabela de colaboradores
-- ficou em modo "Block-All" (Bloqueio Total) padrão do Postgres,
-- o que faz sumir todo mundo da tela e não deixa criar ninguém!

-- 1. Garante que o RLS (Segurança a Nível de Linha) está ativado
ALTER TABLE collaborators ENABLE ROW LEVEL SECURITY;

-- 2. Limpa resquícios caso tenha tentado recriar
DROP POLICY IF EXISTS "Permitir Leitura (Collaborators)" ON collaborators;
DROP POLICY IF EXISTS "Permitir Escrita (Collaborators)" ON collaborators;
DROP POLICY IF EXISTS "Public access for collaborators" ON collaborators;
DROP POLICY IF EXISTS "Enable read access for all users" ON collaborators;

-- 3. CRIAÇÃO DAS POLÍTICAS OFICIAIS PARA COLABORADORES
-- 3.1. Todos que abriram a página podem LISTAR os Colaboradores
CREATE POLICY "Permitir Leitura (Collaborators)" 
ON collaborators FOR SELECT 
USING (true);

-- 3.2. Apenas usuários verdadeiramente logados no sistema podem Criar/Editar/Deletar
CREATE POLICY "Permitir Escrita (Collaborators)" 
ON collaborators FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- ============================================================
-- PRONTO! Rode isso no SQL Editor e todos os 1900+ colaboradores
-- que estão escondidos vão reaparecer e o botão "Salvar" volta a funcionar!
