import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Edit2, Trash2, Building2, MapPin, User, CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { toast } from 'sonner';

interface Soc {
  id: string;
  name: string;
  address: string | null;
  pts_name: string | null;
  site_leader: string | null;
  has_sorting: boolean;
  created_at: string;
}

export default function SocsPage() {
  const { isAdmin } = useAuth();
  const [socs, setSocs] = useState<Soc[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [viewingSoc, setViewingSoc] = useState<Soc | null>(null);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [ptsName, setPtsName] = useState('');
  const [siteLeader, setSiteLeader] = useState('');
  const [hasSorting, setHasSorting] = useState(false);

  const fetchSocs = async () => {
    const { data } = await supabase.from('socs').select('*').order('name');
    setSocs(data ?? []);
  };

  useEffect(() => { fetchSocs(); }, []);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Informe o nome da SOC'); return; }
    
    const payload = {
      name,
      address,
      pts_name: ptsName,
      site_leader: siteLeader,
      has_sorting: hasSorting
    };

    if (editingId) {
      await supabase.from('socs').update(payload).eq('id', editingId);
      toast.success('SOC atualizada com sucesso');
    } else {
      await supabase.from('socs').insert(payload);
      toast.success('SOC cadastrada com sucesso');
    }
    
    resetForm();
    setShowForm(false);
    fetchSocs();
  };

  const resetForm = () => {
    setName('');
    setAddress('');
    setPtsName('');
    setSiteLeader('');
    setHasSorting(false);
    setEditingId(null);
  };

  const startEdit = (soc: Soc) => {
    setName(soc.name);
    setAddress(soc.address || '');
    setPtsName(soc.pts_name || '');
    setSiteLeader(soc.site_leader || '');
    setHasSorting(soc.has_sorting || false);
    setEditingId(soc.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Excluir esta SOC? Dados vinculados podem ser afetados.')) return;
    await supabase.from('socs').delete().eq('id', id);
    fetchSocs();
    toast.success('SOC removida permanentemente');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">SOCs (Unidades)</h1>
          <p className="text-sm text-muted-foreground mt-1">{socs.length} unidades cadastradas no sistema</p>
        </div>
        {isAdmin && (
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-all shadow-glow">
            <Plus size={16} /> Nova SOC
          </button>
        )}
      </div>

      {showForm && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-border/40 rounded-xl overflow-hidden p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-display font-semibold text-foreground">{editingId ? 'Editar SOC' : 'Nova SOC'}</h3>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Nome da Unidade (ex: SPX-001)</label>
                <input value={name} onChange={e => setName(e.target.value)} type="text" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Endereço Completo</label>
                <input value={address} onChange={e => setAddress(e.target.value)} type="text" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Nome do PTS da Unidade</label>
                <input value={ptsName} onChange={e => setPtsName(e.target.value)} type="text" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Site Leader</label>
                <input value={siteLeader} onChange={e => setSiteLeader(e.target.value)} type="text" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer pt-2">
                <input type="checkbox" checked={hasSorting} onChange={e => setHasSorting(e.target.checked)} className="w-4 h-4 rounded text-primary focus:ring-primary accent-primary" />
                <span className="text-sm text-foreground">Esta unidade possui Sorting?</span>
              </label>
            </div>

            <div className="flex gap-2 pt-4">
              <button onClick={handleSave} className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:brightness-110 transition-all">
                {editingId ? 'Salvar Alterações' : 'Cadastrar Unidade'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Modal */}
      {viewingSoc && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-card border border-border/40 rounded-xl overflow-hidden p-6 space-y-6 shadow-2xl relative">
            <button onClick={() => setViewingSoc(null)} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
              <X size={20} />
            </button>
            
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 border border-primary/20">
                <Building2 size={32} className="text-primary" />
              </div>
              <h3 className="text-2xl font-display font-bold text-foreground">{viewingSoc.name}</h3>
              <p className="text-sm text-muted-foreground">Adicionada em {new Date(viewingSoc.created_at).toLocaleDateString()}</p>
            </div>

            <div className="space-y-4 pt-2">
              <div className="flex bg-secondary/50 p-3 rounded-lg gap-3">
                <MapPin size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Endereço Operacional</p>
                  <p className="text-sm font-medium text-foreground">{viewingSoc.address || 'Não cadastrado'}</p>
                </div>
              </div>

              <div className="flex bg-secondary/50 p-3 rounded-lg gap-3">
                <User size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                <div className="grid grid-cols-2 gap-x-4 w-full">
                  <div>
                    <p className="text-xs text-muted-foreground">PTS Responsável</p>
                    <p className="text-sm font-medium text-foreground">{viewingSoc.pts_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Site Leader</p>
                    <p className="text-sm font-medium text-foreground">{viewingSoc.site_leader || '-'}</p>
                  </div>
                </div>
              </div>

              <div className="flex bg-secondary/50 p-3 rounded-lg gap-3 items-center">
               {viewingSoc.has_sorting ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" /> : <XCircle size={18} className="text-red-500 shrink-0" />}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {viewingSoc.has_sorting ? 'Possui processo de Sorting' : 'Não possui processo de Sorting'}
                  </p>
                </div>
              </div>
            </div>
            
            <button onClick={() => setViewingSoc(null)} className="w-full py-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 mt-4 transition-colors">
              Fechar
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {socs.map((soc) => (
          <div key={soc.id} onClick={() => setViewingSoc(soc)} className="glass-card-hover p-5 flex flex-col items-center justify-center text-center group cursor-pointer h-36">
            <Building2 size={32} className="text-primary mb-2" />
            <p className="font-display font-medium text-lg text-foreground">{soc.name}</p>
            
            <div className="mt-2 text-xs flex gap-2 invisible group-hover:visible">
               <span className="text-muted-foreground underline decoration-dotted">Ver Detalhes</span>
            </div>

            {isAdmin && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); startEdit(soc); }} className="p-1.5 rounded-md bg-secondary text-muted-foreground hover:text-foreground">
                  <Edit2 size={14} />
                </button>
                <button onClick={(e) => handleDelete(soc.id, e)} className="p-1.5 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {socs.length === 0 && (
        <div className="glass-card p-12 text-center">
          <Building2 size={48} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground text-lg">Nenhuma SOC cadastrada.</p>
          <p className="text-muted-foreground text-sm mt-1">{isAdmin ? 'Clique no botão acima para adicionar a primeira unidade.' : 'Aguarde o administrador adicionar unidades.'}</p>
        </div>
      )}
    </div>
  );
}
