import { useEffect, useRef, useState } from 'react';
import { callApi } from '../../services/api';
import Loading from '../../components/Loading';
import DayDetail from './DayDetail';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export default function HistoryTab({ range }: { range: string }) {
  const [days, setDays] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, any[]>>({});

  useEffect(() => {
    if (cacheRef.current[range]) {
      setDays(cacheRef.current[range]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    callApi('getFoodHistory', { range })
      .then((d: any) => {
        cacheRef.current[range] = d.days || [];
        setDays(d.days || []);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  if (selected) return <DayDetail date={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="space-y-2">
      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}
      {loading ? <Loading /> : !days || days.length === 0 ? (
        <p className="text-xs text-gray-400 bg-white rounded-xl p-4">記録なし</p>
      ) : (
        days.map((d) => {
          const dt = new Date(d.date + 'T00:00:00');
          return (
            <button
              key={d.date}
              onClick={() => setSelected(d.date)}
              className="w-full bg-white rounded-xl p-3 shadow-sm text-left space-y-1"
            >
              <p className="text-sm font-bold text-gray-700">{d.date.slice(5).replace('-', '/')}（{WEEK[dt.getDay()]}）</p>
              <p className="text-xs text-gray-600">{d.meals_count}食　{d.calories} kcal　P {d.protein}g</p>
            </button>
          );
        })
      )}
    </div>
  );
}