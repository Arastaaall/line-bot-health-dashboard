import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { callApi } from '../../services/api';
import Loading from '../../components/Loading';

const isBw = (v: any) => v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';

export default function LogDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callApi('getTrainingLogDetail', { training_log_id: id })
      .then((d: any) => setData(d))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Loading />;
  if (error) return <p className="text-rose-600 text-sm">エラー: {error}</p>;
  if (!data) return null;
  const { log, sets, history, history_restricted } = data;

  return (
    <div className="max-w-md mx-auto space-y-4">
      <button onClick={() => nav(-1)} className="text-xs text-gray-500 underline">← 戻る</button>

      <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
        <p className="text-lg font-bold text-gray-800">{log.exercise_name_snapshot}</p>
        <p className="text-xs text-gray-500">{String(log.training_date).slice(0, 10)} / {log.training_type}</p>
        <div className="grid grid-cols-2 gap-2 text-sm pt-2">
          <div><p className="text-xs text-gray-500">推定消費カロリー</p><p className="font-bold text-emerald-600">{log.estimated_calories} kcal</p></div>
          <div><p className="text-xs text-gray-500">当時体重</p><p className="font-bold">{log.body_weight} kg</p></div>
          {log.duration_min !== '' && log.duration_min != null && <div><p className="text-xs text-gray-500">時間</p><p className="font-bold">{log.duration_min}分</p></div>}
          {log.distance_km !== '' && log.distance_km != null && <div><p className="text-xs text-gray-500">距離</p><p className="font-bold">{log.distance_km} km</p></div>}
          {log.rpe !== '' && log.rpe != null && <div><p className="text-xs text-gray-500">RPE（{log.rpe_source}）</p><p className="font-bold">{log.rpe}</p></div>}
        </div>
        <p className="text-[10px] text-gray-400">推定方法: {log.calorie_estimation_method} / 式{log.calorie_formula_version} ＊参考値</p>
        {log.memo && <p className="text-xs text-gray-600 bg-gray-50 rounded p-2">{log.memo}</p>}
      </div>

      {sets && sets.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-600 mb-2">セット内容</p>
          <div className="space-y-1">
            {sets.map((s: any) => (
              <div key={s.set_id} className="flex justify-between text-sm border-b border-gray-50 py-1">
                <span className="text-gray-500">セット{s.set_no}</span>
                <span className="font-bold text-gray-800">
                  {isBw(s.is_bodyweight) ? '自重' : `${s.weight_kg ?? '-'}kg`} × {s.reps}回{s.rpe !== '' && s.rpe != null ? `（RPE${s.rpe}）` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-600 mb-2">同じ種目の過去履歴</p>
        {history_restricted && <p className="text-[10px] text-gray-400 mb-1">無料プランは直近7日のみ表示</p>}
        <div className="space-y-1">
          {history.length === 0 && <p className="text-xs text-gray-400">表示可能な期間に他の記録はありません</p>}
          {history.map((h: any) => (
            <button
              key={h.training_log_id}
              onClick={() => nav(`/training/log/${h.training_log_id}`)}
              className="w-full flex items-center justify-between gap-2 text-sm py-1.5 border-b border-gray-50"
            >
              <span className="text-gray-600">{String(h.training_date).slice(0, 10)}</span>
              <span className="text-xs text-gray-400">{h.sets_count > 0 ? `${h.sets_count}セット` : ''}{h.duration_min ? `${h.duration_min}分` : ''}</span>
              <span className="font-bold text-emerald-600">{h.estimated_calories} kcal</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}