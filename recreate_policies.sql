-- ============================================================
-- SQL: RECRIAÇÃO LIMPA E SEGURA DE POLÍTICAS DE RLS (Materials e Folders)
-- ============================================================
-- Como o bloqueio de tela (deadlock) era causado apenas pelo delay
-- do navegador ao trocar de aba, agora podemos restaurar as 
-- políticas de leitura e gravação no banco de dados com segurança!

-- 1. Garante que o RLS (Segurança a Nível de Linha) está ativado
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;

-- 2. Limpa qualquer resquício (Prevenção de Erro "Already Exists")
DROP POLICY IF EXISTS "Permitir Leitura para Usuarios Autenticados (Folders)" ON folders;
DROP POLICY IF EXISTS "Permitir Leitura para Usuarios Anonimos (Folders)" ON folders;
DROP POLICY IF EXISTS "Permitir Tudo para Autenticados (Folders)" ON folders;

DROP POLICY IF EXISTS "Permitir Leitura para Usuarios Autenticados (Materials)" ON materials;
DROP POLICY IF EXISTS "Permitir Leitura para Usuarios Anonimos (Materials)" ON materials;
DROP POLICY IF EXISTS "Permitir Tudo para Autenticados (Materials)" ON materials;

-- 3. CRIAÇÃO DAS POLÍTICAS OFICIAIS PARA PASTAS (FOLDERS)
-- 3.1. Todos que abriram a página podem LISTAR as Pastas
CREATE POLICY "Permitir Leitura (Folders)" 
ON folders FOR SELECT 
USING (true);

-- 3.2. Apenas usuários verdadeiramente logados no sistema podem Criar/Editar/Deletar pastas
CREATE POLICY "Permitir Escrita (Folders)" 
ON folders FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- 4. CRIAÇÃO DAS POLÍTICAS OFICIAIS PARA MATERIAIS (MATERIALS)
-- 4.1. Todos que abriram a página podem LISTAR os Materiais
CREATE POLICY "Permitir Leitura (Materials)" 
ON materials FOR SELECT 
USING (true);

-- 4.2. Apenas usuários verdadeiramente logados no sistema podem Criar/Editar/Deletar materiais
CREATE POLICY "Permitir Escrita (Materials)" 
ON materials FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- ============================================================
-- PRONTO! 
-- Com isso, seu banco está 100% receptivo para navegação 
-- e bloqueado contra injeções de hackers/anonimos na criação.
-- Pode copiar este bloco todo e rodar lá no SQL Editor!
-- ============================================================
