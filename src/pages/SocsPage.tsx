import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Edit2, Trash2, Building2 } from 'lucide-react';
import { toast } from 'sonner';

interface Soc {
  id: string;
  name: string;
  created_at: string;
}

export default function SocsPage() {
  const { isAdmin } = useAuth();
  const [socs, setSocs] = useState<Soc[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');

  const fetchSocs = async () => {
    const { data } = await supabase.from('socs').select('*').order('name');
    setSocs(data ?? []);
  };

  useEffect(() => { fetchSocs(); }, []);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Informe o nome da SOC'); return; }
    if (editingId) {
      await supabase.from('socs').update({ name }).eq('id', editingId);
      toast.success('SOC atualizada');
    } else {
      await supabase.from('socs').insert({ name });
      toast.success('SOC cadastrada');
    }
    setName('');
    setShowForm(false);
    setEditingId(null);
    fetchSocs();
  };

  const startEdit = (soc: Soc) => {
    setName(soc.name);
    setEditingId(soc.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta SOC?')) return;
    await supabase.from('socs').delete().eq('id', id);
    fetchSocs();
    toast.success('SOC removida');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">SOCs (Unidades)</h1>
          <p className="text-sm text-muted-foreground mt-1">{socs.length} unidades cadastradas</p>
        </div>
        {isAdmin && (
          <button onClick={() => { setName(''); setEditingId(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-all">
            <Plus size={16} /> Nova SOC
          </button>
        )}
      </div>

      {showForm && isAdmin && (
        <div className="glass-card p-4 flex gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da SOC (ex: SPX-001)"
            className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()} />
          <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">
            {editingId ? 'Atualizar' : 'Criar'}
          </button>
          <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm">Cancelar</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {socs.map((soc) => (
          <div key={soc.id} className="glass-card-hover p-5 flex items-center justify-between group">
            <div className="flex items-center gap-3">
              <Building2 size={24} className="text-primary" />
              <div>
                <p className="font-medium text-foreground">{soc.name}</p>
                <p className="text-xs text-muted-foreground">Criada em {new Date(soc.created_at).toLocaleDateString('pt-BR')}</p>
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => startEdit(soc)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  <Edit2 size={16} />
                </button>
                <button onClick={() => handleDelete(soc.id)} className="p-1.5 rounded-md text-destructive hover:bg-destructive/20 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {socs.length === 0 && (
        <div className="glass-card p-12 text-center">
          <Building2 size={48} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Nenhuma SOC cadastrada. {isAdmin ? 'Clique em "Nova SOC" para começar.' : ''}</p>
        </div>
      )}
    </div>
  );
}
