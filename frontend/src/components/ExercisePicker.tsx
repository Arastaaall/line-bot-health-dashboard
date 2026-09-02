import { useMemo, useState } from 'react';
import Combobox from './Combobox';
import type { ComboboxItem } from './Combobox';
import { BODY_PART_LABELS } from '../constants/bodyParts';

export type PickedExercise = {
  master: any | null;
  freeName: string;
};

export default function ExercisePicker({ masters, onPick }: {
  masters: any[];
  onPick: (p: PickedExercise) => void;
}) {
  const [picked, setPicked] = useState<PickedExercise | null>(null);

  const items: ComboboxItem[] = useMemo(() => masters.map((m) => ({
    value: String(m.master_id),
    label: String(m.exercise_name),
    group: BODY_PART_LABELS[String(m.body_part)] || 'その他',
    keywords: String(m.search_keywords || ''),
  })), [masters]);

  if (picked) {
    return (
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-sm font-bold">
          {picked.master ? picked.master.exercise_name : `「${picked.freeName}」（自由追加）`}
        </span>
        <button
          onClick={() => { setPicked(null); onPick({ master: null, freeName: '' }); }}
          className="text-xs text-gray-500 underline"
        >
          変更
        </button>
      </div>
    );
  }

  return (
    <Combobox
      items={items}
      placeholder="種目を検索（例: ベンチ、ランニング）"
      createLabel={(n) => `「${n}」を新規追加する（自由追加）`}
      onSelect={(it) => {
        const m = masters.find((x) => String(x.master_id) === it.value) || null;
        setPicked({ master: m, freeName: '' });
        onPick({ master: m, freeName: '' });
      }}
      onCreate={(name) => {
        setPicked({ master: null, freeName: name });
        onPick({ master: null, freeName: name });
      }}
    />
  );
}