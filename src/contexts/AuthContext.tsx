import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'user' | 'lider' | 'bpo' | 'pcp';
  leader_key?: string | null; // Nome exato como aparece em collaborators.leader
  soc?: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isLider: boolean;
  isBpo: boolean;
  isPcp: boolean;
  mustChangePassword: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  const fetchProfile = async (userId: string, email: string, userMetadata?: Record<string, unknown>): Promise<UserProfile | null> => {
    try {
      const { data, error } = await supabase
        .from('users_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('[Auth] Erro ao buscar perfil:', error.message);
        return null;
      }

      if (data) {
        return data as UserProfile;
      }

      // Perfil não existe ainda (trigger pode ter falhado) — cria com role do metadata ou 'user'
      const metaRole = (userMetadata?.role as string) ?? 'user';
      const metaName = (userMetadata?.full_name as string) ?? email.split('@')[0];
      const metaSoc = (userMetadata?.soc as string) ?? 'SP6';

      const newProfile: UserProfile = {
        id: userId,
        email: email,
        full_name: metaName,
        role: (metaRole as UserProfile['role']),
        soc: metaSoc,
      };

      const { error: insertErr } = await supabase
        .from('users_profiles')
        .insert(newProfile);

      if (insertErr) {
        console.error('[Auth] Erro ao criar perfil:', insertErr.message);
        // Tenta ler de novo — talvez já exista por outro processo
        const { data: retry } = await supabase
          .from('users_profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        return (retry as UserProfile) ?? newProfile;
      }

      return newProfile;
    } catch (err) {
      console.error('[Auth] Erro crítico:', err);
      return null;
    }
  };

  useEffect(() => {
    // Função única de inicialização — evita corridas
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          setUser(session.user);
          const p = await fetchProfile(
            session.user.id,
            session.user.email ?? '',
            session.user.user_metadata
          );
          if (p) setProfile(p);
        }
      } catch (err) {
        console.error('[Auth] Erro na inicialização:', err);
      } finally {
        setLoading(false);
        initializedRef.current = true;
      }
    };

    initAuth();

    // Listener para mudanças de sessão — só age após a inicialização
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Ignora o evento inicial (já tratamos no initAuth)
        if (!initializedRef.current) return;

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          return;
        }

        if (session?.user) {
          setUser(session.user);
          // Só busca o perfil de novo em eventos relevantes
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            const p = await fetchProfile(
              session.user.id,
              session.user.email ?? '',
              session.user.user_metadata
            );
            if (p) setProfile(p);
          }
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Erro de conexão. Tente novamente.' };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[Auth] Erro ao sair:', err);
    }
    setUser(null);
    setProfile(null);
  };

  const mustChangePassword = !!(user?.user_metadata?.must_change_password);

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin: profile?.role === 'admin', isLider: profile?.role === 'lider', isBpo: profile?.role === 'bpo', isPcp: profile?.role === 'pcp', mustChangePassword, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
