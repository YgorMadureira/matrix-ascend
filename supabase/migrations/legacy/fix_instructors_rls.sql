-- Habilitar RLS na tabela de instrutores
ALTER TABLE public.instructors ENABLE ROW LEVEL SECURITY;

-- Remover políticas antigas para evitar duplicidade ou conflito
DROP POLICY IF EXISTS "Permitir Leitura de Instrutores" ON public.instructors;
DROP POLICY IF EXISTS "Permitir Escrita de Instrutores" ON public.instructors;
DROP POLICY IF EXISTS "Todos podem ver instrutores" ON public.instructors;
DROP POLICY IF EXISTS "Admins podem gerenciar instrutores" ON public.instructors;
DROP POLICY IF EXISTS "Autenticados podem gerenciar instrutores" ON public.instructors;

-- Criar política de leitura (todos autenticados podem ver os instrutores)
CREATE POLICY "Permitir Leitura de Instrutores" 
ON public.instructors FOR SELECT 
TO authenticated 
USING (true);

-- Criar política de escrita (usuários autenticados podem inserir, editar e deletar)
CREATE POLICY "Permitir Escrita de Instrutores" 
ON public.instructors FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);
