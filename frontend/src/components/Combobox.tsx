import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export type ComboboxItem = {
  value: string;
  label: string;
  group?: string;
  keywords?: string;
};

export default function Combobox({
  items,
  placeholder,
  onSelect,
  onCreate,
  createLabel,
}: {
  items: ComboboxItem[];
  placeholder?: string;
  onSelect: (item: ComboboxItem) => void;
  onCreate?: (name: string) => void;
  createLabel?: (name: string) => string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => (it.label + ' ' + (it.keywords || '')).toLowerCase().indexOf(q) !== -1);
  }, [query, items]);

  const exact = filtered.some((it) => it.label === query.trim());
  const canCreate = !!onCreate && query.trim() !== '' && !exact;
  const rowCount = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => { setHighlight(0); }, [query, open]);

  const choose = (it: ComboboxItem) => {
    setQuery('');
    setOpen(false);
    onSelect(it);
  };

  const create = () => {
    const name = query.trim();
    setQuery('');
    setOpen(false);
    if (onCreate) onCreate(name);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(rowCount - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (highlight < filtered.length) choose(filtered[highlight]);
      else if (canCreate) create();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full border rounded p-2 pr-8 text-sm"
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400"
      >
        🔽
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
          {filtered.map((it, i) => (
            <button
              key={it.value}
              type="button"
              onClick={() => choose(it)}
              onMouseEnter={() => setHighlight(i)}
              className={'w-full text-left px-3 py-2 text-sm ' + (highlight === i ? 'bg-blue-50' : '')}
            >
              {it.label}
              {it.group ? <span className="ml-2 text-[10px] text-gray-400">{it.group}</span> : null}
            </button>
          ))}
          {filtered.length === 0 && !canCreate && (
            <p className="px-3 py-2 text-xs text-gray-400">候補がありません</p>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={create}
              onMouseEnter={() => setHighlight(filtered.length)}
              className={'w-full text-left px-3 py-2 text-sm text-blue-600 border-t border-dashed border-gray-200 ' + (highlight === filtered.length ? 'bg-blue-50' : '')}
            >
              {createLabel ? createLabel(query.trim()) : `「${query.trim()}」を新規追加する`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}