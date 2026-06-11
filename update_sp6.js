import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTgyNTA2NSwiZXhwIjoyMDkxNDAxMDY1fQ.9PqJd3Z7RSRrCnDkIu-vPzoihGKIfv2oNINi1E3IuXs';

async function updateAllToSP6() {
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Atualizando todos os soc_micro_trainings para SP6...");
  const { data, error } = await supabase
    .from('soc_micro_trainings')
    .update({ soc_name: 'SP6' })
    .neq('id', '00000000-0000-0000-0000-000000000000'); // hack para pegar todos

  if (error) {
    console.error("Erro:", error);
  } else {
    console.log("Atualização concluída com sucesso!");
  }
}

updateAllToSP6();
