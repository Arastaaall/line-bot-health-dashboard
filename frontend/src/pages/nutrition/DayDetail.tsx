import { useEffect, useState } from 'react';
import { callApi } from '../../services/api';
import Loading from '../../components/Loading';

export default function DayDetail({ date, onBack }: { date: string; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    callApi('getFoodDay', { date })
      .then((d: any) => setData(d))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [date]);

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-blue-600">← 一覧へ戻る</button>
      <p className="text-sm font-bold text-gray-700">{date}</p>
      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}
      {loading ? <Loading /> : !data || data.status === 'empty' || (data.meals || []).length === 0 ? (
        <p className="text-xs text-gray-400 bg-white rounded-xl p-4">記録なし</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {data.meals.map((m: any, i: number) => (
            <div key={i} className="p-3 space-y-1">
              <p className="text-xs text-gray-500">
                {m.timestamp.slice(11, 16)}　<span className="text-sm font-bold text-gray-800">{m.menu_name}</span>
              </p>
              <p className="text-xs text-gray-600">{m.calories} kcal　P{m.protein} / F{m.fat} / C{m.carbs}</p>
              {m.advice && <p className="text-[10px] text-gray-400">{m.advice}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}