import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PenTool, Search, Eye, X, Download, Calendar, User, GraduationCap, Trash2 } from 'lucide-react';
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

  useEffect(() => {
    const fetchSignatures = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('trainings_completed')
        .select(`
          *,
          collaborator:collaborator_id (name, sector, soc, role)
        `)
        .order('completed_at', { ascending: false });

      if (!error && data) setRecords(data as any);
      setLoading(false);
    };
    fetchSignatures();
  }, []);

  const filtered = records.filter(r => {
    const name = r.collaborator?.name?.toLowerCase() ?? '';
    const training = r.training_type?.toLowerCase() ?? '';
    const instructor = r.instructor_name?.toLowerCase() ?? '';
    const q = search.toLowerCase();
    return name.includes(q) || training.includes(q) || instructor.includes(q);
  });

  const formatDate = (d: string) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
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
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
          <PenTool size={24} className="text-primary" /> Assinaturas Registradas
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {records.length} registro{records.length !== 1 ? 's' : ''} de treinamento com assinatura eletrônica
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por colaborador, treinamento ou instrutor..."
          className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
        />
      </div>

      {/* Table */}
      <div className="glass-card overflow-auto">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Carregando registros...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <PenTool size={40} className="mx-auto mb-4 opacity-30" />
            <p>Nenhuma assinatura registrada ainda.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40">
                <th className="text-left p-4 text-muted-foreground font-medium">Colaborador</th>
                <th className="text-left p-4 text-muted-foreground font-medium">Treinamento</th>
                <th className="text-left p-4 text-muted-foreground font-medium">Instrutor</th>
                <th className="text-left p-4 text-muted-foreground font-medium">SOC</th>
                <th className="text-left p-4 text-muted-foreground font-medium">Data/Hora</th>
                <th className="text-center p-4 text-muted-foreground font-medium">Assinatura</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-border/20 hover:bg-secondary/30 transition-colors">
                  <td className="p-4">
                    <p className="font-medium text-foreground">{r.collaborator?.name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{r.collaborator?.role} • {r.collaborator?.sector}</p>
                  </td>
                  <td className="p-4">
                    <span className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                      {r.training_type}
                    </span>
                  </td>
                  <td className="p-4 text-foreground">{r.instructor_name ?? '—'}</td>
                  <td className="p-4 text-foreground">{r.collaborator?.soc ?? '—'}</td>
                  <td className="p-4 text-muted-foreground text-xs">{formatDate(r.completed_at)}</td>
                  <td className="p-4">
                    <div className="flex items-center justify-center gap-2">
                      {r.signature_pdf_url ? (
                        <>
                          <button
                            onClick={() => setViewing(r)}
                            className="p-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            title="Ver assinatura"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={() => downloadSignature(r)}
                            className="p-1.5 rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            title="Baixar assinatura"
                          >
                            <Download size={16} />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem imagem</span>
                      )}
                      <button
                        onClick={() => deleteRecord(r.id)}
                        className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                        title="Excluir registro"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Signature View Modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-card border border-border/40 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Comprovante de Assinatura</h3>
              <button onClick={() => setViewing(null)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-secondary/50 p-3 rounded-lg flex items-start gap-2">
                <User size={16} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Colaborador</p>
                  <p className="font-semibold text-foreground">{viewing.collaborator?.name}</p>
                  <p className="text-xs text-muted-foreground">{viewing.collaborator?.role}</p>
                </div>
              </div>
              <div className="bg-secondary/50 p-3 rounded-lg flex items-start gap-2">
                <GraduationCap size={16} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Instrutor</p>
                  <p className="font-semibold text-foreground">{viewing.instructor_name ?? '—'}</p>
                </div>
              </div>
              <div className="bg-secondary/50 p-3 rounded-lg col-span-2 flex items-start gap-2">
                <Calendar size={16} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Treinamento • {formatDate(viewing.completed_at)}</p>
                  <p className="font-semibold text-primary">{viewing.training_type}</p>
                </div>
              </div>
            </div>

            {/* Signature Image */}
            {viewing.signature_pdf_url && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Assinatura Eletrônica:</p>
                <div className="bg-white rounded-lg border border-border overflow-hidden p-2">
                  {isBase64(viewing.signature_pdf_url) ? (
                    <img
                      src={viewing.signature_pdf_url}
                      alt="Assinatura"
                      className="w-full object-contain max-h-48"
                    />
                  ) : (
                    <img
                      src={viewing.signature_pdf_url}
                      alt="Assinatura"
                      className="w-full object-contain max-h-48"
                    />
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => downloadSignature(viewing)}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110"
              >
                <Download size={16} /> Baixar Assinatura
              </button>
              <button
                onClick={() => setViewing(null)}
                className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm"
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
