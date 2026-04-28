import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Upload, Download, Trash2, Search, Edit2, Users, UserCheck, Crown, Percent } from 'lucide-react';
import { toast } from 'sonner';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

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
}

const emptyForm = { name: '', opsid: '', gender: '', soc: '', sector: '', shift: '', leader: '', role: '', bpo: '', is_onboarding: false, admission_date: '', activity: '' };

const GSHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0LwfzukkjRDLD-NqioPJoWmFv5FfeDfUdInkavetnDr7p-OhoB-sKvvXWqy6jilxBc4g8olgkOjsJ/pub?gid=0&single=true&output=csv';

export default function CollaboratorsPage() {
  const { isAdmin, isBpo, loading: authLoading } = useAuth();
  const location = useLocation();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [trainings, setTrainings] = useState<{ collaborator_id: string, training_type: string }[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedSoc, setSelectedSoc] = useState('');
  const [selectedLeader, setSelectedLeader] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'trained' | 'pending'>('all');
  const [currentTab, setCurrentTab] = useState<'ativos' | 'onboarding'>(isBpo ? 'onboarding' : 'ativos');
  const isSyncing = useRef(false); // Guard against concurrent syncs

  const handleChange = (key: keyof typeof form, value: string) => {
    let val = value.toUpperCase();
    if (key === 'gender' || key === 'name' || key === 'sector' || key === 'leader' || key === 'role') {
      val = val.replace(/[^A-ZÀ-ÖØ-öø-ÿ\s]/g, '');
    } else if (key === 'opsid') {
      val = val.replace(/[^A-Z0-9]/g, '');
    } else if (key === 'soc') {
      val = val.replace(/[^A-Z0-9]/g, '').slice(0, 3);
    } else if (key === 'shift') {
      val = val.replace(/[^A-Z0-9]/g, '').slice(0, 3);
      if (val.length > 0 && val[0] !== 'T') {
        val = 'T' + val.substring(0, 2);
      }
    }
    setForm(prev => ({ ...prev, [key]: val }));
  };

  const uniqueSocs = Array.from(new Set(collaborators.map(c => c.soc).filter(Boolean))).sort();
  const uniqueLeaders = Array.from(new Set(collaborators.map(c => c.leader).filter(Boolean))).sort();

  const fetchData = useCallback(async () => {
    // Supabase has a default limit of 1000 rows. We need to fetch all of them.
    let allCollabs: any[] = [];
    let hasMore = true;
    let page = 0;
    const limit = 1000;

    while (hasMore) {
      const { data, error } = await supabase
        .from('collaborators')
        .select('*')
        .order('name')
        .range(page * limit, (page + 1) * limit - 1);
      
      if (error) {
        console.error("Error fetching collaborators:", error);
        break;
      }
      
      if (data) {
        allCollabs = [...allCollabs, ...data];
        if (data.length < limit) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    let allTrainings: any[] = [];
    let tPage = 0;
    let tHasMore = true;
    while (tHasMore) {
      const { data, error } = await supabase
        .from('trainings_completed')
        .select('collaborator_id, training_type')
        .range(tPage * limit, (tPage + 1) * limit - 1);
      
      if (error) {
        console.error("Error fetching trainings:", error);
        break;
      }
      
      if (data) {
        allTrainings = [...allTrainings, ...data];
        if (data.length < limit) tHasMore = false;
        else tPage++;
      } else {
        tHasMore = false;
      }
    }

    setCollaborators(allCollabs);
    setTrainings(allTrainings);
  }, []);

  useEffect(() => {
    if (!authLoading) fetchData();
  }, [location.pathname, fetchData, authLoading]);


  const handleGSheetSync = async (isAuto = false) => {
    if (!isAdmin) return;
    if (isSyncing.current) {
      console.warn('[Sync] Já existe uma sincronização em andamento. Ignorando.');
      return;
    }
    isSyncing.current = true;
    
    const toastId = toast.loading(isAuto ? 'Sincronização automática em andamento...' : 'Sincronizando com Google Sheets...');
    
    try {
      // Always fetch fresh data from DB to avoid using stale in-memory state
      let freshCollaborators: Collaborator[] = [];
      let page = 0;
      const limit = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data } = await supabase.from('collaborators').select('id, name, opsid, is_onboarding').range(page * limit, (page + 1) * limit - 1);
        if (data && data.length > 0) {
          freshCollaborators = [...freshCollaborators, ...data as Collaborator[]];
          if (data.length < limit) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
      }
      const response = await fetch(GSHEET_URL);
      if (!response.ok) throw new Error('Falha ao buscar dados do Google Sheets');
      
      let text = await response.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());

      if (lines.length < 2) throw new Error('Planilha vazia ou sem dados');

      const firstLine = lines[0];
      const sep = firstLine.includes(';') ? ';' : ',';

      const splitLine = (line: string) => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') inQuotes = !inQuotes;
          else if (ch === sep && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        result.push(current.trim());
        return result;
      };

      // Normalization function for robust header matching
      const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      const header = splitLine(firstLine).map(normalize);
      
      // Helper: converts '-' or whitespace-only values to null (avoids DB constraint issues)
      const clean = (v: string): string | null => (!v || v.trim() === '-' || v.trim() === '') ? null : v.trim();

      const rows = lines.slice(1).map(line => {
        const p = splitLine(line);
        const get = (names: string[]) => {
          for (const n of names) {
            const normalizedTarget = normalize(n);
            const i = header.indexOf(normalizedTarget);
            if (i >= 0 && p[i]) return p[i].trim();
          }
          return '';
        };

        const isDesligado = get(['desligado']).toLowerCase() === 'sim';
        if (isDesligado) return null;

        const name = get(['colaborador', 'nome', 'name', 'colaboradores']).trim();
        if (!name || name.length < 2) return null;

        const admRaw = get(['data admissao', 'data de admissão', 'admissao', 'admission']);
        let admissionDate: string | null = null;
        if (admRaw && admRaw.includes('/')) {
          const parts = admRaw.split('/');
          if (parts.length === 3) {
            const [day, month, year] = parts;
            const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            // Validate the date
            const d = new Date(iso);
            if (!isNaN(d.getTime())) admissionDate = iso;
          }
        }

        return {
          name,
          gender: clean(get(['genero', 'gênero', 'gender', 'sexo'])),
          admission_date: admissionDate,
          shift: clean(get(['turno', 'shift', 'periodo'])),
          sector: clean(get(['setor', 'sector', 'area', 'departamento'])),
          leader: clean(get(['lider', 'líder', 'leader', 'gestor'])),
          opsid: clean(get(['ops id', 'opsid', 'matricula', 'id'])),
          bpo: clean(get(['bpo', 'empresa'])),
          role: clean(get(['cargo', 'role', 'função', 'funcao'])),
          activity: clean(get(['atividade', 'activity', 'funcao real'])),
          soc: 'SP6',
          is_onboarding: false
        };
      }).filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length === 0) {
        console.warn('[Sync] Headers encontrados:', header);
        console.warn('[Sync] Exemplo de linha bruta:', splitLine(lines[1]));
        toast.error(`Nenhum colaborador encontrado. Veja o console para detalhes.`, { id: toastId });
        return;
      }

      console.log(`[Sync] Iniciando processamento de ${rows.length} colaboradores validados (de ${lines.length - 1} linhas totais na planilha).`);
      
      let totalUpdated = 0;
      let totalInserted = 0;
      let totalPromoted = 0;
      const BATCH = 50;

      const failedRows: string[] = [];

      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        
        for (const row of batch) {
          // Normalize names for better matching — use freshCollaborators (just fetched from DB)
          const normName = row.name.trim().toUpperCase();
          const existing = freshCollaborators.find(c => 
            (c.opsid && row.opsid && c.opsid.trim().toUpperCase() === row.opsid.trim().toUpperCase()) || 
            (c.name.trim().toUpperCase() === normName)
          );

          if (existing) {
            if (existing.is_onboarding) totalPromoted++;
            const { error } = await supabase.from('collaborators').update(row).eq('id', existing.id);
            if (error) {
              console.error(`[Sync] ERRO ao atualizar "${row.name}":`, error.message, '| Dados:', row);
              failedRows.push(row.name);
            } else {
              totalUpdated++;
            }
          } else {
            const { error } = await supabase.from('collaborators').insert(row);
            if (error) {
              console.error(`[Sync] ERRO ao inserir "${row.name}":`, error.message, '| Dados:', row);
              failedRows.push(row.name);
            } else {
              totalInserted++;
            }
          }
        }
      }

      if (failedRows.length > 0) {
        console.warn(`[Sync] ${failedRows.length} registros falharam:`, failedRows);
      }

      // Summary of sync
      const totalProcessed = totalInserted + totalUpdated;
      const totalInSheet = lines.length - 1;
      const diff = totalInSheet - totalProcessed;

      console.log(`[Sync] Processamento finalizado. Inseridos: ${totalInserted}, Atualizados: ${totalUpdated}.`);
      if (diff > 0) {
        console.warn(`[Sync] ${diff} linhas foram ignoradas ou unificadas (duplicatas).`);
      }

      toast.success(`Sincronização concluída! ${totalInserted} novos, ${totalUpdated} atualizados. (${rows.length} válidos)`, { id: toastId });
      
      // Update last sync time
      localStorage.setItem('last_gsheet_sync', new Date().toISOString());
      fetchData();
    } catch (err: any) {
      console.error('[GSheet Sync Error]', err);
      toast.error('Erro na sincronização: ' + (err.message || 'Erro desconhecido'), { id: toastId });
    } finally {
      isSyncing.current = false;
    }
  };

  useEffect(() => {
    const checkAutoSync = () => {
      if (!isAdmin || authLoading) return;

      const lastSyncStr = localStorage.getItem('last_gsheet_sync');
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      
      const configTime = localStorage.getItem('auto_sync_hour') || '05:00';
      const [configH, configM] = configTime.split(':').map(Number);
      
      const targetTime = new Date();
      targetTime.setHours(configH, configM, 0, 0);

      if (now >= targetTime) {
        const lastSyncDate = lastSyncStr ? new Date(lastSyncStr).toISOString().split('T')[0] : '';
        const lastSyncFullDate = lastSyncStr ? new Date(lastSyncStr) : null;

        // If never synced OR last sync was NOT today OR last sync was today but BEFORE target time
        if (!lastSyncStr || lastSyncDate !== today || (lastSyncFullDate && lastSyncFullDate < targetTime)) {
          handleGSheetSync(true);
        }
      }
    };

    // Delay auto-sync slightly to ensure collaborators are loaded for matching
    if (collaborators.length > 0) {
      const timeout = setTimeout(checkAutoSync, 2000);
      return () => clearTimeout(timeout);
    }
  }, [isAdmin, authLoading, collaborators.length]);

  const filtered = collaborators.filter(c => {
    // Current Tab filtering
    const isEmOnboarding = c.is_onboarding === true;
    if (currentTab === 'ativos' && isEmOnboarding) return false;
    if (currentTab === 'onboarding' && !isEmOnboarding) return false;

    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || 
      (c.opsid ?? '').toLowerCase().includes(search.toLowerCase()) || 
      c.soc.toLowerCase().includes(search.toLowerCase()) || 
      (c.sector || '').toLowerCase().includes(search.toLowerCase());
    
    const matchSoc = selectedSoc ? c.soc === selectedSoc : true;
    const matchLeader = selectedLeader ? c.leader === selectedLeader : true;
    
    // Status Filter
    if (statusFilter !== 'all') {
      const trained = isTrained(c);
      if (statusFilter === 'trained' && !trained) return false;
      if (statusFilter === 'pending' && trained) return false;
    }
    
    return matchSearch && matchSoc && matchLeader;
  });

  const displayTotal = filtered.length;
  const totalLeaders = filtered.filter(c => c.role?.toUpperCase().includes('LÍDER') || c.role?.toUpperCase().includes('LIDER')).length;

  const isTrained = (c: Collaborator) => {
    return trainings.some((t) => {
      if (t.collaborator_id !== c.id) return false;

      const tName = t.training_type?.toUpperCase() || '';
      const cSec = c.sector?.toUpperCase() || '';
      const cRole = c.role?.toUpperCase() || '';
      
      // 1. Match Direto: Se o nome do treinamento contém o setor ou cargo
      if (cSec && (tName.includes(cSec) || cSec.includes(tName))) return true;
      if (cRole && (tName.includes(cRole) || cRole.includes(tName))) return true;
      
      // 2. Regra de Onboarding:
      // Se for um treinamento de Onboarding, aceita para setores operacionais ou se o usuário estiver em onboarding
      const isOperational = cSec === 'RECEBIMENTO' || cSec === 'PROCESSAMENTO' || cSec === 'EXPEDIÇÃO' || cSec === 'EXPEDICAO' || cSec.includes('LOGISTICA') || cRole.includes('LOGISTICA');
      if (tName.includes('ONBOARDING') && (isOperational || c.is_onboarding)) return true;

      return false;
    });
  };

  const uniqueTrained = filtered.filter(c => isTrained(c)).length;
  const trainedPct = displayTotal > 0 ? Math.round((uniqueTrained / displayTotal) * 100) : 0;

  const handleSave = async () => {
    const payload = { ...form };
    if (!payload.admission_date) {
      delete payload.admission_date;
    }
    
    if (form.is_onboarding) {
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
       activity: c.activity ?? ''
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
      // Read as text with UTF-8, strip BOM if present
      let text = await file.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

      // Normalize line endings
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());

      if (lines.length < 2) {
        toast.error('CSV vazio ou sem dados além do cabeçalho.');
        e.target.value = '';
        return;
      }

      // Detect separator from first line
      const firstLine = lines[0];
      const sep = firstLine.includes(';') ? ';' : ',';

      // Smart split that respects quoted values
      const splitLine = (line: string) => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === sep && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        result.push(current.trim());
        return result;
      };

      const header = splitLine(firstLine).map(h => h.toLowerCase().trim());
      console.log('[CSV] Cabeçalho detectado:', header);

      const rows = lines.slice(1).map((line, idx) => {
        const p = splitLine(line);
        // Try to map by header or by position (fallback)
        const get = (names: string[], pos: number) => {
          for (const n of names) {
            const i = header.indexOf(n);
            if (i >= 0 && p[i]) return p[i].trim();
          }
          return p[pos]?.trim() ?? '';
        };

        return {
          opsid: get(['opsid', 'ops id', 'matricula', 'id'], 0),
          gender: get(['genero', 'gênero', 'gender', 'sexo'], 1),
          name: get(['colaborador', 'nome', 'name', 'colaborador'], 2),
          shift: get(['turno', 'shift'], 3),
          sector: get(['setor', 'sector', 'area', 'área'], 4),
          leader: get(['lider', 'líder', 'leader', 'gestor'], 5),
          role: get(['cargo', 'role', 'função', 'funcao'], 6),
          soc: get(['soc', 'unidade', 'unit'], 7),
          activity: get(['atividade', 'activity'], 8),
        };
      }).filter(r => r.name && r.name.length > 1);

      console.log(`[CSV] ${rows.length} linha(s) válida(s) encontradas`);

      if (rows.length === 0) {
        toast.error('Nenhum colaborador válido encontrado. Verifique se o arquivo segue o modelo.');
        e.target.value = '';
        return;
      }

      const onboardings = collaborators.filter(c => c.is_onboarding);

      // Insert in batches of 50
      let totalInserted = 0;
      let totalUpdated = 0;
      let lastError = '';
      const BATCH = 50;
      const isUploadingToOnboarding = currentTab === 'onboarding';

      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        
        const toInsert = [];
        for (const row of batch) {
          if (!isUploadingToOnboarding) {
            // WE ARE UPLOADING OFFICIAL ABS DATA. Try matching against onboarding!
            const matched = onboardings.find(o => o.name.trim().toUpperCase() === row.name.toUpperCase());
            if (matched) {
               // UPDATE the existing record instead of inserting!
               const { error } = await supabase.from('collaborators').update({
                  ...row,
                  is_onboarding: false
               }).eq('id', matched.id);
               if (error) { lastError = error.message; console.error(error); }
               else totalUpdated++;
               continue;
            }
          }
          // Default logic
          const defaultAdmissionDate = isUploadingToOnboarding ? new Date().toISOString().split('T')[0] : null;
          toInsert.push({ 
            ...row, 
            is_onboarding: isUploadingToOnboarding,
            admission_date: defaultAdmissionDate 
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
    const csv = currentTab === 'onboarding'
      ? bom + 'Gênero;Colaborador;Data de Admissão;BPO;Cargo;SOC\nFEMININO;VIVIAN KAROLINE;27/04/2026;GI Group;AUXILIAR DE LOGISTICA;SP6'
      : bom + 'OPSID;Gênero;Colaborador;Turno;Setor;Líder;Cargo;SOC\n001;MASCULINO;JOÃO SILVA;T1;RECEBIMENTO;CARLOS;OPERADOR LOGISTICO;SP6';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = currentTab === 'onboarding' ? 'modelo_onboarding.csv' : 'modelo_colaboradores.csv';

    a.click();
  };

  const fields: { key: keyof typeof emptyForm; label: string }[] = currentTab === 'onboarding' 
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
            <div className="flex items-center gap-4 mb-4 border-b border-gray-100">
              <button 
                onClick={() => { setCurrentTab('ativos'); setSelectedIds(new Set()); }}
                className={`pb-2 px-1 text-sm font-bold uppercase tracking-widest transition-colors border-b-4 ${currentTab === 'ativos' ? 'border-[#EE4D2D] text-[#EE4D2D]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                Base Ativa
              </button>
              <button 
                onClick={() => { setCurrentTab('onboarding'); setSelectedIds(new Set()); }}
                className={`pb-2 px-1 text-sm font-bold uppercase tracking-widest transition-colors border-b-4 ${currentTab === 'onboarding' ? 'border-[#EE4D2D] text-[#EE4D2D]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                Em Onboarding
              </button>
            </div>
          )}
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">{currentTab === 'ativos' ? 'Colaboradores Ativos' : 'Integração Onboarding'}</h1>
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
            {isAdmin && (
              <button 
                onClick={() => handleGSheetSync()} 
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#EE4D2D]/10 text-[#EE4D2D] text-[10px] font-black uppercase tracking-wider hover:bg-[#EE4D2D]/20 transition-all border border-[#EE4D2D]/20"
              >
                <RefreshCw size={14} /> Sincronizar Sheets
              </button>
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
      <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            placeholder="Buscar por nome, OPSID, setor ou unidade..."
            className="w-full pl-11 pr-4 py-2.5 rounded-lg bg-gray-50 border-transparent text-gray-800 text-[13px] font-medium outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" 
          />
        </div>
        <div className="flex gap-3 w-full md:w-auto">
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
                {['OPSID', 'Gênero', 'Colaborador', 'BPO'].map((h) => (
                   <th key={h} className={`${h === 'Colaborador' ? 'text-left' : 'text-center'} p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap`}>{h}</th>
                ))}
                {currentTab === 'onboarding' ? (
                  <>
                    <th className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Admissão</th>
                    <th className="text-center p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest whitespace-nowrap">Cargo</th>
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
                {(isAdmin || isBpo) && <th className="text-right p-3 text-[9px] text-gray-400 font-black uppercase tracking-widest">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((c) => (
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
                  <td className="p-2.5 text-center text-gray-500 font-bold whitespace-nowrap">{c.opsid}</td>
                  <td className="p-2.5 text-center text-gray-400 text-[11px] font-medium whitespace-nowrap">{c.gender}</td>
                  <td className="p-2.5 text-left font-black text-gray-900 whitespace-nowrap">{c.name}</td>
                  <td className="p-2.5 text-center text-gray-500 font-bold whitespace-nowrap">{c.bpo || '-'}</td>
                  
                  {currentTab === 'onboarding' ? (
                    <>
                      <td className="p-2.5 text-center">
                        <span className="text-[11px] font-bold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-md">{c.admission_date ? new Date(c.admission_date).toLocaleDateString('pt-BR') : '—'}</span>
                      </td>
                      <td className="p-2.5 text-center text-gray-900 font-bold whitespace-nowrap">
                         <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[9px] font-black uppercase tracking-tighter border border-blue-100">{c.role}</span>
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
          {filtered.length === 0 && (
             <div className="py-20 flex flex-col items-center justify-center text-center px-4">
                <Search size={40} className="text-gray-100 mb-3" />
                <h3 className="text-gray-900 font-bold text-sm">Nenhum resultado</h3>
                <p className="text-gray-400 text-xs max-w-xs mx-auto">Tente ajustar seus filtros ou mude o termo de pesquisa.</p>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
