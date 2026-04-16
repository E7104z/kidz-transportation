import React, { useState, useRef } from 'react';
import { getPlacePredictions } from '../services/placeService';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

const AddressAutocomplete: React.FC<Props> = ({ value, onChange, placeholder, className, id }) => {
  const [suggestions, setSuggestions] = useState<Array<{ description: string; place_id: string }>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length > 2) {
      debounceRef.current = setTimeout(() => {
        getPlacePredictions(val).then(setSuggestions);
      }, 200);
    } else {
      setSuggestions([]);
    }
  };

  const handleSelect = (description: string) => {
    onChange(description);
    setSuggestions([]);
  };

  const handleBlur = () => {
    // Small delay so onMouseDown on suggestion fires first
    setTimeout(() => setSuggestions([]), 150);
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoComplete="off"
        className={className ?? 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'}
      />
      {suggestions.length > 0 && (
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
