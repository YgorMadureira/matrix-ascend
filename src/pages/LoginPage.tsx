import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import logoPts from '@/assets/logo_pts.png';

const LoginSuccessAnimation = ({ onComplete }: { onComplete: () => void }) => {
  useState(() => {
    const timer = setTimeout(onComplete, 4000);
    return () => clearTimeout(timer);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8">
        {/* Glowing circle with check */}
        <div className="animate-login-success relative">
          <div className="w-32 h-32 rounded-full border-4 border-primary flex items-center justify-center animate-glow-pulse">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <path
                d="M16 32L28 44L48 20"
                stroke="hsl(var(--primary))"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-check-draw"
              />
            </svg>
          </div>
          {/* Particles */}
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-full bg-primary"
              style={{
                top: '50%',
                left: '50%',
                transform: `rotate(${i * 30}deg) translateY(-80px)`,
                animation: `particleFloat 1.5s ease-out ${0.3 + i * 0.1}s forwards`,
                opacity: 0,
              }}
            />
          ))}
        </div>
        <div className="text-center animate-fade-in-up" style={{ animationDelay: '0.8s', opacity: 0 }}>
          <h2 className="text-2xl font-display font-bold text-primary glow-text mb-2">
            ACESSO AUTORIZADO
          </h2>
          <p className="text-muted-foreground">Carregando sistema...</p>
        </div>
        {/* Loading bar */}
        <div className="w-64 h-1 bg-secondary rounded-full overflow-hidden animate-fade-in-up" style={{ animationDelay: '1.2s', opacity: 0 }}>
          <div
            className="h-full bg-primary rounded-full"
            style={{
              animation: 'loadBar 2.5s ease-in-out 1.2s forwards',
              width: '0%',
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes loadBar {
          0% { width: 0%; }
          100% { width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default function LoginPage() {
  const { user, signIn, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [loginComplete, setLoginComplete] = useState(false);

  if (loading) return null;
  if (loginComplete || (user && !showSuccess)) return <Navigate to="/dashboard" replace />;

  if (showSuccess) {
    return <LoginSuccessAnimation onComplete={() => setLoginComplete(true)} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) {
      setError('Credenciais inválidas. Contate o administrador.');
    } else {
      setShowSuccess(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/5 blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-primary/3 blur-[120px]" />
        <div className="absolute inset-0 scan-line pointer-events-none opacity-30" />
      </div>

      <div className="glass-card p-10 w-full max-w-md relative z-10 animate-fade-in-up">
        <div className="flex flex-col items-center mb-8">
          <img src={logoPts} alt="PTS Logo" className="h-20 mb-4" />
          <h1 className="font-display text-xl font-bold text-primary glow-text">
            TRAINING MATRIX
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Sistema de Gestão de Treinamentos</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-secondary border border-border focus:border-primary focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground outline-none transition-all"
              placeholder="seu@email.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-secondary border border-border focus:border-primary focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground outline-none transition-all"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50 animate-glow-pulse"
          >
            {submitting ? 'Autenticando...' : 'ACESSAR SISTEMA'}
          </button>
        </form>

        <p className="text-center text-muted-foreground text-xs mt-6">
          Acesso restrito. Contate o administrador para obter credenciais.
        </p>
      </div>
    </div>
  );
}
