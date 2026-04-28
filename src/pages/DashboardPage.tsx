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
  const { profile, isLider } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ collaborators: 0, materials: 0, trainings: 0, trainedPct: 0, trainedCount: 0 });
  const [sectorStats, setSectorStats] = useState<SectorStat[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      // Fetch all collaborators (with pagination) and other counts in parallel
      let allCollabs: { id: string; sector: string; leader: string }[] = [];
      let page = 0;
      const limit = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data } = await supabase
          .from('collaborators')
          .select('id, sector, leader, role')
          .range(page * limit, (page + 1) * limit - 1);
        if (data && data.length > 0) {
          allCollabs = [...allCollabs, ...data];
          if (data.length < limit) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
      }

      const [mCount, tCount] = await Promise.all([
        supabase.from('materials').select('id', { count: 'exact', head: true }),
        supabase.from('trainings_completed').select('id', { count: 'exact', head: true }),
      ]);

      let allTrainings: any[] = [];
      let tPage = 0;
      let tHasMore = true;
      while (tHasMore) {
        const { data, error } = await supabase
          .from('trainings_completed')
          .select('collaborator_id, training_type')
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

      // Função robusta de correspondência de líder
      // Prioridade: leader_key → full_name exato → matching por palavras
      const matchLeader = (collaboratorLeader: string): boolean => {
        const cLeader = (collaboratorLeader ?? '').trim().toUpperCase();
        if (!cLeader) return false;
        // 1. Usa leader_key se definido pelo admin (mais confiável)
        if (profile?.leader_key) {
          return cLeader === profile.leader_key.trim().toUpperCase();
        }
        // 2. Correspondência exata com full_name
        const profileName = (profile?.full_name ?? '').trim().toUpperCase();
        if (cLeader === profileName) return true;
        // 3. Todas as palavras do perfil estão no campo leader
        const nameWords = profileName.split(/\s+/).filter(w => w.length > 2);
        if (nameWords.length > 0 && nameWords.every(w => cLeader.includes(w))) return true;
        // 4. Todas as palavras do campo leader estão no full_name
        const leaderWords = cLeader.split(/\s+/).filter(w => w.length > 2);
        if (leaderWords.length > 0 && leaderWords.every(w => profileName.includes(w))) return true;
        return false;
      };

      const collabs = isLider
        ? allCollabs.filter(c => matchLeader(c.leader))
        : allCollabs;

      const trainings = allTrainings;
      const totalCollabs = collabs.length;

      // Unique trained collaborators (for the global %)
      const trainedCollabIds = new Set(
        trainings
          .filter(t => collabs.some(c => c.id === t.collaborator_id))
          .map(t => t.collaborator_id)
      );
      const pct = totalCollabs > 0 ? Math.round((trainedCollabIds.size / totalCollabs) * 100) : 0;

      setStats({
        collaborators: totalCollabs,
        materials: mCount.count ?? 0,
        trainings: isLider ? trainedCollabIds.size : (tCount.count ?? 0),
        trainedPct: pct,
        trainedCount: trainedCollabIds.size,
      });

      // Calculate per-sector stats (scoped to leader's team if applicable)
      const sStats: SectorStat[] = SECTORS.map(sector => {
        const sectorCollabs = collabs.filter(c => c.sector?.toUpperCase() === sector);
        const sectorTotal = sectorCollabs.length;
        const trainedInSector = sectorCollabs.filter(c =>
          trainings.some(t => {
            if (t.collaborator_id !== c.id) return false;
            const tType = t.training_type?.toUpperCase() ?? '';
            const cRole = c.role?.toUpperCase() ?? '';
            const isCoreSector = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'EXPEDICAO'].includes(sector) || sector.includes('LOGISTICA') || cRole.includes('LOGISTICA');
            
            if (isCoreSector && tType.includes('ONBOARDING')) return true;
            
            return tType.includes(sector) || sector.includes(tType) || (cRole && (tType.includes(cRole) || cRole.includes(tType)));
          })
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
  }, [isLider, profile?.full_name]);

  const cards = [
    { label: 'Meu Time', value: stats.collaborators, icon: Users, color: 'text-[#EE4D2D]' },
    { label: '% Treinados', value: `${stats.trainedPct}%`, icon: Percent, color: 'text-emerald-600' },
    { label: 'Materiais', value: stats.materials, icon: BarChart2, color: 'text-[#EE4D2D]' },
    { label: 'Treinados', value: stats.trainedCount, icon: CheckCircle2, color: 'text-amber-500' },
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
