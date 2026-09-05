// 手製SVGグラフ（依存ライブラリ追加禁止方針）
// X軸日付目盛り: <=8点は全日付+曜日（旧ダッシュボード準拠）、それ以外は5点のM/D

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function fmtTick(dateStr: string, withWeekday: boolean) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return String(dateStr).slice(5).replace('-', '/');
  const base = `${d.getMonth() + 1}/${d.getDate()}`;
  return withWeekday ? `${base}(${WEEK[d.getDay()]})` : base;
}

function tickIndices(count: number, maxTicks: number) {
  if (count <= 0) return [];
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (maxTicks - 1);
  const out: number[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const idx = Math.round(i * step);
    if (out.indexOf(idx) === -1) out.push(idx);
  }
  return out;
}

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
  const padX = 8;
  const padTop = 8;
  const bottom = 16;
  const plotH = height - padTop - bottom;
  const vals = valid.map((p) => p.value as number);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => padX + (i * (w - padX * 2)) / Math.max(points.length - 1, 1);
  const y = (v: number) => padTop + (1 - (v - min) / span) * plotH;

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

  const withWeekday = points.length <= 8;
  const ticks = tickIndices(points.length, withWeekday ? points.length : 5);
  const last = points.length - 1;

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
        {ticks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={height - 3}
            fontSize="8"
            fill="#9ca3af"
            textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
          >
            {fmtTick(points[i].date, withWeekday)}
          </text>
        ))}
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
  const padX = 4;
  const padTop = 8;
  const bottom = 16;
  const plotH = height - padTop - bottom;
  const step = (w - padX * 2) / points.length;
  const bw = Math.max(step - 2, 1);

  const withWeekday = points.length <= 8;
  const ticks = tickIndices(points.length, withWeekday ? points.length : 5);
  const last = points.length - 1;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
        {points.map((p, i) => {
          const h = (p.value / max) * plotH;
          return (
            <rect
              key={i}
              x={padX + i * step}
              y={padTop + plotH - h}
              width={bw}
              height={h}
              fill={p.value > 0 ? '#10b981' : '#e5e7eb'}
              rx="1"
            />
          );
        })}
        {ticks.map((i) => (
          <text
            key={i}
            x={padX + i * step + bw / 2}
            y={height - 3}
            fontSize="8"
            fill="#9ca3af"
            textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
          >
            {fmtTick(points[i].date, withWeekday)}
          </text>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>0</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}