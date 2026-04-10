import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const tables = ['users_profiles', 'folders', 'materials', 'collaborators', 'socs', 'units'];
  
  for (const table of tables) {
    console.log(`\n=== ${table.toUpperCase()} ===`);
    const { data, error, count } = await supabase.from(table).select('*', { count: 'exact' });
    if (error) {
      console.log(`  ERRO: ${error.message} (code: ${error.code})`);
    } else {
      console.log(`  Total de registros: ${data?.length ?? 0}`);
      if (data && data.length > 0 && data.length <= 5) {
        console.table(data);
      } else if (data && data.length > 5) {
        console.table(data.slice(0, 3));
        console.log(`  ... e mais ${data.length - 3} registros`);
      }
    }
  }
}

run();
