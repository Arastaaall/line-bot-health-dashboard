import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callApi } from '../../services/api';
import Loading from '../../components/Loading';

const isBw = (v: any) => v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';

function agoLabel(dateKey: string | null) {
  if (!dateKey) return '未実施';
  const d = new Date(dateKey + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff <= 0) return '今日';
  if (diff === 1) return '昨日';
  return `${diff}日前`;
}

export default function RoutineBoard() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callApi('getTrainingBoard')
      .then((d: any) => setGroups(d.groups))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <p className="text-rose-600 text-sm">エラー: {error}</p>;

  return (
    <div className="space-y-4">
      {groups.length === 0 && <p className="p-4 text-sm text-gray-500 bg-white rounded-xl">マイメニューがありません。</p>}
      {groups.map((g) => (
        <div key={g.group} className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-3 py-2 bg-gray-700 text-white flex justify-between items-center">
            <p className="text-xs font-bold">{g.group}</p>
            <p className="text-[10px] opacity-80">{agoLabel(g.last_date)}</p>
          </div>
          <div className="divide-y divide-gray-100">
            {g.items.map((m: any) => (
              <div key={m.menu_id} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-800">{m.menu_name}</p>
                  <button
                    onClick={() => nav(`/training/log?menu=${m.menu_id}`)}
                    className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-bold"
                  >
                    記録
                  </button>
                </div>
                {m.sessions.length === 0 && <p className="text-[10px] text-gray-400">まだ記録がありません</p>}
                <div className="grid grid-cols-2 gap-2">
                  {m.sessions.map((s: any, i: number) => (
                    <div key={s.training_log_id} className={'rounded-lg border p-2 ' + (i === 0 ? 'border-blue-200 bg-blue-50/40' : 'border-gray-100')}>
                      <p className="text-[10px] text-gray-500 mb-1">{s.date}（{i === 0 ? '前回' : '前々回'}）</p>
                      {s.sets && s.sets.length > 0 ? (
                        <div className="space-y-0.5">
                          {s.sets.map((set: any, si: number) => (
                            <p key={si} className="text-[11px] text-gray-700">
                              {isBw(set.is_bodyweight) ? '自重' : `${set.weight_kg ?? '-'}kg`} × {set.reps}
                              {set.rpe !== '' && set.rpe != null ? `（RPE${set.rpe}）` : ''}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-gray-700">
                          {s.duration_min ? `${s.duration_min}分` : ''}{s.distance_km ? ` / ${s.distance_km}km` : ''}
                          {s.rpe !== '' && s.rpe != null ? `（RPE${s.rpe}）` : ''}
                        </p>
                      )}
                      {s.memo && <p className="text-[10px] text-gray-400 mt-1">{s.memo}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}