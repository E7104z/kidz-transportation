import React, { createContext, useContext } from 'react';
import { useParentData, type ParentData } from '../hooks/useParentData';

const ParentDataContext = createContext<ParentData | null>(null);

export const ParentDataProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const data = useParentData();
  return <ParentDataContext.Provider value={data}>{children}</ParentDataContext.Provider>;
};

export function useParentContext(): ParentData {
  const ctx = useContext(ParentDataContext);
  if (!ctx) throw new Error('useParentContext must be used within ParentDataProvider');
  return ctx;
}
