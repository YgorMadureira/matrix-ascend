import { db, paginar } from './_conexao.mjs';

for (const soc of ['SP8', 'SP18']) {
  const colabs = await paginar('collaborators', 'id', q => q.eq('soc', soc));
  const ids = new Set(colabs.map(c => c.id));
  const assinaturas = await paginar('trainings_completed', 'collaborator_id,collaborator_soc,completed_at,created_at,training_type');
  const daSoc = assinaturas.filter(a => ids.has(a.collaborator_id) || a.collaborator_soc === soc);
  console.log(`\n${soc}: ${daSoc.length} assinaturas no total`);
  const porDataCompleted = new Map();
  const porDataCreated = new Map();
  for (const a of daSoc) {
    const dc = (a.completed_at || '').slice(0,10);
    const dcr = (a.created_at || '').slice(0,10);
    porDataCompleted.set(dc, (porDataCompleted.get(dc)||0)+1);
    porDataCreated.set(dcr, (porDataCreated.get(dcr)||0)+1);
  }
  console.log('  por completed_at:', Object.fromEntries([...porDataCompleted.entries()].sort()));
  console.log('  por created_at  :', Object.fromEntries([...porDataCreated.entries()].sort()));
}
