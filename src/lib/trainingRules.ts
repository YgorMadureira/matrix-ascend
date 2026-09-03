// ============================================================
// Motor único de regras de treinamento — Recebimento, Processamento,
// Expedição, Tratativas e ASM.
//
// ⚠️ ESTE É O ÚNICO LUGAR ONDE A REGRA MORA.
// Dashboard, Colaboradores e Relatórios (cards, matriz, filtro de
// pendentes e exportação) chamam as funções daqui. Antes de 13/08/2026
// cada tela tinha a sua própria cópia da regra — eram SEIS — e a mesma
// unidade aparecia com 96%, 97,9% e 99,1% ao mesmo tempo, além de a
// exportação de pendentes trazer 2 pessoas onde a tela mostrava 17.
// Se precisar mudar a regra, mude AQUI e no espelho SQL
// (training_matches_collaborator / training_unlocks_area, ver
// supabase/migrations) — nunca dentro de uma tela.
//
// Regras (definidas e validadas com o time de operações):
//   1. "Onboarding" + "PTS" + "Com Sorter" → acende Receb+Proc+Exped+ASM
//   2. "Onboarding" + "PTS" (V3, Sem Sorter, "Novos Colaboradores PTS"...)
//      → acende Receb+Proc+Exped. As duas palavras contam em qualquer
//      posição do nome, e o código do documento é descartado antes da
//      comparação (senão o "PTS" de SPX_BR_PTS_SOC_031 acenderia áreas).
//   3. Qualquer outro "Onboarding ..." (People/HSE/Security/Qualidade/
//      Meio Ambiente) → treinamento administrativo, NÃO acende nada
//   4. "Treinamento Padrão SOC - <ÁREA>" onde <ÁREA> é exatamente uma
//      macro-área (Recebimento/Processamento/Expedição/Tratativas/ASM)
//      → acende aquela macro inteira
//   5. Qualquer outro treinamento → acende SOMENTE o micro de nome
//      equivalente (comparação tolerante a acento/caixa/código/versão)
//
// TRATATIVAS nunca é aceso por Onboarding — exige o "Treinamento Padrão
// SOC - Tratativas" (decisão de 13/08/2026).
// ============================================================

export type MacroArea = 'RECEBIMENTO' | 'PROCESSAMENTO' | 'EXPEDIÇÃO' | 'TRATATIVAS' | 'ASM';

export const CORE_HEALTH_AREAS: MacroArea[] = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO'];
export const OPERATIONAL_BASE_AREAS: MacroArea[] = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS'];

/** Mínimo de micro-processos cadastrados para a SOC entrar no ranking de saúde. */
export const MIN_MICROS_FOR_HEALTH = 14;

export interface MicroTraining {
  name: string;
  macro_area: string;
}

export interface CollaboratorLite {
  id: string;
  sector?: string | null;
  role?: string | null;
  /** Usado só para achar quem faz Sorter dentro do setor Processamento — ver collaboratorArea(). */
  activity?: string | null;
  /** Líder tem o próprio caminho para "treinado" — ver isCollaboratorTrained(). */
  is_leader?: boolean;
}

/** Remove acentos, caixa e pontuação — base de toda comparação de texto aqui. */
export function normalizeText(raw: string | null | undefined): string {
  return (raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[_\-.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove sufixo de versão ("V3", "V.11", "VERSAO 2") e código de documento
 * ("SPX_BR_PTS_SOC_031") antes da comparação — permite que o nome do
 * treinamento "mude uma coisinha" (ex: V.11 → V.12) sem quebrar o match.
 */
function stripVersionAndCode(s: string): string {
  return s
    .replace(/\bV\s*\.?\s*\d+(\s*\.\d+)?\b/g, ' ')
    .replace(/\bVERSAO\s*\d+\b/g, ' ')
    .replace(/\bSPX\s+BR\s+PTS\s+SOC\s+\d+\b/g, ' ')
    .replace(/^\s*\d+\s+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza o texto de uma macro-área (vindo de collaborators.sector ou soc_micro_trainings.macro_area). */
export function normalizeMacroArea(raw: string | null | undefined): MacroArea | '' {
  const u = normalizeText(raw);
  if (!u) return '';
  if (u.includes('RECEBIMENTO')) return 'RECEBIMENTO';
  if (u.includes('PROCESSAMENTO')) return 'PROCESSAMENTO';
  if (u.includes('EXPEDIC')) return 'EXPEDIÇÃO';
  if (u.includes('TRATATIVA')) return 'TRATATIVAS';
  if (u === 'ASM' || u.startsWith('ASM ') || u.endsWith(' ASM')) return 'ASM';
  return '';
}

/**
 * Quais macro-áreas inteiras um treinamento acende.
 * `null` = treinamento específico — cai no match por nome de micro (regra 5).
 * `[]`   = onboarding administrativo — não acende nada (regra 3).
 */
function areasUnlockedBy(trainingType: string): MacroArea[] | null {
  const t = stripVersionAndCode(normalizeText(trainingType));

  // "ONBOARDING" e "PTS" em QUALQUER posição, não a frase colada. O nome
  // real usado na operação é "Onboarding Novos Colaboradores PTS" (1.314
  // assinaturas) — com a exigência da frase contígua ele caía na regra 3
  // ("onboarding administrativo, não acende nada") e 852 pessoas apareciam
  // CERTIFICADO na tela de Colaboradores (que usa o espelho SQL, sempre
  // frouxo aqui) e PENDENTE nos Relatórios. SP2 mostrava 32,5% de um lado e
  // 77,9% do outro. Descoberto em 03/09/2026.
  //
  // A ordem importa: stripVersionAndCode já removeu o código do documento
  // acima, então o "PTS" de "SPX_BR_PTS_SOC_031" não chega aqui e um
  // "Onboarding <código>" continua não acendendo nada. O espelho SQL passou
  // a remover o código pelo mesmo motivo — ver strip_training_code.
  if (t.includes('ONBOARDING') && t.includes('PTS')) {
    if (t.includes('COM SORTER')) return ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'ASM'];
    return ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO'];
  }
  if (t.includes('ONBOARDING')) return [];

  if (t.includes('TREINAMENTO PADRAO SOC')) {
    const suffix = t.split('TREINAMENTO PADRAO SOC').pop()!.trim();
    // Procura a palavra-chave DENTRO do sufixo, em vez de exigir que o
    // sufixo seja exatamente ela. O nome real usado na operação é
    // "06. Treinamento Padrão SOC - Sorter (ASM)" — com a comparação exata,
    // o sufixo virava "SORTER ASM", não batia com nada, e 1.474 assinaturas
    // de ASM não acendiam a área no Dashboard. A função equivalente no banco
    // (training_unlocks_area) sempre usou ILIKE '%asm%', então as duas
    // discordavam: o Relatório contava, o card de saúde não.
    //
    // Nenhuma das palavras é substring de outra ("PROCESSAMENTO" contém
    // "SAM", não "ASM"), então não há match cruzado. Um nome que cite duas
    // áreas acende as duas — que é o comportamento correto.
    const targets: [string, MacroArea][] = [
      ['RECEBIMENTO', 'RECEBIMENTO'],
      ['PROCESSAMENTO', 'PROCESSAMENTO'],
      ['EXPEDICAO', 'EXPEDIÇÃO'],
      ['TRATATIVAS', 'TRATATIVAS'],
      ['ASM', 'ASM'],
    ];
    const encontradas = targets.filter(([chave]) => suffix.includes(chave)).map(([, area]) => area);
    if (encontradas.length > 0) return encontradas;
  }

  return null;
}

/** Regra 5: match tolerante por nome, usado quando o treinamento é específico (não acende área inteira). */
function matchesMicroByName(trainingType: string, microName: string): boolean {
  const t = stripVersionAndCode(normalizeText(trainingType));
  const m = stripVersionAndCode(normalizeText(microName));
  if (!m) return false;
  return t.includes(m) || m.includes(t);
}

/** Um treinamento específico conclui um micro-processo de uma macro-área? */
export function isMicroCompletedBy(trainingType: string, microName: string, macroArea: string): boolean {
  const areas = areasUnlockedBy(trainingType);
  if (areas !== null) {
    return areas.includes(normalizeMacroArea(macroArea) as MacroArea);
  }
  return matchesMicroByName(trainingType, microName);
}

/** Quantos dos micros informados um colaborador concluiu, dado seu histórico de treinamentos. */
export function countCompletedMicros(trainingTypes: string[], micros: MicroTraining[]): number {
  let count = 0;
  for (const micro of micros) {
    if (trainingTypes.some(t => isMicroCompletedBy(t, micro.name, micro.macro_area))) count++;
  }
  return count;
}

/**
 * "Concluiu o treinamento padrão da área" — usado no card % Treinados,
 * na Matriz de Certificação e no gráfico Desempenho por SOC. Só conta
 * treinamentos que acendem a área INTEIRA (Onboarding PTS / Padrão SOC),
 * não certificados de micro-processo específico.
 */
export function isAreaTrained(trainingTypes: string[], area: MacroArea): boolean {
  return trainingTypes.some(t => (areasUnlockedBy(t) ?? []).includes(area));
}

/** Áreas relevantes para o card "% Treinados" / Matriz / gráfico — ASM só entra se a SOC tem sorting. */
export function operationalAreas(hasSorting: boolean): MacroArea[] {
  return hasSorting ? [...OPERATIONAL_BASE_AREAS, 'ASM'] : OPERATIONAL_BASE_AREAS;
}

/**
 * Grupo de quem não está em nenhuma macro-área operacional — "Apoio",
 * "Almox", "EHA", setor em branco. Até 13/08/2026 essas pessoas eram
 * simplesmente ignoradas pelo Dashboard e pelos Relatórios (apareciam só
 * na tela de Colaboradores), o que inflava o percentual das duas telas.
 * Hoje entram na conta como um grupo próprio.
 */
export const OTHER_AREA = 'OUTROS' as const;
export type StatArea = MacroArea | typeof OTHER_AREA;

/**
 * activity começa identificando o Sorter? Formatos vistos nos dados reais:
 * "ASM | Chutes" (RJ2), "ASM - Looping C (Zona 1)" (SP8), "ASM Nível 1"
 * (SP2) — por isso a checagem é só o prefixo "ASM" seguido de fronteira de
 * palavra, tolerante ao separador que vier depois.
 */
function isAsmActivity(activity: string | null | undefined): boolean {
  return /^ASM\b/i.test((activity || '').trim());
}

/**
 * Em que grupo do relatório este colaborador cai — cada pessoa cai em
 * exatamente um.
 *
 * Duas coisas apontam alguém para ASM, e as duas são necessárias:
 *
 *  · o setor, quando o RH escreve "ASM" mesmo (1.494 pessoas em 03/09/2026,
 *    todas em SP2/SP8/RJ2). ⚠️ Até 02/09 NENHUMA linha tinha esse setor e
 *    este comentário dizia isso — o dado mudou desde então. Não confie na
 *    ausência dele;
 *  · a activity, para quem o RH deixou em "Processamento" mas trabalha no
 *    Sorter. Sem ela, essas pessoas caíam todas em PROCESSAMENTO e o card de
 *    ASM ficava 0/0 enquanto a matriz de certificação (que decide por
 *    treinamento, não por setor) mostrava os ticks acesos — o card e a matriz
 *    respondendo perguntas diferentes sem ninguém perceber (RJ2, 02/09/2026).
 *    Formatos reais: "ASM | Chutes" (RJ2), "ASM - Looping C" (SP8), "ASM
 *    Nível 1" (SP2). MG2 não marca activity, então lá não há como separar.
 *
 * Setor ASM numa SOC SEM sorter é contradição no dado (a unidade não tem
 * Sorter). Nesses casos a pessoa entra em PROCESSAMENTO — decisão de
 * 03/09/2026; antes caía em OUTROS, o que a tirava da área operacional e a
 * fazia ser cobrada por uma régua diferente da do banco. Hoje é 1 pessoa
 * (CE3), mas a regra vale para qualquer unidade nova sem sorter.
 */
export function collaboratorArea(
  sector: string | null | undefined,
  hasSorting: boolean,
  activity?: string | null
): StatArea {
  const area = normalizeMacroArea(sector);
  if (!area) return OTHER_AREA;
  if (area === 'ASM') return hasSorting ? 'ASM' : 'PROCESSAMENTO';
  if (hasSorting && area === 'PROCESSAMENTO' && isAsmActivity(activity)) return 'ASM';
  return area;
}

/**
 * Onboarding específico de líder: "Onboarding Líderes", "Onboarding
 * Líderes 2.0" (ou qualquer versão futura — é um "contém", não exige o
 * nome exato). normalizeText já cuida de acento/caixa/pontuação, então
 * "Líderes" e "Lideres" batem igual.
 */
function isLeaderOnboarding(trainingType: string): boolean {
  return normalizeText(trainingType).includes('ONBOARDING LIDERES');
}

/**
 * A PERGUNTA CANÔNICA: esta pessoa está treinada?
 *
 * Toda tela que precise responder isso — card do Dashboard, coluna de
 * status em Colaboradores, filtro e exportação de pendentes em
 * Relatórios — precisa chamar esta função, e nenhuma outra.
 *
 *  · Líder (is_leader) com "Onboarding Líderes"/"Onboarding Líderes 2.0"
 *    → treinado, ponto — não depende de setor. Decisão de 02/09/2026: o
 *    onboarding de líder é um trilho próprio, separado do sistema de áreas
 *    operacionais. É um OU a mais, não troca nada: um líder que já esteja
 *    treinado por outra via (veio da operação, tem Onboarding PTS) continua
 *    contando também.
 *  · Quem está numa macro-área operacional → precisa de um treinamento
 *    que acenda A ÁREA DELE. Ter feito o treinamento de outra área não
 *    conta (era o furo da exportação de pendentes: alguém do Recebimento
 *    que só fez o de Processamento saía como treinado).
 *  · Quem NÃO está numa macro-área operacional (Apoio, Almox, sem setor)
 *    → basta ter um treinamento que acenda qualquer área, porque o
 *    Onboarding PTS cobre todas elas (decisão de 13/08/2026). Onboarding
 *    Líderes NÃO entra aqui — é onboarding administrativo, sem is_leader
 *    ele não credencia ninguém (mesma regra 3 do motor).
 */
export function isCollaboratorTrained(
  sector: string | null | undefined,
  trainingTypes: string[],
  hasSorting: boolean,
  activity?: string | null,
  isLeader?: boolean
): boolean {
  if (isLeader && trainingTypes.some(isLeaderOnboarding)) return true;

  const area = collaboratorArea(sector, hasSorting, activity);

  if (area !== OTHER_AREA) {
    if (isAreaTrained(trainingTypes, area)) return true;
    // Exceção do Sorter, para quando activity não identificou a pessoa como
    // Sorter (área ficou PROCESSAMENTO mesmo assim — ex: MG2, que não marca
    // activity, ou um caso de digitação diferente). Nas SOCs com ASM, quem
    // trabalha no Sorter continua cadastrado com setor "Processamento", e o
    // treinamento dele chama-se "Treinamento Padrão SOC - Sorter (ASM)".
    // Sem esta linha, 968 pessoas de SP8/SP2 apareciam como pendentes tendo
    // assinado o treinamento certo. Espelhado no SQL em 20260813_05.
    if (area === 'PROCESSAMENTO' && isAreaTrained(trainingTypes, 'ASM')) return true;
    return false;
  }

  return trainingTypes.some(t => (areasUnlockedBy(t) ?? []).length > 0);
}

/** Áreas relevantes para o Índice de Saúde — ASM só entra se a SOC tem sorting. */
export function healthAreas(hasSorting: boolean): MacroArea[] {
  return hasSorting ? [...CORE_HEALTH_AREAS, 'ASM'] : CORE_HEALTH_AREAS;
}

export interface SocHealthResult {
  /** false quando a SOC não cadastrou o mínimo de micros — não entra no ranking. */
  eligible: boolean;
  microCount: number;
  minRequired: number;
  missing: number;
  evaluatedCollaborators: number;
  healthPct: number;
}

/**
 * Índice de Saúde do SOC — média do percentual individual de conclusão.
 * N = micros cadastrados nas áreas relevantes (mínimo 14 para ser elegível).
 * individual% = micros concluídos ÷ N ; saúde = média dos individual%.
 */
export function calculateSocHealth(
  socMicros: MicroTraining[],
  collaborators: CollaboratorLite[],
  trainingsByCollabId: Map<string, string[]>,
  hasSorting: boolean
): SocHealthResult {
  const areas = healthAreas(hasSorting);
  const micros = socMicros.filter(m => areas.includes(normalizeMacroArea(m.macro_area) as MacroArea));
  const N = micros.length;

  if (N < MIN_MICROS_FOR_HEALTH) {
    return { eligible: false, microCount: N, minRequired: MIN_MICROS_FOR_HEALTH, missing: MIN_MICROS_FOR_HEALTH - N, evaluatedCollaborators: 0, healthPct: 0 };
  }

  const eligibleCollabs = collaborators.filter(c => areas.includes(normalizeMacroArea(c.sector || c.role) as MacroArea));
  if (eligibleCollabs.length === 0) {
    return { eligible: true, microCount: N, minRequired: MIN_MICROS_FOR_HEALTH, missing: 0, evaluatedCollaborators: 0, healthPct: 0 };
  }

  let sum = 0;
  for (const c of eligibleCollabs) {
    const types = trainingsByCollabId.get(c.id) || [];
    sum += (countCompletedMicros(types, micros) / N) * 100;
  }

  return {
    eligible: true,
    microCount: N,
    minRequired: MIN_MICROS_FOR_HEALTH,
    missing: 0,
    evaluatedCollaborators: eligibleCollabs.length,
    healthPct: Number((sum / eligibleCollabs.length).toFixed(1)),
  };
}

export interface AreaTrainingStat {
  area: MacroArea;
  total: number;
  trained: number;
  pct: number;
}

/**
 * Estatística "% Treinados" por área operacional. Cada pessoa é avaliada
 * contra a área DELA, por isCollaboratorTrained. Não inclui quem está
 * fora das macro-áreas — para o número da unidade inteira use
 * calculateUnitStats, que é o que as telas mostram.
 */
export function calculateAreaStats(
  collaborators: CollaboratorLite[],
  trainingsByCollabId: Map<string, string[]>,
  hasSorting: boolean
): AreaTrainingStat[] {
  const areas = operationalAreas(hasSorting);
  return areas.map(area => {
    const areaCollabs = collaborators.filter(c => collaboratorArea(c.sector, hasSorting, c.activity) === area);
    const total = areaCollabs.length;
    const trained = areaCollabs.filter(c =>
      isCollaboratorTrained(c.sector, trainingsByCollabId.get(c.id) || [], hasSorting, c.activity, c.is_leader)
    ).length;
    return { area, total, trained, pct: total > 0 ? Number(((trained / total) * 100).toFixed(1)) : 0 };
  });
}

/** Agrega as AreaTrainingStat em um único percentual geral (soma/soma, não média das médias). */
export function calculateOverallTrainedPct(stats: { total: number; trained: number }[]): { total: number; trained: number; pct: number } {
  const total = stats.reduce((s, a) => s + a.total, 0);
  const trained = stats.reduce((s, a) => s + a.trained, 0);
  return { total, trained, pct: total > 0 ? Number(((trained / total) * 100).toFixed(1)) : 0 };
}

export interface UnitStats {
  /** Uma linha por área operacional + a linha OUTROS. Cada pessoa aparece em exatamente uma. */
  byArea: { area: StatArea; total: number; trained: number; pct: number }[];
  total: number;
  trained: number;
  pct: number;
}

/**
 * O NÚMERO OFICIAL DA UNIDADE — o mesmo em Dashboard, Colaboradores e
 * Relatórios. Toda pessoa da lista entra exatamente uma vez, inclusive
 * quem está em Apoio/Almox/sem setor (que cai no grupo OUTROS), então
 * `total` bate com o headcount informado e a soma das áreas fecha com o
 * geral — sem "pessoas invisíveis" como acontecia antes de 13/08/2026.
 */
export function calculateUnitStats(
  collaborators: CollaboratorLite[],
  trainingsByCollabId: Map<string, string[]>,
  hasSorting: boolean
): UnitStats {
  const areas: StatArea[] = [...operationalAreas(hasSorting), OTHER_AREA];
  const buckets = new Map<StatArea, { total: number; trained: number }>(
    areas.map(a => [a, { total: 0, trained: 0 }])
  );

  for (const c of collaborators) {
    const bucket = buckets.get(collaboratorArea(c.sector, hasSorting, c.activity));
    if (!bucket) continue;
    bucket.total++;
    if (isCollaboratorTrained(c.sector, trainingsByCollabId.get(c.id) || [], hasSorting, c.activity, c.is_leader)) bucket.trained++;
  }

  const byArea = areas.map(area => {
    const { total, trained } = buckets.get(area)!;
    return { area, total, trained, pct: total > 0 ? Number(((trained / total) * 100).toFixed(1)) : 0 };
  });

  return { byArea, ...calculateOverallTrainedPct(byArea) };
}
