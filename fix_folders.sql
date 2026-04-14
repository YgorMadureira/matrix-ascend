-- ============================================================
-- DIAGNÓSTICO E CORREÇÃO DA TABELA FOLDERS (VERSÃO UUID)
-- Execute este script inteiro no Supabase SQL Editor
-- ============================================================

-- 1. DIAGNÓSTICO: Ver TODAS as pastas e seus parent_id
SELECT id, name, parent_id, 
  CASE 
    WHEN parent_id IS NULL THEN '✅ RAIZ (null)'
    WHEN parent_id = id THEN '🔴 REFERÊNCIA CIRCULAR (Loop Infinito)!'
    ELSE '📁 Filho'
  END AS status
FROM folders
ORDER BY name;

-- 2. DIAGNÓSTICO: Verificar se há referências circulares graves
SELECT f1.id, f1.name, f1.parent_id, f2.name as parent_name, f2.parent_id as grandparent_id
FROM folders f1
LEFT JOIN folders f2 ON f1.parent_id = f2.id
WHERE f1.parent_id = f1.id  -- pasta aponta para si mesma
   OR f1.parent_id = f2.parent_id; -- filho do pai que é filho dele

-- 3. DIAGNÓSTICO: Pastas órfãs 
SELECT f.id, f.name, f.parent_id
FROM folders f
WHERE f.parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folders p WHERE p.id = f.parent_id);

-- ============================================================
-- CORREÇÕES 
-- ============================================================

-- 4. CORRIGIR: Referências circulares (Loop Infinito) → mover de volta para a raiz
UPDATE folders SET parent_id = NULL WHERE parent_id = id;

-- 5. CORRIGIR: Pastas órfãs (o pai já foi deletado) → mover para raiz
UPDATE folders SET parent_id = NULL
WHERE parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folders p WHERE p.id = folders.parent_id);

-- 6. REMOVER pastas duplicadas (Corrigido para aceitar UUID)
DELETE FROM folders
WHERE id NOT IN (
  SELECT (MIN(id::text))::uuid FROM folders GROUP BY name, parent_id
);

-- 7. ADICIONAR constraint de Foreign Key para nunca mais permitir pastar órfãs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'folders_parent_id_fkey' 
      AND table_name = 'folders'
  ) THEN
    ALTER TABLE folders 
      ADD CONSTRAINT folders_parent_id_fkey 
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 8. ADICIONAR Índice de performance
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);

-- 9. PERMISSÕES: Garantir que o sistema consegue ler
GRANT ALL ON public.folders TO anon, authenticated;

-- ============================================================
-- MESMA COISA PARA MATERIALS
-- ============================================================

-- 10. Remover materiais órfãos (arquivos em pastas que não existem mais)
UPDATE materials SET folder_id = NULL
WHERE folder_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = materials.folder_id);

-- 11. Adicionar integridade para arquivos (Impede de ficar arquivos órfãos)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'materials_folder_id_fkey' 
      AND table_name = 'materials'
  ) THEN
    ALTER TABLE materials 
      ADD CONSTRAINT materials_folder_id_fkey 
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_materials_folder_id ON materials(folder_id);
GRANT ALL ON public.materials TO anon, authenticated;
