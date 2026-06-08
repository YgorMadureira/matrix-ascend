-- ============================================================
-- SQL: ADICIONAR CAMPO leader_key EM users_profiles
-- ============================================================
-- Permite que o admin defina exatamente como o nome do Líder
-- aparece na coluna "leader" da tabela de colaboradores.
-- Isso resolve o problema de mismatch de nomes.
-- ============================================================

-- 1. Adicionar a coluna leader_key (opcional, só usada por líderes)
ALTER TABLE public.users_profiles
  ADD COLUMN IF NOT EXISTS leader_key TEXT DEFAULT NULL;

-- 2. DIAGNÓSTICO: Ver quais nomes de líderes existem na tabela de colaboradores
SELECT leader, COUNT(*) as total_colaboradores
FROM public.collaborators
WHERE leader IS NOT NULL AND leader != ''
GROUP BY leader
ORDER BY leader;

-- 3. Após descobrir o nome exato, atualize manualmente o leader_key:
-- Exemplo: UPDATE public.users_profiles SET leader_key = 'RICARDO MARTINS' WHERE email = 'email_do_ricardo@shopee.com';

-- ============================================================
-- PRONTO! Rode no SQL Editor do Supabase.
-- ============================================================
