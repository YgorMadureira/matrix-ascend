-- ============================================================
-- Módulo: Fluxo de Solicitação de Agendamentos (PCP & PTS)
-- Execute no Supabase SQL Editor
-- ============================================================

-- Tabela 1: Solicitações de agendamentos criadas pelo PCP
CREATE TABLE IF NOT EXISTS training_scheduling_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_type      TEXT NOT NULL,          -- Ex: 'RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'RETURNS'
  scheduled_date     DATE NOT NULL,          -- Data do treinamento (Mínimo D+2)
  start_time         TEXT NOT NULL,          -- Ex: "10:00"
  end_time           TEXT NOT NULL,          -- Ex: "11:00"
  location           TEXT DEFAULT 'SPX BR',
  instructor_name    TEXT,
  instructor_email   TEXT,
  soc                TEXT NOT NULL,          -- Unidade da solicitação
  requested_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_name  TEXT NOT NULL,
  status             TEXT DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
  rejection_reason   TEXT,                   -- Motivo em caso de recusa completa
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela 2: Relacionamento de colaboradores solicitados por agendamento
CREATE TABLE IF NOT EXISTS training_scheduling_request_collaborators (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         UUID NOT NULL REFERENCES training_scheduling_requests(id) ON DELETE CASCADE,
  collaborator_id    TEXT NOT NULL,          -- ID do colaborador
  collaborator_name  TEXT NOT NULL,
  status             TEXT DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'EXCLUDED'
  rejection_reason   TEXT,                   -- Motivo em caso de exclusão individual
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE training_scheduling_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_scheduling_request_collaborators ENABLE ROW LEVEL SECURITY;

-- Políticas de Leitura (Todos os autenticados podem ver as solicitações e colaboradores solicitados)
DROP POLICY IF EXISTS "Leitura de solicitacoes por autenticados" ON training_scheduling_requests;
CREATE POLICY "Leitura de solicitacoes por autenticados"
  ON training_scheduling_requests FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Leitura de colaboradores solicitados por autenticados" ON training_scheduling_request_collaborators;
CREATE POLICY "Leitura de colaboradores solicitados por autenticados"
  ON training_scheduling_request_collaborators FOR SELECT TO authenticated USING (true);

-- Políticas de Inserção (Admin, Líder e PCP criam solicitações)
DROP POLICY IF EXISTS "Admin, lider e pcp criam solicitacoes" ON training_scheduling_requests;
CREATE POLICY "Admin, lider e pcp criam solicitacoes"
  ON training_scheduling_requests FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role IN ('admin', 'lider', 'pcp')));

DROP POLICY IF EXISTS "Inserir colaboradores solicitados" ON training_scheduling_request_collaborators;
CREATE POLICY "Inserir colaboradores solicitados"
  ON training_scheduling_request_collaborators FOR INSERT TO authenticated
  WITH CHECK (true);

-- Políticas de Edição/Atualização (Admin e PTS podem aprovar/recusar/excluir colaboradores)
DROP POLICY IF EXISTS "Admin e PTS editam solicitacoes" ON training_scheduling_requests;
CREATE POLICY "Admin e PTS editam solicitacoes"
  ON training_scheduling_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role IN ('admin', 'pts')));

DROP POLICY IF EXISTS "Admin e PTS editam colaboradores da solicitacao" ON training_scheduling_request_collaborators;
CREATE POLICY "Admin e PTS editam colaboradores da solicitacao"
  ON training_scheduling_request_collaborators FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role IN ('admin', 'pts')));

-- Políticas de Deleção (Apenas Admins podem deletar)
DROP POLICY IF EXISTS "Admin deleta solicitacao" ON training_scheduling_requests;
CREATE POLICY "Admin deleta solicitacao"
  ON training_scheduling_requests FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admin deleta colaborador de solicitacao" ON training_scheduling_request_collaborators;
CREATE POLICY "Admin deleta colaborador de solicitacao"
  ON training_scheduling_request_collaborators FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users_profiles WHERE id = auth.uid() AND role = 'admin'));
