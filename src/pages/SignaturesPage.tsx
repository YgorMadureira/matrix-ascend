import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PenTool, Search, Eye, X, Download, Calendar, User, GraduationCap, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface SignatureRecord {
  id: string;
  collaborator_id: string;
  training_type: string;
  signature_pdf_url: string | null;
  instructor_name: string | null;
  completed_at: string;
  collaborator?: {
    name: string;
    sector: string;
    soc: string;
    role: string;
  };
}

export default function SignaturesPage() {
  const [records, setRecords] = useState<SignatureRecord[]>([]);
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<SignatureRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [socFilter, setSocFilter] = useState('ALL');
  const { profile } = useAuth();

  useEffect(() => {
    const fetchSignatures = async () => {
      setLoading(true);
      let allRecords: SignatureRecord[] = [];
      let page = 0;
      const limit = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('trainings_completed')
          .select(`
            *,
            collaborator:collaborator_id (name, sector, soc, role)
          `)
          .order('completed_at', { ascending: false })
          .range(page * limit, (page + 1) * limit - 1);

        if (error) {
          console.error(error);
          break;
        }

        if (data && data.length > 0) {
          allRecords = [...allRecords, ...(data as any)];
          if (data.length < limit) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }

      if (profile?.soc) {
        allRecords = allRecords.filter(r => r.collaborator?.soc === profile.soc);
      }
      setRecords(allRecords);
      setLoading(false);
    };
    fetchSignatures();
  }, [profile?.soc]);

  const socOptions = [...new Set(records.map(r => r.collaborator?.soc).filter(Boolean))].sort();

  const filtered = records.filter(r => {
    const name = r.collaborator?.name?.toLowerCase() ?? '';
    const training = r.training_type?.toLowerCase() ?? '';
    const instructor = r.instructor_name?.toLowerCase() ?? '';
    const q = search.toLowerCase();
    if (!(name.includes(q) || training.includes(q) || instructor.includes(q))) return false;
    if (socFilter !== 'ALL' && r.collaborator?.soc !== socFilter) return false;
    return true;
  });

  const formatDate = (d: string) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo'
    });
  };

  const isBase64 = (url: string) => url?.startsWith('data:image');

  const downloadSignature = (record: SignatureRecord) => {
    if (!record.signature_pdf_url) return;
    const a = document.createElement('a');
    a.href = record.signature_pdf_url;
    a.download = `assinatura_${record.collaborator?.name ?? record.id}.png`;
    a.click();
  };

  const deleteRecord = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta assinatura? Esta ação não pode ser desfeita.')) return;
    const { error } = await supabase.from('trainings_completed').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir: ' + error.message);
    } else {
      toast.success('Registro excluído com sucesso');
      setRecords(prev => prev.filter(r => r.id !== id));
      if (viewing?.id === id) setViewing(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
          <PenTool size={20} className="text-[#EE4D2D]" /> Assinaturas Registradas
        </h1>
        <p className="text-xs text-gray-500 font-medium mt-0.5">
          {records.length} registro{records.length !== 1 ? 's' : ''} de treinamento com assinatura eletrônica
        </p>
      </div>

      {/* Search + SOC Filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por colaborador, treinamento ou instrutor..."
            className="w-full pl-11 pr-4 py-2.5 rounded-lg bg-white border border-gray-100 text-gray-800 text-[13px] font-medium outline-none focus:ring-2 focus:ring-[#EE4D2D]/10 shadow-sm transition-all"
          />
        </div>
        <select value={socFilter} onChange={e => setSocFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-white border border-gray-100 text-[12px] font-black text-gray-600 outline-none shadow-sm">
          <option value="ALL">Todas SOCs</option>
          {socOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Carregando registros...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <PenTool size={36} className="mx-auto mb-3 text-gray-200" />
            <p className="text-gray-400 text-sm">Nenhuma assinatura registrada ainda.</p>
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[65vh] custom-scrollbar">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50/80 backdrop-blur-sm border-b border-gray-100">
                  <th className="text-left p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Colaborador</th>
                  <th className="text-left p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Treinamento</th>
                  <th className="text-left p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Instrutor</th>
                  <th className="text-left p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">SOC</th>
                  <th className="text-left p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Data/Hora</th>
                  <th className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Assinatura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <tr key={r.id} className="group hover:bg-gray-50/50 transition-colors">
                    <td className="p-3">
                      <p className="font-bold text-gray-900 whitespace-nowrap">{r.collaborator?.name ?? '—'}</p>
                      <p className="text-[10px] text-gray-400">{r.collaborator?.role} • {r.collaborator?.sector}</p>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full bg-[#FEF6F5] text-[#EE4D2D] text-[10px] font-black border border-[#EE4D2D]/10">
                        {r.training_type}
                      </span>
                    </td>
                    <td className="p-3 text-gray-700 font-medium whitespace-nowrap">{r.instructor_name ?? '—'}</td>
                    <td className="p-3 text-gray-900 font-black whitespace-nowrap">{r.collaborator?.soc ?? '—'}</td>
                    <td className="p-3 text-gray-400 text-[11px] whitespace-nowrap">{formatDate(r.completed_at)}</td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1.5">
                        {r.signature_pdf_url ? (
                          <>
                            <button
                              onClick={() => setViewing(r)}
                              className="p-1.5 rounded-lg bg-[#FEF6F5] text-[#EE4D2D] hover:bg-[#EE4D2D]/20 transition-colors"
                              title="Ver assinatura"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => downloadSignature(r)}
                              className="p-1.5 rounded-lg bg-gray-50 text-gray-400 hover:text-gray-700 transition-colors"
                              title="Baixar assinatura"
                            >
                              <Download size={14} />
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] text-gray-300 font-bold">Sem imagem</span>
                        )}
                        <button
                          onClick={() => deleteRecord(r.id)}
                          className="p-1.5 rounded-lg bg-red-50 text-red-400 hover:text-red-600 hover:bg-red-100 transition-colors"
                          title="Excluir registro"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Signature View Modal - Light backdrop */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-gray-900/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 shadow-2xl border border-gray-100 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-gray-900">Comprovante de Assinatura</h3>
              <button onClick={() => setViewing(null)} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-gray-50 p-3 rounded-lg flex items-start gap-2">
                <User size={14} className="text-[#EE4D2D] mt-0.5 shrink-0" />
                <div>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Colaborador</p>
                  <p className="text-xs font-bold text-gray-900">{viewing.collaborator?.name}</p>
                  <p className="text-[9px] text-gray-400">{viewing.collaborator?.role}</p>
                </div>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg flex items-start gap-2">
                <GraduationCap size={14} className="text-[#EE4D2D] mt-0.5 shrink-0" />
                <div>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Instrutor</p>
                  <p className="text-xs font-bold text-gray-900">{viewing.instructor_name ?? '—'}</p>
                </div>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg col-span-2 flex items-start gap-2">
                <Calendar size={14} className="text-[#EE4D2D] mt-0.5 shrink-0" />
                <div>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Treinamento • {formatDate(viewing.completed_at)}</p>
                  <p className="text-xs font-black text-[#EE4D2D]">{viewing.training_type}</p>
                </div>
              </div>
            </div>

            {/* Signature Image */}
            {viewing.signature_pdf_url && (
              <div>
                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mb-1.5">Assinatura Eletrônica</p>
                <div className="bg-gray-50 rounded-lg border border-gray-100 overflow-hidden p-2">
                  <img
                    src={viewing.signature_pdf_url}
                    alt="Assinatura"
                    className="w-full object-contain max-h-40"
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => downloadSignature(viewing)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg shopee-gradient-bg text-white text-[11px] font-black uppercase tracking-widest hover:brightness-110 shadow-md transition-all"
              >
                <Download size={14} /> Baixar
              </button>
              <button
                onClick={() => setViewing(null)}
                className="px-5 py-2.5 rounded-lg bg-gray-50 text-gray-500 text-[11px] font-black uppercase tracking-widest hover:bg-gray-100 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
