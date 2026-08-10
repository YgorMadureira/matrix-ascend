import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data: inst } = await supabase.from('instructors').select('id, name').limit(1);
  if (!inst || !inst.length) return console.log('No instructors found');
  
  const id = inst[0].id;
  const { error } = await supabase.from('trainings_completed').insert({
    collaborator_id: id,
    training_type: 'TEST_FK',
    instructor_name: 'TEST_INSTRUCTOR'
  });
  console.log('Insert Error:', error);
}

run();
