import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'user';
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string, email: string) => {
    try {
      const { data, error } = await supabase
        .from('users_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Erro ao buscar perfil:', error.message);
        // Mesmo com erro, não crasha - define perfil fallback
        setProfile({ id: userId, email, full_name: email.split('@')[0], role: 'admin' });
        return;
      }

      if (data) {
        setProfile(data);
      } else {
        // Perfil não existe, tenta criar
        try {
          await supabase.from('users_profiles').insert({
            id: userId,
            email: email,
            full_name: email.split('@')[0],
            role: 'admin'
          });
        } catch (insertErr) {
          console.error('Erro ao criar perfil:', insertErr);
        }
        setProfile({ id: userId, email, full_name: email.split('@')[0], role: 'admin' });
      }
    } catch (err) {
      console.error('Erro crítico em fetchProfile:', err);
      // Fallback: define um perfil padrão para não travar o app
      setProfile({ id: userId, email, full_name: email.split('@')[0], role: 'admin' });
    }
  };

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    // TIMEOUT DE SEGURANÇA: Se o auth demorar mais que 5 segundos, libera o app
    const safetyTimeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    try {
      const { data } = supabase.auth.onAuthStateChange(async (_, session) => {
        try {
          setUser(session?.user ?? null);
          if (session?.user) {
            await fetchProfile(session.user.id, session.user.email ?? '');
          } else {
            setProfile(null);
          }
        } catch (err) {
          console.error('Erro em onAuthStateChange:', err);
        } finally {
          clearTimeout(safetyTimeout);
          setLoading(false);
        }
      });
      subscription = data.subscription;
    } catch (err) {
      console.error('Erro ao configurar auth listener:', err);
      clearTimeout(safetyTimeout);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id, session.user.email ?? '').finally(() => {
          clearTimeout(safetyTimeout);
          setLoading(false);
        });
      } else {
        clearTimeout(safetyTimeout);
        setLoading(false);
      }
    }).catch((err) => {
      console.error('Erro ao obter sessão:', err);
      clearTimeout(safetyTimeout);
      setLoading(false);
    });

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    } catch (err) {
      return { error: 'Erro de conexão. Tente novamente.' };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Erro ao sair:', err);
    }
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin: profile?.role === 'admin', signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

