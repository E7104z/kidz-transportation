import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Columns, Users, Car, DollarSign, Upload, Menu, X, LogOut, Radio, Receipt } from 'lucide-react';
import NotificationBell from './NotificationBell';
import GlobalSearch from './GlobalSearch';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/KIDZ logo4 site.png';

const AdminLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const navItems = [
    { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/dispatch',  label: 'Dispatch',  icon: Radio },
    { to: '/admin/pipeline',  label: 'Pipeline',  icon: Columns },
    { to: '/admin/clients',   label: 'Clients',   icon: Users },
    { to: '/admin/drivers',   label: 'Drivers',   icon: Car },
    { to: '/admin/payroll',   label: 'Payroll',   icon: DollarSign },
    { to: '/admin/billing',   label: 'Billing',   icon: Receipt },
    { to: '/admin/import',    label: 'Import',    icon: Upload },
  ];

  const sidebar = (
    <>
      <div className="px-6 py-5 border-b border-white/10 flex items-center justify-center">
        <img src={logo} alt="KIDZ Transportation" className="h-20 w-auto object-contain" />
      </div>
      <div className="px-3 pt-3">
        <GlobalSearch />
      </div>
      <nav className="flex-1 mt-4 px-3">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-xl mb-1 text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-white/20 text-white shadow-sm'
                  : 'text-indigo-100 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 px-6 py-4">
        <div className="text-indigo-200 text-xs mb-2 truncate">{user?.email ?? 'admin'}</div>
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
    <div className="flex min-h-screen bg-slate-100">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-screen w-64 bg-gradient-to-b from-indigo-700 to-violet-800 flex-col z-30 shadow-xl print:hidden">
        {sidebar}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-gradient-to-b from-indigo-700 to-violet-800 flex flex-col shadow-xl">
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
      <main className="lg:ml-64 print:ml-0 flex-1 min-h-screen bg-slate-100 print:bg-white">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} className="text-slate-600">
            <Menu size={22} />
          </button>
          <img src={logo} alt="KIDZ" className="h-8 w-auto" />
          <div className="flex-1 min-w-0"><GlobalSearch /></div>
          <NotificationBell colorClass="text-slate-600" />
        </div>
        {children}
      </main>
    </div>
  );
};

export default AdminLayout;