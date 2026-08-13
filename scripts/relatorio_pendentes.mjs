// Relatório: colaboradores pendentes de treinamento, em todas as unidades.
//
// "Pendente" aqui é o MESMO critério usado pelo Dashboard e por
// CollaboratorsPage (coluna is_trained da view collaborators_status,
// ver supabase/migrations/20260812_04) — não é um cálculo à parte.
//
//   node scripts/relatorio_pendentes.mjs
//   node scripts/relatorio_pendentes.mjs --soc SP6        (só uma unidade)
//   node scripts/relatorio_pendentes.mjs --saida nome.xlsx

import { db, paginar } from './_conexao.mjs';
import xlsx from 'xlsx';

const args = process.argv.slice(2);
const opcao = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};
const SOC_FILTRO = opcao('--soc', null);
const SAIDA = opcao('--saida', SOC_FILTRO ? `pendentes_${SOC_FILTRO}.xlsx` : 'pendentes_treinamento.xlsx');

console.log('Lendo colaboradores...');
const todos = await paginar(
  'collaborators_status',
  'id,name,opsid,gender,soc,sector,shift,leader,role,bpo,is_onboarding,admission_date,activity,is_trained,onboarding_modules',
  SOC_FILTRO ? q => q.eq('soc', SOC_FILTRO) : undefined
);

const pendentes = todos
  .filter(c => !c.is_trained)
  .sort((a, b) => (a.soc || '').localeCompare(b.soc || '') || (a.name || '').localeCompare(b.name || ''));

console.log(`  ${todos.length} colaboradores${SOC_FILTRO ? ` em ${SOC_FILTRO}` : ' no total'}`);
console.log(`  ${pendentes.length} pendentes de treinamento\n`);

if (pendentes.length === 0) {
  console.log('Ninguém pendente — nada a gerar.');
  process.exit(0);
}

// Assinaturas de cada pendente — para a analista ver, linha a linha, o que
// a pessoa já assinou (mesmo que nada disso tenha batido com a regra de
// "treinado"). Uma query em massa, não uma por colaborador.
console.log('Lendo assinaturas dos pendentes...');
const idsPendentes = new Set(pendentes.map(c => c.id));
const assinaturas = await paginar('trainings_completed', 'collaborator_id,training_type,completed_at');
const assinaturasPorColab = new Map();
for (const a of assinaturas) {
  if (!a.collaborator_id || !idsPendentes.has(a.collaborator_id)) continue;
  if (!assinaturasPorColab.has(a.collaborator_id)) assinaturasPorColab.set(a.collaborator_id, []);
  assinaturasPorColab.get(a.collaborator_id).push(a);
}

const livro = xlsx.utils.book_new();

// ── Aba 1: todos os dados do colaborador + o que ele já assinou ─────
const formatarData = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '';
const cabecalho = [
  'Nome', 'OPSID', 'SOC', 'Setor', 'Cargo', 'Turno', 'Líder', 'Gênero', 'BPO',
  'Em Onboarding', 'Data de Admissão', 'Atividade',
  'Qtd. Assinaturas', 'Treinamentos Assinados (sem bater com a regra)', 'Última Assinatura',
];
const linhasLista = [
  cabecalho,
  ...pendentes.map(c => {
    const assin = (assinaturasPorColab.get(c.id) ?? []).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
    return [
      c.name, c.opsid || '', c.soc, c.sector || '(sem setor)', c.role || '', c.shift || '',
      c.leader || '', c.gender || '', c.bpo || '',
      c.is_onboarding ? 'Sim' : 'Não', formatarData(c.admission_date), c.activity || '',
      assin.length,
      [...new Set(assin.map(a => a.training_type))].join(' | '),
      assin.length ? formatarData(assin[0].completed_at) : '',
    ];
  }),
];
const abaLista = xlsx.utils.aoa_to_sheet(linhasLista);
abaLista['!cols'] = [
  { wch: 34 }, { wch: 12 }, { wch: 7 }, { wch: 15 }, { wch: 22 }, { wch: 10 },
  { wch: 22 }, { wch: 9 }, { wch: 8 }, { wch: 13 }, { wch: 15 }, { wch: 16 },
  { wch: 15 }, { wch: 50 }, { wch: 15 },
];
abaLista['!autofilter'] = { ref: `A1:${xlsx.utils.encode_col(cabecalho.length - 1)}${linhasLista.length}` };
xlsx.utils.book_append_sheet(livro, abaLista, 'Pendentes');

// ── Aba 2: resumo por unidade ────────────────────────────────────────
const porSoc = new Map();
for (const c of todos) {
  if (!porSoc.has(c.soc)) porSoc.set(c.soc, { total: 0, pendentes: 0 });
  const v = porSoc.get(c.soc);
  v.total++;
  if (!c.is_trained) v.pendentes++;
}
const linhasResumo = [
  ['SOC', 'Total', 'Pendentes', 'Treinados', '% Treinado'],
  ...[...porSoc.entries()]
    .sort((a, b) => b[1].pendentes - a[1].pendentes)
    .map(([soc, v]) => [soc, v.total, v.pendentes, v.total - v.pendentes, v.total ? Math.round((1 - v.pendentes / v.total) * 100) / 100 : 0]),
];
const abaResumo = xlsx.utils.aoa_to_sheet(linhasResumo);
abaResumo['!cols'] = [{ wch: 8 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 11 }];
for (let i = 1; i < linhasResumo.length; i++) {
  const cel = abaResumo[xlsx.utils.encode_cell({ r: i, c: 4 })];
  if (cel) cel.z = '0%';
}
xlsx.utils.book_append_sheet(livro, abaResumo, 'Resumo por unidade');

// ── Aba 3: resumo por setor ───────────────────────────────────────────
const porSetor = new Map();
for (const c of pendentes) {
  const s = c.sector || '(sem setor)';
  porSetor.set(s, (porSetor.get(s) ?? 0) + 1);
}
const linhasSetor = [
  ['Setor', 'Pendentes'],
  ...[...porSetor.entries()].sort((a, b) => b[1] - a[1]),
];
const abaSetor = xlsx.utils.aoa_to_sheet(linhasSetor);
abaSetor['!cols'] = [{ wch: 26 }, { wch: 11 }];
xlsx.utils.book_append_sheet(livro, abaSetor, 'Resumo por setor');

xlsx.writeFile(livro, SAIDA);
console.log(`✅ ${SAIDA} gerado.`);
console.log(`   abas: ${livro.SheetNames.join(', ')}`);
