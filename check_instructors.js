import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTgyNTA2NSwiZXhwIjoyMDkxNDAxMDY1fQ.9PqJd3Z7RSRrCnDkIu-vPzoihGKIfv2oNINi1E3IuXs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('instructors').select('*').limit(1);
  if (error) {
     fs.writeFileSync('instructors_check.txt', 'Error fetching: ' + error.message);
  } else {
     fs.writeFileSync('instructors_check.txt', 'Fetched fine as service role: ' + JSON.stringify(data));
  }
}

check();
