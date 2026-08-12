import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { PenTool, Search, Eye, X, Download, Calendar, User, GraduationCap, Trash2, FileText, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface SignatureRecord {
  id: string;
  collaborator_id: string;
  training_type: string;
  instructor_name: string | null;
  completed_at: string;
  has_signature: boolean;
  collaborator?: {
    name: string;
    sector: string;
    soc: string;
    role: string;
  };
}

const PAGE_SIZE = 50;

// PostgREST usa vírgula e parênteses como separadores na sintaxe de or=(...).
// Sem isso, buscar por "Silva, João" ou similar quebra a query.
const sanitizeForFilter = (s: string) => s.replace(/[,()%]/g, ' ').trim();

export default function SignaturesPage() {
  const { profile, effectiveSoc } = useAuth();
  const userSoc = effectiveSoc;

  const [records, setRecords] = useState<SignatureRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [uniqueCollaborators, setUniqueCollaborators] = useState(0);
  const [uniqueTrainings, setUniqueTrainings] = useState(0);

  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<(SignatureRecord & { signature_pdf_url?: string | null }) | null>(null);
  const [socFilter, setSocFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [instructorFilter, setInstructorFilter] = useState('ALL');
  const [trainingFilter, setTrainingFilter] = useState('ALL');

  const [socOptions, setSocOptions] = useState<string[]>([]);
  const [instructorOptions, setInstructorOptions] = useState<string[]>([]);
  const [trainingOptions, setTrainingOptions] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // null = ainda não sabemos; true/false = resultado da 1ª tentativa de usar a view
  const viewAvailableRef = useRef<boolean | null>(null);

  // debounce da busca — evita refazer a query a cada tecla
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // volta pra página 1 sempre que um filtro muda
  useEffect(() => { setPage(0); }, [search, socFilter, startDate, endDate, instructorFilter, trainingFilter, userSoc]);

  const baseTable = (useView: boolean, cols: string) =>
    useView
      ? supabase.from('signatures_view').select(cols, { count: 'exact' })
      : supabase.from('trainings_completed').select(cols, { count: 'exact' });

  const applyFilters = useCallback((q: any, useView: boolean) => {
    const socCol = useView ? 'collaborator_soc' : 'collaborators.soc';
    const nameCol = useView ? 'collaborator_name' : 'collaborators.name';

    if (userSoc) q = q.eq(socCol, userSoc);
    if (socFilter !== 'ALL') q = q.eq(socCol, socFilter);
    if (instructorFilter !== 'ALL') q = q.eq('instructor_name', instructorFilter);
    if (trainingFilter !== 'ALL') q = q.eq('training_type', trainingFilter);
    if (startDate) q = q.gte('completed_at', `${startDate}T00:00:00`);
    if (endDate) q = q.lte('completed_at', `${endDate}T23:59:59`);

    if (search) {
      const s = sanitizeForFilter(search);
      if (s) {
        q = useView
          ? q.or(`${nameCol}.ilike.%${s}%,training_type.ilike.%${s}%,instructor_name.ilike.%${s}%`)
          // Sem a view (migração ainda não aplicada), a busca por nome do
          // colaborador fica indisponível — PostgREST não permite OR entre
          // coluna do recurso embutido e coluna da tabela base.
          : q.or(`training_type.ilike.%${s}%,instructor_name.ilike.%${s}%`);
      }
    }
    return q;
  }, [userSoc, socFilter, instructorFilter, trainingFilter, startDate, endDate, search]);

  const mapRow = (r: any, useView: boolean): SignatureRecord => useView
    ? {
        id: r.id, collaborator_id: r.collaborator_id, training_type: r.training_type,
        instructor_name: r.instructor_name, completed_at: r.completed_at, has_signature: !!r.has_signature,
        collaborator: { name: r.collaborator_name, sector: r.collaborator_sector, soc: r.collaborator_soc, role: r.collaborator_role },
      }
    : {
        id: r.id, collaborator_id: r.collaborator_id, training_type: r.training_type,
        instructor_name: r.instructor_name, completed_at: r.completed_at, has_signature: !!r.signature_pdf_url,
        collaborator: r.collaborators,
      };

  const isMissingRelation = (msg?: string) =>
    !!msg && (msg.includes('signatures_view') || msg.toLowerCase().includes('does not exist') || msg.includes('42P01') || msg.toLowerCase().includes('schema cache'));

  const fetchSignatures = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let useView = viewAvailableRef.current !== false;
      const viewCols = 'id, collaborator_id, training_type, instructor_name, completed_at, has_signature, collaborator_name, collaborator_sector, collaborator_soc, collaborator_role';
      const fallbackCols = 'id, collaborator_id, training_type, instructor_name, completed_at, signature_pdf_url, collaborators!inner(name, sector, soc, role)';

      const q = applyFilters(baseTable(useView, useView ? viewCols : fallbackCols), useView)
        .order('completed_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      let { data, error, count } = await q;

      if (error && useView && viewAvailableRef.current === null && isMissingRelation(error.message)) {
        // Migração da view ainda não foi rodada — cai para o join via embedding.
        useView = false;
        viewAvailableRef.current = false;
        const retryQ = applyFilters(baseTable(false, fallbackCols), false)
          .order('completed_at', { ascending: false })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        ({ data, error, count } = await retryQ);
      } else if (!error) {
        viewAvailableRef.current = useView;
      }

      if (error) throw error;

      setRecords((data ?? []).map((r: any) => mapRow(r, useView)));
      setTotalCount(count ?? 0);
    } catch (err: any) {
      console.error('[Assinaturas] Erro:', err?.message ?? err);
      setLoadError(err?.message || 'Não foi possível carregar as assinaturas. Tente novamente.');
      setRecords([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [applyFilters, page]);

  useEffect(() => { fetchSignatures(); }, [fetchSignatures]);

  // Contagens agregadas (colaboradores/treinamentos distintos) sobre TODO o
  // filtro atual, não só a página exibida. Colunas leves — nada de join pesado.
  useEffect(() => {
    let cancelled = false;
    const fetchAggregates = async () => {
      try {
        const useView = viewAvailableRef.current !== false;
        const cols = useView ? 'collaborator_id, training_type' : 'collaborator_id, training_type, collaborators!inner(soc)';
        let allRows: any[] = [];
        let from = 0;
        const limit = 1000;
        while (true) {
          const q = applyFilters(baseTable(useView, cols), useView).range(from, from + limit - 1);
          const { data, error } = await q;
          if (error) break;
          allRows = allRows.concat(data ?? []);
          if (!data || data.length < limit) break;
          from += limit;
        }
        if (cancelled) return;
        setUniqueCollaborators(new Set(allRows.map(r => r.collaborator_id)).size);
        setUniqueTrainings(new Set(allRows.map(r => r.training_type)).size);
      } catch {
        if (!cancelled) { setUniqueCollaborators(0); setUniqueTrainings(0); }
      }
    };
    fetchAggregates();
    return () => { cancelled = true; };
  }, [applyFilters]);

  // Opções dos filtros — não dependem da view, usam embedding direto.
  useEffect(() => {
    const fetchOptions = async () => {
      if (!userSoc) {
        const { data } = await supabase.from('socs').select('name').order('name');
        setSocOptions((data ?? []).map((s: any) => s.name));
      }
      const instQuery = supabase.from('instructors').select('name').order('name');
      const { data: inst } = userSoc ? await instQuery.eq('soc_name', userSoc) : await instQuery;
      setInstructorOptions([...new Set((inst ?? []).map((i: any) => i.name))].sort());

      // Treinamentos distintos: paginado, só a coluna de texto.
      let allTypes: string[] = [];
      let from = 0;
      const limit = 1000;
      while (true) {
        let q = supabase.from('trainings_completed').select('training_type, collaborators!inner(soc)').range(from, from + limit - 1);
        if (userSoc) q = q.eq('collaborators.soc', userSoc);
        const { data, error } = await q;
        if (error) break;
        allTypes = allTypes.concat((data ?? []).map((t: any) => t.training_type));
        if (!data || data.length < limit) break;
        from += limit;
      }
      setTrainingOptions([...new Set(allTypes.filter(Boolean))].sort());
    };
    fetchOptions();
  }, [userSoc]);

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
      if (viewing?.id === id) setViewing(null);
      fetchSignatures();
    }
  };

  // Usado pelas exportações — busca TODOS os registros do filtro atual
  // (não só a página exibida), paginando em lotes de 1000.
  const fetchAllFiltered = async (): Promise<SignatureRecord[]> => {
    const useView = viewAvailableRef.current !== false;
    const viewCols = 'id, collaborator_id, training_type, instructor_name, completed_at, has_signature, collaborator_name, collaborator_sector, collaborator_soc, collaborator_role';
    const fallbackCols = 'id, collaborator_id, training_type, instructor_name, completed_at, signature_pdf_url, collaborators!inner(name, sector, soc, role)';
    let all: any[] = [];
    let from = 0;
    const limit = 1000;
    while (true) {
      const q = applyFilters(baseTable(useView, useView ? viewCols : fallbackCols), useView)
        .order('completed_at', { ascending: false })
        .range(from, from + limit - 1);
      const { data, error } = await q;
      if (error) throw error;
      all = all.concat(data ?? []);
      if (!data || data.length < limit) break;
      from += limit;
    }
    return all.map(r => mapRow(r, useView));
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const all = await fetchAllFiltered();
      if (all.length === 0) {
        toast.error('Nenhum registro para exportar.');
        return;
      }
      const data = all.map(r => ({
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

      ws['!cols'] = [
        { wch: 30 }, { wch: 25 }, { wch: 20 }, { wch: 10 }, { wch: 30 }, { wch: 25 }, { wch: 20 }
      ];

      XLSX.writeFile(wb, `relatorio_assinaturas_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err: any) {
      toast.error('Erro ao exportar: ' + (err?.message ?? 'tente novamente'));
    } finally {
      setIsExporting(false);
    }
  };

  const generateWhiteShopeeLogoBase64 = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(60, 45, 18, Math.PI, 0);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(25, 45, 70, 60, 8);
    } else {
      ctx.fillRect(25, 45, 70, 60);
    }
    ctx.fill();

    ctx.fillStyle = '#EE4D2D';
    ctx.font = '900 46px "Arial Black", Arial';
    ctx.textAlign = 'center';
    ctx.fillText('S', 60, 92);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'normal 68px "Arial", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Shopee', 110, 95);

    return canvas.toDataURL('image/png');
  };

  const exportToPDF = async () => {
    setIsExporting(true);
    try {
      const all = await fetchAllFiltered();
      if (all.length === 0) {
        toast.error('Nenhum registro para exportar.');
        return;
      }

      const doc = new jsPDF('landscape');
      const pageWidth = doc.internal.pageSize.width;

      doc.setFillColor(238, 77, 45);
      doc.rect(0, 0, pageWidth, 25, 'F');

      try {
        const logoData = generateWhiteShopeeLogoBase64();
        if (logoData) {
          doc.addImage(logoData, 'PNG', pageWidth - 65, 4, 50, 15);
        }
      } catch (e) {
        console.error('Erro ao adicionar logo', e);
      }

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('RELATÓRIO DE ASSINATURAS', 14, 16);

      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(14, 30, pageWidth - 14, 30);

      doc.setTextColor(80, 80, 80);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const dateStr = new Date().toLocaleString('pt-BR');
      doc.text(`Gerado em: ${dateStr}`, 14, 36);
      doc.text(`Total: ${all.length} registros`, pageWidth - 14, 36, { align: 'right' });

      const tableData = all.map(r => [
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
          fillColor: [238, 77, 45],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9,
        },
        alternateRowStyles: {
          fillColor: [254, 246, 245]
        },
        didDrawPage: (data) => {
          const str = `Página ${doc.getNumberOfPages()}`;
          doc.setFontSize(8);
          doc.setTextColor(150, 150, 150);
          const pageSize = doc.internal.pageSize;
          const pageHeight = pageSize.height ? pageSize.height : (pageSize as any).getHeight();
          doc.text(str, data.settings.margin.left, pageHeight - 10);
        }
      });

      doc.save(`relatorio_assinaturas_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err: any) {
      toast.error('Erro ao exportar: ' + (err?.message ?? 'tente novamente'));
    } finally {
      setIsExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rangeStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(totalCount, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            <PenTool size={20} className="text-[#EE4D2D]" /> Assinaturas Registradas
          </h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            {totalCount} registro{totalCount !== 1 ? 's' : ''} de treinamento com assinatura eletrônica {userSoc ? `na unidade ${userSoc}` : 'no total'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            onClick={exportToPDF}
            disabled={isExporting}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-[#EE4D2D] rounded-lg text-[13px] font-black uppercase tracking-widest hover:bg-[#FEF6F5] border-2 border-[#EE4D2D] transition-all shadow-sm disabled:opacity-50"
          >
            <FileText size={16} /> Exportar PDF
          </button>
          <button
            onClick={exportToExcel}
            disabled={isExporting}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[#217346] text-white rounded-lg text-[13px] font-black uppercase tracking-widest hover:brightness-110 transition-all shadow-sm disabled:opacity-50"
          >
            <Download size={16} /> Exportar Excel
          </button>
        </div>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">Não foi possível carregar as assinaturas</p>
            <p className="text-xs text-red-600 mt-0.5">{loadError}</p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-orange-50 rounded-lg">
            <PenTool className="text-[#EE4D2D]" size={20} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Total de Assinaturas</p>
            <p className="text-2xl font-black text-gray-900">{totalCount}</p>
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
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Buscar por colaborador, treinamento ou instrutor..."
              className="w-full pl-11 pr-4 py-2.5 rounded-lg bg-white border border-gray-100 text-gray-800 text-[13px] font-medium outline-none focus:ring-2 focus:ring-[#EE4D2D]/10 shadow-sm transition-all"
            />
          </div>
          {!userSoc && (
            <select value={socFilter} onChange={e => setSocFilter(e.target.value)}
              className="px-3 py-2.5 rounded-lg bg-white border border-gray-100 text-[12px] font-black text-gray-600 outline-none shadow-sm min-w-[140px]">
              <option value="ALL">Todas SOCs</option>
              {socOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
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
        ) : records.length === 0 ? (
          <div className="p-12 text-center">
            <PenTool size={36} className="mx-auto mb-3 text-gray-200" />
            <p className="text-gray-400 text-sm">{loadError ? 'Falha ao carregar registros.' : 'Nenhuma assinatura registrada ainda.'}</p>
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
                {records.map(r => (
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

        {!loading && totalCount > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              {rangeStart}–{rangeEnd} de {totalCount}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg bg-white border border-gray-100 text-gray-500 disabled:opacity-30 hover:text-[#EE4D2D] transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-[11px] font-black text-gray-600">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
                disabled={page + 1 >= totalPages}
                className="p-1.5 rounded-lg bg-white border border-gray-100 text-gray-500 disabled:opacity-30 hover:text-[#EE4D2D] transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
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
