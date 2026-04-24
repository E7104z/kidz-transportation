import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';
import type { AppNotification } from '../types';

interface Props {
  /** Icon colour class — defaults to current text colour */
  colorClass?: string;
}

const NotificationBell: React.FC<Props> = ({ colorClass = 'text-current' }) => {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef        = useRef<HTMLDivElement>(null);

  // Browser notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Push browser notifications for new unread items
  const prevCountRef = useRef(0);
  useEffect(() => {
    const unread = notifications.filter(n => !n.read);
    if (unread.length > prevCountRef.current && Notification.permission === 'granted') {
      const newest = unread[0];
      if (newest) new Notification(newest.title, { body: newest.body, icon: '/favicon.ico' });
    }
    prevCountRef.current = unread.length;
  }, [notifications]);

  // Close panel when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const recent = notifications.slice(0, 20);

  const handleOpen = () => setOpen(v => !v);

  const handleRead = async (n: AppNotification) => {
    if (!n.read && n.id) await markRead(n.id);
    if (n.linkTo) window.location.href = n.linkTo;
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
        className={`relative p-1.5 rounded-full hover:bg-white/10 transition-colors ${colorClass}`}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="font-semibold text-slate-800 text-sm">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Items */}
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-400 text-sm">
                No notifications yet
              </div>
            ) : (
              recent.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleRead(n)}
                  className={`w-full text-left px-4 py-3 transition-colors hover:bg-slate-50 ${
                    n.read ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span className="mt-1.5 flex-shrink-0 w-2 h-2 bg-indigo-500 rounded-full" />
                    )}
                    <div className={!n.read ? '' : 'pl-4'}>
                      <div className="text-sm font-medium text-slate-800 leading-tight">
                        {n.title}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
