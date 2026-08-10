import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  console.log("Checking quiz_questions table...");
  const resSelect = await supabase.from('quiz_questions').select('*').limit(5);
  console.log("Select result:", resSelect);

  console.log("Testing insert into quiz_questions...");
  const resInsert = await supabase.from('quiz_questions').insert({
    training_id: '00000000-0000-0000-0000-000000000000',
    soc_name: 'RJ2',
    question: 'Teste Pergunta',
    option_a: 'A',
    option_b: 'B',
    option_c: 'C',
    option_d: 'D',
    correct_option: 'a',
    order_num: 1
  }).select();
  console.log("Insert result:", resInsert);
}

test();
