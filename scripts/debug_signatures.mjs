import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://fezfsekzxtvozyemlncn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc'
);

console.log('========================================');
console.log('  DIAGNÓSTICO - Assinaturas');
console.log('========================================\n');

// 1. Quantos registros existem em trainings_completed no total?
const { count: totalTrainings, error: e1 } = await supabase
  .from('trainings_completed')
  .select('*', { count: 'exact', head: true });
console.log(`1. Total de registros em trainings_completed: ${totalTrainings ?? 'ERRO: ' + e1?.message}`);

// 2. Quantos têm signature_pdf_url preenchido?
const { count: withSig, error: e2 } = await supabase
  .from('trainings_completed')
  .select('*', { count: 'exact', head: true })
  .not('signature_pdf_url', 'is', null);
console.log(`2. Registros com signature_pdf_url preenchido: ${withSig ?? 'ERRO: ' + e2?.message}`);

// 3. Quantos colaboradores existem por SOC?
const { data: allCollabs, error: e3 } = await supabase
  .from('collaborators')
  .select('soc');
if (e3) {
  console.log(`3. ERRO ao buscar colaboradores: ${e3.message}`);
} else {
  const socCounts = {};
  (allCollabs ?? []).forEach(c => {
    const s = c.soc || '(null)';
    socCounts[s] = (socCounts[s] || 0) + 1;
  });
  console.log(`\n3. Colaboradores por SOC:`);
  Object.entries(socCounts).sort((a, b) => b[1] - a[1]).forEach(([soc, count]) => {
    console.log(`   ${soc}: ${count} colaboradores`);
  });
}

// 4. Quantos trainings_completed existem por SOC do colaborador?
console.log(`\n4. Treinamentos concluídos por SOC (via join manual):`);
const { data: allTrainings, error: e4 } = await supabase
  .from('trainings_completed')
  .select('collaborator_id');
if (e4) {
  console.log(`   ERRO: ${e4.message}`);
} else {
  // Buscar SOC de cada collaborator_id
  const uniqueIds = [...new Set((allTrainings ?? []).map(t => t.collaborator_id))];
  console.log(`   Total de collaborator_id únicos nos treinamentos: ${uniqueIds.length}`);
  
  const { data: collabsWithSoc, error: e4b } = await supabase
    .from('collaborators')
    .select('id, soc')
    .in('id', uniqueIds.slice(0, 500)); // Limita para não estourar a URL
  
  if (e4b) {
    console.log(`   ERRO ao buscar SOC dos colaboradores: ${e4b.message}`);
  } else {
    const idToSoc = new Map((collabsWithSoc ?? []).map(c => [c.id, c.soc]));
    const trainBySoc = {};
    let orphans = 0;
    (allTrainings ?? []).forEach(t => {
      const soc = idToSoc.get(t.collaborator_id);
      if (!soc) { orphans++; return; }
      trainBySoc[soc] = (trainBySoc[soc] || 0) + 1;
    });
    Object.entries(trainBySoc).sort((a, b) => b[1] - a[1]).forEach(([soc, count]) => {
      console.log(`   ${soc}: ${count} treinamentos concluídos`);
    });
    if (orphans > 0) {
      console.log(`   ⚠️ ${orphans} treinamentos com collaborator_id ÓRFÃO (não encontrado em collaborators)`);
    }
  }
}

// 5. Testar a query ilike para SC1 e SP5
for (const soc of ['SC1', 'SP5', 'SP6', 'SP8']) {
  const { data, error, count } = await supabase
    .from('collaborators')
    .select('id', { count: 'exact' })
    .ilike('soc', soc);
  
  if (error) {
    console.log(`\n5. Colaboradores com ilike('soc', '${soc}'): ERRO: ${error.message}`);
  } else {
    console.log(`\n5. Colaboradores com ilike('soc', '${soc}'): ${count ?? data?.length ?? 0}`);
    
    // Quantos desses têm treinamentos?
    if (data && data.length > 0) {
      const ids = data.map(c => c.id).slice(0, 200);
      const { count: trainCount, error: te } = await supabase
        .from('trainings_completed')
        .select('*', { count: 'exact', head: true })
        .in('collaborator_id', ids);
      console.log(`   → Treinamentos para esses colaboradores: ${trainCount ?? 'ERRO: ' + te?.message}`);
    }
  }
}

// 6. Verificar RLS policies
console.log('\n========================================');
console.log('  6. Teste de RLS - trainings_completed');
console.log('========================================');

// Testar sem filtro nenhum - quantos registros são retornados?
const { data: rawData, error: e6 } = await supabase
  .from('trainings_completed')
  .select('id, collaborator_id, training_type')
  .limit(10);

if (e6) {
  console.log(`   ❌ ERRO ao ler trainings_completed: ${e6.message}`);
  console.log(`   → Código: ${e6.code}`);
  console.log(`   → Detalhes: ${e6.details}`);
  console.log(`   → Hint: ${e6.hint}`);
} else {
  console.log(`   ✅ Leitura OK. Primeiros ${rawData?.length} registros retornados.`);
  if (rawData && rawData.length > 0) {
    console.log(`   Amostra: ${JSON.stringify(rawData[0])}`);
  }
}

// 7. Verificar se a query .in() funciona com muitos IDs
console.log('\n========================================');
console.log('  7. Teste de limite do .in()');
console.log('========================================');

const { data: sp5Collabs } = await supabase
  .from('collaborators')
  .select('id')
  .ilike('soc', 'SP5');

const sp5Ids = (sp5Collabs ?? []).map(c => c.id);
console.log(`   Colaboradores SP5: ${sp5Ids.length}`);

if (sp5Ids.length > 0) {
  // Supabase tem limite de URL ~8KB. Testar se .in() com muitos UUIDs causa erro.
  const batchSize = 100;
  let totalFound = 0;
  for (let i = 0; i < sp5Ids.length; i += batchSize) {
    const batch = sp5Ids.slice(i, i + batchSize);
    const { count, error } = await supabase
      .from('trainings_completed')
      .select('*', { count: 'exact', head: true })
      .in('collaborator_id', batch);
    
    if (error) {
      console.log(`   ❌ ERRO no batch ${i}-${i+batch.length}: ${error.message}`);
      break;
    }
    totalFound += (count ?? 0);
  }
  console.log(`   Total treinamentos para SP5 (buscando em batches de ${batchSize}): ${totalFound}`);
  
  // Agora testar com TODOS os IDs de uma vez
  const { count: allAtOnce, error: bigErr } = await supabase
    .from('trainings_completed')
    .select('*', { count: 'exact', head: true })
    .in('collaborator_id', sp5Ids);
  
  if (bigErr) {
    console.log(`   ❌ ERRO com .in() de ${sp5Ids.length} IDs DE UMA VEZ: ${bigErr.message}`);
    console.log(`   → Este é provavelmente o BUG! A URL do Supabase excede o limite.`);
  } else {
    console.log(`   Resultado com .in() de ${sp5Ids.length} IDs de uma vez: ${allAtOnce}`);
  }
}

console.log('\n========================================');
console.log('  DIAGNÓSTICO CONCLUÍDO');
console.log('========================================');
