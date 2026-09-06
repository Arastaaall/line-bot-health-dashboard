export default function NutrientBar({ name, pctDisplay, unit, avg, refValue }: {
  name: string; pctDisplay: number; unit: string; avg: number; refValue: number | null;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] text-gray-600">
        <span>{name}</span>
        <span>{avg}{unit} / 基準{refValue != null ? refValue + unit : '--'}（{pctDisplay}%）</span>
      </div>
      <div className="bg-gray-100 rounded h-2">
        <div className="bg-blue-500 h-2 rounded" style={{ width: `${Math.min(pctDisplay, 100)}%` }} />
      </div>
    </div>
  );
}