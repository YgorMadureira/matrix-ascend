import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, FolderOpen, Users, BarChart2, Settings, LogOut, Building2, GraduationCap, PenTool, Menu, X } from 'lucide-react';
import shopeeLogoWhite from '@/assets/shopee_logo_white.png';

export default function AppLayout() {
  const { profile, isAdmin, isLider, signOut } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  // Menu items differ by role
  const navItems = isLider
    ? [
        { to: '/trainings', icon: GraduationCap, label: 'Treinamentos' },
        { to: '/reports', icon: BarChart2, label: 'Meu Time' },
      ]
    : [
        { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
        { to: '/materials', icon: FolderOpen, label: 'Materiais' },
        { to: '/collaborators', icon: Users, label: 'Colaboradores' },
        { to: '/reports', icon: BarChart2, label: 'Relatórios' },
        { to: '/signatures', icon: PenTool, label: 'Assinaturas' },
        { to: '/socs', icon: Building2, label: 'SOCs' },
        { to: '/trainings', icon: GraduationCap, label: 'Treinamentos' },
      ];

  return (
    <div className="flex flex-col h-screen bg-[#F5F5F5]">
      {/* Top Header - Shopee Style */}
      <header className="h-16 shopee-gradient-bg flex items-center justify-between px-4 md:px-8 z-50 shadow-md">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-1 text-white">
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-4">
            <img src={shopeeLogoWhite} alt="Shopee" className="h-11 w-auto object-contain drop-shadow-md pb-1" />
            <div className="hidden sm:block border-l border-white/20 pl-4 py-1">
              <h1 className="text-white font-black text-sm tracking-widest uppercase leading-[1.2]">
                Portal de
                <br />
                Treinamentos
              </h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end text-white mr-2">
            <span className="text-xs font-bold">{profile?.full_name}</span>
            <span className="text-[10px] opacity-80 uppercase">{profile?.role === 'lider' ? 'Líder' : profile?.role}</span>
          </div>
          <div className="w-10 h-10 rounded-full bg-white/20 border border-white/30 flex items-center justify-center text-white font-bold shadow-inner">
            {profile?.full_name?.charAt(0) ?? '?'}
          </div>
          <button
            onClick={handleSignOut}
            className="p-2 text-white/80 hover:text-white transition-colors hover:bg-white/10 rounded-full"
            title="Sair"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside 
          className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-white border-r border-border transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${
            isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="md:hidden p-4 border-b flex justify-between items-center shopee-gradient-bg text-white">
            <span className="font-bold">Menu</span>
            <button onClick={closeMobileMenu}><X size={24} /></button>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4 px-4">Navegação Principal</div>
            {navItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={closeMobileMenu}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-[#FEF6F5] text-[#EE4D2D] border border-[#EE4D2D]/10 shadow-sm'
                      : 'text-gray-600 hover:bg-[#FDFDFD] hover:text-[#EE4D2D]'
                  }`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
            
            {isAdmin && (
              <>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-8 mb-4 px-4">Administração</div>
                <NavLink
                  to="/settings"
                  onClick={closeMobileMenu}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-[#FEF6F5] text-[#EE4D2D] border border-[#EE4D2D]/10 shadow-sm'
                        : 'text-gray-600 hover:bg-[#FDFDFD] hover:text-[#EE4D2D]'
                    }`
                  }
                >
                  <Settings size={18} />
                  Configurações
                </NavLink>
              </>
            )}
          </nav>

          <div className="p-4 border-t bg-[#FDFDFD]">
             <p className="text-[10px] text-center text-muted-foreground">© 2026 Shopee Matrix Ascend<br/>v2.4.0 • SPX BR</p>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto bg-[#F5F5F5] p-3 md:p-6">
          <div className="max-w-[1550px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden animate-in fade-in duration-300"
          onClick={closeMobileMenu}
        />
      )}
    </div>
  );
}
