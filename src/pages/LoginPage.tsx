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
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F5F5] px-4 py-8">
      {/* Shopee Header Logo */}
      <div className="mb-6 flex flex-col items-center animate-fade-in-up">
        <div className="bg-white p-3 rounded-xl shadow-sm mb-3">
          <img src={logoPts} alt="Shopee" className="h-12 w-auto" />
        </div>
        <h1 className="text-xl font-black text-[#EE4D2D] tracking-tight">SHOPEE</h1>
        <p className="text-gray-400 text-[10px] mt-0.5 uppercase tracking-[0.25em] font-bold">Portal de Treinamento</p>
      </div>

      <div className="w-full max-w-sm bg-white p-6 rounded-xl shadow-md animate-fade-in-up border border-gray-100">
        <h2 className="text-base font-bold text-gray-800 mb-5">Login do Sistema</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Seu Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200 focus:border-[#EE4D2D] focus:ring-1 focus:ring-[#EE4D2D] text-gray-800 text-sm placeholder:text-gray-400 outline-none transition-all"
              placeholder="exemplo@shopee.com"
              required
            />
          </div>
          <div>
            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Sua Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200 focus:border-[#EE4D2D] focus:ring-1 focus:ring-[#EE4D2D] text-gray-800 text-sm placeholder:text-gray-400 outline-none transition-all"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg p-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg shopee-gradient-bg text-white font-bold text-xs tracking-wider shadow-md hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {submitting ? 'AUTENTICANDO...' : 'ACESSAR PORTAL'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-gray-100 text-center">
          <p className="text-gray-400 text-[10px] leading-relaxed">
            Ferramenta interna da Shopee.<br/>
            Uso restrito a funcionários autorizados.
          </p>
        </div>
      </div>
      
      <p className="mt-6 text-gray-300 text-[9px] uppercase font-bold tracking-widest">© 2026 SPX BR LOGISTICS</p>
    </div>
  );
}

