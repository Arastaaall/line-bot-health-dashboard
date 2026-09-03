import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callApi } from '../../services/api';
import Loading from '../../components/Loading';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TrainingHome() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = todayKey();
    callApi('getTrainingLogs', { from: t, to: t })
      .then((d: any) => {
        setLogs(d.logs);
        setRestricted(!!d.range_restricted);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const limitReached = restricted && logs.length >= 7;

  if (loading) return <Loading />;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-800">トレーニング</h1>
          {restricted && <span className="text-xs text-gray-500">本日 {logs.length}/7件</span>}
        </div>
        {limitReached ? (
          <span className="text-xs text-gray-400">本日の上限に到達</span>
        ) : (
          <button onClick={() => nav('/training/log')} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold">＋ 記録追加</button>
        )}
      </div>

      {limitReached && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          無料プランの1日7件まで記録しました。PROなら無制限に記録でき、履歴も全期間閲覧できます。
        </div>
      )}

      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}
      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {logs.length === 0 && <p className="p-4 text-sm text-gray-500">今日はまだトレーニング記録がありません。</p>}
        {logs.map((l: any) => (
          <button
            key={l.training_log_id}
            onClick={() => nav(`/training/log/${l.training_log_id}`)}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50"
          >
            <div>
              <p className="text-sm font-bold text-gray-800">{l.exercise_name_snapshot}</p>
              <p className="text-xs text-gray-500">
                {l.training_type}
                {l.sets && l.sets.length > 0 ? ` / ${l.sets.length}セット` : ''}
                {l.duration_min ? ` / ${l.duration_min}分` : ''}
                {l.distance_km ? ` / ${l.distance_km}km` : ''}
              </p>
            </div>
            <p className="text-sm font-bold text-emerald-600">{l.estimated_calories} kcal</p>
          </button>
        ))}
      </div>
      <div className="flex gap-2 text-sm">
        <button onClick={() => nav('/training/history')} className="px-3 py-1.5 rounded bg-white text-gray-600">履歴</button>
        <button onClick={() => nav('/training/menus')} className="px-3 py-1.5 rounded bg-white text-gray-600">マイメニュー</button>
      </div>
    </div>
  );
}