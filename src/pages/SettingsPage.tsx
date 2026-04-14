import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Trash2, Shield, X, UserPlus, GraduationCap, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface Soc {
  id: string;
  name: string;
}

interface Instructor {
  id: string;
  name: string;
  soc_name: string;
  created_at: string;
}

interface TrainingItem {
  id: string;
  name: string;
}

const supabaseUrl = 'https://fezfsekzxtvozyemlncn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlemZzZWt6eHR2b3p5ZW1sbmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjUwNjUsImV4cCI6MjA5MTQwMTA2NX0.Gllxc-Qgr-iBKie6K0Ofr1B23Vz_5VPSgn_wJjF5EFc';

// Cliente secundário para não deslogar o Admin
const supaSecondary = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [socs, setSocs] = useState<Soc[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [trainings, setTrainings] = useState<TrainingItem[]>([]);

  // Manage Questions
  const [managingTraining, setManagingTraining] = useState<TrainingItem | null>(null);
  const [mgmtQuestions, setMgmtQuestions] = useState<any[]>([]);
  const [showQForm, setShowQForm] = useState(false);
  const [qForm, setQForm] = useState({ id: '', question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'a', order_num: 1 });

  // Edit User
  const [showEditUser, setShowEditUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserRole, setEditUserRole] = useState('user');
  const [savingUserEdit, setSavingUserEdit] = useState(false);

  // New User
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('user');
  const [creatingUser, setCreatingUser] = useState(false);

  // New Instructor
  const [showNewInstructor, setShowNewInstructor] = useState(false);
  const [newInstructorName, setNewInstructorName] = useState('');
  const [newInstructorSoc, setNewInstructorSoc] = useState('');
  const [savingInstructor, setSavingInstructor] = useState(false);

  const fetchAll = async () => {
    const [{ data: u }, { data: s }, { data: inst }, { data: tr }] = await Promise.all([
      supabase.from('users_profiles').select('*').order('full_name'),
      supabase.from('socs').select('id, name').order('name'),
      supabase.from('instructors').select('*').order('name'),
      supabase.from('trainings').select('id, name').order('name'),
    ]);
    setUsers(u ?? []);
    setSocs(s ?? []);
    setInstructors(inst ?? []);
    setTrainings(tr ?? []);
  };

  useEffect(() => {
    if (!isAdmin) return;
    fetchAll();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const deleteUser = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este perfil?')) return;
    await supabase.from('users_profiles').delete().eq('id', id);
    fetchAll();
    toast.success('Perfil de usuário removido');
  };

  const createUser = async () => {
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()) {
      toast.error('Preencha os dados do usuário');
      return;
    }
    setCreatingUser(true);

    const { data: authData, error: authError } = await supaSecondary.auth.signUp({
      email: newUserEmail.trim(),
      password: newUserPassword.trim(),
      options: { 
        data: { 
          full_name: newUserName.trim(),
          role: newUserRole
        } 
      }
    });

    if (authError) {
      toast.error('Erro ao Criar Login: ' + authError.message);
      setCreatingUser(false);
      return;
    }

    toast.success(`Usuário ${newUserName} criado com sucesso! Perfil sincronizado automaticamente.`);
    setShowNewUser(false);
    setNewUserName('');
    setNewUserEmail('');
    setNewUserPassword('');
    setNewUserRole('user');
    fetchAll();
    setCreatingUser(false);
  };

  const openEditUser = (user: UserProfile) => {
    setEditingUserId(user.id);
    setEditUserName(user.full_name);
    setEditUserRole(user.role);
    setShowEditUser(true);
  };

  const saveEditedUser = async () => {
    if (!editUserName.trim()) {
      toast.error('Preencha o nome do usuário');
      return;
    }
    setSavingUserEdit(true);
    const { error } = await supabase.from('users_profiles').update({
      full_name: editUserName.trim(),
      role: editUserRole
    }).eq('id', editingUserId);

    if (error) {
      toast.error('Erro ao editar usuário: ' + error.message);
    } else {
      toast.success('Usuário atualizado com sucesso!');
      setShowEditUser(false);
      fetchAll();
    }
    setSavingUserEdit(false);
  };

  const saveInstructor = async () => {
    if (!newInstructorName.trim() || !newInstructorSoc) {
      toast.error('Preencha o nome e a unidade do instrutor');
      return;
    }
    setSavingInstructor(true);
    const { error } = await supabase.from('instructors').insert({
      name: newInstructorName.trim(),
      soc_name: newInstructorSoc,
    });
    if (error) {
      toast.error('Erro ao salvar instrutor: ' + error.message);
    } else {
      toast.success('Instrutor cadastrado com sucesso!');
      setShowNewInstructor(false);
      setNewInstructorName('');
      setNewInstructorSoc('');
      fetchAll();
    }
    setSavingInstructor(false);
  };

  const deleteInstructor = async (id: string) => {
    if (!confirm('Excluir este instrutor?')) return;
    await supabase.from('instructors').delete().eq('id', id);
    fetchAll();
    toast.success('Instrutor removido');
  };

  const openQuestionManager = async (t: TrainingItem) => {
    setManagingTraining(t);
    const { data } = await supabase.from('quiz_questions').select('*').eq('training_id', t.id).order('order_num');
    setMgmtQuestions(data ?? []);
  };

  const saveQuestion = async () => {
    if (!qForm.question || !qForm.option_a || !qForm.option_b || !qForm.option_c || !qForm.option_d) {
      toast.error('Preencha todos os campos da questão');
      return;
    }
    const payload = {
      training_id: managingTraining!.id,
      question: qForm.question,
      option_a: qForm.option_a,
      option_b: qForm.option_b,
      option_c: qForm.option_c,
      option_d: qForm.option_d,
      correct_option: qForm.correct_option,
      order_num: qForm.order_num
    };

    if (qForm.id) {
      await supabase.from('quiz_questions').update(payload).eq('id', qForm.id);
    } else {
      await supabase.from('quiz_questions').insert(payload);
    }

    toast.success('Questão salva com sucesso');
    setShowQForm(false);
    openQuestionManager(managingTraining!);
  };

  const deleteQuestion = async (id: string) => {
    if (!confirm('Excluir esta questão?')) return;
    await supabase.from('quiz_questions').delete().eq('id', id);
    toast.success('Questão removida');
    openQuestionManager(managingTraining!);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerenciamento de usuários e instrutores do sistema</p>
      </div>

      {/* Users */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield size={20} className="text-primary" /> Usuários do Sistema
          </h2>
          <button onClick={() => setShowNewUser(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-colors">
            <UserPlus size={16} /> Novo Usuário
          </button>
        </div>

        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 group">
              <div>
                <p className="text-sm font-medium text-foreground">{u.full_name}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                  {u.role}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditUser(u)} title="Editar" className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-muted-foreground hover:bg-secondary/80 transition-all">
                    <Edit2 size={16} />
                  </button>
                  <button onClick={() => deleteUser(u.id)} title="Excluir" className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-destructive hover:bg-destructive/20 transition-all">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {users.length === 0 && <p className="text-muted-foreground text-sm">Nenhum usuário cadastrado</p>}
        </div>
      </div>

      {/* Instructors */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-semibold text-foreground flex items-center gap-2">
            <GraduationCap size={20} className="text-primary" /> Instrutores de Treinamento
          </h2>
          <button onClick={() => setShowNewInstructor(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-colors">
            <Plus size={16} /> Novo Instrutor
          </button>
        </div>

        <div className="space-y-2">
          {instructors.map(inst => (
            <div key={inst.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 group">
              <div>
                <p className="text-sm font-medium text-foreground">{inst.name}</p>
                <p className="text-xs text-muted-foreground">{inst.soc_name}</p>
              </div>
              <button onClick={() => deleteInstructor(inst.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-destructive hover:bg-destructive/20 transition-all">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {instructors.length === 0 && <p className="text-muted-foreground text-sm">Nenhum instrutor cadastrado ainda.</p>}
        </div>
      </div>

      {/* Trainings Questions */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-semibold text-foreground flex items-center gap-2">
            <GraduationCap size={20} className="text-primary" /> Configuração de Provas (Treinamentos)
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {trainings.map(t => (
            <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 group">
              <span className="text-sm font-medium text-foreground truncate mr-2" title={t.name}>{t.name}</span>
              <button onClick={() => openQuestionManager(t)} className="opacity-0 group-hover:opacity-100 px-3 py-1.5 rounded-md text-primary bg-primary/10 hover:bg-primary/20 transition-all shadow-sm whitespace-nowrap text-xs font-semibold flex items-center gap-1">
                <Edit2 size={14} /> Configurar
              </button>
            </div>
          ))}
          {trainings.length === 0 && <p className="text-muted-foreground text-sm">Nenhum treinamento cadastrado.</p>}
        </div>
      </div>

      {/* New User Modal */}
      {showNewUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-border/40 rounded-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-display font-semibold text-foreground">Criar Novo Usuário</h3>
              <button onClick={() => setShowNewUser(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Nome Completo</label>
                <input value={newUserName} onChange={e => setNewUserName(e.target.value)} type="text" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">E-mail</label>
                <input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} type="email" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Senha Forte</label>
                <input value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} type="password" placeholder="Min. 6 caracteres" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Permissão</label>
                <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary">
                  <option value="user">Usuário Comum (Apenas consome)</option>
                  <option value="lider">Líder (Treinamentos + Meu Time)</option>
                  <option value="admin">Administrador (Cria/Edita)</option>
                </select>
              </div>
            </div>

            <button disabled={creatingUser} onClick={createUser} className="w-full mt-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:brightness-110 disabled:opacity-50 transition-all">
              {creatingUser ? 'Criando e Autenticando...' : 'Cadastrar Usuário'}
            </button>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-border/40 rounded-xl overflow-hidden p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-display font-semibold text-foreground">Editar Usuário</h3>
              <button onClick={() => setShowEditUser(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Nome Completo</label>
                <input value={editUserName} onChange={e => setEditUserName(e.target.value)} type="text" className="w-full px-3 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all" />
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Permissão de Acesso</label>
                <select value={editUserRole} onChange={e => setEditUserRole(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all">
                  <option value="user">Usuário Comum (Apenas consome)</option>
                  <option value="lider">Líder (Treinamentos + Meu Time)</option>
                  <option value="admin">Administrador (Cria/Edita tudo)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-3">
              <button onClick={() => setShowEditUser(false)} className="flex-1 py-2.5 rounded-lg bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-all">
                Cancelar
              </button>
              <button disabled={savingUserEdit} onClick={saveEditedUser} className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:brightness-110 disabled:opacity-50 transition-all shadow-glow">
                {savingUserEdit ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Instructor Modal */}
      {showNewInstructor && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-border/40 rounded-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-display font-semibold text-foreground">Cadastrar Instrutor</h3>
              <button onClick={() => setShowNewInstructor(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Nome Completo do Instrutor</label>
                <input value={newInstructorName} onChange={e => setNewInstructorName(e.target.value)} type="text" placeholder="Ex: Carlos Eduardo" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Unidade (SOC) onde atua</label>
                <select value={newInstructorSoc} onChange={e => setNewInstructorSoc(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary">
                  <option value="">Selecione uma SOC...</option>
                  {socs.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <button disabled={savingInstructor} onClick={saveInstructor} className="w-full mt-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:brightness-110 disabled:opacity-50 transition-all">
              {savingInstructor ? 'Salvando...' : 'Cadastrar Instrutor'}
            </button>
          </div>
        </div>
      )}

      {/* Manage Questions Modal */}
      {managingTraining && (
        <div className="fixed inset-0 z-[60] bg-background/95 backdrop-blur-md overflow-y-auto w-full h-full p-4 md:p-8">
          <div className="max-w-4xl mx-auto space-y-6">
            <button onClick={() => setManagingTraining(null)} className="text-sm text-primary hover:underline">← Voltar às Configurações</button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-display font-bold text-foreground">Gerenciar Prova</h1>
                <p className="text-muted-foreground">{managingTraining.name}</p>
              </div>
              <button onClick={() => { setQForm({ id: '', question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'a', order_num: mgmtQuestions.length + 1 }); setShowQForm(true); }} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:brightness-110">
                <Plus size={16} /> Nova Questão
              </button>
            </div>

            <div className="space-y-3">
              {mgmtQuestions.map(q => (
                <div key={q.id} className="glass-card p-4 flex justify-between gap-4">
                  <div>
                    <p className="font-bold text-primary text-sm mb-1">Questão {q.order_num}</p>
                    <p className="font-medium text-foreground mb-2">{q.question}</p>
                    <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                      <p className={q.correct_option === 'a' ? 'text-emerald-500 font-bold' : ''}>A) {q.option_a}</p>
                      <p className={q.correct_option === 'b' ? 'text-emerald-500 font-bold' : ''}>B) {q.option_b}</p>
                      <p className={q.correct_option === 'c' ? 'text-emerald-500 font-bold' : ''}>C) {q.option_c}</p>
                      <p className={q.correct_option === 'd' ? 'text-emerald-500 font-bold' : ''}>D) {q.option_d}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button onClick={() => { setQForm(q); setShowQForm(true); }} className="p-2 rounded-lg bg-secondary text-foreground hover:bg-primary/20 hover:text-primary"><Edit2 size={16}/></button>
                    <button onClick={() => deleteQuestion(q.id)} className="p-2 rounded-lg bg-secondary text-foreground hover:bg-destructive/20 hover:text-destructive"><Trash2 size={16}/></button>
                  </div>
                </div>
              ))}
              {mgmtQuestions.length === 0 && (
                <div className="text-center p-12 glass-card">
                  <p className="text-muted-foreground">Nenhuma questão cadastrada para esta prova.</p>
                </div>
              )}
            </div>

            {showQForm && (
              <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="w-full max-w-2xl bg-card border border-border/40 rounded-xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold">{qForm.id ? 'Editar Questão' : 'Nova Questão'}</h3>
                    <button onClick={() => setShowQForm(false)} className="text-muted-foreground hover:text-foreground"><X size={20}/></button>
                  </div>
                  <div className="space-y-4">
                    <div className="flex gap-4">
                      <div className="w-20">
                        <label className="text-xs text-muted-foreground block mb-1">Nº</label>
                        <input type="number" value={qForm.order_num} onChange={e => setQForm({...qForm, order_num: parseInt(e.target.value)||1})} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none" />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground block mb-1">Enunciado da Questão</label>
                        <textarea value={qForm.question} onChange={e => setQForm({...qForm, question: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none resize-none" rows={2}/>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-xs text-muted-foreground">Alternativa A</label><input value={qForm.option_a} onChange={e=>setQForm({...qForm, option_a: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm"/></div>
                      <div><label className="text-xs text-muted-foreground">Alternativa B</label><input value={qForm.option_b} onChange={e=>setQForm({...qForm, option_b: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm"/></div>
                      <div><label className="text-xs text-muted-foreground">Alternativa C</label><input value={qForm.option_c} onChange={e=>setQForm({...qForm, option_c: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm"/></div>
                      <div><label className="text-xs text-muted-foreground">Alternativa D</label><input value={qForm.option_d} onChange={e=>setQForm({...qForm, option_d: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm"/></div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Alternativa Correta</label>
                      <select value={qForm.correct_option} onChange={e => setQForm({...qForm, correct_option: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm outline-none">
                        <option value="a">A</option><option value="b">B</option><option value="c">C</option><option value="d">D</option>
                      </select>
                    </div>
                    <button onClick={saveQuestion} className="w-full py-3 bg-primary text-primary-foreground font-bold rounded-lg hover:brightness-110 mt-2">Salvar Questão</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
