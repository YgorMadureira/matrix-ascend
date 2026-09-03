// Mescla colaboradores duplicados por diferença de maiúsculo/minúsculo.
//
// Contexto: a normalização de texto para MAIÚSCULO (pedido de 03/09/2026)
// precisa rodar um UPDATE retroativo em `collaborators`, mas 187 pares de
// linhas hoje são a MESMA PESSOA cadastrada duas vezes — só o case do nome
// difere (ex.: "Erika de Jesus..." e "ERIKA DE JESUS..." na mesma SOC).
// Causa raiz: quando alguém "forma" do onboarding pra base ativa com o
// nome digitado numa caixa diferente da que a sincronização usa, o
// casamento por `ON CONFLICT (name, soc)` falha e cria uma pessoa nova em
// vez de atualizar a existente — fragmentando o histórico de treino dela.
//
// Um UPDATE cego bateria de frente no índice único idx_collaborators_name_soc_unique
// nesses 187 casos. Este script resolve a duplicidade ANTES disso.
//
// Política de escolha do "vencedor" (quem fica) de cada grupo — validada
// com o Ygor em 03/09/2026, olhando os 14 casos ambíguos um a um:
//   1. Se exatamente uma linha do grupo é líder (is_leader=true), ela vence
//      — preserva o id que outras pessoas já usam em leader_id (ex.: Daniel
//      Ferreira da Silva, BA2, tem 33 pessoas apontando pro id da linha de
//      líder dele; trocar de id exigiria retocar as 33).
//   2. Senão, vence quem tem MAIS assinaturas em trainings_completed.
//   3. Empate: vence quem tem opsid preenchido.
//   4. Empate: vence quem NÃO está em onboarding (já é base ativa).
//   5. Empate final: menor id (arbitrário, só pra ser determinístico).
//
// Antes de apagar o perdedor: reatribui toda referência a ele (assinaturas,
// leader_id de quem reporta a ele, matrícula/enrollments de agenda) para o
// vencedor, e copia o opsid do perdedor pro vencedor se o vencedor não
// tiver um.
//
//   node scripts/mesclar_duplicados_collaborators.mjs                 (só relatório, não grava nada)
//   node scripts/mesclar_duplicados_collaborators.mjs --executar      (aplica de verdade)

import { db, paginar } from './_conexao.mjs';
import xlsx from 'xlsx';

const EXECUTAR = process.argv.includes('--executar');

console.log('Lendo collaborators...');
const collabs = await paginar(
  'collaborators',
  'id,name,soc,is_leader,is_onboarding,opsid,role,leader,activity,shift,gender,bpo,admission_date',
  q => q.order('id')
);

console.log('Lendo trainings_completed...');
const assinaturas = await paginar('trainings_completed', 'id,collaborator_id,training_type', q => q.order('id'));
const assinPorId = new Map();
for (const a of assinaturas) {
  if (!a.collaborator_id) continue;
  if (!assinPorId.has(a.collaborator_id)) assinPorId.set(a.collaborator_id, []);
  assinPorId.get(a.collaborator_id).push(a);
}

// ── 1. Agrupar por identidade (nome + soc, sem diferenciar caixa) ──────
const grupos = new Map();
for (const c of collabs) {
  if (!c.name || !c.soc) continue;
  const chave = `${c.name.toUpperCase().trim()}|${c.soc.toUpperCase().trim()}`;
  if (!grupos.has(chave)) grupos.set(chave, []);
  grupos.get(chave).push(c);
}
const duplicados = [...grupos.entries()].filter(([, lista]) => lista.length > 1);
console.log(`\n${duplicados.length} grupos com mais de uma linha para a mesma pessoa/SOC.\n`);

if (duplicados.length === 0) {
  console.log('Nada para mesclar.');
  process.exit(0);
}

// ── 2. Decidir o vencedor de cada grupo ────────────────────────────────
function escolherVencedor(lista) {
  const comAssin = lista.map(c => ({ c, n: (assinPorId.get(c.id) || []).length }));

  const lideres = lista.filter(c => c.is_leader);
  if (lideres.length === 1) {
    return { vencedor: lideres[0], motivo: 'é a linha marcada como líder (preserva leader_id de quem reporta a ela)' };
  }

  const maxAssin = Math.max(...comAssin.map(x => x.n));
  let candidatos = comAssin.filter(x => x.n === maxAssin).map(x => x.c);
  if (candidatos.length === 1) {
    return { vencedor: candidatos[0], motivo: `tem mais assinaturas (${maxAssin})` };
  }

  const comOpsid = candidatos.filter(c => c.opsid && c.opsid.trim() && c.opsid.trim() !== '-');
  if (comOpsid.length >= 1 && comOpsid.length < candidatos.length) {
    candidatos = comOpsid;
    if (candidatos.length === 1) return { vencedor: candidatos[0], motivo: 'tem opsid preenchido' };
  }

  const naoOnboarding = candidatos.filter(c => !c.is_onboarding);
  if (naoOnboarding.length >= 1 && naoOnboarding.length < candidatos.length) {
    candidatos = naoOnboarding;
    if (candidatos.length === 1) return { vencedor: candidatos[0], motivo: 'já está na base ativa (não onboarding)' };
  }

  candidatos.sort((a, b) => a.id.localeCompare(b.id));
  return { vencedor: candidatos[0], motivo: 'empate total — desempate arbitrário por id' };
}

const plano = duplicados.map(([chave, lista]) => {
  const { vencedor, motivo } = escolherVencedor(lista);
  const perdedores = lista.filter(c => c.id !== vencedor.id);
  return { chave, vencedor, perdedores, motivo };
});

// ── 3. Relatório (sempre gerado, mesmo em modo --executar) ────────────
const linhasRelatorio = [];
for (const { chave, vencedor, perdedores, motivo } of plano) {
  const assinVencedor = (assinPorId.get(vencedor.id) || []).map(a => a.training_type);
  for (const perdedor of perdedores) {
    const assinPerdedor = (assinPorId.get(perdedor.id) || []).map(a => a.training_type);
    linhasRelatorio.push({
      'Pessoa (chave)': chave,
      'Fica (nome como está gravado)': vencedor.name,
      'Fica - id': vencedor.id,
      'Fica - opsid': vencedor.opsid || '',
      'Fica - assinaturas': assinVencedor.length,
      'Fica - é líder': vencedor.is_leader ? 'SIM' : '',
      'Sai (nome como está gravado)': perdedor.name,
      'Sai - id': perdedor.id,
      'Sai - opsid': perdedor.opsid || '',
      'Sai - assinaturas': assinPerdedor.length,
      'Sai - é líder': perdedor.is_leader ? 'SIM' : '',
      'Motivo da escolha': motivo,
      'Treinamentos que migram do perdedor pro vencedor': [...new Set(assinPerdedor)].join(' | '),
    });
  }
}

const livro = xlsx.utils.book_new();
const abaResumo = xlsx.utils.aoa_to_sheet([
  ['Mesclagem de colaboradores duplicados por maiúsculo/minúsculo'],
  ['Gerado em', new Date().toLocaleString('pt-BR')],
  ['Modo', EXECUTAR ? 'EXECUTADO — as mesclagens abaixo já foram aplicadas no banco' : 'SIMULAÇÃO — nada foi gravado no banco'],
  [],
  ['Grupos duplicados encontrados', duplicados.length],
  ['Linhas que serão/foram apagadas', linhasRelatorio.length],
  ['Grupos decididos por ser líder (regra 1)', plano.filter(p => p.motivo.includes('líder')).length],
  ['Grupos decididos por mais assinaturas (regra 2)', plano.filter(p => p.motivo.includes('mais assinaturas')).length],
  ['Grupos decididos por ter opsid (regra 3)', plano.filter(p => p.motivo.includes('opsid')).length],
  ['Grupos decididos por não estar em onboarding (regra 4)', plano.filter(p => p.motivo.includes('base ativa')).length],
  ['Grupos com empate total (regra 5)', plano.filter(p => p.motivo.includes('empate')).length],
]);
xlsx.utils.book_append_sheet(livro, abaResumo, 'Resumo');

const abaDetalhe = xlsx.utils.json_to_sheet(linhasRelatorio);
xlsx.utils.book_append_sheet(livro, abaDetalhe, 'Mesclagens');

const nomeArquivo = EXECUTAR ? 'mesclagem_duplicados_EXECUTADA.xlsx' : 'mesclagem_duplicados_SIMULACAO.xlsx';
xlsx.writeFile(livro, nomeArquivo);
console.log(`Planilha gerada: ${nomeArquivo}`);

if (!EXECUTAR) {
  console.log('\nModo simulação — nada foi alterado no banco.');
  console.log('Revise a planilha. Quando confirmar, rode com --executar para aplicar de verdade.');
  process.exit(0);
}

// ── 4. Execução real ───────────────────────────────────────────────────
console.log('\n=== EXECUTANDO ===\n');

let reatribuidos = 0;
let apagados = 0;
const erros = [];

for (const { vencedor, perdedores, chave } of plano) {
  for (const perdedor of perdedores) {
    try {
      // Assinaturas do perdedor passam a ser do vencedor.
      const { error: e1 } = await db.from('trainings_completed').update({ collaborator_id: vencedor.id }).eq('collaborator_id', perdedor.id);
      if (e1) throw new Error(`trainings_completed: ${e1.message}`);

      // Quem reporta ao perdedor (leader_id) passa a reportar ao vencedor.
      const { error: e2 } = await db.from('collaborators').update({ leader_id: vencedor.id }).eq('leader_id', perdedor.id);
      if (e2) throw new Error(`leader_id: ${e2.message}`);

      // Matrículas de agenda e solicitações, se existirem apontando pro perdedor.
      for (const tabela of ['training_schedule_enrollments', 'training_scheduling_request_collaborators']) {
        const { error } = await db.from(tabela).update({ collaborator_id: vencedor.id }).eq('collaborator_id', perdedor.id);
        if (error && error.code !== '42P01') throw new Error(`${tabela}: ${error.message}`);
      }

      // Vencedor absorve opsid e is_leader do perdedor, se o vencedor não tiver.
      const patchVencedor = {};
      if ((!vencedor.opsid || !vencedor.opsid.trim() || vencedor.opsid.trim() === '-') && perdedor.opsid && perdedor.opsid.trim() && perdedor.opsid.trim() !== '-') {
        patchVencedor.opsid = perdedor.opsid;
      }
      if (perdedor.is_leader && !vencedor.is_leader) patchVencedor.is_leader = true;
      if (Object.keys(patchVencedor).length > 0) {
        const { error: e3 } = await db.from('collaborators').update(patchVencedor).eq('id', vencedor.id);
        if (e3) throw new Error(`patch vencedor: ${e3.message}`);
      }

      // Só agora apaga o perdedor — já não há mais nada apontando pra ele.
      const { error: e4 } = await db.from('collaborators').delete().eq('id', perdedor.id);
      if (e4) throw new Error(`delete: ${e4.message}`);

      reatribuidos++;
      apagados++;
    } catch (err) {
      erros.push(`${chave}: ${err.message}`);
      console.error(`  ✗ ${chave}: ${err.message}`);
    }
  }
}

console.log(`\n${apagados} linhas mescladas e removidas.`);
if (erros.length) {
  console.log(`${erros.length} erro(s) — não paralisou o restante, mas precisa revisar:`);
  for (const e of erros) console.log(`   ${e}`);
}

console.log('\nRodando resolve_leader_links() para refazer o vínculo de líder...');
const { data: linksData, error: linksErr } = await db.rpc('resolve_leader_links');
if (linksErr) console.error('  ✗ ' + linksErr.message);
else console.log(`  ${linksData} vínculo(s) atualizados.`);

process.exit(erros.length ? 1 : 0);
