-- Isolamento de Banco de Questões por SOC
-- Adiciona a coluna soc_name na tabela quiz_questions
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS soc_name TEXT;

-- Atualiza as questões existentes para um SOC padrão (ex: SP6) para não perder as configurações já feitas.
-- Caso o cliente queira migrar manualmente, ele pode ajustar isso.
UPDATE public.quiz_questions SET soc_name = 'SP6' WHERE soc_name IS NULL;

-- Garante que a coluna não fique nula daqui pra frente (opcional, mas recomendado)
-- ALTER TABLE public.quiz_questions ALTER COLUMN soc_name SET NOT NULL;
