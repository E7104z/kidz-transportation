import React from 'react';
import {
  Bell,
  ArrowUp,
  CheckCircle,
  UserX,
  AlertTriangle,
  X,
} from 'lucide-react';
import { isToday, formatDistanceToNow } from 'date-fns';
import { useNotifications } from '../hooks/useNotifications';
import type { AppNotification, NotificationType } from '../types';

interface Props {
  open:    boolean;
  onClose: () => void;
}

interface TypeStyle {
  bg:   string;
  icon: React.ReactNode;
}

const TYPE_STYLES: Partial<Record<NotificationType, TypeStyle>> = {
  student_picked_up:  { bg: 'bg-teal-100 text-teal-700',     icon: <ArrowUp size={16} /> },
  driver_en_route:    { bg: 'bg-teal-100 text-teal-700',     icon: <ArrowUp size={16} /> },
  driver_nearby:      { bg: 'bg-teal-100 text-teal-700',     icon: <ArrowUp size={16} /> },
  student_dropped_off:{ bg: 'bg-green-100 text-green-700',   icon: <CheckCircle size={16} /> },
  route_missed:       { bg: 'bg-amber-100 text-amber-700',   icon: <AlertTriangle size={16} /> },
  route_delayed:      { bg: 'bg-amber-100 text-amber-700',   icon: <AlertTriangle size={16} /> },
  incident_reported:  { bg: 'bg-red-100 text-red-700',       icon: <UserX size={16} /> },
};

const DEFAULT_STYLE: TypeStyle = {
  bg:   'bg-slate-100 text-slate-600',
  icon: <Bell size={16} />,
};

const getTs = (n: AppNotification): Date | null => {
  const raw = n.createdAt as unknown;
  if (!raw) return null;
  if (typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    return (raw as { toDate: () => Date }).toDate();
  }
  if (raw instanceof Date) return raw;
  return null;
};

const NotificationDrawer: React.FC<Props> = ({ open, onClose }) => {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  const { today, earlier } = notifications.reduce<{
    today:   AppNotification[];
    earlier: AppNotification[];
  }>(
    (acc, n) => {
      const d = getTs(n);
      if (d && isToday(d)) acc.today.push(n);
      else                  acc.earlier.push(n);
      return acc;
    },
    { today: [], earlier: [] },
  );

  const handleRowClick = async (n: AppNotification) => {
    if (!n.read && n.id) await markRead(n.id);
  };

  const renderRow = (n: AppNotification) => {
    const style = TYPE_STYLES[n.type] ?? DEFAULT_STYLE;
    const d     = getTs(n);
    const rel   = d ? formatDistanceToNow(d, { addSuffix: true }) : '';
    return (
      <button
        key={n.id}
        onClick={() => handleRowClick(n)}
        className={`w-full text-left px-4 py-3 flex items-start gap-3 border-l-2 transition-colors hover:bg-slate-50 ${
          n.read
            ? 'bg-white border-transparent'
            : 'bg-teal-50 border-teal-500'
        }`}
      >
        <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${style.bg}`}>
          {style.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-800 leading-tight truncate">{n.title}</div>
          <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</div>
          {rel && <div className="text-xs text-slate-400 mt-1">{rel}</div>}
        </div>
      </button>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Drawer — right sheet on lg+, bottom sheet on mobile */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className={`
          fixed z-50 bg-white shadow-2xl flex flex-col
          transition-transform duration-300 ease-out
          inset-x-0 bottom-0 rounded-t-2xl max-h-[80vh]
          lg:inset-y-0 lg:right-0 lg:left-auto lg:bottom-auto lg:w-96 lg:max-h-none lg:rounded-none lg:rounded-l-2xl
          ${open
            ? 'translate-y-0 lg:translate-y-0 lg:translate-x-0'
            : 'translate-y-full lg:translate-y-0 lg:translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <span className="font-semibold text-slate-800">Notifications</span>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close notifications"
              className="text-slate-400 hover:text-slate-600 rounded-full p-1 hover:bg-slate-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6">
              <Bell size={32} className="text-slate-300 mb-3" />
              <div className="text-sm text-slate-500">No notifications yet</div>
            </div>
          ) : (
            <>
              {today.length > 0 && (
                <div>
                  <div className="px-5 pt-4 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Today</div>
                  <div className="divide-y divide-slate-50">{today.map(renderRow)}</div>
                </div>
              )}
              {earlier.length > 0 && (
                <div>
                  <div className="px-5 pt-4 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Earlier</div>
                  <div className="divide-y divide-slate-50">{earlier.map(renderRow)}</div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
};

export default NotificationDrawer;
