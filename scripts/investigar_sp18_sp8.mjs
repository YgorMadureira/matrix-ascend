// Investigação: por que SP18 e SP8 têm % de treinados muito baixo.
import { db, paginar } from './_conexao.mjs';

const SOCS = ['SP18', 'SP8'];

for (const soc of SOCS) {
  console.log(`\n\n========== ${soc} ==========`);
  const { data: socRow } = await db.from('socs').select('*').eq('name', soc).maybeSingle();
  console.log('Config da SOC:', socRow);

  const colabs = await paginar('collaborators_status', 'id,name,sector,role,is_onboarding,is_trained,admission_date,activity', q => q.eq('soc', soc));
  console.log(`Total colaboradores: ${colabs.length}`);
  const treinados = colabs.filter(c => c.is_trained).length;
  console.log(`Treinados: ${treinados} (${(treinados/colabs.length*100).toFixed(1)}%)`);

  const porSetor = new Map();
  for (const c of colabs) {
    const s = c.sector || '(sem setor)';
    if (!porSetor.has(s)) porSetor.set(s, { total: 0, treinados: 0 });
    const v = porSetor.get(s);
    v.total++;
    if (c.is_trained) v.treinados++;
  }
  console.log('Por setor:');
  for (const [s, v] of [...porSetor.entries()].sort((a,b) => b[1].total - a[1].total)) {
    console.log(`  ${s.padEnd(20)} total=${v.total}  treinados=${v.treinados}  (${(v.treinados/v.total*100).toFixed(0)}%)`);
  }

  const semSetor = colabs.filter(c => !c.sector).length;
  console.log(`Sem setor: ${semSetor}`);

  const emOnboarding = colabs.filter(c => c.is_onboarding).length;
  console.log(`Em onboarding (is_onboarding=true): ${emOnboarding}`);

  // Assinaturas totais dessa SOC
  const ids = new Set(colabs.map(c => c.id));
  const assinaturas = await paginar('trainings_completed', 'collaborator_id,training_type,collaborator_soc');
  const assinDaSoc = assinaturas.filter(a => ids.has(a.collaborator_id) || a.collaborator_soc === soc);
  console.log(`Assinaturas registradas apontando pra essa SOC: ${assinDaSoc.length}`);
  const semDono = assinDaSoc.filter(a => !a.collaborator_id).length;
  console.log(`  dessas, sem collaborator_id (órfãs, snapshot soc="${soc}"): ${semDono}`);

  const tiposCount = new Map();
  for (const a of assinDaSoc) tiposCount.set(a.training_type, (tiposCount.get(a.training_type)||0)+1);
  console.log('Top tipos de treinamento assinados nessa SOC:');
  for (const [t, n] of [...tiposCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10)) {
    console.log(`  ${n}x  ${t}`);
  }

  // Admissão recente (podem ser contratações novas ainda não treinadas)
  const comData = colabs.filter(c => c.admission_date).map(c => c.admission_date).sort();
  console.log(`Colaboradores com data de admissão: ${comData.length} (mais recente: ${comData[comData.length-1]}, mais antiga: ${comData[0]})`);
  const ultimos30d = colabs.filter(c => c.admission_date && (Date.now() - new Date(c.admission_date).getTime()) < 30*86400000).length;
  console.log(`Admitidos nos últimos 30 dias: ${ultimos30d}`);

  // micro trainings cadastrados
  const { data: micros } = await db.from('soc_micro_trainings').select('name,macro_area').eq('soc_name', soc);
  console.log(`Micro-treinamentos cadastrados para ${soc}: ${micros?.length ?? 0}`);
}
