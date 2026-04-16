import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { formatDistanceToNow, isToday } from 'date-fns';
import { Columns, Users, Car, DollarSign, Upload, Bus, UserCheck, type LucideIcon, ExternalLink } from 'lucide-react';
import { db } from '../../services/firebase';

const StatCard = ({ label, value, sub, icon: Icon, gradient, loading }: {
  label: string; value: string | number; sub: string; icon: LucideIcon; gradient: string; loading?: boolean;
}) => (
  <div className={`rounded-2xl p-6 text-white shadow-lg ${gradient}`}>
    <div className="flex items-start justify-between">
      <div>
        <div className="text-white/80 text-sm font-medium">{label}</div>
        {loading
          ? <div className="animate-pulse bg-slate-200 rounded h-8 w-24 mt-1" />
          : <div className="text-3xl font-bold mt-1">{value}</div>
        }
        <div className="text-white/70 text-xs mt-1">{sub}</div>
      </div>
      <div className="bg-white/20 rounded-xl p-2.5">
        <Icon size={20} />
      </div>
    </div>
  </div>
);

interface NavCardProps {
  to: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  accent: string;
  external?: boolean;
}

const NavCard = ({ to, label, desc, icon: Icon, accent, external }: NavCardProps) => {
  const inner = (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-all duration-200 group flex items-start gap-4 hover:border-${accent}-300`}>
      <div className={`bg-${accent}-50 rounded-xl p-3 group-hover:bg-${accent}-100 transition-colors flex-shrink-0`}>
        <Icon size={20} className={`text-${accent}-600`} />
      </div>
      <div className="min-w-0">
        <div className={`font-semibold text-slate-800 group-hover:text-${accent}-600 transition-colors flex items-center gap-1.5`}>
          {label}
          {external && <ExternalLink size={12} className="text-slate-400" />}
        </div>
        <p className="text-sm text-slate-500 mt-0.5">{desc}</p>
      </div>
    </div>
  );
  if (external) return <a href={to} target="_blank" rel="noopener noreferrer">{inner}</a>;
  return <Link to={to}>{inner}</Link>;
};

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  under_review: 'Under Review',
  contract_sent: 'Contract Sent',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  under_review: 'bg-amber-100 text-amber-700',
  contract_sent: 'bg-purple-100 text-purple-700',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-gray-100 text-gray-500',
  completed: 'bg-gray-100 text-gray-500',
};

interface RecentBooking {
  id: string;
  studentName: string;
  parentName: string;
  status: string;
  weeklyRate: number;
  createdAt: Date | null;
}

interface Stats {
  pending: number;
  newToday: number;
  activeClients: number;
  weeklyRevenue: number;
  drivers: number;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    pending: 0,
    newToday: 0,
    activeClients: 0,
    weeklyRevenue: 0,
    drivers: 0,
  });
  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([]);

  useEffect(() => {
    let resolved = 0;
    const tryDone = () => { resolved++; if (resolved >= 3) setLoading(false); };

    // ── Booking stats (pending + active clients + weekly revenue) ─────────
    const bookingsQ = query(collection(db, 'bookings'));
    const unsubBookings = onSnapshot(bookingsQ, snap => {
      let pending = 0;
      let newToday = 0;
      let activeClients = 0;
      let weeklyRevenue = 0;

      snap.forEach(d => {
        const data = d.data();
        const status: string = data.status ?? '';

        if (status === 'new' || status === 'under_review') {
          pending++;
          if (status === 'new') {
            const raw = data.createdAt;
            const date = raw?.toDate ? raw.toDate() : raw instanceof Date ? raw : null;
            if (date && isToday(date)) newToday++;
          }
        }
        if (status === 'active') {
          activeClients++;
          weeklyRevenue += data.weeklyRate ?? 0;
        }
      });

      setStats(prev => ({ ...prev, pending, newToday, activeClients, weeklyRevenue }));
      tryDone();
    });

    // ── Drivers collection count ──────────────────────────────────────────
    const unsubDrivers = onSnapshot(collection(db, 'drivers'), snap => {
      setStats(prev => ({ ...prev, drivers: snap.size }));
      tryDone();
    });

    // ── Recent 5 bookings ────────────────────────────────────────────────
    const recentQ = query(
      collection(db, 'bookings'),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    const unsubRecent = onSnapshot(recentQ, snap => {
      const rows: RecentBooking[] = snap.docs.map(d => {
        const data = d.data();
        const raw = data.createdAt;
        const createdAt = raw?.toDate ? raw.toDate() : raw instanceof Date ? raw : null;
        const students: any[] = data.students ?? [];
        return {
          id: d.id,
          studentName: students[0]?.name ?? data.studentNames?.[0] ?? '—',
          parentName: data.client?.name ?? data.clientName ?? '—',
          status: data.status ?? 'new',
          weeklyRate: data.weeklyRate ?? 0,
          createdAt,
        };
      });
      setRecentBookings(rows);
      tryDone();
    });

    return () => {
      unsubBookings();
      unsubDrivers();
      unsubRecent();
    };
  }, []);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  return (
  <div>
    {/* Page header */}
    <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-10">
      <h1 className="text-3xl font-bold text-white">Welcome back!</h1>
      <p className="text-indigo-200 text-sm mt-1">Here's what's happening with KIDZ Transportation today.</p>
    </div>

    <div className="p-8">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
        <StatCard
          label="Applications Pending"
          value={stats.pending}
          sub={stats.newToday > 0 ? `${stats.newToday} new today` : 'Open applications'}
          icon={Columns}
          gradient="bg-gradient-to-br from-blue-500 to-cyan-500"
          loading={loading}
        />
        <StatCard
          label="Active Clients"
          value={stats.activeClients}
          sub="Active bookings"
          icon={Users}
          gradient="bg-gradient-to-br from-violet-500 to-purple-600"
          loading={loading}
        />
        <StatCard
          label="Drivers"
          value={stats.drivers}
          sub="On roster"
          icon={Car}
          gradient="bg-gradient-to-br from-emerald-500 to-teal-500"
          loading={loading}
        />
        <StatCard
          label="Weekly Revenue"
          value={fmt(stats.weeklyRevenue)}
          sub="Active routes"
          icon={DollarSign}
          gradient="bg-gradient-to-br from-amber-500 to-orange-500"
          loading={loading}
        />
      </div>

      {/* Recent Applications */}
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Recent Applications</h2>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-10">
        {recentBookings.length === 0 && !loading ? (
          <div className="px-6 py-8 text-sm text-slate-400 text-center">No applications yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Student</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Parent</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Weekly Rate</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentBookings.map(b => (
                <tr
                  key={b.id}
                  className="hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => navigate('/admin/pipeline')}
                >
                  <td className="px-5 py-3 font-medium text-slate-800">{b.studentName}</td>
                  <td className="px-5 py-3 text-slate-600">{b.parentName}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABELS[b.status] ?? b.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700 font-medium">{fmt(b.weeklyRate)}</td>
                  <td className="px-5 py-3 text-right text-slate-400 text-xs">
                    {b.createdAt ? formatDistanceToNow(b.createdAt, { addSuffix: true }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Admin pages */}
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Admin Pages</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <NavCard to="/admin/pipeline"  label="Pipeline"  desc="View & manage applications"     icon={Columns}   accent="indigo" />
        <NavCard to="/admin/clients"   label="Clients"   desc="Manage registered families"     icon={Users}     accent="violet" />
        <NavCard to="/admin/drivers"   label="Drivers"   desc="Manage driver roster"           icon={Car}       accent="teal" />
        <NavCard to="/admin/payroll"   label="Payroll"   desc="Driver payouts & pay history"   icon={DollarSign} accent="amber" />
        <NavCard to="/admin/import"    label="Import"    desc="Paste & import from spreadsheet" icon={Upload}   accent="blue" />
      </div>

      {/* Portal previews */}
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">User Portals</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <NavCard to="/driver/dashboard" label="Driver Dashboard" desc="See what drivers see after login"   icon={Bus}       accent="teal" />
        <NavCard to="/parent/status"    label="Parent Portal"    desc="See what parents see after login"   icon={UserCheck} accent="indigo" />
        <NavCard to="/driver/setup"     label="Driver Setup"     desc="Link drivers share to create account" icon={Car}     accent="emerald" />
        <NavCard to="/parent/setup"     label="Parent Setup"     desc="Link parents share to create account" icon={Users}   accent="purple" />
        <NavCard to="/apply"            label="Apply Form"       desc="Public family application form"     icon={UserCheck} accent="blue" />
        <NavCard to="/login"            label="Login Page"       desc="Main sign-in page"                  icon={ExternalLink} accent="slate" />
      </div>
    </div>
  </div>
  );
};

export default Dashboard;
