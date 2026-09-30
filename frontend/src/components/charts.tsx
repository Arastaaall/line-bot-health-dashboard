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

function axisTicks(count: number) {
  const withWeekday = count <= 5;
  return { withWeekday, indices: tickIndices(count, withWeekday ? count : 5) };
}

function yTicks(min: number, max: number, count = 4) {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(min + ((max - min) * i) / count);
  return out;
}

function EmptyNote() {
  return <p className="text-xs text-gray-400 py-6 text-center">期間中に記録がありません</p>;
}

export function LineChart({ points, height = 120, color = '#2563eb' }: {
  points: { date: string; value: number | null }[];
  height?: number;
  color?: string;
}) {
  const valid = points.filter((p) => p.value !== null && p.value !== undefined);
  if (valid.length === 0) return <EmptyNote />;

  const w = 320;
  const padL = 30, padR = 8, padT = 8, bottom = 16;
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

  const { withWeekday, indices: ticksX } = axisTicks(points.length);
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
        <polyline key={i} points={s} fill="none" stroke={color} strokeWidth="2" />
      ))}
      {points.map((p, i) =>
        p.value !== null && p.value !== undefined ? (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="2.5" fill={color} />
        ) : null
      )}
      {ticksX.map((i) => (
        <text key={i} x={x(i)} y={height - 3} fontSize="8" fill="#9ca3af"
          textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}>
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
  const padL = 30, padR = 4, padT = 8, bottom = 16;
  const plotW = w - padL - padR;
  const plotH = height - padT - bottom;
  const step = plotW / points.length;
  const bw = Math.max(step - 2, 1);
  const { withWeekday, indices: ticksX } = axisTicks(points.length);
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
          <rect key={i} x={padL + i * step} y={padT + plotH - h} width={bw} height={h}
            fill={p.value > 0 ? '#10b981' : '#e5e7eb'} rx="1" />
        );
      })}
      {ticksX.map((i) => (
        <text key={i} x={padL + i * step + bw / 2} y={height - 3} fontSize="8" fill="#9ca3af"
          textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}>
          {fmtTick(points[i].date, withWeekday)}
        </text>
      ))}
    </svg>
  );
}

// 棒（摂取・左軸）＋折れ線（消費・右軸）の複合チャート
export function BarLineChart({ bars, line, height = 140 }: {
  bars: { date: string; value: number }[];
  line: { date: string; value: number }[];
  height?: number;
}) {
  if (bars.length === 0) return <EmptyNote />;
  const w = 320;
  const padL = 30, padR = 30, padT = 8, bottom = 16;
  const plotW = w - padL - padR;
  const plotH = height - padT - bottom;
  const maxB = Math.max(...bars.map((p) => p.value), 1);
  const maxL = Math.max(...line.map((p) => p.value), 1);
  const step = plotW / bars.length;
  const bw = Math.max(step - 2, 1);
  const lineByDate: Record<string, number> = {};
  line.forEach((p) => { lineByDate[p.date] = p.value; });
  const X = (i: number) => padL + i * step + bw / 2;
  const YL = (v: number) => padT + (1 - v / maxL) * plotH;
  const linePts = bars.map((b, i) => ({ i, v: lineByDate[b.date] })).filter((p) => p.v !== undefined);
  const poly = linePts.map((p) => `${X(p.i)},${YL(p.v)}`).join(' ');
  const { withWeekday, indices: ticksX } = axisTicks(bars.length);
  const last = bars.length - 1;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
        {bars.map((p, i) => {
          const h = (p.value / maxB) * plotH;
          return <rect key={i} x={padL + i * step} y={padT + plotH - h} width={bw} height={h} fill={p.value > 0 ? '#10b981' : '#e5e7eb'} rx="1" />;
        })}
        {linePts.length > 0 && (
          <>
            <polyline points={poly} fill="none" stroke="#2563eb" strokeWidth="2" />
            {linePts.map((p) => <circle key={p.i} cx={X(p.i)} cy={YL(p.v)} r="2.5" fill="#2563eb" />)}
          </>
        )}
        <text x={padL - 4} y={padT + 4} fontSize="7" fill="#10b981" textAnchor="end">{fmtVal(maxB)}</text>
        <text x={padL - 4} y={padT + plotH} fontSize="7" fill="#9ca3af" textAnchor="end">0</text>
        <text x={w - padR + 4} y={padT + 4} fontSize="7" fill="#2563eb" textAnchor="start">{fmtVal(maxL)}</text>
        <text x={w - padR + 4} y={padT + plotH} fontSize="7" fill="#9ca3af" textAnchor="start">0</text>
        {ticksX.map((i) => (
          <text key={i} x={padL + i * step + bw / 2} y={height - 3} fontSize="8" fill="#9ca3af"
            textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}>
            {fmtTick(bars[i].date, withWeekday)}
          </text>
        ))}
      </svg>
      <p className="text-[10px] text-gray-400">
        <span className="text-emerald-600">■摂取（左軸）</span>／<span className="text-blue-600">─推定消費（右軸）</span>・別軸表示・相殺されません
      </p>
    </div>
  );
}
export function MultiLineChart({ series, height = 120, unit = '' }: {
  series: { name: string; color: string; points: { date: string; value: number }[] }[];
  height?: number;
  unit?: string;
}) {
  const dates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.date)))).sort();
  const vals = series.flatMap((s) => s.points.map((p) => p.value));
  if (!dates.length || !vals.length) return <EmptyNote />;
  const w = 320, padX = 8, padTop = 8, bottom = 16;
  const plotH = height - padTop - bottom;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (d: string) => padX + (dates.indexOf(d) / Math.max(dates.length - 1, 1)) * (w - padX * 2);
  const y = (v: number) => padTop + (1 - (v - min) / span) * plotH;
  const { withWeekday, indices: ticks } = axisTicks(dates.length);
  const last = dates.length - 1;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2"
            points={s.points.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')} />
        ))}
        {ticks.map((i) => (
          <text key={i} x={x(dates[i])} y={height - 3} fontSize="8" fill="#9ca3af"
            textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}>
            {fmtTick(dates[i], withWeekday)}
          </text>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400"><span>{min}{unit}</span><span>{max}{unit}</span></div>
    </div>
  );
}

export function ComboChart({ bars, line, height = 140, barLabel = '摂取', lineLabel = '消費' }: {
  bars: { date: string; value: number }[];
  line: { date: string; value: number }[];
  height?: number;
  barLabel?: string;
  lineLabel?: string;
}) {
  if (!bars.length) return <EmptyNote />;
  const dates = bars.map((b) => b.date);
  const lineByDate: Record<string, number> = {};
  line.forEach((p) => { lineByDate[p.date] = p.value; });
  const w = 320, padX = 4, padTop = 8, bottom = 16;
  const plotH = height - padTop - bottom;
  const barMax = Math.max(...bars.map((b) => b.value), 1);
  const lineMax = Math.max(...dates.map((d) => lineByDate[d] || 0), 1);
  const step = (w - padX * 2) / dates.length;
  const bw = Math.max(step - 2, 1);
  const x = (i: number) => padX + i * step + bw / 2;
  const yLine = (v: number) => padTop + (1 - v / lineMax) * plotH;
  const { withWeekday, indices: ticks } = axisTicks(dates.length);
  const last = dates.length - 1;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
        {bars.map((b, i) => {
          const h = (b.value / barMax) * plotH;
          return <rect key={i} x={padX + i * step} y={padTop + plotH - h} width={bw} height={h} fill={b.value > 0 ? '#10b981' : '#e5e7eb'} rx="1" />;
        })}
        <polyline fill="none" stroke="#2563eb" strokeWidth="2"
          points={dates.map((d, i) => `${x(i)},${yLine(lineByDate[d] || 0)}`).join(' ')} />
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={height - 3} fontSize="8" fill="#9ca3af"
            textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}>
            {fmtTick(dates[i], withWeekday)}
          </text>
        ))}
      </svg>
      <div className="flex justify-between text-[10px]">
        <span className="text-emerald-600">■ {barLabel} max{barMax}</span>
        <span className="text-blue-600">― {lineLabel} max{lineMax}</span>
      </div>
    </div>
  );
}

export function PfcBalanceChart({ actual, ideal, height = 190 }: {
  actual: { label: string; name: string; value: number }[];
  ideal: number[];
  height?: number;
}) {
  if (!actual.length) return <EmptyNote />;
  const w = 320;
  const padL = 30, padR = 8, padT = 10, padB = 34;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;
  const maxValue = Math.max(...actual.map((item) => item.value), ...ideal, 1);
  const scaleMax = Math.ceil(maxValue * 1.1 / 10) * 10;
  const step = plotW / actual.length;
  const barW = Math.min(34, step * 0.52);
  const x = (index: number) => padL + step * index + step / 2;
  const y = (value: number) => padT + plotH - (value / scaleMax) * plotH;
  const linePoints = ideal.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const colors = ['#3B82F6', '#F97316', '#10B981'];

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="PFCバランス">
        {yTicks(0, scaleMax).map((value, index) => (
          <g key={index}>
            <line x1={padL} x2={w - padR} y1={y(value)} y2={y(value)} stroke="#e5e7eb" strokeWidth="0.6" />
            <text x={padL - 4} y={y(value) + 2} fontSize="7" fill="#9ca3af" textAnchor="end">{fmtVal(value)}</text>
          </g>
        ))}
        {actual.map((item, index) => {
          const barHeight = Math.max(0, (item.value / scaleMax) * plotH);
          return <rect key={item.label} x={x(index) - barW / 2} y={y(item.value)} width={barW} height={barHeight} fill={colors[index] ?? '#2563eb'} rx="2" />;
        })}
        <polyline points={linePoints} fill="none" stroke="#9CA3AF" strokeWidth="2" strokeDasharray="5 5" />
        {ideal.map((value, index) => <circle key={index} cx={x(index)} cy={y(value)} r="2.5" fill="#fff" stroke="#9CA3AF" strokeWidth="1.5" />)}
        {actual.map((item, index) => (
          <g key={item.label}>
            <text x={x(index)} y={height - 19} fontSize="10" fontWeight="700" fill="#4b5563" textAnchor="middle">{item.label}</text>
            <text x={x(index)} y={height - 7} fontSize="7" fill="#9ca3af" textAnchor="middle">{item.name}</text>
          </g>
        ))}
      </svg>
      <div className="flex justify-center gap-4 text-[10px] text-gray-400">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />平均 (g)</span>
        <span><span className="mr-1 inline-block w-4 border-t-2 border-dashed border-gray-400 align-middle" />目標 (g)</span>
      </div>
    </div>
  );
}

export function RadarChart({ labels, values, height = 280, max = 140 }: {
  labels: string[];
  values: number[];
  height?: number;
  max?: number;
}) {
  if (!labels.length || labels.length !== values.length) return <EmptyNote />;
  const w = 360;
  const cx = w / 2;
  const cy = height / 2 - 2;
  const radius = Math.min(100, height / 2 - 42);
  const labelRadius = radius + 20;
  const angle = (index: number) => -Math.PI / 2 + (Math.PI * 2 * index) / labels.length;
  const point = (index: number, value: number, distance = radius) => {
    const ratio = Math.max(0, Math.min(value / max, 1));
    const a = angle(index);
    return `${cx + Math.cos(a) * distance * ratio},${cy + Math.sin(a) * distance * ratio}`;
  };
  const ringPoints = (value: number) => labels.map((_, index) => point(index, value)).join(' ');
  const actualPoints = values.map((value, index) => point(index, value)).join(' ');
  const idealPoints = labels.map((_, index) => point(index, 100)).join(' ');
  const ticks = [20, 40, 60, 80, 100, 120, 140].filter((value) => value <= max);

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="栄養バランスRadar Chart">
        {ticks.map((value) => <polygon key={value} points={ringPoints(value)} fill="none" stroke="#e5e7eb" strokeWidth="0.7" />)}
        {labels.map((_, index) => {
          const a = angle(index);
          return <line key={index} x1={cx} y1={cy} x2={cx + Math.cos(a) * radius} y2={cy + Math.sin(a) * radius} stroke="#e5e7eb" strokeWidth="0.7" />;
        })}
        <polygon points={idealPoints} fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeDasharray="4 4" />
        <polygon points={actualPoints} fill="rgba(59, 130, 246, 0.2)" stroke="#3B82F6" strokeWidth="2" />
        {values.map((value, index) => {
          const [x, y] = point(index, value).split(',').map(Number);
          return <circle key={index} cx={x} cy={y} r="3" fill="#3B82F6" />;
        })}
        {labels.map((label, index) => {
          const a = angle(index);
          const x = cx + Math.cos(a) * labelRadius;
          const y = cy + Math.sin(a) * labelRadius;
          const anchor = Math.cos(a) > 0.35 ? 'start' : Math.cos(a) < -0.35 ? 'end' : 'middle';
          return <text key={label} x={x} y={y + (Math.sin(a) > 0.6 ? 4 : Math.sin(a) < -0.6 ? -2 : 3)} fontSize="10" fill="#4b5563" textAnchor={anchor}>{label}</text>;
        })}
      </svg>
      <div className="flex justify-center gap-4 text-[10px] text-gray-400">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />過去7日間の平均摂取量</span>
        <span><span className="mr-1 inline-block w-4 border-t-2 border-dashed border-gray-400 align-middle" />理想値 (目標100%)</span>
      </div>
    </div>
  );
}
