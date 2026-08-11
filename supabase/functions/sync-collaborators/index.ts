// Edge Function: sync-collaborators
//
// Sincroniza a tabela `collaborators` com a planilha do Google Sheets.
// Roda de duas formas, ambas chamando este mesmo código (fonte única):
//   1. Automaticamente às 05:00 (America/Sao_Paulo), via pg_cron —
//      ver supabase/migrations/20260811_02_collaborators_sync_infra.sql
//   2. Manualmente, quando um admin clica em "Sincronizar Sheets" na
//      tela de Colaboradores (supabase.functions.invoke).
//
// Regras (definidas com o time em 11/08/2026):
//   - A planilha JÁ remove a linha quando alguém é desligado (a
//     automação do Sheets cuida disso antes de chegar aqui) — por
//     isso não existe mais checagem de coluna "Desligado": quem não
//     está mais na planilha é considerado desligado e é removido.
//   - Líderes (role contendo LÍDER/INSTRUTOR/COORDENADOR/GERENTE/
//     SUPERVISOR) são cadastrados e removidos manualmente pelos
//     admins — nunca pela sincronização. Excluídos da varredura de
//     remoção mesmo que não estejam na planilha.
//   - Colaboradores em onboarding (is_onboarding = true) também
//     ficam de fora da remoção — fluxo próprio, gerenciado em
//     TrainingsPage/CollaboratorsPage (aba Onboarding).
//   - Chave de casamento: OPS ID quando existe; nome+SOC como
//     reserva para quem não tem OPS ID.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GSHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0LwfzukkjRDLD-NqioPJoWmFv5FfeDfUdInkavetnDr7p-OhoB-sKvvXWqy6jilxBc4g8olgkOjsJ/pub?gid=0&single=true&output=csv';

const LEADER_ROLE_PATTERN = /(LÍDER|LIDER|INSTRUTOR|COORDENADOR|GERENTE|SUPERVISOR)/;
const CHUNK = 500;
const LOCK_ID = 'gsheet_collaborators';
const LOCK_STALE_MINUTES = 20;

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

function splitCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === sep && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += ch;
  }
  result.push(current.trim());
  return result;
}

const normalizeHeader = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const clean = (v: string | undefined): string | null => (!v || v.trim() === '-' || v.trim() === '') ? null : v.trim();

function parseSheet(text: string): ParsedRow[] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const sep = lines[0].includes(';') ? ';' : ',';
  const header = splitCsvLine(lines[0], sep).map(normalizeHeader);

  const get = (cells: string[], names: string[]): string => {
    for (const n of names) {
      const i = header.indexOf(normalizeHeader(n));
      if (i >= 0 && cells[i]) return cells[i].trim();
    }
    return '';
  };

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], sep);
    const name = get(cells, ['colaborador', 'nome', 'name', 'colaboradores']).trim();
    if (!name || name.length < 2) continue;

    const admRaw = get(cells, ['data admissao', 'data de admissão', 'admissao', 'admission', 'data_admissao']);
    let admissionDate: string | null = null;
    if (admRaw && admRaw.includes('/')) {
      const parts = admRaw.split('/');
      if (parts.length === 3) {
        const [day, month, year] = parts;
        const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        if (!isNaN(new Date(iso).getTime())) admissionDate = iso;
      }
    }

    rows.push({
      name,
      gender: clean(get(cells, ['genero', 'gênero', 'gender', 'sexo'])),
      admission_date: admissionDate,
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

  // ── Trava no banco: vale para cron E para qualquer navegador ao mesmo tempo ──
  const staleBefore = new Date(Date.now() - LOCK_STALE_MINUTES * 60_000).toISOString();
  const { data: lockRow, error: lockErr } = await admin
    .from('sync_locks')
    .update({ locked: true, locked_at: new Date().toISOString() })
    .eq('id', LOCK_ID)
    .or(`locked.eq.false,locked_at.lt.${staleBefore}`)
    .select()
    .maybeSingle();

  if (lockErr) return json({ error: 'Erro ao verificar trava: ' + lockErr.message }, 500);
  if (!lockRow) return json({ skipped: true, reason: 'Já existe uma sincronização em andamento.' });

  try {
    const response = await fetch(GSHEET_URL);
    if (!response.ok) throw new Error('Falha ao buscar a planilha do Google Sheets: HTTP ' + response.status);
    const text = await response.text();
    const rows = parseSheet(text);
    if (rows.length === 0) throw new Error('Planilha vazia ou sem colaboradores válidos.');

    const withOpsid = rows.filter(r => r.opsid);
    const withoutOpsid = rows.filter(r => !r.opsid);

    const matchedIds = new Set<string>();
    let upserted = 0;
    const errors: string[] = [];

    const runUpsert = async (batch: ParsedRow[], onConflict: string) => {
      for (let i = 0; i < batch.length; i += CHUNK) {
        const chunk = batch.slice(i, i + CHUNK);
        const { data, error } = await admin.from('collaborators').upsert(chunk, { onConflict }).select('id');
        if (error) {
          errors.push(`Lote ${onConflict} [${i}-${i + chunk.length}]: ${error.message}`);
          continue;
        }
        (data ?? []).forEach((r: { id: string }) => matchedIds.add(r.id));
        upserted += chunk.length;
      }
    };

    await runUpsert(withOpsid, 'opsid');
    await runUpsert(withoutOpsid, 'name,soc');

    // ── Remoção: quem não apareceu na planilha, exceto líderes e onboarding ──
    let allCurrent: { id: string; role: string | null; is_onboarding: boolean | null }[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await admin.from('collaborators').select('id, role, is_onboarding').range(from, from + 999);
      if (error) { errors.push('Erro ao listar colaboradores para remoção: ' + error.message); break; }
      allCurrent = allCurrent.concat(data ?? []);
      if (!data || data.length < 1000) break;
      from += 1000;
    }

    const toDelete = allCurrent
      .filter(c => !matchedIds.has(c.id))
      .filter(c => !c.is_onboarding)
      .filter(c => !LEADER_ROLE_PATTERN.test((c.role || '').toUpperCase()))
      .map(c => c.id);

    let removed = 0;
    for (let i = 0; i < toDelete.length; i += 200) {
      const chunk = toDelete.slice(i, i + 200);
      const { error } = await admin.from('collaborators').delete().in('id', chunk);
      if (error) errors.push(`Remoção [${i}-${i + chunk.length}]: ${error.message}`);
      else removed += chunk.length;
    }

    return json({
      ok: true,
      sheetRows: rows.length,
      upserted,
      removed,
      matched: matchedIds.size,
      errors: errors.length ? errors.slice(0, 20) : undefined,
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erro inesperado.' }, 500);
  } finally {
    await admin.from('sync_locks').update({ locked: false }).eq('id', LOCK_ID);
  }
});
