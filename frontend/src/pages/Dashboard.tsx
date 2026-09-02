import { useEffect, useState } from 'react';
import { callApi } from '../services/api';

export default function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [dash, setDash] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([callApi('getDailyCalorieSummary', {}), callApi('getDashboardData')])
      .then(([s, d]) => {
        setSummary(s);
        setDash(d);
      })
      .catch((e: any) => setError(e.message));
  }, []);

  if (error) return <p className="text-rose-600 text-sm">エラー: {error}</p>;
  if (!summary || !dash) return <p className="text-gray-500 text-sm">読み込み中...</p>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-gray-800">{dash.user.name}</h1>
        {dash.user.isPremium && (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-600 font-bold">PRO MEMBER</span>
        )}
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-bold text-gray-600 mb-3">今日のカロリー</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-gray-500">目標カロリー</p>
            <p className="text-lg font-bold">{summary.target_calories}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">摂取カロリー</p>
            <p className="text-lg font-bold">{summary.intake_calories}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">残り</p>
            <p className="text-lg font-bold text-blue-600">{summary.remaining_calories}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm border-2 border-dashed border-gray-200">
        <h2 className="text-sm font-bold text-gray-600 mb-1">推定運動消費</h2>
        <p className="text-2xl font-bold text-emerald-600">{summary.estimated_exercise_calories} kcal</p>
        <p className="text-xs text-gray-400 mt-1">＊ {summary.exercise_note}</p>
      </div>
    </div>
  );
}