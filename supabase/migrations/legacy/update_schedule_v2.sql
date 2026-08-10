-- Execute no Supabase SQL Editor
-- Adiciona coluna SOC às agendas e nome de quem inscreveu

ALTER TABLE training_schedules ADD COLUMN IF NOT EXISTS soc TEXT DEFAULT 'SPX BR';

ALTER TABLE training_schedule_enrollments ADD COLUMN IF NOT EXISTS enrolled_by_name TEXT;

-- Atualiza RLS para PCP poder inscrever
DROP POLICY IF EXISTS "Admin e lider inscrevem colaboradores" ON training_schedule_enrollments;
CREATE POLICY "Admin lider e pcp inscrevem colaboradores"
  ON training_schedule_enrollments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role IN ('admin', 'lider', 'pcp'))
  );

DROP POLICY IF EXISTS "Admin e lider removem inscricoes" ON training_schedule_enrollments;
CREATE POLICY "Admin lider e pcp removem inscricoes"
  ON training_schedule_enrollments FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role IN ('admin', 'lider', 'pcp'))
  );
