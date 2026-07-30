import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Edit2, Trash2, Building2, MapPin, User, CheckCircle2, XCircle, X, Lock, ShieldAlert } from 'lucide-react';
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
  const { isAdmin, profile } = useAuth();
  const [socs, setSocs] = useState<Soc[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [viewingSoc, setViewingSoc] = useState<Soc | null>(null);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [ptsList, setPtsList] = useState<string[]>([]);
  const [newPtsInput, setNewPtsInput] = useState('');
  const [siteLeader, setSiteLeader] = useState('');
  const [hasSorting, setHasSorting] = useState(false);

  const fetchSocs = async () => {
    const { data } = await supabase.from('socs').select('*').order('name');
    setSocs(data ?? []);
  };

  useEffect(() => { fetchSocs(); }, []);

  // Verifica se o usuário admin tem permissão para editar ESTA SOC específica
  const canEditSoc = (socName: string) => {
    if (!isAdmin) return false;
    if (!profile?.soc) return true; // Se o admin não tiver SOC restrito no cadastro, edita todas
    return profile.soc.trim().toUpperCase() === socName.trim().toUpperCase();
  };

  const handleAddPts = () => {
    const val = newPtsInput.trim();
    if (val) {
      if (!ptsList.includes(val)) {
        setPtsList([...ptsList, val]);
      }
      setNewPtsInput('');
    }
  };

  const handleRemovePts = (indexToRemove: number) => {
    setPtsList(ptsList.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Informe o nome da SOC'); return; }

    // Garante inclusão de qualquer texto pendente no campo PTS
    let finalPtsList = [...ptsList];
    if (newPtsInput.trim() && !finalPtsList.includes(newPtsInput.trim())) {
      finalPtsList.push(newPtsInput.trim());
    }

    const payload = {
      name: name.trim(),
      address: address.trim(),
      pts_name: finalPtsList.join(', '),
      site_leader: siteLeader.trim(),
      has_sorting: hasSorting
    };

    if (editingId) {
      const targetSoc = socs.find(s => s.id === editingId);
      if (targetSoc && !canEditSoc(targetSoc.name)) {
        toast.error(`Você só tem permissão para editar a SOC ${profile?.soc}`);
        return;
      }

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
    setPtsList([]);
    setNewPtsInput('');
    setSiteLeader('');
    setHasSorting(false);
    setEditingId(null);
  };

  const startEdit = (soc: Soc) => {
    if (!canEditSoc(soc.name)) {
      toast.error(`Você só tem permissão para editar sua unidade (${profile?.soc})`);
      return;
    }
    setName(soc.name);
    setAddress(soc.address || '');
    const names = (soc.pts_name || '').split(',').map(s => s.trim()).filter(Boolean);
    setPtsList(names);
    setNewPtsInput('');
    setSiteLeader(soc.site_leader || '');
    setHasSorting(soc.has_sorting || false);
    setEditingId(soc.id);
    setShowForm(true);
  };

  const handleDelete = async (soc: Soc, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEditSoc(soc.name)) {
      toast.error(`Você só possui permissão de gestão sobre o SOC ${profile?.soc}`);
      return;
    }
    if (!confirm(`Tem certeza que deseja excluir a unidade ${soc.name}?`)) return;
    await supabase.from('socs').delete().eq('id', soc.id);
    fetchSocs();
    toast.success('SOC removida permanentemente');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">SOCs (Unidades)</h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            {socs.length} unidades cadastradas no sistema
            {profile?.soc && (
              <span className="ml-2 font-bold text-[#EE4D2D]">
                • Sua unidade de cadastro: <span className="underline">{profile.soc}</span>
              </span>
            )}
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-2 px-5 py-2 rounded-full shopee-gradient-bg text-white text-[10px] font-black uppercase tracking-widest hover:brightness-110 shadow-md transition-all">
            <Plus size={16} /> Nova SOC
          </button>
        )}
      </div>

      {/* Modal Formulário (Adicionar / Editar SOC) */}
      {showForm && isAdmin && createPortal(
        <div className="fixed inset-0 z-[100] bg-gray-900/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-black text-gray-900">{editingId ? `Editar SOC ${name}` : 'Nova SOC'}</h3>
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

              {/* ── Campo Dinâmico: Múltiplos PTS Responsáveis ── */}
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1 flex items-center justify-between">
                  <span>PTS Responsáveis</span>
                  <span className="text-gray-400 font-normal lowercase">(adicione um ou mais)</span>
                </label>
                
                {/* Lista de PTS adicionados */}
                {ptsList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2 p-2 bg-gray-50 rounded-lg border border-gray-100">
                    {ptsList.map((pts, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1.5 bg-white text-gray-800 text-xs font-bold px-2.5 py-1 rounded-md border border-gray-200 shadow-2xs">
                        {pts}
                        <button type="button" onClick={() => handleRemovePts(idx)} className="text-gray-400 hover:text-red-500 transition-colors p-0.5 rounded-full hover:bg-red-50">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Input + Botão de adicionar */}
                <div className="flex gap-2">
                  <input
                    value={newPtsInput}
                    onChange={e => setNewPtsInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddPts();
                      }
                    }}
                    type="text"
                    placeholder="Digite o nome do PTS e pressione Enter"
                    className="flex-1 px-3 py-2 rounded-lg bg-gray-50 border border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all"
                  />
                  <button
                    type="button"
                    onClick={handleAddPts}
                    className="px-3 py-2 bg-gray-900 hover:bg-black text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                  >
                    <Plus size={14} /> Incluir
                  </button>
                </div>
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
        </div>,
        document.body
      )}

      {/* Info Modal - Visualização de detalhes da SOC */}
      {viewingSoc && createPortal(
        <div className="fixed inset-0 z-[100] bg-gray-900/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 space-y-5 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200 relative">
            <button onClick={() => setViewingSoc(null)} className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors">
              <X size={18} />
            </button>
            
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-[#FEF6F5] flex items-center justify-center mx-auto mb-3 border border-[#EE4D2D]/10">
                <Building2 size={28} className="text-[#EE4D2D]" />
              </div>
              <h3 className="text-xl font-black text-gray-900">{viewingSoc.name}</h3>
              
              {/* Badge de permissão */}
              {canEditSoc(viewingSoc.name) ? (
                <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-600 border border-emerald-200 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full mt-1">
                  <Edit2 size={10} /> Sua Unidade (Edição Permitida)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-500 border border-gray-200 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full mt-1">
                  <Lock size={10} /> Somente Leitura
                </span>
              )}

              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">
                Adicionada em {new Date(viewingSoc.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
              </p>
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
                <div className="space-y-2 w-full">
                  <div>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mb-1">PTS Responsável</p>
                    {viewingSoc.pts_name ? (
                      <div className="flex flex-wrap gap-1">
                        {viewingSoc.pts_name.split(',').map((p, i) => (
                          <span key={i} className="inline-block bg-white text-gray-800 border border-gray-200 text-xs font-bold px-2 py-0.5 rounded shadow-2xs">
                            {p.trim()}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm font-bold text-gray-800">-</p>
                    )}
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

            <div className="flex gap-2">
              {canEditSoc(viewingSoc.name) && (
                <button
                  onClick={() => {
                    const soc = viewingSoc;
                    setViewingSoc(null);
                    startEdit(soc);
                  }}
                  className="flex-1 py-2.5 rounded-lg shopee-gradient-bg text-white text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-1.5"
                >
                  <Edit2 size={13} /> Editar SOC
                </button>
              )}
              <button
                onClick={() => setViewingSoc(null)}
                className={`${canEditSoc(viewingSoc.name) ? 'flex-1' : 'w-full'} py-2.5 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-black uppercase tracking-widest hover:bg-gray-200 transition-colors`}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Grid de Cards de SOCs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {socs.map((soc) => {
          const isEditable = canEditSoc(soc.name);
          return (
            <div
              key={soc.id}
              onClick={() => setViewingSoc(soc)}
              className={`relative bg-white p-5 rounded-xl border transition-all flex flex-col items-center justify-center text-center group cursor-pointer h-32 ${
                isEditable
                  ? 'border-gray-100 shadow-sm hover:shadow-md hover:border-[#EE4D2D]/20'
                  : 'border-gray-100 bg-gray-50/50 hover:bg-white hover:shadow-sm'
              }`}
            >
              <Building2 size={28} className={isEditable ? 'text-[#EE4D2D] mb-2' : 'text-gray-400 mb-2'} />
              <p className="font-black text-base text-gray-900">{soc.name}</p>

              <div className="flex items-center gap-1 mt-1">
                {isEditable ? (
                  <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-tighter">Sua Unidade</span>
                ) : (
                  <span className="text-[9px] text-gray-400 font-medium uppercase tracking-tighter flex items-center gap-0.5">
                    <Lock size={9} /> Leitura
                  </span>
                )}
              </div>

              {/* Botões de Ação (Apenas para a SOC cadastrada do Admin) */}
              {isEditable && (
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(soc); }}
                    className="p-1.5 rounded-lg bg-white text-gray-400 hover:text-[#EE4D2D] hover:bg-[#FEF6F5] border border-gray-100 shadow-xs transition-all"
                    title="Editar esta SOC"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(soc, e)}
                    className="p-1.5 rounded-lg bg-white text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-100 shadow-xs transition-all"
                    title="Excluir esta SOC"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {socs.length === 0 && (
        <div className="bg-white p-12 rounded-xl border border-gray-100 text-center">
          <Building2 size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-400 text-sm font-medium">Nenhuma SOC cadastrada.</p>
        </div>
      )}
    </div>
  );
}
