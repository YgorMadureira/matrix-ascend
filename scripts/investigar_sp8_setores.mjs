import { db, paginar } from './_conexao.mjs';

const colabsSP8 = await paginar('collaborators', 'id,name,sector,admission_date', q => q.eq('soc', 'SP8'));
const porId = new Map(colabsSP8.map(c => [c.id, c]));

for (const termo of ['recebimento', 'expedi', 'tratativa']) {
  const assinaturas = await paginar('trainings_completed', 'collaborator_id,training_type,collaborator_soc,completed_at', q => q.ilike('training_type', `%${termo}%`));
  const daSoc = assinaturas.filter(a => porId.has(a.collaborator_id) || a.collaborator_soc === 'SP8');
  // Filtra só "Treinamento Padrão SOC" pra não pegar Onboarding etc
  const padraoSoc = daSoc.filter(a => /padr.o\s+soc/i.test(a.training_type));
  console.log(`\n--- "${termo}" (Treinamento Padrão SOC) em SP8: ${padraoSoc.length} assinaturas ---`);
  const porSetorReal = new Map();
  const datas = new Set();
  for (const a of padraoSoc) {
    const c = porId.get(a.collaborator_id);
    const setor = c ? (c.sector || '(sem setor)') : '(órfã, sem colaborador ativo)';
    porSetorReal.set(setor, (porSetorReal.get(setor)||0)+1);
    if (a.completed_at) datas.add(a.completed_at.slice(0,10));
  }
  for (const [s,n] of [...porSetorReal.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${s}: ${n}`);
  console.log('  datas distintas:', [...datas].sort());
}
