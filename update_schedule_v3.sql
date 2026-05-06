-- Adiciona suporte a agendas de data específica (não recorrente)
ALTER TABLE training_schedules
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS specific_date DATE DEFAULT NULL;

-- is_recurring = true  -> repete toda semana no day_of_week (comportamento atual)
-- is_recurring = false -> aparece apenas na specific_date
