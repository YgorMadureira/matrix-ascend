import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import logoPts from '@/assets/logo_pts.png';
import shopeeLogo from '@/assets/shopee_logo.png';
import shopito from '@/assets/shopito.png';
import { GraduationCap, ClipboardCheck, ShieldCheck, Users, QrCode, BookOpen, Mail, Lock } from 'lucide-react';

const LoginSuccessAnimation = ({ onComplete }: { onComplete: () => void }) => {
  useState(() => {
    const timer = setTimeout(onComplete, 4000);
    return () => clearTimeout(timer);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-8">
        <div className="animate-login-success relative">
          <div className="w-28 h-28 rounded-full border-4 border-[#EE4D2D] flex items-center justify-center animate-glow-pulse">
            <svg width="56" height="56" viewBox="0 0 64 64" fill="none">
              <path
                d="M16 32L28 44L48 20"
                stroke="#EE4D2D"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-check-draw"
              />
            </svg>
          </div>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-full bg-[#EE4D2D]"
              style={{
                top: '50%',
                left: '50%',
                transform: `rotate(${i * 30}deg) translateY(-70px)`,
                animation: `particleFloat 1.5s ease-out ${0.3 + i * 0.1}s forwards`,
                opacity: 0,
              }}
            />
          ))}
        </div>
        <div className="text-center animate-fade-in-up" style={{ animationDelay: '0.8s', opacity: 0 }}>
          <h2 className="text-xl font-black text-[#EE4D2D] uppercase tracking-widest mb-1">
            Acesso Autorizado
          </h2>
          <p className="text-gray-400 text-sm">Carregando sistema...</p>
        </div>
        <div className="w-56 h-1 bg-gray-100 rounded-full overflow-hidden animate-fade-in-up" style={{ animationDelay: '1.2s', opacity: 0 }}>
          <div
            className="h-full bg-[#EE4D2D] rounded-full"
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

const features = [
  {
    icon: GraduationCap,
    title: 'Gestão de Treinamentos',
    desc: 'Controle completo de capacitação operacional',
  },
  {
    icon: ClipboardCheck,
    title: 'Matriz de Certificação',
    desc: 'Acompanhamento em tempo real por setor',
  },
  {
    icon: QrCode,
    title: 'Assinatura via QR Code',
    desc: 'Validação digital segura e auditável',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance & HSE',
    desc: 'Padrões de segurança e conformidade',
  },
];

export default function LoginPage() {
  const { user, profile, signIn, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [loginComplete, setLoginComplete] = useState(false);

  if (loading) return null;
  if (loginComplete || (user && !showSuccess)) {
    const isBpo = profile?.role === 'bpo';
    return <Navigate to={isBpo ? "/collaborators" : "/dashboard"} replace />;
  }

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
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left Panel - Gradient Branding */}
      <div className="hidden lg:flex lg:w-[48%] relative overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, #EE4D2D 0%, #D0421F 40%, #A8341A 70%, #7E2815 100%)',
        }}
      >
        {/* Subtle pattern overlay */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 50%, rgba(255,255,255,0.3) 0%, transparent 50%),
                              radial-gradient(circle at 80% 20%, rgba(255,255,255,0.2) 0%, transparent 40%)`,
          }}
        />

        {/* Decorative circles */}
        <div className="absolute -top-20 -left-20 w-80 h-80 bg-white/5 rounded-full" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute top-1/2 -right-16 w-48 h-48 bg-white/[0.03] rounded-full" />

        <div className="relative z-10 flex flex-col p-6 xl:p-12 w-full h-full justify-between overflow-y-auto custom-scrollbar">
          
          {/* Main Content */}
          <div className="flex-1 flex flex-col justify-start pt-2 xl:pt-4">
            <div className="mb-6">
              <h1 className="text-white text-3xl xl:text-4xl font-black tracking-tight leading-[1.1]">
                Capacitação
                <br />
                <span className="text-white/80">Operacional</span>
                <br />
                <span className="bg-white/15 backdrop-blur-sm px-3 py-1 rounded-lg text-white inline-block mt-2">
                  Inteligente
                </span>
              </h1>
              <p className="text-white/50 text-xs xl:text-sm font-medium mt-4 max-w-xs xl:max-w-sm leading-relaxed">
                Gerencie treinamentos, certificações e compliance operacional com eficiência e rastreabilidade total.
              </p>
            </div>

            {/* Feature cards */}
            <div className="space-y-2 lg:space-y-2.5 max-w-sm">
              {features.map((f, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 bg-white/[0.08] backdrop-blur-sm border border-white/[0.06] rounded-xl px-4 py-2.5 lg:py-3 hover:bg-white/[0.12] transition-all group cursor-default"
                >
                  <div className="p-2 bg-white/10 rounded-lg group-hover:bg-white/20 transition-colors">
                    <f.icon size={16} className="text-white/80" />
                  </div>
                  <div>
                    <p className="text-white text-[11px] lg:text-xs font-bold leading-none">{f.title}</p>
                    <p className="text-white/40 text-[9px] font-medium mt-0.5">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom - Footer */}
          <div className="flex flex-col items-center gap-3 mt-auto shrink-0 pt-4">
            <div className="text-center">
              <p className="text-white/40 text-[9px] font-black uppercase tracking-widest">© 2026 SPX BR Logistics</p>
              <p className="text-white/30 text-[8px] font-medium mt-0.5">Versão 2.4 • Ambiente Seguro</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex flex-col items-center justify-center bg-[#FAFAFA] px-6 py-10 min-h-screen lg:min-h-0">
        <div className="w-full max-w-sm">
          {/* Shopee Logo */}
          <div className="flex flex-col items-center mb-8">
            <img src={shopeeLogo} alt="Shopee" className="h-[80px] w-auto mb-3 object-contain" />
            <h2 className="text-[18px] font-black text-gray-900 tracking-tight text-center uppercase tracking-widest mt-2">Portal de Treinamentos</h2>
            <p className="text-gray-400 text-xs font-medium mt-1">Acesse sua conta</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">E-mail</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white border border-gray-200 focus:border-[#EE4D2D] focus:ring-2 focus:ring-[#EE4D2D]/10 text-gray-800 text-sm font-medium placeholder:text-gray-300 outline-none transition-all shadow-sm"
                  placeholder="seu.email@shopee.com"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Senha</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white border border-gray-200 focus:border-[#EE4D2D] focus:ring-2 focus:ring-[#EE4D2D]/10 text-gray-800 text-sm font-medium placeholder:text-gray-300 outline-none transition-all shadow-sm"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="text-red-600 text-xs bg-red-50 border border-red-100 rounded-xl p-3 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-xl text-white font-black text-xs uppercase tracking-widest shadow-lg hover:shadow-xl hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #EE4D2D 0%, #FF6B47 100%)',
              }}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Autenticando...
                </span>
              ) : (
                'Entrar'
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <p className="text-gray-300 text-[10px] leading-relaxed">
              Acesso restrito a usuários cadastrados pelo administrador.
            </p>
          </div>

          {/* Mobile-only branding */}
          <div className="lg:hidden flex items-center justify-center gap-3 mt-8 pt-6 border-t border-gray-100">
            <img src={logoPts} alt="PTS" className="h-8 w-auto opacity-40" />
            <div className="w-px h-6 bg-gray-200" />
            <img src={shopito} alt="Shopito" className="h-10 w-auto opacity-40" />
          </div>
        </div>
      </div>
    </div>
  );
}
