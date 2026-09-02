import { useMemo, useState } from 'react';
import Combobox from './Combobox';

export default function NamePicker({ candidates, onPick, placeholder }: {
  candidates: string[];
  onPick: (name: string) => void;
  placeholder?: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  const items = useMemo(() => candidates.map((c) => ({ value: c, label: c })), [candidates]);

  if (picked) {
    return (
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-sm font-bold">{picked}</span>
        <button
          onClick={() => { setPicked(null); onPick(''); }}
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
      placeholder={placeholder || '検索または新規入力'}
      onSelect={(it) => { setPicked(it.label); onPick(it.label); }}
      onCreate={(name) => { setPicked(name); onPick(name); }}
    />
  );
}