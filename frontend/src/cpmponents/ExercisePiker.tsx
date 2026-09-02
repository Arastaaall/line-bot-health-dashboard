import { useMemo, useState } from 'react';

export type PickedExercise = {
  master: any | null;
  freeName: string;
};

export default function ExercisePicker({ masters, onPick }: {
  masters: any[];
  onPick: (p: PickedExercise) => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PickedExercise | null>(null);

  const candidates = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return masters
      .filter((m) => (String(m.exercise_name) + ' ' + String(m.search_keywords || '')).indexOf(q) !== -1)
      .slice(0, 8);
  }, [query, masters]);

  const choose = (p: PickedExercise) => {
    setPicked(p);
    onPick(p);
  };

  if (picked) {
    return (
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-sm font-bold">
          {picked.master ? picked.master.exercise_name : `「${picked.freeName}」（自由追加）`}
        </span>
        <button
          onClick={() => { setPicked(null); setQuery(''); onPick({ master: null, freeName: '' }); }}
          className="text-xs text-gray-500 underline"
        >
          変更
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="種目を検索（例: ベンチ、ランニング）"
          className="flex-1 border rounded p-2 text-sm"
        />
        {query.trim() !== '' && candidates.length === 0 && (
          <button
            onClick={() => choose({ master: null, freeName: query.trim() })}
            className="shrink-0 px-2 py-1 rounded bg-blue-600 text-white text-xs"
          >
            「{query.trim()}」として追加
          </button>
        )}
      </div>

      {query.trim() === '' ? (
        <select
          value=""
          onChange={(e) => {
            const m = masters.find((x) => x.master_id === e.target.value);
            if (m) choose({ master: m, freeName: '' });
          }}
          className="w-full border rounded p-2 text-sm"
        >
          <option value="">一覧から選ぶ</option>
          {masters.map((m) => (
            <option key={m.master_id} value={m.master_id}>{m.exercise_name}</option>
          ))}
        </select>
      ) : (
        <div className="space-y-1">
          {candidates.map((m) => (
            <button
              key={m.master_id}
              onClick={() => choose({ master: m, freeName: '' })}
              className="w-full text-left px-3 py-2 rounded bg-gray-50 hover:bg-blue-50 text-sm"
            >
              {m.exercise_name} <span className="text-xs text-gray-400">({m.exercise_type})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}