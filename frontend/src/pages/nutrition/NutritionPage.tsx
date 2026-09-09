import { useEffect, useState } from 'react';
import { callApi } from '../../services/api';
import Loading from '../../components/Loading';
import PeriodPills from './components/PeriodPills';
import AnalysisTab from './AnalysisTab';
import HistoryTab from './HistoryTab';

export default function NutritionPage() {
  const [tab, setTab] = useState<'analysis' | 'history'>('analysis');
  const [range, setRange] = useState('7d');
  const [data, setData] = useState<any>(null);
  const [isFree, setIsFree] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callApi('getGrowthSummary', { range: '7d' })
      .then((d: any) => setIsFree(d.plan_limits?.range_days === 7))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    callApi('getNutritionAnalysis', { range })
      .then((d: any) => setData(d))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-800">栄養素</h1>
      <div className="flex gap-2">
        <button onClick={() => setTab('analysis')} className={'px-4 py-2 rounded-full text-sm font-bold ' + (tab === 'analysis' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}>分析</button>
        <button onClick={() => setTab('history')} className={'px-4 py-2 rounded-full text-sm font-bold ' + (tab === 'history' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}>履歴</button>
      </div>
      <PeriodPills range={range} onChange={setRange} isFree={isFree} />
      {isFree && <p className="text-[10px] text-gray-400">無料プランは直近7日のみ表示。PROで全期間開放。</p>}
      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}
      {loading ? <Loading /> : tab === 'analysis' ? <AnalysisTab data={data} /> : <HistoryTab range={range} />}
    </div>
  );
}