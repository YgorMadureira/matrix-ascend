// Simula a REGRA UNIFICADA decidida em 13/08/2026, antes de aplicá-la:
//
//   · Onboarding PTS "Com Sorter" → Recebimento + Processamento + Expedição + ASM
//   · Onboarding PTS (sem sorter) → Recebimento + Processamento + Expedição
//   · Onboarding administrativo (HSE/People/Security/Qualidade/Meio Ambiente) → nada
//   · "Treinamento Padrão SOC - <área>" → aquela área (inclusive Tratativas e ASM)
//   · TRATATIVAS nunca é aceso por Onboarding — exige o treinamento próprio
//
//   · Pessoa COM setor operacional  → treinada se tem treinamento que acende o setor DELA
//   · Pessoa SEM setor operacional  → treinada se tem treinamento que acende qualquer área
//     (Apoio, sem setor, Almox, EHA entram na conta — decisão de 13/08)

import { db, paginar } from './_conexao.mjs';

const norm = (raw) => (raw||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[_\-.,;:()]/g,' ').replace(/\s+/g,' ').trim();
const strip = (s) => s.replace(/\bV\s*\.?\s*\d+(\s*\.\d+)?\b/g,' ').replace(/\bVERSAO\s*\d+\b/g,' ').replace(/\bSPX\s+BR\s+PTS\s+SOC\s+\d+\b/g,' ').replace(/^\s*\d+\s+/,' ').replace(/\s+/g,' ').trim();
const macroArea = (raw) => {
  const u = norm(raw);
  if (!u) return '';
  if (u.includes('RECEBIMENTO')) return 'RECEBIMENTO';
  if (u.includes('PROCESSAMENTO')) return 'PROCESSAMENTO';
  if (u.includes('EXPEDIC')) return 'EXPEDIÇÃO';
  if (u.includes('TRATATIVA')) return 'TRATATIVAS';
  if (u === 'ASM' || u.startsWith('ASM ') || u.endsWith(' ASM')) return 'ASM';
  return '';
};
function areasUnlockedBy(t0) {
  const t = strip(norm(t0));
  if (t.includes('ONBOARDING PTS')) {
    if (t.includes('COM SORTER')) return ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','ASM'];
    return ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO'];
  }
  if (t.includes('ONBOARDING')) return [];
  if (t.includes('TREINAMENTO PADRAO SOC')) {
    const suf = t.split('TREINAMENTO PADRAO SOC').pop().trim();
    const alvos = [['RECEBIMENTO','RECEBIMENTO'],['PROCESSAMENTO','PROCESSAMENTO'],['EXPEDICAO','EXPEDIÇÃO'],['TRATATIVAS','TRATATIVAS'],['ASM','ASM']];
    const achadas = alvos.filter(([k]) => suf.includes(k)).map(([,a]) => a);
    if (achadas.length) return achadas;
  }
  return null;
}
/** A regra canônica de "esta pessoa está treinada?". */
function isCollaboratorTrained(sector, types, hasSorting) {
  const area = macroArea(sector);
  if (area && (area !== 'ASM' || hasSorting)) {
    if (types.some(t => (areasUnlockedBy(t) ?? []).includes(area))) return true;
    // Exceção do Sorter: nas SOCs com ASM o pessoal do Sorter continua
    // cadastrado em PROCESSAMENTO, e o "Treinamento Padrão SOC - Sorter (ASM)"
    // é o onboarding deles (decisão de 13/08 — já aplicada no SQL em 20260813_05).
    if (area === 'PROCESSAMENTO' && types.some(t => (areasUnlockedBy(t) ?? []).includes('ASM'))) return true;
    return false;
  }
  // Sem setor operacional: basta ter algum treinamento que acenda alguma área.
  return types.some(t => (areasUnlockedBy(t) ?? []).length > 0);
}

const collabs = await paginar('collaborators', 'id,name,sector,role,soc');
const status  = await paginar('collaborators_status', 'id,is_onboarding');
const onboardingById = new Map(status.map(s => [s.id, !!s.is_onboarding]));
const trainings = await paginar('trainings_completed', 'collaborator_id,training_type');
const { data: socsData } = await db.from('socs').select('name,has_sorting');
const sorting = new Map((socsData ?? []).map(s => [s.name, !!s.has_sorting]));

const byId = new Map();
for (const t of trainings) {
  if (!t.collaborator_id) continue;
  if (!byId.has(t.collaborator_id)) byId.set(t.collaborator_id, []);
  byId.get(t.collaborator_id).push(t.training_type || '');
}

const ehLider = (role) => {
  const r = (role || '').toUpperCase();
  return r.includes('LÍDER') || r.includes('LIDER') || r.includes('INSTRUTOR') || r.includes('GERENTE') || r.includes('COORDENADOR') || r.includes('SUPERVISOR');
};

const treinado = (c) => isCollaboratorTrained(c.sector, byId.get(c.id) || [], sorting.get(c.soc) ?? false);

// ── SC1 em detalhe ────────────────────────────────────────────
const sc1 = collabs.filter(c => c.soc === 'SC1');
const sc1Base = sc1.filter(c => !ehLider(c.role) && !onboardingById.get(c.id));
console.log('===== SC1 com a REGRA UNIFICADA =====');
console.log(`  unidade inteira      : ${sc1.filter(treinado).length}/${sc1.length} = ${(sc1.filter(treinado).length/sc1.length*100).toFixed(1)}%`);
console.log(`  só "Base Ativa"      : ${sc1Base.filter(treinado).length}/${sc1Base.length} = ${(sc1Base.filter(treinado).length/sc1Base.length*100).toFixed(1)}%`);
console.log(`  diferença (líderes + em onboarding): ${sc1.length - sc1Base.length} pessoa(s)`);
const sc1Lideres = sc1.filter(c => ehLider(c.role));
console.log(`     líderes/instrutores/gerentes: ${sc1Lideres.length} (treinados: ${sc1Lideres.filter(treinado).length})`);
console.log(`     em onboarding: ${sc1.filter(c => onboardingById.get(c.id)).length}`);

console.log('\n  Por setor:');
const porSetor = new Map();
for (const c of sc1) {
  const s = c.sector || '(sem setor)';
  if (!porSetor.has(s)) porSetor.set(s, {t:0, tr:0});
  const v = porSetor.get(s); v.t++; if (treinado(c)) v.tr++;
}
for (const [s,v] of [...porSetor.entries()].sort((a,b)=>b[1].t-a[1].t)) {
  console.log(`     ${s.padEnd(16)} ${String(v.tr).padStart(4)}/${String(v.t).padStart(4)}  ${(v.tr/v.t*100).toFixed(0)}%`);
}

console.log('\n  ANTES x DEPOIS em SC1:');
console.log('     Dashboard "% Treinados" : 97.9%  →  ' + (sc1.filter(treinado).length/sc1.length*100).toFixed(1) + '%');
console.log('     Colaboradores           : 96%    →  ' + (sc1Base.filter(treinado).length/sc1Base.length*100).toFixed(1) + '%');
console.log('     Relatórios "GERAL"      : 99.1%  →  ' + (sc1.filter(treinado).length/sc1.length*100).toFixed(1) + '%');
console.log('     Pendentes (era 17 x 2)  →  ' + sc1Base.filter(c => !treinado(c)).length + ' na Base Ativa / ' + sc1.filter(c => !treinado(c)).length + ' na unidade inteira');

// ── Empresa inteira ───────────────────────────────────────────
console.log('\n\n===== EMPRESA INTEIRA =====');
const totTrein = collabs.filter(treinado).length;
console.log(`  ${totTrein}/${collabs.length} = ${(totTrein/collabs.length*100).toFixed(1)}% treinados`);
const lideres = collabs.filter(c => ehLider(c.role));
const emOnb = collabs.filter(c => onboardingById.get(c.id));
console.log(`  líderes/instrutores/gerentes: ${lideres.length}  (treinados: ${lideres.filter(treinado).length})`);
console.log(`  em onboarding               : ${emOnb.length}  (treinados: ${emOnb.filter(treinado).length})`);

console.log('\n  Por unidade (top 12 por headcount):');
const porSoc = new Map();
for (const c of collabs) {
  if (!c.soc) continue;
  if (!porSoc.has(c.soc)) porSoc.set(c.soc, {t:0, tr:0});
  const v = porSoc.get(c.soc); v.t++; if (treinado(c)) v.tr++;
}
for (const [s,v] of [...porSoc.entries()].sort((a,b)=>b[1].t-a[1].t).slice(0,12)) {
  console.log(`     ${s.padEnd(6)} ${String(v.tr).padStart(5)}/${String(v.t).padStart(5)}  ${(v.tr/v.t*100).toFixed(1)}%`);
}
