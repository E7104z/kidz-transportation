import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Spinner = () => (
  <div className="flex items-center justify-center min-h-screen bg-slate-100">
    <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
  </div>
);

const DriverGuard = ({ children }: { children: ReactNode }) => {
  const { user, role, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user || (role !== 'driver' && role !== 'admin')) return <Navigate to="/login" replace />;
  return <>{children}</>;
};
export default DriverGuard;
