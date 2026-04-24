import {
  addDoc,
  collection,
  doc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { AppNotification, NotificationType, NotificationAudience } from '../types';

export async function createNotification(params: {
  recipientUid: string;
  audience: NotificationAudience;
  type: NotificationType;
  title: string;
  body: string;
  linkTo?: string;
  bookingId?: string;
  studentId?: string;
  driverId?: string;
  clientId?: string;
  invoiceId?: string;
  incidentId?: string;
  priority?: 'low' | 'normal' | 'high';
}): Promise<string> {
  const ref = await addDoc(collection(db, 'notifications'), {
    ...params,
    linkTo: params.linkTo ?? null,
    bookingId: params.bookingId ?? null,
    studentId: params.studentId ?? null,
    driverId: params.driverId ?? null,
    clientId: params.clientId ?? null,
    invoiceId: params.invoiceId ?? null,
    incidentId: params.incidentId ?? null,
    priority: params.priority ?? 'normal',
    read: false,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await updateDoc(doc(db, 'notifications', notificationId), {
    read: true,
    readAt: serverTimestamp(),
  });
}

export function subscribeToNotifications(
  uid: string,
  onChange: (items: AppNotification[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'notifications'),
    where('recipientUid', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, snap => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() })) as AppNotification[];
    onChange(items);
  });
}
