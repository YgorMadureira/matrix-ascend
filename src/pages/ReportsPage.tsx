import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Upload, BarChart2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, LabelList } from 'recharts';

const TRAINING_TYPES = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS'] as const;
const CORE_SECTORS = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'EXPEDICAO', 'TRATATIVAS'];
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
  const { user, profile, isLider, isAdmin, loading: authLoading } = useAuth();
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

  const AREAS = ['Operacional', 'COP', 'HSE', 'Qualidade', 'Security', 'Inventario', 'People', 'Meio Ambiente'] as const;
  const [selectedArea, setSelectedArea] = useState<string>('Operacional');
  const [visibleCount, setVisibleCount] = useState(100);

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

  const hasTraining = useCallback((collabId: string, type: string) => {
    const collabTrainings = trainingsByCollabId.get(collabId);
    if (!collabTrainings || collabTrainings.length === 0) return false;

    const collab = collaboratorMap.get(collabId);
    const reqType = type.toUpperCase();
    const cRole = collab?.role?.toUpperCase() ?? '';
    const cSector = collab?.sector?.toUpperCase() ?? '';

    return collabTrainings.some((t) => {
      const tType = t.training_type?.toUpperCase() ?? '';

      // Onboarding específico: exige que o treinamento contenha ONBOARDING + a área específica
      if (reqType.startsWith('ONBOARDING ')) {
        const area = reqType.replace('ONBOARDING ', '');
        return tType.includes('ONBOARDING') && tType.includes(area);
      }

      // Setores operacionais: treinamento de ONBOARDING valida apenas estes 3 setores
      const isOp = reqType === 'RECEBIMENTO' || reqType === 'PROCESSAMENTO' || reqType === 'EXPEDIÇÃO' || reqType === 'EXPEDICAO';
      if (tType.includes('ONBOARDING') && isOp) return true;

      // Se o usuário fez Onboarding PTS V3 ou Treinamento Padrão SOC da área, valida os treinamentos específicos
      const isPTS = tType.includes('ONBOARDING PTS');
      const isPadraoRecebimento = (tType.includes('TREINAMENTO PADRÃO SOC') || tType.includes('TREINAMENTO PADRAO SOC')) && tType.includes('RECEBIMENTO');
      const isPadraoProcessamento = (tType.includes('TREINAMENTO PADRÃO SOC') || tType.includes('TREINAMENTO PADRAO SOC')) && tType.includes('PROCESSAMENTO');
      const isPadraoExpedicao = (tType.includes('TREINAMENTO PADRÃO SOC') || tType.includes('TREINAMENTO PADRAO SOC')) && (tType.includes('EXPEDIÇÃO') || tType.includes('EXPEDICAO'));

      if (isPTS || isPadraoRecebimento) {
        if (cSector === 'RECEBIMENTO' && (reqType === 'RECEBIMENTO FM' || reqType === 'RECEBIMENTO LH')) return true;
      }
      if (isPTS || isPadraoProcessamento) {
        if (cSector === 'PROCESSAMENTO' && (reqType === 'ESTEIRA AUTOMÁTICA' || reqType === 'ESTEIRA JAVA' || reqType === 'ESTEIRA TERMOPLÁSTICA')) return true;
      }
      if (isPTS || isPadraoExpedicao) {
        if ((cSector === 'EXPEDIÇÃO' || cSector === 'EXPEDICAO') && (reqType === 'CARREGAMENTO LH' || reqType === 'CARRREGAMENTO 3PL' || reqType === 'CARREGAMENTO 3PL')) return true;
      }

      // Match direto por nome do setor
      const matchSector = tType === reqType || tType.includes(reqType) || reqType.includes(tType);
      const matchRole = cRole && (tType.includes(cRole) || cRole.includes(tType));

      return matchSector || matchRole;
    });
  }, [trainingsByCollabId, collaboratorMap]);

  const isGenerallyTrained = useCallback((collabId: string) => {
    return CORE_SECTORS.some(type => hasTraining(collabId, type));
  }, [hasTraining]);

  const loadData = useCallback(async () => {
    lastLoadRef.current = Date.now();

    const allCollabs: any[] = [];
    let hasMore = true;
    let page = 0;
    const limit = 1000;

    while (hasMore) {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, name, soc, sector, shift, role, leader')
        .eq('soc', profile?.soc || '')
        .order('name')
        .range(page * limit, (page + 1) * limit - 1);
      
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

    const [{ data: microData }] = await Promise.all([
      supabase.from('soc_micro_trainings').select('*').eq('soc_name', profile?.soc || '').order('order_num'),
    ]);

    const matchLeader = (collaboratorLeader: string): boolean => {
      const cLeader = (collaboratorLeader ?? '').trim().toUpperCase();
      if (!cLeader) return false;
      if (profile?.leader_key) {
        return cLeader === profile.leader_key.trim().toUpperCase();
      }
      const profileName = (profile?.full_name ?? '').trim().toUpperCase();
      if (cLeader === profileName) return true;
      const nameWords = profileName.split(/\s+/).filter(w => w.length > 2);
      if (nameWords.length > 0 && nameWords.every(w => cLeader.includes(w))) return true;
      const leaderWords = cLeader.split(/\s+/).filter(w => w.length > 2);
      if (leaderWords.length > 0 && leaderWords.every(w => profileName.includes(w))) return true;
      return false;
    };

    const collabData = (isLider && !isAdmin) ? allCollabs.filter(x => matchLeader(x.leader)) : allCollabs;
    setCollaborators(collabData);
    setTrainings(allTrainings);
    setMicroTrainings(microData || []);
    setSectors([...new Set(allCollabs.map(x => (x.sector as string) || 'Sem Setor'))]);
  }, [isLider, isAdmin, profile?.full_name, profile?.leader_key, profile?.soc]);

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
    if (selectedArea === 'Operacional') {
      const isOp = s === 'RECEBIMENTO' || s === 'PROCESSAMENTO' || s === 'EXPEDIÇÃO' || s === 'EXPEDICAO' || s === 'TRATATIVAS';
      if (!isOp) return false;
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

  useEffect(() => {
    setVisibleCount(100);
  }, [microFiltered]);

  const currentTrainingTypes = useMemo(() => {
    if (selectedArea === 'Operacional') return TRAINING_TYPES as unknown as string[];
    if (selectedArea === 'Inventario') return ['INVENTÁRIO'];
    return [selectedArea.toUpperCase()];
  }, [selectedArea]);

  const sectorStats = useMemo(() => currentTrainingTypes.map(type => {
    const sectorCollabs = filtered.filter(c => {
      const s = c.sector?.toUpperCase() || '';
      if (type === 'INVENTÁRIO') return s === 'INVENTARIO' || s === 'INVENTÁRIO';
      if (selectedArea !== 'Operacional') return true;
      return s === type || (type === 'EXPEDIÇÃO' && s === 'EXPEDICAO');
    });
    const total = sectorCollabs.length;
    const completed = sectorCollabs.filter(c => hasTraining(c.id, type)).length;
    const pct = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0;
    return { type, total, completed, pct };
  }), [currentTrainingTypes, filtered, hasTraining, selectedArea]);

  const { generalTotal, generalCompleted, generalPct } = useMemo(() => {
    const total = sectorStats.reduce((sum, s) => sum + s.total, 0);
    const completed = sectorStats.reduce((sum, s) => sum + s.completed, 0);
    const pct = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0;
    return { generalTotal: total, generalCompleted: completed, generalPct: pct };
  }, [sectorStats]);

  const chartData = useMemo(() => {
    const socList = [...new Set(filtered.map(c => c.soc))].sort();
    return socList.map(soc => {
      const socCollabs = filtered.filter(c => c.soc === soc);

      let total = 0;
      let trainedCount = 0;

      if (selectedTrainingType) {
        total = socCollabs.length;
        trainedCount = socCollabs.filter(c => hasTraining(c.id, selectedTrainingType)).length;
      } else {
        currentTrainingTypes.forEach(type => {
          const typeCollabs = socCollabs.filter(c => {
            const s = c.sector?.toUpperCase() || '';
            if (type === 'INVENTÁRIO') return s === 'INVENTARIO' || s === 'INVENTÁRIO';
            if (selectedArea !== 'Operacional') return true;
            return s === type || (type === 'EXPEDIÇÃO' && s === 'EXPEDICAO');
          });
          total += typeCollabs.length;
          trainedCount += typeCollabs.filter(c => hasTraining(c.id, type)).length;
        });
      }

      const pct = total > 0 ? Number(((trainedCount / total) * 100).toFixed(1)) : 0;
      return { soc, 'Treinados': pct, 'Nº HCs': total };
    });
  }, [filtered, selectedTrainingType, hasTraining, currentTrainingTypes, selectedArea]);

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

  const displayTrainingTypes = useMemo(() => selectedTrainingType 
    ? currentTrainingTypes.filter(t => t === selectedTrainingType) 
    : currentTrainingTypes, [selectedTrainingType, currentTrainingTypes]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Relatórios & Matriz</h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">Gestão de certificações por unidade e setor operacional</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-1">
          <select className="px-3 py-1.5 text-[11px] font-bold text-gray-700 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm" value={selectedSector} onChange={e => setSelectedSector(e.target.value)}>
            <option value="">Todos os Setores</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1 shadow-sm">
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
            className={`px-3 py-2 rounded-lg text-[12px] font-black outline-none transition-all border-2 ${
              statusFilter === 'trained' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 
              statusFilter === 'pending' ? 'bg-red-50 border-red-200 text-red-500' : 
              'bg-gray-50 border-transparent text-gray-700'
            }`}
          >
            <option value="all">Todos Status</option>
            <option value="trained">Certificados</option>
            <option value="pending">Pendentes</option>
          </select>
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
        <h2 className="text-base font-black text-gray-900 mb-4 flex items-center gap-2">
          <BarChart2 className="text-[#EE4D2D]" size={18} />
          Desempenho por SOC {selectedTrainingType && <span className="text-[10px] font-normal text-gray-400 ml-1">• {selectedTrainingType}</span>}
        </h2>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 20, right: 10, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="soc" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" stroke="#9ca3af" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <YAxis yAxisId="right" orientation="right" stroke="#1e3a8a" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: '#FEF6F5' }} contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', fontSize: '12px' }} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
              <Bar yAxisId="left" dataKey="Treinados" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={28}>
                 <LabelList dataKey="Treinados" position="top" fill="#1e3a8a" fontSize={10} fontWeight="900" formatter={(val: any) => `${val}%`} />
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
             Nenhum processo micro cadastrado para {profile?.soc || 'sua unidade'}. Peça ao administrador para configurar na tela de Configurações.
          </div>
        ) : (() => {
          const macroAreasOrder: string[] = [];
          const macroAreasCount: Record<string, number> = {};
          microTrainings.forEach(t => {
            if (!macroAreasCount[t.macro_area]) {
              macroAreasCount[t.macro_area] = 0;
              macroAreasOrder.push(t.macro_area);
            }
            macroAreasCount[t.macro_area]++;
          });

          const getMacroConfig = (macro: string) => {
            if (macro === 'RECEBIMENTO') return { bg: 'bg-[#ECF2FD]', text: 'text-[#1A50BE]', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> };
            if (macro === 'PROCESSAMENTO') return { bg: 'bg-[#F1FBF1]', text: 'text-[#1B8A23]', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M2 12h20"/></svg> };
            if (macro === 'EXPEDIÇÃO' || macro === 'EXPEDICAO') return { bg: 'bg-[#FEF6E4]', text: 'text-[#C2832B]', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><path d="m9 12 2 2 4-4"/></svg> };
            return { bg: 'bg-[#F8F3FD]', text: 'text-[#8C70BA]', icon: <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg> };
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
                {microTrainings.map((t, i) => (
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
                  {microTrainings.map((t) => {
                    const done = hasTraining(c.id, t.name);
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
