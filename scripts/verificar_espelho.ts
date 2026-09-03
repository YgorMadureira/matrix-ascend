// ============================================================
// O espelho SQL ainda responde igual ao motor TypeScript?
// ============================================================
// Rode:  npx vite-node scripts/verificar_espelho.ts
//
// POR QUE ESTE SCRIPT EXISTE
// A regra de "quem está treinado" vive em dois lugares por necessidade:
// src/lib/trainingRules.ts (Dashboard e Relatórios) e as funções do banco
// (tela de Colaboradores e gráfico Desempenho por SOC, que leem da view
// collaborators_status). Nada garantia que os dois continuassem iguais.
//
// Em 03/09/2026 eles divergiram por um detalhe de uma linha: o TypeScript
// exigia a frase "ONBOARDING PTS" colada, o SQL aceitava "onboarding" e
// "pts" em qualquer posição. O nome real "Onboarding Novos Colaboradores
// PTS" caiu no meio: 852 pessoas apareciam CERTIFICADO numa tela e
// PENDENTE na outra, e SP2 mostrava 32,5% num lugar e 77,9% no outro.
// Ninguém percebeu por semanas porque nada comparava os dois lados.
//
// Rode isto depois de QUALQUER mudança de regra — nos dois lados.
// Saída esperada: "✅ nenhuma divergência".
// ============================================================

import { db, paginar } from './_conexao.mjs';
import { isAreaTrained, isCollaboratorTrained, type MacroArea } from '../src/lib/trainingRules';

const AREAS: MacroArea[] = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'ASM'];

// .order() é obrigatório: sem chave estável o .range() do PostgREST pode
// pular e repetir linhas entre as páginas, e o diagnóstico sai errado.
const socs = await paginar('socs', 'name,has_sorting');
const temSorter = new Map<string, boolean>(socs.map((s: any) => [s.name, !!s.has_sorting]));

const collabs = await paginar(
  'collaborators',
  'id,name,soc,sector,activity,is_leader',
  (q: any) => q.order('id'),
);
const assinaturas = await paginar(
  'trainings_completed',
  'id,collaborator_id,training_type',
  (q: any) => q.order('id'),
);
const status = await paginar('collaborators_status', 'id,is_trained', (q: any) => q.order('id'));

const treinosPor = new Map<string, string[]>();
for (const t of assinaturas as any[]) {
  if (!t.collaborator_id) continue;
  if (!treinosPor.has(t.collaborator_id)) treinosPor.set(t.collaborator_id, []);
  treinosPor.get(t.collaborator_id)!.push(t.training_type || '');
}
const vereditoSql = new Map<string, boolean>((status as any[]).map(r => [r.id, !!r.is_trained]));

let problemas = 0;

// ── 1. Nome por nome: que áreas cada lado acende? ────────────
// isAreaTrained é o equivalente exato de training_unlocks_area (os dois
// respondem "este treinamento acende esta área?", sem olhar a pessoa).
const nomes = [...new Set((assinaturas as any[]).map(t => t.training_type || '').filter(Boolean))];
const usos = new Map<string, number>();
for (const t of assinaturas as any[]) {
  const k = t.training_type || '';
  usos.set(k, (usos.get(k) || 0) + 1);
}

console.log(`\n── 1. ${nomes.length} nomes de treinamento em uso ──\n`);
// Os dois cenários: o que um nome credencia depende da unidade desde
// 03/09/2026 ("Onboarding Novos Colaboradores PTS" acende ASM só com Sorter).
for (const comSorter of [false, true]) {
  for (const nome of nomes.sort((a, b) => (usos.get(b) || 0) - (usos.get(a) || 0))) {
    const ts: string[] = [];
    const sql: string[] = [];
    for (const area of AREAS) {
      if (isAreaTrained([nome], area, comSorter)) ts.push(area);
      const { data, error } = await db.rpc('training_unlocks_area', {
        training_type: nome,
        area,
        has_sorting: comSorter,
      });
      if (error) {
        console.error(`\n  ✗ não consegui chamar training_unlocks_area: ${error.message}`);
        console.error('    Se a mensagem fala em função inexistente, falta rodar a migração');
        console.error('    supabase/migrations/20260903_01_alinha_espelho_sql.sql.\n');
        process.exit(1);
      }
      if (data === true) sql.push(area);
    }
    if (ts.sort().join() !== sql.sort().join()) {
      problemas++;
      console.log(`  ✗ "${nome}" (${usos.get(nome)} assinaturas) — SOC ${comSorter ? 'COM' : 'SEM'} Sorter`);
      console.log(`      TypeScript acende: ${ts.length ? ts.join(', ') : '(nada)'}`);
      console.log(`      SQL        acende: ${sql.length ? sql.join(', ') : '(nada)'}`);
    }
  }
}
if (problemas === 0) console.log('  ✅ todos classificados igual pelos dois lados, com e sem Sorter');

// ── 2. Pessoa por pessoa: o veredito final bate? ─────────────
console.log(`\n── 2. ${collabs.length} colaboradores ──\n`);
const divergentes: { soc: string; nome: string; setor: string; ts: boolean; treinos: string[] }[] = [];
for (const c of collabs as any[]) {
  const sql = vereditoSql.get(c.id);
  if (sql === undefined) continue; // fora da view (RLS ou removido no meio da leitura)
  const treinos = treinosPor.get(c.id) || [];
  const ts = isCollaboratorTrained(c.sector, treinos, temSorter.get(c.soc) ?? false, c.activity, c.is_leader);
  if (ts !== sql) {
    divergentes.push({ soc: c.soc, nome: c.name, setor: c.sector ?? '(vazio)', ts, treinos: [...new Set(treinos)] });
  }
}

if (divergentes.length === 0) {
  console.log('  ✅ veredito idêntico para todo mundo');
} else {
  problemas += divergentes.length;
  const porSoc = new Map<string, number>();
  for (const d of divergentes) porSoc.set(d.soc || '(sem SOC)', (porSoc.get(d.soc || '(sem SOC)') || 0) + 1);
  console.log(`  ✗ ${divergentes.length} pessoas com veredito diferente:\n`);
  for (const [soc, n] of [...porSoc].sort((a, b) => b[1] - a[1])) console.log(`      ${soc.padEnd(10)} ${n}`);
  console.log('\n  Exemplos:');
  for (const d of divergentes.slice(0, 10)) {
    console.log(`      ${d.soc} | ${d.nome} | setor: ${d.setor}`);
    console.log(`         TS: ${d.ts ? 'TREINADO' : 'PENDENTE'} | banco: ${d.ts ? 'PENDENTE' : 'TREINADO'}`);
    console.log(`         assinaturas: ${d.treinos.join(' | ') || '(nenhuma)'}`);
  }
}

console.log(
  problemas === 0
    ? '\n✅ nenhuma divergência — os dois lados respondem igual.\n'
    : `\n❌ ${problemas} divergência(s). A regra mora em src/lib/trainingRules.ts; o espelho, em supabase/migrations.\n`,
);
process.exit(problemas === 0 ? 0 : 1);
