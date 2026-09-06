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

function Block({ b, title, note, children }: any) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
      <p className="text-sm font-bold text-gray-600">{title}</p>
      {b?.status === 'ready' ? (
        <>
          {children(b.data)}
          {note && <p className="text-[10px] text-gray-400">{note}</p>}
        </>
      ) : b?.status === 'hidden' ? (
        <p className="text-[10px] text-gray-400">{b?.message}</p>
      ) : (
        <p className="text-xs text-gray-400 py-2">{b?.message || 'まだデータが足りません'}</p>
      )}
    </div>
  );
}

function Scatter({ points }: any) {
  if (!points || points.length < 2) return null;
  const xs = points.map((p: any) => p.x);
  const ys = points.map((p: any) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = 320, h = 140, pad = 12;
  const X = (v: number) => pad + ((v - minX) / (maxX - minX || 1)) * (w - pad * 2);
  const Y = (v: number) => pad + (1 - (v - minY) / (maxY - minY || 1)) * (h - pad * 2);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        {points.map((p: any, i: number) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r="3" fill="#8b5cf6" />)}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>体脂肪 {minX}%</span><span>{maxX}%</span>
      </div>
    </div>
  );
}

function Trajectory({ options }: { options: any[] }) {
  const [key, setKey] = useState<any>(options[0] || null);
  const [tr, setTr] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (!key) return;
    const ck = key.master_id || key.name;
    if (cacheRef.current[ck]) { setTr(cacheRef.current[ck]); return; }
    setTr(null);
    callApi('getMenuTrajectory', key.master_id ? { master_id: key.master_id } : { exercise_name_snapshot: key.name })
      .then((d: any) => { cacheRef.current[ck] = d; setTr(d); });
  }, [key]);

  useEffect(() => {
    if (tr && scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [tr]);

  if (!options.length) return <p className="text-xs text-gray-400">軌跡を表示できるstrength種目がまだありません。</p>;
  const maxSets = tr ? Math.min(Math.max(...tr.sessions.map((s: any) => s.sets.length), 0), 6) : 0;

  return (
    <div className="space-y-2">
      <select
        value={key?.name}
        onChange={(e) => setKey(options.find((o) => o.name === e.target.value))}
        className="w-full border rounded p-2 text-sm"
      >
        {options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
      </select>
      {tr?.header && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><p className="text-[10px] text-gray-400">PR</p><p className="text-sm font-bold">{tr.header.pr_weight}kg{tr.header.is_new_pr_in_range ? ' 🎉' : ''}</p></div>
          <div><p className="text-[10px] text-gray-400">全期間伸び率</p><p className="text-sm font-bold">{tr.header.growth_percent != null ? `${tr.header.growth_percent > 0 ? '+' : ''}${tr.header.growth_percent}%` : '--'}</p></div>
          <div><p className="text-[10px] text-gray-400">PR日</p><p className="text-sm font-bold">{tr.header.pr_date || '--'}</p></div>
        </div>
      )}
      {tr && tr.sessions.length > 0 && (
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="text-[11px] whitespace-nowrap w-full">
            <thead>
              <tr>
                <th className="p-1 text-left text-gray-400">セット</th>
                {tr.sessions.map((s: any) => <th key={s.date} className="p-1 text-gray-600">{s.date.slice(5)}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxSets }, (_, i) => (
                <tr key={i}>
                  <td className="p-1 text-gray-400">set{i + 1}</td>
                  {tr.sessions.map((s: any) => {
                    const st = s.sets.find((x: any) => x.set_no === i + 1);
                    return (
                      <td key={s.date} className={'p-1 text-center ' + (st?.weight_up ? 'bg-emerald-50 text-emerald-700 font-bold' : 'text-gray-700')}>
                        {st ? (st.weight_up ? '↑' : '') + st.display : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tr?.header?.epley_series?.length >= 2 && (
        <div>
          <p className="text-[10px] text-gray-400 mb-1">推定1RM推移（reps≤12のみ）</p>
          <LineChart height={90} points={tr.header.epley_series.map((p: any) => ({ date: p.date, value: p.value }))} />
        </div>
      )}
    </div>
  );
}

export default function Growth() {
  const [tab, setTab] = useState<'overview' | 'body' | 'training' | 'meal'>('overview');
  const [range, setRange] = useState('7d');
  const [data, setData] = useState<any>(null);
  const [trA, setTrA] = useState<any>(null);
  const [mealA, setMealA] = useState<any>(null);
  const [bodyA, setBodyA] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (cacheRef.current[range]) {
      const c = cacheRef.current[range];
      setData(c.s); setTrA(c.t); setMealA(c.m); setBodyA(c.b);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      callApi('getGrowthSummary', { range }),
      callApi('getTrainingAnalysis', { range }),
      callApi('getMealAnalysis', { range }),
      callApi('getBodyAnalysis', { range }),
    ])
      .then(([s, t, m, b]: any[]) => {
        cacheRef.current[range] = { s, t, m, b };
        setData(s); setTrA(t); setMealA(m); setBodyA(b);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  const isFree = data?.plan_limits?.range_days === 7;
  const weekly = range === '1y' || range === 'all';
  const n = data?.notes || {};
  const mn = mealA?.notes || {};
  const bn = bodyA?.notes || {};
  const B = trA?.blocks || {};
  const M = mealA?.blocks || {};
  const BB = bodyA?.blocks || {};

  const weightPoints = (data?.weight_series || []).map((p: any) => ({ date: p.date, value: p.weight_kg }));
  const strengthOptions = (data?.exercise_stats || [])
    .filter((e: any) => e.training_type !== 'cardio')
    .map((e: any) => ({ name: e.name, master_id: e.master_id }));

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

      {loading ? <Loading /> : !data ? null : tab === 'overview' ? (
        <div className="space-y-4">
          <Block b={B.O1} title={`今月のレキャップ（${B.O1?.data?.month || ''}・途中経過）`}>
            {(d: any) => (
              <div className="grid grid-cols-4 gap-2 text-center">
                <div><p className="text-[10px] text-gray-400">トレ日数</p><p className="text-sm font-bold">{d.training_days}日</p></div>
                <div><p className="text-[10px] text-gray-400">ボリューム</p><p className="text-sm font-bold">{d.volume_kg}kg{d.elephant ? ` 🐘${d.elephant}頭分` : ''}</p></div>
                <div><p className="text-[10px] text-gray-400">体重変化</p><p className="text-sm font-bold">{d.weight_change != null ? `${d.weight_change > 0 ? '+' : ''}${d.weight_change}kg` : '--'}</p></div>
                <div><p className="text-[10px] text-gray-400">平均摂取</p><p className="text-sm font-bold">{d.avg_intake != null ? `${d.avg_intake}` : '--'}</p></div>
              </div>
            )}
          </Block>
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">体重</p>
            <LineChart height={90} points={weightPoints} />
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">トレーニング（ボリューム）</p>
            <BarChart height={90} points={(data.training_daily || []).map((p: any) => ({ date: p.date, value: p.volume_kg }))} />
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">食事（摂取カロリー）</p>
            <BarChart height={90} points={(data.intake_daily || []).map((p: any) => ({ date: p.date, value: p.intake_kcal }))} />
          </div>
          {n.intake && <p className="text-[10px] text-gray-400">{n.intake}</p>}
          {n.exercise && <p className="text-[10px] text-gray-400">＊ {n.exercise}</p>}
        </div>
      ) : tab === 'body' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">体重推移 (kg)</p>
            <LineChart points={weightPoints} />
          </div>
          <Block b={BB.B0a} title="週あたり体重変化">
            {(d: any) => <p className="text-lg font-bold">{d.weekly_change > 0 ? '+' : ''}{d.weekly_change} kg/週</p>}
          </Block>
          <Block b={BB.B3} title="4週間後予測" note={bn.prediction}>
            {(d: any) => (
              <p className="text-lg font-bold">約{d.predicted_weight}kg <span className="text-xs text-gray-500">（現在ペース {d.pace_per_week > 0 ? '+' : ''}{d.pace_per_week}kg/週）</span></p>
            )}
          </Block>
          <Block b={BB.B1} title="BMIバンド" note={bn.bmi}>
            {(d: any[]) => (
              <div className="flex flex-wrap gap-1">
                {d.map((p, i) => (
                  <span key={i} className={'px-2 py-1 rounded text-[10px] font-bold ' + (p.band === '普通体重' ? 'bg-emerald-50 text-emerald-700' : p.band === '低体重' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700')}>
                    {p.date.slice(5)} {p.bmi} {p.band}
                  </span>
                ))}
              </div>
            )}
          </Block>
          <Block b={BB.B4} title="月平均体重">
            {(d: any) => (
              <p className="text-lg font-bold">
                {d.current_avg != null ? `${d.current_avg}kg` : '--'}
                {d.delta != null && <span className="text-xs text-gray-500">（先月比 {d.delta > 0 ? '+' : ''}{d.delta}kg{d.in_progress ? '・今月は途中' : ''}）</span>}
              </p>
            )}
          </Block>
          <Block b={BB.B0b} title="筋肉×体脂肪スカッター">
            {(d: any[]) => <Scatter points={d.map((p: any) => ({ x: p.body_fat_pct, y: p.skeletal_muscle_kg }))} />}
          </Block>
          <Block b={BB.B6} title="筋肉量/体脂肪量比（参考）" note={bn.ratio}>
            {(d: any) => (
              <>
                <LineChart height={90} points={d.series.map((p: any) => ({ date: p.date, value: p.value }))} />
                <p className="text-xs text-gray-600">期間差分: {d.delta > 0 ? '+' : ''}{d.delta}</p>
              </>
            )}
          </Block>
          <Block b={BB.B7} title="基礎ラインを下回った食事" note={bn.bmr}>
            {(d: any) => <p className="text-lg font-bold">{d.below_days === 0 ? '✅ 0日' : `${d.below_days}日`}</p>}
          </Block>
          <Block b={BB.B9} title="体重×ランニングペース">
            {(d: any) => (
              <div className="space-y-3">
                <LineChart height={80} points={d.weight_series.map((p: any) => ({ date: p.date, value: p.weight_kg }))} />
                {d.pace_series.length >= 3 ? (
                  <LineChart height={80} points={d.pace_series.map((p: any) => ({ date: p.date, value: p.pace }))} />
                ) : (
                  <p className="text-[10px] text-gray-400">ペース表示はまだデータが足りません</p>
                )}
              </div>
            )}
          </Block>
          {(data.bodycomp_series || []).length > 0 && (
            <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
              <p className="text-sm font-bold text-gray-600">体組成トレンド（PRO）</p>
              <LineChart height={80} points={data.bodycomp_series.map((p: any) => ({ date: p.date, value: p.body_fat_pct }))} />
              <LineChart height={80} points={data.bodycomp_series.map((p: any) => ({ date: p.date, value: p.skeletal_muscle_kg }))} />
            </div>
          )}
          {n.bodycomp && <p className="text-[10px] text-gray-400">{n.bodycomp}</p>}
        </div>
      ) : tab === 'training' ? (
        <div className="space-y-4">
          <Block b={B.T1} title="部位別ボリューム">
            {(d: any[]) => {
              const max = Math.max(...d.map((x) => x.volume_kg), 1);
              return (
                <div className="space-y-1">
                  {d.map((x) => (
                    <div key={x.body_part} className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-[10px] text-gray-500">{x.body_part}</span>
                      <div className="flex-1 bg-gray-100 rounded h-3">
                        <div className="bg-blue-500 h-3 rounded" style={{ width: `${(x.volume_kg / max) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-600">{x.volume_kg}kg / {x.exercise_logs}回</span>
                    </div>
                  ))}
                </div>
              );
            }}
          </Block>
          <Block b={B.T2} title="距離別（有酸素）">
            {(d: any[]) => (
              <div className="space-y-3">
                {d.map((t) => (
                  <div key={t.type} className="space-y-1">
                    <p className="text-xs font-bold text-gray-700">{t.type}：{t.distance_km}km / {t.count}回 / 平均ペース{t.avg_pace != null ? `${t.avg_pace}分/km` : '--'}</p>
                    <div className="space-y-0.5">
                      {t.recent.map((r: any, i: number) => (
                        <p key={i} className="text-[10px] text-gray-500">{r.date}｜{r.distance_km != null ? `${r.distance_km}km` : '--'}｜{r.duration_min}分｜{r.pace != null ? `${r.pace}分/km` : '--'}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Block>
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">種目軌跡</p>
            {strengthOptions.length > 0 && <Trajectory options={strengthOptions} />}
          </div>
          <Block b={B.T4} title="PR（最もよく記録している種目）">
            {(d: any) => <p className="text-lg font-bold">{d.name} {d.pr_weight}kg <span className="text-xs text-gray-500">{d.pr_date}{d.is_new_pr_in_range ? ' 🎉PR更新' : ''}</span></p>}
          </Block>
          <Block b={B.T5} title="全期間伸び率">
            {(d: any) => <p className="text-lg font-bold">{d.name}：{d.initial_weight}kg → {d.pr_weight}kg（{d.growth_percent > 0 ? '+' : ''}{d.growth_percent}%）</p>}
          </Block>
          <Block b={B.T6} title="推定1RM推移" note="reps≤12のセットのみ推定対象">
            {(d: any) => <LineChart height={90} points={d.series.map((p: any) => ({ date: p.date, value: p.value }))} />}
          </Block>
          <Block b={B.T7} title="体重×週次ボリューム">
            {(d: any) => (
              <div className="space-y-3">
                <LineChart height={80} points={d.weight_series.map((p: any) => ({ date: p.date, value: p.weight_kg }))} />
                <BarChart height={80} points={d.volume_series.map((p: any) => ({ date: p.date, value: p.volume_kg }))} />
                <p className="text-[10px] text-gray-500">前週比: {d.volume_series.map((w: any) => w.wow_percent != null ? `${w.date.slice(5)}:${w.wow_percent > 0 ? '+' : ''}${w.wow_percent}%` : null).filter(Boolean).join(' / ') || '--'}</p>
              </div>
            )}
          </Block>
          <Block b={B.T8} title="有酸素時間+推定消費">
            {(d: any[]) => (
              <div className="space-y-0.5">
                {d.map((x) => <p key={x.date} className="text-[11px] text-gray-600">{x.date}｜{x.duration_min}分｜{x.estimated_kcal} kcal</p>)}
              </div>
            )}
          </Block>
          <Block b={B.T9} title="トレーニング密度" note="トレーニング時間を記録した種目のみで算出した参考値です">
            {(d: any) => <p className="text-lg font-bold">{d.density_kg_per_min} kg/min <span className="text-xs text-gray-500">最高日 {d.best_day.date}（{d.best_day.rate}）</span></p>}
          </Block>
          <div className="grid grid-cols-2 gap-2">
            <Block b={B.T10} title="累計ボリューム">
              {(d: any) => <p className="text-sm font-bold">{d.total_t}t {d.achieved ? `（${d.achieved}達成）` : ''}{d.next ? ` / 次: ${d.next}` : ''}</p>}
            </Block>
            <Block b={B.T11} title="累計距離">
              {(d: any) => <p className="text-sm font-bold">{d.total_km}km {d.achieved ? `（${d.achieved}達成）` : ''}{d.next ? ` / 次: ${d.next}` : ''}</p>}
            </Block>
          </div>
          <Block b={B.T12} title="週ストリーク">
            {(d: any) => <p className="text-lg font-bold">現在 {d.current_weeks}週連続 <span className="text-xs text-gray-500">最長 {d.longest_weeks}週</span></p>}
          </Block>
          <Block b={B.T13} title="月間トレーニング日数">
            {(d: any[]) => <BarChart height={90} points={d.map((m) => ({ date: m.month, value: m.days }))} />}
          </Block>
          <Block b={B.T14} title="メモタイムライン">
            {(d: any[]) => (
              <div className="space-y-1">
                {d.map((x, i) => <p key={i} className="text-[11px] text-gray-600">{x.date}｜{x.name}｜{x.memo}</p>)}
              </div>
            )}
          </Block>
          <details className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <summary className="text-sm font-bold text-gray-600">平均RPE推移（タップで展開）</summary>
            {B.T15?.status === 'ready' ? (
              <LineChart height={90} points={B.T15.data.map((p: any) => ({ date: p.date, value: p.avg_rpe }))} />
            ) : (
              <p className="text-xs text-gray-400">{B.T15?.message || 'まだデータが足りません'}</p>
            )}
          </details>
          <details className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <summary className="text-sm font-bold text-gray-600">RPE乖離ヒント（タップで展開）</summary>
            {B.T16?.status === 'ready' ? (
              <div className="space-y-1">
                {B.T16.data.map((x: any, i: number) => (
                  <p key={i} className="text-[11px] text-gray-600">{x.date}｜{x.name} {x.weight}kg｜前回RPE{x.prev_rpe}→今回{x.curr_rpe}（+{x.delta}）</p>
                ))}
                <p className="text-[10px] text-gray-400">RPEの変化からみた参考情報です。疲労や体調を医学的に判定するものではありません。</p>
              </div>
            ) : (
              <p className="text-xs text-gray-400">{B.T16?.message || 'まだデータが足りません'}</p>
            )}
          </details>
          <details className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <summary className="text-sm font-bold text-gray-600">相対筋力（タップで展開）</summary>
            {B.T17?.status === 'ready' ? (
              <LineChart height={90} points={B.T17.data.series.map((p: any) => ({ date: p.date, value: p.value }))} />
            ) : (
              <p className="text-xs text-gray-400">{B.T17?.message || 'まだデータが足りません'}</p>
            )}
          </details>
          {n.volume && <p className="text-[10px] text-gray-400">{n.volume}</p>}
          {n.bodyweight && <p className="text-[10px] text-gray-400">{n.bodyweight}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <Block b={M.M0} title="トレーニング日vs休息日の摂取">
            {(d: any) => (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-blue-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">トレ日（{d.training_days.days}日）</p><p className="text-sm font-bold">{d.training_days.avg_kcal} kcal / P{d.training_days.avg_protein}g</p></div>
                <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">休息日（{d.rest_days.days}日）</p><p className="text-sm font-bold">{d.rest_days.avg_kcal} kcal / P{d.rest_days.avg_protein}g</p></div>
              </div>
            )}
          </Block>
          <Block b={M.M3} title="食事の時間帯分布" note={mn.meal_time}>
            {(d: any) => (
              <div className="space-y-1">
                <div className="flex h-4 rounded overflow-hidden">
                  {(['morning', 'noon', 'evening', 'night'] as const).map((k) => {
                    const total = d.morning + d.noon + d.evening + d.night || 1;
                    const colors: any = { morning: 'bg-amber-300', noon: 'bg-emerald-300', evening: 'bg-blue-300', night: 'bg-purple-400' };
                    return <div key={k} className={colors[k]} style={{ width: `${(d[k] / total) * 100}%` }} />;
                  })}
                </div>
                <p className="text-[10px] text-gray-500">朝{d.morning} / 昼{d.noon} / 夕{d.evening} / <span className="font-bold text-purple-700">夜間{d.night}回</span></p>
              </div>
            )}
          </Block>
          <Block b={M.M4} title="摂取の安定度" note={mn.stability}>
            {(d: any) => <p className="text-lg font-bold">±{d.sd_kcal} kcal <span className="text-xs text-gray-500">{d.label}</span></p>}
          </Block>
          <Block b={M.M6} title="タンパク g/kg 推移" note={`${mn.protein_approx} 目安: 1.6-2.2 g/kg`}>
            {(d: any[]) => <LineChart height={90} points={d.map((p) => ({ date: p.date, value: p.value }))} />}
          </Block>
          <Block b={M.M7} title="タンパク20g以上の食事">
            {(d: any) => (
              <div className="space-y-1">
                <p className="text-lg font-bold">1日平均 {d.avg_per_day}食</p>
                <details><summary className="text-[10px] text-blue-600">最近の記録（タップで展開）</summary>
                  <div className="space-y-0.5 mt-1">
                    {d.recent.map((r: any, i: number) => <p key={i} className="text-[10px] text-gray-500">{r.date}｜{r.menu_name}｜P{r.protein}g</p>)}
                  </div>
                </details>
              </div>
            )}
          </Block>
          <Block b={M.M10} title="長距離日（10km以上）の摂取">
            {(d: any) => (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-blue-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">10km↑の日（{d.long_days.days}日）</p><p className="text-sm font-bold">{d.long_days.avg_kcal} kcal</p></div>
                <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">その他（{d.other_days.days}日）</p><p className="text-sm font-bold">{d.other_days.avg_kcal} kcal</p></div>
              </div>
            )}
          </Block>
          <Block b={M.M12} title="タンパク達成日数" note={mn.protein_ref}>
            {(d: any) => <p className="text-lg font-bold">{d.achieved_days}日達成 <span className="text-xs text-gray-500">（対象{d.valid_days}日）</span></p>}
          </Block>
          <Block b={M.M13} title="記録日数（記録状況）">
            {(d: any) => (
              <p className="text-sm font-bold">
                食事 {d.meal_days}{d.period_days ? `/${d.period_days}` : ''}日／トレ {d.training_days}{d.period_days ? `/${d.period_days}` : ''}日／体重 {d.weight_days}{d.period_days ? `/${d.period_days}` : ''}日
              </p>
            )}
          </Block>
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