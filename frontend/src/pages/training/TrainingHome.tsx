import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callApi } from '../../services/api';
import { getUserId } from '../../services/liff';
import { loadSnapshot, saveSnapshot } from '../../services/snapshot';
import { getTrainingFormInitCached } from '../../services/trainingCache';
import Loading from '../../components/Loading';
import RoutineBoard from './RoutineBoard';

function key(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TrainingHome() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'today' | 'routine'>('today');
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let hasSnapshot = false;
    const userIdPromise = getUserId();
    const t = key(new Date());
    const logsPromise = callApi('getTrainingLogs', { from: t, to: t });

    const init = async () => {
      let userId: string | null = null;
      try {
        userId = await userIdPromise;
        if (userId && mounted) {
          const snap = loadSnapshot('training_home', userId);
          if (snap) {
            const snapLogs = Array.isArray(snap.logs)
              ? snap.logs.filter((l: any) => key(new Date(l.training_date)) === t)
              : [];
            setLogs(snapLogs);
            setRestricted(!!snap.range_restricted);
            setLoading(false);
            hasSnapshot = true;
          }
        }

        const d: any = await logsPromise;
        if (!mounted) return;
        const todayLogs = (d.logs || []).filter((l: any) => key(new Date(l.training_date)) === t);
        setLogs(todayLogs);
        setRestricted(!!d.range_restricted);
        if (userId) {
          saveSnapshot('training_home', userId, {
            logs: todayLogs,
            range_restricted: !!d.range_restricted,
            savedAt: Date.now(),
          });
        }
      } catch (e: any) {
        if (mounted && !hasSnapshot) setError(e.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();
    return () => { mounted = false; };
  }, []);

  // S2.6: トレーニング記録フォームの先読み（Prefetch）
  // 初期描画をブロックしないよう、ブラウザがアイドル状態になったタイミングで実行
  useEffect(() => {
    const prefetch = () => { getTrainingFormInitCached().catch(() => {}); };
    
    // requestIdleCallback が使える環境ではそれを優先、使えなければ 1.5秒後に実行
    const id = (window as any).requestIdleCallback 
      ? (window as any).requestIdleCallback(prefetch) 
      : window.setTimeout(prefetch, 1500);
      
    return () => {
      if ((window as any).cancelIdleCallback) (window as any).cancelIdleCallback(id);
      else window.clearTimeout(id as number);
    };
  }, []);

  const limitReached = restricted && logs.length >= 7;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex gap-2">
        <button onClick={() => setTab('today')} className={'px-4 py-2 rounded-full text-sm font-bold ' + (tab === 'today' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}>今日</button>
        <button onClick={() => setTab('routine')} className={'px-4 py-2 rounded-full text-sm font-bold ' + (tab === 'routine' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}>ルーティン</button>
      </div>

      {tab === 'routine' ? (
        <RoutineBoard />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-800">トレーニング</h1>
              {restricted && <span className="text-xs text-gray-500">本日 {logs.length}/7件</span>}
            </div>
            {limitReached ? (
              <span className="text-xs text-gray-400">本日の上限に到達</span>
            ) : (
              <button
                onPointerDown={() => { getTrainingFormInitCached().catch(() => {}); }}
                onTouchStart={() => { getTrainingFormInitCached().catch(() => {}); }}
                onClick={() => nav('/training/log')}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold"
              >＋ 記録追加</button>
            )}
          </div>

          {limitReached && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
              無料プランの1日7件まで記録しました。PROなら無制限に記録でき、履歴も全期間閲覧できます。
            </div>
          )}

          {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}
          {loading ? (
            <Loading />
          ) : (
            <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
              {logs.length === 0 && <p className="p-4 text-sm text-gray-500">今日はまだトレーニング記録がありません。</p>}
              {logs.map((l: any) => (
                <button
                  key={l.training_log_id}
                  onClick={() => nav(`/training/log/${l.training_log_id}`, { state: { knownLog: l } })}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-bold text-gray-800">{l.exercise_name_snapshot}</p>
                    <p className="text-xs text-gray-500">
                      {l.training_type}
                      {l.sets && l.sets.length > 0 ? ` / ${l.sets.length}セット` : ''}
                      {l.duration_min ? ` / ${l.duration_min}分` : ''}
                      {l.distance_km ? ` / ${l.distance_km}km` : ''}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-emerald-600">{l.estimated_calories} kcal</p>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 text-sm">
            <button onClick={() => nav('/training/history')} className="px-3 py-1.5 rounded bg-white text-gray-600">履歴</button>
            <button onClick={() => nav('/training/menus')} className="px-3 py-1.5 rounded bg-white text-gray-600">マイメニュー</button>
          </div>
        </>
      )}
    </div>
  );
}
