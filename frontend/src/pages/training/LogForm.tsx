import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callApi } from '../../services/api';
import ExercisePicker from '../../components/ExercisePicker';
import type { PickedExercise } from '../../components/ExercisePicker';
import Loading from '../../components/Loading';
import { useNavigate, useSearchParams } from 'react-router-dom';

const RPE_LABELS = ['楽だった', '余裕あり', 'まあまあ', 'かなりきつい', '限界', '地獄'];
const OTHER = 'その他';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type SetRow = { weight_kg: string; reps: string; rpe: string; is_bodyweight: boolean };
const emptySet = (): SetRow => ({ weight_kg: '', reps: '', rpe: '', is_bodyweight: false });
const defaultSets = () => Array.from({ length: 5 }, emptySet);

export default function LogForm() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'free' | 'menu'>('free');
  const [loadingInit, setLoadingInit] = useState(true);
  const [menus, setMenus] = useState<any[]>([]);
  const [masters, setMasters] = useState<any[]>([]);
  const [date, setDate] = useState(todayKey());
  const [error, setError] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 種目追加タブ
  const [picked, setPicked] = useState<PickedExercise>({ master: null, freeName: '' });
  const [manualType, setManualType] = useState('strength');
  const [mode, setMode] = useState<'beginner' | 'advanced'>('beginner');
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');
  const [rpeLabel, setRpeLabel] = useState('');
  const [rpeNum, setRpeNum] = useState('');
  const [sets, setSets] = useState<SetRow[]>(defaultSets());
  const [result, setResult] = useState<any>(null);

  // マイメニュータブ
  const [groupTab, setGroupTab] = useState<string>('');
  const [inputs, setInputs] = useState<Record<string, { sets: SetRow[]; duration: string; distance: string }>>({});
  const [batchResult, setBatchResult] = useState<{ name: string; calories: number }[] | null>(null);
  const [searchParams] = useSearchParams();
  const focusMenuId = searchParams.get('menu');

  useEffect(() => {
    if (focusMenuId && menus.length) {
      const m = menus.find((x) => x.menu_id === focusMenuId);
      if (m) {
        setTab('menu');
        setGroupTab(String(m.training_group || 'その他'));
      }
    }
  }, [focusMenuId, menus]);

  useEffect(() => {
    callApi('getTrainingFormInit')
      .then((d: any) => {
        setMenus(d.menus);
        setMasters(d.exercises);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoadingInit(false));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    menus.forEach((m) => {
      const g = String(m.training_group || OTHER) || OTHER;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(m);
    });
    const keys = Array.from(map.keys()).filter((k) => k !== OTHER);
    if (map.has(OTHER)) keys.push(OTHER);
    return keys.map((k) => ({ key: k, items: map.get(k)! }));
  }, [menus]);

  useEffect(() => {
    if (!groupTab && groups.length) setGroupTab(groups[0].key);
  }, [groups, groupTab]);

  const getInput = (menuId: string) =>
    inputs[menuId] || { sets: defaultSets(), duration: '', distance: '' };
  const setInput = (menuId: string, patch: Partial<{ sets: SetRow[]; duration: string; distance: string }>) =>
    setInputs((prev) => ({ ...prev, [menuId]: { ...getInput(menuId), ...patch } }));

  // ---------- 種目追加タブ 保存 ----------
  const submitFree = async () => {
    setError(null); setLimitMsg(null);
    const hasExercise = !!picked.master || picked.freeName !== '';
    if (!hasExercise) { setError('種目を選択または入力してください'); return; }
    const effectiveType = picked.master ? picked.master.exercise_type : manualType;
    const isCardio = effectiveType === 'cardio';
    const filledSets = sets.filter((s) => s.reps !== '' || s.weight_kg !== '');
    if (!isCardio && mode === 'advanced') {
      if (filledSets.length === 0) { setError('セットを入力してください（分からなければ初心者モードで）'); return; }
      if (filledSets.some((s) => !s.reps)) { setError('回数を入力してください（分からなければ初心者モードで）'); return; }
    }
    setSaving(true);
    try {
      const params: any = {
        client_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        training_date: date,
        training_type: effectiveType,
        duration_min: duration === '' ? null : Number(duration),
        distance_km: isCardio && distance !== '' ? Number(distance) : null,
      };
      if (picked.master) params.master_id = picked.master.master_id;
      else params.exercise_name = picked.freeName;
      if (!isCardio && mode === 'advanced') {
        params.rpe = rpeNum === '' ? null : Number(rpeNum);
        params.sets = filledSets.map((s) => ({
          weight_kg: s.weight_kg === '' ? null : Number(s.weight_kg),
          reps: Number(s.reps) || 0,
          rpe: s.rpe === '' ? null : Number(s.rpe),
          is_bodyweight: s.is_bodyweight,
        }));
      } else {
        if (rpeLabel) params.rpe_label = rpeLabel;
        params.sets = [];
      }
      setResult(await callApi('createTrainingLog', params));
    } catch (e: any) {
      if (e.code === 'LIMIT_EXCEEDED') setLimitMsg(e.message);
      else setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ---------- マイメニュータブ 一括保存 ----------
  const submitBatch = async () => {
    setError(null); setLimitMsg(null);
    const results: { name: string; calories: number }[] = [];
    setSaving(true);
    try {
      for (const g of groups) {
        for (const m of g.items) {
          const inp = inputs[m.menu_id];
          if (!inp) continue;
          const isCardio = m.training_type === 'cardio';
          const filledSets = inp.sets.filter((s) => s.reps !== '' || s.weight_kg !== '');
          if (filledSets.some((s) => !s.reps)) {
            setError(`「${m.menu_name}」の回数未入力があります`);
            setSaving(false);
            return;
          }
          const hasData = isCardio
            ? (inp.duration !== '' || inp.distance !== '')
            : (filledSets.length > 0 || inp.duration !== '');
          if (!hasData) continue;
          const params: any = {
            menu_id: m.menu_id,
            training_date: date,
            training_type: m.training_type,
            duration_min: inp.duration === '' ? null : Number(inp.duration),
            distance_km: isCardio && inp.distance !== '' ? Number(inp.distance) : null,
            sets: isCardio ? [] : filledSets.map((s) => ({
              weight_kg: s.weight_kg === '' ? null : Number(s.weight_kg),
              reps: Number(s.reps) || 0,
              rpe: s.rpe === '' ? null : Number(s.rpe),
              is_bodyweight: s.is_bodyweight,
            })),
            client_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          };
          const r: any = await callApi('createTrainingLog', params);
          results.push({ name: m.menu_name, calories: r.estimated_calories });
        }
      }
      if (results.length === 0) { setError('記録する入力がありません'); setSaving(false); return; }
      setBatchResult(results);
    } catch (e: any) {
      if (e.code === 'LIMIT_EXCEEDED') setLimitMsg(e.message);
      else setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-xl p-6 text-center space-y-3 shadow-sm">
        <p className="text-lg font-bold text-gray-800">記録しました！</p>
        <p className="text-3xl font-bold text-emerald-600">{result.estimated_calories} kcal</p>
        <p className="text-xs text-gray-400">推定消費カロリー（参考値）</p>
        <button onClick={() => nav('/training')} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm">一覧へ戻る</button>
      </div>
    );
  }

  if (batchResult) {
    const total = batchResult.reduce((s, r) => s + r.calories, 0);
    return (
      <div className="max-w-md mx-auto bg-white rounded-xl p-6 space-y-3 shadow-sm">
        <p className="text-lg font-bold text-gray-800 text-center">記録しました！</p>
        <div className="divide-y divide-gray-100 text-sm">
          {batchResult.map((r, i) => (
            <div key={i} className="py-2 flex justify-between">
              <span>{r.name}</span>
              <span className="font-bold text-emerald-600">{r.calories} kcal</span>
            </div>
          ))}
        </div>
        <p className="text-center text-2xl font-bold text-emerald-600">合計 {total} kcal</p>
        <p className="text-xs text-gray-400 text-center">推定消費カロリー（参考値）</p>
        <button onClick={() => nav('/training')} className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm">一覧へ戻る</button>
      </div>
    );
  }

  if (loadingInit) return <Loading />;

  const activeGroup = groups.find((g) => g.key === groupTab) || groups[0];

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setTab('free')} className={'px-4 py-2 rounded-full text-sm font-bold ' + (tab === 'free' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}>種目追加</button>
        <button onClick={() => setTab('menu')} className={'px-4 py-2 rounded-full text-sm font-bold ' + (tab === 'menu' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}>マイメニュー</button>
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border rounded p-2 text-sm" />
      </div>

      {tab === 'free' && (
        <>
          <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
            <p className="text-sm font-bold text-gray-600">種目</p>
            <ExercisePicker masters={masters} onPick={setPicked} />
            {!picked.master && picked.freeName !== '' && (
              <select value={manualType} onChange={(e) => setManualType(e.target.value)} className="w-full border rounded p-2 text-sm">
                <option value="strength">筋トレ</option>
                <option value="cardio">有酸素</option>
              </select>
            )}
          </div>

          <FreeBody
            mode={mode} setMode={setMode}
            duration={duration} setDuration={setDuration}
            distance={distance} setDistance={setDistance}
            rpeLabel={rpeLabel} setRpeLabel={setRpeLabel}
            rpeNum={rpeNum} setRpeNum={setRpeNum}
            sets={sets} setSets={setSets}
            isCardio={(picked.master ? picked.master.exercise_type : manualType) === 'cardio'}
          />
        </>
      )}

      {tab === 'menu' && (
        <>
          <div className="flex gap-1 flex-wrap">
            {groups.map((g) => (
              <button key={g.key} onClick={() => setGroupTab(g.key)} className={'px-3 py-1.5 rounded-full text-xs ' + (groupTab === g.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')}>
                {g.key}
              </button>
            ))}
            {groups.length === 0 && <p className="text-sm text-gray-500">マイメニューがありません。マイメニュー画面で追加してください。</p>}
          </div>

          {activeGroup && activeGroup.items.map((m) => {
            const inp = getInput(m.menu_id);
            const isCardio = m.training_type === 'cardio';
            return (
              <div key={m.menu_id} className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
                <p className="text-sm font-bold text-gray-800">{m.menu_name}</p>
                {isCardio ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={inp.duration} onChange={(e) => setInput(m.menu_id, { duration: e.target.value })} placeholder="時間（分）" className="border rounded p-2 text-sm" />
                    <input type="number" value={inp.distance} onChange={(e) => setInput(m.menu_id, { distance: e.target.value })} placeholder="距離（km）" className="border rounded p-2 text-sm" />
                  </div>
                ) : (
                  <div className="space-y-1">
                    {inp.sets.map((s, i) => (
                      <div key={i} className="grid grid-cols-4 gap-1 items-center">
                        <input type="number" value={s.weight_kg} onChange={(e) => setInput(m.menu_id, { sets: inp.sets.map((x, xi) => xi === i ? { ...x, weight_kg: e.target.value } : x) })} placeholder="kg" className="border rounded p-1.5 text-xs" disabled={s.is_bodyweight} />
                        <input type="number" value={s.reps} onChange={(e) => setInput(m.menu_id, { sets: inp.sets.map((x, xi) => xi === i ? { ...x, reps: e.target.value } : x) })} placeholder="回" className="border rounded p-1.5 text-xs" />
                        <input type="number" value={s.rpe} onChange={(e) => setInput(m.menu_id, { sets: inp.sets.map((x, xi) => xi === i ? { ...x, rpe: e.target.value } : x) })} placeholder="RPE" className="border rounded p-1.5 text-xs" />
                        <label className="text-[10px] text-gray-500 flex items-center gap-1">
                          <input type="checkbox" checked={s.is_bodyweight} onChange={(e) => setInput(m.menu_id, { sets: inp.sets.map((x, xi) => xi === i ? { ...x, is_bodyweight: e.target.checked } : x) })} />
                          自重
                        </label>
                      </div>
                    ))}
                    <button onClick={() => setInput(m.menu_id, { sets: [...inp.sets, emptySet()] })} className="text-xs text-blue-600">＋ セット追加</button>
                    <input type="number" value={inp.duration} onChange={(e) => setInput(m.menu_id, { duration: e.target.value })} placeholder="時間（分・任意）" className="w-full border rounded p-2 text-sm" />
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {limitMsg && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          {limitMsg}。PROなら1日の記録件数が無制限になります。
        </div>
      )}
      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}
      <button onClick={tab === 'free' ? submitFree : submitBatch} disabled={saving} className="w-full py-3 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">
        {saving ? '保存中...' : '保存する'}
      </button>
    </div>
  );
}

// 種目追加タブ本体（初心者/上級者）
function FreeBody(props: {
  mode: 'beginner' | 'advanced';
  setMode: (m: 'beginner' | 'advanced') => void;
  duration: string; setDuration: (v: string) => void;
  distance: string; setDistance: (v: string) => void;
  rpeLabel: string; setRpeLabel: (v: string) => void;
  rpeNum: string; setRpeNum: (v: string) => void;
  sets: SetRow[]; setSets: (s: SetRow[]) => void;
  isCardio: boolean;
}) {
  const { mode, setMode, duration, setDuration, distance, setDistance, rpeLabel, setRpeLabel, rpeNum, setRpeNum, sets, setSets, isCardio } = props;
  return (
    <>
      <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="時間（分）" className="border rounded p-2 text-sm" />
          {isCardio && (
            <input type="number" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="距離（km）" className="border rounded p-2 text-sm" />
          )}
        </div>
      </div>

      {!isCardio && (
        <div className="bg-white rounded-xl p-4 space-y-3 shadow-sm">
          <div className="flex gap-2">
            <button onClick={() => setMode('beginner')} className={'px-3 py-1.5 rounded-full text-xs ' + (mode === 'beginner' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600')}>初心者</button>
            <button onClick={() => setMode('advanced')} className={'px-3 py-1.5 rounded-full text-xs ' + (mode === 'advanced' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600')}>上級者（セット入力）</button>
          </div>

          {mode === 'advanced' ? (
            <div className="space-y-2">
              {sets.map((s, i) => (
                <div key={i} className="grid grid-cols-4 gap-1 items-center">
                  <input type="number" value={s.weight_kg} onChange={(e) => setSets(sets.map((x, xi) => xi === i ? { ...x, weight_kg: e.target.value } : x))} placeholder="kg" className="border rounded p-1.5 text-xs" disabled={s.is_bodyweight} />
                  <input type="number" value={s.reps} onChange={(e) => setSets(sets.map((x, xi) => xi === i ? { ...x, reps: e.target.value } : x))} placeholder="回" className="border rounded p-1.5 text-xs" />
                  <input type="number" value={s.rpe} onChange={(e) => setSets(sets.map((x, xi) => xi === i ? { ...x, rpe: e.target.value } : x))} placeholder="RPE" className="border rounded p-1.5 text-xs" />
                  <label className="text-[10px] text-gray-500 flex items-center gap-1">
                    <input type="checkbox" checked={s.is_bodyweight} onChange={(e) => setSets(sets.map((x, xi) => xi === i ? { ...x, is_bodyweight: e.target.checked } : x))} />
                    自重
                  </label>
                </div>
              ))}
              <button onClick={() => setSets([...sets, emptySet()])} className="text-xs text-blue-600">＋ セット追加</button>
              <p className="text-[10px] text-gray-400">未入力の行は無視されます。自重はkg不要・回数のみでOK。</p>
              <input type="number" value={rpeNum} onChange={(e) => setRpeNum(e.target.value)} placeholder="全体RPE（1-10・任意）" className="w-full border rounded p-2 text-sm" />
            </div>
          ) : (
            <select value={rpeLabel} onChange={(e) => setRpeLabel(e.target.value)} className="w-full border rounded p-2 text-sm">
              <option value="">体感（任意）</option>
              {RPE_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </div>
      )}

      {isCardio && (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <select value={rpeLabel} onChange={(e) => setRpeLabel(e.target.value)} className="w-full border rounded p-2 text-sm">
            <option value="">体感（任意）</option>
            {RPE_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      )}
    </>
  );
}