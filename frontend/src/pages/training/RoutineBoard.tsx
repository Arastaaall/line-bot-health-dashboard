import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callApi } from '../../services/api';
import Loading from '../../components/Loading';

const isBw = (v: any) => v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function agoLabel(dateKey: string | null) {
  if (!dateKey) return '未実施';
  const d = new Date(dateKey + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff <= 0) return '今日';
  if (diff === 1) return '昨日';
  return `${diff}日前`;
}

function EntryBody({ e }: { e: any }) {
  return (
    <>
      {e.sets && e.sets.length > 0 ? (
        <div className="space-y-0.5">
          {e.sets.map((set: any, si: number) => (
            <p key={si} className="text-[11px] text-gray-700">
              {isBw(set.is_bodyweight) ? '自重' : `${set.weight_kg ?? '-'}kg`} × {set.reps}
              {set.rpe !== '' && set.rpe != null ? `（RPE${set.rpe}）` : ''}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-gray-700">
          {e.duration_min ? `${e.duration_min}分` : ''}{e.distance_km ? ` / ${e.distance_km}km` : ''}
          {e.rpe !== '' && e.rpe != null ? `（RPE${e.rpe}）` : ''}
        </p>
      )}
      {e.memo && <p className="text-[10px] text-gray-400 mt-1">{e.memo}</p>}
    </>
  );
}

export default function RoutineBoard() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callApi('getTrainingBoard')
      .then((d: any) => setGroups(d.groups))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const visibleGroups = useMemo(
    () => (selectedGroup === 'all' ? groups : groups.filter((g) => g.group === selectedGroup)),
    [groups, selectedGroup]
  );

  const toggle = (k: string) => setExpanded((p) => ({ ...p, [k]: !p[k] }));

  if (loading) return <Loading />;
  if (error) return <p className="text-rose-600 text-sm">エラー: {error}</p>;

  const tKey = todayKey();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border-l-4 border-blue-500 bg-blue-50 px-3 py-2 space-y-1">
        <p className="text-xs font-bold text-blue-700">📌 記録はメニューごとに管理されます</p>
        <p className="text-[11px] text-blue-700">
          同じ種目でもメニュー名が違えば（例: 「高重量の日」と「高回数の日」）トレーニング履歴は別々に管理されます。
          種目追加タブから記録した分はここには表示されません。
        </p>
      </div>
      <p className="text-[10px] text-gray-400 bg-white rounded-lg px-3 py-2">
        これよりも詳細な記録を見る場合は「成長の記録」を確認してください。
      </p>

      <div className="flex gap-1 overflow-x-auto pb-1">
        <button
          onClick={() => setSelectedGroup('all')}
          className={'shrink-0 px-3 py-1.5 rounded-full text-xs ' + (selectedGroup === 'all' ? 'bg-gray-700 text-white' : 'bg-white text-gray-600')}
        >
          すべて
        </button>
        {groups.map((g) => (
          <button
            key={g.group}
            onClick={() => setSelectedGroup(g.group)}
            className={'shrink-0 px-3 py-1.5 rounded-full text-xs ' + (selectedGroup === g.group ? 'bg-gray-700 text-white' : 'bg-white text-gray-600')}
          >
            {g.group}
          </button>
        ))}
      </div>

      {visibleGroups.length === 0 && <p className="p-4 text-sm text-gray-500 bg-white rounded-xl">選択したグループにメニューがありません。</p>}
      {visibleGroups.map((g) => (
        <div key={g.group} className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-3 py-2 bg-gray-700 text-white flex justify-between items-center">
            <p className="text-xs font-bold">{g.group}</p>
            <p className="text-[10px] opacity-80">{agoLabel(g.last_date)}</p>
          </div>
          <div className="divide-y divide-gray-100">
            {g.items.map((m: any) => (
              <div key={m.menu_id} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-800">{m.menu_name}</p>
                  <button
                    onClick={() => nav(`/training/log?menu=${m.menu_id}`)}
                    className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-bold"
                  >
                    記録
                  </button>
                </div>
                {m.sessions.length === 0 && <p className="text-[10px] text-gray-400">まだ記録がありません</p>}
                <div className="grid grid-cols-2 gap-2">
                  {m.sessions.map((s: any, i: number) => {
                    const label = i === 0 ? (s.date === tKey ? '今日' : '最新') : '前回';
                    const ek = `${m.menu_id}_${s.date}`;
                    const multi = s.entries.length > 1;
                    return (
                      <div key={ek} className={'rounded-lg border p-2 ' + (i === 0 ? 'border-blue-200 bg-blue-50/40' : 'border-gray-100')}>
                        <p className="text-[10px] text-gray-500 mb-1">{s.date}（{label}）</p>
                        {!multi ? (
                          <EntryBody e={s.entries[0]} />
                        ) : expanded[ek] ? (
                          <div className="space-y-2">
                            <button onClick={() => toggle(ek)} className="text-[10px] text-blue-600 underline">最小化</button>
                            {s.entries.map((e: any) => (
                              <div key={e.training_log_id}>
                                <p className="text-[10px] font-bold text-gray-500 mb-0.5">{e.time}</p>
                                <EntryBody e={e} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <button onClick={() => toggle(ek)} className="w-full text-left">
                            <p className="text-[11px] text-gray-700">{s.entries.map((e: any) => e.time).join(' / ')}</p>
                            <p className="text-[10px] text-blue-600 mt-0.5">{s.entries.length}件 ・ タップで詳細</p>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}