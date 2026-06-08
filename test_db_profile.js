const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const code = fs.readFileSync('src/lib/supabase.ts', 'utf8');
const url = code.match(/supabaseUrl = '([^']+)'/)[1];
const key = code.match(/supabaseAnonKey = '([^']+)'/)[1];
const supabase = createClient(url, key);

async function check() {
  const { data, error } = await supabase.rpc('get_table_info', { table_name: 'users_profiles' });
  console.log('rpc error:', error);
  
  // Alternative: query information_schema if possible, though PostgREST doesn't expose it by default.
  // Instead, just read the first record.
  const { data: profile } = await supabase.from('users_profiles').select('*').limit(1);
  console.log('First profile:', profile);
}
check();
