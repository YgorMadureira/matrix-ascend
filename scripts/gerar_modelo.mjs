// Gera a planilha modelo para importar assinaturas em massa.
//
//   node scripts/gerar_modelo.mjs
//
// Funciona sem a chave de serviço: nesse caso a aba de treinamentos válidos
// traz só os nomes fixos das regras. Com a chave no .env, ele consulta o
// banco e traz TAMBÉM os processos micro cadastrados em cada unidade — que
// é justamente a parte que varia de SOC para SOC.

import xlsx from 'xlsx';
import fs from 'node:fs';

const SAIDA = process.argv[2] || 'modelo_assinaturas.xlsx';

// ── Nomes que as regras do Dashboard reconhecem por padrão ─────────
// Fonte: src/lib/trainingRules.ts (areasUnlockedBy) e o bloco
// ONBOARDING_MODULES de src/pages/CollaboratorsPage.tsx.
const FIXOS = [
  ['Onboarding PTS',                        'Acende Recebimento, Processamento e Expedição'],
  ['Onboarding PTS Com Sorter',             'Acende Recebimento, Processamento, Expedição e ASM'],
  ['Treinamento Padrão SOC - Recebimento',  'Acende a macro-área Recebimento'],
  ['Treinamento Padrão SOC - Processamento','Acende a macro-área Processamento'],
  ['Treinamento Padrão SOC - Expedição',    'Acende a macro-área Expedição'],
  ['Treinamento Padrão SOC - Tratativas',   'Acende a macro-área Tratativas'],
  ['Treinamento Padrão SOC - ASM',          'Acende ASM (só em unidades com sorter)'],
  ['Onboarding HSE',                        'Módulo de onboarding — não acende macro-área'],
  ['Onboarding Meio Ambiente',              'Módulo de onboarding — não acende macro-área'],
  ['Onboarding Security',                   'Módulo de onboarding — não acende macro-área'],
  ['Onboarding Qualidade',                  'Módulo de onboarding — não acende macro-área'],
  ['Onboarding People',                     'Módulo de onboarding — não acende macro-área'],
];

// ── Se houver chave no .env, busca o que é específico de cada unidade ──
let doBanco = [];
let socs = [];
try {
  const { db, paginar } = await import('./_conexao.mjs');
  const { data: catalogo } = await db.from('trainings').select('name').order('name');
  const micros = await paginar('soc_micro_trainings', 'name, soc_name');
  const { data: unidades } = await db.from('socs').select('name').order('name');

  socs = (unidades ?? []).map(s => s.name).filter(Boolean);

  const vistos = new Set(FIXOS.map(f => f[0].toUpperCase()));
  for (const t of catalogo ?? []) {
    if (t.name && !vistos.has(t.name.toUpperCase())) {
      vistos.add(t.name.toUpperCase());
      doBanco.push([t.name, 'Cadastrado em Treinamentos']);
    }
  }
  for (const m of micros) {
    const chave = `${m.name}`.toUpperCase();
    if (m.name && !vistos.has(chave)) {
      vistos.add(chave);
      doBanco.push([m.name, `Processo micro — unidade ${m.soc_name}`]);
    }
  }
  console.log(`Banco consultado: +${doBanco.length} nomes, ${socs.length} unidades.`);
} catch {
  console.log('Sem chave no .env — gerando com os nomes fixos das regras.');
  console.log('Coloque SUPABASE_SERVICE_ROLE_KEY no .env e rode de novo para incluir');
  console.log('os processos micro de cada unidade.\n');
}

const livro = xlsx.utils.book_new();

// ── Aba 1: onde você preenche ───────────────────────────────────────
const dados = [
  ['Colaborador', 'Treinamento', 'SOC', 'Data', 'Instrutor'],
  ['MARIA APARECIDA DA SILVA', 'Treinamento Padrão SOC - Recebimento', 'SP6', '05/08/2026', 'RODRIGO SOUZA'],
  ['JOAO PEDRO SANTOS',        'Onboarding PTS',                       'SP6', '05/08/2026', 'RODRIGO SOUZA'],
  ['ANA CAROLINA LIMA',        'Treinamento Padrão SOC - Expedição',   'ES2', '',           ''],
];
const abaDados = xlsx.utils.aoa_to_sheet(dados);
abaDados['!cols'] = [{ wch: 38 }, { wch: 42 }, { wch: 8 }, { wch: 12 }, { wch: 24 }];
xlsx.utils.book_append_sheet(livro, abaDados, 'Assinaturas');

// ── Aba 2: como preencher ───────────────────────────────────────────
const instrucoes = [
  ['COMO PREENCHER'],
  [''],
  ['1. Apague as 3 linhas de exemplo da aba "Assinaturas" e ponha os seus dados.'],
  ['2. Não mude os nomes das colunas nem a ordem das abas.'],
  [''],
  ['COLUNAS OBRIGATÓRIAS'],
  ['Colaborador', 'O nome EXATAMENTE como está cadastrado no sistema.'],
  ['',            'Acento e pontuação não atrapalham; nome incompleto sim.'],
  ['',            'Confira na tela Colaboradores se tiver dúvida.'],
  ['Treinamento', 'Precisa ser um dos nomes da aba "Treinamentos válidos".'],
  ['',            'Este é o campo que mais dá problema — leia o aviso abaixo.'],
  ['SOC',         'A unidade do colaborador. Ex: SP6, ES2, RS2.'],
  [''],
  ['COLUNAS OPCIONAIS'],
  ['Data',      'Quando o treinamento foi feito, no formato DD/MM/AAAA.'],
  ['',          'Se deixar em branco, entra a data da importação.'],
  ['',          'Vale preencher: a Agenda usa validade de 6 meses.'],
  ['Instrutor', 'Quem aplicou. Em branco, entra "IMPORTACAO".'],
  [''],
  ['⚠ POR QUE O NOME DO TREINAMENTO IMPORTA TANTO'],
  ['O Dashboard não pergunta "existe uma assinatura?". Ele casa o NOME do'],
  ['treinamento com as regras de certificação. Um nome fora do padrão entra'],
  ['no banco, aparece na tela de Assinaturas e não acende card nenhum — dá'],
  ['a impressão de que funcionou, mas o % de treinados não sobe.'],
  [''],
  ['O script confere cada nome antes de gravar e para se algum não bater,'],
  ['então não tem como errar sem perceber. Mas quanto mais certo vier da'],
  ['planilha, menos ida e volta.'],
  [''],
  ['O QUE ACONTECE COM DUPLICATAS'],
  ['Se o colaborador já tem aquele treinamento registrado, a linha é pulada.'],
  ['Pode reenviar a mesma planilha sem medo de duplicar.'],
];
const abaInstr = xlsx.utils.aoa_to_sheet(instrucoes);
abaInstr['!cols'] = [{ wch: 16 }, { wch: 70 }];
xlsx.utils.book_append_sheet(livro, abaInstr, 'Instruções');

// ── Aba 3: nomes aceitos ────────────────────────────────────────────
const validos = [
  ['Treinamento', 'O que ele faz'],
  ...FIXOS,
  ...(doBanco.length ? [['', ''], ['— cadastrados no sistema —', '']] : []),
  ...doBanco,
];
const abaValidos = xlsx.utils.aoa_to_sheet(validos);
abaValidos['!cols'] = [{ wch: 52 }, { wch: 46 }];
xlsx.utils.book_append_sheet(livro, abaValidos, 'Treinamentos válidos');

// ── Aba 4: unidades (só quando veio do banco) ───────────────────────
if (socs.length > 0) {
  const abaSocs = xlsx.utils.aoa_to_sheet([['SOC'], ...socs.map(s => [s])]);
  abaSocs['!cols'] = [{ wch: 12 }];
  xlsx.utils.book_append_sheet(livro, abaSocs, 'Unidades');
}

xlsx.writeFile(livro, SAIDA);
console.log(`\n✅ ${SAIDA} gerado (${(fs.statSync(SAIDA).size / 1024).toFixed(1)} KB)`);
console.log(`   abas: ${livro.SheetNames.join(', ')}`);
