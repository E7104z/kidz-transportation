/**
 * useBulkSelect — generic multi-select hook for admin list pages.
 *
 * Usage:
 *   const { selected, toggleOne, toggleAll, clearAll, isSelected, allSelected } =
 *     useBulkSelect(items.map(i => i.id));
 */
import { useCallback, useState } from 'react';

interface UseBulkSelectReturn {
  selected:    Set<string>;
  toggleOne:   (id: string) => void;
  toggleAll:   () => void;
  clearAll:    () => void;
  isSelected:  (id: string) => boolean;
  allSelected: boolean;
  count:       number;
}

export function useBulkSelect(allIds: string[]): UseBulkSelectReturn {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleOne = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(prev => {
      if (prev.size === allIds.length) return new Set();
      return new Set(allIds);
    });
  }, [allIds]);

  const clearAll = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const allSelected = allIds.length > 0 && selected.size === allIds.length;

  return { selected, toggleOne, toggleAll, clearAll, isSelected, allSelected, count: selected.size };
}
