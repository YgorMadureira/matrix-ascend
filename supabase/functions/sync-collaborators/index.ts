// Edge Function: sync-collaborators
//
// Sincroniza a tabela `collaborators` com a planilha do Google Sheets.
// Roda de duas formas, ambas chamando este mesmo código:
//   1. Automaticamente às 05:00 (America/Sao_Paulo), via pg_cron
//   2. Manualmente, pelo botão "Sincronizar Sheets" na tela de Colaboradores
//
// ⚠️ HISTÓRICO — leia antes de mexer na lógica de remoção:
// Em 11/08/2026 uma versão anterior desta função apagou 17.815 dos 18.716
// colaboradores. A cadeia foi: (a) o upsert falhava em quase todos os lotes,
// (b) a lista de "quem está na planilha" era montada a partir das linhas que
// o upsert conseguiu gravar, então (c) tudo que falhou virou "não está na
// planilha" e foi removido. As três defesas abaixo existem por causa disso:
//   · a identidade de quem está na planilha vem do PARSE, nunca do upsert;
//   · qualquer erro de gravação CANCELA a remoção inteira;
//   · um parse absurdamente pequeno aborta antes de tocar no banco.
// Não remova nenhuma delas sem entender esse incidente.
//
// Regras de negócio:
//   - A planilha já remove a linha de quem é desligado (a automação do Sheets
//     cuida disso), então quem não está mais na planilha é removido daqui.
//   - Líderes (role contendo LÍDER/INSTRUTOR/COORDENADOR/GERENTE/SUPERVISOR)
//     são cadastrados e removidos manualmente pelos admins — a sincronização
//     nunca os apaga.
//   - Colaboradores em onboarding (is_onboarding) também ficam fora da remoção.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GSHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0LwfzukkjRDLD-NqioPJoWmFv5FfeDfUdInkavetnDr7p-OhoB-sKvvXWqy6jilxBc4g8olgkOjsJ/pub?gid=0&single=true&output=csv';

const LEADER_ROLE_PATTERN = /(LÍDER|LIDER|INSTRUTOR|COORDENADOR|GERENTE|SUPERVISOR)/;
const CHUNK = 250;
const LOCK_ID = 'gsheet_collaborators';
const LOCK_STALE_MINUTES = 20;

// Detector de MALFUNCIONAMENTO (não é regra de negócio): se o parse trouxer
// menos da metade do que já existe no banco, alguma coisa quebrou no download
// ou no formato da planilha. Rotatividade real nunca chega perto disso.
const MIN_PARSE_RATIO = 0.5;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedRow {
  name: string;
  gender: string | null;
  admission_date: string | null;
  shift: string | null;
  sector: string | null;
  leader: string | null;
  opsid: string | null;
  bpo: string | null;
  role: string | null;
  activity: string | null;
  soc: string;
  is_onboarding: false;
}

/**
 * Parser de CSV que varre caractere a caractere.
 * Precisa ser assim: a planilha tem campos entre aspas COM QUEBRA DE LINHA
 * dentro (24 ocorrências em 11/08/2026). A versão anterior quebrava o texto
 * por \n antes de interpretar as aspas, e essas linhas viravam lixo —
 * inclusive um registro cujo nome ficou "Ops260982,SPX,AUXILIAR...".
 */
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } // aspas escapada ""
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === sep) { row.push(cell.trim()); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

const normalizeHeader = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const clean = (v: string | undefined): string | null => (!v || v.trim() === '-' || v.trim() === '') ? null : v.trim();

function parseBrDate(raw: string): string | null {
  if (!raw || !raw.includes('/')) return null;
  const parts = raw.split('/');
  if (parts.length !== 3) return null;
  const iso = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  return isNaN(new Date(iso).getTime()) ? null : iso;
}

/** Chave de identidade de um colaborador. É por ela que a remoção decide quem ficou de fora. */
const identityKey = (name: string, soc: string) => `${name.toUpperCase().trim()}|${soc.toUpperCase().trim()}`;

function parseSheet(rawText: string): ParsedRow[] {
  let text = rawText;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const firstBreak = text.indexOf('\n');
  const sep = text.slice(0, firstBreak === -1 ? text.length : firstBreak).includes(';') ? ';' : ',';
  const all = parseCsv(text, sep);
  if (all.length < 2) return [];

  const header = all[0].map(normalizeHeader);
  const get = (cells: string[], names: string[]): string => {
    for (const n of names) {
      const i = header.indexOf(normalizeHeader(n));
      if (i >= 0 && cells[i]) return cells[i].trim();
    }
    return '';
  };

  const rows: ParsedRow[] = [];
  for (const cells of all.slice(1)) {
    if (!cells.some(c => c !== '')) continue;
    const name = get(cells, ['colaborador', 'nome', 'name', 'colaboradores']).trim();
    if (!name || name.length < 2) continue;
    rows.push({
      name,
      gender: clean(get(cells, ['genero', 'gênero', 'gender', 'sexo'])),
      admission_date: parseBrDate(get(cells, ['data admissao', 'data de admissão', 'admissao', 'admission', 'data_admissao'])),
      shift: clean(get(cells, ['turno', 'shift', 'periodo'])),
      sector: clean(get(cells, ['setor', 'sector', 'area', 'departamento'])),
      leader: clean(get(cells, ['lider', 'líder', 'leader', 'gestor'])),
      opsid: clean(get(cells, ['ops id', 'opsid', 'matricula', 'id'])),
      bpo: clean(get(cells, ['bpo', 'empresa'])),
      role: clean(get(cells, ['cargo', 'role', 'função', 'funcao'])),
      activity: clean(get(cells, ['atividade', 'activity', 'funcao real'])),
      soc: clean(get(cells, ['soc', 'unidade', 'unit'])) || 'SP6',
      is_onboarding: false,
    });
  }
  return rows;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const staleBefore = new Date(Date.now() - LOCK_STALE_MINUTES * 60_000).toISOString();
  const { data: lockRow, error: lockErr } = await admin
    .from('sync_locks')
    .update({ locked: true, locked_at: new Date().toISOString() })
    .eq('id', LOCK_ID)
    .or(`locked.eq.false,locked_at.lt.${staleBefore}`)
    .select()
    .maybeSingle();

  if (lockErr) return json({ error: 'Erro ao verificar trava: ' + lockErr.message }, 500);
  if (!lockRow) return json({ skipped: true, reason: 'Sincronização bloqueada ou já em andamento.' });

  try {
    const response = await fetch(GSHEET_URL);
    if (!response.ok) throw new Error('Falha ao buscar a planilha: HTTP ' + response.status);
    const parsed = parseSheet(await response.text());
    if (parsed.length === 0) throw new Error('Planilha vazia ou sem colaboradores válidos.');

    // Deduplica por identidade — a planilha tem repetições, e um lote com a
    // mesma chave duas vezes faz o Postgres recusar o lote inteiro
    // (21000: "ON CONFLICT DO UPDATE command cannot affect row a second time").
    const byIdentity = new Map<string, ParsedRow>();
    for (const r of parsed) byIdentity.set(identityKey(r.name, r.soc), r);
    const rows = [...byIdentity.values()];

    // Estado atual do banco — precisa vir ANTES de qualquer escrita, porque é
    // com ele que a remoção é calculada.
    let current: { id: string; name: string; soc: string | null; role: string | null; is_onboarding: boolean | null }[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await admin.from('collaborators').select('id, name, soc, role, is_onboarding').range(from, from + 999);
      if (error) throw new Error('Erro ao ler a base atual: ' + error.message);
      current = current.concat(data ?? []);
      if (!data || data.length < 1000) break;
      from += 1000;
    }

    const activeInDb = current.filter(c => !c.is_onboarding && !LEADER_ROLE_PATTERN.test((c.role || '').toUpperCase()));
    if (activeInDb.length > 0 && rows.length < activeInDb.length * MIN_PARSE_RATIO) {
      throw new Error(
        `Sincronização abortada por segurança: a planilha trouxe ${rows.length} colaboradores, ` +
        `menos da metade dos ${activeInDb.length} ativos no banco. Isso indica falha no download ` +
        `ou mudança no formato da planilha — nada foi alterado.`
      );
    }

    // ── Gravação ───────────────────────────────────────────────
    // O opsid NÃO é chave de conflito: a planilha tem opsids repetidos
    // (o valor "0" sozinho aparecia 88 vezes em 11/08/2026), e um índice
    // único parcial também não serve como alvo de ON CONFLICT no Postgres
    // (erro 42P10). A identidade é (name, soc), que é total e única.
    let upserted = 0;
    const writeErrors: string[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await admin.from('collaborators').upsert(chunk, { onConflict: 'name,soc' });
      if (error) {
        writeErrors.push(`Lote ${i}-${i + chunk.length}: ${error.message}`);
        continue;
      }
      upserted += chunk.length;
    }

    // ── Remoção ────────────────────────────────────────────────
    // Quem sai é decidido comparando a base com as identidades DA PLANILHA —
    // nunca com o que o upsert conseguiu gravar. E se qualquer gravação
    // falhou, não removemos nada: a base pode estar num estado parcial.
    const sheetKeys = new Set(rows.map(r => identityKey(r.name, r.soc)));
    let removed = 0;
    let deletionSkipped: string | undefined;

    if (writeErrors.length > 0) {
      deletionSkipped = `Remoção cancelada: ${writeErrors.length} lote(s) falharam na gravação. ` +
        `Nenhum colaborador foi removido. Corrija os erros e rode de novo.`;
    } else {
      const toDelete = activeInDb
        .filter(c => !sheetKeys.has(identityKey(c.name, c.soc || '')))
        .map(c => c.id);

      for (let i = 0; i < toDelete.length; i += 200) {
        const chunk = toDelete.slice(i, i + 200);
        const { error } = await admin.from('collaborators').delete().in('id', chunk);
        if (error) writeErrors.push(`Remoção ${i}-${i + chunk.length}: ${error.message}`);
        else removed += chunk.length;
      }
    }

    return json({
      ok: true,
      sheetRows: parsed.length,
      uniqueRows: rows.length,
      upserted,
      removed,
      deletionSkipped,
      errors: writeErrors.length ? writeErrors.slice(0, 20) : undefined,
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erro inesperado.' }, 500);
  } finally {
    await admin.from('sync_locks').update({ locked: false }).eq('id', LOCK_ID);
  }
});
