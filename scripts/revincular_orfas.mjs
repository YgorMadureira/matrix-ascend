// Religa assinaturas órfãs ao colaborador certo, casando por NOME + SOC.
//
// Uma assinatura fica órfã quando o colaborador é removido da base: a chave
// estrangeira está como ON DELETE SET NULL, então o registro do treinamento
// sobrevive, mas perde o vínculo. Foi o que aconteceu com 13.880 assinaturas
// no incidente de 11/08.
//
// ⚠️ O QUE ESTE SCRIPT CONSEGUE E O QUE NÃO CONSEGUE
// Ele só religa assinaturas que TENHAM o nome gravado na própria linha
// (colunas collaborator_name / collaborator_soc, criadas pela migração
// 20260812_02). Uma assinatura órfã sem nome não tem por onde ser
// identificada — a tabela nunca guardou quem era a pessoa, guardava só a
// referência que se perdeu. Para essas, o único caminho é a restauração do
// backup do Supabase.
//
// Uso (a chave de serviço vem do .env — ver scripts/_conexao.mjs):
//   node scripts/revincular_orfas.mjs              (simulação, não grava nada)
//   node scripts/revincular_orfas.mjs --aplicar    (grava)

import { db, paginar } from './_conexao.mjs';

const APLICAR = process.argv.includes('--aplicar');

const chave = (n, s) => `${(n || '').toUpperCase().trim()}|${(s || '').toUpperCase().trim()}`;
const soNome = (n) => (n || '').toUpperCase().trim();

console.log(APLICAR ? '=== MODO GRAVAÇÃO ===\n' : '=== SIMULAÇÃO (nada será gravado) ===\n');

console.log('Lendo colaboradores...');
const colaboradores = await paginar('collaborators', 'id,name,soc');
console.log(`  ${colaboradores.length} na base.`);

// (nome, soc) é único no banco — o índice idx_collaborators_name_soc_unique
// garante. Já o nome sozinho pode repetir entre unidades, então guardamos
// quantos são para não religar no homônimo errado.
const porNomeSoc = new Map();
const contagemPorNome = new Map();
for (const c of colaboradores) {
  porNomeSoc.set(chave(c.name, c.soc), c.id);
  const n = soNome(c.name);
  contagemPorNome.set(n, (contagemPorNome.get(n) ?? 0) + 1);
}
const idPorNome = new Map();
for (const c of colaboradores) {
  const n = soNome(c.name);
  if (contagemPorNome.get(n) === 1) idPorNome.set(n, c.id);
}

console.log('\nLendo assinaturas órfãs...');
let orfas;
try {
  orfas = await paginar(
    'trainings_completed',
    'id,training_type,completed_at,collaborator_name,collaborator_soc,collaborator_opsid',
    q => q.is('collaborator_id', null)
  );
} catch {
  orfas = null;
}
if (!orfas) {
  console.error('\nNão consegui ler as colunas de snapshot.');
  console.error('Rode antes a migração 20260812_02_collaborator_snapshot_on_training.sql.');
  process.exit(1);
}
console.log(`  ${orfas.length} assinaturas sem colaborador.\n`);

const comNomeESoc = [];
const soComNome    = [];
const semIdentidade = [];

for (const o of orfas) {
  if (o.collaborator_name && o.collaborator_soc) comNomeESoc.push(o);
  else if (o.collaborator_name)                  soComNome.push(o);
  else                                           semIdentidade.push(o);
}

console.log('Composição das órfãs:');
console.log(`  com nome E unidade : ${comNomeESoc.length}`);
console.log(`  só com nome        : ${soComNome.length}`);
console.log(`  sem identidade     : ${semIdentidade.length}  ← irrecuperáveis por aqui\n`);

const aReligar = [];
const semPar   = [];
const ambiguas = [];

for (const o of comNomeESoc) {
  const id = porNomeSoc.get(chave(o.collaborator_name, o.collaborator_soc));
  if (id) aReligar.push({ ...o, novo_id: id, criterio: 'nome+soc' });
  else    semPar.push(o);
}

// Sem a unidade, só religamos se o nome for único na base inteira. Um
// homônimo em outra SOC transformaria a "recuperação" em erro de dado.
for (const o of soComNome) {
  const n = soNome(o.collaborator_name);
  if (contagemPorNome.get(n) === 1) aReligar.push({ ...o, novo_id: idPorNome.get(n), criterio: 'nome único' });
  else if ((contagemPorNome.get(n) ?? 0) > 1) ambiguas.push(o);
  else semPar.push(o);
}

console.log('Resultado do casamento:');
console.log(`  ✓ religáveis        : ${aReligar.length}`);
console.log(`  · sem par na base   : ${semPar.length}   (a pessoa não está mais cadastrada)`);
console.log(`  · nome ambíguo      : ${ambiguas.length}   (homônimo em outra unidade — não arrisco)\n`);

if (aReligar.length > 0) {
  console.log('Amostra do que seria religado:');
  for (const a of aReligar.slice(0, 10)) {
    console.log(`  ${a.collaborator_name} (${a.collaborator_soc ?? '?'}) · ${a.training_type} · por ${a.criterio}`);
  }
  if (aReligar.length > 10) console.log(`  ... e mais ${aReligar.length - 10}`);
  console.log();
}

if (!APLICAR) {
  console.log('Nada foi gravado. Rode de novo com --aplicar para efetivar.');
  process.exit(0);
}

let ok = 0, falhas = 0;
for (let i = 0; i < aReligar.length; i += 100) {
  const lote = aReligar.slice(i, i + 100);
  for (const a of lote) {
    const { error } = await db
      .from('trainings_completed')
      .update({ collaborator_id: a.novo_id })
      .eq('id', a.id);
    if (error) { falhas++; console.error(`  falha em ${a.id}: ${error.message}`); }
    else ok++;
  }
  console.log(`  ${Math.min(i + 100, aReligar.length)}/${aReligar.length}...`);
}

console.log(`\n=== CONCLUÍDO ===`);
console.log(`  religadas: ${ok}`);
console.log(`  falhas   : ${falhas}`);
if (semIdentidade.length > 0) {
  console.log(`\n${semIdentidade.length} assinaturas continuam sem dono: a linha nunca guardou o nome.`);
  console.log('Só a restauração do backup do Supabase recupera essas.');
}
