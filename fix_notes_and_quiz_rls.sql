-- ============================================================
-- SCRIPT SQL: COLUNA NOTES NA AGENDA + RLS PARA QUIZ QUESTIONS
-- ============================================================

-- 1. Adiciona a coluna 'notes' (Observações) na tabela de solicitações de agendamento
ALTER TABLE public.training_scheduling_requests 
ADD COLUMN IF NOT EXISTS notes text;


-- 2. Habilita RLS e cria políticas para quiz_questions (Perguntas de Prova)
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de quiz para autenticados" ON public.quiz_questions;
DROP POLICY IF EXISTS "Permitir insercao de quiz para autenticados" ON public.quiz_questions;
DROP POLICY IF EXISTS "Permitir atualizacao de quiz para autenticados" ON public.quiz_questions;
DROP POLICY IF EXISTS "Permitir exclusao de quiz para autenticados" ON public.quiz_questions;
DROP POLICY IF EXISTS "Permitir tudo em quiz para autenticados" ON public.quiz_questions;

CREATE POLICY "Permitir leitura de quiz para autenticados"
  ON public.quiz_questions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir insercao de quiz para autenticados"
  ON public.quiz_questions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Permitir atualizacao de quiz para autenticados"
  ON public.quiz_questions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Permitir exclusao de quiz para autenticados"
  ON public.quiz_questions FOR DELETE TO authenticated USING (true);

SELECT '✅ Coluna notes adicionada e permissões RLS de quiz_questions configuradas com sucesso!' as status;
