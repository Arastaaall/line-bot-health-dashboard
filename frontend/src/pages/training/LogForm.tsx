import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callApi } from '../../services/api';

const RPE_LABELS = ['楽だった', '余裕あり', 'まあまあ', 'かなりきつい', '限界', '地獄'];

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type SetRow = { weight_kg: string; reps: string; rpe: string; is_bodyweight: boolean };

export default function LogForm() {
  const nav = useNavigate();
  const [menus, setMenus] = useState<any[]>([]);
  const [menuId, setMenuId] = useState('');
  const [freeName, setFreeName] = useState('');
  const [trainingType, setTrainingType] = useState('strength');
  const [mode, setMode] = useState<'beginner' | 'advanced'>('beginner');
  const [date, setDate] = useState(todayKey());
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');
  const [rpeLabel, setRpeLabel] = useState('');
  const [rpeNum, setRpeNum] = useState('');
  const [sets, setSets] = useState<SetRow[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    callApi('getTrainingMenus')
      .then((m: any) => setMenus(m.menus))
      .catch((e: any) => setError(e.message));
  }, []);

  const selectedMenu = menus.find((m) => m.menu_id === menuId) || null;
  const effectiveType: string = selectedMenu ? selectedMenu.training_type : trainingType;
  const isCardio = effectiveType === 'cardio';

  const addSet = () => setSets([...sets, { weight_kg: '', reps: '', rpe: '', is_bodyweight: false }]);
  const updateSet = (i: number, patch: Partial<SetRow>) => {
    const next = sets.slice();
    next[i] = { ...next[i], ...patch };
    setSets(next);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const params: any = {
        training_date: date,
        training_type: effectiveType,
        duration_min: duration === '' ? null : Number(duration),
        distance_km: isCardio && distance !== '' ? Number(distance) : null,
      };
      if (selectedMenu) params.menu_id = selectedMenu.menu_id;
      else params.exercise_name = freeName;

      if (!isCardio && mode === 'advanced') {
        params.rpe = rpeNum === '' ? null : Number(rpeNum);
        params.sets = sets.map((s) => ({
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
      setError(e.message);
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

  return (
    <div className="max-w-md mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-800">種目追加</h1>

      <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
        <p className="text-sm font-bold text-gray-600">種目</p>
        <select value={menuId} onChange={(e) => setMenuId(e.target.value)} className="w-full border rounded p-2 text-sm">
          <option value="">自由追加（直接入力）</option>
          {menus.map((m) => <option key={m.menu_id} value={m.menu_id}>{m.menu_name}</option>)}
        </select>
        {!selectedMenu && (
          <>
            <input value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder="例: ベンチプレス / ランニング" className="w-full border rounded p-2 text-sm" />
            <select value={trainingType} onChange={(e) => setTrainingType(e.target.value)} className="w-full border rounded p-2 text-sm">
              <option value="strength">筋トレ</option>
              <option value="cardio">有酸素</option>
            </select>
          </>
        )}
      </div>

      <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
        <p className="text-sm font-bold text-gray-600">日付・内容</p>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border rounded p-2 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input type="number" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="時間（分）" className="border rounded p-2 text-sm" />
          {isCardio && (
            <input type="number" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="距離（km）" className="border rounded p-2 text-sm" />
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
                  <input type="number" value={s.weight_kg} onChange={(e) => updateSet(i, { weight_kg: e.target.value })} placeholder="kg" className="border rounded p-1.5 text-xs" disabled={s.is_bodyweight} />
                  <input type="number" value={s.reps} onChange={(e) => updateSet(i, { reps: e.target.value })} placeholder="回" className="border rounded p-1.5 text-xs" />
                  <input type="number" value={s.rpe} onChange={(e) => updateSet(i, { rpe: e.target.value })} placeholder="RPE" className="border rounded p-1.5 text-xs" />
                  <label className="text-[10px] text-gray-500 flex items-center gap-1">
                    <input type="checkbox" checked={s.is_bodyweight} onChange={(e) => updateSet(i, { is_bodyweight: e.target.checked })} />
                    自重
                  </label>
                </div>
              ))}
              <button onClick={addSet} className="text-xs text-blue-600">＋ セット追加</button>
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

      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}
      <button onClick={submit} disabled={saving} className="w-full py-3 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">
        {saving ? '保存中...' : '保存する'}
      </button>
    </div>
  );
}