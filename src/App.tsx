import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import SignPage from "@/pages/SignPage";
import NotFound from "./pages/NotFound";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import React, { Suspense, lazy } from "react";

// Carregadas sob demanda: só quem loga entra nessas rotas, e SignaturesPage
// sozinha traz jsPDF + XLSX (centenas de KB) que não precisam pesar no
// primeiro carregamento de ninguém (inclusive de quem só assina via QR Code).
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const MaterialsPage = lazy(() => import("@/pages/MaterialsPage"));
const CollaboratorsPage = lazy(() => import("@/pages/CollaboratorsPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const SocsPage = lazy(() => import("@/pages/SocsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const TrainingsPage = lazy(() => import("@/pages/TrainingsPage"));
const SignaturesPage = lazy(() => import("@/pages/SignaturesPage"));
const SchedulePage = lazy(() => import("@/pages/SchedulePage"));

const queryClient = new QueryClient();

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-[#EE4D2D] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-xs text-gray-500 font-medium">Carregando...</p>
      </div>
    </div>
  );
}

// ============================================================
// MAPA DE ACESSO POR PERFIL
// Define quais roles podem acessar cada rota
// ============================================================
type Role = 'master' | 'admin' | 'user' | 'lider' | 'bpo' | 'pcp';

// 'master' entra em TODAS as rotas: é um admin sem fronteira de unidade.
// Esquecer de listá-lo aqui trancaria o perfil para fora do sistema inteiro.
const ROUTE_PERMISSIONS: Record<string, Role[]> = {
  '/dashboard':    ['master', 'admin', 'user', 'lider'],
  '/materials':    ['master', 'admin', 'user'],
  '/collaborators':['master', 'admin', 'user', 'lider', 'bpo'],
  '/reports':      ['master', 'admin', 'user', 'lider'],
  '/socs':         ['master', 'admin', 'user'],
  '/schedule':     ['master', 'admin', 'user', 'lider', 'pcp'],
  '/settings':     ['master', 'admin'],
  '/trainings':    ['master', 'admin', 'user', 'lider'],
  '/signatures':   ['master', 'admin', 'user'],
};

// Página inicial de cada perfil (redirecionamento após login ou acesso negado)
const ROLE_HOME: Record<Role, string> = {
  master: '/dashboard',
  admin:  '/dashboard',
  user:   '/dashboard',
  lider:  '/dashboard',
  bpo:    '/collaborators',
  pcp:    '/schedule',
};

// ============================================================
// Error Boundary — evita tela preta em erros inesperados
// ============================================================
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  // Sem isto, a única pista que sobrava de um erro era a frase na tela — o que
  // não basta para achar a origem de falhas de renderização (o clássico
  // "Failed to execute 'removeChild' on 'Node'", que aponta para o React ter
  // perdido a sincronia com o DOM, mas não diz onde). O componentStack diz
  // exatamente qual componente estava sendo desmontado.
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErroBoundary]', error);
    console.error('[ErroBoundary] Componente:', info.componentStack);
    console.error('[ErroBoundary] Rota:', window.location.pathname);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ background: '#0d1117', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: '2rem' }}>
          <h1 style={{ color: '#e5534b', fontSize: '1.5rem', marginBottom: '1rem' }}>Algo deu errado</h1>
          <p style={{ color: '#8b949e', marginBottom: '0.5rem', textAlign: 'center' }}>{this.state.error}</p>
          <p style={{ color: '#586069', marginBottom: '1.5rem', textAlign: 'center', fontSize: '0.8rem', maxWidth: '32rem' }}>
            Se acontecer de novo, abra o console do navegador (F12) e envie o que aparece em vermelho —
            é lá que fica o detalhe de onde a falha ocorreu.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {/* Recarregar a própria rota resolve falha de renderização sem
                custar a sessão. Mandar para o login era desproporcional: o
                usuário perdia o que estava fazendo por causa de um erro de
                tela. */}
            <button
              onClick={() => window.location.reload()}
              style={{ background: '#e5534b', color: '#fff', border: 'none', padding: '0.75rem 2rem', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}
            >
              Tentar de novo
            </button>
            <button
              onClick={() => { this.setState({ hasError: false, error: '' }); window.location.href = '/login'; }}
              style={{ background: 'transparent', color: '#8b949e', border: '1px solid #30363d', padding: '0.75rem 2rem', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}
            >
              Voltar ao Login
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// ProtectedRoute — exige login, mostra loading enquanto carrega
// ============================================================
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, mustChangePassword } = useAuth();

  if (loading) {
    return (
      <div style={{ background: '#0d1117', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #333', borderTopColor: '#e5534b', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
          <p style={{ color: '#8b949e', fontFamily: 'Inter, sans-serif', fontSize: '0.85rem' }}>Carregando...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Falha ao carregar o perfil (rede/RLS) — NÃO renderiza a aplicação com um
  // perfil inventado. Melhor pedir para tentar de novo do que abrir a tela
  // com privilégio ou SOC incorretos.
  if (!profile) {
    return (
      <div style={{ background: '#0d1117', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ textAlign: 'center', maxWidth: '22rem' }}>
          <h1 style={{ color: '#e5534b', fontSize: '1.15rem', marginBottom: '0.75rem', fontFamily: 'Inter, sans-serif' }}>Não foi possível carregar seu perfil</h1>
          <p style={{ color: '#8b949e', fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            Verifique sua conexão e tente novamente.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: '#e5534b', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // Primeiro acesso: redireciona para redefinição de senha obrigatória
  if (mustChangePassword) {
    return (
      <ChangePasswordPage
        onDone={() => {
          // Força reload da sessão para limpar a flag do metadata
          window.location.reload();
        }}
      />
    );
  }

  return <>{children}</>;
}

// ============================================================
// RoleRoute — verifica se o perfil tem acesso à rota
// Se não tiver, redireciona para a página inicial do perfil
// ============================================================
function RoleRoute({ path, children }: { path: string; children: React.ReactNode }) {
  const { profile, user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-[#EE4D2D] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-gray-500 font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  // ProtectedRoute já garante que profile existe antes de chegar aqui;
  // 'user' (não 'admin') é o piso de segurança caso essa invariante mude.
  //
  // O perfil vem SEMPRE de users_profiles, nunca do user_metadata: o
  // metadata é editável pelo próprio usuário (auth.updateUser) e serviria
  // de atalho para alguém se declarar master e alcançar as telas de
  // administração. As Edge Functions e o RLS leem users_profiles de
  // qualquer forma, mas não faz sentido deixar a porta encostada.
  const effectiveRole = ((profile?.role || 'user').toLowerCase().trim()) as Role;
  const allowedRoles = ROUTE_PERMISSIONS[path] ?? [];
  const hasAccess = allowedRoles.includes(effectiveRole);

  if (!hasAccess) {
    const home = ROLE_HOME[effectiveRole] ?? '/dashboard';
    return <Navigate to={home} replace />;
  }

  return <>{children}</>;
}

// ============================================================
// Redirect da raiz: leva o usuário para a página inicial do seu perfil
// ============================================================
function RootRedirect() {
  const { profile, user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const role = (profile?.role?.toLowerCase().trim() as Role) ?? 'user';
  return <Navigate to={ROLE_HOME[role] ?? '/dashboard'} replace />;
}

// ============================================================
// App
// ============================================================
const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/sign" element={<SignPage />} />
                <Route path="/" element={<ProtectedRoute><RootRedirect /></ProtectedRoute>} />
                <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route path="/dashboard"    element={<RoleRoute path="/dashboard">   <DashboardPage />    </RoleRoute>} />
                  <Route path="/materials"    element={<RoleRoute path="/materials">   <MaterialsPage />    </RoleRoute>} />
                  <Route path="/collaborators"element={<RoleRoute path="/collaborators"><CollaboratorsPage /></RoleRoute>} />
                  <Route path="/reports"      element={<RoleRoute path="/reports">     <ReportsPage />      </RoleRoute>} />
                  <Route path="/socs"         element={<RoleRoute path="/socs">        <SocsPage />         </RoleRoute>} />
                  <Route path="/settings"     element={<RoleRoute path="/settings">    <SettingsPage />     </RoleRoute>} />
                  <Route path="/trainings"    element={<RoleRoute path="/trainings">   <TrainingsPage />    </RoleRoute>} />
                  <Route path="/signatures"   element={<RoleRoute path="/signatures">  <SignaturesPage />   </RoleRoute>} />
                  <Route path="/schedule"     element={<RoleRoute path="/schedule">    <SchedulePage />     </RoleRoute>} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;

