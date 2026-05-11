import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import MaterialsPage from "@/pages/MaterialsPage";
import CollaboratorsPage from "@/pages/CollaboratorsPage";
import ReportsPage from "@/pages/ReportsPage";
import SocsPage from "@/pages/SocsPage";
import SettingsPage from "@/pages/SettingsPage";
import SignPage from "@/pages/SignPage";
import TrainingsPage from "@/pages/TrainingsPage";
import SignaturesPage from "@/pages/SignaturesPage";
import SchedulePage from "@/pages/SchedulePage";
import NotFound from "./pages/NotFound";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import React from "react";

const queryClient = new QueryClient();

// ============================================================
// MAPA DE ACESSO POR PERFIL
// Define quais roles podem acessar cada rota
// ============================================================
type Role = 'admin' | 'user' | 'lider' | 'bpo' | 'pcp';

const ROUTE_PERMISSIONS: Record<string, Role[]> = {
  '/dashboard':    ['admin', 'user', 'lider'],
  '/materials':    ['admin', 'user'],
  '/collaborators':['admin', 'user', 'lider', 'bpo'],
  '/reports':      ['admin', 'user', 'lider'],
  '/socs':         ['admin', 'user'],
  '/schedule':     ['admin', 'user', 'lider', 'pcp'],
  '/settings':     ['admin'],
  '/trainings':    ['admin', 'user', 'lider'],
  '/signatures':   ['admin', 'user'],
};

// Página inicial de cada perfil (redirecionamento após login ou acesso negado)
const ROLE_HOME: Record<Role, string> = {
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
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ background: '#0d1117', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: '2rem' }}>
          <h1 style={{ color: '#e5534b', fontSize: '1.5rem', marginBottom: '1rem' }}>Algo deu errado</h1>
          <p style={{ color: '#8b949e', marginBottom: '1.5rem', textAlign: 'center' }}>{this.state.error}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: '' }); window.location.href = '/login'; }}
            style={{ background: '#e5534b', color: '#fff', border: 'none', padding: '0.75rem 2rem', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}
          >
            Voltar ao Login
          </button>
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
  const { user, loading, mustChangePassword } = useAuth();

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
  const { profile, loading } = useAuth();

  // Aguarda o perfil carregar antes de decidir
  if (loading || !profile) return null;

  const allowedRoles = ROUTE_PERMISSIONS[path] ?? [];
  const userRole = profile.role as Role;
  const hasAccess = allowedRoles.includes(userRole);

  if (!hasAccess) {
    const home = ROLE_HOME[userRole] ?? '/dashboard';
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

  const role = (profile?.role as Role) ?? 'user';
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
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;

