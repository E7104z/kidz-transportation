import React, { useState, useRef, useCallback } from 'react';
import { getPlacePredictions } from '../services/placeService';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

const AddressAutocomplete: React.FC<Props> = ({ value, onChange, onSelect, placeholder, className, id }) => {
  const [suggestions, setSuggestions] = useState<Array<{ description: string; place_id: string }>>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length > 2) {
      debounceRef.current = setTimeout(() => {
        getPlacePredictions(val).then((results) => {
          setSuggestions(results);
          setOpen(results.length > 0);
        });
      }, 250);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
  }, [onChange]);

  const handleSelect = useCallback((description: string) => {
    onChange(description);
    onSelect?.(description);
    setSuggestions([]);
    setOpen(false);
  }, [onChange, onSelect]);

  const handleBlur = useCallback(() => {
    // Delay so onMouseDown on suggestion fires first
    setTimeout(() => setOpen(false), 150);
  }, []);

  const handleFocus = useCallback(() => {
    if (suggestions.length > 0) setOpen(true);
  }, [suggestions.length]);

  const inputCls = className ?? 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholder={placeholder}
        autoComplete="off"
        className={inputCls}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 bg-white border border-slate-200 rounded-xl mt-1 max-h-52 overflow-auto shadow-lg">
          {suggestions.map((s, i) => (
            <li
              key={s.place_id + i}
              onMouseDown={() => handleSelect(s.description)}
              className="px-4 py-2.5 hover:bg-slate-50 cursor-pointer text-sm text-slate-700 border-b border-slate-100 last:border-0"
            >
              {s.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AddressAutocomplete;
