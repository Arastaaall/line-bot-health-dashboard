import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { callApi } from '../services/api';
import Loading from '../components/Loading';
import GrowthGlance from '../components/GrowthGlance';
import GoalPlanBanner from '../components/GoalPlanBanner';
import { BarChart, MultiLineChart, PfcBalanceChart, RadarChart } from '../components/charts';
import { LEGACY_RADAR_LABELS, legacyRadarValues } from '../components/legacyChartData';
import { getUserId } from '../services/liff';
import { loadSnapshot, saveSnapshot } from '../services/snapshot';

function LegacyDashboard({ legacy }: { legacy: any }) {
  if (!legacy?.daily?.length) return null;
  const { stats, ideal, daily, summary } = legacy;
  const pfc = [
    { label: 'P', name: 'たんぱく質', value: stats.avgProtein },
    { label: 'F', name: '脂質', value: stats.avgFat },
    { label: 'C', name: '炭水化物', value: stats.avgCarbs },
  ];
  const radarValues = legacyRadarValues(stats, ideal);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-bold text-gray-600">PFCバランス（過去7日間平均 vs 理想）</p>
          <PfcBalanceChart actual={pfc} ideal={[ideal.protein, ideal.fat, ideal.carbs]} />
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-bold text-gray-600">栄養バランス（過去7日間平均）</p>
          <RadarChart labels={[...LEGACY_RADAR_LABELS]} values={radarValues} />
        </div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="mb-2 text-sm font-bold text-gray-600">PFCの推移（過去7日間）</p>
        <MultiLineChart height={150} series={[
          { name: 'P', color: '#2563eb', points: daily.map((day: any) => ({ date: day.date, value: day.protein })) },
          { name: 'F', color: '#f97316', points: daily.map((day: any) => ({ date: day.date, value: day.fat })) },
          { name: 'C', color: '#10b981', points: daily.map((day: any) => ({ date: day.date, value: day.carbs })) },
        ]} />
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-bold text-gray-600">今週の栄養サマリー</p>
        <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-4">
          <div><p className="text-[10px] text-gray-400">栄養バランススコア</p><p className="text-2xl font-bold">{summary.score}<span className="text-xs text-gray-400"> / 100</span></p></div>
          <div><p className="text-[10px] text-gray-400">目標達成日数</p><p className="text-2xl font-bold">{summary.successDays}<span className="text-xs text-gray-400"> / 7日</span></p></div>
          <div><p className="text-[10px] text-gray-400">平均摂取カロリー</p><p className="text-2xl font-bold">{stats.avgCalories.toLocaleString()}</p></div>
          <div><p className="text-[10px] text-gray-400">目標カロリー</p><p className="text-2xl font-bold">{ideal.calories.toLocaleString()}</p></div>
        </div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-bold text-gray-600">1日あたりの摂取量（過去7日間）</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {daily.map((day: any) => (
            <div key={day.date} className="rounded-lg border border-gray-100 p-2 text-center">
              <p className="text-[10px] font-bold text-gray-500">{day.label}</p>
              <p className="my-1 text-sm font-bold">{day.calories.toLocaleString()} <span className="text-[10px] font-normal">kcal</span></p>
              <p className="text-[10px] text-gray-500">P {day.protein}g / F {day.fat}g / C {day.carbs}g</p>
            </div>
          ))}
        </div>
        <div className="mt-3"><BarChart height={100} points={daily.map((day: any) => ({ date: day.date, value: day.calories }))} /></div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-bold text-gray-600">平均して不足している栄養素</p>
        {summary.deficiencies.length ? (
          <div className="space-y-2">{summary.deficiencies.map((item: any) => <p key={item.name} className="text-xs text-gray-600">{item.name}：あと{item.diff}（{item.food}）</p>)}</div>
        ) : <p className="text-xs font-bold text-emerald-600">🎉 現在不足している主要栄養素はありません！</p>}
      </div>

      {legacy.user.is_premium && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><p className="text-sm font-bold text-gray-600">AIからのアドバイス</p><span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">プロプラン限定</span></div>
          <p className="mt-2 text-xs text-gray-600">詳細な栄養分析は栄養管理画面で確認できます。</p>
          <Link to="/nutrition" className="mt-3 block rounded-xl bg-emerald-50 py-2 text-center text-xs font-bold text-emerald-600">詳細な分析を見る →</Link>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [dash, setDash] = useState<any>(null);
  const [goalBanner, setGoalBanner] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let hasSnapshot = false;

    const init = async () => {
      // ユーザーIDの復元と最新データ取得を並列化し、Snapshot待ちでAPIを遅らせない。
      const userIdPromise = getUserId();
      const dashboardPromise = callApi('getDashboardAll');
      const userId = await userIdPromise;
      
      // 1. Snapshot (Local Cache) から即座に復元
      if (userId) {
        const snap = loadSnapshot('dashboard', userId);
        if (snap && isMounted) {
          setSummary(snap.summary);
          setDash(snap.dashboard);
          setGoalBanner(snap.goal_banner);
          setLoading(false); // 一旦ローディング解除して即表示！
          hasSnapshot = true;
        }
      }

      // 2. API から最新データを取得 (Revalidate)
      try {
        const d: any = await dashboardPromise;
        if (!isMounted) return;
        setSummary(d.summary);
        setDash(d.dashboard);
        setGoalBanner(d.goal_banner || null);
        setError(null);
        
        // 成功したら Snapshot に保存
        if (userId) {
          saveSnapshot('dashboard', userId, {
            summary: d.summary,
            dashboard: d.dashboard,
            goal_banner: d.goal_banner
          });
        }
      } catch (e: any) {
        if (!isMounted) return;
        // Snapshotがある場合はエラーを隠す（バックグラウンド更新失敗のため）
        if (!hasSnapshot) setError(e.message);
      } finally {
        if (isMounted && !hasSnapshot) setLoading(false);
      }
    };
    init();
    return () => { isMounted = false; };
  }, []);

  if (loading) return <Loading />;
  if (error) return <p className="text-rose-600 text-sm">エラー: {error}</p>;
  if (!summary || !dash) return <Loading />;

  return (
    <div className="space-y-4 max-w-3xl">
      <GoalPlanBanner banner={goalBanner} />
      <GrowthGlance data={dash.glance} />
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-gray-800">{dash.user.name}</h1>
        {dash.user.isPremium && (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-600 font-bold">PRO MEMBER</span>
        )}
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-bold text-gray-600 mb-3">今日のカロリー</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><p className="text-xs text-gray-500">目標カロリー</p><p className="text-lg font-bold">{summary.target_calories}</p></div>
          <div><p className="text-xs text-gray-500">摂取カロリー</p><p className="text-lg font-bold">{summary.intake_calories}</p></div>
          <div><p className="text-xs text-gray-500">残り</p><p className="text-lg font-bold text-blue-600">{summary.remaining_calories}</p></div>
        </div>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border-2 border-dashed border-gray-200">
        <h2 className="text-sm font-bold text-gray-600 mb-1">推定運動消費</h2>
        <p className="text-2xl font-bold text-emerald-600">{summary.estimated_exercise_calories} kcal</p>
        <p className="text-xs text-gray-400 mt-1">＊ {summary.exercise_note}</p>
      </div>
      <LegacyDashboard legacy={dash.legacy} />
    </div>
  );
}
