import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BarChart2, Users, CheckCircle2, Percent } from 'lucide-react';

export default function DashboardPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState({ collaborators: 0, materials: 0, trainings: 0, trainedPct: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      const [c, m, t] = await Promise.all([
        supabase.from('collaborators').select('id', { count: 'exact', head: true }),
        supabase.from('materials').select('id', { count: 'exact', head: true }),
        supabase.from('trainings_completed').select('id', { count: 'exact', head: true }),
      ]);

      const totalCollabs = c.count ?? 0;
      // Get unique collaborators who have at least one training
      const { data: trainedData } = await supabase.from('trainings_completed').select('collaborator_id');
      const uniqueTrained = new Set(trainedData?.map(t => t.collaborator_id) ?? []).size;
      const pct = totalCollabs > 0 ? Math.round((uniqueTrained / totalCollabs) * 100) : 0;

      setStats({
        collaborators: totalCollabs,
        materials: m.count ?? 0,
        trainings: t.count ?? 0,
        trainedPct: pct,
      });
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
    <div className="space-y-8">
      <div className="bg-white/50 p-6 rounded-2xl border border-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
            Bem-vindo, <span className="text-[#EE4D2D]">{profile?.full_name}</span>
          </h1>
          <p className="text-gray-500 font-medium mt-1">Matrix Ascend • Painel de Gestão Operacional</p>
        </div>
        <div className="flex items-center gap-2 bg-[#FEF6F5] px-4 py-2 rounded-full border border-[#EE4D2D]/10">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-bold text-[#EE4D2D] uppercase tracking-wider">Sistema Online • v2.4</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-lg ${color.replace('text-', 'bg-').replace('600', '100').replace('500', '100').replace('[#EE4D2D]', '[#FEF6F5]')}`}>
                <Icon size={24} className={color} />
              </div>
              <span className="text-3xl font-black text-gray-900">{value}</span>
            </div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Desempenho por Macro-Setor</h2>
            <p className="text-sm text-gray-400 mt-0.5">Visão consolidada de certificações</p>
          </div>
          <button className="text-xs font-bold text-[#EE4D2D] uppercase hover:underline">Ver Detalhes</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'HSE', 'PEOPLE'].map((t) => (
            <div key={t} className="bg-gray-50 border border-transparent hover:border-[#EE4D2D]/20 hover:bg-white p-5 rounded-xl text-center transition-all group cursor-pointer shadow-sm hover:shadow-md">
              <p className="text-[10px] font-bold text-gray-400 mb-3 uppercase tracking-tighter line-clamp-1">{t}</p>
              <p className="text-2xl font-black text-gray-300 group-hover:text-[#EE4D2D] transition-colors">—</p>
              <div className="w-full h-1 bg-gray-200 mt-4 rounded-full overflow-hidden">
                 <div className="h-full bg-gray-300 group-hover:bg-[#EE4D2D] w-1/4 transition-all" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

