import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { BarChart2, Users, CheckCircle2, Percent } from 'lucide-react';

const SECTORS = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'HSE', 'PEOPLE'] as const;

interface SectorStat {
  sector: string;
  total: number;
  trained: number;
  pct: number;
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ collaborators: 0, materials: 0, trainings: 0, trainedPct: 0 });
  const [sectorStats, setSectorStats] = useState<SectorStat[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      // Fetch all data in parallel
      const [cCount, mCount, tCount, collabsRes, trainingsRes] = await Promise.all([
        supabase.from('collaborators').select('id', { count: 'exact', head: true }),
        supabase.from('materials').select('id', { count: 'exact', head: true }),
        supabase.from('trainings_completed').select('id', { count: 'exact', head: true }),
        supabase.from('collaborators').select('id, sector'),
        supabase.from('trainings_completed').select('collaborator_id, training_type'),
      ]);

      const totalCollabs = cCount.count ?? 0;
      const collabs = collabsRes.data ?? [];
      const trainings = trainingsRes.data ?? [];

      // Unique trained collaborators (for the global %)
      const uniqueTrained = new Set(trainings.map(t => t.collaborator_id)).size;
      const pct = totalCollabs > 0 ? Math.round((uniqueTrained / totalCollabs) * 100) : 0;

      setStats({
        collaborators: totalCollabs,
        materials: mCount.count ?? 0,
        trainings: tCount.count ?? 0,
        trainedPct: pct,
      });

      // Calculate per-sector stats
      const sStats: SectorStat[] = SECTORS.map(sector => {
        // Collaborators in this sector
        const sectorCollabs = collabs.filter(c => 
          c.sector?.toUpperCase() === sector
        );
        const sectorTotal = sectorCollabs.length;

        // Collaborators in this sector who have completed a training matching the sector
        const trainedInSector = sectorCollabs.filter(c =>
          trainings.some(t => 
            t.collaborator_id === c.id && (
              t.training_type?.toUpperCase().includes(sector) ||
              sector.includes(t.training_type?.toUpperCase() ?? '') ||
              t.training_type?.toUpperCase() === sector ||
              t.training_type?.toUpperCase().includes('ONBOARDING OPERACIONAL') ||
              t.training_type?.toUpperCase() === 'ONBOARDING OPERACIONAL'
            )
          )
        ).length;

        return {
          sector,
          total: sectorTotal,
          trained: trainedInSector,
          pct: sectorTotal > 0 ? Math.round((trainedInSector / sectorTotal) * 100) : 0,
        };
      });

      setSectorStats(sStats);
    };
    fetchStats();
  }, []);

  const cards = [
    { label: 'Colaboradores', value: stats.collaborators, icon: Users, color: 'text-[#EE4D2D]' },
    { label: '% Treinados', value: `${stats.trainedPct}%`, icon: Percent, color: 'text-emerald-600' },
    { label: 'Materiais', value: stats.materials, icon: BarChart2, color: 'text-[#EE4D2D]' },
    { label: 'Treinamentos', value: stats.trainings, icon: CheckCircle2, color: 'text-amber-500' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white/50 p-5 rounded-xl border border-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">
            Bem-vindo, <span className="text-[#EE4D2D]">{profile?.full_name}</span>
          </h1>
          <p className="text-xs text-gray-400 font-medium mt-0.5">Shopee • Painel de Gestão Operacional</p>
        </div>
        <div className="flex items-center gap-2 bg-[#FEF6F5] px-3 py-1.5 rounded-full border border-[#EE4D2D]/10">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[9px] font-bold text-[#EE4D2D] uppercase tracking-wider">Sistema Online • v2.4</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2.5 rounded-lg ${color.replace('text-', 'bg-').replace('600', '100').replace('500', '100').replace('[#EE4D2D]', '[#FEF6F5]')}`}>
                <Icon size={20} className={color} />
              </div>
              <span className="text-2xl font-black text-gray-900">{value}</span>
            </div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-black text-gray-900">Desempenho por Macro-Setor</h2>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">Visão consolidada de certificações por área</p>
          </div>
          <button 
            onClick={() => navigate('/reports')}
            className="text-[10px] font-black text-[#EE4D2D] uppercase tracking-widest hover:underline transition-all"
          >
            Ver Detalhes →
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {sectorStats.map((s) => (
            <div 
              key={s.sector} 
              onClick={() => navigate('/reports')}
              className="bg-gray-50 border border-transparent hover:border-[#EE4D2D]/20 hover:bg-white p-4 rounded-xl text-center transition-all group cursor-pointer shadow-sm hover:shadow-md"
            >
              <p className="text-[9px] font-black text-gray-400 mb-2 uppercase tracking-tighter line-clamp-1">{s.sector}</p>
              <p className={`text-xl font-black transition-colors ${s.pct > 0 ? 'text-gray-900 group-hover:text-[#EE4D2D]' : 'text-gray-300 group-hover:text-[#EE4D2D]'}`}>
                {s.pct}%
              </p>
              <p className="text-[8px] text-gray-400 font-bold mt-1">{s.trained}/{s.total} treinados</p>
              <div className="w-full h-1 bg-gray-200 mt-3 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#EE4D2D] group-hover:bg-[#EE4D2D] rounded-full transition-all duration-500" 
                  style={{ width: `${s.pct}%` }} 
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
