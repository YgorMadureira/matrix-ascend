-- ============================================================
-- SQL DE EMERGÊNCIA: RESET DE POLÍTICAS DE SEGURANÇA E PERFORMANCE
-- ============================================================

-- 1. DESATIVA POLÍTICAS ANTIGAS E RESTRITIVAS (RLS)
ALTER TABLE folders DISABLE ROW LEVEL SECURITY;
ALTER TABLE materials DISABLE ROW LEVEL SECURITY;

-- 2. REMOVE POLÍTICAS EXISTENTES PARA RENOVAÇÃO
DROP POLICY IF EXISTS "Public access for folders" ON folders;
DROP POLICY IF EXISTS "Enable read access for all users" ON folders;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON folders;
DROP POLICY IF EXISTS "Enable all access for all users" ON folders;
DROP POLICY IF EXISTS "Enable all access for all users_folders" ON folders; -- Adicionado para segurança

DROP POLICY IF EXISTS "Public access for materials" ON materials;
DROP POLICY IF EXISTS "Enable read access for all users" ON materials;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON materials;
DROP POLICY IF EXISTS "Enable all access for all users" ON materials;
DROP POLICY IF EXISTS "Enable all access for all users_materials" ON materials; -- Adicionado para segurança

-- 3. REATIVA SEGURANÇA E CRIA POLÍTICAS PERFEITAS (CUSTO ZERO NO BANCO)
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for all users_folders" ON folders
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all access for all users_materials" ON materials
  FOR ALL USING (true) WITH CHECK (true);
