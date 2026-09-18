const JST = 'Asia/Tokyo';

function parts(date: Date) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: JST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => values.find((part) => part.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

export function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Google Sheets serial dates use 1899-12-30 as their epoch.
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  const source = String(value ?? '').trim();
  if (!source) return new Date(Number.NaN);
  // GAS writes local JST strings without an offset. Interpret those strings in
  // JST instead of letting the Vercel UTC runtime silently shift them.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(source)) {
    const iso = source.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const slash = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const match = iso || slash;
    if (match) {
      const year = iso ? match[1] : match[3];
      const month = iso ? match[2] : match[1];
      const day = iso ? match[3] : match[2];
      const hour = (iso ? match[4] : match[4]) ?? '00';
      const minute = (iso ? match[5] : match[5]) ?? '00';
      const second = (iso ? match[6] : match[6]) ?? '00';
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}+09:00`);
    }
  }
  return new Date(source);
}

export function dateKeyOf(value: unknown): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function todayKey(): string {
  return dateKeyOf(new Date());
}

export function nowIso(): string {
  const p = parts(new Date());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export function formatFoodTimestamp(value: unknown): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}

export function addDays(date: Date, amount: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + amount);
  return copy;
}

export function parseDateOnly(value: unknown): Date {
  const s = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00+09:00`);
  return asDate(value);
}
