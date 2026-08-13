// Importa assinaturas em massa a partir de uma planilha (.xlsx, .xls ou .csv).
//
// A planilha precisa ter três colunas — o nome do cabeçalho é flexível:
//   colaborador | nome            → nome do colaborador
//   treinamento | curso | training→ nome do treinamento
//   soc         | unidade         → unidade
// Opcionais:
//   data        | data conclusao  → quando foi feito (padrão: agora)
//   instrutor   | instructor      → quem aplicou   (padrão: --instrutor)
//
// ⚠️ O PONTO CRÍTICO É O NOME DO TREINAMENTO.
// O Dashboard e os Relatórios não olham para "existe uma assinatura": eles
// casam o NOME do treinamento com as regras (Onboarding PTS, Treinamento
// Padrão SOC - Recebimento, ou o nome de um processo micro da unidade). Um
// nome fora do padrão entra no banco, aparece na tela de Assinaturas e não
// acende card nenhum — o pior tipo de erro, porque parece que funcionou.
// Por isso este script valida cada nome ANTES de gravar e se recusa a
// prosseguir se algum não for reconhecido.
//
// Uso (a chave de serviço vem do .env — ver scripts/_conexao.mjs):
//   node scripts/importar_assinaturas.mjs planilha.xlsx                 # confere, não grava
//   node scripts/importar_assinaturas.mjs planilha.xlsx --aplicar       # grava
//
// Opções:
//   --aplicar              grava de verdade (sem isso, é só simulação)
//   --instrutor "NOME"     instrutor padrão quando a planilha não traz
//   --data 2026-08-05      data padrão (AAAA-MM-DD) quando a planilha não traz
//   --forcar-nomes         grava mesmo com nomes de treinamento não reconhecidos
//   --sem-vinculo          grava também quem ainda não está na base de colaboradores,
//                          com nome e unidade congelados (revincular_orfas.mjs religa depois)

import { db, paginar } from './_conexao.mjs';
import xlsx from 'xlsx';
import fs from 'node:fs';

const args = process.argv.slice(2);
const ARQUIVO = args.find(a => !a.startsWith('--'));
const APLICAR = args.includes('--aplicar');
const FORCAR   = args.includes('--forcar-nomes');
const SEM_VINCULO = args.includes('--sem-vinculo');
const opcao = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
};
const INSTRUTOR_PADRAO = opcao('--instrutor', 'IMPORTACAO');
const DATA_PADRAO      = opcao('--data', null);

if (!ARQUIVO || !fs.existsSync(ARQUIVO)) {
  console.error('Informe a planilha: node scripts/importar_assinaturas.mjs planilha.xlsx');
  if (ARQUIVO) console.error(`  (não encontrei o arquivo "${ARQUIVO}")`);
  process.exit(1);
}

// ── Normalização: as MESMAS regras de src/lib/trainingRules.ts ──────
const normalizar = (raw) => (raw || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase()
  .replace(/[_\-.,;:()]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const semVersao = (s) => s
  .replace(/\bV\s*\.?\s*\d+(\s*\.\d+)?\b/g, ' ')
  .replace(/\bVERSAO\s*\d+\b/g, ' ')
  .replace(/\bSPX\s+BR\s+PTS\s+SOC\s+\d+\b/g, ' ')
  .replace(/^\s*\d+\s+/, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const chaveColab = (n, s) => `${normalizar(n)}|${normalizar(s)}`;

/** Acende alguma macro-área inteira? Espelha areasUnlockedBy() das regras. */
function acendeArea(nomeTreinamento) {
  const t = semVersao(normalizar(nomeTreinamento));
  if (t.includes('ONBOARDING PTS')) return true;
  if (t.includes('ONBOARDING')) return true; // administrativo: válido, mas não acende área
  if (t.includes('TREINAMENTO PADRAO SOC')) {
    // Procura a palavra-chave DENTRO do sufixo — "Sorter (ASM)" vira
    // "SORTER ASM" e precisa acender ASM. Mesma regra de trainingRules.ts.
    const sufixo = t.split('TREINAMENTO PADRAO SOC').pop().trim();
    return ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDICAO', 'TRATATIVAS', 'ASM'].some(k => sufixo.includes(k));
  }
  return false;
}

console.log(APLICAR ? '=== MODO GRAVAÇÃO ===\n' : '=== SIMULAÇÃO — nada será gravado ===\n');

// ── 1. Ler a planilha ───────────────────────────────────────────────
const livro = xlsx.readFile(ARQUIVO, { cellDates: true });
const aba = livro.Sheets[livro.SheetNames[0]];
const brutas = xlsx.utils.sheet_to_json(aba, { defval: '' });
if (brutas.length === 0) { console.error('Planilha vazia.'); process.exit(1); }

console.log(`Planilha: ${ARQUIVO}`);
console.log(`  aba "${livro.SheetNames[0]}", ${brutas.length} linhas`);
console.log(`  colunas: ${Object.keys(brutas[0]).join(', ')}\n`);

const pegar = (linha, nomes) => {
  for (const chave of Object.keys(linha)) {
    if (nomes.includes(normalizar(chave))) return String(linha[chave] ?? '').trim();
  }
  return '';
};

const linhas = [];
const semDados = [];
for (const [i, b] of brutas.entries()) {
  const nome        = pegar(b, ['COLABORADOR', 'NOME', 'NOME COLABORADOR', 'FUNCIONARIO']);
  const treinamento = pegar(b, ['TREINAMENTO', 'CURSO', 'TRAINING', 'TIPO', 'TREINAMENTOS']);
  const soc         = pegar(b, ['SOC', 'UNIDADE', 'UNIT']);
  if (!nome || !treinamento || !soc) { semDados.push({ linha: i + 2, nome, treinamento, soc }); continue; }
  linhas.push({
    linha: i + 2,
    nome, treinamento, soc,
    data:      pegar(b, ['DATA', 'DATA CONCLUSAO', 'DATA DE CONCLUSAO', 'CONCLUSAO', 'COMPLETED AT']),
    instrutor: pegar(b, ['INSTRUTOR', 'INSTRUCTOR', 'APLICADOR']),
  });
}

if (semDados.length > 0) {
  console.log(`⚠  ${semDados.length} linha(s) sem nome, treinamento ou SOC — serão ignoradas:`);
  for (const s of semDados.slice(0, 5)) console.log(`   linha ${s.linha}: nome="${s.nome}" treino="${s.treinamento}" soc="${s.soc}"`);
  if (semDados.length > 5) console.log(`   ... e mais ${semDados.length - 5}`);
  console.log();
}

// ── 2. Carregar o banco ─────────────────────────────────────────────
console.log('Lendo o banco...');
const colaboradores = await paginar('collaborators', 'id,name,soc,opsid');
const porChave = new Map(colaboradores.map(c => [chaveColab(c.name, c.soc), c]));
console.log(`  ${colaboradores.length} colaboradores`);

const { data: catalogo } = await db.from('trainings').select('name');
const { data: micros }   = await db.from('soc_micro_trainings').select('name, soc_name');
const nomesConhecidos = new Set([
  ...(catalogo ?? []).map(t => semVersao(normalizar(t.name))),
  ...(micros   ?? []).map(m => semVersao(normalizar(m.name))),
].filter(Boolean));
console.log(`  ${nomesConhecidos.size} nomes de treinamento no catálogo`);

// Duas chaves de duplicata, porque há dois tipos de registro:
//   · vinculado  → id do colaborador + treinamento
//   · sem dono   → nome + unidade + treinamento (via snapshot)
const existentes = await paginar('trainings_completed', 'collaborator_id,training_type,collaborator_name,collaborator_soc');
const jaExistem = new Set();
const jaExistemSemDono = new Set();
for (const t of existentes) {
  const tN = semVersao(normalizar(t.training_type));
  if (t.collaborator_id) jaExistem.add(`${t.collaborator_id}|${tN}`);
  else if (t.collaborator_name) jaExistemSemDono.add(`${chaveColab(t.collaborator_name, t.collaborator_soc)}|${tN}`);
}
console.log(`  ${existentes.length} assinaturas já registradas (${jaExistemSemDono.size} sem dono)\n`);

// ── 3. Validar ──────────────────────────────────────────────────────
const prontas = [], semVinculo = [], colabNaoAchado = [], duplicadas = [], nomeEstranho = new Map();

const dataDaLinha = (l) => {
  let quando = DATA_PADRAO ? `${DATA_PADRAO}T12:00:00-03:00` : new Date().toISOString();
  if (l.data) {
    const d = new Date(l.data.includes('/') ? l.data.split('/').reverse().join('-') : l.data);
    if (!isNaN(d.getTime())) quando = d.toISOString();
  }
  return quando;
};

for (const l of linhas) {
  const tNorm = semVersao(normalizar(l.treinamento));
  if (!nomesConhecidos.has(tNorm) && !acendeArea(l.treinamento)) {
    nomeEstranho.set(l.treinamento, (nomeEstranho.get(l.treinamento) ?? 0) + 1);
  }

  const c = porChave.get(chaveColab(l.nome, l.soc));

  // ── Colaborador não está (ainda) na base ──────────────────────
  // Acontece com unidade recém-criada, cujo quadro só entra na próxima
  // sincronização, e com quem já foi desligado. Nos dois casos o registro
  // é preservado com nome e unidade congelados nas colunas de snapshot —
  // depois, `node scripts/revincular_orfas.mjs` religa automaticamente
  // quem aparecer na base.
  if (!c) {
    colabNaoAchado.push(l);
    if (!SEM_VINCULO) continue;
    const chaveOrfa = `${chaveColab(l.nome, l.soc)}|${tNorm}`;
    if (jaExistemSemDono.has(chaveOrfa)) { duplicadas.push(l); continue; }
    jaExistemSemDono.add(chaveOrfa);
    semVinculo.push({
      collaborator_id:    null,
      collaborator_name:  l.nome.trim(),
      collaborator_soc:   l.soc.trim(),
      collaborator_opsid: null,
      training_type:      l.treinamento.trim(),
      instructor_name:    l.instrutor || INSTRUTOR_PADRAO,
      completed_at:       dataDaLinha(l),
      signature_pdf_url:  null,
    });
    continue;
  }

  if (jaExistem.has(`${c.id}|${tNorm}`)) { duplicadas.push(l); continue; }
  jaExistem.add(`${c.id}|${tNorm}`); // evita duplicar dentro da própria planilha

  prontas.push({
    collaborator_id:    c.id,
    collaborator_name:  c.name,
    collaborator_soc:   c.soc,
    collaborator_opsid: c.opsid,
    training_type:      l.treinamento.trim(),
    instructor_name:    l.instrutor || INSTRUTOR_PADRAO,
    completed_at:       dataDaLinha(l),
    // Sem imagem: é um registro histórico, não uma assinatura coletada na
    // tela. A coluna de assinatura na tela vai aparecer vazia — é esperado.
    signature_pdf_url:  null,
  });
}

console.log('=== VALIDAÇÃO ===');
console.log(`  ✓ vinculadas ao colaborador : ${prontas.length}`);
if (SEM_VINCULO) console.log(`  ✓ sem vínculo (com snapshot): ${semVinculo.length}`);
console.log(`  · já existiam               : ${duplicadas.length}`);
console.log(`  ${SEM_VINCULO ? '·' : '✗'} colaborador não achado     : ${colabNaoAchado.length}${SEM_VINCULO ? ' (preservadas pelo snapshot)' : ' (serão ignoradas)'}`);
console.log(`  ⚠ nomes não reconhecidos    : ${nomeEstranho.size}\n`);

if (colabNaoAchado.length > 0) {
  const porSoc = new Map();
  for (const l of colabNaoAchado) porSoc.set(l.soc, (porSoc.get(l.soc) ?? 0) + 1);
  console.log(`Colaboradores fora da base, por unidade:`);
  for (const [s, n] of [...porSoc.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(s).padEnd(6)} ${String(n).padStart(6)}`);
  }
  console.log(`   Amostra: ${colabNaoAchado.slice(0, 3).map(l => `"${l.nome}" (${l.soc})`).join(', ')}`);
  console.log();
}

if (nomeEstranho.size > 0) {
  console.log('⚠  NOMES DE TREINAMENTO FORA DO CATÁLOGO:');
  console.log('   Estes entram no banco mas NÃO acendem nenhum card do Dashboard.');
  for (const [nome, qtd] of nomeEstranho) console.log(`   ${qtd}x  "${nome}"`);
  console.log('\n   Nomes válidos mais próximos no catálogo:');
  for (const n of [...nomesConhecidos].slice(0, 12)) console.log(`     ${n}`);
  console.log();
}

if (nomeEstranho.size > 0 && !FORCAR) {
  console.log('Parando aqui. Corrija os nomes na planilha, ou rode com --forcar-nomes se');
  console.log('souber o que está fazendo.');
  process.exit(1);
}

const aInserir = [...prontas, ...semVinculo];

if (aInserir.length > 0) {
  console.log('Amostra do que será inserido:');
  for (const p of prontas.slice(0, 5)) {
    console.log(`   ${p.collaborator_name} (${p.collaborator_soc}) · ${p.training_type}`);
  }
  for (const p of semVinculo.slice(0, 3)) {
    console.log(`   ${p.collaborator_name} (${p.collaborator_soc}) · ${p.training_type}   [sem vínculo]`);
  }
  console.log(`   ... total: ${aInserir.length}`);
  console.log();
}

if (!APLICAR) {
  console.log('Nada foi gravado. Rode de novo com --aplicar para efetivar.');
  process.exit(0);
}

// ── 4. Gravar ───────────────────────────────────────────────────────
let ok = 0;
const erros = [];
for (let i = 0; i < aInserir.length; i += 200) {
  const lote = aInserir.slice(i, i + 200);
  const { error } = await db.from('trainings_completed').insert(lote);
  if (error) erros.push(`Lote ${i}-${i + lote.length}: ${error.message}`);
  else ok += lote.length;
  if (i % 2000 === 0 || i + 200 >= aInserir.length) {
    console.log(`  ${Math.min(i + 200, aInserir.length)}/${aInserir.length}...`);
  }
}

console.log('\n=== CONCLUÍDO ===');
console.log(`  inseridas: ${ok}  (${prontas.length} vinculadas + ${semVinculo.length} sem vínculo)`);
if (erros.length > 0) {
  console.log(`  falhas   : ${erros.length} lote(s)`);
  for (const e of erros.slice(0, 10)) console.log(`   ${e}`);
}
