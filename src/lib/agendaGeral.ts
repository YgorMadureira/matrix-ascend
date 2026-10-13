// ============================================================
// Visão geral da Agenda — a lista de agendas de TODAS as unidades.
//
// Só contas, sem banco (a carga fica em src/components/AgendaGeral.tsx),
// para poderem ser testadas — ver o .test.ts ao lado.
//
// De onde vem cada coisa (tabela training_schedules):
//   · tema    = title          ("SALVADOS", "TRATATIVAS DE ROTINA")
//   · área    = training_type  ("TRATATIVAS", "RECEBIMENTO")
//   · data    = specific_date, para agenda com data marcada (a maioria);
//               agenda recorrente (toda semana) não tem data — entra UMA
//               vez na lista, com a data da próxima ocorrência.
//
// Datas são sempre texto 'AAAA-MM-DD' no horário local: comparar texto com
// texto evita o deslocamento de fuso que new Date('2026-10-20') causaria
// (vira 19/10 às 21h no Brasil).
// ============================================================

export interface AgendaBase {
  id: string;
  soc: string | null;
  title: string | null;
  training_type: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  instructor_name: string | null;
  location: string | null;
  is_recurring: boolean | null;
  specific_date: string | null;
}

export type Periodo = 'proximas' | '7dias' | '30dias' | 'mes' | 'passadas' | 'todas';

export const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: 'proximas', rotulo: 'Próximas (de hoje em diante)' },
  { valor: '7dias', rotulo: 'Próximos 7 dias' },
  { valor: '30dias', rotulo: 'Próximos 30 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'passadas', rotulo: 'Já realizadas' },
  { valor: 'todas', rotulo: 'Todas as datas' },
];

export interface LinhaAgenda {
  id: string;
  soc: string;
  /** Data marcada; para agenda recorrente, a próxima ocorrência. */
  data: string;
  recorrente: boolean;
  diaDaSemana: number;
  inicio: string;
  fim: string;
  tema: string;
  area: string;
  instrutor: string;
  local: string;
  /** Pessoas inscritas nesta agenda, nesta data. */
  inscritos: number;
  ehHoje: boolean;
  passada: boolean;
}

export const DIAS_DA_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// ── Datas ────────────────────────────────────────────────────

const paraData = (iso: string): Date => {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
};

export const paraISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function somarDias(iso: string, dias: number): string {
  const d = paraData(iso);
  d.setDate(d.getDate() + dias);
  return paraISO(d);
}

export const diaDaSemanaDe = (iso: string): number => paraData(iso).getDay();

/** A primeira data, a partir de `aPartirDe` (inclusive), que cai no dia da semana pedido (0 = domingo). */
export function proximaOcorrencia(diaDaSemana: number, aPartirDe: string): string {
  const falta = (((diaDaSemana - diaDaSemanaDe(aPartirDe)) % 7) + 7) % 7;
  return somarDias(aPartirDe, falta);
}

/** '2026-10-20' → '20/10/2026' */
export const formatarData = (iso: string): string => iso.split('-').reverse().join('/');

/** Limites do período, inclusive. null = sem limite daquele lado. */
export function intervaloDoPeriodo(periodo: Periodo, hoje: string): { de: string | null; ate: string | null } {
  switch (periodo) {
    case 'proximas': return { de: hoje, ate: null };
    case '7dias': return { de: hoje, ate: somarDias(hoje, 7) };
    case '30dias': return { de: hoje, ate: somarDias(hoje, 30) };
    case 'mes': {
      const d = paraData(hoje);
      return {
        de: paraISO(new Date(d.getFullYear(), d.getMonth(), 1)),
        ate: paraISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
      };
    }
    case 'passadas': return { de: null, ate: somarDias(hoje, -1) };
    case 'todas': return { de: null, ate: null };
  }
}

// ── Linhas ───────────────────────────────────────────────────

/**
 * A agenda se repete toda semana? O mesmo critério do calendário
 * (getSchedulesForDate, em SchedulePage.tsx): só é "data marcada" quem tem
 * is_recurring = false E uma specific_date. Qualquer outra combinação o
 * calendário desenha toda semana — então a lista também trata assim.
 */
export const ehRecorrente = (a: AgendaBase): boolean => !(a.is_recurring === false && !!a.specific_date);

/** Chave das inscrições: uma agenda numa data. */
export const chaveInscricao = (agendaId: string, data: string): string => `${agendaId}|${data}`;

/**
 * As agendas do período, uma linha cada, em ordem de data e horário (as já
 * realizadas saem da mais recente para a mais antiga).
 *
 * Agenda recorrente entra UMA vez, na próxima ocorrência — expandir cada
 * semana encheria a lista de linhas repetidas. Em "Já realizadas" ela não
 * entra: a ocorrência passada de uma agenda semanal não fica registrada em
 * lugar nenhum, então não há o que listar.
 */
export function montarLinhas(
  agendas: AgendaBase[],
  inscritosPor: Map<string, number>,
  hoje: string,
  periodo: Periodo,
): LinhaAgenda[] {
  const { de, ate } = intervaloDoPeriodo(periodo, hoje);
  const linhas: LinhaAgenda[] = [];

  for (const a of agendas) {
    const recorrente = ehRecorrente(a);
    let data: string;

    if (recorrente) {
      if (periodo === 'passadas') continue;
      const dia = a.day_of_week;
      if (dia == null || dia < 0 || dia > 6) continue;
      data = proximaOcorrencia(dia, hoje);
      if (ate && data > ate) continue;
    } else {
      data = a.specific_date as string;
      if (de && data < de) continue;
      if (ate && data > ate) continue;
    }

    linhas.push({
      id: a.id,
      soc: (a.soc || '').trim() || '(sem unidade)',
      data,
      recorrente,
      diaDaSemana: diaDaSemanaDe(data),
      inicio: (a.start_time || '').slice(0, 5),
      fim: (a.end_time || '').slice(0, 5),
      tema: (a.title || '').trim() || '(sem título)',
      area: (a.training_type || '').trim(),
      instrutor: (a.instructor_name || '').trim(),
      local: (a.location || '').trim(),
      inscritos: inscritosPor.get(chaveInscricao(a.id, data)) ?? 0,
      ehHoje: data === hoje,
      passada: data < hoje,
    });
  }

  const sentido = periodo === 'passadas' ? -1 : 1;
  return linhas.sort((x, y) =>
    sentido * x.data.localeCompare(y.data) ||
    x.inicio.localeCompare(y.inicio) ||
    compararUnidades(x.soc, y.soc) ||
    x.tema.localeCompare(y.tema));
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
/** "SP2" antes de "SP10". */
export const compararUnidades = (a: string, b: string): number => collator.compare(a, b);

/** As linhas separadas por unidade, unidades em ordem de nome; dentro de cada uma, a ordem que já vieram. */
export function agruparPorUnidade(linhas: LinhaAgenda[]): { soc: string; linhas: LinhaAgenda[] }[] {
  const grupos = new Map<string, LinhaAgenda[]>();
  for (const l of linhas) {
    const lista = grupos.get(l.soc) ?? [];
    lista.push(l);
    grupos.set(l.soc, lista);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => compararUnidades(a, b))
    .map(([soc, lista]) => ({ soc, linhas: lista }));
}

/** Das unidades olhadas, quais não têm nenhuma agenda na lista. */
export function unidadesSemAgenda(unidades: string[], linhas: LinhaAgenda[]): string[] {
  const comAgenda = new Set(linhas.map(l => l.soc));
  return unidades.filter(u => !comAgenda.has(u)).sort(compararUnidades);
}

/** Quando a agenda acontece, por extenso: "20/10/2026 (terça)" ou "Toda terça · próxima 20/10/2026". */
export function descreverQuando(l: LinhaAgenda): string {
  const dia = DIAS_DA_SEMANA[l.diaDaSemana].toLowerCase();
  return l.recorrente ? `Toda ${dia} · próxima ${formatarData(l.data)}` : `${formatarData(l.data)} (${dia})`;
}

/** A lista como CSV para o Excel brasileiro (ponto e vírgula). Quem chama acrescenta o BOM. */
export function paraCsv(linhas: LinhaAgenda[]): string {
  const cabecalho = ['Unidade', 'Data', 'Dia da semana', 'Inicio', 'Fim', 'Tema', 'Area', 'Instrutor', 'Local', 'Inscritos', 'Tipo'];
  const corpo = linhas.map(l => [
    l.soc,
    formatarData(l.data),
    DIAS_DA_SEMANA[l.diaDaSemana],
    l.inicio,
    l.fim,
    l.tema,
    l.area,
    l.instrutor,
    l.local,
    String(l.inscritos),
    l.recorrente ? 'Recorrente (toda semana) - data da proxima ocorrencia' : 'Data marcada',
  ]);
  return [cabecalho, ...corpo]
    .map(colunas => colunas.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
}
