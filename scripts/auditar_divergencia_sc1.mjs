// Auditoria: por que Dashboard, Colaboradores e Relatórios mostram
// percentuais diferentes para a MESMA unidade.
//
// Cada bloco abaixo reimplementa, linha por linha, a regra que a tela
// correspondente usa hoje — para provar de onde vem cada número.
//   node scripts/auditar_divergencia_sc1.mjs SC1

import { db, paginar } from './_conexao.mjs';

const SOC = process.argv[2] || 'SC1';

// ── Regra A: src/lib/trainingRules.ts (Dashboard, card "% Treinados") ──
const normalizeText = (raw) => (raw || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[_\-.,;:()]/g, ' ').replace(/\s+/g, ' ').trim();

const stripVersionAndCode = (s) => s
  .replace(/\bV\s*\.?\s*\d+(\s*\.\d+)?\b/g, ' ')
  .replace(/\bVERSAO\s*\d+\b/g, ' ')
  .replace(/\bSPX\s+BR\s+PTS\s+SOC\s+\d+\b/g, ' ')
  .replace(/^\s*\d+\s+/, ' ').replace(/\s+/g, ' ').trim();

const normalizeMacroArea = (raw) => {
  const u = normalizeText(raw);
  if (!u) return '';
  if (u.includes('RECEBIMENTO')) return 'RECEBIMENTO';
  if (u.includes('PROCESSAMENTO')) return 'PROCESSAMENTO';
  if (u.includes('EXPEDIC')) return 'EXPEDIÇÃO';
  if (u.includes('TRATATIVA')) return 'TRATATIVAS';
  if (u === 'ASM' || u.startsWith('ASM ') || u.endsWith(' ASM')) return 'ASM';
  return '';
};

function areasUnlockedBy(trainingType) {
  const t = stripVersionAndCode(normalizeText(trainingType));
  if (t.includes('ONBOARDING PTS')) {
    if (t.includes('COM SORTER')) return ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'ASM'];
    return ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO'];
  }
  if (t.includes('ONBOARDING')) return [];
  if (t.includes('TREINAMENTO PADRAO SOC')) {
    const suffix = t.split('TREINAMENTO PADRAO SOC').pop().trim();
    const targets = [['RECEBIMENTO','RECEBIMENTO'],['PROCESSAMENTO','PROCESSAMENTO'],['EXPEDICAO','EXPEDIÇÃO'],['TRATATIVAS','TRATATIVAS'],['ASM','ASM']];
    const found = targets.filter(([k]) => suffix.includes(k)).map(([, a]) => a);
    if (found.length > 0) return found;
  }
  return null;
}
const isAreaTrained = (types, area) => types.some(t => (areasUnlockedBy(t) ?? []).includes(area));

console.log(`===== AUDITORIA DE DIVERGÊNCIA — SOC ${SOC} =====\n`);

const { data: socRow } = await db.from('socs').select('name,has_sorting').eq('name', SOC).maybeSingle();
const hasSorting = !!socRow?.has_sorting;
console.log(`has_sorting: ${hasSorting}\n`);

const collabs = await paginar('collaborators', 'id,name,sector,role,leader,soc', q => q.eq('soc', SOC));
const status  = await paginar('collaborators_status', 'id,name,sector,role,is_trained,is_onboarding', q => q.eq('soc', SOC));
const allTrainings = await paginar('trainings_completed', 'collaborator_id,training_type');

const typesById = new Map();
for (const t of allTrainings) {
  if (!t.collaborator_id) continue;
  if (!typesById.has(t.collaborator_id)) typesById.set(t.collaborator_id, []);
  typesById.get(t.collaborator_id).push(t.training_type || '');
}
const upperById = new Map([...typesById].map(([id, ts]) => [id, ts.map(t => t.toUpperCase())]));

console.log(`Colaboradores na tabela collaborators: ${collabs.length}`);
console.log(`Colaboradores na view collaborators_status: ${status.length}\n`);

// ══ 1. DASHBOARD — card "Meu Time" e card "% Treinados" ══
const OPERACIONAIS = hasSorting
  ? ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','TRATATIVAS','ASM']
  : ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','TRATATIVAS'];

let stTotal = 0, stTrained = 0;
const detalheArea = [];
for (const area of OPERACIONAIS) {
  const areaCollabs = collabs.filter(c => normalizeMacroArea(c.sector) === area);
  const trained = areaCollabs.filter(c => isAreaTrained(typesById.get(c.id) || [], area)).length;
  stTotal += areaCollabs.length; stTrained += trained;
  detalheArea.push([area, trained, areaCollabs.length]);
}
console.log('── 1. DASHBOARD ────────────────────────────────────');
console.log(`   card "Meu Time"   : ${collabs.length}   (TODOS da unidade, inclusive líderes e onboarding)`);
console.log(`   card "% Treinados": ${(stTrained/stTotal*100).toFixed(1)}%   (${stTrained}/${stTotal} — só setores operacionais, regra ESTRITA trainingRules.ts)`);
console.log(`   card "Treinados"  : ${stTrained}`);
for (const [a,t,n] of detalheArea) console.log(`      ${a.padEnd(15)} ${t}/${n}`);

// ══ 2. DASHBOARD — "Desempenho por Macro-Setor" (regra inline, SOLTA) ══
const SECTORS = ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','TRATATIVAS','HSE','PEOPLE'];
console.log('\n── 2. DASHBOARD · "Desempenho por Macro-Setor" (outra regra, na MESMA tela) ──');
let macroTotal = 0, macroTrained = 0;
for (const sector of SECTORS) {
  const isTransversal = sector === 'HSE' || sector === 'PEOPLE';
  const target = isTransversal ? collabs : collabs.filter(c => (c.sector || '').toUpperCase() === sector);
  const trained = target.filter(c => {
    const types = upperById.get(c.id) || [];
    const cRole = (c.role || '').toUpperCase();
    const isCore = ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','EXPEDICAO'].includes(sector) || sector.includes('LOGISTICA') || cRole.includes('LOGISTICA');
    return types.some(tType => {
      if (isTransversal) return tType.includes(sector);
      if (isCore && tType.includes('ONBOARDING')) return true;
      return tType.includes(sector) || sector.includes(tType) || (cRole && (tType.includes(cRole) || cRole.includes(tType)));
    });
  }).length;
  if (!isTransversal) { macroTotal += target.length; macroTrained += trained; }
  console.log(`      ${sector.padEnd(15)} ${trained}/${target.length}`);
}
console.log(`   soma dos 4 operacionais: ${macroTrained}/${macroTotal} = ${(macroTrained/macroTotal*100).toFixed(1)}%`);

// ══ 3. COLABORADORES — collaborators_status.is_trained ══
const ehLider = (role) => {
  const r = (role || '').toUpperCase();
  return r.includes('LÍDER') || r.includes('LIDER') || r.includes('INSTRUTOR') || r.includes('GERENTE') || r.includes('COORDENADOR') || r.includes('SUPERVISOR');
};
const baseAtiva = status.filter(c => !ehLider(c.role) && !c.is_onboarding);
const colabTrained = baseAtiva.filter(c => c.is_trained).length;
console.log('\n── 3. COLABORADORES (aba Base Ativa) ───────────────');
console.log(`   total na aba      : ${baseAtiva.length}   (exclui líderes e quem está em onboarding)`);
console.log(`   treinados         : ${colabTrained}   (coluna is_trained da view, regra SQL)`);
console.log(`   % certificação    : ${Math.round(colabTrained/baseAtiva.length*100)}%`);
console.log(`   PENDENTES na tela : ${baseAtiva.length - colabTrained}`);

// ══ 4. RELATÓRIOS — hasTraining (regra própria, SOLTA) ══
const showAsm = hasSorting;
const TRAINING_TYPES = showAsm ? ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','TRATATIVAS','ASM'] : ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','TRATATIVAS'];
const CORE_SECTORS = showAsm ? ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','EXPEDICAO','TRATATIVAS','ASM'] : ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','EXPEDICAO','TRATATIVAS'];

function hasTraining(collabId, type) {
  const list = typesById.get(collabId);
  if (!list || list.length === 0) return false;
  const c = collabs.find(x => x.id === collabId);
  const reqType = type.toUpperCase();
  const cRole = (c?.role || '').toUpperCase();
  const cSector = (c?.sector || '').toUpperCase();
  return list.some(raw => {
    const tType = (raw || '').toUpperCase();
    if (reqType.startsWith('ONBOARDING ')) {
      const area = reqType.replace('ONBOARDING ', '');
      return tType.includes('ONBOARDING') && tType.includes(area);
    }
    const isOp = ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','EXPEDICAO','TRATATIVAS'].includes(reqType);
    if (tType.includes('ONBOARDING') && isOp) return true;
    if (showAsm && reqType === 'ASM' && tType.includes('ONBOARDING PTS') && tType.includes('COM SORTER')) return true;
    const isPTS = tType.includes('ONBOARDING PTS');
    const padrao = tType.includes('TREINAMENTO PADRÃO SOC') || tType.includes('TREINAMENTO PADRAO SOC');
    if (isPTS || (padrao && tType.includes('RECEBIMENTO'))) {
      if (cSector === 'RECEBIMENTO' && (reqType === 'RECEBIMENTO FM' || reqType === 'RECEBIMENTO LH')) return true;
    }
    const matchSector = tType === reqType || tType.includes(reqType) || reqType.includes(tType);
    const matchRole = cRole && (tType.includes(cRole) || cRole.includes(tType));
    return matchSector || matchRole;
  });
}

const operacionalFiltered = collabs.filter(c => {
  const s = (c.sector || '').toUpperCase();
  return s === 'RECEBIMENTO' || s === 'PROCESSAMENTO' || s === 'EXPEDIÇÃO' || s === 'EXPEDICAO' || s === 'TRATATIVAS' || (showAsm && s === 'ASM');
});
console.log('\n── 4. RELATÓRIOS · cards do topo (regra própria, SOLTA) ──');
let repTotal = 0, repDone = 0;
for (const type of TRAINING_TYPES) {
  const sectorCollabs = operacionalFiltered.filter(c => {
    const s = (c.sector || '').toUpperCase();
    return s === type || (type === 'EXPEDIÇÃO' && s === 'EXPEDICAO');
  });
  const completed = sectorCollabs.filter(c => hasTraining(c.id, type)).length;
  repTotal += sectorCollabs.length; repDone += completed;
  console.log(`      ${type.padEnd(15)} ${completed}/${sectorCollabs.length}`);
}
console.log(`   GERAL: ${repDone}/${repTotal} = ${(repDone/repTotal*100).toFixed(1)}%`);

// ══ 5. RELATÓRIOS — filtro "Pendentes" na tela (isGenerallyTrained) ══
const isGenerallyTrained = (id) => CORE_SECTORS.some(t => hasTraining(id, t));
const pendentesTela = operacionalFiltered.filter(c => !isGenerallyTrained(c.id));
console.log('\n── 5. RELATÓRIOS · filtro "Pendentes" da tela ──────');
console.log(`   pendentes: ${pendentesTela.length}   (isGenerallyTrained = treinado em QUALQUER área, não na própria)`);

// ══ 6. RELATÓRIOS — botão "Exportar Pendentes" (3ª regra, MUITO solta) ══
const CORE_TYPES = showAsm
  ? ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','EXPEDICAO','TRATATIVAS','ASM']
  : ['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','EXPEDICAO','TRATATIVAS'];
const isTrainedExport = (id) => {
  const types = upperById.get(id) || [];
  return types.some(t => t.includes('ONBOARDING') || CORE_TYPES.some(core => t.includes(core)));
};
const pendentesExport = collabs.filter(c => !isTrainedExport(c.id));
console.log('\n── 6. RELATÓRIOS · botão "Exportar Pendentes" ──────');
console.log(`   linhas no CSV: ${pendentesExport.length}   (exporta a unidade INTEIRA, e ignora o setor da pessoa)`);
for (const c of pendentesExport.slice(0, 10)) console.log(`      ${c.name} · setor="${c.sector || ''}" · cargo="${c.role || ''}"`);

// ══ 7. Quem são os 17 pendentes da tela de Colaboradores? ══
console.log('\n── 7. Os pendentes segundo a tela de Colaboradores ──');
const pendentesColab = baseAtiva.filter(c => !c.is_trained);
for (const c of pendentesColab) {
  const t = typesById.get(c.id) || [];
  console.log(`   ${(c.name||'').padEnd(42)} setor="${c.sector || '(vazio)'}" cargo="${c.role || ''}" · assinaturas: ${t.length ? [...new Set(t)].join(' | ') : '(nenhuma)'}`);
}
