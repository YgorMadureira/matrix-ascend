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
  const isSyncing = useRef(false);

  const isTrained = (c: Collaborator) => {
    return trainings.some((t) => {
      if (t.collaborator_id !== c.id) return false;
      const tName = t.training_type?.toUpperCase() || '';
      const cSec = c.sector?.toUpperCase() || '';
      const cRole = c.role?.toUpperCase() || '';
      if (cSec && (tName.includes(cSec) || cSec.includes(tName))) return true;
      if (cRole && (tName.includes(cRole) || cRole.includes(tName))) return true;
      const isOperational = cSec === 'RECEBIMENTO' || cSec === 'PROCESSAMENTO' || cSec === 'EXPEDIÇÃO' || cSec === 'EXPEDICAO';
      if (tName.includes('ONBOARDING') && (isOperational || c.is_onboarding)) return true;
      return false;
    });
  };

  const fetchData = useCallback(async () => {
    let allCollabs: any[] = [];
    let hasMore = true;
    let page = 0;
    const limit = 1000;
    while (hasMore) {
      const { data, error } = await supabase.from('collaborators').select('*').order('name').range(page * limit, (page + 1) * limit - 1);
      if (error) break;
      if (data) {
        allCollabs = [...allCollabs, ...data];
        if (data.length < limit) hasMore = false;
        else page++;
      } else { hasMore = false; }
    }
    let allTrainings: any[] = [];
    let tPage = 0;
    let tHasMore = true;
    while (tHasMore) {
      const { data, error } = await supabase.from('trainings_completed').select('collaborator_id, training_type').range(tPage * limit, (tPage + 1) * limit - 1);
      if (error) break;
      if (data) {
        allTrainings = [...allTrainings, ...data];
        if (data.length < limit) tHasMore = false;
        else tPage++;
      } else { tHasMore = false; }
    }
    setCollaborators(allCollabs);
    setTrainings(allTrainings);
  }, []);

  useEffect(() => { if (!authLoading) fetchData(); }, [location.pathname, fetchData, authLoading]);

  const filtered = collaborators.filter(c => {
    const isEmOnboarding = c.is_onboarding === true;
    if (currentTab === 'ativos' && isEmOnboarding) return false;
    if (currentTab === 'onboarding' && !isEmOnboarding) return false;
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || (c.opsid ?? '').toLowerCase().includes(search.toLowerCase()) || c.soc.toLowerCase().includes(search.toLowerCase());
    const matchSoc = selectedSoc ? c.soc === selectedSoc : true;
    const matchLeader = selectedLeader ? c.leader === selectedLeader : true;
    if (statusFilter !== 'all') {
      const trained = isTrained(c);
      if (statusFilter === 'trained' && !trained) return false;
      if (statusFilter === 'pending' && trained) return false;
    }
    return matchSearch && matchSoc && matchLeader;
  });

  const displayTotal = filtered.length;
  const uniqueTrained = filtered.filter(c => isTrained(c)).length;
  const trainedPct = displayTotal > 0 ? Math.round((uniqueTrained / displayTotal) * 100) : 0;
  const totalLeaders = filtered.filter(c => c.role?.toUpperCase().includes('LIDER') || c.role?.toUpperCase().includes('LÍDER')).length;

  const handleSave = async (payload: any, editingId: string | null) => {
    if (editingId) {
      const { error } = await supabase.from('collaborators').update(payload).eq('id', editingId);
      if (!error) { toast.success('Atualizado'); fetchData(); setShowForm(false); }
    } else {
      const { error } = await supabase.from('collaborators').insert(payload);
      if (!error) { toast.success('Cadastrado'); fetchData(); setShowForm(false); }
    }
  };

  const downloadTemplate = () => {
    const bom = '\uFEFF';
    const csv = currentTab === 'onboarding'
      ? bom + 'Gênero;Colaborador;Data de Admissão;BPO;Cargo;SOC\nFEMININO;VIVIAN KAROLINE;27/04/2026;GI Group;AUXILIAR DE LOGISTICA;SP6'
      : bom + 'OPSID;Gênero;Colaborador;Turno;Setor;Líder;Cargo;SOC\n001;MASCULINO;JOÃO SILVA;T1;RECEBIMENTO;CARLOS;OPERADOR LOGISTICO;SP6';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = currentTab === 'onboarding' ? 'modelo_onboarding.csv' : 'modelo_colaboradores.csv';
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div>
          {!isBpo && (
            <div className="flex items-center gap-4 mb-4 border-b border-gray-100">
              <button onClick={() => setCurrentTab('ativos')} className={`pb-2 px-1 text-sm font-bold uppercase transition-colors border-b-4 ${currentTab === 'ativos' ? 'border-[#EE4D2D] text-[#EE4D2D]' : 'border-transparent text-gray-400'}`}>Base Ativa</button>
              <button onClick={() => setCurrentTab('onboarding')} className={`pb-2 px-1 text-sm font-bold uppercase transition-colors border-b-4 ${currentTab === 'onboarding' ? 'border-[#EE4D2D] text-[#EE4D2D]' : 'border-transparent text-gray-400'}`}>Onboarding</button>
            </div>
          )}
          <h1 className="text-2xl font-black text-gray-900">{currentTab === 'ativos' ? 'Colaboradores Ativos' : 'Integração Onboarding'}</h1>
          <p className="text-xs text-gray-500 font-medium">{displayTotal} funcionários nesta aba</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={downloadTemplate} className="px-4 py-2 rounded-full bg-gray-50 text-gray-700 text-[10px] font-black uppercase border border-gray-200"><Download size={14} className="inline mr-1"/> Modelo</button>
          <button onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(true); }} className="px-5 py-2 rounded-full shopee-gradient-bg text-white text-[10px] font-black uppercase shadow-md"><Plus size={16} className="inline mr-1"/> Novo</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Users, label: 'Total', value: displayTotal, color: 'text-blue-500', bg: 'bg-blue-50' },
          { icon: Crown, label: 'Líderes', value: totalLeaders, color: 'text-amber-500', bg: 'bg-amber-50' },
          { icon: UserCheck, label: 'Treinados', value: uniqueTrained, color: 'text-emerald-500', bg: 'bg-emerald-50' },
          { icon: Percent, label: '% Certificação', value: `${trainedPct}%`, color: 'text-[#EE4D2D]', bg: 'bg-[#FEF6F5]' },
        ].map((card, idx) => (
          <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className={`p-3 rounded-lg ${card.bg} ${card.color}`}><card.icon size={20} /></div>
            <div>
              <p className="text-xl font-black text-gray-900 leading-none mb-1">{card.value}</p>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." className="w-full pl-11 pr-4 py-2.5 rounded-lg bg-gray-50 text-gray-800 text-[13px] outline-none" />
        </div>
        <select value={selectedSoc} onChange={(e) => setSelectedSoc(e.target.value)} className="px-3 py-2.5 rounded-lg bg-gray-50 text-gray-700 text-[12px] font-bold outline-none">
          <option value="">Todas Unidades</option>
          {Array.from(new Set(collaborators.map(c => c.soc))).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="px-3 py-2.5 rounded-lg bg-gray-50 text-gray-700 text-[12px] font-bold outline-none">
          <option value="all">Todos Status</option>
          <option value="trained">Certificados</option>
          <option value="pending">Pendentes</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-[10px] text-gray-400 font-black uppercase">
              <tr>
                <th className="p-4">Colaborador</th>
                <th className="p-4">Cargo</th>
                <th className="p-4">Setor</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="p-4">
                    <div className="font-bold text-gray-800">{c.name}</div>
                    <div className="text-[10px] text-gray-400">{c.opsid} • {c.soc}</div>
                  </td>
                  <td className="p-4 text-gray-600 font-medium">{c.role}</td>
                  <td className="p-4"><span className="px-2 py-1 rounded bg-blue-50 text-blue-600 text-[10px] font-black">{c.sector || '-'}</span></td>
                  <td className="p-4 text-center">
                    {isTrained(c) ? 
                      <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black">CERTIFICADO</span> : 
                      <span className="px-2 py-1 rounded-full bg-red-50 text-red-500 text-[10px] font-black">PENDENTE</span>
                    }
                  </td>
                  <td className="p-4 text-right">
                    <button onClick={() => { setEditingId(c.id); setForm(c as any); setShowForm(true); }} className="p-2 text-gray-400 hover:text-blue-500"><Edit2 size={16}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <h2 className="text-xl font-black mb-4">{editingId ? 'Editar' : 'Novo'} Colaborador</h2>
            <div className="space-y-4">
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Nome" className="w-full p-2 rounded border" />
              <input value={form.role} onChange={e => setForm({...form, role: e.target.value})} placeholder="Cargo" className="w-full p-2 rounded border" />
              <input value={form.soc} onChange={e => setForm({...form, soc: e.target.value})} placeholder="SOC" className="w-full p-2 rounded border" />
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-gray-500 font-bold">Cancelar</button>
                <button onClick={() => handleSave(form, editingId)} className="flex-1 py-2 shopee-gradient-bg text-white font-black rounded-lg shadow-md">Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
