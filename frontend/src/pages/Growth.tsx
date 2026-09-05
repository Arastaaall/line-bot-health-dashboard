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
  const [tab, setTab] = useState<'overview' | 'body' | 'training' | 'meal'>('overview');
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
  const t = data?.training_totals || {};

  const ws: any[] = data?.weight_series || [];
  let deltaText = '--';
  if (ws.length >= 2 && ws[ws.length - 1].weight_kg != null && ws[ws.length - 2].weight_kg != null) {
    const diff = Math.round((ws[ws.length - 1].weight_kg - ws[ws.length - 2].weight_kg) * 10) / 10;
    const arrow = diff < 0 ? '↓' : diff > 0 ? '↑' : '→';
    deltaText = `${diff > 0 ? '+' : ''}${diff} kg ${arrow}`;
  }

  const weightPoints = ws.map((p: any) => ({ date: p.date, value: p.weight_kg }));
  const volumePoints = (data?.training_daily || []).map((p: any) => ({ date: p.date, value: p.volume_kg }));
  const intakePoints = (data?.intake_daily || []).map((p: any) => ({ date: p.date, value: p.intake_kcal }));
  const bfPoints = (data?.bodycomp_series || []).map((p: any) => ({ date: p.date, value: p.body_fat_pct }));
  const smPoints = (data?.bodycomp_series || []).map((p: any) => ({ date: p.date, value: p.skeletal_muscle_kg }));

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

      <div className="flex gap-2 overflow-x-auto">
        {([['overview', '総合'], ['body', '体重・体組成'], ['training', 'トレーニング'], ['meal', '食事']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={'shrink-0 px-4 py-2 rounded-full text-sm font-bold ' + (tab === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}

      {loading ? (
        <Loading />
      ) : !data ? null : tab === 'overview' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm grid grid-cols-3 gap-2 text-center">
            <div><p className="text-xs text-gray-500">最新体重</p><p className="text-lg font-bold">{data.latest_weight_kg != null ? `${data.latest_weight_kg} kg` : '--'}</p></div>
            <div><p className="text-xs text-gray-500">BMI</p><p className="text-lg font-bold">{data.bmi != null ? data.bmi : '--'}</p></div>
            <div><p className="text-xs text-gray-500">前回比</p><p className="text-lg font-bold text-blue-600">{deltaText}</p></div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">体重</p>
            <LineChart height={90} points={weightPoints} />
          </div>

          {(data.bodycomp_series || []).length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white rounded-xl p-3 shadow-sm space-y-1">
                <p className="text-xs font-bold text-gray-600">体脂肪率</p>
                <LineChart height={70} points={bfPoints} />
              </div>
              <div className="bg-white rounded-xl p-3 shadow-sm space-y-1">
                <p className="text-xs font-bold text-gray-600">骨格筋量</p>
                <LineChart height={70} points={smPoints} />
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">トレーニング（ボリューム）</p>
            <BarChart height={90} points={volumePoints} />
            <div className="grid grid-cols-4 gap-1 text-center pt-1">
              <div><p className="text-[10px] text-gray-400">実施日数</p><p className="text-sm font-bold">{t.active_days}</p></div>
              <div><p className="text-[10px] text-gray-400">種目実施数</p><p className="text-sm font-bold">{t.exercise_logs}</p></div>
              <div><p className="text-[10px] text-gray-400">有酸素(分)</p><p className="text-sm font-bold">{t.cardio_min}</p></div>
              <div><p className="text-[10px] text-gray-400">推定消費*</p><p className="text-sm font-bold text-emerald-600">{t.estimated_kcal}</p></div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">食事（摂取カロリー）</p>
            <BarChart height={90} points={intakePoints} />
          </div>

          {n.intake && <p className="text-[10px] text-gray-400">{n.intake}</p>}
          {n.exercise && <p className="text-[10px] text-gray-400">＊ {n.exercise}</p>}
        </div>
      ) : tab === 'body' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm grid grid-cols-2 gap-2 text-center">
            <div><p className="text-xs text-gray-500">最新体重</p><p className="text-lg font-bold">{data.latest_weight_kg != null ? `${data.latest_weight_kg} kg` : '--'}</p></div>
            <div><p className="text-xs text-gray-500">BMI</p><p className="text-lg font-bold">{data.bmi != null ? data.bmi : '--'}</p></div>
          </div>
          {data.latest_bodycomp && (
            <div className="bg-white rounded-xl p-4 shadow-sm space-y-1">
              <p className="text-sm font-bold text-gray-600">最新の体組成値（{data.latest_bodycomp.date}）</p>
              <div className="grid grid-cols-3 gap-1 text-center">
                {data.latest_bodycomp.body_fat_pct != null && <div><p className="text-[10px] text-gray-400">体脂肪率</p><p className="text-sm font-bold">{data.latest_bodycomp.body_fat_pct}</p></div>}
                {data.latest_bodycomp.skeletal_muscle_kg != null && <div><p className="text-[10px] text-gray-400">骨格筋量</p><p className="text-sm font-bold">{data.latest_bodycomp.skeletal_muscle_kg}</p></div>}
                {data.latest_bodycomp.muscle_mass_kg != null && <div><p className="text-[10px] text-gray-400">筋肉量</p><p className="text-sm font-bold">{data.latest_bodycomp.muscle_mass_kg}</p></div>}
                {data.latest_bodycomp.visceral_fat != null && <div><p className="text-[10px] text-gray-400">内臓脂肪</p><p className="text-sm font-bold">{data.latest_bodycomp.visceral_fat}</p></div>}
                {data.latest_bodycomp.bmr != null && <div><p className="text-[10px] text-gray-400">BMR</p><p className="text-sm font-bold">{data.latest_bodycomp.bmr}</p></div>}
                {data.latest_bodycomp.waist_cm != null && <div><p className="text-[10px] text-gray-400">腹囲</p><p className="text-sm font-bold">{data.latest_bodycomp.waist_cm}</p></div>}
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">体重推移 (kg)</p>
            <LineChart points={weightPoints} />
          </div>
          {(data.bodycomp_series || []).length > 0 ? (
            <>
              <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
                <p className="text-sm font-bold text-gray-600">体脂肪率推移 (%)</p>
                <LineChart points={bfPoints} />
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
                <p className="text-sm font-bold text-gray-600">骨格筋量推移 (kg)</p>
                <LineChart points={smPoints} />
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
            <div><p className="text-xs text-gray-500">ボリューム (kg)</p><p className="text-lg font-bold">{t.volume_kg}</p></div>
            <div><p className="text-xs text-gray-500">種目実施数</p><p className="text-lg font-bold">{t.exercise_logs}</p></div>
            <div><p className="text-xs text-gray-500">実施日数</p><p className="text-lg font-bold">{t.active_days}</p></div>
            <div><p className="text-xs text-gray-500">有酸素 (分)</p><p className="text-lg font-bold">{t.cardio_min}</p></div>
            <div><p className="text-xs text-gray-500">推定消費 *</p><p className="text-lg font-bold text-emerald-600">{t.estimated_kcal}</p></div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">ボリューム推移 (kg)</p>
            <BarChart points={volumePoints} />
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
                    {e.exercise_logs}回{e.max_weight_kg != null ? ` / 最大${e.max_weight_kg}kg` : ''} / 最終 {e.last_date}
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
            <BarChart points={intakePoints} />
          </div>
          {n.intake && <p className="text-[10px] text-gray-400">{n.intake}</p>}
        </div>
      )}
    </div>
  );
}