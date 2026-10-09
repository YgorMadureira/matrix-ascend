// ============================================================
// Escopo dos Relatórios por regional — só contas, sem banco.
//
// Regional = grupo de SOCs (tabela regionais + socs.regional_id, migração
// 20261009_01). A tela de Relatórios mostra uma unidade, todas (master) ou
// as unidades de uma regional; aqui moram as contas que dependem só das
// listas, para poderem ser testadas sem Supabase (ver o .test.ts ao lado).
// A carga dos dados fica em src/lib/regionais.ts.
// ============================================================
import { normalizeMacroArea } from './trainingRules';

export interface RegionalBase {
  id: string;
  nome: string;
}

export interface SocBase {
  name: string;
  has_sorting?: boolean | null;
  regional_id?: string | null;
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Ordem de exibição: "Regional 2" antes de "Regional 10", "SP2" antes de "SP10". */
export const compararNomes = (a: string, b: string): number => collator.compare(a, b);

/** As SOCs de uma regional que o usuário alcança, em ordem de nome. */
export function socsDaRegional(
  regionalId: string,
  socs: SocBase[],
  alcanca: (soc: string) => boolean = () => true,
): string[] {
  return socs
    .filter(s => s.regional_id === regionalId && alcanca(s.name))
    .map(s => s.name)
    .sort(compararNomes);
}

/**
 * Regionais com pelo menos uma SOC que o usuário alcança — as únicas que
 * fazem sentido no filtro. Uma regional sem nenhuma SOC dele abriria a tela
 * vazia, sem explicação.
 */
export function regionaisAlcancaveis<R extends RegionalBase>(
  regionais: R[],
  socs: SocBase[],
  alcanca: (soc: string) => boolean,
): R[] {
  const comSoc = new Set(
    socs.filter(s => s.regional_id && alcanca(s.name)).map(s => s.regional_id as string),
  );
  return regionais.filter(r => comSoc.has(r.id));
}

// ── Micro-processos com várias unidades na tela ─────────────────
// Cada unidade cadastra os próprios micro-processos, e muitos se repetem
// (em 09/10/2026: 220 cadastros, 154 combinações distintas de área + nome).
// Com uma unidade só na tela isso não aparece; numa regional (ou em "todas
// as unidades") a matriz ganhava uma coluna repetida por unidade que tivesse
// o mesmo micro. As colunas passam a ser uma por área + nome, e a cor de
// cada célula (obrigatório/sugestão) vem do cadastro da UNIDADE DA PESSOA.

/** Chave de um micro-processo sem a unidade: área normalizada + nome. */
export function chaveDoMicro(macroArea: string | null | undefined, nome: string | null | undefined): string {
  const area = (normalizeMacroArea(macroArea) as string) || (macroArea || '').trim().toUpperCase();
  return `${area}|${(nome || '').trim().replace(/\s+/g, ' ').toUpperCase()}`;
}

/** Uma coluna por micro-processo (área + nome). O primeiro cadastro de cada um representa a coluna. */
export function deduplicarMicros<T extends { macro_area: string; name: string }>(micros: T[]): T[] {
  const vistos = new Set<string>();
  return micros.filter(m => {
    const chave = chaveDoMicro(m.macro_area, m.name);
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

/** soc → chave do micro → o cadastro daquela unidade (o primeiro, se houver repetido). */
export function indexarMicrosPorSoc<T extends { soc_name: string; macro_area: string; name: string }>(
  micros: T[],
): Map<string, Map<string, T>> {
  const indice = new Map<string, Map<string, T>>();
  for (const m of micros) {
    let daSoc = indice.get(m.soc_name);
    if (!daSoc) {
      daSoc = new Map();
      indice.set(m.soc_name, daSoc);
    }
    const chave = chaveDoMicro(m.macro_area, m.name);
    if (!daSoc.has(chave)) daSoc.set(chave, m);
  }
  return indice;
}

// ── Comparativo por regional ─────────────────────────────────────

export interface DesempenhoSoc {
  soc: string;
  total_hc: number;
  trained_hc: number;
}

export interface DesempenhoRegional {
  regionalId: string | null;
  regional: string;
  socs: number;
  total_hc: number;
  trained_hc: number;
  pct: number;
}

export const SEM_REGIONAL = 'Sem regional';

/**
 * Soma o desempenho das SOCs por regional. O % é treinados ÷ HC da regional
 * inteira — nunca a média dos % das SOCs, que daria o mesmo peso a uma
 * unidade de 50 pessoas e a uma de 2.000. Mesmo arredondamento da
 * soc_performance_view (1 casa).
 *
 * SOC sem regional, ou apontando para uma regional que não está na lista,
 * cai em "Sem regional" — ninguém some da comparação.
 */
export function desempenhoPorRegional(
  linhas: DesempenhoSoc[],
  socs: SocBase[],
  regionais: RegionalBase[],
): DesempenhoRegional[] {
  const regionalDaSoc = new Map(socs.map(s => [s.name, s.regional_id ?? null]));
  const nomes = new Map(regionais.map(r => [r.id, r.nome]));
  const soma = new Map<string | null, { total: number; treinados: number; socs: number }>();

  for (const l of linhas) {
    const rid = regionalDaSoc.get(l.soc) ?? null;
    const id = rid && nomes.has(rid) ? rid : null;
    const acc = soma.get(id) ?? { total: 0, treinados: 0, socs: 0 };
    acc.total += l.total_hc;
    acc.treinados += l.trained_hc;
    acc.socs += 1;
    soma.set(id, acc);
  }

  return [...soma.entries()]
    .map(([id, a]) => ({
      regionalId: id,
      regional: id ? (nomes.get(id) as string) : SEM_REGIONAL,
      socs: a.socs,
      total_hc: a.total,
      trained_hc: a.treinados,
      pct: a.total > 0 ? Number(((a.treinados / a.total) * 100).toFixed(1)) : 0,
    }))
    .sort((x, y) => y.pct - x.pct || compararNomes(x.regional, y.regional));
}
