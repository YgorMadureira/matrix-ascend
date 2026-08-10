CREATE TABLE IF NOT EXISTS public.soc_micro_trainings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    soc_name TEXT NOT NULL,
    macro_area TEXT NOT NULL,
    name TEXT NOT NULL,
    is_mandatory BOOLEAN DEFAULT false,
    order_num INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS
ALTER TABLE public.soc_micro_trainings ENABLE ROW LEVEL SECURITY;

-- Políticas
DROP POLICY IF EXISTS "Todos podem ver processos micros" ON public.soc_micro_trainings;
CREATE POLICY "Todos podem ver processos micros" ON public.soc_micro_trainings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Líderes e admins podem inserir processos" ON public.soc_micro_trainings;
CREATE POLICY "Líderes e admins podem inserir processos" ON public.soc_micro_trainings FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Líderes e admins podem editar processos" ON public.soc_micro_trainings;
CREATE POLICY "Líderes e admins podem editar processos" ON public.soc_micro_trainings FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Líderes e admins podem excluir processos" ON public.soc_micro_trainings;
CREATE POLICY "Líderes e admins podem excluir processos" ON public.soc_micro_trainings FOR DELETE USING (true);


-- Script para popular os dados baseados nos SOCs existentes
DO $$ 
DECLARE
    soc_record RECORD;
BEGIN
    FOR soc_record IN SELECT name FROM public.socs LOOP
        -- RECEBIMENTO
        INSERT INTO public.soc_micro_trainings (soc_name, macro_area, name, is_mandatory, order_num) VALUES
        (soc_record.name, 'RECEBIMENTO', 'Recebimento FM', true, 1),
        (soc_record.name, 'RECEBIMENTO', 'Recebimento LH', true, 2),
        (soc_record.name, 'RECEBIMENTO', 'Sacas Laranjas', false, 3),
        (soc_record.name, 'RECEBIMENTO', 'Transbordo', false, 4),
        (soc_record.name, 'RECEBIMENTO', 'Fullfilment', false, 5),
        (soc_record.name, 'RECEBIMENTO', 'Staged IN', false, 6),
        (soc_record.name, 'RECEBIMENTO', 'Rompimento Lacre', false, 7),
        (soc_record.name, 'RECEBIMENTO', 'YMS', false, 8);

        -- PROCESSAMENTO
        INSERT INTO public.soc_micro_trainings (soc_name, macro_area, name, is_mandatory, order_num) VALUES
        (soc_record.name, 'PROCESSAMENTO', 'Esteira automática', true, 9),
        (soc_record.name, 'PROCESSAMENTO', 'Esteira Java', true, 10),
        (soc_record.name, 'PROCESSAMENTO', 'Esteira Termoplástica', true, 11),
        (soc_record.name, 'PROCESSAMENTO', 'Puxada IN', false, 12),
        (soc_record.name, 'PROCESSAMENTO', 'Tetris', false, 13),
        (soc_record.name, 'PROCESSAMENTO', 'Goleiro', false, 14),
        (soc_record.name, 'PROCESSAMENTO', 'Setup', false, 15);

        -- EXPEDIÇÃO
        INSERT INTO public.soc_micro_trainings (soc_name, macro_area, name, is_mandatory, order_num) VALUES
        (soc_record.name, 'EXPEDIÇÃO', 'Carregamento LH', true, 16),
        (soc_record.name, 'EXPEDIÇÃO', 'Carrregamento 3PL', true, 17),
        (soc_record.name, 'EXPEDIÇÃO', 'Puxada OUT', false, 18),
        (soc_record.name, 'EXPEDIÇÃO', 'Montagem Carga', false, 19);

        -- TRATATIVAS
        INSERT INTO public.soc_micro_trainings (soc_name, macro_area, name, is_mandatory, order_num) VALUES
        (soc_record.name, 'TRATATIVAS', 'Reembalagem', false, 20),
        (soc_record.name, 'TRATATIVAS', 'Reetiquetagem', false, 21),
        (soc_record.name, 'TRATATIVAS', 'Avarias', false, 22),
        (soc_record.name, 'TRATATIVAS', 'Liquidation', false, 23),
        (soc_record.name, 'TRATATIVAS', 'Faded', false, 24),
        (soc_record.name, 'TRATATIVAS', 'Receita Federal', false, 25),
        (soc_record.name, 'TRATATIVAS', 'Recebimento de returns 3PL', false, 26);
    END LOOP;
END $$;
