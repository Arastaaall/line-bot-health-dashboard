import { useEffect, useRef, useState } from 'react';
import { callApi } from '../services/api';
import Loading from '../components/Loading';
import { LineChart, BarChart, MultiLineChart, ComboChart } from '../components/charts';

const RANGES = [
  { key: '7d', label: '7日' },
  { key: '30d', label: '30日' },
  { key: '90d', label: '90日' },
  { key: '1y', label: '1年' },
  { key: 'all', label: '全期間' },
];

const BODY_PART_JA: Record<string, string> = { chest: '胸', back: '背中', legs: '脚', leg: '脚', shoulder: '肩', shoulders: '肩', arms: '腕', arm: '腕', core: '体幹', full_body: '全身', cardio: '有酸素', other: 'その他', 未登録: '未登録' };
const CARDIO_TYPE_JA: Record<string, string> = { running: 'ランニング', walking: 'ウォーキング', cycling: 'サイクリング', other: 'その他' };
const COLORS = ['#2563eb', '#10b981', '#f59e0b'];

function Block({ b, title, note, desc, children }: any) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
      <p className="text-sm font-bold text-gray-600">{title}</p>
      {desc && <p className="text-[10px] text-gray-400 -mt-1">{desc}</p>}
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
      <div className="flex justify-between text-[10px] text-gray-400"><span>体脂肪 {minX}%</span><span>{maxX}%</span></div>
    </div>
  );
}

function OneRMChart({ data }: { data: any[] }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const visible = data.filter((s) => !hidden[s.name]);
  return (
    <div className="space-y-1">
      {visible.length > 0 && (
        <MultiLineChart height={100} series={visible.map((s) => ({ name: s.name, color: COLORS[data.indexOf(s) % 3], points: s.series }))} />
      )}
      <div className="flex gap-2 flex-wrap">
        {data.map((s, i) => (
          <button
            key={s.name}
            onClick={() => setHidden((h) => ({ ...h, [s.name]: !h[s.name] }))}
            className={'flex items-center gap-1 text-[10px] ' + (hidden[s.name] ? 'text-gray-300 line-through' : 'text-gray-600')}
          >
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLORS[i % 3] }} />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function MenuTrajectory({ menus }: { menus: any[] }) {
  const groups = Array.from(new Set(menus.map((m) => String(m.training_group || 'その他'))));
  const [group, setGroup] = useState(groups[0] || '');
  const groupMenus = menus.filter((m) => String(m.training_group || 'その他') === group);
  const [menuId, setMenuId] = useState(groupMenus[0]?.menu_id);
  const menu = groupMenus.find((m) => m.menu_id === menuId) || groupMenus[0];
  const [tr, setTr] = useState<any>(null);
  const [loadingTr, setLoadingTr] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (!menu) { setTr(null); return; }
    const ck = menu.master_id || menu.menu_name;
    if (cacheRef.current[ck]) { setTr(cacheRef.current[ck]); return; }
    setLoadingTr(true);
    callApi('getMenuTrajectory', menu.master_id ? { master_id: menu.master_id } : { exercise_name_snapshot: menu.menu_name })
      .then((d: any) => { cacheRef.current[ck] = d; setTr(d); })
      .finally(() => setLoadingTr(false));
  }, [menu?.menu_id]);

  useEffect(() => {
    if (tr && scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [tr]);

  if (!menus.length) return <p className="text-xs text-gray-400">マイメニューがまだありません。</p>;
  const maxSets = tr ? Math.min(Math.max(...tr.sessions.map((s: any) => s.sets.length), 0), 6) : 0;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            const gm = menus.filter((m) => String(m.training_group || 'その他') === e.target.value);
            setMenuId(gm[0]?.menu_id);
          }}
          className="border rounded p-2 text-sm"
        >
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={menu?.menu_id} onChange={(e) => setMenuId(e.target.value)} className="border rounded p-2 text-sm">
          {groupMenus.map((m) => <option key={m.menu_id} value={m.menu_id}>{m.menu_name}</option>)}
        </select>
      </div>
      {loadingTr && <p className="text-xs text-gray-400">読み込み中...</p>}
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
  const [menus, setMenus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, any>>({});

  useEffect(() => {
    callApi('getTrainingMenus').then((d: any) => setMenus(d.menus || [])).catch(() => {});
  }, []);

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
  const intakePoints = (data?.intake_daily || []).map((p: any) => ({ date: p.date, value: p.intake_kcal }));
  const burnLine = (data?.training_daily || []).map((p: any) => ({ date: p.date, value: p.estimated_kcal }));

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
          <Block b={B.O1} title="今月のまとめ" desc="今月のトレーニング日数・持ち上げた総重量・体重の変化・平均摂取カロリーをひとまとめにしたカードです。">
            {(d: any) => (
              <div className="grid grid-cols-4 gap-2 text-center">
                <div><p className="text-[10px] text-gray-400">トレした日数</p><p className="text-sm font-bold">{d.training_days}日</p></div>
                <div><p className="text-[10px] text-gray-400">持ち上げた総重量</p><p className="text-sm font-bold">{d.volume_kg}kg{d.elephant ? ` 🐘${d.elephant}頭分` : ''}</p></div>
                <div><p className="text-[10px] text-gray-400">体重の変化</p><p className="text-sm font-bold">{d.weight_change != null ? `${d.weight_change > 0 ? '+' : ''}${d.weight_change}kg` : '--'}</p></div>
                <div><p className="text-[10px] text-gray-400">平均摂取カロリー</p><p className="text-sm font-bold">{d.avg_intake != null ? d.avg_intake : '--'}</p></div>
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
            <p className="text-sm font-bold text-gray-600">摂取カロリー（棒）と消費カロリー（線）</p>
            <ComboChart bars={intakePoints} line={burnLine} />
            {n.intake && <p className="text-[10px] text-gray-400">{n.intake}</p>}
          </div>
          {n.exercise && <p className="text-[10px] text-gray-400">＊ {n.exercise}</p>}
        </div>
      ) : tab === 'body' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">体重推移 (kg)</p>
            <LineChart points={weightPoints} />
          </div>
          <Block b={BB.B0a} title="週あたり体重変化" desc="直近4週間の傾向から、1週間あたり何kg変化したかを計算した参考値です。">
            {(d: any) => <p className="text-lg font-bold">{d.weekly_change > 0 ? '+' : ''}{d.weekly_change} kg/週</p>}
          </Block>
          <Block b={BB.B3} title="4週間後予測" note={bn.prediction} desc="直近4週間の傾向をそのまま延長した場合の4週間後の体重の目安です。目標の達成予測ではありません。">
            {(d: any) => (
              <p className="text-lg font-bold">約{d.predicted_weight}kg <span className="text-xs text-gray-500">（現在ペース {d.pace_per_week > 0 ? '+' : ''}{d.pace_per_week}kg/週）</span></p>
            )}
          </Block>
          <Block b={BB.B1} title="BMIバンド" note={bn.bmi} desc="BMIの区分（低体重/普通体重/肥満域）を測定ごとに表示します。健康度の評価ではありません。">
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
          <Block b={BB.B4} title="月平均体重" desc="その月に測定した体重の平均です。測定が3日以上の月のみ表示されます。">
            {(d: any) => (
              <p className="text-lg font-bold">
                {d.current_avg != null ? `${d.current_avg}kg` : '--'}
                {d.delta != null && <span className="text-xs text-gray-500">（先月比 {d.delta > 0 ? '+' : ''}{d.delta}kg{d.in_progress ? '・今月は途中' : ''}）</span>}
              </p>
            )}
          </Block>
          <Block b={BB.B0b} title="筋肉×体脂肪スカッター" desc="点の位置が右上へ移れば「体脂肪が増えて筋肉も増えた」、左上へ移れば「絞れて筋肉は維持」などの読み方ができます。">
            {(d: any[]) => <Scatter points={d.map((p: any) => ({ x: p.body_fat_pct, y: p.skeletal_muscle_kg }))} />}
          </Block>
          <Block b={BB.B6} title="筋肉量/体脂肪量比（参考）" note={bn.ratio} desc="体脂肪量に対する骨格筋量の比率。上がっていけば「脂肪に対して筋肉が増えている」傾向の参考になります。">
            {(d: any) => (
              <>
                <LineChart height={90} points={d.series.map((p: any) => ({ date: p.date, value: p.value }))} />
                <p className="text-xs text-gray-600">期間差分: {d.delta > 0 ? '+' : ''}{d.delta}</p>
              </>
            )}
          </Block>
          <Block b={BB.B7} title="基礎ラインを下回った食事" note={bn.bmr} desc="安静時の消費量（BMR）よりも摂取カロリーが少なかった日数。少ない日が継続するとトレーニングが続きにくくなります。">
            {(d: any) => <p className="text-lg font-bold">{d.below_days === 0 ? '✅ 0日' : `${d.below_days}日`}</p>}
          </Block>
          <Block b={BB.B9} title="体重×ランニングペース" desc="上=体重、下=ランニング/ウォーキングのペース（分/km）。体重の変化とペースの傾向を並べて確認できます。">
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
          <Block b={B.T1} title="部位別ボリューム" desc="胸・背中・脚など部位ごとに持ち上げた総重量を表示します。偏りの確認に使ってください。">
            {(d: any[]) => {
              const max = Math.max(...d.map((x) => x.volume_kg), 1);
              return (
                <div className="space-y-1">
                  {d.map((x) => (
                    <div key={x.body_part} className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-[10px] text-gray-500">{BODY_PART_JA[x.body_part] || x.body_part}</span>
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
          <Block b={B.T2} title="距離別（有酸素）" desc="ランニング/ウォーキング/サイクリング別の合計距離・回数・平均ペースと、直近5回の記録を表示します。">
            {(d: any[]) => (
              <div className="space-y-3">
                {d.map((t) => (
                  <div key={t.type} className="space-y-1">
                    <p className="text-xs font-bold text-gray-700">{CARDIO_TYPE_JA[t.type] || t.type}：{t.distance_km}km / {t.count}回 / 平均ペース{t.avg_pace != null ? `${t.avg_pace}分/km` : '--'}</p>
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
          <details className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <summary className="text-sm font-bold text-gray-600">マイメニュー記録</summary>
            <p className="text-[10px] text-gray-400">グループと種目を選ぶと、セットごとの記録が日付順（右端が最新）に表示されます。重量が増えたセットは↑でハイライトされます。</p>
            <MenuTrajectory menus={menus} />
          </details>
          <Block b={B.T4} title="PR（最もよく記録している種目）" desc="あなたが最も多く記録している種目の最大重量（PR）です。期間内に過去の記録を更新すると🎉が付きます。">
            {(d: any) => <p className="text-lg font-bold">{d.name} {d.pr_weight}kg <span className="text-xs text-gray-500">{d.pr_date}{d.is_new_pr_in_range ? ' 🎉PR更新' : ''}</span></p>}
          </Block>
          <Block b={B.T5} title="全期間伸び率" desc="アプリに初めて記録した時の最大重量から、現在までに何%伸びたかを示します。例: 60kg→66kg=+10%。">
            {(d: any) => <p className="text-lg font-bold">{d.name}：{d.initial_weight}kg → {d.pr_weight}kg（{d.growth_percent > 0 ? '+' : ''}{d.growth_percent}%）</p>}
          </Block>
          <Block b={B.T6} title="推定1RM推移" desc="重量と回数から推定した「1回だけ挙がる目安の重量」の推移。下の色付きラベルで種目の表示切替ができます。">
            {(d: any[]) => <OneRMChart data={d} />}
          </Block>
          <Block b={B.T7} title="体重×週次ボリューム" desc="週ごとの持ち上げ総重量（棒）と体重（線）を並べたグラフ。「よく上げた週に体重が増えた」などの傾向確認用です。">
            {(d: any) => (
              <div className="space-y-3">
                <LineChart height={80} points={d.weight_series.map((p: any) => ({ date: p.date, value: p.weight_kg }))} />
                <BarChart height={80} points={d.volume_series.map((p: any) => ({ date: p.date, value: p.volume_kg }))} />
                <p className="text-[10px] text-gray-500">前週比: {d.volume_series.map((w: any) => w.wow_percent != null ? `${w.date.slice(5)}:${w.wow_percent > 0 ? '+' : ''}${w.wow_percent}%` : null).filter(Boolean).join(' / ') || '--'}</p>
              </div>
            )}
          </Block>
          <Block b={B.T8} title="消費カロリー（棒・推定・参考値）" desc="トレーニングによる推定消費カロリーを日別の棒グラフで表示します。実際の消費カロリーとは異なる場合があります。">
            {(d: any[]) => (
              <div className="space-y-2">
                <BarChart height={90} points={d.map((x) => ({ date: x.date, value: x.estimated_kcal }))} />
                <div className="space-y-0.5">
                  {d.map((x) => <p key={x.date} className="text-[10px] text-gray-500">{x.date}｜{x.duration_min}分｜{x.estimated_kcal} kcal</p>)}
                </div>
              </div>
            )}
          </Block>
          <Block b={B.T9} title="トレーニング密度" note="トレーニング時間を記録した種目のみで算出した参考値です" desc="1分あたり何kg持ち上げたか（ボリューム÷時間）。効率の傾向を見る参考値です。">
            {(d: any) => <p className="text-lg font-bold">{d.density_kg_per_min} kg/min <span className="text-xs text-gray-500">最高日 {d.best_day.date}（{d.best_day.rate}）</span></p>}
          </Block>
          <div className="grid grid-cols-2 gap-2">
            <Block b={B.T10} title="累計ボリューム" desc="これまでに持ち上げた総重量。動物の重さに換算して表示します。">
              {(d: any) => <p className="text-sm font-bold">{d.total_t}t {d.achieved ? `（${d.achieved}達成）` : ''}{d.next ? ` / 次: ${d.next}` : ''}</p>}
            </Block>
            <Block b={B.T11} title="累計距離" desc="ランニング+ウォーキングの合計距離。目印の距離を達成するごとに表示されます。">
              {(d: any) => <p className="text-sm font-bold">{d.total_km}km {d.achieved ? `（${d.achieved}達成）` : ''}{d.next ? ` / 次: ${d.next}` : ''}</p>}
            </Block>
          </div>
          <Block b={B.T12} title="週ストリーク" desc="1週間に1回以上トレーニングした週が何週連続しているかを示します。">
            {(d: any) => <p className="text-lg font-bold">現在 {d.current_weeks}週連続 <span className="text-xs text-gray-500">最長 {d.longest_weeks}週</span></p>}
          </Block>
          <Block b={B.T13} title="月間トレーニング日数" desc="月ごとにトレーニングした日数。今月は途中経過です。">
            {(d: any[]) => <BarChart height={90} points={d.map((m) => ({ date: m.month, value: m.days }))} />}
          </Block>
          <Block b={B.T14} title="メモタイムライン" desc="記録時に残したメモを新しい順に表示します。">
            {(d: any[]) => (
              <div className="space-y-1">
                {d.map((x, i) => <p key={i} className="text-[11px] text-gray-600">{x.date}｜{x.name}｜{x.memo}</p>)}
              </div>
            )}
          </Block>
          <details className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <summary className="text-sm font-bold text-gray-600">平均RPE推移（タップで展開）</summary>
            <p className="text-[10px] text-gray-400">主観的なきつさ（RPE）の週平均の推移。頑張りすぎや疲れの傾向を見る参考値です。</p>
            {B.T15?.status === 'ready' ? (
              <LineChart height={90} points={B.T15.data.map((p: any) => ({ date: p.date, value: p.avg_rpe }))} />
            ) : (
              <p className="text-xs text-gray-400">{B.T15?.message || 'まだデータが足りません'}</p>
            )}
          </details>
          <details className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <summary className="text-sm font-bold text-gray-600">RPE乖離ヒント（タップで展開）</summary>
            <p className="text-[10px] text-gray-400">同じ種目・同じ重量なのに普段よりかなりきつく感じた（RPE+2以上）場合に知らせる疲労の参考情報です。</p>
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
            <p className="text-[10px] text-gray-400">体重あたりの筋力（最大重量÷その時の体重）。体重が減っても同じ重量なら値は上昇=本当の伸び、の読み方ができます。</p>
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
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <p className="text-sm font-bold text-gray-600">摂取カロリー</p>
            <BarChart points={intakePoints} />
            {n.intake && <p className="text-[10px] text-gray-400">{n.intake}</p>}
          </div>
          <Block b={M.M6} title="タンパク g/kg 推移" note={`${mn.protein_approx} 目安: 1.6-2.2 g/kg`} desc="体重1kgあたり何gのタンパク質を摂れたか。筋肉づくりの目安です。">
            {(d: any[]) => <LineChart height={90} points={d.map((p) => ({ date: p.date, value: p.value }))} />}
          </Block>
          <Block b={M.M7} title="タンパク20g以上の食事" desc="1食でタンパク質20g以上を摂れた食事の数。展開すると最近の該当食事が表示されます。">
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
          <Block b={M.M3} title="食事の時間帯分布" note={mn.meal_time} desc="朝/昼/夕/夜間の食事記録の割合。夜間が多い場合は生活リズムの参考になります。">
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
          <Block b={M.M4} title="摂取の安定度" note={mn.stability} desc="日ごとの摂取カロリーのブレ幅。ブレが小さいほど食事が安定しています。">
            {(d: any) => <p className="text-lg font-bold">±{d.sd_kcal} kcal <span className="text-xs text-gray-500">{d.label}</span></p>}
          </Block>
          <Block b={M.M13} title="記録日数（記録状況）" desc="この期間に何日分の記録があるか。分析の信頼度を判断するための参考表示です。">
            {(d: any) => (
              <p className="text-sm font-bold">
                食事 {d.meal_days}{d.period_days ? `/${d.period_days}` : ''}日／トレ {d.training_days}{d.period_days ? `/${d.period_days}` : ''}日／体重 {d.weight_days}{d.period_days ? `/${d.period_days}` : ''}日
              </p>
            )}
          </Block>
          <Block b={M.M0} title="トレーニング日vs休息日の摂取" desc="トレ日と休息日で平均摂取カロリーを比較します。運動量に合わせた食事ができているかの参考になります。">
            {(d: any) => (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-blue-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">トレ日（{d.training_days.days}日）</p><p className="text-sm font-bold">{d.training_days.avg_kcal} kcal / P{d.training_days.avg_protein}g</p></div>
                <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">休息日（{d.rest_days.days}日）</p><p className="text-sm font-bold">{d.rest_days.avg_kcal} kcal / P{d.rest_days.avg_protein}g</p></div>
              </div>
            )}
          </Block>
          <Block b={M.M10} title="長距離日（10km以上）の摂取" desc="10km以上走った日とそれ以外の日で平均摂取カロリーを比較します。ランナーの燃料補給の参考になります。">
            {(d: any) => (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-blue-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">10km↑の日（{d.long_days.days}日）</p><p className="text-sm font-bold">{d.long_days.avg_kcal} kcal</p></div>
                <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">その他（{d.other_days.days}日）</p><p className="text-sm font-bold">{d.other_days.avg_kcal} kcal</p></div>
              </div>
            )}
          </Block>
          <Block b={M.M12} title="タンパク達成日数" note={mn.protein_ref} desc="体重1kgあたり1.6gのタンパク質を摂れた日数。">
            {(d: any) => <p className="text-lg font-bold">{d.achieved_days}日達成 <span className="text-xs text-gray-500">（対象{d.valid_days}日）</span></p>}
          </Block>
        </div>
      )}
    </div>
  );
}