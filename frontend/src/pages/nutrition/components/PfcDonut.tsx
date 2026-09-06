export default function PfcDonut({ p, f, c }: { p: number; f: number; c: number }) {
  const total = p + f + c;
  if (total <= 0) return null;
  const segs = [
    { v: p, color: '#2563eb', label: 'P' },
    { v: f, color: '#f59e0b', label: 'F' },
    { v: c, color: '#10b981', label: 'C' },
  ];
  const R = 40;
  const CIRC = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" className="w-24 h-24">
        {segs.map((s, i) => {
          const frac = s.v / total;
          const dash = frac * CIRC;
          const off = -acc * CIRC;
          acc += frac;
          return (
            <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={s.color} strokeWidth="16"
              strokeDasharray={`${dash} ${CIRC - dash}`} strokeDashoffset={off} transform="rotate(-90 50 50)" />
          );
        })}
      </svg>
      <div className="space-y-1 text-[10px] text-gray-600">
        {segs.map((s) => (
          <p key={s.label}>
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: s.color }} />
            {s.label} {Math.round((s.v / total) * 1000) / 10}%
          </p>
        ))}
      </div>
    </div>
  );
}