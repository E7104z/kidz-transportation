/**
 * ImpersonationContext — lets admins enter a read-only "view as" mode
 * that simulates another user's perspective without actually logging in as them.
 *
 * Usage:
 *   const { impersonating, startImpersonation, stopImpersonation } = useImpersonation();
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import type { UserRole } from '../services/userService';

interface ImpersonationTarget {
  uid:      string;
  name:     string;
  role:     UserRole;
  linkedId: string;
}

interface ImpersonationContextValue {
  impersonating:       ImpersonationTarget | null;
  startImpersonation:  (target: ImpersonationTarget) => void;
  stopImpersonation:   () => void;
}

const ImpersonationContext = createContext<ImpersonationContextValue>({
  impersonating:      null,
  startImpersonation: () => {},
  stopImpersonation:  () => {},
});

export const ImpersonationProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [impersonating, setImpersonating] = useState<ImpersonationTarget | null>(null);

  const startImpersonation = useCallback((target: ImpersonationTarget) => {
    setImpersonating(target);
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonating(null);
  }, []);

  return (
    <ImpersonationContext.Provider value={{ impersonating, startImpersonation, stopImpersonation }}>
      {children}
    </ImpersonationContext.Provider>
  );
};

export function useImpersonation(): ImpersonationContextValue {
  return useContext(ImpersonationContext);
}
