import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { CalendarDays, Plus, X, Clock, MapPin, User, Users, Trash2, Settings, ChevronLeft, ChevronRight, Send, History } from 'lucide-react';
import { toast } from 'sonner';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar';

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface Schedule {
  id: string;
  title: string;
  training_type: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  instructor_name: string | null;
  instructor_email: string | null;
  location: string | null;
  color: string;
  is_active: boolean;
  soc: string;
  is_recurring: boolean;
  specific_date: string | null;
}

interface Enrollment {
  id: string;
  schedule_id: string;
  collaborator_id: string;
  collaborator_name: string;
  scheduled_date: string;
  google_event_id?: string;
  enrolled_by_name?: string;
  enrolled_at?: string;
}

interface Collaborator {
  id: string;
  name: string;
  role: string;
  soc: string;
  leader: string;
  sector: string;
}

interface AuditLog {
  id: string;
  schedule_id: string;
  schedule_title: string;
  action: string;
  collaborator_name: string;
  scheduled_date: string;
  performed_by: string;
  created_at: string;
}

function getWeekDates(baseDate: Date): Date[] {
  const day = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}



export default function SchedulePage() {
  const { isAdmin, isLider, isPcp, profile } = useAuth();
  const canManageEnrollments = isAdmin || isLider || isPcp;

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [completedTrainings, setCompletedTrainings] = useState<{ collaborator_id: string; training_type: string }[]>([]);
  const [weekBase, setWeekBase] = useState<Date>(new Date());
  const weekDates = getWeekDates(weekBase);

  // Panel state
  const [selectedSlot, setSelectedSlot] = useState<{ schedule: Schedule; date: Date } | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [collabSearch, setCollabSearch] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [socFilter, setSocFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState<'calendar' | 'history'>('calendar');
  const [socList, setSocList] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [areaFilter, setAreaFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'trained' | 'pending'>('ALL');

  // New schedule form
  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState({
    title: '', training_type: 'RECEBIMENTO', day_of_week: 1,
    start_time: '10:00', end_time: '11:00',
    instructor_name: '', instructor_email: '', location: 'SPX BR', color: '#EE4D2D', soc: 'SPX BR',
    is_recurring: true, specific_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [{ data: sch }, { data: enr }, { data: col }] = await Promise.all([
        supabase.from('training_schedules').select('*').eq('is_active', true).order('day_of_week').order('start_time'),
        supabase.from('training_schedule_enrollments').select('*').order('enrolled_at', { ascending: false }),
        supabase.from('collaborators').select('id, name, role, soc, leader, sector').order('name'),
      ]);
      setSchedules(sch ?? []);
      setEnrollments(enr ?? []);
      setCollaborators(col ?? []);
      const socs = [...new Set((sch ?? []).map((s: Schedule) => s.soc).filter(Boolean))];
      setSocList(socs as string[]);
      // Audit log (tabela pode não existir ainda)
      try {
        const { data: logs } = await supabase.from('schedule_audit_log').select('*').order('created_at', { ascending: false }).limit(200);
        setAuditLogs(logs ?? []);
      } catch { setAuditLogs([]); }
      // Treinamentos concluídos (para status Certificado/Pendente)
      try {
        const { data: tc } = await supabase.from('trainings_completed').select('collaborator_id, training_type');
        setCompletedTrainings(tc ?? []);
      } catch { setCompletedTrainings([]); }
    } catch (err) { console.error('[Schedule] Erro ao carregar dados:', err); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const slotEnrollments = selectedSlot
    ? enrollments.filter(e => e.schedule_id === selectedSlot.schedule.id && e.scheduled_date === toLocalISODate(selectedSlot.date))
    : [];

  // D+2: só permite inscrever em datas >= hoje + 2 dias
  const minEnrollDate = new Date();
  minEnrollDate.setDate(minEnrollDate.getDate() + 2);
  minEnrollDate.setHours(0, 0, 0, 0);
  const canEnrollDate = selectedSlot ? selectedSlot.date >= minEnrollDate : false;

  // Filtra colaboradores: SOC do slot + leader do perfil (se líder) + área
  const filteredCollabs = collaborators.filter(c => {
    if (!c.name.toLowerCase().includes(collabSearch.toLowerCase())) return false;
    if (slotEnrollments.find(e => e.collaborator_id === c.id)) return false;
    if (selectedSlot && c.soc !== selectedSlot.schedule.soc) return false;
    if (isLider && profile?.leader_key && c.leader?.toUpperCase() !== profile.leader_key.trim().toUpperCase()) return false;
    const area = c.sector?.trim() || '';
    if (areaFilter !== 'ALL') {
      if (areaFilter === 'SEM_AREA' && area !== '') return false;
      if (areaFilter !== 'SEM_AREA' && area.toUpperCase() !== areaFilter.toUpperCase()) return false;
    }
    if (roleFilter !== 'ALL' && c.role !== roleFilter) return false;
    if (statusFilter !== 'ALL') {
      const trained = isTrained(c);
      if (statusFilter === 'trained' && !trained) return false;
      if (statusFilter === 'pending' && trained) return false;
    }
    return true;
  });

  // Verifica se colaborador está certificado (mesma lógica de CollaboratorsPage)
  function isTrained(c: Collaborator): boolean {
    return completedTrainings.some(t => {
      if (t.collaborator_id !== c.id) return false;
      const tName = t.training_type?.toUpperCase() || '';
      const cSec = c.sector?.toUpperCase() || '';
      const cRole = c.role?.toUpperCase() || '';
      if (cSec && (tName.includes(cSec) || cSec.includes(tName))) return true;
      if (cRole && (tName.includes(cRole) || cRole.includes(tName))) return true;
      const isOp = cSec === 'RECEBIMENTO' || cSec === 'PROCESSAMENTO' || cSec === 'EXPEDIÇÃO' || cSec === 'EXPEDICAO';
      if (tName.includes('ONBOARDING') && isOp) return true;
      return false;
    });
  }

  // Listas únicas para os filtros
  const socCollabs = collaborators.filter(c => selectedSlot ? c.soc === selectedSlot.schedule.soc : true);
  const areaOptions = [...new Set(socCollabs.map(c => c.sector?.trim()).filter(Boolean))].sort();
  const roleOptions = [...new Set(socCollabs.map(c => c.role?.trim()).filter(Boolean))].sort();

  const buildEventDateTime = (date: Date, time: string) => {
    const [h, m] = time.split(':');
    const d = new Date(date);
    d.setHours(+h, +m, 0, 0);
    // Format as ISO with -03:00 (Brasília)
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00-03:00`;
  };

  const handleEnroll = async (collab: Collaborator) => {
    if (!selectedSlot || !canManageEnrollments) return;
    setEnrolling(true);
    const { schedule, date } = selectedSlot;
    const dateStr = toLocalISODate(date);
    const currentEnrollments = enrollments.filter(
      e => e.schedule_id === schedule.id && e.scheduled_date === dateStr
    );
    const existingEventId = currentEnrollments[0]?.google_event_id ?? null;

    const { error } = await supabase.from('training_schedule_enrollments').insert({
      schedule_id: schedule.id,
      collaborator_id: collab.id,
      collaborator_name: collab.name,
      scheduled_date: dateStr,
      google_event_id: existingEventId,
      enrolled_by_name: profile?.full_name ?? 'Sistema',
    });

    if (error) { toast.error('Erro ao inscrever'); }
    else {
      toast.success(`${collab.name} inscrito!`);
      await supabase.from('schedule_audit_log').insert({
        schedule_id: schedule.id,
        schedule_title: schedule.title,
        action: 'INSCRICAO',
        collaborator_name: collab.name,
        scheduled_date: dateStr,
        performed_by: profile?.full_name ?? 'Sistema',
      });
    }
    await loadData();
    setEnrolling(false);
  };

  const handleUnenroll = async (enrollmentId: string, name: string) => {
    if (!selectedSlot) return;
    const { error } = await supabase.from('training_schedule_enrollments').delete().eq('id', enrollmentId);
    if (error) toast.error('Erro ao remover inscrição');
    else {
      toast.success(`${name} removido`);
      await supabase.from('schedule_audit_log').insert({
        schedule_id: selectedSlot.schedule.id,
        schedule_title: selectedSlot.schedule.title,
        action: 'EXCLUSAO',
        collaborator_name: name,
        scheduled_date: toLocalISODate(selectedSlot.date),
        performed_by: profile?.full_name ?? 'Sistema',
      });
      await loadData();
    }
  };

  const handleSaveSchedule = async () => {
    if (!form.title || !form.start_time || !form.end_time) { toast.error('Preencha todos os campos obrigatórios'); return; }
    if (!form.is_recurring && !form.specific_date) { toast.error('Selecione a data específica'); return; }
    setSaving(true);
    const payload = {
      ...form,
      specific_date: form.is_recurring ? null : form.specific_date || null,
      day_of_week: form.is_recurring ? form.day_of_week : (form.specific_date ? new Date(form.specific_date + 'T12:00:00').getDay() : form.day_of_week),
    };
    if (editingSchedule) {
      const { error } = await supabase.from('training_schedules').update(payload).eq('id', editingSchedule.id);
      if (error) toast.error('Erro ao salvar');
      else { toast.success('Agenda atualizada!'); setEditingSchedule(null); setShowNewForm(false); await loadData(); }
    } else {
      const { error } = await supabase.from('training_schedules').insert(payload);
      if (error) toast.error('Erro ao criar agenda');
      else { toast.success('Agenda criada!'); setShowNewForm(false); await loadData(); }
    }
    setSaving(false);
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('Remover este slot da agenda?')) return;
    // Cancel associated Google Calendar events
    const relatedEnrollments = enrollments.filter(e => e.schedule_id === id);
    const eventIds = [...new Set(relatedEnrollments.map(e => e.google_event_id).filter(Boolean))];
    for (const eid of eventIds) {
      try { await deleteCalendarEvent(eid); } catch (_) { /* non-blocking */ }
    }
    await supabase.from('training_schedules').delete().eq('id', id);
    toast.success('Slot removido e eventos cancelados'); await loadData();
  };

  const startEdit = (s: Schedule) => {
    setForm({
      title: s.title, training_type: s.training_type,
      day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time,
      instructor_name: s.instructor_name ?? '', instructor_email: s.instructor_email ?? '',
      location: s.location ?? 'SPX BR', color: s.color, soc: s.soc ?? 'SPX BR',
      is_recurring: s.is_recurring ?? true, specific_date: s.specific_date ?? '',
    });
    setEditingSchedule(s);
    setShowNewForm(true);
    setShowAdminPanel(true);
  };

  const today = toLocalISODate(new Date());

  // Time-grid calendar helpers
  const HOUR_HEIGHT = 60;
  const START_HOUR = 6;
  const END_HOUR = 22;
  const calendarHours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const timeToMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const getSchedulesForDate = (date: Date) => {
    const dow = date.getDay();
    const dateStr = toLocalISODate(date);
    return schedules.filter(s => {
      if (socFilter !== 'ALL' && s.soc !== socFilter) return false;
      if (s.is_recurring === false && s.specific_date) return s.specific_date === dateStr;
      return s.day_of_week === dow;
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Agenda de Treinamentos</h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">Visualize e gerencie os treinamentos semanais</p>
        </div>
        <div className="flex items-center gap-2">
          {/* SOC Filter */}
          <select value={socFilter} onChange={e => setSocFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-white border border-gray-100 text-[11px] font-black text-gray-600 outline-none shadow-sm">
            <option value="ALL">Todas SOCs</option>
            {socList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* Tabs */}
          <div className="flex bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <button onClick={() => setActiveTab('calendar')}
              className={`px-3 py-2 text-[11px] font-black transition-colors ${activeTab === 'calendar' ? 'bg-[#EE4D2D] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              <CalendarDays size={14} className="inline mr-1"/>Calendário
            </button>
            <button onClick={() => setActiveTab('history')}
              className={`px-3 py-2 text-[11px] font-black transition-colors border-l border-gray-100 ${activeTab === 'history' ? 'bg-[#EE4D2D] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              <History size={14} className="inline mr-1"/>Histórico
            </button>
          </div>
          {/* Week navigation */}
          <div className="flex items-center bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <button onClick={() => { const d = new Date(weekBase); d.setDate(d.getDate()-7); setWeekBase(d); }}
              className="px-3 py-2 hover:bg-gray-50 transition-colors text-gray-500">
              <ChevronLeft size={16}/>
            </button>
            <button onClick={() => setWeekBase(new Date())}
              className="px-4 py-2 text-[11px] font-black uppercase text-gray-500 hover:bg-gray-50 border-x border-gray-100">
              Hoje
            </button>
            <button onClick={() => { const d = new Date(weekBase); d.setDate(d.getDate()+7); setWeekBase(d); }}
              className="px-3 py-2 hover:bg-gray-50 transition-colors text-gray-500">
              <ChevronRight size={16}/>
            </button>
          </div>
          {isAdmin && (
            <button onClick={() => { setShowAdminPanel(v => !v); setShowNewForm(false); setEditingSchedule(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-black transition-all shadow-sm ${showAdminPanel ? 'bg-[#EE4D2D] text-white' : 'bg-white border border-gray-200 text-gray-700 hover:border-[#EE4D2D]/40'}`}>
              <Settings size={15}/> Configurar
            </button>
          )}
        </div>
      </div>

      {/* Admin Panel */}
      {isAdmin && showAdminPanel && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-gray-900 text-sm">Slots Cadastrados</h2>
            <button onClick={() => { setShowNewForm(v => !v); setEditingSchedule(null); setForm({ title:'', training_type:'RECEBIMENTO', day_of_week:1, start_time:'10:00', end_time:'11:00', instructor_name:'', instructor_email:'', location:'SPX BR', color:'#EE4D2D', soc: 'SPX BR', is_recurring: true, specific_date: '' }); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#EE4D2D] text-white text-[11px] font-black rounded-lg hover:bg-[#D04426] transition-colors">
              <Plus size={13}/> Novo Slot
            </button>
          </div>

          {showNewForm && (
            <div className="border border-dashed border-[#EE4D2D]/30 rounded-xl p-4 bg-[#FEF6F5]/50 grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="col-span-2 md:col-span-3">
                <label className="text-[10px] font-black text-gray-500 uppercase">Título *</label>
                <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))}
                  placeholder="Ex: Recebimento FM" className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#EE4D2D]/20"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">Tipo</label>
                <select value={form.training_type} onChange={e => setForm(f => ({...f, training_type: e.target.value}))}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none">
                  {['RECEBIMENTO','PROCESSAMENTO','EXPEDIÇÃO','TRATATIVAS','HSE','PEOPLE','ONBOARDING'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">Recorrência *</label>
                <select value={form.is_recurring ? 'recurring' : 'specific'} onChange={e => setForm(f => ({...f, is_recurring: e.target.value === 'recurring', specific_date: ''}))}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none">
                  <option value="recurring">Recorrente (toda semana)</option>
                  <option value="specific">Data específica</option>
                </select>
              </div>
              <div>
                {form.is_recurring ? (
                  <>
                    <label className="text-[10px] font-black text-gray-500 uppercase">Dia da Semana *</label>
                    <select value={form.day_of_week} onChange={e => setForm(f => ({...f, day_of_week: +e.target.value}))}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none">
                      {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <label className="text-[10px] font-black text-gray-500 uppercase">Data *</label>
                    <input type="date" value={form.specific_date} onChange={e => setForm(f => ({...f, specific_date: e.target.value}))}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none"/>
                  </>
                )}
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">Cor</label>
                <input type="color" value={form.color} onChange={e => setForm(f => ({...f, color: e.target.value}))}
                  className="w-full mt-1 h-9 rounded-lg border border-gray-200 cursor-pointer"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">Início *</label>
                <input type="time" value={form.start_time} onChange={e => setForm(f => ({...f, start_time: e.target.value}))}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">Fim *</label>
                <input type="time" value={form.end_time} onChange={e => setForm(f => ({...f, end_time: e.target.value}))}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">Local</label>
                <input value={form.location} onChange={e => setForm(f => ({...f, location: e.target.value}))}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">Instrutor</label>
                <input value={form.instructor_name} onChange={e => setForm(f => ({...f, instructor_name: e.target.value}))}
                  placeholder="Nome do instrutor" className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">E-mail do Instrutor</label>
                <input type="email" value={form.instructor_email} onChange={e => setForm(f => ({...f, instructor_email: e.target.value}))}
                  placeholder="instrutor@shopee.com" className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase">SOC</label>
                <input value={form.soc} onChange={e => setForm(f => ({...f, soc: e.target.value}))}
                  placeholder="Ex: SPX BR" className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none"/>
              </div>
              <div className="col-span-2 md:col-span-3 flex gap-2 justify-end">
                <button onClick={() => { setShowNewForm(false); setEditingSchedule(null); }}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button onClick={handleSaveSchedule} disabled={saving}
                  className="px-5 py-2 rounded-lg bg-[#EE4D2D] text-white text-sm font-black hover:bg-[#D04426] transition-colors disabled:opacity-60">
                  {saving ? 'Salvando...' : editingSchedule ? 'Atualizar' : 'Criar Slot'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {schedules.map(s => (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-white transition-colors">
                <div className="w-3 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }}/>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-gray-900 text-sm truncate">{s.title}</p>
                  <p className="text-[10px] text-gray-500">{DAYS[s.day_of_week]} • {s.start_time}–{s.end_time}</p>
                  {s.instructor_name && <p className="text-[10px] text-gray-400">{s.instructor_name}</p>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(s)} className="p-1.5 text-gray-400 hover:text-[#EE4D2D] hover:bg-[#FEF6F5] rounded-lg transition-colors"><Settings size={13}/></button>
                  <button onClick={() => handleDeleteSchedule(s.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={13}/></button>
                </div>
              </div>
            ))}
            {schedules.length === 0 && (
              <p className="col-span-3 text-center text-gray-400 text-sm py-6">Nenhum slot cadastrado. Clique em "Novo Slot" para começar.</p>
            )}
          </div>
        </div>
      )}

      {/* Calendar / History Toggle */}
      {activeTab === 'history' ? (
        /* History Tab */
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-50 flex items-center justify-between">
            <h2 className="font-black text-gray-900 text-sm flex items-center gap-2"><History size={15}/> Histórico de Ações</h2>
            {isAdmin && auditLogs.length > 0 && (
              <button onClick={async () => {
                if (!confirm('Limpar todo o histórico?')) return;
                await supabase.from('schedule_audit_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                toast.success('Histórico limpo');
                await loadData();
              }} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-500 text-[10px] font-black rounded-lg hover:bg-red-100 transition-colors">
                <Trash2 size={12}/> Limpar Tudo
              </button>
            )}
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase text-gray-400">Data/Hora</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase text-gray-400">Ação</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase text-gray-400">Treinamento</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase text-gray-400">Colaborador</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase text-gray-400">Executado por</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase text-gray-400">Sessão</th>
                  {isAdmin && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {auditLogs.map(log => (
                  <tr key={log.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{new Date(log.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${log.action === 'INSCRICAO' ? 'bg-green-50 text-green-600' : log.action === 'CONVITE_CANCELADO' ? 'bg-orange-50 text-orange-500' : 'bg-red-50 text-red-500'}`}>
                        {log.action === 'INSCRICAO' ? '+ Inscrito' : log.action === 'CONVITE_CANCELADO' ? '✕ Convite' : '− Removido'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-bold text-gray-800">{log.schedule_title}</td>
                    <td className="px-4 py-2.5 text-gray-700">{log.collaborator_name}</td>
                    <td className="px-4 py-2.5 text-gray-500">{log.performed_by}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{log.scheduled_date}</td>
                    {isAdmin && (
                      <td className="px-2">
                        <button onClick={async () => {
                          await supabase.from('schedule_audit_log').delete().eq('id', log.id);
                          await loadData();
                        }} className="p-1 text-gray-300 hover:text-red-400 rounded transition-colors"><Trash2 size={12}/></button>
                      </td>
                    )}
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-gray-300 text-xs italic">Nenhuma ação registrada</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Day Headers */}
        <div className="grid border-b border-gray-100" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
          <div className="p-2 border-r border-gray-50" />
          {weekDates.map((date, i) => {
            const isToday = toLocalISODate(date) === today;
            return (
              <div key={i} className={`p-2 text-center border-r last:border-r-0 border-gray-50 ${isToday ? 'bg-[#FEF6F5]' : ''}`}>
                <p className={`text-[10px] font-black uppercase ${isToday ? 'text-[#EE4D2D]' : 'text-gray-400'}`}>{DAYS_SHORT[date.getDay()]}</p>
                <p className={`text-lg font-black mt-0.5 ${isToday ? 'text-[#EE4D2D]' : 'text-gray-800'}`}>{date.getDate()}</p>
                <p className="text-[9px] text-gray-300 font-medium">{date.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'America/Sao_Paulo' })}</p>
              </div>
            );
          })}
        </div>

        {/* Time Grid Body */}
        <div className="overflow-y-auto max-h-[520px]">
          <div className="grid relative" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
            {/* Hour labels + grid lines */}
            {calendarHours.map(h => (
              <div key={h} className="contents">
                <div className="border-r border-gray-50 border-b border-gray-50 flex items-start justify-end pr-2 pt-0.5" style={{ height: HOUR_HEIGHT }}>
                  <span className="text-[9px] font-bold text-gray-300">{String(h).padStart(2,'0')}:00</span>
                </div>
                {weekDates.map((_, di) => (
                  <div key={di} className="border-r last:border-r-0 border-b border-gray-50" style={{ height: HOUR_HEIGHT }} />
                ))}
              </div>
            ))}

            {/* Schedule cards (absolute positioned over grid) */}
            {weekDates.map((date, colIdx) => {
              const daySchedules = getSchedulesForDate(date);
              const dateStr = toLocalISODate(date);
              return daySchedules.map(sch => {
                const startMin = timeToMinutes(sch.start_time);
                const endMin = timeToMinutes(sch.end_time);
                const topPx = ((startMin / 60) - START_HOUR) * HOUR_HEIGHT;
                const heightPx = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT - 4, 28);
                const count = enrollments.filter(e => e.schedule_id === sch.id && e.scheduled_date === dateStr).length;
                const isSelected = selectedSlot?.schedule.id === sch.id && toLocalISODate(selectedSlot.date) === dateStr;
                return (
                  <button key={`${sch.id}-${dateStr}`}
                    onClick={() => setSelectedSlot(isSelected ? null : { schedule: sch, date })}
                    className={`absolute rounded-lg px-1.5 py-1 text-left transition-all overflow-hidden ${isSelected ? 'ring-2 ring-offset-1 shadow-lg z-10' : 'hover:shadow-md hover:z-10'}`}
                    style={{
                      top: topPx,
                      height: heightPx,
                      left: `calc(56px + ${colIdx} * ((100% - 56px) / 7) + 2px)`,
                      width: `calc((100% - 56px) / 7 - 4px)`,
                      backgroundColor: sch.color + '22',
                      borderLeft: `3px solid ${sch.color}`,
                    }}
                  >
                    <p className="text-[9px] font-black leading-tight truncate" style={{ color: sch.color }}>{sch.title}</p>
                    <p className="text-[8px] text-gray-500 truncate">{sch.start_time}–{sch.end_time}</p>
                    {count > 0 && (
                      <span className="text-[8px] font-black" style={{ color: sch.color }}>👥 {count}</span>
                    )}
                  </button>
                );
              });
            })}
          </div>
        </div>
      </div>
      )}

      {/* Enrollment Side Panel */}
      {selectedSlot && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-50 flex items-center justify-between" style={{ borderTopColor: selectedSlot.schedule.color, borderTopWidth: 3 }}>
            <div>
              <h2 className="font-black text-gray-900">{selectedSlot.schedule.title}</h2>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                <span className="flex items-center gap-1"><CalendarDays size={11}/>
                  {selectedSlot.date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo' })}
                </span>
                <span className="flex items-center gap-1"><Clock size={11}/>{selectedSlot.schedule.start_time}–{selectedSlot.schedule.end_time}</span>
                {selectedSlot.schedule.instructor_name && <span className="flex items-center gap-1"><User size={11}/>{selectedSlot.schedule.instructor_name}</span>}
                {selectedSlot.schedule.location && <span className="flex items-center gap-1"><MapPin size={11}/>{selectedSlot.schedule.location}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {slotEnrollments.length > 0 && selectedSlot.schedule.instructor_email && (
                <button
                  onClick={async () => {
                    const { schedule, date } = selectedSlot;
                    const dateStr = toLocalISODate(date);
                    const names = slotEnrollments.map(e => e.collaborator_name);
                    const description = `Treinamento: ${schedule.training_type}\nInstrutor: ${schedule.instructor_name ?? '-'}\nLocal: ${schedule.location ?? 'SPX BR'}\n\nParticipantes (${names.length}):\n${names.join('\n')}`;
                    const existingEventId = slotEnrollments[0]?.google_event_id;
                    try {
                      if (existingEventId) {
                        await updateCalendarEvent(existingEventId, description);
                        toast.success('Evento atualizado no Google Calendar!', { icon: '📅' });
                      } else {
                        const eventId = await createCalendarEvent({
                          summary: `[TREINAMENTO] ${schedule.title}`,
                          description,
                          location: schedule.location ?? 'SPX BR',
                          startDateTime: buildEventDateTime(date, schedule.start_time),
                          endDateTime: buildEventDateTime(date, schedule.end_time),
                          attendeeEmail: schedule.instructor_email,
                        });
                        await supabase.from('training_schedule_enrollments')
                          .update({ google_event_id: eventId })
                          .eq('schedule_id', schedule.id).eq('scheduled_date', dateStr);
                        toast.success('Convite enviado ao instrutor!', { icon: '📅' });
                        await loadData();
                      }
                    } catch (err: any) {
                      toast.error(`Erro: ${err.message}`);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-600 text-[11px] font-black rounded-lg hover:bg-blue-100 transition-colors">
                  <Send size={13}/> {slotEnrollments[0]?.google_event_id ? 'Atualizar Convite' : 'Enviar Convite'}
                </button>
              )}
              {/* Cancel invite button */}
              {slotEnrollments[0]?.google_event_id && (
                <button
                  onClick={async () => {
                    const eventId = slotEnrollments[0].google_event_id!;
                    const { schedule, date } = selectedSlot;
                    const dateStr = toLocalISODate(date);
                    try {
                      await deleteCalendarEvent(eventId);
                      await supabase.from('schedule_audit_log').insert({
                        schedule_id: schedule.id,
                        schedule_title: schedule.title,
                        action: 'CONVITE_CANCELADO',
                        collaborator_name: `${slotEnrollments.length} participante(s)`,
                        scheduled_date: dateStr,
                        performed_by: profile?.full_name ?? 'Sistema',
                      });
                      await supabase.from('training_schedule_enrollments')
                        .delete()
                        .eq('schedule_id', schedule.id).eq('scheduled_date', dateStr);
                      toast.success('Convite cancelado e inscritos removidos!', { icon: '🗑️' });
                      setSelectedSlot(null);
                      await loadData();
                    } catch (err: any) {
                      toast.error(`Erro ao cancelar: ${err.message}`);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-500 text-[11px] font-black rounded-lg hover:bg-red-100 transition-colors">
                  <Trash2 size={13}/> Cancelar Convite
                </button>
              )}
              <button onClick={() => setSelectedSlot(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"><X size={16}/></button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 divide-x divide-gray-50">
            {/* Enrolled List */}
            <div className="p-5">
              <h3 className="text-[11px] font-black uppercase text-gray-500 mb-3 flex items-center gap-2">
                <Users size={13}/> Inscritos ({slotEnrollments.length})
              </h3>
              {slotEnrollments.length === 0 ? (
                <p className="text-gray-300 text-xs italic py-6 text-center">Nenhum colaborador inscrito nesta sessão</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {slotEnrollments.map(e => (
                    <li key={e.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl">
                      <div>
                        <p className="text-sm font-bold text-gray-800">{e.collaborator_name}</p>
                      </div>
                      {canManageEnrollments && (
                        <button onClick={() => handleUnenroll(e.id, e.collaborator_name)}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={13}/></button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Add Collaborators */}
            {canManageEnrollments && (
              <div className="p-5">
                <h3 className="text-[11px] font-black uppercase text-gray-500 mb-3">Adicionar Colaborador</h3>
                {!canEnrollDate ? (
                  <div className="text-center py-6">
                    <p className="text-xs text-orange-500 font-bold">⚠️ Inscrições disponíveis apenas em D+2</p>
                    <p className="text-[10px] text-gray-400 mt-1">Mínimo: {minEnrollDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 mb-2">
                      <input value={collabSearch} onChange={e => setCollabSearch(e.target.value)}
                        placeholder="Buscar pelo nome..."
                        className="flex-1 px-3 py-2 rounded-xl border border-gray-100 text-sm outline-none focus:ring-2 focus:ring-[#EE4D2D]/20 shadow-sm"/>
                    </div>
                    <div className="flex gap-2 mb-3">
                      <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)}
                        className="flex-1 px-2 py-1.5 rounded-lg border border-gray-100 text-[10px] font-black text-gray-600 outline-none shadow-sm">
                        <option value="ALL">Todas Áreas</option>
                        {areaOptions.map(r => <option key={r} value={r}>{r}</option>)}
                        <option value="SEM_AREA">Sem área cadastrada</option>
                      </select>
                      <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
                        className="flex-1 px-2 py-1.5 rounded-lg border border-gray-100 text-[10px] font-black text-gray-600 outline-none shadow-sm">
                        <option value="ALL">Todos Cargos</option>
                        {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'ALL' | 'trained' | 'pending')}
                        className={`flex-1 px-2 py-1.5 rounded-lg border text-[10px] font-black outline-none shadow-sm ${statusFilter === 'trained' ? 'border-emerald-200 text-emerald-600 bg-emerald-50' : statusFilter === 'pending' ? 'border-orange-200 text-orange-600 bg-orange-50' : 'border-gray-100 text-gray-600'}`}>
                        <option value="ALL">Todos Status</option>
                        <option value="trained">✅ Certificado</option>
                        <option value="pending">⏳ Pendente</option>
                      </select>
                    </div>
                    <ul className="space-y-1.5 max-h-60 overflow-y-auto">
                      {filteredCollabs.map(c => {
                        const trained = isTrained(c);
                        return (
                        <li key={c.id}>
                          <button onClick={() => handleEnroll(c)} disabled={enrolling}
                            className="w-full text-left p-2.5 rounded-xl hover:bg-[#FEF6F5] transition-colors group border border-transparent hover:border-[#EE4D2D]/10">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-bold text-gray-800 group-hover:text-[#EE4D2D] transition-colors">{c.name}</p>
                              <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${trained ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>
                                {trained ? 'CERTIFICADO' : 'PENDENTE'}
                              </span>
                            </div>
                            <p className="text-[9px] text-gray-400 uppercase">{c.role} • {c.sector || 'Sem área'} • {c.soc}</p>
                          </button>
                        </li>
                        );
                      })}
                      {filteredCollabs.length === 0 && collabSearch && (
                        <li className="text-center text-gray-300 text-xs italic py-4">Nenhum colaborador encontrado</li>
                      )}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
