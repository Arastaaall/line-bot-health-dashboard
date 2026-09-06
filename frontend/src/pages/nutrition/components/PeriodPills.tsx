const RANGES = [
  { key: '7d', label: '7日' },
  { key: '30d', label: '30日' },
  { key: '90d', label: '90日' },
  { key: '1y', label: '1年' },
  { key: 'all', label: '全期間' },
];

export default function PeriodPills({ range, onChange, isFree }: { range: string; onChange: (r: string) => void; isFree: boolean }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          disabled={isFree && r.key !== '7d'}
          className={'shrink-0 px-3 py-1.5 rounded-full text-xs ' + (range === r.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 disabled:opacity-40')}
        >
          {r.label}{isFree && r.key !== '7d' ? '🔒' : ''}
        </button>
      ))}
    </div>
  );
}