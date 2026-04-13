import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, FolderOpen, Users, BarChart3, Settings, LogOut, Building2, GraduationCap, PenTool, Menu, X } from 'lucide-react';
import logoPts from '@/assets/logo_pts.png';

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
        { to: '/reports', icon: BarChart3, label: 'Meu Time' },
      ]
    : [
        { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
        { to: '/materials', icon: FolderOpen, label: 'Materiais' },
        { to: '/collaborators', icon: Users, label: 'Colaboradores' },
        { to: '/reports', icon: BarChart3, label: 'Relatórios' },
        { to: '/signatures', icon: PenTool, label: 'Assinaturas' },
        { to: '/socs', icon: Building2, label: 'SOCs' },
        { to: '/trainings', icon: GraduationCap, label: 'Treinamentos' },
      ];

  return (
    <div className="flex flex-col md:flex-row h-screen bg-background">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-border/40 glass-card z-30">
        <div className="flex items-center gap-3">
          <img src={logoPts} alt="PTS" className="h-8" />
          <h1 className="font-display font-bold text-primary text-sm">PTS MATRIX</h1>
        </div>
        <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -mr-2 text-foreground">
          <Menu size={24} />
        </button>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={closeMobileMenu}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-card/95 backdrop-blur-xl border-r border-border/40 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-5 flex items-center justify-between border-b border-border/30">
          <div className="flex items-center gap-3">
            <img src={logoPts} alt="PTS" className="h-10" />
            <div>
              <h1 className="font-display text-xs font-bold text-primary">PTS MATRIX</h1>
              <p className="text-[10px] text-muted-foreground">Training System</p>
            </div>
          </div>
          <button onClick={closeMobileMenu} className="md:hidden p-1 text-muted-foreground hover:text-foreground">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeMobileMenu}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary/15 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink
              to="/settings"
              onClick={closeMobileMenu}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary/15 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`
              }
            >
              <Settings size={18} />
              Configurações
            </NavLink>
          )}
        </nav>

        <div className="p-4 border-t border-border/30">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
              {profile?.full_name?.charAt(0) ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{profile?.full_name}</p>
              <p className="text-xs text-muted-foreground capitalize">{profile?.role === 'lider' ? 'Líder' : profile?.role}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors w-full"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 pb-24 md:pb-6 relative w-full">
        <Outlet />
      </main>
    </div>
  );
}
