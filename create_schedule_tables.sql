-- ============================================================
-- Módulo: Agenda de Treinamentos
-- Execute no Supabase SQL Editor
-- ============================================================

-- Tabela 1: Slots de agenda fixos (configurados pelos admins)
CREATE TABLE IF NOT EXISTS training_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,           -- Ex: "Recebimento FM"
  training_type TEXT NOT NULL,           -- Ex: "RECEBIMENTO"
  day_of_week   INT NOT NULL,            -- 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab
  start_time    TEXT NOT NULL,           -- Ex: "10:00"
  end_time      TEXT NOT NULL,           -- Ex: "11:00"
  instructor_name  TEXT,
  instructor_email TEXT,                 -- Para o convite Google Calendar
  location      TEXT DEFAULT 'SPX BR',
  color         TEXT DEFAULT '#EE4D2D',  -- Cor do card no calendário
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela 2: Inscrições de colaboradores por data específica
CREATE TABLE IF NOT EXISTS training_schedule_enrollments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id      UUID NOT NULL REFERENCES training_schedules(id) ON DELETE CASCADE,
  collaborator_id  TEXT NOT NULL,         -- ID do colaborador
  collaborator_name TEXT NOT NULL,        -- Cache do nome (evita join)
  scheduled_date   DATE NOT NULL,         -- Data específica da ocorrência
  google_event_id  TEXT,                  -- ID do evento no Google Calendar (para atualização)
  enrolled_by      UUID REFERENCES auth.users(id),
  enrolled_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(schedule_id, collaborator_id, scheduled_date)  -- Evita duplicatas
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_schedule_day ON training_schedules(day_of_week);
CREATE INDEX IF NOT EXISTS idx_enrollment_date ON training_schedule_enrollments(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_enrollment_schedule ON training_schedule_enrollments(schedule_id);

-- RLS Policies
ALTER TABLE training_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_schedule_enrollments ENABLE ROW LEVEL SECURITY;

-- Todos autenticados podem ler as agendas
CREATE POLICY "Agenda visível para todos autenticados"
  ON training_schedules FOR SELECT
  TO authenticated USING (true);

-- Somente admin pode criar/editar/deletar agendas
CREATE POLICY "Somente admin cria agenda"
  ON training_schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Somente admin edita agenda"
  ON training_schedules FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Somente admin deleta agenda"
  ON training_schedules FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Todos autenticados podem ler inscrições
CREATE POLICY "Inscrições visíveis para todos autenticados"
  ON training_schedule_enrollments FOR SELECT
  TO authenticated USING (true);

-- Admin e líderes podem inscrever colaboradores
CREATE POLICY "Admin e lider inscrevem colaboradores"
  ON training_schedule_enrollments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role IN ('admin', 'lider'))
  );

-- Admin e líderes podem remover inscrições
CREATE POLICY "Admin e lider removem inscricoes"
  ON training_schedule_enrollments FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role IN ('admin', 'lider'))
  );

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON training_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
