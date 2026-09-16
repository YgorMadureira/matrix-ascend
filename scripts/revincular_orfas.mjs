// Religa assinaturas órfãs ao colaborador certo.
//
// Uma assinatura fica órfã quando o colaborador é removido da base: a chave
// estrangeira está como ON DELETE SET NULL, então o registro do treinamento
// sobrevive, mas perde o vínculo. Acontece quando a sincronização com o
// Sheets remove alguém que sumiu da planilha por um dia (fonte quebrada,
// aba sem acesso) e, quando a pessoa volta, ela é recriada com um id NOVO —
// e passa a aparecer como pendente, com as assinaturas dela soltas.
//
// ⚠️ ESTE SCRIPT NÃO TEM LÓGICA PRÓPRIA DE CASAMENTO.
// Quem decide o que religar é a função public.relink_orphan_trainings(), no
// banco — a MESMA que a sincronização com o Sheets chama ao final de toda
// execução (supabase/functions/sync-collaborators). Uma regra só, em um
// lugar só: se precisar mudar o critério, mude na migração
// 20260916_02_religa_assinaturas_orfas.sql.
//
// ⚠️ A API DEVOLVE NO MÁXIMO 1.000 LINHAS POR RESPOSTA.
// A primeira versão deste script lia o resultado da função numa chamada só
// e mostrou "1000 analisadas, 13 religáveis" quando eram ~11 mil e ~899.
// Por isso: contagens vêm do cabeçalho (count exact), a lista de religáveis
// é paginada, e a gravação é conferida por id — nada depende do tamanho da
// resposta. A GRAVAÇÃO em si nunca foi afetada: a função executa inteira no
// banco, o limite corta só o que volta.
//
// Uso (a chave de serviço vem do .env — ver scripts/_conexao.mjs):
//   node scripts/revincular_orfas.mjs              (simulação, não grava nada)
//   node scripts/revincular_orfas.mjs --aplicar    (grava)

import { db } from './_conexao.mjs';
import fs from 'node:fs';

const APLICAR = process.argv.includes('--aplicar');
const SITUACOES = ['religavel', 'opsid_diverge', 'ambiguo', 'sem_par'];

console.log(APLICAR ? '=== MODO GRAVAÇÃO ===\n' : '=== SIMULAÇÃO (nada será gravado) ===\n');

function falhar(msg, error) {
  console.error(msg, error?.message ?? '');
  if (/function|does not exist|schema cache/i.test(error?.message ?? '')) {
    console.error('\nFalta rodar a migração supabase/migrations/20260916_02_religa_assinaturas_orfas.sql');
  }
  process.exit(1);
}

// ── 1. Classificação completa (só leitura) ─────────────────────
const contagem = {};
for (const s of SITUACOES) {
  const { count, error } = await db
    .rpc('relink_orphan_trainings', { p_aplicar: false }, { count: 'exact' })
    .eq('situacao', s)
    .range(0, 0);
  if (error) falhar('Não consegui classificar as órfãs:', error);
  contagem[s] = count ?? 0;
}

const planejadas = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await db
    .rpc('relink_orphan_trainings', { p_aplicar: false })
    .eq('situacao', 'religavel')
    .order('training_id')
    .range(de, de + 999);
  if (error) falhar('Não consegui listar as religáveis:', error);
  planejadas.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const total = SITUACOES.reduce((s, k) => s + contagem[k], 0);
console.log(`Assinaturas órfãs com nome analisadas : ${total}`);
console.log(`  ✓ religáveis                         : ${contagem.religavel}`);
console.log(`  · opsid não bate                     : ${contagem.opsid_diverge}   (mesmo nome, outra matrícula — outra pessoa)`);
console.log(`  · nome ambíguo (homônimo)            : ${contagem.ambiguo}   (não arrisco)`);
console.log(`  · sem ninguém com esse nome na base  : ${contagem.sem_par}   (a pessoa saiu mesmo)\n`);

if (planejadas.length !== contagem.religavel) {
  console.warn(`⚠️ A lista paginada trouxe ${planejadas.length} religáveis, a contagem diz ${contagem.religavel}. A base mudou durante a leitura? Rode de novo.`);
  if (APLICAR) process.exit(1);
}

const porSoc = new Map();
for (const r of planejadas) porSoc.set(r.soc ?? '?', (porSoc.get(r.soc ?? '?') || 0) + 1);
if (porSoc.size) {
  console.log('Religáveis por SOC:');
  for (const [s, n] of [...porSoc].sort((a, b) => b[1] - a[1])) console.log(`  ${String(s).padEnd(8)} ${n}`);
  console.log(`\nPessoas que recuperariam o histórico: ${new Set(planejadas.map(r => r.novo_collaborator_id)).size}\n`);
}

if (!APLICAR) {
  console.log('Nada foi gravado. Rode de novo com --aplicar para efetivar.');
  process.exit(0);
}

if (planejadas.length === 0) {
  console.log('Nada a religar.');
  process.exit(0);
}

// ── 2. Gravação ────────────────────────────────────────────────
const contarOrfas = async () => {
  const { count, error } = await db
    .from('trainings_completed')
    .select('id', { count: 'exact', head: true })
    .is('collaborator_id', null);
  if (error) falhar('Não consegui contar as órfãs:', error);
  return count;
};

const orfasAntes = await contarOrfas();

// range(0,0): só limita o que VOLTA — a função grava todas as religáveis.
const { error: errAplicar } = await db
  .rpc('relink_orphan_trainings', { p_aplicar: true })
  .eq('situacao', 'religavel')
  .range(0, 0);
if (errAplicar) falhar('A gravação falhou:', errAplicar);

const orfasDepois = await contarOrfas();

// ── 3. Conferência por id ──────────────────────────────────────
const vinculoAtual = new Map();
for (let i = 0; i < planejadas.length; i += 200) {
  const ids = planejadas.slice(i, i + 200).map(p => p.training_id);
  const { data, error } = await db.from('trainings_completed').select('id, collaborator_id').in('id', ids);
  if (error) falhar('Não consegui conferir a gravação:', error);
  for (const r of data ?? []) vinculoAtual.set(String(r.id), r.collaborator_id);
}
const confirmadas = planejadas.filter(p => vinculoAtual.get(p.training_id) === p.novo_collaborator_id);

console.log('=== CONCLUÍDO ===');
console.log(`  órfãs antes  : ${orfasAntes}`);
console.log(`  órfãs depois : ${orfasDepois}`);
console.log(`  religadas    : ${orfasAntes - orfasDepois}`);
console.log(`  conferidas por id: ${confirmadas.length} de ${planejadas.length} planejadas`);

// Registro para desfazer, se algum dia precisar: basta voltar
// collaborator_id para NULL nestes ids de trainings_completed.
const arquivo = `religacao_orfas_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
fs.writeFileSync(arquivo, JSON.stringify(confirmadas, null, 2));
console.log(`\nRegistro para desfazer salvo em: ${arquivo}`);
