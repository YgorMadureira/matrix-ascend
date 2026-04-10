import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from 'recharts';

const TRAINING_TYPES = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'ASM'] as const;

interface Collaborator {
  id: string;
  name: string;
  soc: string;
  sector: string;
  shift: string;
  role: string;
}

interface Training {
  id: string;
  collaborator_id: string;
  training_type: string;
  completed_at: string;
  signature_pdf_url: string | null;
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [selectedUnit, setSelectedUnit] = useState('');
  const [selectedSector, setSelectedSector] = useState('');

  useEffect(() => {
    const fetch = async () => {
      const [{ data: collabs }, { data: trains }] = await Promise.all([
        supabase.from('collaborators').select('*').order('name'),
        supabase.from('trainings_completed').select('*'),
      ]);
      const c = collabs ?? [];
      setCollaborators(c);
      setTrainings(trains ?? []);
      setUnits([...new Set(c.map(x => x.soc))]);
      setSectors([...new Set(c.map(x => x.sector))]);
    };
    fetch();
  }, []);

  const filtered = collaborators.filter(c =>
    (!selectedUnit || c.soc === selectedUnit) &&
    (!selectedSector || c.sector === selectedSector)
  );

  const hasTraining = (collabId: string, type: string) =>
    trainings.some(t => t.collaborator_id === collabId && t.training_type === type);

  const toggleTraining = async (collabId: string, type: string) => {
    const existing = trainings.find(t => t.collaborator_id === collabId && t.training_type === type);
    if (existing) {
      await supabase.from('trainings_completed').delete().eq('id', existing.id);
      setTrainings(prev => prev.filter(t => t.id !== existing.id));
      toast.success('Treinamento removido');
    } else {
      const { data } = await supabase.from('trainings_completed').insert({
        collaborator_id: collabId,
        training_type: type,
        registered_by: user?.id,
      }).select().single();
      if (data) setTrainings(prev => [...prev, data]);
      toast.success('Treinamento registrado');
    }
  };

  const uploadSignature = async (collabId: string, type: string, file: File) => {
    const path = `${collabId}/${type}/${file.name}`;
    const { error: uploadError } = await supabase.storage.from('signatures').upload(path, file, { upsert: true });
    if (uploadError) { toast.error('Erro no upload: ' + uploadError.message); return; }
    const { data: urlData } = supabase.storage.from('signatures').getPublicUrl(path);
    const existing = trainings.find(t => t.collaborator_id === collabId && t.training_type === type);
    if (existing) {
      await supabase.from('trainings_completed').update({ signature_pdf_url: urlData.publicUrl }).eq('id', existing.id);
      setTrainings(prev => prev.map(t => t.id === existing.id ? { ...t, signature_pdf_url: urlData.publicUrl } : t));
    } else {
      const { data } = await supabase.from('trainings_completed').insert({
        collaborator_id: collabId, training_type: type, registered_by: user?.id, signature_pdf_url: urlData.publicUrl,
      }).select().single();
      if (data) setTrainings(prev => [...prev, data]);
    }
    toast.success('Assinatura enviada');
  };

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Relatórios & Matriz</h1>
        <p className="text-sm text-muted-foreground mt-1">Acompanhe a conclusão de treinamentos por unidade e setor</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)}
          className="px-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary">
          <option value="">Todas as Unidades</option>
          {units.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={selectedSector} onChange={(e) => setSelectedSector(e.target.value)}
          className="px-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary">
          <option value="">Todos os Setores</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* KPI Cards with general % */}
      <div className="grid grid-cols-6 gap-3">
        <div className="glass-card-hover p-4 text-center border-2 border-primary/30">
          <p className="text-xs text-muted-foreground font-medium mb-2">GERAL</p>
          <p className="text-2xl font-display font-bold text-primary">{generalPct}%</p>
          <p className="text-xs text-muted-foreground mt-1">Média geral</p>
          <div className="mt-2 h-1.5 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${generalPct}%` }} />
          </div>
        </div>
        {sectorStats.map(({ type, completed, total, pct }) => (
          <div key={type} className="glass-card-hover p-4 text-center">
            <p className="text-xs text-muted-foreground font-medium mb-2">{type}</p>
            <p className="text-2xl font-display font-bold text-primary">{pct}%</p>
            <p className="text-xs text-muted-foreground mt-1">{completed}/{total}</p>
            <div className="mt-2 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="glass-card p-6">
          <h2 className="font-display text-lg font-semibold text-foreground mb-4">Treinamentos por SOC</h2>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="soc" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} unit="%" />
              <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }}
              />
              <Legend />
              <Bar yAxisId="left" dataKey="% Treinados" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="Colaboradores" stroke="#60a5fa" strokeWidth={2} dot={{ fill: '#60a5fa' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Matrix Table */}
      <div className="glass-card overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40">
              <th className="text-left p-4 text-muted-foreground font-medium sticky left-0 bg-card/90 backdrop-blur">Colaborador</th>
              <th className="text-left p-4 text-muted-foreground font-medium">SOC</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Setor</th>
              {TRAINING_TYPES.map(t => (
                <th key={t} className="text-center p-4 text-muted-foreground font-medium text-xs">{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-b border-border/20 hover:bg-secondary/30 transition-colors">
                <td className="p-4 text-foreground font-medium sticky left-0 bg-card/90 backdrop-blur">{c.name}</td>
                <td className="p-4 text-foreground">{c.soc}</td>
                <td className="p-4 text-foreground">{c.sector}</td>
                {TRAINING_TYPES.map(type => {
                  const done = hasTraining(c.id, type);
                  const training = trainings.find(t => t.collaborator_id === c.id && t.training_type === type);
                  return (
                    <td key={type} className="p-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <button onClick={() => toggleTraining(c.id, type)} className="transition-transform hover:scale-110">
                          {done ? <CheckCircle2 size={22} className="text-green-500" /> : <XCircle size={22} className="text-destructive/50" />}
                        </button>
                        <label className="cursor-pointer">
                          <Upload size={12} className="text-muted-foreground hover:text-primary transition-colors" />
                          <input type="file" accept=".pdf" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadSignature(c.id, type, file);
                            e.target.value = '';
                          }} />
                        </label>
                        {training?.signature_pdf_url && (
                          <a href={training.signature_pdf_url} target="_blank" rel="noopener" className="text-[10px] text-primary hover:underline">PDF</a>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-8 text-center text-muted-foreground">Nenhum colaborador encontrado com os filtros selecionados</div>}
      </div>
    </div>
  );
}
