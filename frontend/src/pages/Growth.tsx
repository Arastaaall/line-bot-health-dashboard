import { useEffect, useRef, useState } from 'react';
import { callApi } from '../services/api';
import Loading from '../components/Loading';
import { LineChart, BarChart } from '../components/charts';

const RANGES = [
  { key: '7d', label: '7日' },
  { key: '30d', label: '30日' },
  { key: '90d', label: '90日' },
  { key: '1y', label: '1年' },
  { key: 'all', label: '全期間' },
];

export default function Growth() {
  const [tab, setTab] = useState<'body' | 'training' | 'meal'>('body');
  const [range, setRange] = useState('7d');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (cacheRef.current[range]) {
      setData(cacheRef.current[range]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    callApi('getGrowthSummary', { range })
      .then((d: any) => {
        cacheRef.current[range] = d;
        setData(d);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  const isFree = data?.plan_limits?.range_days === 7;
  const weekly = range === '1y' || range === 'all';
  const n = data?.notes || {};

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-800">成長の記録</h1>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            disabled={isFree && r.key !== '7d'}
            className={'shrink-0 px-3 py-1.5 rounded-full text-xs ' + (range === r.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 disabled:opacity-40')}
          >
            {r.label}{isFree && r.key !== '7d' ? '🔒' : ''}
          </button>
        ))}
      </div>
      {isFree && <p className="text-[10px] text-gray-400">無料プランは直近7日のみ表示。PROで全期間開放。</p>}
      {weekly && <p className="text-[10px] text-gray-400">週次集計（月曜始まり）</p>}

      <div className="flex gap-2">
        {([['body', '体重・体組成'], ['training', 'トレーニング'], ['meal', '食事']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={'px-4 py-2 rounded-full text-sm font-bold ' + (tab === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}

      {loading ? (
        <Loading />
      ) : !data ? null : tab === 'body' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">体重推移 (kg)</p>
            <LineChart points={(data.weight_series || []).map((p: any) => ({ date: p.date, value: p.weight_kg }))} />
          </div>
          {(data.bodycomp_series || []).length > 0 ? (
            <>
              <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
                <p className="text-sm font-bold text-gray-600">体脂肪率推移 (%)</p>
                <LineChart points={data.bodycomp_series.map((p: any) => ({ date: p.date, value: p.body_fat_pct }))} />
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
                <p className="text-sm font-bold text-gray-600">骨格筋量推移 (kg)</p>
                <LineChart points={data.bodycomp_series.map((p: any) => ({ date: p.date, value: p.skeletal_muscle_kg }))} />
              </div>
            </>
          ) : (
            <p className="text-[10px] text-gray-400">体組成の長期トレンド分析はPROで開放されます。</p>
          )}
          {n.bodycomp && <p className="text-[10px] text-gray-400">{n.bodycomp}</p>}
        </div>
      ) : tab === 'training' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm grid grid-cols-3 gap-2 text-center">
            <div><p className="text-xs text-gray-500">ボリューム (kg)</p><p className="text-lg font-bold">{data.training_totals.volume_kg}</p></div>
            <div><p className="text-xs text-gray-500">種目実施数</p><p className="text-lg font-bold">{data.training_totals.exercise_logs}</p></div>
            <div><p className="text-xs text-gray-500">トレーニング日数</p><p className="text-lg font-bold">{data.training_totals.active_days}</p></div>
            <div><p className="text-xs text-gray-500">有酸素 (分)</p><p className="text-lg font-bold">{data.training_totals.cardio_min}</p></div>
            <div><p className="text-xs text-gray-500">推定消費 *</p><p className="text-lg font-bold text-emerald-600">{data.training_totals.estimated_kcal}</p></div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">ボリューム推移 (kg)</p>
            <BarChart points={(data.training_daily || []).map((p: any) => ({ date: p.date, value: p.volume_kg }))} />
          </div>
          {n.volume && <p className="text-[10px] text-gray-400">{n.volume}</p>}
          {n.bodyweight && <p className="text-[10px] text-gray-400">{n.bodyweight}</p>}
          {n.exercise && <p className="text-[10px] text-gray-400">＊ {n.exercise}</p>}
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            <p className="px-4 py-2 text-sm font-bold text-gray-600">種目別</p>
            {(data.exercise_stats || []).length === 0 && <p className="p-4 text-sm text-gray-500">期間中に記録がありません。</p>}
            {(data.exercise_stats || []).map((e: any, i: number) => (
              <div key={i} className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-800">{e.name}</p>
                  <p className="text-xs text-gray-500">
                    {e.logged_count}回{e.max_weight_kg != null ? ` / 最大${e.max_weight_kg}kg` : ''} / 最終 {e.last_date}
                  </p>
                </div>
                <p className="text-sm font-bold text-blue-600">{e.volume_kg} kg</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">摂取カロリー推移 (kcal)</p>
            <BarChart points={(data.intake_daily || []).map((p: any) => ({ date: p.date, value: p.intake_kcal }))} />
          </div>
          {n.intake && <p className="text-[10px] text-gray-400">{n.intake}</p>}
        </div>
      )}
    </div>
  );
}