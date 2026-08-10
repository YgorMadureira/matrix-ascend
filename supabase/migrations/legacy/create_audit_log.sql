-- Tabela de auditoria para registrar ações na agenda
CREATE TABLE IF NOT EXISTS schedule_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  UUID,
  schedule_title TEXT NOT NULL,
  action       TEXT NOT NULL,  -- 'INSCRICAO' ou 'EXCLUSAO'
  collaborator_name TEXT NOT NULL,
  scheduled_date DATE,
  performed_by TEXT NOT NULL,  -- Nome de quem executou
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE schedule_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos autenticados podem ler audit log"
  ON schedule_audit_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin lider pcp podem inserir audit log"
  ON schedule_audit_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role IN ('admin', 'lider', 'pcp')));

CREATE POLICY "Admin pode deletar audit log"
  ON schedule_audit_log FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role = 'admin'));
