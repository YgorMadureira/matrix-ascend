import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Upload, Download, Trash2, Search, Edit2, Users, UserCheck, Crown } from 'lucide-react';
import { toast } from 'sonner';
import { useLocation } from 'react-router-dom';

interface Collaborator {
  id: string;
  name: string;
  opsid: string;
  gender: string;
  soc: string;
  sector: string;
  shift: string;
  leader: string;
  role: string;
}

const emptyForm = { name: '', opsid: '', gender: '', soc: '', sector: '', shift: '', leader: '', role: '' };

export default function CollaboratorsPage() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [trainings, setTrainings] = useState<{ collaborator_id: string, training_type: string }[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const fetchData = useCallback(async () => {
    const [{ data: collabs }, { data: trains }] = await Promise.all([
      supabase.from('collaborators').select('*').order('name'),
      supabase.from('trainings_completed').select('collaborator_id, training_type'),
    ]);
    setCollaborators(collabs ?? []);
    setTrainings(trains ?? []);
  }, []);

  useEffect(() => { fetchData(); }, [location.pathname, fetchData]);

  useEffect(() => {
    const onFocus = () => fetchData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchData]);

  const filtered = collaborators.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.opsid ?? '').toLowerCase().includes(search.toLowerCase()) ||
    c.soc.toLowerCase().includes(search.toLowerCase()) ||
    c.sector.toLowerCase().includes(search.toLowerCase())
  );

  const totalLeaders = collaborators.filter(c => c.role?.toLowerCase().includes('líder') || c.role?.toLowerCase().includes('lider')).length;

  const isTrained = (c: Collaborator) => {
    return trainings.some((t) => 
      t.collaborator_id === c.id && 
      (
        t.training_type?.toUpperCase().includes(c.sector?.toUpperCase()) ||
        c.sector?.toUpperCase().includes(t.training_type?.toUpperCase()) ||
        t.training_type?.toUpperCase() === c.sector?.toUpperCase() ||
        t.training_type?.toUpperCase().includes('ONBOARDING OPERACIONAL') ||
        t.training_type?.toUpperCase() === 'ONBOARDING OPERACIONAL'
      )
    );
  };

  const uniqueTrained = collaborators.filter(c => isTrained(c)).length;
  const trainedPct = collaborators.length > 0 ? Math.round((uniqueTrained / collaborators.length) * 100) : 0;

  const handleSave = async () => {
    if (!form.name || !form.soc || !form.sector || !form.shift || !form.role) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }
    if (editingId) {
      await supabase.from('collaborators').update(form).eq('id', editingId);
      toast.success('Colaborador atualizado');
    } else {
      await supabase.from('collaborators').insert(form);
      toast.success('Colaborador cadastrado');
    }
    setForm(emptyForm);
    setShowForm(false);
    setEditingId(null);
    fetchData();
  };

  const startEdit = (c: Collaborator) => {
    setForm({ name: c.name, opsid: c.opsid ?? '', gender: c.gender ?? '', soc: c.soc, sector: c.sector, shift: c.shift, leader: c.leader ?? '', role: c.role });
    setEditingId(c.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este colaborador?')) return;
    await supabase.from('collaborators').delete().eq('id', id);
    fetchData();
    toast.success('Colaborador removido');
  };

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Read as text with UTF-8, strip BOM if present
      let text = await file.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

      // Normalize line endings
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());

      if (lines.length < 2) {
        toast.error('CSV vazio ou sem dados além do cabeçalho.');
        e.target.value = '';
        return;
      }

      // Detect separator from first line
      const firstLine = lines[0];
      const sep = firstLine.includes(';') ? ';' : ',';

      // Smart split that respects quoted values
      const splitLine = (line: string) => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === sep && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        result.push(current.trim());
        return result;
      };

      const header = splitLine(firstLine).map(h => h.toLowerCase().trim());
      console.log('[CSV] Cabeçalho detectado:', header);

      const rows = lines.slice(1).map((line, idx) => {
        const p = splitLine(line);
        // Try to map by header or by position (fallback)
        const get = (names: string[], pos: number) => {
          for (const n of names) {
            const i = header.indexOf(n);
            if (i >= 0 && p[i]) return p[i].trim();
          }
          return p[pos]?.trim() ?? '';
        };

        return {
          opsid: get(['opsid', 'ops id', 'matricula', 'id'], 0),
          gender: get(['genero', 'gênero', 'gender', 'sexo'], 1),
          name: get(['colaborador', 'nome', 'name', 'colaborador'], 2),
          shift: get(['turno', 'shift'], 3),
          sector: get(['setor', 'sector', 'area', 'área'], 4),
          leader: get(['lider', 'líder', 'leader', 'gestor'], 5),
          role: get(['cargo', 'role', 'função', 'funcao'], 6),
          soc: get(['soc', 'unidade', 'unit'], 7),
        };
      }).filter(r => r.name && r.name.length > 1);

      console.log(`[CSV] ${rows.length} linha(s) válida(s) encontradas`);

      if (rows.length === 0) {
        toast.error('Nenhum colaborador válido encontrado. Verifique se o arquivo segue o modelo.');
        e.target.value = '';
        return;
      }

      // Insert in batches of 50
      let totalInserted = 0;
      let lastError = '';
      const BATCH = 50;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error } = await supabase.from('collaborators').insert(batch);
        if (error) {
          lastError = error.message;
          console.error('[CSV] Erro no batch:', error);
        } else {
          totalInserted += batch.length;
        }
      }

      if (totalInserted > 0) {
        toast.success(`✓ ${totalInserted} colaboradores importados com sucesso!`);
        fetchData();
      }
      if (lastError) {
        toast.error(`Alguns registros falharam: ${lastError}`);
      }
    } catch (err: any) {
      toast.error('Erro ao ler arquivo: ' + (err?.message ?? String(err)));
      console.error('[CSV] Erro crítico:', err);
    }

    e.target.value = '';
  };

  const downloadTemplate = () => {
    const bom = '\uFEFF'; // UTF-8 BOM for Excel compatibility
    const csv = bom + 'OPSID;Gênero;Colaborador;Turno;Setor;Líder;Cargo;SOC\n001;MASCULINO;João Silva;A;RECEBIMENTO;Carlos;Operador Logístico;SP6\n002;FEMININO;Maria Souza;B;EXPEDIÇÃO;Ana;Auxiliar;SP6';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'modelo_colaboradores.csv';

    a.click();
  };

  const fields: { key: keyof typeof emptyForm; label: string }[] = [
    { key: 'opsid', label: 'OPSID' },
    { key: 'gender', label: 'Gênero' },
    { key: 'name', label: 'Colaborador' },
    { key: 'shift', label: 'Turno' },
    { key: 'sector', label: 'Setor' },
    { key: 'leader', label: 'Líder' },
    { key: 'role', label: 'Cargo' },
    { key: 'soc', label: 'SOC' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Colaboradores</h1>
          <p className="text-sm text-muted-foreground mt-1">{collaborators.length} cadastrados</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={downloadTemplate} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-foreground text-sm hover:bg-secondary/80 transition-colors">
              <Download size={16} /> Modelo CSV
            </button>
            <label className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-foreground text-sm hover:bg-secondary/80 transition-colors cursor-pointer">
              <Upload size={16} /> Importar CSV
              <input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
            </label>
            <button onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-all">
              <Plus size={16} /> Novo
            </button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card-hover p-4 flex items-center gap-3">
          <Users size={20} className="text-primary" />
          <div><p className="text-xl font-bold text-foreground">{collaborators.length}</p><p className="text-xs text-muted-foreground">Colaboradores</p></div>
        </div>
        <div className="glass-card-hover p-4 flex items-center gap-3">
          <Crown size={20} className="text-yellow-400" />
          <div><p className="text-xl font-bold text-foreground">{totalLeaders}</p><p className="text-xs text-muted-foreground">Líderes</p></div>
        </div>
        <div className="glass-card-hover p-4 flex items-center gap-3">
          <UserCheck size={20} className="text-green-400" />
          <div><p className="text-xl font-bold text-foreground">{uniqueTrained}</p><p className="text-xs text-muted-foreground">Treinados</p></div>
        </div>
        <div className="glass-card-hover p-4 flex items-center gap-3">
          <UserCheck size={20} className="text-blue-400" />
          <div><p className="text-xl font-bold text-foreground">{trainedPct}%</p><p className="text-xs text-muted-foreground">% Treinados</p></div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, OPSID, SOC ou setor..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
      </div>

      {/* Form */}
      {showForm && isAdmin && (
        <div className="glass-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{editingId ? 'Editar Colaborador' : 'Novo Colaborador'}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {fields.map(({ key, label }) => (
              <input key={key} value={form[key]} onChange={(e) => setForm(prev => ({ ...prev, [key]: e.target.value }))} placeholder={label}
                className="px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Salvar</button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40">
              <th className="text-left p-4 text-muted-foreground font-medium">OPSID</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Gênero</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Colaborador</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Turno</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Setor</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Líder</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Cargo</th>
              <th className="text-left p-4 text-muted-foreground font-medium">SOC</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Status</th>
              {isAdmin && <th className="text-right p-4 text-muted-foreground font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-b border-border/20 hover:bg-secondary/30 transition-colors">
                <td className="p-4 text-foreground">{c.opsid}</td>
                <td className="p-4 text-foreground">{c.gender}</td>
                <td className="p-4 text-foreground font-medium">{c.name}</td>
                <td className="p-4 text-foreground">{c.shift}</td>
                <td className="p-4 text-foreground">{c.sector}</td>
                <td className="p-4 text-foreground">{c.leader}</td>
                <td className="p-4 text-foreground">{c.role}</td>
                <td className="p-4 text-foreground">{c.soc}</td>
                <td className="p-4 text-foreground">
                  {isTrained(c) ? (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-600 border border-emerald-500/30">TREINADO</span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-600 border border-rose-500/30">PENDENTE</span>
                  )}
                </td>
                {isAdmin && (
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => startEdit(c)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-md text-destructive hover:bg-destructive/20 transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-8 text-center text-muted-foreground">Nenhum colaborador encontrado</div>}
      </div>
    </div>
  );
}
