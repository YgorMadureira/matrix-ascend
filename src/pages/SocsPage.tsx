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
      <div className="flex items-center justify-between bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">SOCs (Unidades)</h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">{socs.length} unidades cadastradas no sistema</p>
        </div>
        {isAdmin && (
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-2 px-5 py-2 rounded-full shopee-gradient-bg text-white text-[10px] font-black uppercase tracking-widest hover:brightness-110 shadow-md transition-all">
            <Plus size={16} /> Nova SOC
          </button>
        )}
      </div>

      {showForm && isAdmin && (
        <div className="fixed inset-0 z-50 bg-gray-900/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-black text-gray-900">{editingId ? 'Editar SOC' : 'Nova SOC'}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Nome da Unidade</label>
                <input value={name} onChange={e => setName(e.target.value)} type="text" placeholder="Ex: SP6" className="w-full px-3 py-2.5 rounded-lg bg-gray-50 border border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Endereço Completo</label>
                <input value={address} onChange={e => setAddress(e.target.value)} type="text" className="w-full px-3 py-2.5 rounded-lg bg-gray-50 border border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">PTS Responsável</label>
                <input value={ptsName} onChange={e => setPtsName(e.target.value)} type="text" className="w-full px-3 py-2.5 rounded-lg bg-gray-50 border border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Site Leader</label>
                <input value={siteLeader} onChange={e => setSiteLeader(e.target.value)} type="text" className="w-full px-3 py-2.5 rounded-lg bg-gray-50 border border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input type="checkbox" checked={hasSorting} onChange={e => setHasSorting(e.target.checked)} className="w-4 h-4 rounded text-[#EE4D2D] focus:ring-[#EE4D2D] accent-[#EE4D2D]" />
                <span className="text-sm text-gray-700 font-medium">Esta unidade possui Sorting?</span>
              </label>
            </div>

            <button onClick={handleSave} className="w-full py-3 rounded-lg shopee-gradient-bg text-white text-[11px] font-black uppercase tracking-widest hover:brightness-110 shadow-md transition-all mt-2">
              {editingId ? 'Salvar Alterações' : 'Cadastrar Unidade'}
            </button>
          </div>
        </div>
      )}

      {/* Info Modal - Light backdrop, centered */}
      {viewingSoc && (
        <div className="fixed inset-0 z-50 bg-gray-900/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 space-y-5 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200 relative">
            <button onClick={() => setViewingSoc(null)} className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors">
              <X size={18} />
            </button>
            
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-[#FEF6F5] flex items-center justify-center mx-auto mb-3 border border-[#EE4D2D]/10">
                <Building2 size={28} className="text-[#EE4D2D]" />
              </div>
              <h3 className="text-xl font-black text-gray-900">{viewingSoc.name}</h3>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Adicionada em {new Date(viewingSoc.created_at).toLocaleDateString()}</p>
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex bg-gray-50 p-3 rounded-lg gap-3">
                <MapPin size={16} className="text-gray-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Endereço Operacional</p>
                  <p className="text-sm font-bold text-gray-800">{viewingSoc.address || 'Não cadastrado'}</p>
                </div>
              </div>

              <div className="flex bg-gray-50 p-3 rounded-lg gap-3">
                <User size={16} className="text-gray-400 mt-0.5 shrink-0" />
                <div className="grid grid-cols-2 gap-x-4 w-full">
                  <div>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">PTS Responsável</p>
                    <p className="text-sm font-bold text-gray-800">{viewingSoc.pts_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Site Leader</p>
                    <p className="text-sm font-bold text-gray-800">{viewingSoc.site_leader || '-'}</p>
                  </div>
                </div>
              </div>

              <div className="flex bg-gray-50 p-3 rounded-lg gap-3 items-center">
               {viewingSoc.has_sorting ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> : <XCircle size={16} className="text-red-500 shrink-0" />}
                <p className="text-sm font-bold text-gray-800">
                  {viewingSoc.has_sorting ? 'Possui processo de Sorting' : 'Não possui processo de Sorting'}
                </p>
              </div>
            </div>
            
            <button onClick={() => setViewingSoc(null)} className="w-full py-2.5 rounded-lg bg-gray-50 text-gray-500 text-[11px] font-black uppercase tracking-widest hover:bg-gray-100 transition-colors">
              Fechar
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {socs.map((soc) => (
          <div key={soc.id} onClick={() => setViewingSoc(soc)} className="relative bg-white p-5 rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-[#EE4D2D]/10 flex flex-col items-center justify-center text-center group cursor-pointer h-32 transition-all">
            <Building2 size={28} className="text-[#EE4D2D] mb-2" />
            <p className="font-black text-base text-gray-900">{soc.name}</p>
            
            <p className="text-[9px] text-gray-400 font-bold mt-1 opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest">Ver Detalhes</p>

            {isAdmin && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); startEdit(soc); }} className="p-1.5 rounded-lg bg-gray-50 text-gray-400 hover:text-[#EE4D2D] hover:bg-[#FEF6F5] transition-all">
                  <Edit2 size={12} />
                </button>
                <button onClick={(e) => handleDelete(soc.id, e)} className="p-1.5 rounded-lg bg-gray-50 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all">
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {socs.length === 0 && (
        <div className="bg-white p-12 rounded-xl border border-gray-100 text-center">
          <Building2 size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-400 text-sm font-medium">Nenhuma SOC cadastrada.</p>
          <p className="text-gray-300 text-xs mt-1">{isAdmin ? 'Clique no botão acima para adicionar.' : 'Aguarde o administrador adicionar unidades.'}</p>
        </div>
      )}
    </div>
  );
}
