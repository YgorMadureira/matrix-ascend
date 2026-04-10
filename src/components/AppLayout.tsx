import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, FolderOpen, Users, BarChart3, Settings, LogOut, Building2 } from 'lucide-react';
import logoPts from '@/assets/logo_pts.png';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/materials', icon: FolderOpen, label: 'Materiais' },
  { to: '/collaborators', icon: Users, label: 'Colaboradores' },
  { to: '/reports', icon: BarChart3, label: 'Relatórios' },
  { to: '/socs', icon: Building2, label: 'SOCs' },
];

export default function AppLayout() {
  const { profile, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col glass-card rounded-none border-r border-border/40">
        <div className="p-5 flex items-center gap-3 border-b border-border/30">
          <img src={logoPts} alt="PTS" className="h-10" />
          <div>
            <h1 className="font-display text-xs font-bold text-primary">PTS MATRIX</h1>
            <p className="text-[10px] text-muted-foreground">Training System</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
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
              <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
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
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
