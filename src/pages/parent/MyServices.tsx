import React, { useState } from 'react';
import { useParentContext } from '../../context/ParentDataContext';
import type { Booking } from '../../types';
import {
  BookOpen, MapPin, Clock, Calendar, CheckCircle, Clock2,
  FileText, Activity, PauseCircle, ChevronDown, ChevronUp,
  Bus, ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';

const STATUS_INFO: Record<string, { label: string; color: string; bg: string; icon: React.ElementType; desc: string }> = {
  new:           { label: 'Submitted',      color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',     icon: Clock2,      desc: 'Application received and queued for review.' },
  under_review:  { label: 'Under Review',   color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',   icon: Clock2,      desc: 'Our team is reviewing your application.' },
  contract_sent: { label: 'Contract Sent',  color: 'text-purple-700',  bg: 'bg-purple-50 border-purple-200', icon: FileText,    desc: 'Check your email for the contract to sign.' },
  active:        { label: 'Active',         color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: Activity,   desc: 'Transportation service is currently active.' },
  paused:        { label: 'Paused',         color: 'text-slate-600',   bg: 'bg-slate-50 border-slate-200',   icon: PauseCircle, desc: 'Service is temporarily paused.' },
  completed:     { label: 'Completed',      color: 'text-slate-500',   bg: 'bg-slate-50 border-slate-200',   icon: CheckCircle, desc: 'Service has been completed.' },
};

const TRANSPORT_LABELS: Record<string, string> = {
  roundtrip: 'Roundtrip',
  am_only:   'AM Only',
  pm_only:   'PM Only',
  midday:    'Midday',
};

const DAY_SHORT: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri',
  saturday: 'Sat', sunday: 'Sun',
};

type Tab = 'all' | 'active' | 'pending' | 'past';

const MyServices: React.FC = () => {
  const { loading, bookings, students } = useParentContext();
  const [tab, setTab] = useState<Tab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse h-48" />
        ))}
      </div>
    );
  }

  const filtered = bookings.filter(b => {
    if (tab === 'active') return b.status === 'active';
    if (tab === 'pending') return ['new', 'under_review', 'contract_sent'].includes(b.status);
    if (tab === 'past') return ['paused', 'completed'].includes(b.status);
    return true;
  });

  const counts = {
    all: bookings.length,
    active: bookings.filter(b => b.status === 'active').length,
    pending: bookings.filter(b => ['new', 'under_review', 'contract_sent'].includes(b.status)).length,
    past: bookings.filter(b => ['paused', 'completed'].includes(b.status)).length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">My Services</h1>
        <p className="text-slate-500 text-sm mt-1">All your transportation bookings in one place</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['all', 'active', 'pending', 'past'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              tab === t
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300'
            }`}
          >
            {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
            <span className={`ml-1.5 text-xs ${tab === t ? 'text-blue-200' : 'text-slate-400'}`}>
              {counts[t]}
            </span>
          </button>
        ))}
      </div>

      {/* Bookings */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <BookOpen size={40} className="mx-auto text-slate-200 mb-3" />
          <p className="text-slate-500 font-medium">No services found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(b => (
            <BookingCard
              key={b.id}
              booking={b}
              students={students}
              expanded={expandedId === b.id}
              onToggle={() => setExpandedId(expandedId === b.id ? null : b.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function BookingCard({ booking: b, students, expanded, onToggle }: {
  booking: Booking;
  students: Record<string, { id: string; name: string }>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const info = STATUS_INFO[b.status] || STATUS_INFO.new;
  const StatusIcon = info.icon;
  const names = b.studentIds.map(sid => students[sid]?.name).filter(Boolean);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Status bar */}
      <div className={`px-5 py-3 flex items-center gap-3 border ${info.bg}`}>
        <StatusIcon size={16} className={info.color} />
        <div className="flex-1">
          <span className={`font-semibold text-sm ${info.color}`}>{info.label}</span>
          <span className="text-xs opacity-70 ml-2">{info.desc}</span>
        </div>
      </div>

      {/* Main info */}
      <div className="px-5 py-4 cursor-pointer hover:bg-slate-50/50 transition" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-800 mb-2">{names.join(', ') || 'Students'}</div>
            <div className="space-y-1.5">
              <div className="flex items-start gap-2 text-xs text-slate-600">
                <MapPin size={13} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-medium">Pickup:</span> {b.pickupAddress || '—'}
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-600">
                <MapPin size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-medium">Drop-off:</span> {b.dropoffAddress || '—'}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {b.weeklyRate > 0 && (
              <div className="text-right">
                <div className="text-lg font-bold text-slate-800">${b.weeklyRate.toFixed(2)}</div>
                <div className="text-xs text-slate-400">per week</div>
              </div>
            )}
            {expanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-xs bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full font-medium">
            {TRANSPORT_LABELS[b.transportationType] || b.transportationType}
          </span>
          <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1">
            <Clock size={10} /> {b.schoolStartTime || '?'} – {b.schoolEndTime || '?'}
          </span>
          <span className="text-xs text-slate-400">{b.mileage > 0 ? `${b.mileage} mi` : ''}</span>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <div className="font-semibold text-slate-500 uppercase tracking-wide mb-2">Schedule</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-slate-600">
                  <Calendar size={12} className="text-slate-400" />
                  <span>Days:</span>
                  <span className="font-medium">{b.daysOfWeek?.map(d => DAY_SHORT[d] || d).join(', ')}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Clock size={12} className="text-slate-400" />
                  <span>School:</span>
                  <span className="font-medium">{b.schoolStartTime} – {b.schoolEndTime}</span>
                </div>
                {b.serviceStartDate && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Calendar size={12} className="text-slate-400" />
                    <span>Started:</span>
                    <span className="font-medium">
                      {typeof b.serviceStartDate === 'string'
                        ? b.serviceStartDate
                        : format(new Date(b.serviceStartDate), 'MMM d, yyyy')}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="font-semibold text-slate-500 uppercase tracking-wide mb-2">Route Details</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-slate-600">
                  <Bus size={12} className="text-slate-400" />
                  <span>Type:</span>
                  <span className="font-medium">{TRANSPORT_LABELS[b.transportationType]}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <ArrowRight size={12} className="text-slate-400" />
                  <span>Distance:</span>
                  <span className="font-medium">{b.mileage > 0 ? `${b.mileage} miles` : '—'}</span>
                </div>
                {b.dailyRate > 0 && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <span>Daily Rate:</span>
                    <span className="font-medium">${b.dailyRate.toFixed(2)}/day</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Emergency */}
          {(b.emergencyContact || b.emergencyPhone) && (
            <div className="mt-4 pt-3 border-t border-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Emergency Contact</div>
              <div className="text-xs text-slate-700">
                {b.emergencyContact} {b.emergencyPhone ? `• ${b.emergencyPhone}` : ''}
              </div>
            </div>
          )}

          {b.notes && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes</div>
              <div className="text-xs text-slate-700">{b.notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MyServices;
