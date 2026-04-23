/**
 * useOfflineQueue — React hook for queuing Firestore writes when offline
 * and replaying them automatically when the connection is restored.
 *
 * Usage:
 *   const { enqueue } = useOfflineQueue();
 *   enqueue(() => setDoc(ref, data, { merge: true }));
 */
import { useEffect, useRef, useCallback } from 'react';

type QueuedWrite = () => Promise<unknown>;

// Module-level queue so it survives component remounts
const pendingQueue: QueuedWrite[] = [];
let draining = false;

async function drainQueue() {
  if (draining) return;
  draining = true;
  while (pendingQueue.length > 0) {
    const write = pendingQueue.shift()!;
    try {
      await write();
    } catch (err) {
      console.warn('[offlineQueue] write failed:', err);
      // Re-queue on network failure so it retries on the next reconnect
      if (!navigator.onLine) {
        pendingQueue.unshift(write);
        break;
      }
    }
  }
  draining = false;
}

export function useOfflineQueue() {
  const onlineRef = useRef(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      onlineRef.current = true;
      drainQueue();
    };
    const handleOffline = () => {
      onlineRef.current = false;
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // Drain any writes that queued before this mount
    if (navigator.onLine) drainQueue();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const enqueue = useCallback((write: QueuedWrite) => {
    if (onlineRef.current) {
      // Online: execute immediately, fall back to queue on failure
      write().catch(err => {
        console.warn('[offlineQueue] immediate write failed, queuing:', err);
        pendingQueue.push(write);
      });
    } else {
      pendingQueue.push(write);
    }
  }, []);

  return { enqueue };
}
