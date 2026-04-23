import React from 'react';
import { Eye, X } from 'lucide-react';
import { useImpersonation } from '../context/ImpersonationContext';

const ImpersonationBanner: React.FC = () => {
  const { impersonating, stopImpersonation } = useImpersonation();

  if (!impersonating) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-white text-sm font-semibold flex items-center justify-between px-4 py-2 shadow-lg">
      <div className="flex items-center gap-2">
        <Eye size={16} />
        <span>
          Viewing as <strong>{impersonating.name}</strong>{' '}
          <span className="font-normal opacity-80">({impersonating.role})</span>
          {' — '}Read-only mode
        </span>
      </div>
      <button
        onClick={stopImpersonation}
        className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-colors text-xs"
      >
        <X size={13} /> Exit View-As
      </button>
    </div>
  );
};

export default ImpersonationBanner;
