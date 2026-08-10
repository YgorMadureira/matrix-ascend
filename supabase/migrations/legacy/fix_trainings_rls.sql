-- ============================================================
-- SCRIPT SQL: CORRIGIR PERMISSÕES RLS DAS TABELAS DE TREINAMENTO
-- ============================================================
-- Se o RLS estiver ativado sem política de inserção/alteração,
-- o sistema bloqueia a criação de pastas e materiais.
--
-- Execute este script no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/<seu-project-id>/sql/new
-- ============================================================

-- 1. TABELA: training_folders (Pastas de Treinamentos)
ALTER TABLE public.training_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de pastas para autenticados" ON public.training_folders;
DROP POLICY IF EXISTS "Permitir inserção de pastas para autenticados" ON public.training_folders;
DROP POLICY IF EXISTS "Permitir atualização de pastas para autenticados" ON public.training_folders;
DROP POLICY IF EXISTS "Permitir exclusão de pastas para autenticados" ON public.training_folders;
DROP POLICY IF EXISTS "Permitir tudo em pastas para autenticados" ON public.training_folders;

CREATE POLICY "Permitir leitura de pastas para autenticados"
  ON public.training_folders FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir inserção de pastas para autenticados"
  ON public.training_folders FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Permitir atualização de pastas para autenticados"
  ON public.training_folders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Permitir exclusão de pastas para autenticados"
  ON public.training_folders FOR DELETE TO authenticated USING (true);


-- 2. TABELA: trainings (Materiais / Treinamentos)
ALTER TABLE public.trainings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de treinamentos para autenticados" ON public.trainings;
DROP POLICY IF EXISTS "Permitir inserção de treinamentos para autenticados" ON public.trainings;
DROP POLICY IF EXISTS "Permitir atualização de treinamentos para autenticados" ON public.trainings;
DROP POLICY IF EXISTS "Permitir exclusão de treinamentos para autenticados" ON public.trainings;
DROP POLICY IF EXISTS "Permitir tudo em treinamentos para autenticados" ON public.trainings;

CREATE POLICY "Permitir leitura de treinamentos para autenticados"
  ON public.trainings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir inserção de treinamentos para autenticados"
  ON public.trainings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Permitir atualização de treinamentos para autenticados"
  ON public.trainings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Permitir exclusão de treinamentos para autenticados"
  ON public.trainings FOR DELETE TO authenticated USING (true);


-- 3. TABELA: quiz_questions (Perguntas de prova)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'quiz_questions') THEN
    ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Permitir leitura de quiz para autenticados" ON public.quiz_questions;
    DROP POLICY IF EXISTS "Permitir inserção de quiz para autenticados" ON public.quiz_questions;
    DROP POLICY IF EXISTS "Permitir atualização de quiz para autenticados" ON public.quiz_questions;
    DROP POLICY IF EXISTS "Permitir exclusão de quiz para autenticados" ON public.quiz_questions;
    
    CREATE POLICY "Permitir leitura de quiz para autenticados"
      ON public.quiz_questions FOR SELECT TO authenticated USING (true);
    CREATE POLICY "Permitir inserção de quiz para autenticados"
      ON public.quiz_questions FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY "Permitir atualização de quiz para autenticados"
      ON public.quiz_questions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY "Permitir exclusão de quiz para autenticados"
      ON public.quiz_questions FOR DELETE TO authenticated USING (true);
  END IF;
END $$;


-- 4. TABELA: quiz_attempts (Tentativas de prova)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'quiz_attempts') THEN
    ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Permitir leitura de tentativas para autenticados" ON public.quiz_attempts;
    DROP POLICY IF EXISTS "Permitir inserção de tentativas para autenticados" ON public.quiz_attempts;
    DROP POLICY IF EXISTS "Permitir atualização de tentativas para autenticados" ON public.quiz_attempts;
    DROP POLICY IF EXISTS "Permitir exclusão de tentativas para autenticados" ON public.quiz_attempts;
    
    CREATE POLICY "Permitir leitura de tentativas para autenticados"
      ON public.quiz_attempts FOR SELECT TO authenticated USING (true);
    CREATE POLICY "Permitir inserção de tentativas para autenticados"
      ON public.quiz_attempts FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY "Permitir atualização de tentativas para autenticados"
      ON public.quiz_attempts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY "Permitir exclusão de tentativas para autenticados"
      ON public.quiz_attempts FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

SELECT '✅ Permissões RLS de Treinamentos aplicadas com sucesso!' as status;
