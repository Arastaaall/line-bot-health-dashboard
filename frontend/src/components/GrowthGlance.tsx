import { useEffect, useState } from 'react';
import { callApi } from '../services/api';

export default function GrowthGlance() {
  const [b, setB] = useState<any>(null);
  useEffect(() => {
    callApi('getTrainingAnalysis', { range: '7d' })
      .then((d: any) => setB(d.blocks))
      .catch(() => {});
  }, []);
  if (!b) return null;
  return (
    <div className="space-y-2">
      {b.D1?.status === 'ready' && (
        <p className="text-sm text-gray-700 bg-white rounded-xl px-4 py-3 shadow-sm">📝 {b.D1.data.text}</p>
      )}
      {b.D2?.status === 'ready' && (
        <p className="text-xs text-gray-500 bg-white rounded-xl px-4 py-2 shadow-sm">
          今週のトレーニング <span className="font-bold text-gray-800">{b.D2.data.days}日</span>
          ／ 参考目標 {b.D2.data.reference_goal}日 <span className="text-[10px] text-gray-400">＊参考値</span>
        </p>
      )}
      {b.R2?.status === 'ready' && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
          最近、いつもよりトレーニング間隔が空いています（通常 約{b.R2.data.average_interval}日 / 現在 {b.R2.data.current_interval}日）。
        </p>
      )}
    </div>
  );
}