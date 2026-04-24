import React, { useEffect, useRef, useState } from 'react';
import { collection, getDocs, query, limit, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface SearchResult {
  id:       string;
  type:     'client' | 'driver' | 'booking';
  label:    string;
  sublabel: string;
  path:     string;
}

// Simple client-side search over a small data set.
// For large datasets swap this with a dedicated search index (e.g. Algolia).
async function fetchAll(): Promise<SearchResult[]> {
  const [clientsSnap, driversSnap] = await Promise.all([
    getDocs(query(collection(db, 'clients'),  orderBy('name'),  limit(500))),
    getDocs(query(collection(db, 'drivers'),  orderBy('name'),  limit(500))),
  ]);

  const results: SearchResult[] = [
    ...clientsSnap.docs.map(d => ({
      id:       d.id,
      type:     'client' as const,
      label:    d.data().name ?? '—',
      sublabel: d.data().email ?? '',
      path:     `/admin/clients`,
    })),
    ...driversSnap.docs.map(d => ({
      id:       d.id,
      type:     'driver' as const,
      label:    d.data().name ?? '—',
      sublabel: d.data().phone ?? '',
      path:     `/admin/drivers`,
    })),
  ];
  return results;
}

let cachedResults: SearchResult[] | null = null;

const GlobalSearch: React.FC = () => {
  const navigate = useNavigate();
  const [open,    setOpen]    = useState(false);
  const [term,    setTerm]    = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      if (!cachedResults) {
        setLoading(true);
        fetchAll().then(r => { cachedResults = r; setLoading(false); });
      }
    }
  }, [open]);

  // Click outside closes panel
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!term.trim() || !cachedResults) { setResults([]); return; }
    const q = term.toLowerCase();
    setResults(
      cachedResults
        .filter(r => r.label.toLowerCase().includes(q) || r.sublabel.toLowerCase().includes(q))
        .slice(0, 10),
    );
  }, [term]);

  const handleSelect = (r: SearchResult) => {
    navigate(r.path);
    setOpen(false);
    setTerm('');
  };

  const TYPE_COLORS: Record<SearchResult['type'], string> = {
    client:  'bg-indigo-100 text-indigo-700',
    driver:  'bg-teal-100   text-teal-700',
    booking: 'bg-amber-100  text-amber-700',
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-slate-400 bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 text-sm transition-colors"
        aria-label="Global search (Ctrl+K)"
      >
        <Search size={14} />
        <span>Search…</span>
        <kbd className="hidden sm:block text-[10px] bg-white border border-slate-200 rounded px-1">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-24 px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div ref={panelRef} className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
              <Search size={16} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={term}
                onChange={e => setTerm(e.target.value)}
                placeholder="Search clients, drivers…"
                className="flex-1 text-sm focus:outline-none text-slate-800 placeholder-slate-400"
              />
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {loading && (
                <div className="text-center py-8 text-slate-400 text-sm">Loading…</div>
              )}
              {!loading && term && results.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-sm">No results for "{term}"</div>
              )}
              {!loading && !term && (
                <div className="text-center py-8 text-slate-400 text-sm">Type to search…</div>
              )}
              {results.map(r => (
                <button
                  key={`${r.type}_${r.id}`}
                  onClick={() => handleSelect(r)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors"
                >
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${TYPE_COLORS[r.type]}`}>
                    {r.type}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-slate-800">{r.label}</div>
                    {r.sublabel && <div className="text-xs text-slate-500">{r.sublabel}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GlobalSearch;
