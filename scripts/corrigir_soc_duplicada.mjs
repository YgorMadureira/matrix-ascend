// Corrige duplicatas criadas quando a planilha manda o colaborador numa SOC
// e o banco tem a MESMA pessoa gravada em outra.
//
// ── O INCIDENTE QUE ORIGINOU ISTO (22/09/2026) ──────────────
// A aba de SP35 na planilha parou de preencher a coluna SOC. A Edge Function
// tinha um padrão herdado — SOC vazia virava 'SP6' — então em 16/09 as ~550
// pessoas de SP35 foram gravadas como SP6, duplicando quem já existia em
// SP35. Quando a planilha foi corrigida, a sincronização recriou/atualizou
// as linhas certas em SP35 (o upsert roda ANTES da remoção) e tentou remover
// as linhas de SP6 — 609 de uma vez, o que a trava por unidade bloqueou,
// como devia.
//
// Resultado: a mesma pessoa em duas linhas, em SOCs diferentes. A linha
// certa (a que a planilha aponta) tem o histórico; a errada é a duplicata.
//
// ⚠️ POR QUE NÃO BASTA APAGAR A LINHA ERRADA
// Entre a criação da duplicata e a correção, assinaturas podem ter sido
// registradas NELA (foram 9 neste incidente). Apagar direto jogaria essas
// assinaturas para órfãs — e a religação automática não as recuperaria,
// porque ela casa por nome + SOC, e a SOC gravada na assinatura é a errada.
// Então: primeiro realoca tudo o que aponta para a linha errada, só depois
// apaga.
//
// COMO DECIDE QUEM FICA: a planilha é a fonte da verdade. Fica a linha cuja
// (nome, SOC) existe na planilha; sai a outra. Não depende de contagem de
// assinaturas — o que estiver na linha que sai é realocado de qualquer forma.
//
// Só age quando NÃO há ambiguidade: o nome tem de aparecer na planilha em
// exatamente uma SOC, e a linha de destino tem de existir no banco.
//
//   node scripts/corrigir_soc_duplicada.mjs              (simulação)
//   node scripts/corrigir_soc_duplicada.mjs --aplicar    (grava)

import { db, paginar } from './_conexao.mjs';
import { parseDelimitedText, mapCollaboratorRow } from '../src/lib/csvParser.ts';
import fs from 'node:fs';

const APLICAR = process.argv.includes('--aplicar');
const GSHEET = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0LwfzukkjRDLD-NqioPJoWmFv5FfeDfUdInkavetnDr7p-OhoB-sKvvXWqy6jilxBc4g8olgkOjsJ/pub?gid=0&single=true&output=csv';
const N = (s) => (s || '').toUpperCase().trim();
const LIDER = /(LÍDER|LIDER|INSTRUTOR|COORDENADOR|GERENTE|SUPERVISOR)/;

console.log(APLICAR ? '=== MODO GRAVAÇÃO ===\n' : '=== SIMULAÇÃO (nada será gravado) ===\n');

console.log('Lendo a planilha...');
const { header, rows } = parseDelimitedText(await (await fetch(GSHEET)).text());
const planilha = rows.map(r => mapCollaboratorRow(r, header)).filter(r => r.name && r.name.length > 1);
console.log(`  ${planilha.length} linhas válidas.`);

const socsPorNome = new Map();
for (const r of planilha) {
  const k = N(r.name);
  if (!socsPorNome.has(k)) socsPorNome.set(k, new Set());
  socsPorNome.get(k).add(N(r.soc));
}

console.log('Lendo o banco...');
const collabs = await paginar('collaborators', 'id,name,soc,created_at,is_onboarding,is_leader,role', q => q.order('id'));
const assinaturas = await paginar('trainings_completed', 'id,collaborator_id', q => q.order('id'));
const nAssin = new Map();
for (const a of assinaturas) if (a.collaborator_id) nAssin.set(a.collaborator_id, (nAssin.get(a.collaborator_id) || 0) + 1);
const porChave = new Map();
for (const c of collabs) porChave.set(N(c.name) + '|' + N(c.soc), c);

// ── Monta os pares (linha errada → linha certa) ───────────────
const pares = [];
const ambiguos = [];
const semParNaPlanilha = [];

for (const c of collabs) {
  if (c.is_onboarding || c.is_leader || LIDER.test((c.role || '').toUpperCase())) continue;
  const socs = socsPorNome.get(N(c.name));
  if (!socs) continue;                       // não está na planilha: saída real, o sync remove
  if (socs.has(N(c.soc))) continue;          // a planilha confirma a SOC desta linha: está certa
  const alvos = [...socs].filter(s => s !== '');
  if (alvos.length !== 1) { ambiguos.push(c); continue; }
  const certa = porChave.get(N(c.name) + '|' + alvos[0]);
  if (!certa) { semParNaPlanilha.push({ c, alvo: alvos[0] }); continue; }
  pares.push({ errada: c, certa, de: N(c.soc), para: alvos[0] });
}

const porRota = new Map();
for (const p of pares) porRota.set(`${p.de} -> ${p.para}`, (porRota.get(`${p.de} -> ${p.para}`) || 0) + 1);

console.log(`\nDuplicatas por SOC errada: ${pares.length}`);
for (const [rota, n] of [...porRota].sort((a, b) => b[1] - a[1])) console.log(`  ${rota.padEnd(18)} ${n}`);
console.log(`\n  assinaturas presas na linha ERRADA (serão realocadas): ${pares.reduce((s, p) => s + (nAssin.get(p.errada.id) || 0), 0)}`);
console.log(`  assinaturas já na linha CERTA (não se mexe): ${pares.reduce((s, p) => s + (nAssin.get(p.certa.id) || 0), 0)}`);
console.log(`\n  nome em mais de uma SOC na planilha (não toco): ${ambiguos.length}`);
console.log(`  SOC mudou mas a linha nova ainda não existe (o sync cria): ${semParNaPlanilha.length}`);

if (pares.length) {
  console.log('\n  Amostra:');
  for (const p of pares.slice(0, 5)) {
    console.log(`    ${p.errada.name}: sai ${p.de} (${nAssin.get(p.errada.id) || 0} assin) -> fica ${p.para} (${nAssin.get(p.certa.id) || 0} assin)`);
  }
}

if (!APLICAR) {
  console.log('\nNada foi gravado. Rode de novo com --aplicar para efetivar.');
  process.exit(0);
}
if (!pares.length) process.exit(0);

// ── Gravação: realoca tudo, só então apaga ────────────────────
let realocadas = 0, apagadas = 0;
const erros = [];
const registro = [];

for (const p of pares) {
  try {
    const { error: e1 } = await db.from('trainings_completed').update({ collaborator_id: p.certa.id }).eq('collaborator_id', p.errada.id);
    if (e1) throw new Error('assinaturas: ' + e1.message);

    const { error: e2 } = await db.from('collaborators').update({ leader_id: p.certa.id }).eq('leader_id', p.errada.id);
    if (e2) throw new Error('leader_id: ' + e2.message);

    for (const tabela of ['training_schedule_enrollments', 'training_scheduling_request_collaborators']) {
      const { error } = await db.from(tabela).update({ collaborator_id: p.certa.id }).eq('collaborator_id', p.errada.id);
      if (error && error.code !== '42P01') throw new Error(`${tabela}: ${error.message}`);
    }

    const { error: e3 } = await db.from('collaborators').delete().eq('id', p.errada.id);
    if (e3) throw new Error('delete: ' + e3.message);

    registro.push({ nome: p.errada.name, id_apagado: p.errada.id, soc_errada: p.de, id_mantido: p.certa.id, soc_certa: p.para, assinaturas_realocadas: nAssin.get(p.errada.id) || 0 });
    realocadas += nAssin.get(p.errada.id) || 0;
    apagadas++;
  } catch (err) {
    erros.push(`${p.errada.name} (${p.de}): ${err.message}`);
    console.error(`  ✗ ${p.errada.name}: ${err.message}`);
  }
}

console.log(`\n=== CONCLUÍDO ===`);
console.log(`  duplicatas apagadas   : ${apagadas}`);
console.log(`  assinaturas realocadas: ${realocadas}`);
if (erros.length) console.log(`  erros: ${erros.length}`);

const arquivo = `correcao_soc_duplicada_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
fs.writeFileSync(arquivo, JSON.stringify(registro, null, 2));
console.log(`\nRegistro do que foi feito: ${arquivo}`);
process.exit(erros.length ? 1 : 0);
