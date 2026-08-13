import { db, paginar } from './_conexao.mjs';

const colabsSP18 = await paginar('collaborators', 'id,name,sector,admission_date', q => q.eq('soc', 'SP18'));
const porId = new Map(colabsSP18.map(c => [c.id, c]));

const assinaturas = await paginar('trainings_completed', 'collaborator_id,training_type,collaborator_soc,collaborator_name,completed_at', q => q.ilike('training_type', '%tratativa%'));
const daSoc = assinaturas.filter(a => porId.has(a.collaborator_id) || a.collaborator_soc === 'SP18');
console.log(`Assinaturas de Tratativas apontando pra SP18: ${daSoc.length}`);

const porSetorReal = new Map();
for (const a of daSoc) {
  const c = porId.get(a.collaborator_id);
  const setor = c ? (c.sector || '(sem setor)') : '(órfã, sem colaborador ativo)';
  porSetorReal.set(setor, (porSetorReal.get(setor)||0)+1);
}
console.log('Setor REAL de quem assinou "Tratativas" em SP18:');
for (const [s,n] of [...porSetorReal.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${s}: ${n}`);

// datas das assinaturas de tratativas
const datas = daSoc.map(a => a.completed_at?.slice(0,10)).filter(Boolean).sort();
console.log(`Datas das assinaturas: primeira=${datas[0]} última=${datas[datas.length-1]}`);
const porData = new Map();
for (const d of datas) porData.set(d, (porData.get(d)||0)+1);
console.log('Por dia:', Object.fromEntries(porData));

// instrutor
const instrutores = new Map();
const comInstrutor = await paginar('trainings_completed', 'instructor_name', q => q.ilike('training_type', '%tratativa%').eq('collaborator_soc', 'SP18'));
