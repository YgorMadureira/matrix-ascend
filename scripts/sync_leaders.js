import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';

const sb = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data: collabs } = await sb.from('collaborators').select('leader, soc');
  if (!collabs) return console.error('Failed to fetch collaborators');

  const leaderMap = new Map();
  collabs.forEach(c => {
    if (c.leader && c.leader.trim() !== '') {
      const upper = c.leader.trim().toUpperCase();
      if (!leaderMap.has(upper)) {
        leaderMap.set(upper, c.soc);
      }
    }
  });

  const { data: existing } = await sb.from('collaborators').select('name');
  const existingNames = new Set(existing.map(e => e.name.trim().toUpperCase()));

  for (const [leaderName, soc] of leaderMap.entries()) {
    if (!existingNames.has(leaderName)) {
      console.log('Inserting missing leader:', leaderName);
      const { error } = await sb.from('collaborators').insert({
        name: leaderName,
        role: 'LÍDER',
        soc: soc || 'ALL',
        is_onboarding: false
      });
      if (error) console.error('Error inserting', leaderName, error);
    }
  }
  console.log('Done sync leaders.');
}

run();
