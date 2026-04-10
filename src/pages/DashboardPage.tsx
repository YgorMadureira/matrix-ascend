import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BarChart3, Users, FolderOpen, CheckCircle2 } from 'lucide-react';

export default function DashboardPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState({ collaborators: 0, folders: 0, materials: 0, trainings: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      const [c, f, m, t] = await Promise.all([
        supabase.from('collaborators').select('id', { count: 'exact', head: true }),
        supabase.from('folders').select('id', { count: 'exact', head: true }),
        supabase.from('materials').select('id', { count: 'exact', head: true }),
        supabase.from('trainings_completed').select('id', { count: 'exact', head: true }),
      ]);
      setStats({
        collaborators: c.count ?? 0,
        folders: f.count ?? 0,
        materials: m.count ?? 0,
        trainings: t.count ?? 0,
      });
    };
    fetchStats();
  }, []);

  const cards = [
    { label: 'Colaboradores', value: stats.collaborators, icon: Users, color: 'text-primary' },
    { label: 'Pastas', value: stats.folders, icon: FolderOpen, color: 'text-blue-400' },
    { label: 'Materiais', value: stats.materials, icon: BarChart3, color: 'text-green-400' },
    { label: 'Treinamentos', value: stats.trainings, icon: CheckCircle2, color: 'text-yellow-400' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">
          Bem-vindo, <span className="text-primary">{profile?.full_name}</span>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Painel de controle do sistema de treinamentos</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="glass-card-hover p-5">
            <div className="flex items-center justify-between mb-3">
              <Icon size={24} className={color} />
              <span className="text-3xl font-display font-bold text-foreground">{value}</span>
            </div>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <div className="glass-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground mb-4">KPIs de Treinamento</h2>
        <div className="grid grid-cols-5 gap-3">
          {['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'ASM'].map((t) => (
            <div key={t} className="glass-card p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1 font-medium">{t}</p>
              <p className="text-xl font-display font-bold text-primary">—</p>
              <p className="text-[10px] text-muted-foreground mt-1">Ver relatórios</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
