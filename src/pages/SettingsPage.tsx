import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Trash2, Shield, X, UserPlus, GraduationCap } from 'lucide-react';
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
    const [{ data: u }, { data: s }, { data: inst }] = await Promise.all([
      supabase.from('users_profiles').select('*').order('full_name'),
      supabase.from('socs').select('id, name').order('name'),
      supabase.from('instructors').select('*').order('name'),
    ]);
    setUsers(u ?? []);
    setSocs(s ?? []);
    setInstructors(inst ?? []);
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
    if (!newUserName || !newUserEmail || !newUserPassword) {
      toast.error('Preencha os dados do usuário');
      return;
    }
    setCreatingUser(true);

    const { data: authData, error: authError } = await supaSecondary.auth.signUp({
      email: newUserEmail,
      password: newUserPassword,
      options: { data: { full_name: newUserName } }
    });

    if (authError) {
      toast.error('Erro ao Criar Login: ' + authError.message);
      setCreatingUser(false);
      return;
    }

    const userId = authData.user?.id;
    if (userId) {
      const { error: profileError } = await supabase.from('users_profiles').insert({
        id: userId,
        email: newUserEmail,
        full_name: newUserName,
        role: newUserRole
      });

      if (profileError) {
        toast.error('Login criado, porém erro ao registrar Perfil: ' + profileError.message);
      } else {
        toast.success(`Usuário ${newUserName} criado com sucesso!`);
        setShowNewUser(false);
        setNewUserName('');
        setNewUserEmail('');
        setNewUserPassword('');
        setNewUserRole('user');
        fetchAll();
      }
    }
    setCreatingUser(false);
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
                <button onClick={() => deleteUser(u.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-destructive hover:bg-destructive/20 transition-all">
                  <Trash2 size={16} />
                </button>
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
    </div>
  );
}
