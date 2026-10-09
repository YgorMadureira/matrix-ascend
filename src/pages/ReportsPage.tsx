import { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Upload, BarChart2, AlertCircle, Download, FileDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, LabelList, Cell } from 'recharts';
import {
  isAreaTrained,
  isCollaboratorTrained,
  isMicroCompletedBy,
  collaboratorArea,
  normalizeMacroArea,
  operationalAreas,
  OTHER_AREA,
  type MacroArea,
} from '@/lib/trainingRules';
import { filterTeamOfLeader } from '@/lib/leaderTeam';
import { carregarRegrasDeArea } from '@/lib/areaRules';
import { useSocsERegionais } from '@/lib/regionais';
import {
  chaveDoMicro,
  deduplicarMicros,
  desempenhoPorRegional,
  indexarMicrosPorSoc,
  regionaisAlcancaveis,
  socsDaRegional,
} from '@/lib/escopoRelatorios';

const ALL_TRAINING_TYPES = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'ASM'] as const;
const ALL_CORE_SECTORS = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'EXPEDICAO', 'TRATATIVAS', 'ASM'];

interface SocMicroTraining {
  id: string;
  soc_name: string;
  macro_area: string;
  name: string;
  is_mandatory: boolean;
  order_num: number;
}

interface Collaborator {
  id: string;
  name: string;
  soc: string;
  sector: string;
  shift: string;
  role: string;
  leader: string;
  email?: string | null;
  is_leader?: boolean;
  /** Vínculo resolvido com a linha do líder — ver resolve_leader_links() no banco. */
  leader_id?: string | null;
  /** Identifica quem faz Sorter dentro do setor Processamento — ver collaboratorArea() em trainingRules.ts. */
  activity?: string | null;
  /** Só para as exportações. */
  bpo?: string | null;
}

interface Training {
  id: string;
  collaborator_id: string;
  training_type: string;
  completed_at: string;
  created_at?: string;
  /**
   * Se há imagem de assinatura — a imagem em si NÃO vem na carga da tela.
   * Ver o comentário de carregarBaseRelatorios e abrirAssinatura.
   */
  has_signature: boolean;
  instructor_name?: string;
}

interface BaseRelatorios {
  /** A unidade inteira (ou todas, para o master sem unidade escolhida) — sem o recorte de "Meu Time". */
  collabs: Collaborator[];
  trainings: Training[];
  micros: SocMicroTraining[];
}

// Identidade estável enquanto os dados não chegaram — sem isto, cada render
// criaria um [] novo e todos os useMemo abaixo recalculariam à toa.
const SEM_COLABORADORES: Collaborator[] = [];
const SEM_TREINAMENTOS: Training[] = [];
const SEM_MICROS: SocMicroTraining[] = [];

const LIMITE_PAGINA = 1000;
/** +1 página de margem: entre a contagem e a busca alguém pode ter inserido linhas. A extra volta vazia quando não há nada. */
const paginasPara = (total: number | null) => Math.ceil((total ?? 0) / LIMITE_PAGINA) + 1;

/** O primeiro erro de uma leva de páginas — sem isto, uma página que falhasse sumia calada e a tela mostraria números a menos. */
function primeiroErro(respostas: { error: { message: string } | null }[]): void {
  const falha = respostas.find(r => r.error);
  if (falha?.error) throw new Error(falha.error.message);
}

/**
 * Recorta uma consulta pelas unidades da tela: null = todas (master), uma
 * unidade = eq (a mesma consulta de sempre), várias (uma regional) = in.
 *
 * Sem restrição de tipo em Q de propósito: exigir "Q tem eq e in" faz o
 * TypeScript expandir os tipos do construtor de consultas do Supabase até
 * desistir (TS2589). eq/in devolvem o mesmo construtor, então Q se mantém.
 */
function filtrarPorSocs<Q>(q: Q, coluna: string, socs: string[] | null): Q {
  if (!socs) return q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const consulta = q as any;
  return socs.length === 1 ? consulta.eq(coluna, socs[0]) : consulta.in(coluna, socs);
}

// ── Filtro de regional ───────────────────────────────────────
// A escolha guarda junto a unidade do seletor do topo no momento em que foi
// feita: trocar a unidade lá em cima desliga o filtro de regional (vale a
// última escolha da pessoa), sem precisar de efeito nenhum para "limpar".
// Fica no navegador só por conveniência — perder isso não perde nada.
interface EscolhaRegional { id: string; soc: string | null; }
const CHAVE_REGIONAL = 'relatorios_regional';

function lerEscolhaRegional(): EscolhaRegional | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_REGIONAL) ?? 'null');
    return v && typeof v.id === 'string' ? { id: v.id, soc: typeof v.soc === 'string' ? v.soc : null } : null;
  } catch {
    return null;
  }
}

function guardarEscolhaRegional(escolha: EscolhaRegional | null): void {
  try {
    if (escolha) localStorage.setItem(CHAVE_REGIONAL, JSON.stringify(escolha));
    else localStorage.removeItem(CHAVE_REGIONAL);
  } catch { /* navegador sem armazenamento: o filtro só não é lembrado */ }
}

/** Pedaço de nome de arquivo: "Regional 1 — SP Metrópole" → "Regional_1_SP_Metropole". */
const paraNomeDeArquivo = (texto: string) =>
  texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// ============================================================
// Carga da tela — colaboradores, assinaturas e micros da unidade em foco.
//
// Até 29/09/2026 esta carga era o motivo de a tela "não abrir":
//
//  · Baixava a coluna signature_pdf_url de TODAS as assinaturas do banco.
//    13.428 delas guardam a imagem da assinatura em base64 (~29 KB cada):
//    ~376 MB a cada abertura da tela, mesmo para quem olha uma unidade só
//    — a imagem só era usada no link "Assinatura" da matriz. O próprio
//    comentário da migração 20260810_01 (signatures_view) já avisava disso
//    e pedia para trazer esta tela para o mesmo padrão.
//  · As assinaturas vinham de TODAS as unidades, sem filtro, embora só as
//    da unidade em foco sejam usadas.
//  · Eram ~75 páginas pedidas UMA DEPOIS DA OUTRA, cada uma esperando a
//    anterior.
//  · Nada ficava guardado: cada visita à tela refazia tudo.
//
// Agora: as assinaturas vêm de signatures_view (has_signature no lugar da
// imagem, que é buscada só quando alguém clica em "Assinatura"), filtradas
// pela unidade no banco, com as páginas pedidas todas de uma vez e o
// resultado guardado pelo React Query — voltar à tela é instantâneo.
//
// Órfãs (assinatura sem collaborator_id — ~11,5 mil, quase todas do
// incidente de agosto) ficam de fora com o filtro collaborator_id não nulo.
// A view as inclui, atribuídas à unidade do snapshot (20260812_02), mas esta
// tela nunca as usou: tudo aqui é indexado por colaborador. Sem o filtro,
// seriam ~5 MB a mais na visão de todas as unidades, só para serem
// ignorados. Com ele, o conjunto é exatamente o de antes — conferido em
// 29/09/2026 contra a tabela, unidade por unidade: nenhuma assinatura a
// mais, nenhuma a menos, e has_signature igual ao signature_pdf_url em
// todas.
// ============================================================
async function carregarBaseRelatorios(socs: string[] | null): Promise<BaseRelatorios> {
  // Lista vazia = regional sem nenhuma unidade alcançável: não há o que
  // buscar. O filtro só oferece regionais com unidade, então é só uma rede —
  // um "in ()" vazio no PostgREST não é algo em que valha confiar.
  if (socs && socs.length === 0) {
    await carregarRegrasDeArea();
    return { collabs: [], trainings: [], micros: [] };
  }

  // socs null = master sem unidade escolhida → vê todas. Filtrar por '' não
  // casaria com ninguém e mostraria a tela vazia sem aviso.
  const contaColabs = filtrarPorSocs(
    supabase.from('collaborators').select('id', { count: 'exact', head: true }),
    'soc', socs,
  );
  const contaAssinaturas = filtrarPorSocs(
    supabase
      .from('signatures_view')
      .select('id', { count: 'exact', head: true })
      .not('collaborator_id', 'is', null),
    'collaborator_soc', socs,
  );
  const microQuery = filtrarPorSocs(
    supabase.from('soc_micro_trainings').select('*').order('order_num'),
    'soc_name', socs,
  );

  // As regras de área configuradas em Configurações entram no motor antes
  // de qualquer cálculo desta tela — ver src/lib/areaRules.ts. Vão na mesma
  // leva das contagens: só precisam ter chegado antes do cálculo.
  const [, cColabs, cAssinaturas, micros] = await Promise.all([
    carregarRegrasDeArea(), contaColabs, contaAssinaturas, microQuery,
  ]);
  primeiroErro([cColabs, cAssinaturas, micros]);

  const [paginasColabs, paginasAssinaturas] = await Promise.all([
    Promise.all(Array.from({ length: paginasPara(cColabs.count) }, (_, i) => {
      const q = supabase
        .from('collaborators')
        .select('id, name, soc, sector, shift, role, leader, email, is_leader, leader_id, activity, bpo')
        // Ordenar por nome NÃO basta para paginar: nomes se repetem (25 casos
        // em SP8), e com empate o Postgres pode devolver a mesma linha em duas
        // páginas e pular outra. Duas linhas com o mesmo id viram chaves React
        // repetidas na matriz, e daí sai o erro "removeChild: o nó a ser
        // removido não é filho deste nó". O id desempata e torna a paginação
        // determinística, sem mudar a ordem de exibição.
        .order('name')
        .order('id')
        .range(i * LIMITE_PAGINA, (i + 1) * LIMITE_PAGINA - 1);
      return filtrarPorSocs(q, 'soc', socs);
    })),
    Promise.all(Array.from({ length: paginasPara(cAssinaturas.count) }, (_, i) => {
      const q = supabase
        .from('signatures_view')
        .select('id, collaborator_id, training_type, completed_at, created_at, instructor_name, has_signature')
        .not('collaborator_id', 'is', null)
        // Sem ordenação estável, páginas pedidas ao mesmo tempo podem repetir
        // uma assinatura e perder outra.
        .order('id')
        .range(i * LIMITE_PAGINA, (i + 1) * LIMITE_PAGINA - 1);
      return filtrarPorSocs(q, 'collaborator_soc', socs);
    })),
  ]);
  primeiroErro(paginasColabs);
  primeiroErro(paginasAssinaturas);

  return {
    collabs: paginasColabs.flatMap(r => (r.data ?? []) as Collaborator[]),
    trainings: paginasAssinaturas.flatMap(r => (r.data ?? []) as Training[]),
    micros: (micros.data ?? []) as SocMicroTraining[],
  };
}

/** Converte "data:image/png;base64,..." num Blob — sem fetch(), que uma política de segurança de conteúdo poderia barrar. */
function blobDeDataUri(dataUri: string): Blob {
  const [cabecalho, conteudo] = dataUri.split(',', 2);
  const tipo = cabecalho.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream';
  const binario = cabecalho.includes(';base64') ? atob(conteudo) : decodeURIComponent(conteudo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

/**
 * Abre a assinatura de UM registro, buscando a imagem só agora.
 *
 * A aba é aberta já no clique, vazia, e só depois recebe o endereço: aberta
 * depois do await, o bloqueador de pop-up do navegador a barraria. E a
 * imagem em base64 vira um endereço blob: — o Chrome não abre "data:" direto
 * numa aba nova (fica em branco), que era o que o link antigo fazia.
 */
async function abrirAssinatura(trainingId: string): Promise<void> {
  const aba = window.open('', '_blank');
  const toastId = toast.loading('Carregando assinatura...');
  const { data, error } = await supabase
    .from('trainings_completed')
    .select('signature_pdf_url')
    .eq('id', trainingId)
    .maybeSingle();
  toast.dismiss(toastId);

  const url = data?.signature_pdf_url as string | null | undefined;
  if (error || !url) {
    aba?.close();
    toast.error('Assinatura não encontrada para este registro.');
    return;
  }

  let destino = url;
  if (url.startsWith('data:')) {
    destino = URL.createObjectURL(blobDeDataUri(url));
    // A aba já carregou a imagem bem antes disso; liberar a memória depois.
    setTimeout(() => URL.revokeObjectURL(destino), 60_000);
  }
  if (aba) {
    aba.opener = null;
    aba.location.href = destino;
  } else {
    window.open(destino, '_blank', 'noopener');
  }
}

export default function ReportsPage() {
  const { profile, isLider, isAdmin, isMaster, allowedSocs, loading: authLoading, socHasSorting, effectiveSoc } = useAuth();

  // ── Regional ─────────────────────────────────────────────────
  // SOCs, regionais e o sorter de cada unidade: uma consulta pequena, a
  // mesma do cartão de Regionais em Configurações (src/lib/regionais.ts).
  const { data: socsERegionais, status: statusRegionais } = useSocsERegionais(!authLoading && !!profile);
  const [escolhaRegional, setEscolhaRegional] = useState<EscolhaRegional | null>(lerEscolhaRegional);

  /** Unidades que este usuário enxerga — o master, todas. A RLS decide de verdade; isto só evita oferecer o que viria vazio. */
  const alcanca = useCallback(
    (soc: string) => isMaster || allowedSocs.includes(soc),
    [isMaster, allowedSocs],
  );
  const regionaisDoFiltro = useMemo(
    () => socsERegionais ? regionaisAlcancaveis(socsERegionais.regionais, socsERegionais.socs, alcanca) : [],
    [socsERegionais, alcanca],
  );
  // O filtro aparece para quem enxerga mais de uma unidade — a mesma regra
  // do seletor de unidade do topo. Com uma unidade só não há o que agrupar.
  const mostrarFiltroRegional = (isMaster || allowedSocs.length > 1) && regionaisDoFiltro.length > 0;

  const regionalAtiva = useMemo(() => {
    if (!escolhaRegional || escolhaRegional.soc !== effectiveSoc || !mostrarFiltroRegional || !socsERegionais) return null;
    const regional = regionaisDoFiltro.find(r => r.id === escolhaRegional.id);
    if (!regional) return null;
    return { ...regional, socs: socsDaRegional(regional.id, socsERegionais.socs, alcanca) };
  }, [escolhaRegional, effectiveSoc, mostrarFiltroRegional, socsERegionais, regionaisDoFiltro, alcanca]);

  const escolherRegional = (id: string) => {
    const escolha = id ? { id, soc: effectiveSoc } : null;
    setEscolhaRegional(escolha);
    guardarEscolhaRegional(escolha);
  };

  /** As unidades desta tela: as da regional escolhida, a do topo, ou null = todas (só o master). */
  const socsDoEscopo: string[] | null = regionalAtiva ? regionalAtiva.socs : (effectiveSoc ? [effectiveSoc] : null);
  const variasUnidades = !socsDoEscopo || socsDoEscopo.length > 1;
  /** Nome curto do que está na tela, para avisos e botões. */
  const nomeEscopo = regionalAtiva ? regionalAtiva.nome : effectiveSoc ? `SOC ${effectiveSoc}` : 'todas as SOCs';
  const arquivoEscopo = paraNomeDeArquivo(regionalAtiva ? regionalAtiva.nome : effectiveSoc ?? 'todas_socs') || 'relatorio';
  // Uma escolha de regional lembrada de outra visita ainda esperando a lista
  // de regionais: sem esta espera, a tela buscaria primeiro a unidade do
  // topo (ou TODAS, para o master) só para jogar fora logo em seguida.
  const aguardandoRegionais = !!escolhaRegional && escolhaRegional.soc === effectiveSoc && statusRegionais === 'pending';

  const {
    data: base,
    isLoading: carregandoBase,
    isFetching: atualizandoBase,
    error: erroBase,
    refetch: recarregarBase,
  } = useQuery({
    // Uma unidade continua com a chave de sempre ('SP6'); uma regional entra
    // com a lista das unidades, então mexer na composição dela em
    // Configurações já pede os dados certos.
    queryKey: ['relatorios-base', socsDoEscopo ? socsDoEscopo.join(',') : '*'],
    queryFn: () => carregarBaseRelatorios(socsDoEscopo),
    // Só depois do login resolvido: antes disso effectiveSoc ainda é null, e
    // null significa "todas as unidades" — seria a carga mais pesada, à toa.
    enabled: !authLoading && !!profile && !aguardandoRegionais,
    staleTime: 5 * 60 * 1000,
    // Decisão de 01/09/2026 (ver o comentário acima de isRefreshing): voltar
    // de outra aba NÃO recarrega a tela sozinho — há o botão "Atualizar".
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (erroBase) toast.error(`Não consegui carregar os dados do relatório: ${(erroBase as Error).message}`);
  }, [erroBase]);

  const todosDaUnidade = base?.collabs ?? SEM_COLABORADORES;
  const trainings = base?.trainings ?? SEM_TREINAMENTOS;
  const microTrainings = base?.micros ?? SEM_MICROS;

  // Time do líder pelo vínculo resolvido no banco (leader_id), com o
  // casamento por texto só como rede — ver src/lib/leaderTeam.ts. Fica fora
  // da busca de propósito: é recorte em memória, não precisa de rede.
  // `profile` inteiro (e não só full_name/leader_key) porque filterTeamOfLeader
  // também usa o e-mail para achar a linha do líder.
  const collaborators = useMemo(
    () => (isLider && !isAdmin) ? filterTeamOfLeader(todosDaUnidade, profile) : todosDaUnidade,
    [todosDaUnidade, isLider, isAdmin, profile],
  );
  const sectors = useMemo(
    () => [...new Set(todosDaUnidade.map(x => x.sector || 'Sem Setor'))],
    [todosDaUnidade],
  );

  const [selectedSector, setSelectedSector] = useState('');
  const [selectedLeader, setSelectedLeader] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTrainingType, setSelectedTrainingType] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'trained' | 'pending'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Trocar de unidade ou de regional pode tirar da tela o setor que estava
  // filtrado — e o filtro escondia todo mundo sem dizer por quê. Só depois
  // de os dados novos chegarem (durante a carga a lista de setores é vazia).
  useEffect(() => {
    if (base && selectedSector && !sectors.includes(selectedSector)) setSelectedSector('');
  }, [base, sectors, selectedSector]);

  // ── Sorter (ASM) ─────────────────────────────────────────────
  // showAsm decide o que a TELA mostra (card e coluna de ASM): com uma
  // unidade, se ela tem sorter; numa regional, se alguma delas tem.
  const sortingPorSoc = useMemo(
    () => new Map((socsERegionais?.socs ?? []).map(s => [s.name, !!s.has_sorting])),
    [socsERegionais],
  );
  const showAsm = regionalAtiva && sortingPorSoc.size > 0
    ? regionalAtiva.socs.some(s => sortingPorSoc.get(s) === true)
    : socHasSorting !== false;

  /**
   * O sorter usado para AVALIAR uma pessoa: o da unidade dela. Com uma
   * unidade na tela é o mesmo showAsm de sempre. Com várias (regional ou
   * todas), cada pessoa usa o da própria unidade — como o Dashboard e a view
   * collaborators_status já fazem (coalesce(has_sorting, false)). Até
   * 09/10/2026, na visão "Todas as unidades", todo mundo era avaliado como se
   * a unidade tivesse sorter, e a soma das unidades não batia com o total.
   */
  const sorterDe = useCallback((soc: string | null | undefined): boolean => {
    if (!variasUnidades || sortingPorSoc.size === 0) return showAsm;
    return sortingPorSoc.get(soc ?? '') ?? false;
  }, [variasUnidades, sortingPorSoc, showAsm]);
  const TRAINING_TYPES = showAsm
    ? ALL_TRAINING_TYPES
    : ALL_TRAINING_TYPES.filter(t => t !== 'ASM') as unknown as typeof ALL_TRAINING_TYPES;
  const CORE_SECTORS = showAsm
    ? ALL_CORE_SECTORS
    : ALL_CORE_SECTORS.filter(s => s !== 'ASM');


  // "Líderes" é a mesma leitura da aba Operacional (as cinco macro-áreas),
  // só que restrita a quem tem is_leader — assim a visão de líderes usa
  // exatamente a mesma régua de treinamento do resto do sistema.
  const AREAS = ['Operacional', 'Líderes', 'COP', 'HSE', 'Qualidade', 'Security', 'Inventario', 'People', 'Meio Ambiente'] as const;
  const isAreaOperacional = (area: string) => area === 'Operacional' || area === 'Líderes';
  const [selectedArea, setSelectedArea] = useState<string>('Operacional');
  const [visibleCount, setVisibleCount] = useState(100);
  const [isExporting, setIsExporting] = useState(false);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const bottom = e.currentTarget.scrollHeight - e.currentTarget.scrollTop <= e.currentTarget.clientHeight + 100;
    if (bottom) {
      setVisibleCount(prev => prev + 100);
    }
  }, []);

  // Debounce do campo de busca (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const toggleSectorFilter = (type: string) => {
    setSelectedTrainingType(prev => prev === type ? '' : type);
  };

  // Filtro de treinamentos por data
  const filteredTrainings = useMemo(() => {
    if (!startDate && !endDate) return trainings;
    
    return trainings.filter(t => {
      const dateVal = t.created_at || t.completed_at;
      if (!dateVal) return true;
      const tDate = new Date(dateVal).toISOString().split('T')[0];
      if (startDate && tDate < startDate) return false;
      if (endDate && tDate > endDate) return false;
      return true;
    });
  }, [trainings, startDate, endDate]);

  // === LOOKUP MAPS para performance O(1) ===
  const collaboratorMap = useMemo(() => {
    const map = new Map<string, Collaborator>();
    collaborators.forEach(c => map.set(c.id, c));
    return map;
  }, [collaborators]);

  const trainingsByCollabId = useMemo(() => {
    const map = new Map<string, Training[]>();
    filteredTrainings.forEach(t => {
      let arr = map.get(t.collaborator_id);
      if (!arr) { arr = []; map.set(t.collaborator_id, arr); }
      arr.push(t);
    });
    return map;
  }, [filteredTrainings]);

  const allTrainingsByCollabId = useMemo(() => {
    const map = new Map<string, Training[]>();
    trainings.forEach(t => {
      let arr = map.get(t.collaborator_id);
      if (!arr) { arr = []; map.set(t.collaborator_id, arr); }
      arr.push(t);
    });
    return map;
  }, [trainings]);

  /** Tipos de treinamento de um colaborador, já como array de string (formato do motor). */
  const typesOf = useCallback((collabId: string) =>
    (trainingsByCollabId.get(collabId) ?? []).map(t => t.training_type ?? ''),
  [trainingsByCollabId]);

  /**
   * "Este colaborador está treinado nesta área?" — motor único
   * (src/lib/trainingRules.ts). Até 13/08/2026 esta função era uma cópia
   * própria da regra, mais frouxa que a do Dashboard: qualquer treinamento
   * com a palavra "Onboarding" (inclusive HSE e People) valia como
   * treinamento operacional, e por isso a tela mostrava 99,1% onde o
   * Dashboard mostrava 97,9%.
   */
  const hasTraining = useCallback((collabId: string, type: string) => {
    const types = typesOf(collabId);
    if (types.length === 0) return false;

    // Cards de área administrativa (HSE, People, Qualidade...): a aba não é
    // operacional, então a pergunta é só "fez o onboarding daquela área?".
    const reqType = type.toUpperCase();
    if (!ALL_CORE_SECTORS.includes(reqType)) {
      return types.some(t => {
        const tType = t.toUpperCase();
        return tType.includes('ONBOARDING') && tType.includes(reqType);
      });
    }

    const collab = collaboratorMap.get(collabId);
    const sorter = sorterDe(collab?.soc);
    // Quem está na própria área é avaliado pela regra canônica (que carrega a
    // exceção do Sorter); para as demais colunas da matriz vale a área pedida.
    const area = (reqType === 'EXPEDICAO' ? 'EXPEDIÇÃO' : reqType) as MacroArea;
    if (collab && collaboratorArea(collab.sector, sorter, collab.activity) === area) {
      return isCollaboratorTrained(collab.sector, types, sorter, collab.activity, collab.is_leader);
    }
    return isAreaTrained(types, area, sorter);
  }, [typesOf, collaboratorMap, sorterDe]);

  /**
   * Tick da Matriz de Certificação: este micro-processo está concluído?
   * Delega ao motor único (isMicroCompletedBy). Antes de 13/08/2026 esta
   * função era a 4ª cópia da regra e a única que não conhecia ASM nem
   * "Com Sorter" — o mesmo colaborador acendia ASM no Dashboard e não
   * acendia na matriz desta tela.
   */
  const hasMicroTraining = useCallback((collabId: string, microName: string, macroArea: string) => {
    const sorter = sorterDe(collaboratorMap.get(collabId)?.soc);
    return typesOf(collabId).some(t => isMicroCompletedBy(t, microName, macroArea, sorter));
  }, [typesOf, collaboratorMap, sorterDe]);

  /**
   * "Esta pessoa está pendente?" — a MESMA pergunta que a tela de
   * Colaboradores faz. Era `CORE_SECTORS.some(...)`, ou seja, "treinado em
   * QUALQUER área", e por isso o filtro de pendentes daqui mostrava 2 onde
   * a tela de Colaboradores mostrava 17.
   */
  const isGenerallyTrained = useCallback((collabId: string) => {
    const collab = collaboratorMap.get(collabId);
    return isCollaboratorTrained(collab?.sector, typesOf(collabId), sorterDe(collab?.soc), collab?.activity, collab?.is_leader);
  }, [collaboratorMap, typesOf, sorterDe]);

  // Antes disto, voltar de outra aba depois de 5 minutos recarregava a
  // página sozinha — 50 mil linhas e os dois gráficos de Recharts
  // reanimando no meio de qualquer coisa que a pessoa estivesse fazendo.
  // Era o gatilho mais provável do erro "Failed to execute 'removeChild'"
  // relatado em 01/09/2026: a tela "quebrava do nada" justamente ao trocar
  // de aba e voltar. Trocado pelo botão "Atualizar" — handleRefresh, logo
  // abaixo do gráfico por SOC, já que chama as duas fontes de dado. Por
  // isso as duas buscas desta tela têm refetchOnWindowFocus: false.
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filtered = useMemo(() => collaborators.filter(c => {
    const matchSector = !selectedSector || c.sector === selectedSector;
    
    if (!matchSector) return false;

    // Filter by Area Tab
    const s = (c.sector || '').toUpperCase();
    if (selectedArea === 'Líderes') {
      // Só quem está cadastrado como líder (flag is_leader). Nas demais abas
      // os líderes continuam entrando junto com o time — decisão de 14/08:
      // é um número só.
      if (!c.is_leader) return false;
    } else if (selectedArea === 'Operacional') {
      // Entra a unidade INTEIRA: as macro-áreas e também quem está em Apoio,
      // Almox ou sem setor (grupo OUTROS). Antes de 13/08/2026 esse pessoal
      // era descartado aqui — sumia do relatório mas aparecia como pendente
      // na tela de Colaboradores, e era parte da divergência entre as telas.
    } else if (selectedArea === 'Inventario') {
      if (s !== 'INVENTARIO' && s !== 'INVENTÁRIO') return false;
    } else if (selectedArea === 'People') {
      if (s !== 'PEOPLE' && s !== 'RH') return false;
    } else {
      if (s !== selectedArea.toUpperCase()) return false;
    }

    if (statusFilter !== 'all') {
      const done = selectedTrainingType 
        ? hasTraining(c.id, selectedTrainingType)
        : isGenerallyTrained(c.id);
        
      if (statusFilter === 'trained' && !done) return false;
      if (statusFilter === 'pending' && done) return false;
    }

    return true;
  }), [collaborators, selectedSector, selectedArea, statusFilter, selectedTrainingType, hasTraining, isGenerallyTrained]);

  const microFiltered = useMemo(() => {
    if (!search) return filtered;
    const searchLower = search.toLowerCase();
    return filtered.filter(c => c.name.toLowerCase().includes(searchLower));
  }, [filtered, search]);

  /**
   * Micro-processos na ordem em que a matriz os exibe: agrupados por
   * macro-área e, dentro dela, pelo order_num do cadastro.
   *
   * O cadastro (Configuracoes -> Processos Micros) guarda só order_num, e nada
   * obriga as áreas a virem em blocos — em 8 das 13 unidades elas vêm
   * intercaladas. Em RS2, por exemplo, "RECEITA FEDERAL" e "SALVADOS"
   * (Tratativas) ocupam as posições 8 e 9, entre itens de Processamento.
   * O cabeçalho de grupo emite um colSpan do tamanho TOTAL de cada área, o que
   * só se alinha se as colunas já estiverem agrupadas; sem isto as faixas
   * saíam deslocadas e um micro de Tratativas aparecia sob Processamento.
   * Ordenar aqui conserta os dois lados de uma vez, porque o cabeçalho e as
   * células passam a sair da MESMA lista.
   */
  //
  // Com várias unidades na tela (regional ou todas), o mesmo micro vem uma
  // vez por unidade que o cadastrou: deduplicarMicros deixa uma coluna por
  // área + nome. Com uma unidade só, nada muda. Ver src/lib/escopoRelatorios.ts.
  const orderedMicros = useMemo(() => {
    const ordem = operationalAreas(showAsm) as string[];
    const peso = (m: SocMicroTraining) => {
      const i = ordem.indexOf(normalizeMacroArea(m.macro_area) as string);
      return i === -1 ? ordem.length : i; // área desconhecida vai para o fim
    };
    return deduplicarMicros(microTrainings).sort((a, b) =>
      peso(a) - peso(b) ||
      (a.order_num ?? 0) - (b.order_num ?? 0) ||
      (a.name || '').localeCompare(b.name || '')
    );
  }, [microTrainings, showAsm]);

  /**
   * Obrigatório/Sugestão de cada célula vem do cadastro da UNIDADE DA PESSOA,
   * não do micro que representa a coluna: numa regional, o mesmo micro pode
   * ser obrigatório numa unidade e sugestão em outra (14 casos em 09/10/2026),
   * e quem é de uma unidade que nem cadastrou aquele micro não é cobrado por
   * ele. Com uma unidade só, é exatamente o cadastro da coluna, como antes.
   */
  const microsPorSoc = useMemo(() => indexarMicrosPorSoc(microTrainings), [microTrainings]);
  const chaveDaColuna = useMemo(
    () => new Map(orderedMicros.map(m => [m.id, chaveDoMicro(m.macro_area, m.name)])),
    [orderedMicros],
  );

  useEffect(() => {
    setVisibleCount(100);
  }, [microFiltered]);

  const currentTrainingTypes = useMemo(() => {
    // OUTROS entra como um grupo próprio para que a soma dos cards feche com
    // o card GERAL — ninguém fica de fora da conta.
    if (isAreaOperacional(selectedArea)) return [...operationalAreas(showAsm), OTHER_AREA] as string[];
    if (selectedArea === 'Inventario') return ['INVENTÁRIO'];
    return [selectedArea.toUpperCase()];
  }, [selectedArea, showAsm]);

  const sectorStats = useMemo(() => currentTrainingTypes.map(type => {
    // Abas Operacional e Líderes: cada pessoa cai em exatamente um grupo (a
    // área dela, ou OUTROS) e é avaliada contra o próprio grupo, pela regra
    // canônica. A de Líderes é a mesma conta, só que sobre os líderes.
    if (isAreaOperacional(selectedArea)) {
      const bucket = filtered.filter(c => collaboratorArea(c.sector, sorterDe(c.soc), c.activity) === type);
      const completed = bucket.filter(c => isGenerallyTrained(c.id)).length;
      return { type, total: bucket.length, completed, pct: bucket.length > 0 ? Number(((completed / bucket.length) * 100).toFixed(1)) : 0 };
    }
    const bucket = type === 'INVENTÁRIO'
      ? filtered.filter(c => ['INVENTARIO', 'INVENTÁRIO'].includes((c.sector || '').toUpperCase()))
      : filtered;
    const completed = bucket.filter(c => hasTraining(c.id, type)).length;
    return { type, total: bucket.length, completed, pct: bucket.length > 0 ? Number(((completed / bucket.length) * 100).toFixed(1)) : 0 };
  }), [currentTrainingTypes, filtered, hasTraining, isGenerallyTrained, selectedArea, sorterDe]);

  const { generalTotal, generalCompleted, generalPct } = useMemo(() => {
    const total = sectorStats.reduce((sum, s) => sum + s.total, 0);
    const completed = sectorStats.reduce((sum, s) => sum + s.completed, 0);
    const pct = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0;
    return { generalTotal: total, generalCompleted: completed, generalPct: pct };
  }, [sectorStats]);

  // ── Visão de Líderes ─────────────────────────────────────────
  // Quantas pessoas cada líder tem sob ele, pelo vínculo já resolvido no
  // banco (leader_id). É o que mostra se um líder pendente afeta 5 ou 120
  // pessoas — e denuncia líderes cadastrados sem ninguém vinculado, sinal
  // de que o e-mail dele não bate com o que está no cadastro do time.
  const teamSizeByLeaderId = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of collaborators) {
      if (!c.leader_id) continue;
      map.set(c.leader_id, (map.get(c.leader_id) ?? 0) + 1);
    }
    return map;
  }, [collaborators]);

  const leaderSummary = useMemo(() => {
    const leaders = collaborators.filter(c => c.is_leader);
    const semEmail = leaders.filter(c => !c.email).length;
    const semTime = leaders.filter(c => !teamSizeByLeaderId.get(c.id)).length;
    return { total: leaders.length, semEmail, semTime };
  }, [collaborators, teamSizeByLeaderId]);

  // ============================================================
  // Gráfico "Desempenho por SOC" — a ÚNICA visão da tela que mostra
  // TODAS as unidades, sempre, ignorando os filtros da página (SOC,
  // setor, período, tipo). Vem de soc_performance_view — agregado no
  // banco, nunca uma linha por pessoa cruzando unidades. Ver
  // supabase/migrations/20260811_01_soc_performance_view.sql.
  // ============================================================
  // O agregado é o mesmo para todo mundo e não depende da unidade em foco:
  // uma entrada só no cache. A view leva ~1,5 s no banco (calcula a
  // unidade inteira de todas as SOCs), então guardar o resultado evita
  // pagar isso de novo a cada visita à tela.
  const { data: socChartData = [], error: erroGrafico, refetch: recarregarGrafico } = useQuery({
    queryKey: ['soc-performance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('soc_performance_view')
        .select('soc, total_hc, trained_hc, pct')
        .order('pct', { ascending: false });
      if (error) {
        console.error('[Relatórios] Erro ao buscar desempenho por SOC:', error.message);
        throw new Error(error.message);
      }
      return (data ?? []).map((r: { soc: string; pct: number; total_hc: number; trained_hc: number }) => ({
        soc: r.soc,
        'Treinados': Number(r.pct),
        'Nº HCs': r.total_hc,
        // Não aparece no gráfico por SOC: é o que permite somar por regional.
        treinadosHc: r.trained_hc,
      }));
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const socChartError = erroGrafico ? (erroGrafico as Error).message : null;

  // Com uma regional escolhida, o comparativo mostra só as unidades dela —
  // todas as da regional, não só as que o usuário alcança: quem decide o que
  // cada um vê do agregado é a view, como sempre foi.
  const socsDaRegionalNoGrafico = useMemo(
    () => regionalAtiva && socsERegionais ? new Set(socsDaRegional(regionalAtiva.id, socsERegionais.socs)) : null,
    [regionalAtiva, socsERegionais],
  );
  const linhasPorSoc = useMemo(
    () => socsDaRegionalNoGrafico ? socChartData.filter(d => socsDaRegionalNoGrafico.has(d.soc)) : socChartData,
    [socChartData, socsDaRegionalNoGrafico],
  );

  // Comparativo por regional — só o master, que é quem enxerga o agregado de
  // todas as unidades (para os demais a view devolve só o que a RLS libera, e
  // a soma sairia parcial).
  const [visaoGrafico, setVisaoGrafico] = useState<'soc' | 'regional'>('soc');
  const podeVerPorRegional = isMaster && (socsERegionais?.regionais.length ?? 0) > 0;
  const porRegional = podeVerPorRegional && visaoGrafico === 'regional';
  const linhasPorRegional = useMemo(() => {
    if (!podeVerPorRegional || !socsERegionais) return [];
    return desempenhoPorRegional(
      socChartData.map(d => ({ soc: d.soc, total_hc: d['Nº HCs'], trained_hc: d.treinadosHc })),
      socsERegionais.socs,
      socsERegionais.regionais,
    ).map(r => ({ soc: r.regional, 'Treinados': r.pct, 'Nº HCs': r.total_hc, regionalId: r.regionalId }));
  }, [podeVerPorRegional, socsERegionais, socChartData]);

  // Atualiza as duas fontes por trás desta tela: colaboradores/treinamentos
  // (carregarBaseRelatorios, cru em memória) e o gráfico comparativo entre
  // unidades (soc_performance_view, agregado no banco). Substitui o
  // recarregamento automático ao focar a janela — ver o comentário acima de
  // isRefreshing.
  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try { await Promise.all([recarregarBase(), recarregarGrafico()]); } finally { setIsRefreshing(false); }
  };

  const chartData: { soc: string; 'Treinados': number; 'Nº HCs': number; regionalId?: string | null }[] =
    porRegional ? linhasPorRegional : linhasPorSoc;
  /** A barra em laranja: a unidade do topo, ou a regional escolhida na visão por regional. */
  const barraEmDestaque = (d: { soc: string; regionalId?: string | null }) =>
    porRegional ? !!regionalAtiva && d.regionalId === regionalAtiva.id : d.soc === effectiveSoc;

  // A posição é entre as unidades que o gráfico mostra: com uma regional
  // escolhida, a posição dentro dela.
  const socRankPosition = useMemo(() => {
    if (porRegional || !effectiveSoc || linhasPorSoc.length === 0) return null;
    const idx = linhasPorSoc.findIndex(d => d.soc === effectiveSoc);
    if (idx === -1) return null;
    return { position: idx + 1, total: linhasPorSoc.length };
  }, [porRegional, linhasPorSoc, effectiveSoc]);

  const instructorStats = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const filteredIds = new Set(filtered.map(c => c.id));
    
    filteredTrainings.forEach(t => {
      // 1. Filtro de Colaborador (Unidade/Setor/Status)
      if (!filteredIds.has(t.collaborator_id)) return;
      
      // 2. Filtro de Tipo de Treinamento (se selecionado nos cards do topo)
      if (selectedTrainingType) {
        const tType = t.training_type?.toUpperCase() ?? '';
        const target = selectedTrainingType.toUpperCase();
        const matches = tType === target || tType.includes(target) || target.includes(tType);
        if (!matches) return;
      }
      
      const inst = t.instructor_name?.trim() || 'Desconhecido';
      if (!map.has(inst)) map.set(inst, new Set());
      map.get(inst)!.add(t.collaborator_id);
    });
    
    return Array.from(map.entries())
      .map(([name, collabSet]) => ({ name, 'Pessoas Treinadas': collabSet.size }))
      .sort((a, b) => b['Pessoas Treinadas'] - a['Pessoas Treinadas'])
      .slice(0, 15);
  }, [filteredTrainings, filtered, selectedTrainingType]);

  // Colunas da tabela "Matriz de Treinamentos": só macro-áreas de verdade —
  // OUTROS é um grupo de pessoas, não uma coluna de certificação.
  const displayTrainingTypes = useMemo(() => {
    const areas = currentTrainingTypes.filter(t => t !== OTHER_AREA);
    return selectedTrainingType ? areas.filter(t => t === selectedTrainingType) : areas;
  }, [selectedTrainingType, currentTrainingTypes]);

  // ============================================================
  // EXPORTAÇÃO: Colaboradores NÃO treinados do SOC do usuário
  // ============================================================
  // As duas exportações usam os dados que a tela JÁ carregou — a unidade
  // inteira (sem o recorte de "Meu Time" e sem o filtro de período, como
  // sempre foi) e as assinaturas dela. Até 29/09/2026 cada clique baixava
  // de novo os colaboradores e TODAS as assinaturas do banco, de todas as
  // unidades, página por página — e sem ordenação estável, o que podia
  // repetir uma assinatura e perder outra entre as páginas.
  const baseParaExportar = () => {
    // Mesma ordem do ORDER BY sector, shift, name que a busca fazia no
    // banco: vazio por último.
    const comparar = (a?: string | null, b?: string | null) =>
      !a ? (!b ? 0 : 1) : !b ? -1 : a.localeCompare(b, 'pt-BR');
    const colaboradores = [...todosDaUnidade].sort((x, y) =>
      comparar(x.sector, y.sector) || comparar(x.shift, y.shift) || comparar(x.name, y.name));
    const tiposDe = (id: string) => (allTrainingsByCollabId.get(id) ?? []).map(t => t.training_type || '');
    return { colaboradores, tiposDe };
  };

  const exportPendingCollaborators = async () => {
    if (!base) {
      toast.error('Os dados ainda estão carregando — tente de novo em alguns segundos.');
      return;
    }
    setIsExporting(true);
    try {
      // Exporta o que está na tela: a unidade do topo, a regional escolhida
      // ou, para o master sem unidade escolhida, todas.
      const { colaboradores: allCollabsForExport, tiposDe } = baseParaExportar();

      // A MESMA regra da tela e da tela de Colaboradores — motor único.
      // Até 13/08/2026 aqui morava uma 6ª cópia da regra, que perguntava
      // apenas "tem alguma assinatura com 'Onboarding' ou com o nome de
      // alguma área?", sem olhar o setor da pessoa: alguém do Recebimento
      // que só fez o treinamento de Processamento saía como treinado. Por
      // isso a tela de Colaboradores listava 17 pendentes em SC1 e este
      // arquivo trazia 2.
      const pending = allCollabsForExport.filter(c =>
        !isCollaboratorTrained(c.sector, tiposDe(c.id), sorterDe(c.soc), c.activity, c.is_leader)
      );

      if (pending.length === 0) {
        toast.success(`Todos os colaboradores (${nomeEscopo}) já estão treinados!`);
        setIsExporting(false);
        return;
      }

      // Gera CSV — a coluna de treinamentos assinados mostra, para cada
      // pendente, o que ele JÁ tem, que é a primeira pergunta de quem abre
      // o arquivo ("por que essa pessoa está aqui?").
      const headers = ['Nome', 'Setor/Area', 'Turno', 'Cargo', 'Lider', 'SOC', 'BPO', 'Treinamentos ja assinados'];
      const rows = pending.map(c => [
        c.name || '',
        c.sector || '',
        c.shift || '',
        c.role || '',
        c.leader || '',
        c.soc || '',
        c.bpo || '',
        [...new Set(tiposDe(c.id))].join(' | '),
      ]);

      const csvContent = [
        headers.join(';'),
        ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      ].join('\n');

      // BOM para Excel reconhecer UTF-8
      const BOM = '\uFEFF';
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      link.href = url;
      // Até 09/10/2026 era `${USER_SOC}` direto: para o master vendo todas
      // as unidades, o arquivo saía como "pendentes_treinamento_null_...".
      link.download = `pendentes_treinamento_${arquivoEscopo}_${dateStr}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`${pending.length} colaboradores exportados com sucesso!`);
    } catch (err) {
      console.error('Erro ao exportar:', err);
      toast.error('Erro ao gerar o arquivo. Tente novamente.');
    } finally {
      setIsExporting(false);
    }
  };

  // ============================================================
  // EXPORTAÇÃO: TODOS os colaboradores da unidade, com o status de cada um
  // ============================================================
  // Mesma fonte de dados e a MESMA regra canônica (isCollaboratorTrained) de
  // exportPendingCollaborators acima — a diferença é que aqui ninguém fica
  // de fora: cada colaborador sai com "CERTIFICADO" ou "PENDENTE", os mesmos
  // dois rótulos já usados na coluna de Status da tela de Colaboradores.
  const exportAllCollaboratorsStatus = async () => {
    if (!base) {
      toast.error('Os dados ainda estão carregando — tente de novo em alguns segundos.');
      return;
    }
    setIsExporting(true);
    try {
      const { colaboradores: allCollabsForExport, tiposDe } = baseParaExportar();

      if (allCollabsForExport.length === 0) {
        toast.error(`Nenhum colaborador encontrado (${nomeEscopo}).`);
        setIsExporting(false);
        return;
      }

      const headers = ['Nome', 'Setor/Area', 'Turno', 'Cargo', 'Lider', 'SOC', 'BPO', 'Status', 'Treinamentos ja assinados'];
      const rows = allCollabsForExport.map(c => {
        const treinado = isCollaboratorTrained(c.sector, tiposDe(c.id), sorterDe(c.soc), c.activity, c.is_leader);
        return [
          c.name || '',
          c.sector || '',
          c.shift || '',
          c.role || '',
          c.leader || '',
          c.soc || '',
          c.bpo || '',
          treinado ? 'CERTIFICADO' : 'PENDENTE',
          [...new Set(tiposDe(c.id))].join(' | '),
        ];
      });

      const csvContent = [
        headers.join(';'),
        ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      ].join('\n');

      const BOM = '﻿';
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      link.href = url;
      link.download = `colaboradores_status_${arquivoEscopo}_${dateStr}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const treinados = rows.filter(r => r[7] === 'CERTIFICADO').length;
      toast.success(`${allCollabsForExport.length} colaboradores exportados (${treinados} certificados, ${allCollabsForExport.length - treinados} pendentes)!`);
    } catch (err) {
      console.error('Erro ao exportar:', err);
      toast.error('Erro ao gerar o arquivo. Tente novamente.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-shrink-0">
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Relatórios & Matriz</h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            Gestão de certificações por unidade e setor operacional
            {regionalAtiva ? (
              <span
                title={`Unidades desta regional: ${regionalAtiva.socs.join(', ')}`}
                className="ml-2 inline-flex items-center gap-1 bg-[#EE4D2D]/10 text-[#EE4D2D] text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-[#EE4D2D]/20"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#EE4D2D] animate-pulse inline-block" />
                {regionalAtiva.nome} · {regionalAtiva.socs.length === 1 ? '1 SOC' : `${regionalAtiva.socs.length} SOCs`}
              </span>
            ) : effectiveSoc && (
              <span className="ml-2 inline-flex items-center gap-1 bg-[#EE4D2D]/10 text-[#EE4D2D] text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-[#EE4D2D]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#EE4D2D] animate-pulse inline-block" />
                SOC: {effectiveSoc}
              </span>
            )}
          </p>
          {/* Sem isto os cards mostravam 0% até os dados chegarem, como se a unidade não tivesse ninguém treinado. */}
          {(carregandoBase || aguardandoRegionais) && (
            <p className="text-[10px] text-gray-400 font-bold mt-1 flex items-center gap-1.5">
              <RefreshCw size={11} className="animate-spin" />
              Carregando dados {regionalAtiva ? `da ${regionalAtiva.nome}` : effectiveSoc ? `de ${effectiveSoc}` : 'de todas as unidades'}...
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || atualizandoBase}
            title="Recarrega colaboradores, treinamentos e o gráfico comparativo desta tela"
            className="h-8 px-3 flex items-center gap-1.5 text-[11px] font-black text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-sm disabled:opacity-60 transition-colors"
          >
            <RefreshCw size={13} className={isRefreshing || atualizandoBase ? 'animate-spin' : ''} />
            Atualizar
          </button>
          {/* Regional: junta as unidades dela na tela inteira (cards, matrizes,
              instrutores e exportações). Trocar a unidade no seletor do topo
              desliga o filtro — vale a última escolha. */}
          {mostrarFiltroRegional && (
            <select
              value={regionalAtiva?.id ?? ''}
              onChange={e => escolherRegional(e.target.value)}
              title={regionalAtiva ? `Unidades: ${regionalAtiva.socs.join(', ')}` : 'Ver os relatórios de uma regional inteira'}
              className={`h-8 px-3 text-[11px] font-black rounded-lg outline-none shadow-sm transition-all border-2 max-w-[220px] ${
                regionalAtiva ? 'bg-[#FEF6F5] border-[#EE4D2D]/30 text-[#EE4D2D]' : 'bg-white border-gray-200 text-gray-700'
              }`}
            >
              <option value="">{effectiveSoc ? `Só ${effectiveSoc} (sem regional)` : 'Todas as regionais'}</option>
              {regionaisDoFiltro.map(r => {
                const n = socsERegionais ? socsDaRegional(r.id, socsERegionais.socs, alcanca).length : 0;
                return <option key={r.id} value={r.id}>{r.nome} · {n === 1 ? '1 SOC' : `${n} SOCs`}</option>;
              })}
            </select>
          )}
          <select className="h-8 px-3 text-[11px] font-bold text-gray-700 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm" value={selectedSector} onChange={e => setSelectedSector(e.target.value)}>
            <option value="">Todos os Setores</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <div className="h-8 flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 shadow-sm">
            <span className="text-[9px] font-black text-gray-400 uppercase">Período:</span>
            <input 
              type="date" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)}
              className="text-[10px] font-bold outline-none bg-transparent"
            />
            <span className="text-gray-300">|</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)}
              className="text-[10px] font-bold outline-none bg-transparent"
            />
          </div>

          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value as any)} 
            className={`h-8 px-3 rounded-lg text-[11px] font-black outline-none transition-all border-2 ${
              statusFilter === 'trained' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 
              statusFilter === 'pending' ? 'bg-red-50 border-red-200 text-red-500' : 
              'bg-gray-50 border-transparent text-gray-700'
            }`}
          >
            <option value="all">Todos Status</option>
            <option value="trained">Certificados</option>
            <option value="pending">Pendentes</option>
          </select>

          <button
            id="btn-export-pending"
            onClick={exportPendingCollaborators}
            disabled={isExporting}
            title={`Exportar os pendentes — ${nomeEscopo}`}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#EE4D2D] hover:bg-[#d63b1f] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[11px] font-black uppercase tracking-widest rounded-lg transition-all active:scale-95 shadow-sm"
          >
            {isExporting ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Gerando...
              </>
            ) : (
              <>
                <Download size={13} />
                Exportar Pendentes
              </>
            )}
          </button>

          <button
            id="btn-export-all-status"
            onClick={exportAllCollaboratorsStatus}
            disabled={isExporting}
            title={`Exportar todos os colaboradores, com status — ${nomeEscopo}`}
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed text-gray-700 border border-gray-200 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all active:scale-95 shadow-sm"
          >
            {isExporting ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Gerando...
              </>
            ) : (
              <>
                <FileDown size={13} />
                Exportar Todos + Status
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex overflow-x-auto gap-2 border-b border-gray-200 custom-scrollbar mt-2 mb-2">
        {AREAS.map(area => (
          <button
            key={area}
            onClick={() => {
              setSelectedArea(area);
              setSelectedTrainingType('');
            }}
            className={`px-4 py-2.5 text-sm font-black whitespace-nowrap transition-colors border-b-2 ${
              selectedArea === area 
                ? 'text-[#EE4D2D] border-[#EE4D2D] bg-[#EE4D2D]/5' 
                : 'text-gray-400 border-transparent hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {area}
          </button>
        ))}
      </div>

      {selectedArea === 'Líderes' && (
        <div className="mt-4 bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Líderes cadastrados</p>
            <p className="text-2xl font-black text-gray-900">{leaderSummary.total}</p>
          </div>
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Certificados</p>
            <p className="text-2xl font-black text-emerald-600">{generalCompleted}</p>
          </div>
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Pendentes</p>
            <p className="text-2xl font-black text-red-500">{generalTotal - generalCompleted}</p>
          </div>
          {(leaderSummary.semEmail > 0 || leaderSummary.semTime > 0) && (
            <div className="flex items-start gap-2 ml-auto max-w-md bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertCircle size={15} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-700 font-medium leading-snug">
                {leaderSummary.semEmail > 0 && <>{leaderSummary.semEmail} líder(es) sem e-mail cadastrado. </>}
                {leaderSummary.semTime > 0 && <>{leaderSummary.semTime} sem nenhum colaborador vinculado. </>}
                O time é ligado pelo e-mail do líder — sem ele, o vínculo só sai se o nome bater exatamente com o campo "Líder" do colaborador.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-4">
        <div onClick={() => setSelectedTrainingType('')}
          className={`bg-white p-4 rounded-xl text-center shadow-sm cursor-pointer transition-all hover:shadow-md ${!selectedTrainingType ? 'border-2 border-[#EE4D2D]' : 'border border-gray-100'}`}>
          <p className="text-[9px] text-gray-400 font-black uppercase mb-1.5">GERAL</p>
          <p className={`text-2xl font-black ${!selectedTrainingType ? 'text-[#EE4D2D]' : 'text-gray-800'}`}>{generalPct}%</p>
          <p className="text-[8px] text-gray-400 mt-0.5 font-bold">{generalCompleted}/{generalTotal} treinados</p>
          <div className="mt-3 h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full shopee-gradient-bg rounded-full transition-all duration-1000" style={{ width: `${generalPct}%` }} />
          </div>
        </div>
        {sectorStats.map(({ type, completed, total, pct }) => (
          <div key={type} onClick={() => toggleSectorFilter(type)}
            className={`bg-white p-4 rounded-xl text-center cursor-pointer transition-all hover:shadow-md ${selectedTrainingType === type ? 'border-2 border-[#EE4D2D] scale-[1.02]' : 'border border-gray-100'}`}>
            <p className={`text-[9px] font-black uppercase mb-1.5 ${selectedTrainingType === type ? 'text-[#EE4D2D]' : 'text-gray-400'}`}>{type}</p>
            <p className={`text-xl font-black ${selectedTrainingType === type ? 'text-[#EE4D2D]' : 'text-gray-800'}`}>{pct}%</p>
            <p className="text-[8px] text-gray-400 mt-0.5 font-bold">{completed}/{total} treinados</p>
            <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-1000 ${selectedTrainingType === type ? 'bg-[#EE4D2D]' : 'bg-gray-300'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        ))}
      </div>


      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
            <BarChart2 className="text-[#EE4D2D]" size={18} />
            {porRegional ? 'Desempenho por Regional' : 'Desempenho por SOC'}
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            {socRankPosition && (
              <span className="text-[10px] font-black text-[#EE4D2D] bg-[#FEF6F5] px-2.5 py-1 rounded-full border border-[#EE4D2D]/10">
                {effectiveSoc} está em {socRankPosition.position}º de {socRankPosition.total}{regionalAtiva ? ` na ${regionalAtiva.nome}` : ''}
              </span>
            )}
            {podeVerPorRegional && (
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5" role="group" aria-label="Agrupar o comparativo">
                {(['soc', 'regional'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisaoGrafico(v)}
                    aria-pressed={visaoGrafico === v}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                      visaoGrafico === v ? 'bg-white text-[#EE4D2D] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {v === 'soc' ? 'Por SOC' : 'Por Regional'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 font-medium mb-4">
          {porRegional
            ? 'Soma das unidades de cada regional — % = treinados ÷ HC da regional inteira. Não muda com os filtros acima.'
            : regionalAtiva
              ? `Comparativo entre as unidades da ${regionalAtiva.nome} — não muda com os outros filtros acima.`
              : 'Comparativo entre todas as unidades — não muda com os filtros acima.'}
        </p>
        {socChartError ? (
          <div className="h-[280px] flex flex-col items-center justify-center text-gray-300 text-xs gap-1">
            <span>Comparativo entre unidades ainda não disponível.</span>
            <span className="text-[10px] text-gray-300">(aguardando atualização do banco)</span>
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 20, right: 10, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="soc" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <YAxis yAxisId="right" orientation="right" stroke="#1e3a8a" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: '#FEF6F5' }} contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', fontSize: '12px' }} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
              <Bar yAxisId="left" dataKey="Treinados" radius={[4, 4, 0, 0]} barSize={28} isAnimationActive={false}>
                 <LabelList dataKey="Treinados" position="top" fill="#1e3a8a" fontSize={10} fontWeight="900" formatter={(val: any) => `${val}%`} />
                 {chartData.map(d => (
                   <Cell key={d.soc} fill={barraEmDestaque(d) ? '#EE4D2D' : '#cbd5e1'} />
                 ))}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="Nº HCs" stroke="#1e3a8a" strokeWidth={2} dot={{ r: 4, fill: '#1e3a8a' }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
           <div className="h-[280px] flex items-center justify-center text-gray-300 italic text-xs">Sem dados disponíveis</div>
        )}
      </div>



      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-50 flex items-center justify-between">
           <h2 className="text-base font-black text-gray-900">Matriz de Certificação Operacional</h2>
           <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{filtered.length} Colaboradores</span>
        </div>
        <div className="overflow-x-auto overflow-y-auto max-h-[50vh] custom-scrollbar" onScroll={handleScroll}>
          <table className="w-full text-[13px] border-collapse">
            <thead className="sticky top-0 z-30 shadow-sm">
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="sticky left-0 bg-gray-50 z-40 p-0 min-w-[220px]">
                  <div className="flex items-center gap-2 p-3">
                    <div className="relative flex-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                      <input
                        type="text"
                        placeholder="Buscar colaborador..."
                        className="w-full pl-8 pr-3 py-2 text-[11px] bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#EE4D2D]/30 focus:border-[#EE4D2D]/50"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                      />
                    </div>
                    <button className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                    </button>
                  </div>
                </th>
                {displayTrainingTypes.map(t => {
                  let bgColor = 'bg-gray-100';
                  let textColor = 'text-gray-600';
                  let icon = null;
                  
                  if (t === 'RECEBIMENTO') {
                    bgColor = 'bg-[#ECF2FD]';
                    textColor = 'text-[#1A50BE]';
                    icon = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>;
                  } else if (t === 'PROCESSAMENTO') {
                    bgColor = 'bg-[#F1FBF1]';
                    textColor = 'text-[#1B8A23]';
                    icon = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M2 12h20"/></svg>;
                  } else if (t === 'EXPEDIÇÃO') {
                    bgColor = 'bg-[#FEF6E4]';
                    textColor = 'text-[#C2832B]';
                    icon = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><path d="m9 12 2 2 4-4"/></svg>;
                  } else if (t === 'TRATATIVAS') {
                    bgColor = 'bg-[#F8F3FD]';
                    textColor = 'text-[#8C70BA]';
                    icon = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>;
                  } else if (t === 'ASM') {
                    bgColor = 'bg-slate-100';
                    textColor = 'text-slate-600';
                    icon = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
                  } else {
                    bgColor = 'bg-gray-100';
                    textColor = 'text-gray-600';
                    icon = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
                  }

                  return (
                    <th key={t} className="p-0 border-r border-gray-200 last:border-0 min-w-[160px]">
                      <div className={`flex items-center justify-center gap-1.5 py-2 px-3 mx-1 my-1 rounded-lg ${bgColor} ${textColor}`}>
                        {icon}
                        <span className="text-[10px] font-black uppercase tracking-wide">{t}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {microFiltered.slice(0, visibleCount).map((c, rowIdx) => (
                <tr key={c.id} className={`border-b border-gray-100 hover:bg-blue-50 transition-colors group ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className={`sticky left-0 z-10 p-3 border-r border-gray-100 whitespace-nowrap ${rowIdx % 2 === 0 ? 'bg-white group-hover:bg-blue-50' : 'bg-gray-50 group-hover:bg-blue-50'}`}>
                    <div className="flex items-center gap-2">
                      <div>
                        <span className="text-[11px] font-black text-gray-800 uppercase block">{c.name}</span>
                        <span className="text-[9px] text-gray-400 font-medium uppercase">{c.role} • {c.sector}</span>
                      </div>
                    </div>
                  </td>
                  {displayTrainingTypes.map(type => {
                    const done = hasTraining(c.id, type);
                    const training = (allTrainingsByCollabId.get(c.id) || []).find(t => t.training_type === type);
                    
                    const macroArea = type.toUpperCase();
                    const isRecommended = c.sector && c.sector.toUpperCase().includes(macroArea);

                    let iconColor = 'text-gray-300';
                    let ringColor = 'border-gray-200';
                    let bgColor = 'bg-transparent';
                    let icon = <XCircle size={16} />;
                    let title = 'Não iniciado';

                    if (done) {
                      iconColor = 'text-emerald-500';
                      ringColor = 'border-emerald-200';
                      bgColor = 'bg-emerald-50';
                      icon = <CheckCircle2 size={16} />;
                      title = 'Concluído';
                    } else if (isRecommended) {
                      iconColor = 'text-red-500';
                      ringColor = 'border-red-200';
                      bgColor = 'bg-red-50';
                      icon = <AlertCircle size={16} />;
                      title = 'Obrigatório';
                    }

                    return (
                      <td key={type} className="text-center px-2 py-3 border-r border-gray-100 last:border-0">
                        <div className="flex flex-col items-center gap-1">
                          <div title={title} className={`flex items-center justify-center w-[28px] h-[28px] rounded-full border-[1.5px] ${ringColor} ${bgColor} ${iconColor} transition-colors`}>
                            {icon}
                          </div>
                          {training?.has_signature && (
                            <button type="button" onClick={() => abrirAssinatura(training.id)} className="text-[7px] font-black underline text-[#EE4D2D] uppercase mt-1">Assinatura</button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mt-6">
        {/* Header */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xl font-black text-gray-900">Matriz de Treinamentos</h2>
              <p className="text-[11px] text-gray-400 mt-1">Acompanhe o status dos treinamentos por colaborador e área.</p>
            </div>
            <div className="flex items-center gap-2 text-gray-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <div className="text-right">
                <span className="text-2xl font-black text-gray-800 block leading-none">{microFiltered.length}</span>
                <span className="text-[9px] text-gray-400 font-bold uppercase">colaboradores</span>
              </div>
            </div>
          </div>
        </div>

        {/* Filter bar + category headers */}
        {microTrainings.length === 0 ? (
          <div className="p-10 text-center text-gray-500 font-medium">
             Nenhum processo micro cadastrado para {regionalAtiva ? `as unidades da ${regionalAtiva.nome}` : effectiveSoc || 'sua unidade'}. Peça ao administrador para configurar na tela de Configurações.
          </div>
        ) : (() => {
          const macroAreasOrder: string[] = [];
          const macroAreasCount: Record<string, number> = {};
          orderedMicros.forEach(t => {
            // Chave normalizada: sem isto, "EXPEDICAO" e "EXPEDIÇÃO" viravam
            // duas faixas separadas para a mesma área.
            const area = (normalizeMacroArea(t.macro_area) as string) || t.macro_area;
            if (!macroAreasCount[area]) {
              macroAreasCount[area] = 0;
              macroAreasOrder.push(area);
            }
            macroAreasCount[area]++;
          });

          const getMacroConfig = (macro: string) => {
            if (macro === 'RECEBIMENTO') return { bg: 'bg-[#ECF2FD]', text: 'text-[#1A50BE]', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> };
            if (macro === 'PROCESSAMENTO') return { bg: 'bg-[#F1FBF1]', text: 'text-[#1B8A23]', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M2 12h20"/></svg> };
            if (macro === 'EXPEDIÇÃO' || macro === 'EXPEDICAO') return { bg: 'bg-[#FEF6E4]', text: 'text-[#C2832B]', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><path d="m9 12 2 2 4-4"/></svg> };
            if (macro === 'TRATATIVAS') return { bg: 'bg-[#F8F3FD]', text: 'text-[#8C70BA]', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg> };
            if (macro === 'ASM') return { bg: 'bg-slate-100', text: 'text-slate-600', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> };
            return { bg: 'bg-gray-100', text: 'text-gray-600', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> };
          };
          
          return (
        <div className="overflow-x-auto overflow-y-auto max-h-[60vh] custom-scrollbar" onScroll={handleScroll}>
          <table className="w-full text-[13px] border-collapse">
            <thead className="sticky top-0 z-30 shadow-sm">
              {/* Category row */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="sticky left-0 bg-gray-50 z-40 p-0 min-w-[220px]" rowSpan={2}>
                  <div className="flex items-center gap-2 p-3">
                    <div className="relative flex-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                      <input
                        type="text"
                        placeholder="Buscar colaborador..."
                        className="w-full pl-8 pr-3 py-2 text-[11px] bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#EE4D2D]/30 focus:border-[#EE4D2D]/50"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                      />
                    </div>
                    <button className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                    </button>
                  </div>
                </th>
                {macroAreasOrder.map((area, idx) => {
                  const conf = getMacroConfig(area);
                  return (
                    <th key={area} colSpan={macroAreasCount[area]} className={`p-0 ${idx < macroAreasOrder.length - 1 ? 'border-r border-gray-200' : ''}`}>
                      <div className={`flex items-center justify-center gap-1.5 py-2 px-3 mx-1 my-1 rounded-lg ${conf.bg} ${conf.text}`}>
                        {conf.icon}
                        <span className="text-[10px] font-black uppercase tracking-wide">{area}</span>
                      </div>
                    </th>
                  )
                })}
              </tr>
              {/* Sub-headers row */}
              <tr className="bg-white border-b border-gray-200">
                {orderedMicros.map((t) => (
                  <th key={t.id} className="text-center px-2 py-3 text-[11px] text-gray-600 font-bold whitespace-nowrap">
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {microFiltered.slice(0, visibleCount).map((c, rowIdx) => (
                <tr key={c.id} className={`border-b border-gray-100 hover:bg-blue-50 transition-colors group ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className={`sticky left-0 z-10 p-3 border-r border-gray-100 whitespace-nowrap ${rowIdx % 2 === 0 ? 'bg-white group-hover:bg-blue-50' : 'bg-gray-50 group-hover:bg-blue-50'}`}>
                    <div className="flex items-center gap-2">
                      <div>
                        <span className="text-[11px] font-black text-gray-800 uppercase block">{c.name}</span>
                        <span className="text-[9px] text-gray-400 font-medium uppercase">{c.role} • {c.sector}</span>
                      </div>
                    </div>
                  </td>
                  {orderedMicros.map((t) => {
                    const done = hasMicroTraining(c.id, t.name, t.macro_area);
                    const training = (allTrainingsByCollabId.get(c.id) || []).find(tr => tr.training_type === t.name);

                    const macroArea = t.macro_area;
                    const isSectorMatch = c.sector && (c.sector.toUpperCase() === macroArea.toUpperCase() || (macroArea.toUpperCase() === 'EXPEDIÇÃO' && c.sector.toUpperCase() === 'EXPEDICAO'));
                    // O cadastro deste micro NA UNIDADE DA PESSOA — ver microsPorSoc.
                    const cadastroDaUnidade = microsPorSoc.get(c.soc)?.get(chaveDaColuna.get(t.id) ?? '');

                    let isMandatory = false;
                    let isSuggested = false;

                    if (isSectorMatch && cadastroDaUnidade) {
                      if (cadastroDaUnidade.is_mandatory) {
                        isMandatory = true;
                      } else {
                        isSuggested = true;
                      }
                    }

                    let iconColor = 'text-gray-300';
                    let ringColor = 'border-gray-200';
                    let bgColor = 'bg-transparent';
                    let icon = <XCircle size={16} />;
                    let title = 'Não iniciado';

                    if (done) {
                      iconColor = 'text-emerald-500';
                      ringColor = 'border-emerald-200';
                      bgColor = 'bg-emerald-50';
                      icon = <CheckCircle2 size={16} />;
                      title = 'Concluído';
                    } else if (isMandatory) {
                      iconColor = 'text-red-500';
                      ringColor = 'border-red-200';
                      bgColor = 'bg-red-50';
                      icon = <AlertCircle size={16} />;
                      title = 'Obrigatório';
                    } else if (isSuggested) {
                      iconColor = 'text-amber-500';
                      ringColor = 'border-amber-200';
                      bgColor = 'bg-amber-50';
                      icon = <AlertCircle size={16} />;
                      title = 'Sugestão';
                    }

                    return (
                      <td key={t.id} className="text-center px-2 py-3">
                        <div className="flex flex-col items-center gap-1">
                          <div className={`w-7 h-7 rounded-full ${bgColor} border ${ringColor} flex items-center justify-center ${iconColor} transition-transform hover:scale-110`} title={title}>
                            {icon}
                          </div>
                          {training?.has_signature && (
                            <button type="button" onClick={() => abrirAssinatura(training.id)} className="text-[7px] font-black underline text-[#EE4D2D] uppercase">Assinatura</button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )})()}

        {/* Legend + Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-500"><CheckCircle2 size={11} /></div>
              <span className="text-[10px] text-gray-500 font-medium">Concluído</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-500"><AlertCircle size={11} /></div>
              <span className="text-[10px] text-gray-500 font-medium">Obrigatório</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-500"><AlertCircle size={11} /></div>
              <span className="text-[10px] text-gray-500 font-medium">Sugestão</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full border border-gray-200 flex items-center justify-center text-gray-300"><XCircle size={11} /></div>
              <span className="text-[10px] text-gray-500 font-medium">Não iniciado</span>
            </div>
          </div>
          <span className="text-[9px] text-gray-400 font-medium">⏱ Atualizado em tempo real</span>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm mt-6">
        <h2 className="text-base font-black text-gray-900 mb-4 flex items-center gap-2">
          <BarChart2 className="text-[#EE4D2D]" size={18} />
          Volume de Pessoas por Instrutor
        </h2>
        {instructorStats.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={instructorStats}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis 
                dataKey="name" 
                fontSize={10} 
                interval={0} 
                angle={-20} 
                textAnchor="end" 
                height={70} 
                tick={{ fill: '#6b7280', fontWeight: '500' }}
              />
              <YAxis fontSize={10} />
              <Tooltip cursor={{ fill: '#FEF6F5' }} />
              <Bar dataKey="Pessoas Treinadas" fill="#EE4D2D" radius={[4, 4, 0, 0]} barSize={36} isAnimationActive={false}>
                <LabelList dataKey="Pessoas Treinadas" position="top" fill="#1e3a8a" fontSize={10} fontWeight="900" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
           <div className="h-[280px] flex items-center justify-center text-gray-300 italic text-xs">Sem dados disponíveis</div>
        )}
      </div>
    </div>
  );
}
