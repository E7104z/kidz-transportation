import React from 'react';
import { useParentContext } from '../../context/ParentDataContext';
import type { StudentEvent } from '../../types';
import { format } from 'date-fns';
import {
  Users, BookOpen, Activity, Clock2, CheckCircle, MapPin, Clock,
  UserCheck, UserX, XCircle, ArrowRight, Navigation, TrendingUp,
  CalendarDays, Bus,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const STATUS_COLORS: Record<string, string> = {
  new:           'bg-blue-500',
  under_review:  'bg-amber-500',
  contract_sent: 'bg-purple-500',
  active:        'bg-emerald-500',
  paused:        'bg-slate-400',
  completed:     'bg-slate-300',
};

const ParentDashboard: React.FC = () => {
  const { loading, parentName, bookings, students, todayLogs } = useParentContext();

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse h-32" />
        ))}
      </div>
    );
  }

  const activeBookings = bookings.filter(b => b.status === 'active');
  const pendingBookings = bookings.filter(b => ['new', 'under_review', 'contract_sent'].includes(b.status));
  const totalStudents = Object.keys(students).length;
  const todayActive = activeBookings.filter(b => todayLogs[b.id]);

  // Compute today's student statuses
  let pickedUp = 0, droppedOff = 0, waiting = 0;
  activeBookings.forEach(b => {
    const log = todayLogs[b.id];
    const events = log?.studentEvents ?? {};
    b.studentIds.forEach(sid => {
      const ev = events[sid] as StudentEvent | undefined;
      if (ev?.status === 'dropped_off') droppedOff++;
      else if (ev?.status === 'picked_up') pickedUp++;
      else waiting++;
    });
  });

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">
          Welcome back, {parentName.split(' ')[0]}!
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {format(new Date(), 'EEEE, MMMM d, yyyy')} &middot; Here's your overview
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Users} iconColor="text-blue-600" iconBg="bg-blue-50"
          label="Children" value={totalStudents}
        />
        <StatCard
          icon={BookOpen} iconColor="text-emerald-600" iconBg="bg-emerald-50"
          label="Active Services" value={activeBookings.length}
        />
        <StatCard
          icon={Clock2} iconColor="text-amber-600" iconBg="bg-amber-50"
          label="Pending" value={pendingBookings.length}
        />
        <StatCard
          icon={TrendingUp} iconColor="text-purple-600" iconBg="bg-purple-50"
          label="Today's Routes" value={todayActive.length}
        />
      </div>

      {/* Today's Activity */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-teal-500" />
            <h2 className="font-semibold text-slate-800">Today's Activity</h2>
          </div>
          <Link to="/parent/tracking" className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
            Live Tracking <ArrowRight size={12} />
          </Link>
        </div>

        {activeBookings.length === 0 ? (
          <div className="p-8 text-center">
            <Bus size={36} className="mx-auto text-slate-200 mb-3" />
            <p className="text-slate-500 text-sm">No active services yet</p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Summary strip */}
            <div className="flex gap-3">
              <MiniStat color="bg-amber-100 text-amber-700" label="Picked Up" count={pickedUp} />
              <MiniStat color="bg-emerald-100 text-emerald-700" label="Dropped Off" count={droppedOff} />
              <MiniStat color="bg-slate-100 text-slate-500" label="Waiting" count={waiting} />
            </div>

            {/* Per-booking rows */}
            {activeBookings.map(b => {
              const log = todayLogs[b.id];
              const events = log?.studentEvents ?? {};
              const names = b.studentIds.map(sid => students[sid]?.name).filter(Boolean).join(', ');

              return (
                <div key={b.id} className="flex items-center gap-4 px-4 py-3 bg-slate-50 rounded-xl">
                  <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Navigation size={16} className="text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-slate-800 truncate">{names || 'Students'}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                      <MapPin size={10} /> {b.pickupAddress?.split(',')[0]}
                      <span className="mx-1">→</span>
                      {b.dropoffAddress?.split(',')[0]}
                    </div>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-1.5">
                    {!log ? (
                      <span className="text-xs text-slate-400 flex items-center gap-1"><Clock2 size={12} /> Not started</span>
                    ) : log.ran === false ? (
                      <span className="text-xs text-red-600 flex items-center gap-1"><XCircle size={12} /> Missed</span>
                    ) : (
                      b.studentIds.map(sid => {
                        const ev = events[sid] as StudentEvent | undefined;
                        return (
                          <span key={sid} className={`w-6 h-6 rounded-full flex items-center justify-center ${
                            ev?.status === 'dropped_off' ? 'bg-emerald-100' :
                            ev?.status === 'picked_up' ? 'bg-amber-100' :
                            ev?.status === 'absent' ? 'bg-red-100' :
                            'bg-slate-100'
                          }`}>
                            {ev?.status === 'dropped_off' && <CheckCircle size={12} className="text-emerald-600" />}
                            {ev?.status === 'picked_up' && <UserCheck size={12} className="text-amber-600" />}
                            {ev?.status === 'absent' && <UserX size={12} className="text-red-500" />}
                            {!ev && <Clock size={10} className="text-slate-400" />}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <QuickLink to="/parent/children" icon={Users} color="bg-blue-600" label="My Children" desc="View student info & schools" />
        <QuickLink to="/parent/services" icon={BookOpen} color="bg-emerald-600" label="My Services" desc="All transportation bookings" />
        <QuickLink to="/parent/billing" icon={CalendarDays} color="bg-purple-600" label="Billing" desc="Invoices & payment history" />
      </div>

      {/* Pending items */}
      {pendingBookings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <h3 className="font-semibold text-amber-800 text-sm mb-3 flex items-center gap-2">
            <Clock2 size={16} /> Pending Applications
          </h3>
          <div className="space-y-2">
            {pendingBookings.map(b => {
              const names = b.studentIds.map(sid => students[sid]?.name).filter(Boolean).join(', ');
              return (
                <div key={b.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-amber-100">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{names || 'Application'}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{b.pickupAddress?.split(',')[0]} → {b.dropoffAddress?.split(',')[0]}</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold text-white ${STATUS_COLORS[b.status] || 'bg-slate-400'}`}>
                    {b.status === 'new' ? 'Submitted' : b.status === 'under_review' ? 'Under Review' : 'Contract Sent'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

function StatCard({ icon: Icon, iconColor, iconBg, label, value }: {
  icon: React.ElementType; iconColor: string; iconBg: string; label: string; value: number;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center mb-3`}>
        <Icon size={20} className={iconColor} />
      </div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function MiniStat({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className={`flex-1 rounded-xl px-3 py-2 text-center ${color}`}>
      <div className="text-lg font-bold">{count}</div>
      <div className="text-xs font-medium">{label}</div>
    </div>
  );
}

function QuickLink({ to, icon: Icon, color, label, desc }: {
  to: string; icon: React.ElementType; color: string; label: string; desc: string;
}) {
  return (
    <Link
      to={to}
      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all group"
    >
      <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center mb-3`}>
        <Icon size={20} className="text-white" />
      </div>
      <div className="font-semibold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">{label}</div>
      <div className="text-xs text-slate-400 mt-1">{desc}</div>
    </Link>
  );
}

export default ParentDashboard;
