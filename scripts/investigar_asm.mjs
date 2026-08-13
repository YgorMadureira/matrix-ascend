// Investigação pontual: confirma a hipótese do bug ASM/Processamento
// antes de qualquer alteração. Só leitura — não grava nada.
import { db, paginar } from './_conexao.mjs';

const NOME = 'BIANCA GONCALVES TEMISTOCLES';

console.log(`=== Colaborador: ${NOME} ===`);
const { data: colabs, error: e1 } = await db
  .from('collaborators_status')
  .select('id,name,soc,sector,role,is_onboarding,is_trained,onboarding_modules')
  .ilike('name', `%${NOME}%`);
if (e1) console.error(e1);
console.log(colabs);

console.log('\n=== SOCs com has_sorting = true ===');
const { data: socs } = await db.from('socs').select('name,has_sorting').eq('has_sorting', true).order('name');
console.log(socs?.map(s => s.name).join(', '));

console.log('\n=== Varredura completa: PROCESSAMENTO pendente + assinatura "Padrão SOC ... ASM" ===');
const todos = await paginar('collaborators_status', 'id,name,soc,sector,role,is_onboarding,is_trained');
const procNaoTreinados = todos.filter(c => !c.is_trained && (c.sector || '').toUpperCase().includes('PROCESSAMENTO'));
console.log(`Colaboradores PROCESSAMENTO pendentes (is_trained=false): ${procNaoTreinados.length}`);
const idsPendentes = new Set(procNaoTreinados.map(c => c.id));

// Busca em massa (1 query paginada) em vez de 1 query por colaborador.
const asmTrainings = await paginar('trainings_completed', 'collaborator_id,training_type', q => q.ilike('training_type', '%asm%'));
console.log(`Registros de treinamento contendo "asm": ${asmTrainings.length}`);
const porColab = new Map();
for (const t of asmTrainings) {
  if (!/padr.o\s+soc/i.test(t.training_type)) continue;
  if (!idsPendentes.has(t.collaborator_id)) continue;
  if (!porColab.has(t.collaborator_id)) porColab.set(t.collaborator_id, t.training_type);
}
console.log(`\nTotal de colaboradores PROCESSAMENTO com essa assinatura mas marcados pendentes: ${porColab.size}`);
const nomePorId = new Map(procNaoTreinados.map(c => [c.id, c]));
let i = 0;
for (const [id, tipo] of porColab) {
  const c = nomePorId.get(id);
  i++;
  if (i <= 20) console.log(`  ${c.name} (${c.soc}) — "${tipo}"`);
}

console.log('\n=== Variantes de nome de treinamento "Padrão SOC ... ASM" no catálogo de assinaturas ===');
const variantes = new Set(asmTrainings.filter(t => /padr.o\s+soc/i.test(t.training_type)).map(t => t.training_type));
console.log([...variantes]);

console.log('\n=== Setores distintos (sample) que contêm "ASM" ===');
const { data: setoresAsm } = await db.from('collaborators').select('sector').ilike('sector', '%asm%').limit(5);
console.log(setoresAsm);
const setoresTodos = new Set(todos.map(c => (c.sector||'').toUpperCase()));
console.log('Valores distintos de setor no banco:', [...setoresTodos].sort());
