import * as XLSX from 'xlsx';
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
/**
 * Lê uma planilha do Excel (.xlsx/.xls) e devolve no MESMO formato de
 * parseDelimitedText, para os dois caminhos de importação seguirem iguais
 * daí para a frente.
 *
 * Existe porque a importação só aceitava CSV: quem baixava o modelo, abria
 * no Excel e salvava (o Excel salva .xlsx por padrão) recebia "arquivo não
 * segue o modelo" — o arquivo seguia, o formato é que era outro. O
 * file.text() de um .xlsx devolve o binário do ZIP, então o parser de texto
 * não encontrava coluna nenhuma.
 */
export function parseSpreadsheet(buffer: ArrayBuffer): ParsedCsv {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { header: [], rows: [] };

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
  if (matriz.length === 0) return { header: [], rows: [] };

  return {
    header: (matriz[0] ?? []).map(c => normalizeHeaderText(String(c ?? ''))),
    rows: matriz.slice(1).map(linha => (linha ?? []).map(cellToText)),
  };
}

/** Célula do Excel -> texto, no mesmo formato que sairia num CSV. */
function cellToText(v: unknown): string {
  if (v === null || v === undefined) return '';
  // Data vira dd/mm/aaaa: é o que parseBrDate entende e o que o Excel
  // escreveria ao exportar como CSV. Sem isto, "Data de Admissão" chegaria
  // como "Mon Aug 25 2026 00:00:00 GMT-0300" e seria descartada.
  if (v instanceof Date) {
    return formatarDataCelula(v);
  }
  return String(v).trim();
}

const UM_SEGUNDO = 1000;
const UM_DIA = 24 * 60 * 60 * 1000;

/**
 * Data de célula do Excel -> dd/mm/aaaa.
 *
 * O Excel guarda data como número serial, sem fuso, e a biblioteca
 * reconstrói um Date em hora LOCAL. Essa conversão erra por milissegundos:
 * uma célula com 25/08 pode voltar como 24/08 às 23:59:59.999, e ler o dia
 * direto devolveria 24 — a pessoa entraria no sistema com a admissão um dia
 * antes da real. Por isso, quando o horário está a menos de um segundo da
 * meia-noite seguinte, empurramos para o dia certo.
 *
 * O ajuste é deliberadamente estreito (1 segundo): células que tenham hora
 * de verdade continuam com o dia delas, sem arredondamento.
 */
function formatarDataCelula(v: Date): string {
  const d = new Date(v.getTime());
  const horaDoDia =
    d.getHours() * 60 * 60 * 1000 +
    d.getMinutes() * 60 * 1000 +
    d.getSeconds() * 1000 +
    d.getMilliseconds();
  if (horaDoDia >= UM_DIA - UM_SEGUNDO) d.setTime(d.getTime() + UM_SEGUNDO);

  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return dia + '/' + mes + '/' + d.getFullYear();
}

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

export interface LeaderCsvRow {
  name: string;
  email: string;
  sector: string;
  activity: string;
  shift: string;
  /** O gestor DO líder — grava na mesma coluna `leader`, que na linha de um líder significa "a quem ele responde". */
  leader: string;
  soc: string;
}

/**
 * Mapeia uma linha da planilha de LÍDERES.
 *
 * O e-mail é o campo mais importante: é ele que liga o líder ao time, porque
 * 411 dos 659 valores hoje em collaborators.leader já são e-mail. Sem ele o
 * vínculo só acontece se o nome bater exatamente (ver resolve_leader_links()
 * em supabase/migrations/20260814_01).
 */
export function mapLeaderRow(cells: string[], header: string[]): LeaderCsvRow {
  return {
    name: getField(cells, header, ['nome', 'lider', 'líder', 'name', 'leader', 'colaborador']),
    email: getField(cells, header, ['e-mail', 'email', 'e mail', 'mail']).toLowerCase(),
    sector: getField(cells, header, ['setor', 'sector', 'area', 'área']),
    activity: getField(cells, header, ['atividade', 'activity', 'funcao real']),
    shift: getField(cells, header, ['turno', 'shift', 'periodo']),
    leader: getField(cells, header, ['gestor', 'manager', 'responsavel', 'responsável', 'lider direto']),
    soc: getField(cells, header, ['soc', 'unidade', 'unit']).toUpperCase().replace(/^([A-Z]+)0([0-9]+)$/, '$1$2'),
  };
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
