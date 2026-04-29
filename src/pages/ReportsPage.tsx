import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Upload, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, LabelList } from 'recharts';

const TRAINING_TYPES = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS'] as const;
const ONBOARDING_TYPES = ['Onboarding Meio Ambiente', 'Onboarding People', 'Onboarding HSE', 'Onboarding PTS', 'Onboarding Qualidade'] as const;

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
  signature_pdf_url: string | null;
  instructor_name?: string;
}

export default function ReportsPage() {
  const { user, profile, isLider, isAdmin, loading: authLoading } = useAuth();
  const location = useLocation();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [selectedUnit, setSelectedUnit] = useState('');
  const [selectedSector, setSelectedSector] = useState('');
  const [selectedTrainingType, setSelectedTrainingType] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'trained' | 'pending'>('all');

  const toggleSectorFilter = (type: string) => {
    setSelectedTrainingType(prev => prev === type ? '' : type);
  };

  const hasTraining = (collabId: string, type: string) => {
    return trainings.some(t => {
      if (t.collaborator_id !== collabId) return false;
      
      const collab = collaborators.find(x => x.id === collabId);
      const tType = t.training_type?.toUpperCase() ?? '';
      const reqType = type.toUpperCase();
      const cRole = collab?.role?.toUpperCase() ?? '';
      
      // Onboarding específico: exige que o treinamento contenha ONBOARDING + a área específica
      if (reqType.startsWith('ONBOARDING ')) {
        const area = reqType.replace('ONBOARDING ', '');
        return tType.includes('ONBOARDING') && tType.includes(area);
      }
      
      // Setores operacionais: treinamento de ONBOARDING valida apenas estes 3 setores
      const isOp = reqType === 'RECEBIMENTO' || reqType === 'PROCESSAMENTO' || reqType === 'EXPEDIÇÃO' || reqType === 'EXPEDICAO';
      if (tType.includes('ONBOARDING') && isOp) return true;
      
      // Match direto por nome do setor
      const matchSector = tType === reqType || tType.includes(reqType) || reqType.includes(tType);
      const matchRole = cRole && (tType.includes(cRole) || cRole.includes(tType));
      
      return matchSector || matchRole;
    });
  };

  const isGenerallyTrained = useCallback((collabId: string) => {
    const coreSectors = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'EXPEDICAO', 'TRATATIVAS'];
    return coreSectors.some(type => hasTraining(collabId, type));
  }, [trainings, collaborators]);

  const loadData = useCallback(async () => {
    let allCollabs: any[] = [];
    let hasMore = true;
    let page = 0;
    const limit = 1000;

    while (hasMore) {
      const { data, error } = await supabase
        .from('collaborators')
        .select('*')
        .order('name')
        .range(page * limit, (page + 1) * limit - 1);
      
      if (error) break;
      if (data) {
        allCollabs = [...allCollabs, ...data];
        if (data.length < limit) hasMore = false;
        else page++;
      } else {
        hasMore = false;
      }
    }

    let allTrainings: any[] = [];
    let tPage = 0;
    let tHasMore = true;
    while (tHasMore) {
      const { data, error } = await supabase
        .from('trainings_completed')
        .select('*')
        .range(tPage * limit, (tPage + 1) * limit - 1);
      
      if (error) break;
      if (data) {
        allTrainings = [...allTrainings, ...data];
        if (data.length < limit) tHasMore = false;
        else tPage++;
      } else {
        tHasMore = false;
      }
    }

    const [{ data: socData }] = await Promise.all([
      supabase.from('socs').select('name').order('name'),
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
    setUnits(socData ? socData.map(s => s.name) : []);
    setSectors([...new Set(allCollabs.map(x => (x.sector as string) || 'Sem Setor'))]);
  }, [isLider, isAdmin, profile?.full_name, profile?.leader_key]);

  useEffect(() => { if (!authLoading) loadData(); }, [location.pathname, loadData, authLoading]);

  useEffect(() => {
    const onFocus = () => { if (!authLoading) loadData(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadData, authLoading]);

  const filtered = collaborators.filter(c => {
    const matchUnit = !selectedUnit || c.soc === selectedUnit;
    const matchSector = !selectedSector || c.sector === selectedSector;
    
    if (!matchUnit || !matchSector) return false;

    if (statusFilter !== 'all') {
      const done = selectedTrainingType 
        ? hasTraining(c.id, selectedTrainingType)
        : isGenerallyTrained(c.id);
        
      if (statusFilter === 'trained' && !done) return false;
      if (statusFilter === 'pending' && done) return false;
    }

    return true;
  });

  const sectorStats = TRAINING_TYPES.map(type => {
    const sectorCollabs = filtered.filter(c => c.sector?.toUpperCase() === type);
    const total = sectorCollabs.length;
    const completed = sectorCollabs.filter(c => hasTraining(c.id, type)).length;
    return { type, total, completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
  });

  const coreSectors = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS'];
  const coreStats = sectorStats.filter(s => coreSectors.includes(s.type));
  const generalTotal = coreStats.reduce((sum, s) => sum + s.total, 0);
  const generalCompleted = coreStats.reduce((sum, s) => sum + s.completed, 0);
  const generalPct = generalTotal > 0 ? Math.round((generalCompleted / generalTotal) * 100) : 0;

  const socList = [...new Set(collaborators.map(c => c.soc))].sort();
  const chartData = socList.map(soc => {
    const socCollabs = collaborators.filter(c => c.soc === soc);
    const total = socCollabs.length;
    if (selectedTrainingType) {
      const trained = socCollabs.filter(c => hasTraining(c.id, selectedTrainingType)).length;
      const pct = total > 0 ? Number(((trained / total) * 100).toFixed(1)) : 0;
      return { soc, 'Treinados': pct, 'Nº HCs': total };
    }
    const trainedIds = new Set(
      trainings.filter(t => socCollabs.some(c => c.id === t.collaborator_id)).map(t => t.collaborator_id)
    );
    const pct = total > 0 ? Number(((trainedIds.size / total) * 100).toFixed(1)) : 0;
    return { soc, 'Treinados': pct, 'Nº HCs': total };
  });

  const instructorStats = useMemo(() => {
    const map = new Map<string, Set<string>>(); 
    trainings.forEach(t => {
      const inst = t.instructor_name?.trim() || 'Desconhecido';
      if (!map.has(inst)) map.set(inst, new Set());
      map.get(inst)!.add(t.collaborator_id);
    });
    
    return Array.from(map.entries())
      .map(([name, collabSet]) => ({ name, 'Pessoas Treinadas': collabSet.size }))
      .sort((a, b) => b['Pessoas Treinadas'] - a['Pessoas Treinadas'])
      .slice(0, 15);
  }, [trainings]);

  const displayTrainingTypes = selectedTrainingType 
    ? TRAINING_TYPES.filter(t => t === selectedTrainingType) 
    : TRAINING_TYPES;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Relatórios & Matriz</h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">Gestão de certificações por unidade e setor operacional</p>
        </div>

        <div className="flex gap-2 flex-wrap bg-white p-2 rounded-xl shadow-sm border border-gray-100">
          <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-50 border-transparent text-gray-700 text-[12px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/20 transition-all">
            <option value="">Todas as Unidades</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
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

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
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
        <div className="p-5 border-b border-gray-50 flex items-center justify-between bg-[#FEF6F5]/30">
           <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
             <CheckCircle2 className="text-[#EE4D2D]" size={18} />
             Matriz de Onboarding
           </h2>
           <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{filtered.length} Colaboradores</span>
        </div>
        <div className="overflow-x-auto overflow-y-auto max-h-[50vh] custom-scrollbar">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50/80 backdrop-blur-sm border-b border-gray-100">
                <th className="text-left p-3 text-[9px] text-gray-400 font-black uppercase sticky left-0 bg-gray-50 z-20">Colaborador</th>
                {ONBOARDING_TYPES.map(t => (
                  <th key={t} className="text-center p-3 text-[9px] text-gray-400 font-black uppercase whitespace-nowrap">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="p-3 font-bold text-gray-800 sticky left-0 bg-white group-hover:bg-gray-50/50 z-10 whitespace-nowrap">
                    <div className="flex flex-col">
                      <span>{c.name}</span>
                      <span className="text-[9px] text-gray-400 font-bold uppercase">{c.role} • {c.soc}</span>
                    </div>
                  </td>
                  {ONBOARDING_TYPES.map(type => {
                    const done = hasTraining(c.id, type);
                    return (
                      <td key={type} className="p-3 text-center">
                        {done ? (
                          <div className="w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 mx-auto"><CheckCircle2 size={12} /></div>
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-gray-50 flex items-center justify-center text-gray-200 mx-auto"><XCircle size={12} /></div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-50 flex items-center justify-between">
           <h2 className="text-base font-black text-gray-900">Matriz de Certificação Operacional</h2>
           <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{filtered.length} Colaboradores</span>
        </div>
        <div className="overflow-x-auto overflow-y-auto max-h-[50vh] custom-scrollbar">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50/80 backdrop-blur-sm border-b border-gray-100">
                <th className="text-left p-3 text-[9px] text-gray-400 font-black uppercase sticky left-0 bg-gray-50 z-20">Colaborador</th>
                <th className="text-left p-3 text-[9px] text-gray-400 font-black uppercase whitespace-nowrap">Unidade/SOC</th>
                {displayTrainingTypes.map(t => (
                  <th key={t} className="text-center p-3 text-[9px] text-gray-400 font-black uppercase whitespace-nowrap">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="p-3 font-bold text-gray-800 sticky left-0 bg-white group-hover:bg-gray-50/50 z-10 whitespace-nowrap">
                    <div className="flex flex-col">
                      <span>{c.name}</span>
                      <span className="text-[9px] text-gray-400 font-bold uppercase">{c.role} • {c.sector}</span>
                    </div>
                  </td>
                  <td className="p-3 text-gray-500 font-bold whitespace-nowrap">{c.soc}</td>
                  {displayTrainingTypes.map(type => {
                    const done = hasTraining(c.id, type);
                    const training = trainings.find(t => t.collaborator_id === c.id && t.training_type === type);
                    return (
                      <td key={type} className="p-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          {done ? (
                            <div className="w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600"><CheckCircle2 size={12} /></div>
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-gray-50 flex items-center justify-center text-gray-200"><XCircle size={12} /></div>
                          )}
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
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <h2 className="text-base font-black text-gray-900 mb-4 flex items-center gap-2">
          <BarChart2 className="text-[#EE4D2D]" size={18} />
          Volume de Pessoas por Instrutor
        </h2>
        {instructorStats.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={instructorStats}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" fontSize={10} />
              <YAxis fontSize={10} />
              <Tooltip />
              <Bar dataKey="Pessoas Treinadas" fill="#EE4D2D" radius={[4, 4, 0, 0]} barSize={36} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
           <div className="h-[280px] flex items-center justify-center text-gray-300 italic text-xs">Sem dados disponíveis</div>
        )}
      </div>
    </div>
  );
}
