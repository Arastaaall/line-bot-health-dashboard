import { useEffect, useState } from 'react';
import { callApi } from '../../services/api';

function key(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LogHistory() {
  const [logs, setLogs] = useState<any[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [range, setRange] = useState<'7' | '30' | '90'>('7');
  const [error, setError] = useState<string | null>(null);

  const load = (r: string) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (Number(r) - 1));
    callApi('getTrainingLogs', { from: key(from), to: key(to) })
      .then((d: any) => {
        setLogs(d.logs);
        setRestricted(d.range_restricted);
      })
      .catch((e: any) => setError(e.message));
  };
  useEffect(() => { load(range); }, [range]);

  const remove = async (id: string) => {
    if (!window.confirm('この記録を削除しますか？')) return;
    setError(null);
    try {
      await callApi('deleteTrainingLog', { training_log_id: id });
      load(range);
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">履歴</h1>
        <div className="flex gap-1">
          {(['7', '30', '90'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              disabled={restricted && r !== '7'}
              className={'px-3 py-1.5 rounded-full text-xs ' + (range === r ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 disabled:opacity-40')}
            >
              {r}日
            </button>
          ))}
        </div>
      </div>
      {restricted && <p className="text-xs text-gray-500">無料プランは直近7日のみ閲覧できます。PROで全期間開放。</p>}
      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {logs.length === 0 && <p className="p-4 text-sm text-gray-500">期間中に記録がありません。</p>}
        {logs.map((l: any) => (
          <div key={l.training_log_id} className="p-4 flex items-center justify-between gap-2">
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-800">{l.exercise_name_snapshot}</p>
              <p className="text-xs text-gray-500">
                {String(l.training_date).slice(0, 10)} / {l.training_type}
                {l.sets && l.sets.length > 0 ? ` / ${l.sets.length}セット` : ''}
                {l.duration_min ? ` / ${l.duration_min}分` : ''}
                {l.distance_km ? ` / ${l.distance_km}km` : ''}
              </p>
              <p className="text-[10px] text-gray-400">推定消費カロリー（参考値）</p>
            </div>
            <p className="text-sm font-bold text-emerald-600">{l.estimated_calories} kcal</p>
            <button onClick={() => remove(l.training_log_id)} className="px-2 py-1 text-xs text-rose-600 bg-rose-50 rounded">削除</button>
          </div>
        ))}
      </div>
    </div>
  );
}