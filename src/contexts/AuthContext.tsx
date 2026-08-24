import { createContext, useContext, useEffect, useState, useRef, useMemo, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';


interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'master' | 'admin' | 'user' | 'lider' | 'bpo' | 'pcp';
  leader_key?: string | null; // Nome exato como aparece em collaborators.leader
  soc?: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isMaster: boolean;
  isAdmin: boolean;
  isLider: boolean;
  isBpo: boolean;
  isPcp: boolean;
  mustChangePassword: boolean;
  /**
   * A unidade que as telas devem usar como escopo.
   *
   * Para quem não é master, é uma das unidades que ele alcança (a do
   * cadastro, ou uma das concedidas pelo master — ver allowedSocs).
   * `null` significa "todas as unidades" e só acontece para o master.
   *
   * Este campo é conveniência de INTERFACE, não a trava de segurança: quem
   * de fato barra o acesso é a RLS do banco, por current_user_socs().
   *
   * As telas devem ler ESTE valor, nunca profile.soc direto.
   */
  effectiveSoc: string | null;
  /** Troca a unidade em foco. Só aceita unidades que o usuário alcança. */
  setScopeSoc: (soc: string | null) => void;
  /** Todas as unidades do sistema — carregada só para o master. */
  allSocs: string[];
  /**
   * As unidades que ESTE usuário alcança: a do cadastro + as concedidas pelo
   * master. Vazia para o master, que usa allSocs. O seletor de unidade só
   * aparece para quem tem mais de uma.
   */
  allowedSocs: string[];
  /** true = SOC possui sorting (ASM visível); false = ASM oculto; null = ainda carregando */
  socHasSorting: boolean | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// A escolha do master sobrevive ao recarregar a página. O sentinela existe
// para separar "escolheu ver todas as unidades" de "ainda não escolheu nada".
const SCOPE_KEY = 'master_scope_soc';
const TODAS = '__TODAS__';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [socHasSorting, setSocHasSorting] = useState<boolean | null>(null);
  const [allSocs, setAllSocs] = useState<string[]>([]);
  const [grantedSocs, setGrantedSocs] = useState<string[]>([]);
  const [scopeSoc, setScopeSocState] = useState<string | null>(() => {
    const guardado = localStorage.getItem(SCOPE_KEY);
    // Sem nada guardado, o master começa vendo todas as unidades — é o
    // motivo de o perfil existir.
    if (guardado === null || guardado === TODAS) return null;
    return guardado;
  });
  const initializedRef = useRef(false);

  const fetchProfile = async (userId: string, email: string, userMetadata?: Record<string, unknown>): Promise<UserProfile | null> => {
    try {
      const { data, error } = await supabase
        .from('users_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        // Falha real de infraestrutura (rede/RLS/timeout) — NÃO fabricamos um
        // perfil "admin" aqui. Um perfil inventado com privilégio alto é pior
        // que mostrar a tela de erro: ele silenciosamente concedia acesso de
        // administrador da SOC SP6 a quem quer que caísse nesse catch.
        console.error('[Auth] Erro ao buscar perfil:', error.message);
        return null;
      }

      if (data) {
        const normRole = (data.role?.toLowerCase().trim() || 'user') as UserProfile['role'];
        return { ...data, role: normRole } as UserProfile;
      }

      // Perfil não existe ainda (trigger pode ter falhado) — cria com o mínimo
      // privilégio ('user') e SEM inventar uma SOC: sem soc.metadata, o perfil
      // fica sem unidade (as telas tratam soc nula como "sem escopo", nunca
      // como "SP6").
      const metaRole = ((userMetadata?.role as string)?.toLowerCase().trim()) || 'user';
      const metaName = (userMetadata?.full_name as string) ?? email.split('@')[0];
      const metaSoc = (userMetadata?.soc as string) ?? null;

      const newProfile: UserProfile = {
        id: userId,
        email: email,
        full_name: metaName,
        // 'master' nunca nasce de metadados do cadastro — só de outro master
        // ou de um UPDATE direto no banco. O gatilho trg_guard_master_role
        // recusaria de qualquer forma; aqui a intenção fica explícita.
        role: (metaRole === 'master' ? 'user' : metaRole) as UserProfile['role'],
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
        if (retry) {
          const retryRole = (retry.role?.toLowerCase().trim() || 'user') as UserProfile['role'];
          return { ...retry, role: retryRole } as UserProfile;
        }
        return newProfile;
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

  const currentRole = profile?.role?.toLowerCase().trim();
  const isMaster = currentRole === 'master';

  /**
   * As unidades que este usuário alcança: a do cadastro + as concedidas pelo
   * master (tabela user_soc_access). Espelha current_user_socs() do banco —
   * mas é só conveniência de interface: quem de fato barra o acesso é a RLS,
   * então mexer nesta lista pelo navegador não abre porta nenhuma.
   * Para o master a lista fica vazia: ele usa allSocs, que é todas.
   */
  const allowedSocs = useMemo(() => {
    const base = profile?.soc?.trim();
    const todas = new Set<string>();
    if (base) todas.add(base);
    for (const s of grantedSocs) if (s?.trim()) todas.add(s.trim());
    return [...todas].sort();
  }, [profile?.soc, grantedSocs]);

  /**
   * A unidade em foco.
   *  · master  → o que ele escolheu no seletor (null = todas).
   *  · demais  → a escolhida entre as SUAS unidades; se a escolha guardada
   *    não estiver mais liberada (o master revogou), cai para a unidade base.
   *    Nunca vira null, porque null significa "todas as unidades".
   */
  const effectiveSoc = useMemo(() => {
    if (isMaster) return scopeSoc;
    const base = profile?.soc?.trim() || null;
    if (scopeSoc && allowedSocs.includes(scopeSoc)) return scopeSoc;
    return base;
  }, [isMaster, scopeSoc, allowedSocs, profile?.soc]);

  const setScopeSoc = (soc: string | null) => {
    // Trocar de unidade agora vale para qualquer usuário — mas só entre as
    // que ele realmente alcança. A RLS recusaria o resto de qualquer forma;
    // esta checagem existe para a tela não entrar num estado sem dados.
    if (!isMaster && !(soc && allowedSocs.includes(soc))) return;
    setScopeSocState(soc);
    localStorage.setItem(SCOPE_KEY, soc ?? TODAS);
  };

  // Lista do seletor de unidades: todas, para o master; as concedidas, para
  // os demais (o seletor só aparece quando há mais de uma).
  useEffect(() => {
    if (!isMaster) { setAllSocs([]); return; }
    let cancelado = false;
    (async () => {
      const { data } = await supabase.from('socs').select('name').order('name');
      if (!cancelado) setAllSocs((data ?? []).map(s => s.name).filter(Boolean));
    })();
    return () => { cancelado = true; };
  }, [isMaster]);

  // Unidades extras concedidas pelo master. A política read_own_soc_access
  // deixa cada um ler apenas as próprias linhas.
  useEffect(() => {
    if (!profile?.id) { setGrantedSocs([]); return; }
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from('user_soc_access')
        .select('soc')
        .eq('user_id', profile.id);
      // Erro aqui (migração ainda não aplicada, por exemplo) não pode
      // derrubar o login: sem concessões, o usuário fica com a unidade base,
      // que é exatamente o comportamento anterior.
      if (error) { console.warn('[Auth] Sem acesso multi-SOC:', error.message); return; }
      if (!cancelado) setGrantedSocs((data ?? []).map(r => r.soc).filter(Boolean));
    })();
    return () => { cancelado = true; };
  }, [profile?.id]);

  // ASM aparece conforme a unidade EM FOCO — não a do cadastro. Vendo todas
  // as unidades, ASM aparece (algumas têm sorting).
  useEffect(() => {
    if (!profile) { setSocHasSorting(null); return; }
    let cancelado = false;
    (async () => {
      if (!effectiveSoc) { if (!cancelado) setSocHasSorting(true); return; }
      try {
        const { data } = await supabase
          .from('socs')
          .select('has_sorting')
          .ilike('name', effectiveSoc)
          .maybeSingle();
        // Se não encontrar a SOC, exibe por segurança
        if (!cancelado) setSocHasSorting(data?.has_sorting ?? true);
      } catch {
        if (!cancelado) setSocHasSorting(true);
      }
    })();
    return () => { cancelado = true; };
  }, [profile, effectiveSoc]);

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
    setSocHasSorting(null);
  };

  const mustChangePassword = !!(user?.user_metadata?.must_change_password);

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      isMaster,
      // O master faz tudo que um admin faz — em qualquer unidade. Manter
      // isAdmin verdadeiro para ele evita ter que reescrever as dezenas de
      // checagens de permissão espalhadas pelas telas.
      isAdmin: currentRole === 'admin' || isMaster,
      isLider: currentRole === 'lider',
      isBpo: currentRole === 'bpo',
      isPcp: currentRole === 'pcp',
      mustChangePassword,
      effectiveSoc,
      setScopeSoc,
      allSocs,
      allowedSocs,
      socHasSorting,
      signIn,
      signOut
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
