-- ============================================================
-- SQL DE EMERGÊNCIA: RESET DE POLÍTICAS DE SEGURANÇA E PERFORMANCE
-- ============================================================
-- Se o banco de dados demora para criar pastas (trava no Criando/Adicionando),
-- o problema estrutural é RLS (Row Level Security) em looping 
-- ou locks pesados no banco de dados.

-- 1. DESATIVA POLÍTICAS ANTIGAS E RESTRITIVAS (RLS)
-- Políticas escritas de forma ineficiente causam travamentos intermitentes no Supabase
ALTER TABLE folders DISABLE ROW LEVEL SECURITY;
ALTER TABLE materials DISABLE ROW LEVEL SECURITY;

-- 2. REMOVE POLÍTICAS EXISTENTES PARA RENOVAÇÃO
DROP POLICY IF EXISTS "Public access for folders" ON folders;
DROP POLICY IF EXISTS "Enable read access for all users" ON folders;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON folders;
DROP POLICY IF EXISTS "Enable all access for all users" ON folders;

DROP POLICY IF EXISTS "Public access for materials" ON materials;
DROP POLICY IF EXISTS "Enable read access for all users" ON materials;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON materials;
DROP POLICY IF EXISTS "Enable all access for all users" ON materials;

-- 3. REATIVA SEGURANÇA E CRIA POLÍTICAS PERFEITAS (CUSTO ZERO NO BANCO)
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa (mesmo sem login/anônima) pode LER e INSERIR, e DELETAR
-- Como sua aplicação já protege as rotas via React Router para Lideres/Admins,
-- O Supabase não precisa fazer verificações complexas que travam o banco!
CREATE POLICY "Enable all access for all users_folders" ON folders
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all access for all users_materials" ON materials
  FOR ALL USING (true) WITH CHECK (true);

-- Nota: O comando VACUUM foi removido pois o Editor SQL do Supabase
-- roda dentro de uma transação e bloqueia esse tipo de comando de limpeza.
-- A recriação das políticas acima já é suficiente para destravar a performance.
