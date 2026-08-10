-- Adiciona a coluna bpo na tabela de colaboradores (caso ainda não exista)
ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS bpo TEXT;
