import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from 'recharts';

const TRAINING_TYPES = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'HSE', 'PEOPLE'] as const;

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
}

export default function ReportsPage() {
  const { user, profile, isLider, loading: authLoading } = useAuth();
  const location = useLocation();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [selectedUnit, setSelectedUnit] = useState('');
  const [selectedSector, setSelectedSector] = useState('');

  const loadData = useCallback(async () => {
    // Supabase has 1000 rows limit, we need pagination
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

    const [{ data: trains }, { data: socData }] = await Promise.all([
      supabase.from('trainings_completed').select('*'),
      supabase.from('socs').select('name').order('name'),
    ]);

    const c = allCollabs;
    const collabData = isLider ? c.filter(x => x.leader === profile?.full_name) : c;
    setCollaborators(collabData);
    setTrainings(trains ?? []);
    setUnits(socData ? socData.map(s => s.name) : []);
    setSectors([...new Set(c.map(x => x.sector))]);
  }, [isLider, profile?.full_name]);

  // Reload when navigating to this page
  useEffect(() => { if (!authLoading) loadData(); }, [location.pathname, loadData, authLoading]);

  // Reload when user returns to tab
  useEffect(() => {
    const onFocus = () => { if (!authLoading) loadData(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadData, authLoading]);

  const filtered = collaborators.filter(c =>
    (!selectedUnit || c.soc === selectedUnit) &&
    (!selectedSector || c.sector === selectedSector)
  );

  const hasTraining = (collabId: string, type: string) =>
    trainings.some(t => 
      t.collaborator_id === collabId && 
      (t.training_type === type || 
       t.training_type?.toUpperCase().includes(type.toUpperCase()) ||
       type.toUpperCase().includes(t.training_type?.toUpperCase()))
    );

  const toggleTraining = async (collabId: string, type: string) => {
    // Manually checking/unchecking is disabled as requested.
    // Trainings must be completed via QR Code signature.
    toast.info('Treinamentos devem ser concluídos via QR Code do material.');
  };

  // uploadSignature command removed, will be handled by QR CODE flow

  // Stats per training type
  const sectorStats = TRAINING_TYPES.map(type => {
    const total = filtered.length;
    const completed = filtered.filter(c => hasTraining(c.id, type)).length;
    return { type, total, completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
  });

  // General % (average of all training types)
  const generalPct = sectorStats.length > 0
    ? Math.round(sectorStats.reduce((sum, s) => sum + s.pct, 0) / sectorStats.length)
    : 0;

  // Chart data by SOC
  const socList = [...new Set(collaborators.map(c => c.soc))];
  const chartData = socList.map(soc => {
    const socCollabs = collaborators.filter(c => c.soc === soc);
    const total = socCollabs.length;
    const trainedIds = new Set(
      trainings.filter(t => socCollabs.some(c => c.id === t.collaborator_id)).map(t => t.collaborator_id)
    );
    const pct = total > 0 ? Math.round((trainedIds.size / total) * 100) : 0;
    return { soc, '% Treinados': pct, Colaboradores: total };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Relatórios & Matriz</h1>
          <p className="text-sm text-gray-500 font-medium mt-1">Gestão de certificações por unidade e setor operacional</p>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap bg-white p-2 rounded-xl shadow-sm border border-gray-100">
          <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)}
            className="px-4 py-2 rounded-lg bg-gray-50 border-transparent text-gray-700 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/20 transition-all">
            <option value="">Todas as Unidades</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={selectedSector} onChange={(e) => setSelectedSector(e.target.value)}
            className="px-4 py-2 rounded-lg bg-gray-50 border-transparent text-gray-700 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/20 transition-all">
            <option value="">Todos os Setores</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        <div className="bg-white p-5 rounded-2xl text-center border-2 border-[#EE4D2D] shadow-md transform hover:scale-[1.02] transition-all">
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-2">GERAL</p>
          <p className="text-3xl font-black text-[#EE4D2D]">{generalPct}%</p>
          <div className="mt-4 h-1.5 bg-gray-100 rounded-full overflow-hidden shadow-inner">
            <div className="h-full shopee-gradient-bg rounded-full transition-all duration-1000" style={{ width: `${generalPct}%` }} />
          </div>
        </div>
        {sectorStats.map(({ type, completed, total, pct }) => (
          <div key={type} className="bg-white p-5 rounded-2xl text-center border border-gray-100 shadow-sm hover:shadow-md transition-all">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight mb-2 line-clamp-1" title={type}>{type}</p>
            <p className="text-2xl font-black text-gray-800">{pct}%</p>
            <p className="text-[10px] text-gray-400 mt-1 font-bold">{completed}/{total} treinandos</p>
            <div className="mt-3 h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#EE4D2D] rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart Card */}
        <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
            <BarChart3 className="text-[#EE4D2D]" size={20} />
            Desempenho por SOC
          </h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis dataKey="soc" type="category" stroke="#9ca3af" fontSize={10} width={60} />
                <Tooltip
                  cursor={{ fill: '#FEF6F5' }}
                  contentStyle={{ backgroundColor: '#fff', border: 'none', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', color: '#111827' }}
                />
                <Bar dataKey="% Treinados" fill="#EE4D2D" radius={[0, 4, 4, 0]} barSize={20} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
             <div className="h-[300px] flex items-center justify-center text-gray-400 italic text-sm">Sem dados disponíveis</div>
          )}
        </div>

        {/* Table Card */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-50 flex items-center justify-between">
             <h2 className="text-lg font-bold text-gray-900">Matriz de Certificação</h2>
             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{filtered.length} Colaboradores</span>
          </div>
          <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50">
                <tr className="border-b border-gray-100">
                  <th className="text-left p-4 text-[10px] text-gray-400 font-black uppercase tracking-widest sticky left-0 bg-white shadow-[2px_0_5px_rgba(0,0,0,0.02)] z-10">Colaborador</th>
                  <th className="text-left p-4 text-[10px] text-gray-400 font-black uppercase tracking-widest">Unidade/SOC</th>
                  {TRAINING_TYPES.map(t => (
                    <th key={t} className="text-center p-4 text-[10px] text-gray-400 font-black uppercase tracking-widest">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="p-4 font-bold text-gray-800 sticky left-0 bg-white group-hover:bg-gray-50/50 shadow-[2px_0_5px_rgba(0,0,0,0.02)] z-10">
                      <div className="flex flex-col">
                        <span>{c.name}</span>
                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter">{c.role} • {c.sector}</span>
                      </div>
                    </td>
                    <td className="p-4 text-gray-500 font-medium">{c.soc}</td>
                    {TRAINING_TYPES.map(type => {
                      const done = hasTraining(c.id, type);
                      const training = trainings.find(t => t.collaborator_id === c.id && t.training_type === type);
                      return (
                        <td key={type} className="p-4 text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            {done ? (
                              <div className="w-6 h-6 rounded-full bg-[#E8F5E9] flex items-center justify-center text-[#2E7D32] shadow-sm">
                                <CheckCircle2 size={14} />
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center text-gray-200">
                                <XCircle size={14} />
                              </div>
                            )}
                            {training?.signature_pdf_url && (
                              <a href={training.signature_pdf_url} target="_blank" rel="noopener" className="text-[8px] font-black underline text-[#EE4D2D] tracking-widest uppercase">Assinatura</a>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="p-20 text-center flex flex-col items-center gap-4">
                <XCircle size={48} className="text-gray-100" />
                <p className="text-gray-400 font-medium">Nenhum colaborador encontrado com os filtros selecionados</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
