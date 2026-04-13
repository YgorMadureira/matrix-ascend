import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  // 1. TODAS as pastas
  console.log("=== TODAS AS PASTAS ===");
  const { data: all } = await supabase.from('folders').select('id, name, parent_id').order('name');
  console.table(all);

  // 2. Pastas na RAIZ (parent_id IS NULL)
  console.log("\n=== QUERY: parent_id IS NULL ===");
  const { data: root, error: rootErr } = await supabase.from('folders').select('id, name, parent_id').is('parent_id', null).order('name');
  console.log("Error:", rootErr);
  console.table(root);

  // 3. Para cada pasta raiz, ver o que a query retorna com .eq('parent_id', id)
  if (root && root.length > 0) {
    for (const rf of root) {
      console.log(`\n=== QUERY: parent_id = '${rf.id}' (dentro de "${rf.name}") ===`);
      const { data: children, error: childErr } = await supabase
        .from('folders')
        .select('id, name, parent_id')
        .eq('parent_id', rf.id)
        .order('name');
      console.log("Error:", childErr);
      console.log("Count:", children?.length);
      console.table(children);
    }
  }
}

run();
