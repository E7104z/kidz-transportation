/**
 * useNotifications — reusable real-time hook for the current user's notifications.
 *
 * Wraps the existing src/services/notifications.ts subscribe function. Returns
 * the full list, unread count, and mark-read helpers.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  subscribeToNotifications,
  markNotificationRead,
} from '../services/notifications';
import type { AppNotification } from '../types';

interface UseNotificationsReturn {
  notifications: AppNotification[];
  unreadCount:   number;
  markRead:      (id: string) => Promise<void>;
  markAllRead:   () => Promise<void>;
}

export function useNotifications(): UseNotificationsReturn {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    const unsub = subscribeToNotifications(user.uid, setNotifications);
    return unsub;
  }, [user]);

  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read).length,
    [notifications],
  );

  const markRead = async (id: string) => {
    await markNotificationRead(id);
  };

  const markAllRead = async () => {
    await Promise.all(
      notifications.filter(n => !n.read && n.id).map(n => markNotificationRead(n.id)),
    );
  };

  return { notifications, unreadCount, markRead, markAllRead };
}
