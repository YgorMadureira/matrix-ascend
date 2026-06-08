import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PenTool, Search, Eye, X, Download, Calendar, User, GraduationCap, Trash2, FileText } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [instructorFilter, setInstructorFilter] = useState('ALL');
  const [trainingFilter, setTrainingFilter] = useState('ALL');
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
            id,
            collaborator_id,
            training_type,
            instructor_name,
            completed_at,
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
  const instructorOptions = [...new Set(records.map(r => r.instructor_name).filter(Boolean))].sort();
  const trainingOptions = [...new Set(records.map(r => r.training_type).filter(Boolean))].sort();

  const filtered = records.filter(r => {
    const name = r.collaborator?.name?.toLowerCase() ?? '';
    const training = r.training_type?.toLowerCase() ?? '';
    const instructor = r.instructor_name?.toLowerCase() ?? '';
    const q = search.toLowerCase();
    
    if (q && !(name.includes(q) || training.includes(q) || instructor.includes(q))) return false;
    if (socFilter !== 'ALL' && r.collaborator?.soc !== socFilter) return false;
    if (instructorFilter !== 'ALL' && r.instructor_name !== instructorFilter) return false;
    if (trainingFilter !== 'ALL' && r.training_type !== trainingFilter) return false;
    
    if (startDate) {
      const recordDate = new Date(r.completed_at);
      const start = new Date(startDate + 'T00:00:00');
      if (recordDate < start) return false;
    }
    
    if (endDate) {
      const recordDate = new Date(r.completed_at);
      const end = new Date(endDate + 'T23:59:59');
      if (recordDate > end) return false;
    }
    
    return true;
  });

  const totalSignatures = filtered.length;
  const uniqueCollaborators = new Set(filtered.map(r => r.collaborator_id)).size;
  const uniqueTrainings = new Set(filtered.map(r => r.training_type)).size;

  const formatDate = (d: string) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo'
    });
  };

  const isBase64 = (url: string) => url?.startsWith('data:image');

  const downloadSignature = async (record: SignatureRecord) => {
    const toastId = toast.loading('Baixando assinatura...');
    const { data } = await supabase.from('trainings_completed').select('signature_pdf_url').eq('id', record.id).single();
    
    if (!data?.signature_pdf_url) {
      toast.error('Assinatura não encontrada para este registro', { id: toastId });
      return;
    }
    
    toast.dismiss(toastId);
    const a = document.createElement('a');
    a.href = data.signature_pdf_url;
    a.download = `assinatura_${record.collaborator?.name ?? record.id}.png`;
    a.click();
  };

  const handleView = async (record: SignatureRecord) => {
    const toastId = toast.loading('Carregando assinatura...');
    const { data } = await supabase.from('trainings_completed').select('signature_pdf_url').eq('id', record.id).single();
    
    toast.dismiss(toastId);
    setViewing({ 
      ...record, 
      signature_pdf_url: data?.signature_pdf_url || null 
    });
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

  const exportToExcel = () => {
    if (filtered.length === 0) {
      toast.error('Nenhum registro para exportar.');
      return;
    }

    const data = filtered.map(r => ({
      'Colaborador': r.collaborator?.name ?? '—',
      'Cargo': r.collaborator?.role ?? '—',
      'Setor': r.collaborator?.sector ?? '—',
      'SOC': r.collaborator?.soc ?? '—',
      'Treinamento': r.training_type,
      'Instrutor': r.instructor_name ?? '—',
      'Data/Hora da Assinatura': formatDate(r.completed_at)
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Assinaturas");
    
    const colWidths = [
      { wch: 30 }, { wch: 25 }, { wch: 20 }, { wch: 10 }, { wch: 30 }, { wch: 25 }, { wch: 20 }
    ];
    ws['!cols'] = colWidths;

    XLSX.writeFile(wb, `relatorio_assinaturas_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const generateWhiteShopeeLogoBase64 = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    
    // Alça da sacola
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(60, 45, 18, Math.PI, 0);
    ctx.stroke();

    // Corpo da sacola
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(25, 45, 70, 60, 8);
    } else {
      ctx.fillRect(25, 45, 70, 60);
    }
    ctx.fill();

    // S (vazado simulado com a cor de fundo)
    ctx.fillStyle = '#EE4D2D';
    ctx.font = '900 46px "Arial Black", Arial';
    ctx.textAlign = 'center';
    ctx.fillText('S', 60, 92);

    // Texto Shopee
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'normal 68px "Arial", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Shopee', 110, 95);

    return canvas.toDataURL('image/png');
  };

  const exportToPDF = () => {
    if (filtered.length === 0) {
      toast.error('Nenhum registro para exportar.');
      return;
    }

    const doc = new jsPDF('landscape');
    const pageWidth = doc.internal.pageSize.width;

    // Cabeçalho Premium - Tema Claro com Faixa Laranja
    doc.setFillColor(238, 77, 45); // Laranja Shopee
    doc.rect(0, 0, pageWidth, 25, 'F');

    // Logo no canto superior direito
    try {
      const logoData = generateWhiteShopeeLogoBase64();
      if (logoData) {
        doc.addImage(logoData, 'PNG', pageWidth - 65, 4, 50, 15);
      }
    } catch (e) {
      console.error('Erro ao adicionar logo', e);
    }

    // Título dentro da faixa
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RELATÓRIO DE ASSINATURAS', 14, 16);

    // Linha fina abaixo do cabeçalho
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(14, 30, pageWidth - 14, 30);

    // Subtítulo e filtros
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const dateStr = new Date().toLocaleString('pt-BR');
    doc.text(`Gerado em: ${dateStr}`, 14, 36);
    doc.text(`Total: ${filtered.length} registros`, pageWidth - 14, 36, { align: 'right' });

    // Tabela
    const tableData = filtered.map(r => [
      r.collaborator?.name ?? '—',
      r.collaborator?.role ?? '—',
      r.collaborator?.sector ?? '—',
      r.collaborator?.soc ?? '—',
      r.training_type,
      r.instructor_name ?? '—',
      formatDate(r.completed_at)
    ]);

    autoTable(doc, {
      startY: 42,
      head: [['Colaborador', 'Cargo', 'Setor', 'SOC', 'Treinamento', 'Instrutor', 'Data/Hora']],
      body: tableData,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 4,
        textColor: [80, 80, 80],
        lineColor: [230, 230, 230],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [238, 77, 45], // #EE4D2D
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      alternateRowStyles: {
        fillColor: [254, 246, 245] // #FEF6F5
      },
      didDrawPage: (data) => {
        // Rodapé com número da página
        const str = `Página ${doc.internal.getNumberOfPages()}`;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        const pageSize = doc.internal.pageSize;
        const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
        doc.text(str, data.settings.margin.left, pageHeight - 10);
      }
    });

    doc.save(`relatorio_assinaturas_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            <PenTool size={20} className="text-[#EE4D2D]" /> Assinaturas Registradas
          </h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            {records.length} registro{records.length !== 1 ? 's' : ''} de treinamento com assinatura eletrônica no total
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            onClick={exportToPDF}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-[#EE4D2D] rounded-lg text-[13px] font-black uppercase tracking-widest hover:bg-[#FEF6F5] border-2 border-[#EE4D2D] transition-all shadow-sm"
          >
            <FileText size={16} /> Exportar PDF
          </button>
          <button
            onClick={exportToExcel}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[#217346] text-white rounded-lg text-[13px] font-black uppercase tracking-widest hover:brightness-110 transition-all shadow-sm"
          >
            <Download size={16} /> Exportar Excel
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-orange-50 rounded-lg">
            <PenTool className="text-[#EE4D2D]" size={20} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Total de Assinaturas</p>
            <p className="text-2xl font-black text-gray-900">{totalSignatures}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-blue-50 rounded-lg">
            <User className="text-blue-500" size={20} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Colaboradores Únicos</p>
            <p className="text-2xl font-black text-gray-900">{uniqueCollaborators}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-green-50 rounded-lg">
            <GraduationCap className="text-green-500" size={20} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Treinamentos Distintos</p>
            <p className="text-2xl font-black text-gray-900">{uniqueTrainings}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
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
            className="px-3 py-2.5 rounded-lg bg-white border border-gray-100 text-[12px] font-black text-gray-600 outline-none shadow-sm min-w-[140px]">
            <option value="ALL">Todas SOCs</option>
            {socOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Período:</span>
            <input 
              type="date" 
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="px-3 py-2.5 rounded-lg bg-white border border-gray-100 text-[12px] font-medium text-gray-600 outline-none shadow-sm"
            />
            <span className="text-gray-300">até</span>
            <input 
              type="date" 
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="px-3 py-2.5 rounded-lg bg-white border border-gray-100 text-[12px] font-medium text-gray-600 outline-none shadow-sm"
            />
          </div>

          <select value={instructorFilter} onChange={e => setInstructorFilter(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-white border border-gray-100 text-[12px] font-black text-gray-600 outline-none shadow-sm flex-1 min-w-[150px]">
            <option value="ALL">Todos Instrutores</option>
            {instructorOptions.map(i => <option key={i} value={i}>{i}</option>)}
          </select>

          <select value={trainingFilter} onChange={e => setTrainingFilter(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-white border border-gray-100 text-[12px] font-black text-gray-600 outline-none shadow-sm flex-1 min-w-[150px]">
            <option value="ALL">Todos Treinamentos</option>
            {trainingOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
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
                        <button
                          onClick={() => handleView(r)}
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
            {viewing.signature_pdf_url ? (
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
            ) : (
              <div className="p-4 text-center bg-gray-50 rounded-lg border border-gray-100">
                <p className="text-gray-400 text-xs font-bold">Sem imagem de assinatura registrada</p>
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
