-- ============================================================
-- SQL: CORREÇÃO DE RLS PARA A TELA DE ASSINATURA (SignPage)
-- ============================================================
-- Resolve o problema de loop infinito "Buscando unidades..." 
-- Isso acontece porque usuários anônimos perderam a permissão de 
-- leitura da tabela "socs", "instructors" e possivelmente de 
-- escrita em "trainings_completed".

-- 1. Permissão de leitura em 'socs' para todos (inclusive anônimos)
ALTER TABLE public.socs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir Leitura (Socs)" ON public.socs;
CREATE POLICY "Permitir Leitura (Socs)" ON public.socs FOR SELECT USING (true);

-- 2. Permissão de leitura em 'instructors' para todos
ALTER TABLE public.instructors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir Leitura (Instructors)" ON public.instructors;
CREATE POLICY "Permitir Leitura (Instructors)" ON public.instructors FOR SELECT USING (true);

-- 3. Garantir permissão de leitura de colaboradores
ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir Leitura (Collaborators)" ON public.collaborators;
CREATE POLICY "Permitir Leitura (Collaborators)" ON public.collaborators FOR SELECT USING (true);

-- 4. Permissão para salvar a assinatura (Insert) para anônimos
ALTER TABLE public.trainings_completed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir Insert Anonimo (Trainings)" ON public.trainings_completed;
CREATE POLICY "Permitir Insert Anonimo (Trainings)" ON public.trainings_completed FOR INSERT WITH CHECK (true);

-- ============================================================
-- PRONTO! Rode este script no SQL Editor do Supabase.
-- A página de assinaturas voltará a carregar as unidades e permitirá a assinatura.
