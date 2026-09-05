// 手製SVGグラフ（依存ライブラリ追加禁止方針）

function EmptyNote() {
  return <p className="text-xs text-gray-400 py-6 text-center">期間中に記録がありません</p>;
}

export function LineChart({ points, height = 120, unit = '' }: {
  points: { date: string; value: number | null }[];
  height?: number;
  unit?: string;
}) {
  const valid = points.filter((p) => p.value !== null && p.value !== undefined);
  if (valid.length === 0) return <EmptyNote />;

  const w = 320;
  const pad = 8;
  const vals = valid.map((p) => p.value as number);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(points.length - 1, 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const segments: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null || p.value === undefined) {
      if (cur.length) segments.push(cur.join(' '));
      cur = [];
    } else {
      cur.push(`${x(i)},${y(p.value)}`);
    }
  });
  if (cur.length) segments.push(cur.join(' '));

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
        {segments.map((s, i) => (
          <polyline key={i} points={s} fill="none" stroke="#2563eb" strokeWidth="2" />
        ))}
        {points.map((p, i) =>
          p.value !== null && p.value !== undefined ? (
            <circle key={i} cx={x(i)} cy={y(p.value)} r="2.5" fill="#2563eb" />
          ) : null
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

export function BarChart({ points, height = 120, unit = '' }: {
  points: { date: string; value: number }[];
  height?: number;
  unit?: string;
}) {
  if (points.length === 0) return <EmptyNote />;
  const max = Math.max(...points.map((p) => p.value), 1);
  const w = 320;
  const pad = 4;
  const step = (w - pad * 2) / points.length;
  const bw = Math.max(step - 2, 1);

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
        {points.map((p, i) => {
          const h = (p.value / max) * (height - pad * 2);
          return (
            <rect
              key={i}
              x={pad + i * step}
              y={height - pad - h}
              width={bw}
              height={h}
              fill={p.value > 0 ? '#10b981' : '#e5e7eb'}
              rx="1"
            />
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>0</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}