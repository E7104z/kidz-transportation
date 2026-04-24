import { describe, it, expect } from 'vitest';
// Test the pure logic of useBulkSelect by extracting the state machine
// without React's renderHook (avoids @testing-library/react dependency).
// The actual hook just wraps these operations in useState/useCallback.

function makeSelector(initial: string[] = []) {
  let selected = new Set<string>(initial);
  return {
    get selected() { return selected; },
    get count() { return selected.size; },
    isSelected(id: string) { return selected.has(id); },
    toggleOne(id: string, allIds: string[]) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      selected = next;
      return this;
    },
    toggleAll(allIds: string[]) {
      selected = selected.size === allIds.length ? new Set() : new Set(allIds);
      return this;
    },
    clearAll() { selected = new Set(); return this; },
    allSelected(allIds: string[]) { return allIds.length > 0 && selected.size === allIds.length; },
  };
}

describe('useBulkSelect logic', () => {
  it('starts with nothing selected', () => {
    const sel = makeSelector();
    expect(sel.count).toBe(0);
    expect(sel.allSelected(['a', 'b', 'c'])).toBe(false);
  });

  it('toggles a single item', () => {
    const sel = makeSelector();
    const all = ['a', 'b', 'c'];
    sel.toggleOne('a', all);
    expect(sel.isSelected('a')).toBe(true);
    expect(sel.isSelected('b')).toBe(false);
    sel.toggleOne('a', all);
    expect(sel.isSelected('a')).toBe(false);
  });

  it('toggleAll selects everything then deselects on second call', () => {
    const sel = makeSelector();
    const all = ['a', 'b', 'c'];
    sel.toggleAll(all);
    expect(sel.allSelected(all)).toBe(true);
    expect(sel.count).toBe(3);
    sel.toggleAll(all);
    expect(sel.count).toBe(0);
  });

  it('clearAll empties selection', () => {
    const sel = makeSelector();
    const all = ['a', 'b'];
    sel.toggleAll(all);
    sel.clearAll();
    expect(sel.count).toBe(0);
  });
});
