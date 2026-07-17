import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  let output = '';
  const tables = ['trainings', 'training_folders', 'quiz_questions'];
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) {
       output += `${t}: error ${error.message}\n`;
    } else if (data && data.length > 0) {
       output += `${t}: ${Object.keys(data[0]).join(', ')}\n`;
    } else {
       // if empty, we might not get columns from simple select *, try to insert and fail to get error or just use rpc if possible
       // wait, data will just be empty array.
       output += `${t}: empty\n`;
    }
  }
  fs.writeFileSync('cols.txt', output);
}
run();
