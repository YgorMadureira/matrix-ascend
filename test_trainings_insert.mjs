import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  console.log("=== Testing folder insert ===");
  const res1 = await supabase.from('training_folders').insert({ name: 'Pasta Teste', parent_id: null }).select();
  console.log("Folder insert res:", res1);

  console.log("=== Testing training insert ===");
  const res2 = await supabase.from('trainings').insert({ name: 'Treinamento Teste', video_url: 'https://youtube.com', folder_id: null }).select();
  console.log("Training insert res:", res2);
}

test();
