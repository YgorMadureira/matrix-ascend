// Conexão compartilhada dos scripts de manutenção.
//
// Procura a chave de serviço em duas fontes, nesta ordem:
//   1. a variável de ambiente SUPABASE_SERVICE_ROLE_KEY
//   2. o arquivo .env na raiz do projeto
//
// O .env já está no .gitignore — a chave nunca vai para o repositório.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lerEnv() {
  const arquivo = path.join(RAIZ, '.env');
  if (!fs.existsSync(arquivo)) return {};
  const valores = {};
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    valores[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return valores;
}

const env = lerEnv();

const URL =
  process.env.SUPABASE_URL ||
  env.SUPABASE_URL ||
  env.VITE_SUPABASE_URL ||
  'https://fezfsekzxtvozyemlncn.supabase.co';

const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error('\nNão encontrei a chave de serviço.\n');
  console.error('Abra o arquivo .env na raiz do projeto e acrescente uma linha:');
  console.error('\n  SUPABASE_SERVICE_ROLE_KEY=cole_a_chave_aqui\n');
  console.error('A chave está em: Supabase → Project Settings → API → service_role.');
  console.error('O .env não vai para o Git, então a chave fica só na sua máquina.\n');
  process.exit(1);
}

export const db = createClient(URL, KEY, { auth: { persistSession: false } });
export const SUPABASE_URL = URL;

/** Lê uma tabela inteira em páginas de 1000 (limite do PostgREST). */
export async function paginar(tabela, colunas, filtro) {
  const linhas = [];
  let p = 0;
  while (true) {
    let q = db.from(tabela).select(colunas).range(p * 1000, (p + 1) * 1000 - 1);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) { console.error(`Erro ao ler ${tabela}: ${error.message}`); process.exit(1); }
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    p++;
  }
  return linhas;
}
