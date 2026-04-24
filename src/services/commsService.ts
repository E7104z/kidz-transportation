import {
  addDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { ClientCommunication, CommunicationChannel, CommunicationDirection } from '../types';

export async function logCommunication(params: {
  clientId:   string;
  channel:    CommunicationChannel;
  direction:  CommunicationDirection;
  subject?:   string;
  body:       string;
  loggedByUid: string;
  loggedByName: string;
  bookingId?: string;
  invoiceId?: string;
}): Promise<string> {
  const ref = await addDoc(collection(db, 'clientCommunications'), {
    ...params,
    subject:   params.subject ?? null,
    bookingId: params.bookingId ?? null,
    invoiceId: params.invoiceId ?? null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeToClientCommunications(
  clientId: string,
  onChange: (items: ClientCommunication[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'clientCommunications'),
    where('clientId', '==', clientId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, snap => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() })) as ClientCommunication[];
    onChange(items);
  });
}
