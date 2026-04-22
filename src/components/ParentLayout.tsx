import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, BookOpen, Navigation, UserCircle,
  Receipt, LogOut, Menu, X, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useParentContext } from '../context/ParentDataContext';
import logo from '../assets/KIDZ logo4 site.png';

const ParentLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, signOut } = useAuth();
  const { permissions } = useParentContext();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { to: '/parent/dashboard', label: 'Dashboard',    icon: LayoutDashboard, show: true },
    { to: '/parent/children',  label: 'My Children',  icon: Users,           show: true },
    { to: '/parent/services',  label: 'My Services',  icon: BookOpen,        show: true },
    { to: '/parent/tracking',  label: 'Live Tracking', icon: Navigation,     show: true },
    { to: '/parent/billing',   label: 'Billing',      icon: Receipt,         show: permissions.canSeeBilling },
    { to: '/parent/profile',   label: 'Profile',      icon: UserCircle,      show: true },
  ].filter(item => item.show);

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <>
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10 flex items-center justify-center">
        <img src={logo} alt="KIDZ Transportation" className="h-16 w-auto object-contain" />
      </div>

      {/* Nav */}
      <nav className="flex-1 mt-4 px-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-white/20 text-white shadow-sm'
                  : 'text-blue-100 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            {label}
            <ChevronRight size={14} className="ml-auto opacity-40" />
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-white/10 px-6 py-4">
        <div className="text-blue-200 text-xs mb-2 truncate">{user?.email ?? 'parent'}</div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-xs text-red-300 hover:text-red-200 font-medium transition-colors"
        >
          <LogOut size={13} />
          Logout
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-screen w-64 bg-gradient-to-b from-blue-600 to-indigo-700 flex-col z-30 shadow-xl">
        {sidebar}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-gradient-to-b from-blue-600 to-indigo-700 flex flex-col shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 text-white/70 hover:text-white"
            >
              <X size={20} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="lg:ml-64 flex-1 min-h-screen">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} className="text-slate-600">
            <Menu size={22} />
          </button>
          <img src={logo} alt="KIDZ" className="h-8 w-auto" />
        </div>

        <div className="p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default ParentLayout;
