// ============================================================
// Parser de CSV/planilha compartilhado — usado pelo upload manual em
// CollaboratorsPage (handleCSVUpload). A sincronização automática com
// o Google Sheets roda agora na Edge Function supabase/functions/
// sync-collaborators, que precisa da sua própria cópia mínima (Deno é
// um runtime separado do bundle do Vite) — mantenha as duas em sincronia
// se o formato da planilha mudar.
// ============================================================

export interface ParsedCsv {
  header: string[]; // já normalizado (sem acento, minúsculo)
  rows: string[][]; // uma linha por colaborador, células na ordem original
}

/** Remove acentos, baixa a caixa — usado para casar nomes de coluna com tolerância a grafia. */
export function normalizeHeaderText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function detectSeparator(firstLine: string): string {
  return firstLine.includes(';') ? ';' : ',';
}

/** Split de uma linha CSV respeitando valores entre aspas (não quebra em vírgula dentro de "..."). */
export function splitDelimitedLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === sep && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += ch;
  }
  result.push(current.trim());
  return result;
}

/**
 * Varre o CSV caractere a caractere, devolvendo todas as linhas.
 *
 * Precisa ser assim (e não "quebra por \n, depois interpreta cada linha"):
 * um campo entre aspas pode conter QUEBRA DE LINHA dentro. A planilha real
 * tinha 24 casos disso em 11/08/2026, e a versão que quebrava por \n primeiro
 * transformava essas linhas em lixo — foi uma das causas do incidente que
 * apagou a base de colaboradores.
 */
export function parseCsvRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } // "" = aspas literal
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

/** Lê o texto bruto do arquivo/planilha e devolve o cabeçalho normalizado + linhas de dados. */
export function parseDelimitedText(rawText: string): ParsedCsv {
  let text = rawText;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (!text.trim()) return { header: [], rows: [] };

  const firstBreak = text.indexOf('\n');
  const sep = detectSeparator(text.slice(0, firstBreak === -1 ? text.length : firstBreak));
  const all = parseCsvRows(text, sep);
  if (all.length < 1) return { header: [], rows: [] };

  const header = all[0].map(normalizeHeaderText);
  const rows = all.slice(1).filter(r => r.some(c => c !== ''));
  return { header, rows };
}

/** Busca o valor de uma célula pelo nome da coluna, tentando cada alias na ordem informada. */
export function getField(cells: string[], header: string[], names: string[]): string {
  for (const n of names) {
    const i = header.indexOf(normalizeHeaderText(n));
    if (i >= 0 && cells[i]) return cells[i].trim();
  }
  return '';
}

/** dd/mm/yyyy → yyyy-mm-dd, validando a data resultante. Retorna null se o formato não bater. */
export function parseBrDate(raw: string): string | null {
  if (!raw || !raw.includes('/')) return null;
  const parts = raw.split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isNaN(new Date(iso).getTime()) ? null : iso;
}

export interface CollaboratorCsvRow {
  name: string;
  gender: string;
  role: string;
  soc: string;
  opsid: string;
  bpo: string;
  shift: string;
  sector: string;
  leader: string;
  activity: string;
  admission_date: string | null;
}

/** Mapeia uma linha de CSV para os campos de collaborators, usando os aliases de coluna conhecidos. */
export function mapCollaboratorRow(cells: string[], header: string[]): CollaboratorCsvRow {
  return {
    name: getField(cells, header, ['colaborador', 'nome', 'name', 'colaboradores']),
    gender: getField(cells, header, ['genero', 'gênero', 'gender', 'sexo']),
    role: getField(cells, header, ['cargo', 'role', 'funcao', 'função']),
    soc: getField(cells, header, ['soc', 'unidade', 'unit']).toUpperCase().replace(/^([A-Z]+)0([0-9]+)$/, '$1$2'),
    opsid: getField(cells, header, ['opsid', 'ops id', 'matricula', 'id']),
    bpo: getField(cells, header, ['bpo', 'empresa']),
    shift: getField(cells, header, ['turno', 'shift', 'periodo']),
    sector: getField(cells, header, ['setor', 'sector', 'area', 'área']),
    leader: getField(cells, header, ['lider', 'líder', 'leader', 'gestor']),
    activity: getField(cells, header, ['atividade', 'activity', 'funcao real']),
    admission_date: parseBrDate(getField(cells, header, ['data de admissão', 'data de admissao', 'data admissao', 'admissao', 'admission'])),
  };
}
