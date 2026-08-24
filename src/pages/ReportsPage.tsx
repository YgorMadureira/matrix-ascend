import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Upload, BarChart2, AlertCircle, Download, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';
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
}

interface Training {
  id: string;
  collaborator_id: string;
  training_type: string;
  completed_at: string;
  created_at?: string;
  signature_pdf_url: string | null;
  instructor_name?: string;
}

export default function ReportsPage() {
  const { user, profile, isLider, isAdmin, loading: authLoading, socHasSorting, effectiveSoc } = useAuth();
  const location = useLocation();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [microTrainings, setMicroTrainings] = useState<SocMicroTraining[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [selectedSector, setSelectedSector] = useState('');
  const [selectedLeader, setSelectedLeader] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTrainingType, setSelectedTrainingType] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'trained' | 'pending'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Filtra ASM quando a SOC do usuário não possui sorting
  const showAsm = socHasSorting !== false;
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

  const lastLoadRef = useRef(0);

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
    // Quem está na própria área é avaliado pela regra canônica (que carrega a
    // exceção do Sorter); para as demais colunas da matriz vale a área pedida.
    const area = (reqType === 'EXPEDICAO' ? 'EXPEDIÇÃO' : reqType) as MacroArea;
    if (collab && collaboratorArea(collab.sector, showAsm) === area) {
      return isCollaboratorTrained(collab.sector, types, showAsm);
    }
    return isAreaTrained(types, area);
  }, [typesOf, collaboratorMap, showAsm]);

  /**
   * Tick da Matriz de Certificação: este micro-processo está concluído?
   * Delega ao motor único (isMicroCompletedBy). Antes de 13/08/2026 esta
   * função era a 4ª cópia da regra e a única que não conhecia ASM nem
   * "Com Sorter" — o mesmo colaborador acendia ASM no Dashboard e não
   * acendia na matriz desta tela.
   */
  const hasMicroTraining = useCallback((collabId: string, microName: string, macroArea: string) =>
    typesOf(collabId).some(t => isMicroCompletedBy(t, microName, macroArea)),
  [typesOf]);

  /**
   * "Esta pessoa está pendente?" — a MESMA pergunta que a tela de
   * Colaboradores faz. Era `CORE_SECTORS.some(...)`, ou seja, "treinado em
   * QUALQUER área", e por isso o filtro de pendentes daqui mostrava 2 onde
   * a tela de Colaboradores mostrava 17.
   */
  const isGenerallyTrained = useCallback((collabId: string) => {
    const collab = collaboratorMap.get(collabId);
    return isCollaboratorTrained(collab?.sector, typesOf(collabId), showAsm);
  }, [collaboratorMap, typesOf, showAsm]);

  const loadData = useCallback(async () => {
    lastLoadRef.current = Date.now();

    const allCollabs: any[] = [];
    let hasMore = true;
    let page = 0;
    const limit = 1000;

    while (hasMore) {
      let collabQuery = supabase
        .from('collaborators')
        .select('id, name, soc, sector, shift, role, leader, email, is_leader, leader_id')
        .order('name')
        .range(page * limit, (page + 1) * limit - 1);
      // soc null = admin sem unidade restrita → vê todas. Filtrar por '' não
      // casaria com nenhum colaborador e mostraria a tela vazia sem aviso.
      if (effectiveSoc) collabQuery = collabQuery.eq('soc', effectiveSoc);
      const { data, error } = await collabQuery;

      if (error) break;
      if (data) {
        allCollabs.push(...data);
        if (data.length < limit) hasMore = false;
        else page++;
      } else {
        hasMore = false;
      }
    }

    const allTrainings: any[] = [];
    let tPage = 0;
    let tHasMore = true;
    while (tHasMore) {
      const { data, error } = await supabase
        .from('trainings_completed')
        .select('id, collaborator_id, training_type, completed_at, created_at, signature_pdf_url, instructor_name')
        .range(tPage * limit, (tPage + 1) * limit - 1);
      
      if (error) break;
      if (data) {
        allTrainings.push(...data);
        if (data.length < limit) tHasMore = false;
        else tPage++;
      } else {
        tHasMore = false;
      }
    }

    let microQuery = supabase.from('soc_micro_trainings').select('*').order('order_num');
    if (effectiveSoc) microQuery = microQuery.eq('soc_name', effectiveSoc);
    const { data: microData } = await microQuery;

    // Time do líder pelo vínculo resolvido no banco (leader_id), com o
    // casamento por texto só como rede — ver src/lib/leaderTeam.ts.
    const collabData = (isLider && !isAdmin) ? filterTeamOfLeader(allCollabs, profile) : allCollabs;
    setCollaborators(collabData);
    setTrainings(allTrainings);
    setMicroTrainings(microData || []);
    setSectors([...new Set(allCollabs.map(x => (x.sector as string) || 'Sem Setor'))]);
    // `profile` inteiro (e não só full_name/leader_key) porque filterTeamOfLeader
    // também usa o e-mail para achar a linha do líder.
  }, [isLider, isAdmin, profile, effectiveSoc]);

  useEffect(() => { if (!authLoading) loadData(); }, [location.pathname, loadData, authLoading]);

  useEffect(() => {
    const onFocus = () => {
      // Só recarrega se passou mais de 5 minutos desde o último load
      if (!authLoading && Date.now() - lastLoadRef.current > 5 * 60 * 1000) {
        loadData();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadData, authLoading]);

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
  const orderedMicros = useMemo(() => {
    const ordem = operationalAreas(showAsm) as string[];
    const peso = (m: SocMicroTraining) => {
      const i = ordem.indexOf(normalizeMacroArea(m.macro_area) as string);
      return i === -1 ? ordem.length : i; // área desconhecida vai para o fim
    };
    return [...microTrainings].sort((a, b) =>
      peso(a) - peso(b) ||
      (a.order_num ?? 0) - (b.order_num ?? 0) ||
      (a.name || '').localeCompare(b.name || '')
    );
  }, [microTrainings, showAsm]);

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
      const bucket = filtered.filter(c => collaboratorArea(c.sector, showAsm) === type);
      const completed = bucket.filter(c => isGenerallyTrained(c.id)).length;
      return { type, total: bucket.length, completed, pct: bucket.length > 0 ? Number(((completed / bucket.length) * 100).toFixed(1)) : 0 };
    }
    const bucket = type === 'INVENTÁRIO'
      ? filtered.filter(c => ['INVENTARIO', 'INVENTÁRIO'].includes((c.sector || '').toUpperCase()))
      : filtered;
    const completed = bucket.filter(c => hasTraining(c.id, type)).length;
    return { type, total: bucket.length, completed, pct: bucket.length > 0 ? Number(((completed / bucket.length) * 100).toFixed(1)) : 0 };
  }), [currentTrainingTypes, filtered, hasTraining, isGenerallyTrained, selectedArea, showAsm]);

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
  const [socChartData, setSocChartData] = useState<{ soc: string; 'Treinados': number; 'Nº HCs': number }[]>([]);
  const [socChartError, setSocChartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchSocPerformance = async () => {
      const { data, error } = await supabase
        .from('soc_performance_view')
        .select('soc, total_hc, trained_hc, pct')
        .order('pct', { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error('[Relatórios] Erro ao buscar desempenho por SOC:', error.message);
        setSocChartError(error.message);
        return;
      }
      setSocChartError(null);
      setSocChartData((data ?? []).map((r: { soc: string; pct: number; total_hc: number }) => ({ soc: r.soc, 'Treinados': Number(r.pct), 'Nº HCs': r.total_hc })));
    };
    fetchSocPerformance();
    return () => { cancelled = true; };
  }, []);

  const chartData = socChartData;

  const socRankPosition = useMemo(() => {
    if (!effectiveSoc || socChartData.length === 0) return null;
    const idx = socChartData.findIndex(d => d.soc === effectiveSoc);
    if (idx === -1) return null;
    return { position: idx + 1, total: socChartData.length };
  }, [socChartData, effectiveSoc]);

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
  const exportPendingCollaborators = async () => {
    setIsExporting(true);
    try {
      // soc null = admin sem unidade restrita → exporta de todas as unidades.
      const USER_SOC = effectiveSoc;

      // Busca todos os colaboradores do SOC
      const allCollabsForExport: any[] = [];
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        let q = supabase
          .from('collaborators')
          .select('id, name, sector, shift, role, leader, soc, bpo')
          .order('sector')
          .order('shift')
          .order('name')
          .range(page * 1000, (page + 1) * 1000 - 1);
        if (USER_SOC) q = q.eq('soc', USER_SOC);
        const { data, error } = await q;
        if (error || !data) break;
        allCollabsForExport.push(...data);
        if (data.length < 1000) hasMore = false;
        else page++;
      }

      // Busca todos os treinamentos
      const allTrainingsForExport: any[] = [];
      let tPage = 0;
      let tHasMore = true;
      while (tHasMore) {
        const { data, error } = await supabase
          .from('trainings_completed')
          .select('collaborator_id, training_type')
          .range(tPage * 1000, (tPage + 1) * 1000 - 1);
        if (error || !data) break;
        allTrainingsForExport.push(...data);
        if (data.length < 1000) tHasMore = false;
        else tPage++;
      }

      // Mapa de treinamentos por colaborador
      const trainingsMapExport = new Map<string, string[]>();
      allTrainingsForExport.forEach(t => {
        const arr = trainingsMapExport.get(t.collaborator_id) || [];
        arr.push(t.training_type || '');
        trainingsMapExport.set(t.collaborator_id, arr);
      });

      // A MESMA regra da tela e da tela de Colaboradores — motor único.
      // Até 13/08/2026 aqui morava uma 6ª cópia da regra, que perguntava
      // apenas "tem alguma assinatura com 'Onboarding' ou com o nome de
      // alguma área?", sem olhar o setor da pessoa: alguém do Recebimento
      // que só fez o treinamento de Processamento saía como treinado. Por
      // isso a tela de Colaboradores listava 17 pendentes em SC1 e este
      // arquivo trazia 2.
      const pending = allCollabsForExport.filter(c =>
        !isCollaboratorTrained(c.sector, trainingsMapExport.get(c.id) || [], showAsm)
      );

      if (pending.length === 0) {
        toast.success('Todos os colaboradores' + (USER_SOC ? ` do SOC ${USER_SOC}` : '') + ' já estão treinados!');
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
        [...new Set(trainingsMapExport.get(c.id) || [])].join(' | '),
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
      link.download = `pendentes_treinamento_${USER_SOC}_${dateStr}.csv`;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-shrink-0">
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Relatórios & Matriz</h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            Gestão de certificações por unidade e setor operacional
            {effectiveSoc && (
              <span className="ml-2 inline-flex items-center gap-1 bg-[#EE4D2D]/10 text-[#EE4D2D] text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-[#EE4D2D]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#EE4D2D] animate-pulse inline-block" />
                SOC: {effectiveSoc}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
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
            title={effectiveSoc ? `Exportar pendentes do SOC ${effectiveSoc}` : 'Exportar pendentes de todas as SOCs'}
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
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
            <BarChart2 className="text-[#EE4D2D]" size={18} />
            Desempenho por SOC
          </h2>
          {socRankPosition && (
            <span className="text-[10px] font-black text-[#EE4D2D] bg-[#FEF6F5] px-2.5 py-1 rounded-full border border-[#EE4D2D]/10">
              {effectiveSoc} está em {socRankPosition.position}º de {socRankPosition.total}
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-400 font-medium mb-4">
          Comparativo entre todas as unidades — não muda com os filtros acima.
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
              <Bar yAxisId="left" dataKey="Treinados" radius={[4, 4, 0, 0]} barSize={28}>
                 <LabelList dataKey="Treinados" position="top" fill="#1e3a8a" fontSize={10} fontWeight="900" formatter={(val: any) => `${val}%`} />
                 {chartData.map(d => (
                   <Cell key={d.soc} fill={d.soc === effectiveSoc ? '#EE4D2D' : '#cbd5e1'} />
                 ))}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="Nº HCs" stroke="#1e3a8a" strokeWidth={2} dot={{ r: 4, fill: '#1e3a8a' }} />
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
                          {training?.signature_pdf_url && (
                            <a href={training.signature_pdf_url} target="_blank" rel="noopener" className="text-[7px] font-black underline text-[#EE4D2D] uppercase mt-1">Assinatura</a>
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
             Nenhum processo micro cadastrado para {effectiveSoc || 'sua unidade'}. Peça ao administrador para configurar na tela de Configurações.
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

                    let isMandatory = false;
                    let isSuggested = false;

                    if (isSectorMatch) {
                      if (t.is_mandatory) {
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
                          {training?.signature_pdf_url && (
                            <a href={training.signature_pdf_url} target="_blank" rel="noopener" className="text-[7px] font-black underline text-[#EE4D2D] uppercase">Assinatura</a>
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
              <Bar dataKey="Pessoas Treinadas" fill="#EE4D2D" radius={[4, 4, 0, 0]} barSize={36}>
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
