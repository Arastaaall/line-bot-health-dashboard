import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callApi } from '../../services/api';
import Loading from '../../components/Loading';

function key(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type View = 'list' | 'week' | 'month';

export default function LogHistory() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [view, setView] = useState<View>('month');
  const [listRange, setListRange] = useState<'7' | '30' | '90'>('7');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(() => {
    if (view === 'list') {
      const to = new Date();
      const from = new Date();
      from.setDate(to.getDate() - (Number(listRange) - 1));
      return { from, to };
    }
    if (view === 'week') {
      const from = new Date(anchor);
      from.setDate(from.getDate() - from.getDay());
      const to = new Date(from);
      to.setDate(to.getDate() + 6);
      return { from, to };
    }
    return {
      from: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
      to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
    };
  }, [view, listRange, anchor]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    callApi('getTrainingLogs', { from: key(period.from), to: key(period.to) })
      .then((d: any) => {
        setLogs(d.logs);
        setRestricted(!!d.range_restricted);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [period]);

  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    logs.forEach((l) => {
      const k = key(new Date(l.training_date));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    });
    return m;
  }, [logs]);

  const monthCells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const cells: { k: string; day: number; inMonth: boolean }[] = [];
    const cur = new Date(start);
    for (let i = 0; i < 42; i++) {
      cells.push({ k: key(cur), day: cur.getDate(), inMonth: cur.getMonth() === anchor.getMonth() });
      cur.setDate(cur.getDate() + 1);
    }
    return cells;
  }, [anchor]);

  const weekCells = useMemo(() => {
    const cells: { k: string; label: string }[] = [];
    const cur = new Date(period.from);
    for (let i = 0; i < 7; i++) {
      cells.push({ k: key(cur), label: `${cur.getMonth() + 1}/${cur.getDate()} ${'日月火水木金土'[cur.getDay()]}` });
      cur.setDate(cur.getDate() + 1);
    }
    return cells;
  }, [period]);

  const shift = (dir: -1 | 1) => {
    const d = new Date(anchor);
    if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
    setSelectedDay(null);
  };

  const remove = async (id: string) => {
    if (!window.confirm('この記録を削除しますか？')) return;
    setError(null);
    try {
      await callApi('deleteTrainingLog', { training_log_id: id });
      setLoading(true);
      callApi('getTrainingLogs', { from: key(period.from), to: key(period.to) })
        .then((d: any) => { setLogs(d.logs); })
        .finally(() => setLoading(false));
    } catch (e: any) { setError(e.message); }
  };

  const LogRow = ({ l }: { l: any }) => (
    <div className="p-3 flex items-center justify-between gap-2 border-b border-gray-50">
      <button onClick={() => nav(`/training/log/${l.training_log_id}`)} className="flex-1 text-left">
        <p className="text-sm font-bold text-gray-800">{l.exercise_name_snapshot}</p>
        <p className="text-xs text-gray-500">
          {l.training_type}
          {l.sets && l.sets.length > 0 ? ` / ${l.sets.length}セット` : ''}
          {l.duration_min ? ` / ${l.duration_min}分` : ''}
          {l.distance_km ? ` / ${l.distance_km}km` : ''}
        </p>
      </button>
      <p className="text-sm font-bold text-emerald-600">{l.estimated_calories} kcal</p>
      <button onClick={() => remove(l.training_log_id)} className="px-2 py-1 text-xs text-rose-600 bg-rose-50 rounded">削除</button>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">履歴</h1>
        <div className="flex gap-1">
          {(['list', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => { setView(v); setSelectedDay(null); }}
              className={'px-3 py-1.5 rounded-full text-xs ' + (view === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}
            >
              {v === 'list' ? 'リスト' : v === 'week' ? '週' : '月'}
            </button>
          ))}
        </div>
      </div>

      {restricted && <p className="text-xs text-gray-500">無料プランは直近7日のみ閲覧できます。PROで全期間開放。</p>}
      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}

      {view !== 'list' && (
        <div className="flex items-center justify-between">
          <button onClick={() => shift(-1)} className="px-3 py-1.5 rounded bg-white text-sm">←</button>
          <p className="text-sm font-bold text-gray-700">
            {view === 'month' ? `${anchor.getFullYear()}年${anchor.getMonth() + 1}月` : `${weekCells[0].label} 〜 ${weekCells[6].label}`}
          </p>
          <button onClick={() => shift(1)} className="px-3 py-1.5 rounded bg-white text-sm">→</button>
        </div>
      )}
      {view === 'list' && (
        <div className="flex gap-1">
          {(['7', '30', '90'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setListRange(r)}
              disabled={restricted && r !== '7'}
              className={'px-3 py-1.5 rounded-full text-xs ' + (listRange === r ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 disabled:opacity-40')}
            >
              {r}日
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <Loading />
      ) : view === 'month' ? (
        <>
          <div className="bg-white rounded-xl shadow-sm p-2">
            <div className="grid grid-cols-7 text-center text-[10px] text-gray-400 mb-1">
              {'日月火水木金土'.split('').map((w) => <span key={w}>{w}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthCells.map((c) => {
                const dayLogs = byDay.get(c.k) || [];
                const total = dayLogs.reduce((s, l) => s + (Number(l.estimated_calories) || 0), 0);
                return (
                  <button
                    key={c.k}
                    onClick={() => setSelectedDay(selectedDay === c.k ? null : c.k)}
                    className={'h-14 rounded-lg border text-left p-1 ' + (selectedDay === c.k ? 'border-blue-400 bg-blue-50' : 'border-gray-100') + (c.inMonth ? '' : ' opacity-40')}
                  >
                    <p className="text-[10px] text-gray-500">{c.day}</p>
                    {dayLogs.length > 0 && (
                      <>
                        <p className="text-[10px] font-bold text-emerald-600">{total}</p>
                        <p className="text-[9px] text-gray-400">{dayLogs.length}件</p>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {selectedDay && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <p className="px-3 py-2 text-xs font-bold text-gray-600 bg-gray-50">{selectedDay} の記録</p>
              {(byDay.get(selectedDay) || []).map((l) => <LogRow key={l.training_log_id} l={l} />)}
              {(byDay.get(selectedDay) || []).length === 0 && <p className="p-4 text-sm text-gray-500">記録はありません</p>}
            </div>
          )}
        </>
      ) : view === 'week' ? (
        <div className="grid grid-cols-7 gap-1">
          {weekCells.map((c) => {
            const dayLogs = byDay.get(c.k) || [];
            return (
              <div key={c.k} className="bg-white rounded-xl shadow-sm p-1 min-h-32">
                <p className="text-[10px] text-gray-500 text-center mb-1">{c.label}</p>
                <div className="space-y-1">
                  {dayLogs.map((l) => (
                    <button
                      key={l.training_log_id}
                      onClick={() => nav(`/training/log/${l.training_log_id}`)}
                      className="w-full text-left bg-blue-50 rounded p-1"
                    >
                      <p className="text-[9px] font-bold text-gray-700 truncate">{l.exercise_name_snapshot}</p>
                      <p className="text-[9px] text-emerald-600">{l.estimated_calories}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {logs.length === 0 && <p className="p-4 text-sm text-gray-500">期間中に記録がありません。</p>}
          {logs.map((l) => <LogRow key={l.training_log_id} l={l} />)}
        </div>
      )}
    </div>
  );
}