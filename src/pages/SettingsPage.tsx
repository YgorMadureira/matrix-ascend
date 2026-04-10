import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Trash2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface Unit {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [newUnit, setNewUnit] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    const fetch = async () => {
      const [u, un] = await Promise.all([
        supabase.from('users_profiles').select('*').order('full_name'),
        supabase.from('units').select('*').order('name'),
      ]);
      setUsers(u.data ?? []);
      setUnits(un.data ?? []);
    };
    fetch();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const addUnit = async () => {
    if (!newUnit.trim()) return;
    await supabase.from('units').insert({ name: newUnit.trim() });
    setNewUnit('');
    const { data } = await supabase.from('units').select('*').order('name');
    setUnits(data ?? []);
    toast.success('Unidade adicionada');
  };

  const deleteUnit = async (id: string) => {
    await supabase.from('units').delete().eq('id', id);
    setUnits(prev => prev.filter(u => u.id !== id));
    toast.success('Unidade removida');
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerenciamento de usuários e unidades</p>
      </div>

      {/* Users */}
      <div className="glass-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Shield size={20} className="text-primary" /> Usuários do Sistema
        </h2>
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
              <div>
                <p className="text-sm font-medium text-foreground">{u.full_name}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                {u.role}
              </span>
            </div>
          ))}
          {users.length === 0 && <p className="text-muted-foreground text-sm">Nenhum usuário cadastrado</p>}
        </div>
        <p className="text-xs text-muted-foreground mt-4">Para adicionar usuários, crie-os no painel do Supabase (Authentication) e insira na tabela users_profiles.</p>
      </div>

      {/* Units */}
      <div className="glass-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground mb-4">Unidades (SOC)</h2>
        <div className="flex gap-3 mb-4">
          <input
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
            placeholder="Nome da unidade"
            className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
            onKeyDown={(e) => e.key === 'Enter' && addUnit()}
          />
          <button onClick={addUnit} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">
            <Plus size={16} /> Adicionar
          </button>
        </div>
        <div className="space-y-2">
          {units.map(u => (
            <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
              <span className="text-sm text-foreground">{u.name}</span>
              <button onClick={() => deleteUnit(u.id)} className="p-1.5 rounded-md text-destructive hover:bg-destructive/20 transition-colors">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
