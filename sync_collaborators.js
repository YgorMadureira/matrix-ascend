import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';
const GSHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0LwfzukkjRDLD-NqioPJoWmFv5FfeDfUdInkavetnDr7p-OhoB-sKvvXWqy6jilxBc4g8olgkOjsJ/pub?gid=0&single=true&output=csv';

const supabase = createClient(supabaseUrl, supabaseKey);

async function sync() {
  console.log('--- Iniciando Sincronização de Colaboradores ---');
  
  try {
    const response = await fetch(GSHEET_CSV_URL);
    if (!response.ok) throw new Error('Falha ao buscar CSV');
    
    const text = await response.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV vazio');

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    const get = (row, names) => {
      for (const n of names) {
        const i = header.indexOf(n.toLowerCase());
        if (i >= 0 && row[i]) return row[i].trim();
      }
      return '';
    };

    const rows = lines.slice(1).map(line => {
      const p = line.split(',');
      return {
        name: get(p, ['colaborador', 'nome']),
        gender: get(p, ['gênero', 'genero']),
        admission_date: get(p, ['data admissão', 'data admissao']),
        shift: get(p, ['turno']),
        sector: get(p, ['setor']),
        activity: get(p, ['atividade']),
        leader: get(p, ['líder', 'lider']),
        opsid: get(p, ['ops id', 'opsid']),
        bpo: get(p, ['bpo']),
        role: get(p, ['cargo']),
        soc: 'SP6',
        is_onboarding: false
      };
    }).filter(r => r.name);

    console.log(`Encontrados ${rows.length} colaboradores na planilha.`);

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      // Tentar encontrar por OPSID ou Nome
      const { data: existing } = await supabase
        .from('collaborators')
        .select('id')
        .or(`opsid.eq.${row.opsid},name.eq.${row.name}`)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase.from('collaborators').update(row).eq('id', existing.id);
        if (!error) updated++;
        else console.error(`Erro ao atualizar ${row.name}:`, error.message);
      } else {
        const { error } = await supabase.from('collaborators').insert(row);
        if (!error) inserted++;
        else console.error(`Erro ao inserir ${row.name}:`, error.message);
      }
    }

    console.log(`Sucesso! Inseridos: ${inserted}, Atualizados: ${updated}`);
  } catch (err) {
    console.error('Erro crítico na sincronização:', err.message);
  }
}

sync();
