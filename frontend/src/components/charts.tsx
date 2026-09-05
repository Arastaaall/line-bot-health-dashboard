// 手製SVGグラフ（依存ライブラリ追加禁止方針）
// X軸: <=8点は全日付+曜日、それ以外は5点のM/D
// Y軸: 4分割目盛り＋薄いグリッド線

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

function fmtVal(v: number) {
  const r = Math.round(v);
  return Math.abs(v - r) < 0.05 ? String(r) : v.toFixed(1);
}

function yTicks(min: number, max: number, count = 4) {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(min + ((max - min) * i) / count);
  return out;
}

function EmptyNote() {
  return <p className="text-xs text-gray-400 py-6 text-center">期間中に記録がありません</p>;
}

export function LineChart({ points, height = 120 }: {
  points: { date: string; value: number | null }[];
  height?: number;
}) {
  const valid = points.filter((p) => p.value !== null && p.value !== undefined);
  if (valid.length === 0) return <EmptyNote />;

  const w = 320;
  const padL = 30;
  const padR = 8;
  const padT = 8;
  const bottom = 16;
  const plotW = w - padL - padR;
  const plotH = height - padT - bottom;
  const vals = valid.map((p) => p.value as number);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => padL + (i * plotW) / Math.max(points.length - 1, 1);
  const y = (v: number) => padT + (1 - (v - min) / span) * plotH;

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
  const ticksX = tickIndices(points.length, withWeekday ? points.length : 5);
  const last = points.length - 1;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
      {yTicks(min, max).map((tv, i) => (
        <g key={i}>
          <line x1={padL} x2={w - padR} y1={y(tv)} y2={y(tv)} stroke="#e5e7eb" strokeWidth="0.5" />
          <text x={padL - 4} y={y(tv) + 2} fontSize="7" fill="#9ca3af" textAnchor="end">{fmtVal(tv)}</text>
        </g>
      ))}
      {segments.map((s, i) => (
        <polyline key={i} points={s} fill="none" stroke="#2563eb" strokeWidth="2" />
      ))}
      {points.map((p, i) =>
        p.value !== null && p.value !== undefined ? (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="2.5" fill="#2563eb" />
        ) : null
      )}
      {ticksX.map((i) => (
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
  );
}

export function BarChart({ points, height = 120 }: {
  points: { date: string; value: number }[];
  height?: number;
}) {
  if (points.length === 0) return <EmptyNote />;

  const max = Math.max(...points.map((p) => p.value), 1);
  const w = 320;
  const padL = 30;
  const padR = 4;
  const padT = 8;
  const bottom = 16;
  const plotW = w - padL - padR;
  const plotH = height - padT - bottom;
  const step = plotW / points.length;
  const bw = Math.max(step - 2, 1);

  const withWeekday = points.length <= 8;
  const ticksX = tickIndices(points.length, withWeekday ? points.length : 5);
  const last = points.length - 1;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
      {yTicks(0, max).map((tv, i) => (
        <g key={i}>
          <line x1={padL} x2={w - padR} y1={padT + plotH - (tv / max) * plotH} y2={padT + plotH - (tv / max) * plotH} stroke="#e5e7eb" strokeWidth="0.5" />
          <text x={padL - 4} y={padT + plotH - (tv / max) * plotH + 2} fontSize="7" fill="#9ca3af" textAnchor="end">{fmtVal(tv)}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const h = (p.value / max) * plotH;
        return (
          <rect
            key={i}
            x={padL + i * step}
            y={padT + plotH - h}
            width={bw}
            height={h}
            fill={p.value > 0 ? '#10b981' : '#e5e7eb'}
            rx="1"
          />
        );
      })}
      {ticksX.map((i) => (
        <text
          key={i}
          x={padL + i * step + bw / 2}
          y={height - 3}
          fontSize="8"
          fill="#9ca3af"
          textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
        >
          {fmtTick(points[i].date, withWeekday)}
        </text>
      ))}
    </svg>
  );
}