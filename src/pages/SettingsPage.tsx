import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Trash2, Shield, X, UserPlus, GraduationCap, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  leader_key?: string | null;
  soc?: string | null;
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

interface SocMicroTraining {
  id: string;
  soc_name: string;
  macro_area: string;
  name: string;
  is_mandatory: boolean;
  order_num: number;
}

const ACCESS_LABELS: Record<string, string> = {
  master: 'Todas as unidades',
  admin:  'Acesso Total',
  lider:  'Gestão de Time',
  bpo:    'BPO Onboarding',
  pcp:    'PCP Agenda',
  user:   'Consulta Ltda',
};

// Operações de admin (criar/excluir usuário, redefinir senha) rodam na Edge Function
// `admin-users` — a service_role key nunca fica exposta no navegador. Ver
// supabase/functions/admin-users/index.ts.
async function callAdminUsers<T = { id: string }>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) return { data: null, error: error.message };
  if (data?.error) return { data: null, error: data.error as string };
  return { data: data as T, error: null };
}

export default function SettingsPage() {
  const { isAdmin, isMaster, profile, effectiveSoc } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [socs, setSocs] = useState<Soc[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [trainings, setTrainings] = useState<TrainingItem[]>([]);
  const [microTrainings, setMicroTrainings] = useState<SocMicroTraining[]>([]);

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
  const [editUserSoc, setEditUserSoc] = useState('');
  const [editLeaderKey, setEditLeaderKey] = useState('');
  // Unidades EXTRAS do usuário em edição (tabela user_soc_access). Só o
  // master vê e mexe nisto — a RLS recusa a escrita de qualquer outro.
  const [editExtraSocs, setEditExtraSocs] = useState<string[]>([]);
  const [savingUserEdit, setSavingUserEdit] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');

  // New User
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('user');
  const [newUserSoc, setNewUserSoc] = useState('');
  const [newUserPasswordConfirm, setNewUserPasswordConfirm] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  // New Instructor
  const [showNewInstructor, setShowNewInstructor] = useState(false);
  const [newInstructorName, setNewInstructorName] = useState('');
  const [savingInstructor, setSavingInstructor] = useState(false);

  // New / Edit Micro Training
  const [showNewMicro, setShowNewMicro] = useState(false);
  const [editingMicroId, setEditingMicroId] = useState<string | null>(null);
  const [editingMicroNameOriginal, setEditingMicroNameOriginal] = useState('');
  const [newMicroName, setNewMicroName] = useState('');
  const [newMicroArea, setNewMicroArea] = useState('RECEBIMENTO');
  const [newMicroMandatory, setNewMicroMandatory] = useState(false);
  const [savingMicro, setSavingMicro] = useState(false);

  // Drag and Drop refs para Micro Processos
  const dragItemMicro = useRef<number | null>(null);
  const dragOverItemMicro = useRef<number | null>(null);

  const handleDragSortMicro = async () => {
    if (dragItemMicro.current === null || dragOverItemMicro.current === null) return;
    if (dragItemMicro.current === dragOverItemMicro.current) return;
    
    const _microTrainings = [...microTrainings];
    const draggedItem = _microTrainings.splice(dragItemMicro.current, 1)[0];
    _microTrainings.splice(dragOverItemMicro.current, 0, draggedItem);
    
    setMicroTrainings(_microTrainings);
    
    dragItemMicro.current = null;
    dragOverItemMicro.current = null;

    const updates = _microTrainings.map((m, index) => 
       supabase.from('soc_micro_trainings').update({ order_num: index + 1 }).eq('id', m.id)
    );
    await Promise.all(updates);
    toast.success('Ordem dos processos atualizada!');
  };

  // Esta tela SEMPRE opera sobre uma unidade concreta: criar usuário,
  // instrutor ou processo micro exige um destino. Com o master vendo "todas
  // as unidades", effectiveSoc é nulo — então caímos na unidade de cadastro
  // dele, e um aviso no topo diz qual está sendo gerenciada.
  const managedSoc = effectiveSoc ?? profile?.soc ?? null;

  const fetchAll = async () => {
    if (!managedSoc) return;
    const [{ data: u }, { data: s }, { data: inst }, { data: tr }, { data: micro }] = await Promise.all([
      supabase.from('users_profiles').select('*').eq('soc', managedSoc).order('full_name'),
      supabase.from('socs').select('id, name').order('name'),
      supabase.from('instructors').select('*').eq('soc_name', managedSoc).order('name'),
      supabase.from('trainings').select('id, name').order('name'),
      supabase.from('soc_micro_trainings').select('*').eq('soc_name', managedSoc).order('order_num')
    ]);
    setUsers(u ?? []);
    setSocs(s ?? []);
    setInstructors(inst ?? []);
    setTrainings(tr ?? []);
    setMicroTrainings(micro ?? []);
  };

  useEffect(() => {
    if (!isAdmin || !managedSoc) return;
    fetchAll();
  }, [isAdmin, managedSoc]);

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const deleteUser = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este usuário permanentemente?')) return;

    const { error } = await callAdminUsers({ action: 'delete_user', id });

    if (error) {
      toast.error('Erro ao excluir usuário: ' + error);
    } else {
      toast.success('Usuário removido permanentemente');
    }

    fetchAll();
  };

  const createUser = async () => {
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()) {
      toast.error('Preencha todos os dados do usuário');
      return;
    }
    if (newUserPassword.trim().length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }
    if (newUserPassword.trim() !== newUserPasswordConfirm.trim()) {
      toast.error('As senhas não coincidem. Verifique a confirmação.');
      return;
    }
    setCreatingUser(true);

    try {
      // Criação roda na Edge Function admin-users — valida que o chamador é admin
      // e usa a service_role key só no servidor (nunca no navegador).
      const { error } = await callAdminUsers({
        action: 'create_user',
        email: newUserEmail.trim().toLowerCase(),
        password: newUserPassword.trim(),
        full_name: newUserName.trim(),
        role: newUserRole,
        soc: managedSoc,
      });

      if (error) {
        if (error.toLowerCase().includes('already registered') ||
            error.toLowerCase().includes('already been registered') ||
            error.toLowerCase().includes('duplicate')) {
          toast.error('Este e-mail já está cadastrado no sistema.');
        } else {
          toast.error('Erro ao criar usuário: ' + error);
        }
        return;
      }

      const roleLabels: Record<string, string> = {
        admin: 'Administrador',
        lider: 'Líder Operacional',
        bpo: 'BPO Onboarding',
        user: 'Usuário Comum'
      };
      toast.success(`✅ Usuário "${newUserName}" criado com acesso "${roleLabels[newUserRole] ?? newUserRole}"! Login disponível imediatamente.`);
      setShowNewUser(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserPasswordConfirm('');
      setNewUserRole('user');
      setNewUserSoc('');
      fetchAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Tente novamente.';
      toast.error('Erro inesperado: ' + msg);
    } finally {
      setCreatingUser(false);
    }
  };

  const openEditUser = async (user: UserProfile) => {
    setEditingUserId(user.id);
    setEditUserName(user.full_name);
    setEditUserRole(user.role);
    setEditUserSoc(user.soc ?? '');
    setEditLeaderKey(user.leader_key ?? '');
    setShowPasswordReset(false);
    setResetPassword('');
    setResetPasswordConfirm('');
    setEditExtraSocs([]);
    setShowEditUser(true);

    if (isMaster) {
      const { data, error } = await supabase
        .from('user_soc_access')
        .select('soc')
        .eq('user_id', user.id);
      // Migração ainda não aplicada não pode travar a edição do usuário:
      // sem a tabela, o modal apenas não mostra unidades extras.
      if (error) { console.warn('[Config] Acesso multi-SOC indisponível:', error.message); return; }
      setEditExtraSocs((data ?? []).map(r => r.soc).filter(Boolean));
    }
  };

  const saveEditedUser = async () => {
    if (!editUserName.trim()) {
      toast.error('Preencha o nome do usuário');
      return;
    }
    if (showPasswordReset) {
      if (!resetPassword.trim() || resetPassword.length < 6) {
        toast.error('A nova senha deve ter no mínimo 6 caracteres');
        return;
      }
      if (resetPassword !== resetPasswordConfirm) {
        toast.error('As senhas não coincidem');
        return;
      }
    }
    setSavingUserEdit(true);
    const updatePayload: Record<string, unknown> = {
      full_name: editUserName.trim(),
      role: editUserRole,
      soc: managedSoc,
    };
    // Salva leader_key apenas para líderes; limpa para outros perfis
    if (editUserRole === 'lider') {
      updatePayload.leader_key = editLeaderKey.trim() || null;
    } else {
      updatePayload.leader_key = null;
    }
    
    let { error } = await supabase.from('users_profiles').update(updatePayload).eq('id', editingUserId);

    // Fallback: se a coluna leader_key ainda não existe ou o cache não atualizou
    if (error && error.message?.includes('leader_key')) {
      delete updatePayload.leader_key;
      const retry = await supabase.from('users_profiles').update(updatePayload).eq('id', editingUserId);
      error = retry.error;
    }

    if (error) {
      toast.error('Erro ao editar usuário: ' + error.message);
      setSavingUserEdit(false);
      return;
    }

    // ── Unidades extras (só o master) ────────────────────────
    // Reconcilia a lista: apaga o que saiu, insere o que entrou. A RLS e o
    // gatilho trg_guard_soc_access recusam isto para quem não é master, então
    // o `if` abaixo é conveniência de interface, não a trava de segurança.
    if (isMaster && editingUserId) {
      const { data: atuais, error: leituraErr } = await supabase
        .from('user_soc_access').select('soc').eq('user_id', editingUserId);

      if (leituraErr) {
        toast.error('Perfil salvo, mas não consegui ler as unidades extras: ' + leituraErr.message);
        setSavingUserEdit(false);
        return;
      }

      const antes = new Set((atuais ?? []).map(r => r.soc));
      // A unidade base nunca vira concessão extra — seria uma linha duplicada
      // dizendo o que users_profiles.soc já diz.
      const depois = new Set(editExtraSocs.filter(s => s && s !== managedSoc));

      const remover = [...antes].filter(s => !depois.has(s));
      const incluir = [...depois].filter(s => !antes.has(s));

      if (remover.length > 0) {
        const { error } = await supabase
          .from('user_soc_access').delete().eq('user_id', editingUserId).in('soc', remover);
        if (error) { toast.error('Erro ao remover unidade: ' + error.message); setSavingUserEdit(false); return; }
      }
      if (incluir.length > 0) {
        const { error } = await supabase.from('user_soc_access').insert(
          incluir.map(soc => ({ user_id: editingUserId, soc, granted_by: profile?.id ?? null }))
        );
        if (error) { toast.error('Erro ao conceder unidade: ' + error.message); setSavingUserEdit(false); return; }
      }
    }

    // Se tudo deu certo e o admin solicitou trocar senha
    if (showPasswordReset && editingUserId) {
      const { error: authError } = await callAdminUsers({
        action: 'reset_password',
        id: editingUserId,
        password: resetPassword,
      });
      if (authError) {
        toast.error('Perfil salvo, mas ocorreu erro ao redefinir a senha: ' + authError);
        setSavingUserEdit(false);
        return;
      }
    }

    toast.success('Usuário atualizado com sucesso!');
    setShowEditUser(false);
    fetchAll();
    setSavingUserEdit(false);
  };

  const saveInstructor = async () => {
    if (!newInstructorName.trim() || !managedSoc) {
      toast.error('Preencha o nome do instrutor e garanta que sua unidade está configurada');
      return;
    }
    setSavingInstructor(true);
    const { error } = await supabase.from('instructors').insert({
      name: newInstructorName.trim(),
      soc_name: managedSoc,
    });
    if (error) {
      toast.error('Erro ao salvar instrutor: ' + error.message);
    } else {
      toast.success('Instrutor cadastrado com sucesso!');
      setShowNewInstructor(false);
      setNewInstructorName('');
      fetchAll();
    }
    setSavingInstructor(false);
  };

  const saveMicroTraining = async () => {
    if (!newMicroName.trim() || !managedSoc) {
      toast.error('Preencha o nome do processo e certifique-se de estar em uma unidade');
      return;
    }
    setSavingMicro(true);

    if (editingMicroId) {
      const { error } = await supabase.from('soc_micro_trainings').update({
        name: newMicroName.trim(),
        macro_area: newMicroArea,
        is_mandatory: newMicroMandatory
      }).eq('id', editingMicroId);

      if (error) {
        toast.error('Erro ao atualizar processo: ' + error.message);
      } else {
        // Atualiza as certificações já concluídas se o nome mudou, LIMITADO aos colaboradores do SOC atual.
        // Em batches de 150 IDs: um .in() com todos os colaboradores de uma SOC grande
        // (SP8 tem 2.278) estoura o limite de 16 KB de cabeçalho HTTP e falha silenciosamente.
        if (editingMicroNameOriginal !== newMicroName.trim() && managedSoc) {
           const { data: socCollabs } = await supabase.from('collaborators').select('id').eq('soc', managedSoc);
           if (socCollabs && socCollabs.length > 0) {
              const collabIds = socCollabs.map(c => c.id);
              const BATCH = 150;
              for (let i = 0; i < collabIds.length; i += BATCH) {
                const chunk = collabIds.slice(i, i + BATCH);
                const { error: renameErr } = await supabase.from('trainings_completed').update({
                  training_type: newMicroName.trim()
                }).eq('training_type', editingMicroNameOriginal).in('collaborator_id', chunk);
                if (renameErr) {
                  toast.error('Processo renomeado, mas algumas certificações não foram atualizadas: ' + renameErr.message);
                  break;
                }
              }
           }
        }
        toast.success('Processo atualizado com sucesso!');
        closeMicroModal();
        fetchAll();
      }
    } else {
      const { error } = await supabase.from('soc_micro_trainings').insert({
        name: newMicroName.trim(),
        macro_area: newMicroArea,
        soc_name: managedSoc,
        is_mandatory: newMicroMandatory,
        order_num: microTrainings.length + 1
      });
      if (error) {
        toast.error('Erro ao salvar processo: ' + error.message);
      } else {
        toast.success('Processo cadastrado com sucesso!');
        closeMicroModal();
        fetchAll();
      }
    }
    setSavingMicro(false);
  };

  const closeMicroModal = () => {
    setShowNewMicro(false);
    setEditingMicroId(null);
    setEditingMicroNameOriginal('');
    setNewMicroName('');
    setNewMicroArea('RECEBIMENTO');
    setNewMicroMandatory(false);
  };

  const openEditMicro = (micro: SocMicroTraining) => {
    setEditingMicroId(micro.id);
    setEditingMicroNameOriginal(micro.name);
    setNewMicroName(micro.name);
    setNewMicroArea(micro.macro_area);
    setNewMicroMandatory(micro.is_mandatory);
    setShowNewMicro(true);
  };

  const deleteMicroTraining = async (id: string) => {
    if (!confirm('Excluir este processo micro?')) return;
    await supabase.from('soc_micro_trainings').delete().eq('id', id);
    fetchAll();
    toast.success('Processo removido');
  };


  const deleteInstructor = async (id: string) => {
    if (!confirm('Excluir este instrutor?')) return;
    await supabase.from('instructors').delete().eq('id', id);
    fetchAll();
    toast.success('Instrutor removido');
  };

  const openQuestionManager = async (t: TrainingItem) => {
    setManagingTraining(t);
    const { data, error } = await supabase.from('quiz_questions').select('*').eq('training_id', t.id).eq('soc_name', managedSoc).order('order_num');
    if (error) {
      console.error('[QuizQuestions] Erro ao buscar questões:', error.message);
      toast.error('Erro ao buscar questões do treinamento: ' + error.message);
    }
    setMgmtQuestions(data ?? []);
  };

  const saveQuestion = async () => {
    if (!qForm.question || !qForm.option_a || !qForm.option_b || !qForm.option_c || !qForm.option_d) {
      toast.error('Preencha todos os campos da questão');
      return;
    }
    const payload = {
      training_id: managingTraining!.id,
      soc_name: managedSoc,
      question: qForm.question,
      option_a: qForm.option_a,
      option_b: qForm.option_b,
      option_c: qForm.option_c,
      option_d: qForm.option_d,
      correct_option: qForm.correct_option,
      order_num: qForm.order_num
    };

    let dbErr;
    if (qForm.id) {
      const { error } = await supabase.from('quiz_questions').update(payload).eq('id', qForm.id);
      dbErr = error;
    } else {
      const { error } = await supabase.from('quiz_questions').insert(payload);
      dbErr = error;
    }

    if (dbErr) {
      console.error('[QuizQuestions] Erro ao salvar questão:', dbErr.message);
      toast.error('Erro ao salvar questão: ' + dbErr.message);
      return;
    }

    toast.success('Questão salva com sucesso');
    setShowQForm(false);
    openQuestionManager(managingTraining!);
  };

  const deleteQuestion = async (id: string) => {
    if (!confirm('Excluir esta questão?')) return;
    const { error } = await supabase.from('quiz_questions').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao remover questão: ' + error.message);
      return;
    }
    toast.success('Questão removida');
    openQuestionManager(managingTraining!);
  };

  return (
    <div className="space-y-10 max-w-5xl mx-auto">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
             <div className="p-3 bg-gray-50 rounded-2xl text-[#EE4D2D] shadow-inner"><Shield size={24} /></div>
             Configurações Adm
          </h1>
          <p className="text-sm text-gray-400 font-medium ml-1">Central de controle para acessos, unidades e avaliações</p>
        </div>
        {/* Esta tela sempre age sobre UMA unidade. Para o master, que pode
            estar vendo "todas", deixar explícito qual vai receber o que for
            criado aqui evita cadastrar um usuário na unidade errada. */}
        {isMaster && (
          <div className="shrink-0 rounded-2xl border border-[#EE4D2D]/20 bg-[#FEF6F5] px-5 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#EE4D2D]">Gerenciando</p>
            <p className="text-lg font-black text-gray-900 leading-tight">{managedSoc ?? '—'}</p>
            <p className="text-[10px] text-gray-500 font-medium mt-0.5">
              {effectiveSoc
                ? 'Troque a unidade no topo da tela'
                : 'Sua unidade de cadastro — escolha outra no seletor do topo'}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Users Management */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-8 border-b border-gray-50 flex items-center justify-between">
            <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight flex items-center gap-2">
               Usuários
            </h2>
            <button 
              onClick={() => setShowNewUser(true)} 
              className="p-2.5 rounded-xl bg-gray-50 text-[#EE4D2D] hover:bg-[#FEF6F5] transition-all border border-transparent hover:border-[#EE4D2D]/20"
            >
              <UserPlus size={20} />
            </button>
          </div>
          
          <div className="p-8 space-y-4 flex-1">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between p-5 rounded-2xl bg-gray-50/50 hover:bg-white hover:shadow-md border border-transparent hover:border-gray-100 transition-all group">
                <div className="flex items-center gap-4">
                   <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-xs uppercase
                     ${u.role === 'master' ? 'bg-gray-900 text-white shadow-lg shadow-gray-900/20' : u.role === 'admin' ? 'bg-[#EE4D2D] text-white shadow-lg shadow-[#EE4D2D]/20' : 'bg-gray-200 text-gray-500'}`}>
                      {u.full_name.charAt(0)}
                   </div>
                   <div>
                      <p className="text-sm font-black text-gray-800 leading-none mb-1">{u.full_name}</p>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{ACCESS_LABELS[u.role] ?? 'Consulta Ltda'}</p>
                   </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEditUser(u)} className="p-2 rounded-lg text-gray-400 hover:text-[#EE4D2D] hover:bg-[#FEF6F5] transition-all"><Edit2 size={16} /></button>
                  <button onClick={() => deleteUser(u.id)} className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            {users.length === 0 && (
               <div className="text-center py-10">
                  <UserPlus size={40} className="mx-auto text-gray-100 mb-2" />
                  <p className="text-xs text-gray-400 font-medium">Nenhum administrador cadastrado</p>
               </div>
            )}
          </div>
        </div>

        {/* Instructors Management */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-8 border-b border-gray-50 flex items-center justify-between">
            <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight flex items-center gap-2">
               Instrutores
            </h2>
            <button 
               onClick={() => setShowNewInstructor(true)} 
               className="p-2.5 rounded-xl bg-gray-50 text-[#EE4D2D] hover:bg-[#FEF6F5] transition-all border border-transparent hover:border-[#EE4D2D]/20"
            >
              <Plus size={20} />
            </button>
          </div>

          <div className="p-8 space-y-4 flex-1">
            {instructors.map(inst => (
              <div key={inst.id} className="flex items-center justify-between p-5 rounded-2xl bg-gray-50/50 hover:bg-white hover:shadow-md border border-transparent hover:border-gray-100 transition-all group">
                <div className="flex items-center gap-4">
                   <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center">
                      <GraduationCap size={20} />
                   </div>
                   <div>
                      <p className="text-sm font-black text-gray-800 leading-none mb-1">{inst.name}</p>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Base: {inst.soc_name}</p>
                   </div>
                </div>
                <button onClick={() => deleteInstructor(inst.id)} className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {instructors.length === 0 && (
               <div className="text-center py-10">
                  <GraduationCap size={40} className="mx-auto text-gray-100 mb-2" />
                  <p className="text-xs text-gray-400 font-medium">Não há instrutores ativos</p>
               </div>
            )}
          </div>
        </div>
      </div>

      {/* Micro Trainings Management */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-8 border-b border-gray-50 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight flex items-center gap-2">
                 Processos Micros (Matriz)
              </h2>
              <p className="text-xs text-gray-400 font-medium mt-1">Gerencie os processos da matriz de certificação para {managedSoc}</p>
            </div>
            <button 
               onClick={() => { closeMicroModal(); setShowNewMicro(true); }} 
               className="p-2.5 rounded-xl bg-gray-50 text-[#EE4D2D] hover:bg-[#FEF6F5] transition-all border border-transparent hover:border-[#EE4D2D]/20"
            >
              <Plus size={20} />
            </button>
          </div>

          <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
             {microTrainings.map((micro, index) => (
               <div 
                 key={micro.id} 
                 draggable
                 onDragStart={() => { dragItemMicro.current = index; }}
                 onDragEnter={() => { dragOverItemMicro.current = index; }}
                 onDragEnd={handleDragSortMicro}
                 onDragOver={(e) => e.preventDefault()}
                 className="cursor-move flex items-center justify-between p-5 rounded-2xl bg-gray-50/50 hover:bg-white hover:shadow-md border border-transparent hover:border-gray-100 transition-all group"
               >
                 <div>
                   <p className="text-sm font-black text-gray-800 leading-none mb-1">{micro.name}</p>
                   <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{micro.macro_area} • {micro.is_mandatory ? 'Obrigatório' : 'Sugestão'}</p>
                 </div>
                 <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button onClick={() => openEditMicro(micro)} className="p-2 rounded-lg text-gray-400 hover:text-[#EE4D2D] hover:bg-[#FEF6F5] transition-all">
                     <Edit2 size={16} />
                   </button>
                   <button onClick={() => deleteMicroTraining(micro.id)} className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all">
                     <Trash2 size={16} />
                   </button>
                 </div>
               </div>
             ))}
             {microTrainings.length === 0 && (
               <div className="col-span-full text-center py-10">
                 <p className="text-xs text-gray-400 font-medium">Nenhum processo micro cadastrado para sua unidade.</p>
               </div>
             )}
          </div>
      </div>

      {/* Trainings and Quiz Configurations */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-8 border-b border-gray-50">
          <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">Avaliações e Provas</h2>
          <p className="text-xs text-gray-400 font-medium mt-1">Configure o banco de questões para cada material de treinamento</p>
        </div>
        <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {trainings.map(t => (
            <div key={t.id} className="p-6 rounded-2xl bg-[#FBFBFB] border border-transparent hover:border-[#EE4D2D]/10 hover:shadow-lg transition-all group cursor-pointer" onClick={() => openQuestionManager(t)}>
               <div className="flex flex-col gap-4">
                  <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center text-[#EE4D2D] group-hover:scale-110 transition-transform">
                     <Edit2 size={24} />
                  </div>
                  <div>
                     <p className="text-sm font-black text-gray-900 line-clamp-1 group-hover:text-[#EE4D2D] transition-colors">{t.name}</p>
                     <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Clique para Gerenciar</p>
                  </div>
               </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modals with Premium Light Style */}
      
      {/* New User Overlay */}
      {showNewUser && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black text-gray-900">Novo Usuário</h3>
              <button onClick={() => setShowNewUser(false)} className="p-2 rounded-full hover:bg-gray-100 transition-colors"><X size={20} /></button>
            </div>
            <div className="space-y-4">
               <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nome Completo</label>
                  <input type="text" value={newUserName} onChange={e => setNewUserName(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
               </div>
               <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">E-mail Corporativo</label>
                  <input type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
               </div>
               <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Senha Provisória</label>
                  <input
                    type="password"
                    value={newUserPassword}
                    onChange={e => setNewUserPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className={`w-full px-4 py-3 rounded-xl bg-gray-50 border-2 text-gray-800 text-sm font-bold outline-none focus:bg-white transition-all ${
                      newUserPasswordConfirm && newUserPassword !== newUserPasswordConfirm
                        ? 'border-red-300 focus:border-red-400'
                        : newUserPasswordConfirm && newUserPassword === newUserPasswordConfirm
                        ? 'border-emerald-300 focus:border-emerald-400'
                        : 'border-transparent focus:ring-2 focus:ring-[#EE4D2D]/10'
                    }`}
                  />
               </div>
               <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Confirmar Senha</label>
                  <input
                    type="password"
                    value={newUserPasswordConfirm}
                    onChange={e => setNewUserPasswordConfirm(e.target.value)}
                    placeholder="Repita a senha provisória"
                    className={`w-full px-4 py-3 rounded-xl bg-gray-50 border-2 text-gray-800 text-sm font-bold outline-none focus:bg-white transition-all ${
                      newUserPasswordConfirm && newUserPassword !== newUserPasswordConfirm
                        ? 'border-red-300 focus:border-red-400'
                        : newUserPasswordConfirm && newUserPassword === newUserPasswordConfirm
                        ? 'border-emerald-300 focus:border-emerald-400'
                        : 'border-transparent focus:ring-2 focus:ring-[#EE4D2D]/10'
                    }`}
                  />
                  {newUserPasswordConfirm && newUserPassword !== newUserPasswordConfirm && (
                    <p className="text-[9px] text-red-500 font-bold ml-1 mt-0.5">❌ Senhas não coincidem</p>
                  )}
                  {newUserPasswordConfirm && newUserPassword === newUserPasswordConfirm && (
                    <p className="text-[9px] text-emerald-500 font-bold ml-1 mt-0.5">✅ Senhas coincidem</p>
                  )}
               </div>
               <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nível de Acesso</label>
                  <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all">
                    <option value="user">Usuário Comum</option>
                    <option value="lider">Líder Operacional</option>
                    <option value="bpo">BPO (Acesso Onboarding)</option>
                    <option value="admin">Administrador Geral</option>
                    <option value="pcp">PCP (Agenda)</option>
                    {/* Só um master cria outro master. A Edge Function e o
                        gatilho do banco recusam de qualquer forma — esconder
                        aqui é a camada de cima, não a que segura. */}
                    {isMaster && <option value="master">Master (todas as unidades)</option>}
                  </select>
               </div>
               <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Unidade Base (SOC)</label>
                  <input value={managedSoc ?? ''} disabled className="w-full px-4 py-3 rounded-xl bg-gray-100 border-transparent text-gray-500 text-sm font-bold outline-none cursor-not-allowed" />
               </div>
            </div>
            <button disabled={creatingUser} onClick={createUser} className="w-full py-4 rounded-xl shopee-gradient-bg text-white font-black text-xs uppercase tracking-[0.2em] shadow-lg hover:brightness-110 active:scale-95 transition-all">
              {creatingUser ? 'PROCESSANDO...' : 'CADASTRAR E SINCRONIZAR'}
            </button>
          </div>
        </div>
      )}

      {/* Edit User Overlay */}
      {showEditUser && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 space-y-6 animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-black text-gray-900">Editar Perfil</h3>
                <button onClick={() => setShowEditUser(false)} className="p-2 rounded-full hover:bg-gray-100 transition-colors"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nome</label>
                    <input value={editUserName} onChange={e => setEditUserName(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-gray-50 text-sm font-bold outline-none border-transparent focus:ring-2 focus:ring-[#EE4D2D]/10 focus:bg-white transition-all" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Regra de Acesso</label>
                    <select value={editUserRole} onChange={e => setEditUserRole(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-gray-50 text-sm font-bold outline-none border-transparent focus:ring-2 focus:ring-[#EE4D2D]/10 focus:bg-white transition-all">
                      <option value="user">Usuário Comum</option>
                      <option value="lider">Líder Operacional</option>
                      <option value="bpo">BPO (Acesso Onboarding)</option>
                      <option value="admin">Administrador</option>
                      <option value="pcp">PCP (Agenda)</option>
                      {/* Idem: conceder ou retirar master é privilégio de master. */}
                      {(isMaster || editUserRole === 'master') && <option value="master">Master (todas as unidades)</option>}
                    </select>
                 </div>
                 <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Unidade Base (SOC)</label>
                  <input value={managedSoc ?? ''} disabled className="w-full px-4 py-3 rounded-xl bg-gray-100 border-transparent text-gray-500 text-sm font-bold outline-none cursor-not-allowed" />
                 </div>

                 {/* Unidades extras — exclusivo do master.
                     Quem não é master não vê este bloco, e mesmo que chamasse
                     a API direto seria recusado pela política
                     master_manages_soc_access e pelo gatilho
                     trg_guard_soc_access. Perfil master não precisa: ele já
                     alcança todas as unidades. */}
                 {isMaster && editUserRole !== 'master' && (
                   <div className="space-y-1 pt-1">
                     <label className="text-[10px] font-black text-[#EE4D2D] uppercase tracking-widest ml-1">
                       Unidades adicionais
                     </label>
                     <p className="text-[9px] text-gray-400 font-medium ml-1">
                       Além da unidade base. O usuário passa a alternar entre elas no seletor do topo,
                       com o mesmo poder do cargo dele em cada uma.
                     </p>
                     <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-2 grid grid-cols-2 gap-1 mt-1.5">
                       {socs.filter(s => s.name !== managedSoc).map(s => {
                         const marcada = editExtraSocs.includes(s.name);
                         return (
                           <label
                             key={s.id}
                             className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                               marcada ? 'bg-[#FEF6F5] border border-[#EE4D2D]/30' : 'bg-white border border-transparent hover:bg-gray-100'
                             }`}
                           >
                             <input
                               type="checkbox"
                               checked={marcada}
                               onChange={() => setEditExtraSocs(atual =>
                                 atual.includes(s.name) ? atual.filter(x => x !== s.name) : [...atual, s.name]
                               )}
                               className="w-3.5 h-3.5 rounded accent-[#EE4D2D] cursor-pointer"
                             />
                             <span className={`text-[11px] font-black tracking-wider ${marcada ? 'text-[#EE4D2D]' : 'text-gray-600'}`}>
                               {s.name}
                             </span>
                           </label>
                         );
                       })}
                     </div>
                     {editExtraSocs.length > 0 && (
                       <p className="text-[9px] text-gray-500 font-bold ml-1 mt-1">
                         Vai enxergar: {managedSoc} + {editExtraSocs.join(', ')}
                       </p>
                     )}
                   </div>
                 )}

                 {/* Campo de chave do líder — visível somente quando perfil = lider */}
                 {editUserRole === 'lider' && (
                   <div className="space-y-1">
                     <label className="text-[10px] font-black text-[#EE4D2D] uppercase tracking-widest ml-1">Chave de Identificação (Líder)</label>
                     <input
                       value={editLeaderKey}
                       onChange={e => setEditLeaderKey(e.target.value)}
                       placeholder="Ex: RICARDO MARTINS (como aparece no sistema)"
                       className="w-full px-4 py-3 rounded-xl bg-[#FEF6F5] text-sm font-bold outline-none border border-[#EE4D2D]/20 focus:ring-2 focus:ring-[#EE4D2D]/10 focus:bg-white transition-all"
                     />
                     <p className="text-[9px] text-gray-400 font-medium ml-1 mt-1">Preencha com o nome <strong>exatamente</strong> como aparece na coluna "Líder" da planilha de colaboradores. Deixe em branco para usar o nome do perfil.</p>
                   </div>
                 )}

                 {/* Reset de Senha UI */}
                 <div className="pt-2">
                   {!showPasswordReset ? (
                     <button type="button" onClick={() => setShowPasswordReset(true)} className="text-xs font-bold text-[#EE4D2D] hover:underline flex items-center gap-1">
                        🔒 Definir Nova Senha
                     </button>
                   ) : (
                     <div className="space-y-4 p-4 bg-[#FBFBFB] rounded-2xl border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                           <p className="text-xs font-black text-gray-900 uppercase tracking-widest">Nova Senha de Acesso</p>
                           <button type="button" onClick={() => { setShowPasswordReset(false); setResetPassword(''); setResetPasswordConfirm(''); }} className="text-[10px] font-bold text-gray-400 hover:text-[#EE4D2D] uppercase transition-colors">Cancelar</button>
                        </div>
                        <div className="space-y-1">
                           <input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="Digite a nova senha (min. 6 caracteres)" className="w-full px-4 py-3 rounded-xl bg-white text-sm font-bold outline-none border border-transparent focus:border-[#EE4D2D]/30 focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all shadow-sm" />
                        </div>
                        <div className="space-y-1">
                           <input type="password" value={resetPasswordConfirm} onChange={e => setResetPasswordConfirm(e.target.value)} placeholder="Confirme a senha" className={`w-full px-4 py-3 rounded-xl bg-white text-sm font-bold outline-none border shadow-sm focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all ${
                              resetPasswordConfirm && resetPassword !== resetPasswordConfirm ? 'border-red-300 focus:border-red-400' :
                              resetPasswordConfirm && resetPassword === resetPasswordConfirm ? 'border-emerald-300 focus:border-emerald-400' : 'border-transparent focus:border-[#EE4D2D]/30'
                           }`} />
                           {resetPasswordConfirm && resetPassword !== resetPasswordConfirm && <p className="text-[9px] text-red-500 font-bold ml-1 mt-1">❌ As senhas não coincidem</p>}
                           {resetPasswordConfirm && resetPassword === resetPasswordConfirm && <p className="text-[9px] text-emerald-500 font-bold ml-1 mt-1">✅ Senhas coincidem perfeitamente</p>}
                        </div>
                     </div>
                   )}
                 </div>
              </div>
              <div className="flex gap-3 pt-2">
                 <button onClick={() => setShowEditUser(false)} className="flex-1 py-4 rounded-xl bg-gray-50 text-gray-400 font-black text-[10px] uppercase tracking-widest">Descartar</button>
                 <button disabled={savingUserEdit} onClick={saveEditedUser} className="flex-2 py-4 px-6 rounded-xl bg-black text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-lg hover:bg-gray-800 transition-all">
                    {savingUserEdit ? 'SALVANDO...' : 'SALVAR'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* New Instructor Overlay */}
      {showNewInstructor && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 space-y-6 animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center">
                 <h3 className="text-2xl font-black text-gray-900">Novo Instrutor</h3>
                 <button onClick={() => setShowNewInstructor(false)} className="p-2 rounded-full hover:bg-gray-100 transition-colors"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nome Completo</label>
                    <input value={newInstructorName} onChange={e => setNewInstructorName(e.target.value)} placeholder="Ex: Rodrigo Souza" className="w-full px-4 py-3 rounded-xl bg-gray-50 text-sm font-bold outline-none border-transparent focus:ring-2 focus:ring-[#EE4D2D]/10 focus:bg-white transition-all" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Unidade Base (SOC)</label>
                    <input value={managedSoc ?? ''} disabled className="w-full px-4 py-3 rounded-xl bg-gray-100 border-transparent text-gray-500 text-sm font-bold outline-none cursor-not-allowed" />
                 </div>
              </div>
              <button disabled={savingInstructor} onClick={saveInstructor} className="w-full py-4 rounded-xl shopee-gradient-bg text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-lg hover:brightness-110 transition-all">
                {savingInstructor ? 'FINALIZANDO...' : 'CONFIRMAR INSTRUCTOR'}
              </button>
           </div>
        </div>
      )}

      {/* New Micro Training Overlay */}
      {showNewMicro && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 space-y-6 animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center">
                 <h3 className="text-2xl font-black text-gray-900">{editingMicroId ? 'Editar Processo' : 'Novo Processo'}</h3>
                 <button onClick={closeMicroModal} className="p-2 rounded-full hover:bg-gray-100 transition-colors"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nome do Processo</label>
                    <input value={newMicroName} onChange={e => setNewMicroName(e.target.value)} placeholder="Ex: Recebimento FM" className="w-full px-4 py-3 rounded-xl bg-gray-50 text-sm font-bold outline-none border-transparent focus:ring-2 focus:ring-[#EE4D2D]/10 focus:bg-white transition-all" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Área Macro</label>
                    <select value={newMicroArea} onChange={e => setNewMicroArea(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-gray-50 text-sm font-bold outline-none border-transparent focus:ring-2 focus:ring-[#EE4D2D]/10 focus:bg-white transition-all">
                        <option value="RECEBIMENTO">Recebimento</option>
                        <option value="PROCESSAMENTO">Processamento</option>
                        <option value="EXPEDIÇÃO">Expedição</option>
                        <option value="TRATATIVAS">Tratativas</option>
                        <option value="ASM">ASM</option>
                    </select>
                 </div>
                 <div className="space-y-1 pt-2">
                    <label className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors">
                      <input type="checkbox" checked={newMicroMandatory} onChange={e => setNewMicroMandatory(e.target.checked)} className="w-5 h-5 rounded border-gray-300 text-[#EE4D2D] focus:ring-[#EE4D2D]" />
                      <span className="text-sm font-black text-gray-800">Treinamento Obrigatório</span>
                    </label>
                    <p className="text-[9px] text-gray-400 font-medium ml-1 mt-1">Marque se o tick deve ser Vermelho (Obrigatório) para os colaboradores deste setor, ou desmarque para Laranja (Sugestão).</p>
                 </div>
              </div>
              <button disabled={savingMicro} onClick={saveMicroTraining} className="w-full py-4 rounded-xl shopee-gradient-bg text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-lg hover:brightness-110 transition-all">
                {savingMicro ? 'FINALIZANDO...' : (editingMicroId ? 'SALVAR ALTERAÇÕES' : 'CADASTRAR PROCESSO')}
              </button>
           </div>
        </div>
      )}

      {/* Full Management Overlay for Questions */}
      {managingTraining && (
        <div className="fixed inset-0 z-[60] bg-[#F5F5F5] overflow-y-auto animate-in fade-in slide-in-from-bottom-10 duration-500">
           <div className="max-w-4xl mx-auto p-6 md:p-12 space-y-12">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                 <div className="space-y-1">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tight">Banco de Questões</h2>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{managingTraining.name}</p>
                 </div>
                 <div className="flex gap-2">
                    <button 
                      onClick={() => { setQForm({ id: '', question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'a', order_num: mgmtQuestions.length + 1 }); setShowQForm(true); }} 
                      className="px-6 py-3 rounded-xl bg-[#EE4D2D] text-white font-black text-[10px] uppercase tracking-widest shadow-md hover:brightness-110 transition-all"
                    >
                      ADICIONAR QUESTÃO
                    </button>
                    <button onClick={() => setManagingTraining(null)} className="px-6 py-3 rounded-xl bg-white border border-gray-200 text-gray-400 font-black text-[10px] uppercase tracking-widest hover:bg-gray-50 transition-all">
                      VOLTAR
                    </button>
                 </div>
              </div>

              <div className="space-y-6">
                 {mgmtQuestions.map((q, i) => (
                   <div key={q.id} className="relative group bg-white p-8 rounded-3xl border border-gray-100 hover:border-[#EE4D2D]/10 hover:shadow-xl transition-all">
                      <div className="absolute -top-4 -left-4 w-12 h-12 bg-[#EE4D2D] text-white rounded-2xl flex items-center justify-center font-black text-xl shadow-lg group-hover:rotate-12 transition-transform">
                         {i + 1}
                      </div>
                      <div className="flex justify-between items-start gap-4">
                         <div className="flex-1 space-y-6">
                            <p className="text-lg font-bold text-gray-800 pt-2 leading-relaxed">{q.question}</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                               {['a', 'b', 'c', 'd'].map(opt => (
                                 <div key={opt} className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-3
                                   ${q.correct_option === opt ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-50 bg-gray-50/30 text-gray-400'}`}>
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black uppercase
                                      ${q.correct_option === opt ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                                       {opt}
                                    </div>
                                    <span className="text-xs font-bold leading-tight">{q[`option_${opt}`]}</span>
                                 </div>
                               ))}
                            </div>
                         </div>
                         <div className="flex flex-col gap-2">
                           <button onClick={() => { setQForm(q); setShowQForm(true); }} className="p-3 rounded-xl bg-gray-50 text-gray-400 hover:text-[#EE4D2D] hover:bg-[#FEF6F5] transition-all"><Edit2 size={18}/></button>
                           <button onClick={() => deleteQuestion(q.id)} className="p-3 rounded-xl bg-gray-50 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"><Trash2 size={18}/></button>
                         </div>
                      </div>
                   </div>
                 ))}
                 {mgmtQuestions.length === 0 && (
                   <div className="py-24 bg-white rounded-3xl border-2 border-dashed border-gray-100 text-center space-y-4">
                      <div className="inline-flex p-6 bg-[#FEF6F5] text-[#EE4D2D] rounded-full">
                         <GraduationCap size={48} />
                      </div>
                      <div className="max-w-xs mx-auto space-y-1">
                         <h3 className="text-gray-900 font-black uppercase tracking-widest text-sm">Prova não Finalizada</h3>
                         <p className="text-xs text-gray-400 font-medium">Você precisa adicionar pelo menos uma questão para que o treinamento possa ser validado pelos colaboradores.</p>
                      </div>
                   </div>
                 )}
              </div>
           </div>

           {/* Nested Small Modal for Question Editing */}
           {showQForm && (
              <div className="fixed inset-0 z-[70] bg-gray-900/60 backdrop-blur-md flex items-center justify-center p-4">
                 <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-gray-100 p-10 space-y-8 animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[95vh]">
                    <div className="flex justify-between items-center">
                       <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tight">{qForm.id ? 'Editar Questão' : 'Nova Questão'}</h3>
                       <button onClick={() => setShowQForm(false)} className="p-3 rounded-xl bg-gray-50 text-gray-400"><X size={20}/></button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                       <div className="md:col-span-1 space-y-1">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Ordem</label>
                          <input type="number" value={qForm.order_num} onChange={e => setQForm({...qForm, order_num: parseInt(e.target.value)||1})} className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-900 font-black text-center outline-none focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
                       </div>
                       <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Enunciado</label>
                          <input value={qForm.question} onChange={e => setQForm({...qForm, question: e.target.value})} className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
                       </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       {['a', 'b', 'c', 'd'].map(opt => (
                         <div key={opt} className="space-y-1">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Opção {opt.toUpperCase()}</label>
                            <input value={qForm[`option_${opt}` as keyof typeof qForm]} onChange={e => setQForm({...qForm, [`option_${opt}`]: e.target.value})} className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-800 text-xs font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
                         </div>
                       ))}
                    </div>

                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-[#EE4D2D] uppercase tracking-widest ml-1">Resposta Correta</label>
                       <div className="flex gap-2">
                          {['a', 'b', 'c', 'd'].map(opt => (
                            <button 
                              key={opt} 
                              onClick={() => setQForm({...qForm, correct_option: opt})}
                              className={`flex-1 py-4 rounded-xl font-black text-sm uppercase transition-all border-2
                                ${qForm.correct_option === opt ? 'bg-[#EE4D2D] border-[#EE4D2D] text-white shadow-lg' : 'bg-gray-50 border-transparent text-gray-400'}`}
                            >
                               {opt}
                            </button>
                          ))}
                       </div>
                    </div>

                    <button onClick={saveQuestion} className="w-full py-5 rounded-2xl shopee-gradient-bg text-white font-black uppercase text-xs tracking-[0.3em] shadow-xl hover:brightness-110 active:scale-95 transition-all">
                      FINALIZAR E SALVAR QUESTÃO
                    </button>
                 </div>
              </div>
           )}
        </div>
      )}
      {/* Sync Configurations */}
      {profile?.full_name?.toUpperCase() === 'YGOR MADUREIRA' && (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-8 border-b border-gray-50 flex items-center justify-between">
             <div>
                <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">Sincronização Automática</h2>
                <p className="text-xs text-gray-400 font-medium mt-1">Configure o horário para atualização diária da base de colaboradores</p>
             </div>
          </div>
          <div className="p-8 space-y-6">
             <div className="max-w-xs space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Horário de Pico (Update)</label>
                <div className="flex gap-3">
                   <input 
                     type="time" 
                     value={localStorage.getItem('auto_sync_hour') || '05:00'} 
                     onChange={(e) => {
                        localStorage.setItem('auto_sync_hour', e.target.value);
                        toast.success(`Horário de sincronização definido para ${e.target.value}`);
                        // Forçar re-renderização simples (opcional, aqui usamos state local se preferir)
                     }}
                     className="flex-1 px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" 
                   />
                </div>
                <p className="text-[10px] text-gray-400 font-medium italic mt-1">* A sincronização ocorrerá no primeiro acesso administrativo após este horário.</p>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

