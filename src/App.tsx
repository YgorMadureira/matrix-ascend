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
import NotFound from "./pages/NotFound";
import React from "react";

const queryClient = new QueryClient();

// Error Boundary para nunca mais ter tela preta
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

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
  return <>{children}</>;
}

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
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/materials" element={<MaterialsPage />} />
                <Route path="/collaborators" element={<CollaboratorsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/socs" element={<SocsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/trainings" element={<TrainingsPage />} />
                <Route path="/signatures" element={<SignaturesPage />} />
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

