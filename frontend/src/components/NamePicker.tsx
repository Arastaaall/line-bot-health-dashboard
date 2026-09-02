import { useMemo, useState } from 'react';

export default function NamePicker({ candidates, onPick, placeholder }: {
  candidates: string[];
  onPick: (name: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return candidates.slice(0, 6);
    return candidates.filter((c) => c.indexOf(q) !== -1).slice(0, 6);
  }, [query, candidates]);

  const exact = query.trim() !== '' && matches.indexOf(query.trim()) !== -1;

  const choose = (n: string) => {
    setPicked(n);
    onPick(n);
  };

  if (picked) {
    return (
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-sm font-bold">{picked}</span>
        <button
          onClick={() => { setPicked(null); setQuery(''); onPick(''); }}
          className="text-xs text-gray-500 underline"
        >
          変更
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder || '検索または新規入力'}
          className="flex-1 border rounded p-2 text-sm"
        />
        {query.trim() !== '' && !exact && (
          <button
            onClick={() => choose(query.trim())}
            className="shrink-0 px-2 py-1 rounded bg-blue-600 text-white text-xs"
          >
            「{query.trim()}」として追加
          </button>
        )}
      </div>
      {matches.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {matches.map((c) => (
            <button key={c} onClick={() => choose(c)} className="px-2 py-1 rounded bg-gray-50 hover:bg-blue-50 text-xs">
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}