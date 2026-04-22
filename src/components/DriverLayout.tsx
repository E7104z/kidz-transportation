import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bus, LayoutDashboard, History, User, LogOut } from 'lucide-react';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { signOut } from '../services/authService';

interface Ctx {
  linkedId: string;
  driverName: string;
  driverPhotoURL: string | null;
}
// eslint-disable-next-line react-refresh/only-export-components
export const useDriverContext = () => React.useContext(DriverContext);
const DriverContext = React.createContext<Ctx>({ linkedId: '', driverName: '', driverPhotoURL: null });

const DriverLayout: React.FC = () => {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [linkedId, setLinkedId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhotoURL, setDriverPhotoURL] = useState<string | null>(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      if (cancelled) return;
      const id = userSnap.data()?.linkedId as string | undefined;
      setDriverName(userSnap.data()?.name || user.email || 'Driver');
      if (!id) { setCheckingOnboarding(false); return; }
      setLinkedId(id);
      const driverSnap = await getDoc(doc(db, 'drivers', id));
      if (cancelled) return;
      const d = driverSnap.data();
      if (d?.photoURL) setDriverPhotoURL(d.photoURL as string);
      if (d?.name) setDriverName(d.name as string);
      // Admins viewing /driver/* skip onboarding gate.
      if (role !== 'admin' && d?.onboardingStatus !== 'complete') {
        navigate('/driver/onboarding', { replace: true });
        return;
      }
      setCheckingOnboarding(false);
    })();
    return () => { cancelled = true; };
  }, [user, role, navigate]);

  const handleLogout = async () => {
    if (linkedId) {
      try { await deleteDoc(doc(db, 'driverLocations', linkedId)); } catch { /* ignore */ }
    }
    await signOut();
    navigate('/login', { replace: true });
  };

  const navItems = [
    { to: '/driver/today',   label: 'Today',   icon: LayoutDashboard },
    { to: '/driver/history', label: 'History', icon: History },
    { to: '/driver/profile', label: 'Profile', icon: User },
  ];

  return (
    <DriverContext.Provider value={{ linkedId, driverName, driverPhotoURL }}>
      <div className="min-h-screen bg-slate-100 pb-24">
        {checkingOnboarding ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
        <>
        {/* Top header */}
        <div className="bg-gradient-to-r from-teal-600 to-emerald-600 px-5 py-3 flex items-center justify-between sticky top-0 z-20 shadow-md">
          <div className="flex items-center gap-3 min-w-0">
            {driverPhotoURL ? (
              <img src={driverPhotoURL} alt={driverName}
                className="w-10 h-10 rounded-full object-cover border-2 border-white/40 flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 bg-amber-400 rounded-full flex items-center justify-center flex-shrink-0">
                <Bus size={18} className="text-teal-900" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-white font-bold leading-tight truncate">{driverName}</div>
              <div className="text-teal-100 text-xs">KIDZ Driver</div>
            </div>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
            <LogOut size={13} /> Logout
          </button>
        </div>

        <Outlet />

        {/* Bottom nav */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-20 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
          <div className="max-w-md mx-auto grid grid-cols-3">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center py-3 gap-0.5 text-xs font-semibold transition-colors ${
                    isActive ? 'text-teal-600' : 'text-slate-400 hover:text-slate-600'
                  }`
                }>
                <Icon size={22} strokeWidth={2.2} />
                {label}
              </NavLink>
            ))}
          </div>
        </div>
        </>
        )}
      </div>
    </DriverContext.Provider>
  );
};

export default DriverLayout;
