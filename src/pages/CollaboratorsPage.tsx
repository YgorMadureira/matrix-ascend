import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Upload, Download, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';

interface Collaborator {
  id: string;
  name: string;
  soc: string;
  sector: string;
  shift: string;
  role: string;
}

export default function CollaboratorsPage() {
  const { isAdmin } = useAuth();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', soc: '', sector: '', shift: '', role: '' });

  const fetchCollaborators = async () => {
    const { data } = await supabase.from('collaborators').select('*').order('name');
    setCollaborators(data ?? []);
  };

  useEffect(() => { fetchCollaborators(); }, []);

  const filtered = collaborators.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.soc.toLowerCase().includes(search.toLowerCase()) ||
    c.sector.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    if (!form.name || !form.soc || !form.sector || !form.shift || !form.role) {
      toast.error('Preencha todos os campos');
      return;
    }
    await supabase.from('collaborators').insert(form);
    setForm({ name: '', soc: '', sector: '', shift: '', role: '' });
    setShowForm(false);
    fetchCollaborators();
    toast.success('Colaborador cadastrado');
  };

  const handleDelete = async (id: string) => {
    await supabase.from('collaborators').delete().eq('id', id);
    fetchCollaborators();
    toast.success('Colaborador removido');
  };

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    const header = lines[0];
    const sep = header.includes(';') ? ';' : ',';
    const rows = lines.slice(1).map(line => {
      const parts = line.split(sep).map(p => p.trim().replace(/^"|"$/g, ''));
      return { name: parts[0], soc: parts[1], sector: parts[2], shift: parts[3], role: parts[4] };
    }).filter(r => r.name && r.soc);

    if (rows.length === 0) {
      toast.error('Nenhum dado válido no CSV');
      return;
    }

    const { error } = await supabase.from('collaborators').insert(rows);
    if (error) {
      toast.error('Erro ao importar: ' + error.message);
    } else {
      toast.success(`${rows.length} colaboradores importados`);
      fetchCollaborators();
    }
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const csv = 'Nome,SOC,Setor,Turno,Cargo\nJoão Silva,SPX-001,RECEBIMENTO,A,Operador\nMaria Santos,SPX-001,EXPEDIÇÃO,B,Líder';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo_colaboradores.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

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
            <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-all">
              <Plus size={16} /> Novo
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, SOC ou setor..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
        />
      </div>

      {/* Form */}
      {showForm && isAdmin && (
        <div className="glass-card p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {(['name', 'soc', 'sector', 'shift', 'role'] as const).map((field) => (
            <input
              key={field}
              value={form[field]}
              onChange={(e) => setForm(prev => ({ ...prev, [field]: e.target.value }))}
              placeholder={{ name: 'Nome', soc: 'SOC (Unidade)', sector: 'Setor', shift: 'Turno', role: 'Cargo' }[field]}
              className="px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
            />
          ))}
          <div className="col-span-full flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Salvar</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40">
              <th className="text-left p-4 text-muted-foreground font-medium">Nome</th>
              <th className="text-left p-4 text-muted-foreground font-medium">SOC</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Setor</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Turno</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Cargo</th>
              {isAdmin && <th className="text-right p-4 text-muted-foreground font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-b border-border/20 hover:bg-secondary/30 transition-colors">
                <td className="p-4 text-foreground">{c.name}</td>
                <td className="p-4 text-foreground">{c.soc}</td>
                <td className="p-4 text-foreground">{c.sector}</td>
                <td className="p-4 text-foreground">{c.shift}</td>
                <td className="p-4 text-foreground">{c.role}</td>
                {isAdmin && (
                  <td className="p-4 text-right">
                    <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-md text-destructive hover:bg-destructive/20 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted-foreground">Nenhum colaborador encontrado</div>
        )}
      </div>
    </div>
  );
}
