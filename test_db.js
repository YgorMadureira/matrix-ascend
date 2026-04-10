import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  // 1. Ver TODAS as pastas e seus parent_id
  console.log("=== TODAS AS PASTAS ===");
  const { data: folders, error: fErr } = await supabase.from('folders').select('id, name, parent_id').order('name');
  if (fErr) console.error("ERRO:", fErr.message);
  else console.table(folders);

  // 2. Testar filtro: pastas raiz (parent_id IS NULL)
  console.log("\n=== PASTAS NA RAIZ (parent_id IS NULL) ===");
  const { data: rootFolders } = await supabase.from('folders').select('id, name, parent_id').is('parent_id', null).order('name');
  console.table(rootFolders);

  // 3. Testar filtro: buscar subpasta de cada pasta raiz
  if (rootFolders && rootFolders.length > 0) {
    for (const rf of rootFolders) {
      console.log(`\n=== SUBPASTAS DENTRO DE "${rf.name}" (parent_id = ${rf.id}) ===`);
      const { data: subs } = await supabase.from('folders').select('id, name, parent_id').eq('parent_id', rf.id).order('name');
      console.table(subs);
    }
  }
}

run();
