import { useEffect, useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Upload, Download, Trash2, Search, Edit2, Users, UserCheck, Crown, Percent, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { parseDelimitedText, mapCollaboratorRow, mapLeaderRow } from '@/lib/csvParser';

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
  bpo?: string;
  is_onboarding?: boolean;
  admission_date?: string;
  activity?: string;
  /** E-mail corporativo. Nos líderes é a chave que liga ao time. */
  email?: string | null;
  /** Marca líderes — substitui a antiga adivinhação pelo texto do cargo. */
  is_leader?: boolean;
  /** Vínculo resolvido com a linha do líder (ver resolve_leader_links no banco). */
  leader_id?: string | null;
  /** Calculado no banco pela view collaborators_status. */
  is_trained: boolean;
  /** Tipos de treinamento de onboarding já assinados, em MAIÚSCULAS. */
  onboarding_modules: string[];
}

const emptyForm = { name: '', opsid: '', gender: '', soc: '', sector: '', shift: '', leader: '', role: '', bpo: '', is_onboarding: false, admission_date: '', activity: '', email: '' };
const EMPTY_COLLABS: Collaborator[] = [];

/** Colunas da aba Líderes — as mesmas do modelo de importação, nesta ordem. */
const LEADER_COLUMNS = ['Nome', 'E-mail', 'Setor', 'Atividade', 'Turno', 'Gestor', 'SOC', 'Status'] as const;
// A busca da planilha do Google Sheets roda agora na Edge Function
// sync-collaborators (server-side) — ver supabase/functions/sync-collaborators.

export default function CollaboratorsPage() {
  const { isMaster, isAdmin, isBpo, loading: authLoading, effectiveSoc } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedSoc, setSelectedSoc] = useState('');
  const [selectedLeader, setSelectedLeader] = useState('');
  const [selectedShift, setSelectedShift] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'trained' | 'pending'>('all');
  const [currentTab, setCurrentTab] = useState<'ativos' | 'onboarding' | 'lideres'>(isBpo ? 'onboarding' : 'ativos');
  const isSyncing = useRef(false); // Guard against concurrent syncs

  // Onboarding extra filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onboardingModuleFilter, setOnboardingModuleFilter] = useState<Set<string>>(new Set());
  const [moduleDropdownOpen, setModuleDropdownOpen] = useState(false);
  const moduleDropdownRef = useRef<HTMLDivElement>(null);

  // Mapping of onboarding training types to badge initials
  const ONBOARDING_MODULES = [
    { key: 'HSE',         initial: 'H', label: 'Onboarding HSE',         color: 'bg-red-100 text-red-600 border-red-200' },
    { key: 'MEIO',        initial: 'M', label: 'Onboarding Meio Ambiente', color: 'bg-green-100 text-green-600 border-green-200' },
    { key: 'SECURITY',    initial: 'S', label: 'Onboarding Security',     color: 'bg-blue-100 text-blue-600 border-blue-200' },
    { key: 'QUALIDADE',   initial: 'Q', label: 'Onboarding Qualidade',    color: 'bg-amber-100 text-amber-600 border-amber-200' },
    { key: 'PEOPLE',      initial: 'R', label: 'Onboarding People',       color: 'bg-purple-100 text-purple-600 border-purple-200' },
    { key: 'PTS',         initial: 'P', label: 'Onboarding PTS',          color: 'bg-cyan-100 text-cyan-600 border-cyan-200' },
  ] as const;

  // Os módulos já vêm agregados do banco (collaborators_status.onboarding_modules),
  // então isto é só leitura de memória — não custa mais uma consulta por linha.
  const getCompletedModules = (c: Collaborator) => {
    const done = c.onboarding_modules ?? [];
    return ONBOARDING_MODULES.map(m => ({
      ...m,
      done: done.some(t => t.includes('ONBOARDING') && t.includes(m.key)),
    }));
  };

  const handleChange = (key: keyof typeof form, value: string) => {
    let val = value.toUpperCase();
    if (key === 'gender' || key === 'name' || key === 'sector' || key === 'leader' || key === 'role') {
      // Permite apóstrofo e hífen — sem isso "D'ÁVILA" virava "DÁVILA" e
      // "SANTA-RITA" virava "SANTARITA".
      val = val.replace(/[^A-ZÀ-ÖØ-öø-ÿ\s'-]/g, '');
    } else if (key === 'opsid') {
      val = val.replace(/[^A-Z0-9]/g, '');
    } else if (key === 'soc') {
      val = val.replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]+)0([0-9]+)$/, '$1$2').slice(0, 3);
    } else if (key === 'shift') {
      val = val.replace(/[^A-Z0-9]/g, '').slice(0, 3);
      if (val.length > 0 && val[0] !== 'T') {
        val = 'T' + val.substring(0, 2);
      }
    }
    setForm(prev => ({ ...prev, [key]: val }));
  };

  // ── Fetch escopado pela unidade em foco ──────────────────────────────
  // Para quem não é master, effectiveSoc é sempre a própria SOC. Para o
  // master, é o que estiver escolhido no seletor do topo — e `null` quer
  // dizer "todas as unidades".
  //
  // A fonte é a view collaborators_status, não a tabela: ela já traz
  // is_trained e os módulos de onboarding calculados no banco. Antes a tela
  // baixava TODOS os registros de treinamento em lotes de 150 ids (~15
  // requisições para SP6, e mais de 130 se fosse ver todas as unidades)
  // só para calcular esses dois campos no navegador.
  const { data: queryData, isLoading: dataLoading, refetch } = useQuery({
    queryKey: ['collaborators', effectiveSoc],
    enabled: !authLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const allCollabs: Collaborator[] = [];
      let page = 0; const limit = 1000; let hasMore = true;
      while (hasMore) {
        let q = supabase
          .from('collaborators_status')
          .select('id, name, opsid, gender, soc, sector, shift, leader, role, bpo, is_onboarding, admission_date, activity, email, is_leader, leader_id, is_trained, onboarding_modules')
          .order('name')
          .range(page * limit, (page + 1) * limit - 1);
        if (effectiveSoc) q = q.eq('soc', effectiveSoc);
        const { data, error } = await q;
        if (error) throw error;
        if (data && data.length > 0) { allCollabs.push(...(data as Collaborator[])); if (data.length < limit) hasMore = false; else page++; }
        else hasMore = false;
      }
      return { collaborators: allCollabs };
    },
  });

  // Referência estável (não um [] novo a cada render) — evita que os useMemo
  // abaixo recalculem à toa enquanto a query ainda está carregando.
  const collaborators = queryData?.collaborators ?? EMPTY_COLLABS;
  const fetchData = () => refetch();

  // Sem memo, essas 3 listas e o filtro abaixo eram recalculados a cada
  // tecla digitada na busca.
  const uniqueSocs = useMemo(() => Array.from(new Set(collaborators.map(c => c.soc).filter(Boolean))).sort(), [collaborators]);
  const uniqueLeaders = useMemo(() => Array.from(new Set(collaborators.map(c => c.leader).filter(Boolean))).sort(), [collaborators]);
  const uniqueShifts = useMemo(() => Array.from(new Set(collaborators.map(c => c.shift).filter(Boolean))).sort(), [collaborators]);

  // Fecha o dropdown de módulos ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moduleDropdownRef.current && !moduleDropdownRef.current.contains(e.target as Node)) {
        setModuleDropdownOpen(false);
      }
    };
    if (moduleDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moduleDropdownOpen]);


  // A sincronização em si roda no servidor (Edge Function sync-collaborators,
  // agendada às 05h via pg_cron — ver supabase/migrations/20260811_02_*.sql).
  // Este botão só dispara a MESMA função sob demanda; a trava de concorrência
  // agora é uma linha na tabela sync_locks, então funciona certo mesmo com
  // vários admins clicando ao mesmo tempo em navegadores diferentes.
  const handleGSheetSync = async () => {
    // Exclusivo do master, e não por preferência de interface: a
    // sincronização é GLOBAL — lê a planilha inteira e escreve e remove em
    // todas as unidades de uma vez. Um admin de SP6 disparando isto mexe em
    // ES2, RS2 e em todas as outras. A mesma regra é verificada dentro da
    // Edge Function, que é o que realmente vale — esconder o botão não
    // impede ninguém de chamar a função pelo console do navegador.
    if (!isMaster) return;
    if (isSyncing.current) {
      toast.info('Já existe uma sincronização em andamento.');
      return;
    }
    isSyncing.current = true;
    const toastId = toast.loading('Sincronizando com Google Sheets...');
    try {
      const { data, error } = await supabase.functions.invoke('sync-collaborators', { body: { source: 'manual' } });
      if (error) {
        // O supabase-js transforma qualquer resposta não-2xx num FunctionsHttpError
        // com a mensagem genérica "Edge Function returned a non-2xx status code",
        // e guarda a resposta de verdade em `error.context`. Sem ler isso, a tela
        // engolia o motivo — "sessão inválida", "apenas master pode sincronizar",
        // "planilha vazia" — e todos apareciam como o mesmo erro sem sentido.
        const ctx = (error as { context?: Response }).context;
        let detalhe = '';
        try {
          const corpo = await ctx?.clone().json();
          detalhe = corpo?.error ?? '';
        } catch {
          try { detalhe = (await ctx?.clone().text()) ?? ''; } catch { /* corpo ilegível */ }
        }
        const status = ctx?.status ? ` (HTTP ${ctx.status})` : '';
        throw new Error((detalhe || error.message) + status);
      }
      if (data?.error) throw new Error(data.error);
      if (data?.skipped) {
        // "desligada" é diferente de "já rodando": a primeira exige alguém
        // religar de propósito, a segunda passa sozinha em minutos.
        if (data.disabled) {
          toast.warning(`Sincronização desligada. ${data.reason ?? ''}`, { id: toastId, duration: 15000 });
        } else {
          toast.info(data.reason || 'Sincronização já em andamento.', { id: toastId });
        }
        return;
      }
      // Erros de gravação NÃO podem passar despercebidos: no incidente de
      // 11/08 a tela mostrou "concluída, 0 removidos" enquanto a maior parte
      // dos lotes falhava e a base era esvaziada por baixo.
      if (data?.errors?.length) {
        console.error('[Sync] Erros de gravação:', data.errors);
        toast.error(
          `Sincronização com falhas: ${data.errors.length} lote(s) não gravaram. ` +
          (data.deletionSkipped ? 'Nenhum colaborador foi removido. ' : '') +
          'Veja o console para o detalhe.',
          { id: toastId, duration: 15000 }
        );
      } else if (data?.deletionSkipped) {
        toast.warning(`${data.upserted} atualizados/inseridos. ${data.deletionSkipped}`, { id: toastId, duration: 12000 });
      } else {
        toast.success(`Sincronização concluída! ${data.upserted} atualizados/inseridos, ${data.removed} removidos.`, { id: toastId });
      }
      localStorage.setItem('last_gsheet_sync', new Date().toISOString());
      queryClient.invalidateQueries({ queryKey: ['collaborators'] });
    } catch (err: any) {
      toast.error('Erro na sincronização: ' + (err?.message || 'Erro desconhecido'), { id: toastId });
    } finally {
      isSyncing.current = false;
    }
  };


  // A regra de "treinado" vive agora no banco, na função
  // training_matches_collaborator, usada pela view collaborators_status
  // (ver supabase/migrations/20260812_04). É a MESMA lógica que rodava
  // aqui, portada linha por linha — se mudar em um lado, mude no outro.
  const isTrained = (c: Collaborator) => c.is_trained === true;

  // Sem memo, esse filtro (que chama isTrained por colaborador) rodava de
  // novo a cada tecla digitada na busca, cada clique de filtro e cada
  // re-render.
  const filtered = useMemo(() => collaborators.filter(c => {
    // Aba atual. Líder é quem tem a flag is_leader — antes era adivinhado
    // pelo texto do cargo ("contém LÍDER/GERENTE/..."), e como só 2 pessoas
    // na base inteira tinham esse cargo, a aba Líderes vivia vazia.
    const isEmOnboarding = c.is_onboarding === true;
    const isLider = c.is_leader === true;

    if (currentTab === 'lideres' && !isLider) return false;
    if (currentTab !== 'lideres' && isLider) return false;

    if (currentTab === 'ativos' && isEmOnboarding) return false;
    if (currentTab === 'onboarding' && !isEmOnboarding) return false;

    const norm = (s: string) => s ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : '';
    const normSoc = (s: string) => s ? s.toUpperCase().replace(/^([A-Z]+)0([0-9]+)$/, '$1$2') : '';
    
    const searchNormalized = norm(search);
    const matchSearch = norm(c.name).includes(searchNormalized) ||
      norm(c.opsid ?? '').includes(searchNormalized) ||
      normSoc(c.soc).includes(searchNormalized) ||
      norm(c.email ?? '').includes(searchNormalized) ||
      norm(c.sector || '').includes(searchNormalized);
    
    const userSoc = normSoc(c.soc);
    // Rede de segurança: a consulta já vem escopada por effectiveSoc. Com o
    // master vendo todas as unidades, effectiveSoc é nulo e nada é filtrado
    // aqui — que é justamente o comportamento desejado.
    const mySoc = normSoc(effectiveSoc ?? '');
    if (mySoc && userSoc !== mySoc) return false;

    const matchSoc = selectedSoc ? userSoc === normSoc(selectedSoc) : true;
    const matchLeader = selectedLeader ? c.leader === selectedLeader : true;
    const matchShift = selectedShift ? c.shift === selectedShift : true;
    
    // Status Filter
    if (statusFilter !== 'all') {
      const trained = isTrained(c);
      if (statusFilter === 'trained' && !trained) return false;
      if (statusFilter === 'pending' && trained) return false;
    }

    // Onboarding-only: date range filter
    if (currentTab === 'onboarding' && (dateFrom || dateTo)) {
      if (!c.admission_date) return false;
      if (dateFrom && c.admission_date < dateFrom) return false;
      if (dateTo   && c.admission_date > dateTo)   return false;
    }

    // Onboarding-only: multi-module filter (mostra quem NÃO assinou nos módulos selecionados)
    if (currentTab === 'onboarding' && onboardingModuleFilter.size > 0) {
      const modules = getCompletedModules(c);
      // Colaborador aparece se tiver pelo menos 1 módulo selecionado pendente
      const hasPending = Array.from(onboardingModuleFilter).some(key => {
        const mod = modules.find(m => m.key === key);
        return mod && !mod.done;
      });
      if (!hasPending) return false;
    }
    
    return matchSearch && matchSoc && matchLeader && matchShift;
  }), [collaborators, currentTab, search, selectedSoc, selectedLeader, selectedShift, statusFilter, dateFrom, dateTo, onboardingModuleFilter, effectiveSoc]);

  const displayTotal = filtered.length;

  // Paginação da RENDERIZAÇÃO — a busca já filtra "filtered" por inteiro antes
  // de paginar, então o resultado aparece não importa em qual página estaria.
  // (O mesmo bug existia na tela de Assinaturas: paginar a QUERY sem também
  // fazer a busca no servidor faz a busca só olhar a página carregada.)
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [search, selectedSoc, selectedLeader, selectedShift, statusFilter, currentTab, dateFrom, dateTo, onboardingModuleFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedList = useMemo(() => filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [filtered, page]);

  // Líderes CADASTRADOS na unidade (flag is_leader), não nomes distintos
  // digitados no campo "Líder" — este card contava texto livre, e como o
  // mesmo líder aparece ora como e-mail ora como nome, o número não
  // significava quantos líderes existem.
  const totalLeaders = useMemo(
    () => collaborators.filter(c => c.is_leader).length,
    [collaborators]
  );

  const uniqueTrained = useMemo(() => filtered.filter(c => isTrained(c)).length, [filtered]);
  const trainedPct = displayTotal > 0 ? Math.round((uniqueTrained / displayTotal) * 100) : 0;

  const handleSave = async () => {
    const isLeaderForm = currentTab === 'lideres';
    const payload: Record<string, unknown> = { ...form, is_leader: isLeaderForm };
    if (!payload.admission_date) {
      delete payload.admission_date;
    }
    // O e-mail é a chave do vínculo com o time — guardar em minúsculo evita
    // que "Maria.Souza@" e "maria.souza@" virem dois líderes diferentes.
    payload.email = (form.email || '').trim().toLowerCase() || null;

    if (isLeaderForm) {
      // Um líder não tem cargo/turno obrigatórios no cadastro; o que não pode
      // faltar é o e-mail, senão o time dele não é vinculado automaticamente.
      if (!form.name || !form.soc || !form.email) {
        toast.error('Preencha nome, e-mail e SOC do líder.'); return;
      }
    } else if (form.is_onboarding) {
       if (!form.name || !form.soc || !form.role) {
         toast.error('Preencha nome completo, cargo e SOC no Onboarding!'); return;
       }
    } else {
       if (!form.name || !form.soc || !form.sector || !form.shift || !form.role) {
         toast.error('Preencha todos os campos obrigatórios'); return;
       }
    }
    try {
      if (editingId) {
        const { error } = await supabase.from('collaborators').update(payload).eq('id', editingId);
        if (error) { toast.error('Erro: ' + error.message); return; }
        toast.success('Colaborador atualizado');
      } else {
        const { error } = await supabase.from('collaborators').insert(payload);
        if (error) { toast.error('Erro: ' + error.message); return; }
        toast.success('Colaborador cadastrado');
      }
      setForm(emptyForm);
      setShowForm(false);
      setEditingId(null);
      fetchData();
    } catch (err: any) {
      toast.error('Erro crítico: Verifique sua conexão ou permissões no banco.');
    }
  };

  const startEdit = (c: Collaborator) => {
    setForm({ 
       name: c.name, 
       opsid: c.opsid ?? '', 
       gender: c.gender ?? '', 
       soc: c.soc, 
       sector: c.sector ?? '', 
       shift: c.shift ?? '', 
       leader: c.leader ?? '', 
       role: c.role,
       bpo: c.bpo ?? '',
       is_onboarding: !!c.is_onboarding,
       admission_date: c.admission_date ?? '',
       activity: c.activity ?? '',
       email: c.email ?? ''
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este colaborador?')) return;
    await supabase.from('collaborators').delete().eq('id', id);
    fetchData();
    toast.success('Colaborador removido');
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Tem certeza que deseja excluir ${selectedIds.size} colaboradores? Esta ação não pode ser desfeita.`)) return;

    // Delete in chunks of 100 since there might be many
    const idsArray = Array.from(selectedIds);
    let deletedCount = 0;
    let hasError = false;

    // Show loading toast
    const toastId = toast.loading(`Excluindo ${idsArray.length} colaboradores...`);

    try {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < idsArray.length; i += CHUNK_SIZE) {
        const chunk = idsArray.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from('collaborators').delete().in('id', chunk);
        if (error) {
          console.error('[Bulk Delete Error]', error);
          hasError = true;
        } else {
          deletedCount += chunk.length;
        }
      }

      fetchData();
      setSelectedIds(new Set());
      
      if (hasError) {
        toast.error(`Foram excluídos ${deletedCount} colaboradores, mas ocorreram alguns erros.`, { id: toastId });
      } else {
        toast.success(`${deletedCount} colaboradores excluídos com sucesso.`, { id: toastId });
      }
    } catch (err) {
      toast.error('Erro crítico na exclusão em massa.', { id: toastId });
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const { header, rows: rawRows } = parseDelimitedText(text);

      if (rawRows.length === 0) {
        toast.error('CSV vazio ou sem dados além do cabeçalho.');
        e.target.value = '';
        return;
      }
      console.log('[CSV] Cabeçalho detectado:', header);

      // ── Importação de LÍDERES ────────────────────────────────
      // Caminho próprio, porque as colunas são outras (E-mail e Gestor no
      // lugar de OPSID/Gênero/BPO/Cargo) e porque, no fim, é preciso pedir
      // ao banco para religar os times — resolve_leader_links() casa o texto
      // livre de collaborators.leader com o e-mail (ou nome) dos líderes.
      if (currentTab === 'lideres') {
        const leaders = rawRows
          .map(cells => mapLeaderRow(cells, header))
          .filter(l => l.name && l.name.length > 1);

        if (leaders.length === 0) {
          toast.error('Nenhum líder válido encontrado. Verifique se o arquivo segue o modelo.');
          e.target.value = '';
          return;
        }

        const semEmail = leaders.filter(l => !l.email).length;
        let inseridos = 0, atualizados = 0, ultimoErro = '';

        for (const l of leaders) {
          const payload = {
            name: l.name,
            email: l.email || null,
            sector: l.sector,
            activity: l.activity,
            shift: l.shift,
            leader: l.leader, // na linha de um líder, "leader" é o GESTOR dele
            soc: l.soc,
            is_leader: true,
            is_onboarding: false,
          };
          // Já cadastrado? Casa por e-mail; sem e-mail, por nome + unidade.
          const existente = collaborators.find(c =>
            (l.email && (c.email ?? '').toLowerCase() === l.email) ||
            (!l.email && c.name.trim().toUpperCase() === l.name.trim().toUpperCase() && c.soc === l.soc)
          );
          const { error } = existente
            ? await supabase.from('collaborators').update(payload).eq('id', existente.id)
            : await supabase.from('collaborators').insert(payload);

          if (error) { ultimoErro = error.message; console.error('[CSV líderes]', error); }
          else if (existente) atualizados++;
          else inseridos++;
        }

        const { data: vinculados, error: rpcErr } = await supabase.rpc('resolve_leader_links');
        if (rpcErr) console.error('[CSV líderes] resolve_leader_links falhou:', rpcErr);

        let msg = '';
        if (inseridos > 0) msg += `✓ ${inseridos} líder(es) cadastrado(s). `;
        if (atualizados > 0) msg += `✓ ${atualizados} atualizado(s). `;
        if (typeof vinculados === 'number') msg += `${vinculados} colaborador(es) vinculado(s) ao líder.`;
        if (msg) toast.success(msg, { duration: 10000 });
        if (semEmail > 0) {
          toast.warning(
            `${semEmail} líder(es) sem e-mail — o time deles só será vinculado se o nome bater exatamente com o que está no campo Líder dos colaboradores.`,
            { duration: 12000 }
          );
        }
        if (ultimoErro) toast.error(`Alguns registros falharam: ${ultimoErro}`);
        fetchData();
        e.target.value = '';
        return;
      }

      const isUploadingToOnboarding = currentTab === 'onboarding';

      const rows = rawRows.map(cells => {
        const mapped = mapCollaboratorRow(cells, header);
        const row: any = { ...mapped };
        // Sem data de admissão informada, onboarding assume hoje (horário de Brasília).
        if (!row.admission_date) {
          if (isUploadingToOnboarding) {
            const localDate = new Date(Date.now() - 3 * 60 * 60 * 1000); // UTC-3
            row.admission_date = localDate.toISOString().split('T')[0];
          } else {
            delete row.admission_date;
          }
        }
        return row;
      }).filter(r => r.name && r.name.length > 1);

      console.log(`[CSV] ${rows.length} linha(s) válida(s) encontradas`);

      if (rows.length === 0) {
        toast.error('Nenhum colaborador válido encontrado. Verifique se o arquivo segue o modelo.');
        e.target.value = '';
        return;
      }

      const onboardings = collaborators.filter(c => c.is_onboarding);

      let totalInserted = 0;
      let totalUpdated = 0;
      let lastError = '';
      const BATCH = 50;

      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        
        const toInsert = [];
        for (const row of batch) {
          if (!isUploadingToOnboarding) {
            // WE ARE UPLOADING OFFICIAL ABS DATA. Try matching against onboarding!
            const matched = onboardings.find(o => o.name.trim().toUpperCase() === row.name.toUpperCase());
            if (matched) {
               const { error } = await supabase.from('collaborators').update({
                  ...row,
                  is_onboarding: false
               }).eq('id', matched.id);
               if (error) { lastError = error.message; console.error(error); }
               else totalUpdated++;
               continue;
            }
          }
          toInsert.push({ 
            ...row, 
            is_onboarding: isUploadingToOnboarding,
          });
        }

        if (toInsert.length > 0) {
          const { error } = await supabase.from('collaborators').insert(toInsert);
          if (error) {
            lastError = error.message;
            console.error('[CSV] Erro no batch:', error);
          } else {
            totalInserted += toInsert.length;
          }
        }
      }

      if (totalInserted > 0 || totalUpdated > 0) {
        let msg = '';
        if (totalInserted > 0) msg += `✓ ${totalInserted} importados. `;
        if (totalUpdated > 0) msg += `✓ ${totalUpdated} migrados do Onboarding para Ativo!`;
        toast.success(msg);
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
    // O modelo de líderes segue exatamente as colunas da aba. O E-MAIL é o
    // campo que faz o vínculo com o time: ele casa com o que está escrito no
    // campo "Líder" dos colaboradores (411 dos 659 valores de lá já são
    // e-mail). Sem e-mail, o vínculo só sai se o NOME bater exatamente.
    const modelos = {
      lideres: {
        csv: 'Nome;E-mail;Setor;Atividade;Turno;Gestor;SOC\nMARIA SOUZA;maria.souza@shopee.com;RECEBIMENTO;Inbound | Docas LH;T3;CARLOS LIMA;SP6',
        arquivo: 'modelo_lideres.csv',
      },
      onboarding: {
        csv: 'Gênero;Colaborador;Data de Admissão;BPO;Cargo;SOC\nFEMININO;VIVIAN KAROLINE;27/04/2026;GI Group;AUXILIAR DE LOGISTICA;SP6',
        arquivo: 'modelo_onboarding.csv',
      },
      ativos: {
        csv: 'OPSID;Gênero;Colaborador;Turno;Setor;Líder;Cargo;SOC\n001;MASCULINO;JOÃO SILVA;T1;RECEBIMENTO;CARLOS;OPERADOR LOGISTICO;SP6',
        arquivo: 'modelo_colaboradores.csv',
      },
    } as const;

    const modelo = modelos[currentTab];
    const blob = new Blob([bom + modelo.csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = modelo.arquivo;

    a.click();
  };

  const fields: { key: Exclude<keyof typeof emptyForm, 'is_onboarding'>; label: string }[] = currentTab === 'lideres'
    ? [
        { key: 'name', label: 'Nome' },
        { key: 'email', label: 'E-mail' },
        { key: 'sector', label: 'Setor' },
        { key: 'activity', label: 'Atividade' },
        { key: 'shift', label: 'Turno' },
        { key: 'leader', label: 'Gestor' },
        { key: 'soc', label: 'SOC' },
      ]
    : currentTab === 'onboarding'
    ? [
        { key: 'opsid', label: 'OPSID' },
        { key: 'gender', label: 'Gênero' },
        { key: 'name', label: 'Colaborador' },
        { key: 'admission_date', label: 'Data de Admissão' },
        { key: 'role', label: 'Cargo' },
        { key: 'soc', label: 'SOC' },
      ]
    : [
        { key: 'opsid', label: 'OPSID' },
        { key: 'gender', label: 'Gênero' },
        { key: 'name', label: 'Colaborador' },
        { key: 'bpo', label: 'BPO' },
        { key: 'shift', label: 'Turno' },
        { key: 'sector', label: 'Setor' },
        { key: 'leader', label: 'Líder' },
        { key: 'role', label: 'Cargo' },
        { key: 'activity', label: 'Atividade' },
        { key: 'soc', label: 'SOC' },
      ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div>
          {!isBpo && (
            <div className="flex items-center gap-4 mb-4 border-b border-gray-100 overflow-x-auto">
              <button 
                onClick={() => { setCurrentTab('ativos'); setSelectedIds(new Set()); }}
                className={`pb-2 px-1 text-sm font-bold uppercase tracking-widest transition-colors border-b-4 whitespace-nowrap ${currentTab === 'ativos' ? 'border-[#EE4D2D] text-[#EE4D2D]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                Base Ativa
              </button>
              <button 
                onClick={() => { setCurrentTab('onboarding'); setSelectedIds(new Set()); }}
                className={`pb-2 px-1 text-sm font-bold uppercase tracking-widest transition-colors border-b-4 whitespace-nowrap ${currentTab === 'onboarding' ? 'border-[#EE4D2D] text-[#EE4D2D]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                Em Onboarding
              </button>
              <button 
                onClick={() => { setCurrentTab('lideres'); setSelectedIds(new Set()); }}
                className={`pb-2 px-1 text-sm font-bold uppercase tracking-widest transition-colors border-b-4 whitespace-nowrap ${currentTab === 'lideres' ? 'border-[#EE4D2D] text-[#EE4D2D]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                Líderes
              </button>
            </div>
          )}
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">
            {currentTab === 'ativos' ? 'Colaboradores Ativos' : currentTab === 'onboarding' ? 'Integração Onboarding' : 'Líderes & Instrutores'}
          </h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">{displayTotal} funcionários nesta aba</p>
        </div>
        {(isAdmin || isBpo) && (
          <div className="flex gap-2 flex-wrap items-center">
            {selectedIds.size > 0 && isAdmin && (
              <button 
                onClick={handleBulkDelete} 
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 text-red-600 text-[10px] font-black uppercase tracking-wider hover:bg-red-100 transition-all shadow-sm"
              >
                <Trash2 size={14} /> Excluir {selectedIds.size}
              </button>
            )}
            <button onClick={downloadTemplate} className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-50 text-gray-700 text-[10px] font-black uppercase tracking-wider hover:bg-gray-100 transition-colors border border-gray-200">
              <Download size={14} /> Modelo
            </button>
            <label className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-50 text-gray-700 text-[10px] font-black uppercase tracking-wider hover:bg-gray-100 transition-colors border border-gray-200 cursor-pointer">
              <Upload size={14} /> Importar
              <input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
            </label>
            {/* Só o master. A sincronização atinge TODAS as unidades de uma
                vez, então nunca foi uma ação de escopo local. */}
            {isMaster && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleGSheetSync()}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#EE4D2D]/10 text-[#EE4D2D] text-[10px] font-black uppercase tracking-wider hover:bg-[#EE4D2D]/20 transition-all border border-[#EE4D2D]/20"
                    title="Atualiza os colaboradores de TODAS as unidades a partir da planilha. Já roda sozinho todo dia às 05h — use aqui só para forçar agora."
                  >
                    <RefreshCw size={14} /> Sincronizar Sheets
                  </button>
                </div>
                <span className="text-[7px] font-bold text-gray-400 uppercase mr-2">
                  Todas as unidades • diária às 05h
                  {localStorage.getItem('last_gsheet_sync') && ` • Última manual: ${new Date(localStorage.getItem('last_gsheet_sync')!).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`}
                </span>
              </div>
            )}
            <button 
              onClick={() => { setForm({ ...emptyForm, is_onboarding: currentTab === 'onboarding' }); setEditingId(null); setShowForm(true); }} 
              className="flex items-center gap-2 px-5 py-2 rounded-full shopee-gradient-bg text-white text-[10px] font-black uppercase tracking-widest hover:brightness-110 shadow-md active:scale-95 transition-all"
            >
              <Plus size={16} /> Novo Registro
            </button>
          </div>
        )}
      </div>

      {/* Summary Cards - More Compact */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Users, label: 'Total Geral', value: displayTotal, color: 'text-blue-500', bg: 'bg-blue-50' },
          { icon: Crown, label: 'Líderes', value: totalLeaders, color: 'text-amber-500', bg: 'bg-amber-50' },
          { icon: UserCheck, label: 'Treinados', value: uniqueTrained, color: 'text-emerald-500', bg: 'bg-emerald-50' },
          { icon: Percent, label: '% Certificação', value: `${trainedPct}%`, color: 'text-[#EE4D2D]', bg: 'bg-[#FEF6F5]' },
        ].map((card, idx) => (
          <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className={`p-3 rounded-lg ${card.bg} ${card.color}`}>
              <card.icon size={20} />
            </div>
            <div>
              <p className="text-xl font-black text-gray-900 leading-none mb-1">{card.value}</p>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters & Search - More Fluid */}
      <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-3">
        {/* Row 1: search + SOC + Leader + Status */}
        <div className="flex flex-col md:flex-row gap-3 items-center">
          <div className="relative flex-1 w-full">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              placeholder="Buscar por nome, OPSID, setor ou unidade..."
              className="w-full pl-11 pr-4 py-2.5 rounded-lg bg-gray-50 border-transparent text-gray-800 text-[13px] font-medium outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" 
            />
          </div>
          <div className="flex gap-3 w-full md:w-auto flex-wrap">
            <select 
              value={selectedSoc} 
              onChange={(e) => setSelectedSoc(e.target.value)} 
              className="flex-1 md:flex-none px-3 py-2.5 rounded-lg bg-gray-50 border-transparent text-gray-700 text-[12px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all min-w-[120px]"
            >
              <option value="">Todos SOCs</option>
              {uniqueSocs.map(soc => <option key={soc} value={soc}>{soc}</option>)}
            </select>
            <select 
              value={selectedLeader} 
              onChange={(e) => setSelectedLeader(e.target.value)} 
              className="flex-1 md:flex-none px-3 py-2.5 rounded-lg bg-gray-50 border-transparent text-gray-700 text-[12px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all min-w-[140px]"
            >
              <option value="">Todos Líderes</option>
              {uniqueLeaders.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select 
              value={selectedShift} 
              onChange={(e) => setSelectedShift(e.target.value)} 
              className="flex-1 md:flex-none px-3 py-2.5 rounded-lg bg-gray-50 border-transparent text-gray-700 text-[12px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all min-w-[110px]"
            >
              <option value="">Todos Turnos</option>
              {uniqueShifts.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select 
              value={statusFilter} 
              onChange={(e) => setStatusFilter(e.target.value as any)} 
              className={`flex-1 md:flex-none px-3 py-2.5 rounded-lg text-[12px] font-black outline-none transition-all min-w-[130px] border-2 ${
                statusFilter === 'trained' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 
                statusFilter === 'pending' ? 'bg-red-50 border-red-200 text-red-500' : 
                'bg-gray-50 border-transparent text-gray-700'
              }`}
            >
              <option value="all">Todos Status</option>
              <option value="trained">Certificados</option>
              <option value="pending">Pendentes</option>
            </select>
          </div>
        </div>

        {/* Row 2: Onboarding-specific filters (only shown on onboarding tab) */}
        {currentTab === 'onboarding' && (
          <div className="flex flex-col sm:flex-row gap-3 items-center border-t border-gray-50 pt-3">
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">Filtros Onboarding</span>
            <div className="flex gap-2 flex-1 flex-wrap items-center">
              {/* Date range */}
              <div className="flex items-center gap-1.5">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Admissão de</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-gray-50 border-transparent text-gray-700 text-[11px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">até</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-gray-50 border-transparent text-gray-700 text-[11px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all"
                />
              </div>
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[9px] font-black text-[#EE4D2D] uppercase tracking-widest bg-[#FEF6F5] px-2 py-1 rounded-full hover:bg-red-50 transition-colors">
                  Limpar datas
                </button>
              )}

              {/* Multi-Module filter dropdown */}
              <div className="relative" ref={moduleDropdownRef}>
                <button
                  type="button"
                  onClick={() => setModuleDropdownOpen(o => !o)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-black outline-none transition-all border-2 ${
                    onboardingModuleFilter.size > 0
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {onboardingModuleFilter.size > 0 ? (
                    <span className="flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[8px] font-black flex items-center justify-center">{onboardingModuleFilter.size}</span>
                      Módulo{onboardingModuleFilter.size > 1 ? 's' : ''} selecionado{onboardingModuleFilter.size > 1 ? 's' : ''}
                    </span>
                  ) : 'Todos os módulos'}
                  <svg className={`w-3 h-3 transition-transform ${moduleDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
                </button>

                {moduleDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1.5 z-30 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden min-w-[240px] animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3 py-2 border-b border-gray-50 flex items-center justify-between">
                      <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Filtrar por módulo pendente</span>
                      {onboardingModuleFilter.size > 0 && (
                        <button
                          onClick={() => setOnboardingModuleFilter(new Set())}
                          className="text-[9px] font-black text-[#EE4D2D] uppercase tracking-widest hover:opacity-70 transition-opacity"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                    <div className="py-1">
                      {ONBOARDING_MODULES.map(m => {
                        const isSelected = onboardingModuleFilter.has(m.key);
                        return (
                          <label
                            key={m.key}
                            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                              isSelected ? 'bg-amber-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setOnboardingModuleFilter(prev => {
                                  const next = new Set(prev);
                                  if (next.has(m.key)) next.delete(m.key);
                                  else next.add(m.key);
                                  return next;
                                });
                              }}
                              className="w-4 h-4 rounded border-gray-300 accent-amber-500 cursor-pointer"
                            />
                            <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[9px] font-black flex-shrink-0 ${
                              isSelected ? m.color : 'bg-gray-100 text-gray-400 border-gray-200'
                            }`}>{m.initial}</span>
                            <span className="text-[12px] font-bold text-gray-700">{m.label}</span>
                            {isSelected && (
                              <span className="ml-auto text-[9px] font-black text-amber-600 uppercase">pendente</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Form Overlay Modal */}
      {showForm && (isAdmin || isBpo) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-7 w-full max-w-xl shadow-2xl border border-gray-100 space-y-6 animate-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-xl font-black text-gray-900">{editingId ? 'Editar Colaborador' : 'Novo Colaborador'}</h3>
              <p className="text-gray-400 font-medium text-xs mt-0.5">Preencha as informações necessárias</p>
            </div>
            
            {currentTab === 'onboarding' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {fields.filter(f => ['name', 'role', 'soc', 'bpo'].includes(f.key)).map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1 px-1">{label}</label>
                    <input 
                      value={form[key]} 
                      onChange={(e) => handleChange(key, e.target.value)} 
                      placeholder={`Digitando...`}
                      className="w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-transparent focus:bg-white focus:border-[#EE4D2D] text-gray-800 text-[13px] font-bold outline-none transition-all uppercase" 
                    />
                  </div>
                ))}
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1 px-1">Data de Admissão</label>
                  <input type="date" value={form.admission_date} onChange={e => setForm(prev => ({ ...prev, admission_date: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-transparent focus:bg-white focus:border-[#EE4D2D] text-gray-800 text-[13px] font-bold outline-none transition-all uppercase" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {fields.map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1 px-1">{label}</label>
                    <input 
                      value={form[key]} 
                      onChange={(e) => handleChange(key, e.target.value)} 
                      placeholder={`Digitando...`}
                      className="w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-transparent focus:bg-white focus:border-[#EE4D2D] text-gray-800 text-[13px] font-bold outline-none transition-all" 
                    />
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex gap-2 pt-4 border-t border-gray-50">
              <button 
                onClick={handleSave} 
                className="flex-1 py-3 rounded-lg shopee-gradient-bg text-white text-[11px] font-black uppercase tracking-widest hover:brightness-110 shadow-md transition-all"
              >
                Salvar Alterações
              </button>
              <button 
                onClick={() => { setShowForm(false); setEditingId(null); }} 
                className="px-6 py-3 rounded-lg bg-gray-100 text-gray-500 text-[11px] font-black uppercase tracking-widest hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table Section - Higher Density */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[70vh] custom-scrollbar">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50/80 backdrop-blur-sm border-b border-gray-100">
                {isAdmin && (
                  <th className="p-3 w-10">
                    <div className="flex items-center justify-center">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-gray-300 bg-white checked:bg-[#EE4D2D] accent-[#EE4D2D] cursor-pointer"
                        checked={filtered.length > 0 && selectedIds.size === filtered.length}
                        onChange={toggleSelectAll}
                      />
                    </div>
                  </th>
                )}
                {currentTab === 'lideres' ? (
                  // A aba Líderes deixou de ser um espelho da de Colaboradores:
                  // um líder não tem OPSID, Gênero, BPO nem Cargo no cadastro. O
                  // que interessa dele é o E-MAIL — a chave que liga ao time —
                  // e o Gestor a quem ele responde.
                  LEADER_COLUMNS.map((h) => (
                    <th key={h} className={`${h === 'Nome' ? 'text-left' : 'text-center'} p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap`}>{h}</th>
                  ))
                ) : (
                  <>
                    {['OPSID', 'Gênero', 'Colaborador', 'BPO'].map((h) => (
                      <th key={h} className={`${h === 'Colaborador' ? 'text-left' : 'text-center'} p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap`}>{h}</th>
                    ))}
                    {currentTab === 'onboarding' ? (
                      <>
                        <th className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Admissão</th>
                        <th className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Cargo</th>
                        <th className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Onboardings</th>
                      </>
                    ) : (
                      <>
                        <th className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Cargo</th>
                        <th className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Turno</th>
                        <th className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Setor</th>
                      </>
                    )}
                    {['Atividade', 'Líder', 'SOC', 'Status'].map((h) => (
                      <th key={h} className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </>
                )}
                {(isAdmin || isBpo) && <th className="text-right p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pagedList.map((c) => (
                <tr key={c.id} className={`group transition-colors ${selectedIds.has(c.id) ? 'bg-[#FEF6F5]' : 'hover:bg-gray-50/50'}`}>
                  {isAdmin && (
                    <td className="p-2.5">
                      <div className="flex items-center justify-center">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded border-gray-300 bg-white checked:bg-[#EE4D2D] accent-[#EE4D2D] cursor-pointer"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                        />
                      </div>
                    </td>
                  )}
                  {currentTab === 'lideres' ? (
                    <>
                      <td className="p-2.5 text-left font-black text-gray-900 whitespace-nowrap">{c.name}</td>
                      <td className="p-2.5 text-center text-gray-600 text-[11px] font-medium whitespace-nowrap">
                        {c.email ? c.email : <span className="text-red-400 font-bold" title="Sem e-mail o time não é vinculado automaticamente">— sem e-mail</span>}
                      </td>
                      <td className="p-2.5 text-center text-gray-700 font-medium whitespace-nowrap">
                        {c.sector
                          ? <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[9px] font-black uppercase tracking-tighter border border-blue-100">{c.sector}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="p-2.5 text-center text-gray-500 text-[11px] font-bold whitespace-nowrap">{c.activity || '—'}</td>
                      <td className="p-2.5 text-center">
                        {c.shift
                          ? <span className="text-[10px] font-bold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full inline-block border border-gray-200">Turno {c.shift}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="p-2.5 text-center text-gray-500 text-[11px] font-bold whitespace-nowrap">{c.leader || '—'}</td>
                      <td className="p-2.5 text-center text-gray-900 font-black tracking-widest whitespace-nowrap">{c.soc}</td>
                    </>
                  ) : (
                  <>
                  <td className="p-2.5 text-center text-gray-500 font-bold whitespace-nowrap">{c.opsid}</td>
                  <td className="p-2.5 text-center text-gray-400 text-[11px] font-medium whitespace-nowrap">{c.gender}</td>
                  <td className="p-2.5 text-left font-black text-gray-900 whitespace-nowrap">{c.name}</td>
                  <td className="p-2.5 text-center text-gray-500 font-bold whitespace-nowrap">{c.bpo || '-'}</td>

                  {currentTab === 'onboarding' ? (
                    <>
                      <td className="p-2.5 text-center">
                        <span className="text-[11px] font-bold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-md">
                          {c.admission_date ? new Date(c.admission_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                        </span>
                      </td>
                      <td className="p-2.5 text-center text-gray-900 font-bold whitespace-nowrap">
                         <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[9px] font-black uppercase tracking-tighter border border-blue-100">{c.role}</span>
                      </td>
                      {/* Onboarding badges */}
                      <td className="p-2.5">
                        <div className="flex items-center justify-center gap-1">
                          {getCompletedModules(c).map(m => (
                            <div
                              key={m.key}
                              title={`${m.label}${m.done ? ' ✓ Concluído' : ' ✗ Pendente'}`}
                              className={`w-6 h-6 rounded-full border flex items-center justify-center text-[9px] font-black transition-all ${
                                m.done
                                  ? m.color
                                  : 'bg-gray-100 text-gray-300 border-gray-200'
                              }`}
                            >
                              {m.initial}
                            </div>
                          ))}
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-2.5 text-center text-gray-900 font-bold whitespace-nowrap">{c.role}</td>
                      <td className="p-2.5 text-center">
                        <span className="text-[10px] font-bold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full inline-block border border-gray-200">Turno {c.shift}</span>
                      </td>
                      <td className="p-2.5 text-center text-gray-700 font-medium whitespace-nowrap">
                         <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[9px] font-black uppercase tracking-tighter border border-blue-100">{c.sector}</span>
                      </td>
                    </>
                  )}
                  <td className="p-2.5 text-center text-gray-500 text-[11px] font-bold whitespace-nowrap">{c.activity || '-'}</td>
                  <td className="p-2.5 text-center text-gray-500 text-[11px] font-bold whitespace-nowrap">{c.leader}</td>
                  <td className="p-2.5 text-center text-gray-900 font-black tracking-widest whitespace-nowrap">{c.soc}</td>
                  </>
                  )}
                  <td className="p-2.5 text-center whitespace-nowrap">
                    {isTrained(c) ? (
                      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black bg-emerald-50 text-emerald-600 border border-emerald-200">
                        <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                        CERTIFICADO
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black bg-red-50 text-red-500 border border-red-200">
                         <div className="w-1 h-1 rounded-full bg-red-500" />
                         PENDENTE
                      </div>
                    )}
                  </td>
                  {(isAdmin || isBpo) && (
                    <td className="p-2.5 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#EE4D2D] hover:bg-[#FEF6F5] transition-all">
                          <Edit2 size={14} />
                        </button>
                        {isAdmin && (
                          <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {dataLoading ? (
            <div className="py-20 text-center text-gray-400 text-sm">Carregando colaboradores...</div>
          ) : filtered.length === 0 && (
             <div className="py-20 flex flex-col items-center justify-center text-center px-4">
                <Search size={40} className="text-gray-100 mb-3" />
                <h3 className="text-gray-900 font-bold text-sm">Nenhum resultado</h3>
                <p className="text-gray-400 text-xs max-w-xs mx-auto">Tente ajustar seus filtros ou mude o termo de pesquisa.</p>
             </div>
          )}
        </div>
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              {page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} de {filtered.length}
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
    </div>
  );
}
