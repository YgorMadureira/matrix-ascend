import { db, paginar } from './_conexao.mjs';

const norm = (raw) => (raw||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[_\-.,;:()]/g,' ').replace(/\s+/g,' ').trim();
const macro = (raw) => {
  const u = norm(raw);
  if (!u) return '';
  if (u.includes('RECEBIMENTO')) return 'RECEBIMENTO';
  if (u.includes('PROCESSAMENTO')) return 'PROCESSAMENTO';
  if (u.includes('EXPEDIC')) return 'EXPEDIÇÃO';
  if (u.includes('TRATATIVA')) return 'TRATATIVAS';
  if (u === 'ASM' || u.startsWith('ASM ') || u.endsWith(' ASM')) return 'ASM';
  return '';
};

const collabs = await paginar('collaborators', 'id,name,sector,soc,role');
const trainings = await paginar('trainings_completed', 'collaborator_id,training_type');
const byId = new Map();
for (const t of trainings) {
  if (!t.collaborator_id) continue;
  if (!byId.has(t.collaborator_id)) byId.set(t.collaborator_id, []);
  byId.get(t.collaborator_id).push(t.training_type||'');
}

console.log('TOTAL colaboradores:', collabs.length);

// A) Tratativas: quantos têm SÓ onboarding PTS (sem treinamento de Tratativas)?
const trat = collabs.filter(c => macro(c.sector) === 'TRATATIVAS');
let tratComOnbSemTrat = 0, tratComTrat = 0, tratSemNada = 0;
for (const c of trat) {
  const ts = (byId.get(c.id)||[]).map(norm);
  const temTratativas = ts.some(t => t.includes('PADRAO SOC') && t.includes('TRATATIVA'));
  const temOnbPts = ts.some(t => t.includes('ONBOARDING PTS'));
  if (temTratativas) tratComTrat++;
  else if (temOnbPts) tratComOnbSemTrat++;
  else tratSemNada++;
}
console.log('\n=== A) SETOR TRATATIVAS (empresa toda) ===');
console.log('  total em Tratativas:', trat.length);
console.log('  com treinamento de Tratativas:', tratComTrat);
console.log('  SÓ com Onboarding PTS (viram treinados se PTS cobrir Tratativas):', tratComOnbSemTrat);
console.log('  sem nenhum dos dois:', tratSemNada);

// B) Setores não-operacionais
const naoOp = collabs.filter(c => !macro(c.sector));
const porSetor = new Map();
for (const c of naoOp) {
  const s = c.sector || '(vazio)';
  if (!porSetor.has(s)) porSetor.set(s, {total:0, comOnb:0, comAlgo:0, semNada:0});
  const v = porSetor.get(s); v.total++;
  const ts = (byId.get(c.id)||[]).map(norm);
  if (ts.some(t => t.includes('ONBOARDING'))) v.comOnb++;
  else if (ts.length) v.comAlgo++;
  else v.semNada++;
}
console.log('\n=== B) SETORES NÃO-OPERACIONAIS (fora do % hoje no Dashboard/Relatórios) ===');
console.log('  total de pessoas nesses setores:', naoOp.length);
for (const [s,v] of [...porSetor.entries()].sort((a,b)=>b[1].total-a[1].total)) {
  console.log(`  ${s.padEnd(30)} total=${String(v.total).padStart(5)}  com onboarding=${String(v.comOnb).padStart(5)}  só outros treinos=${String(v.comAlgo).padStart(4)}  sem nada=${String(v.semNada).padStart(5)}`);
}
