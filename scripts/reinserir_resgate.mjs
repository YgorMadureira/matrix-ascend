// Reinsere o pacote de resgate (resgate_pos_backup_11-08.json) DEPOIS de
// restaurar o backup do Supabase.
//
// Contexto: o backup do dia 11/08 07:30 UTC não contém o que foi criado
// depois dele — 76 assinaturas, 4 instrutores, 1 processo micro e 1 material.
// Este script recoloca esses registros, casando o colaborador por
// (nome, SOC) em vez de por id, porque os ids mudam na restauração.
//
// Uso:
//   SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/reinserir_resgate.mjs
//
// É seguro rodar mais de uma vez: registros já existentes são pulados.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const URL = process.env.SUPABASE_URL || 'https://fezfsekzxtvozyemlncn.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY antes de rodar.');
  console.error('  PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY="sua_chave"; node scripts/reinserir_resgate.mjs');
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const ARQUIVO = process.argv[2] || 'resgate_pos_backup_11-08.json';
if (!fs.existsSync(ARQUIVO)) { console.error('Arquivo não encontrado:', ARQUIVO); process.exit(1); }
const pacote = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));

const chave = (n, s) => `${(n || '').toUpperCase().trim()}|${(s || '').toUpperCase().trim()}`;

console.log('Lendo colaboradores restaurados...');
let cols = [], p = 0;
while (true) {
  const { data, error } = await db.from('collaborators').select('id,name,soc').range(p * 1000, (p + 1) * 1000 - 1);
  if (error) { console.error('Erro ao ler colaboradores:', error.message); process.exit(1); }
  cols.push(...(data ?? []));
  if (!data || data.length < 1000) break;
  p++;
}
const porChave = new Map(cols.map(c => [chave(c.name, c.soc), c.id]));
console.log(`  ${cols.length} colaboradores na base.\n`);

// ── Assinaturas ────────────────────────────────────────────────
const tr = pacote.trainings_completed ?? [];
let inseridas = 0, jaExistiam = 0, semDono = 0, falhas = 0;

for (const t of tr) {
  const { data: existe } = await db.from('trainings_completed').select('id').eq('id', t.id).maybeSingle();
  if (existe) { jaExistiam++; continue; }

  let collaboratorId = null;
  if (t._colaborador_nome) {
    collaboratorId = porChave.get(chave(t._colaborador_nome, t._colaborador_soc)) ?? null;
  }
  if (!collaboratorId) semDono++;

  const { error } = await db.from('trainings_completed').insert({
    id: t.id,
    collaborator_id: collaboratorId,
    training_type: t.training_type,
    completed_at: t.completed_at,
    signature_pdf_url: t.signature_pdf_url,
    registered_by: t.registered_by,
    created_at: t.created_at,
    instructor_name: t.instructor_name,
  });
  if (error) { falhas++; console.error(`  falha em ${t.id}: ${error.message}`); }
  else inseridas++;
}

console.log('=== ASSINATURAS ===');
console.log('  reinseridas:', inseridas);
console.log('  já existiam:', jaExistiam);
console.log('  sem dono identificável:', semDono, '(assinatura preservada, collaborator_id nulo)');
console.log('  falhas:', falhas);

// ── Demais tabelas ─────────────────────────────────────────────
const simples = [
  ['instructors', pacote.instructors ?? []],
  ['soc_micro_trainings', pacote.soc_micro_trainings ?? []],
  ['materials', pacote.materials ?? []],
];

for (const [tabela, registros] of simples) {
  let ok = 0, skip = 0, err = 0;
  for (const r of registros) {
    const { data: existe } = await db.from(tabela).select('id').eq('id', r.id).maybeSingle();
    if (existe) { skip++; continue; }
    const { error } = await db.from(tabela).insert(r);
    if (error) { err++; console.error(`  ${tabela} ${r.id}: ${error.message}`); }
    else ok++;
  }
  console.log(`\n=== ${tabela.toUpperCase()} ===`);
  console.log(`  reinseridos: ${ok} | já existiam: ${skip} | falhas: ${err}`);
}

console.log('\nConcluído.');
