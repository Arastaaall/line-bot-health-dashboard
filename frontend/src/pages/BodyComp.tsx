import { useCallback, useEffect, useState } from 'react';
import { callApi } from '../services/api';
import Loading from '../components/Loading';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmt(dt: any) {
  const d = new Date(dt);
  if (isNaN(d.getTime())) return String(dt).slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const VISCERAL_NOTE = '＊内臓脂肪レベルは測定機器が返す値をそのまま表示した参考値です。異なる機器間での値の比較はできません。';

function FormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [device, setDevice] = useState('home_scale');
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState('');
  const [weight, setWeight] = useState('');
  const [memo, setMemo] = useState('');
  const [bf, setBf] = useState('');
  const [sm, setSm] = useState('');
  const [mm, setMm] = useState('');
  const [bw, setBw] = useState('');
  const [vf, setVf] = useState('');
  const [bmr, setBmr] = useState('');
  const [wc, setWc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isInbody = device === 'inbody';
  const showDetail = isInbody || device === 'home_scale';

  const submit = async () => {
    setError(null);
    if (!date) { setError('測定日は必須です'); return; }
    if (weight === '') { setError('体重は必須です'); return; }
    setSaving(true);
    try {
      const params: any = {
        measured_at: time ? `${date}T${time}` : date,
        measurement_device: device,
        weight_kg: Number(weight),
        memo,
        client_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      };
      if (showDetail) {
        if (bf !== '') params.body_fat_pct = Number(bf);
        if (sm !== '') params.skeletal_muscle_kg = Number(sm);
        if (vf !== '') params.visceral_fat = Number(vf);
        if (bmr !== '') params.bmr = Number(bmr);
      }
      if (isInbody) {
        if (mm !== '') params.muscle_mass_kg = Number(mm);
        if (bw !== '') params.body_water_pct = Number(bw);
        if (wc !== '') params.waist_cm = Number(wc);
      }
      await callApi('createBodyCompositionLog', params);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full max-w-md max-h-[90vh] overflow-auto rounded-t-2xl md:rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-gray-800">体組成を記録</p>
          <button onClick={onClose} className="text-xs text-gray-500 underline">閉じる</button>
        </div>

        <select value={device} onChange={(e) => setDevice(e.target.value)} className="w-full border rounded p-2 text-sm">
            <option value="home_scale">家庭用体重計／体組成計（タニタ等）</option>
            <option value="inbody">InBody／精密体組成計</option>
            <option value="other">その他（健診・簡易スケール等）</option>
        </select>


        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-600">測定日 *
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
          </label>
          <label className="text-xs text-gray-600">測定時刻（任意）
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
          </label>
        </div>

        <label className="text-xs text-gray-600 block">体重 (kg) *
          <input type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
        </label>

        {showDetail && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-600">体脂肪率 (%)
              <input type="number" inputMode="decimal" value={bf} onChange={(e) => setBf(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
            </label>
            <label className="text-xs text-gray-600">骨格筋量 (kg)
              <input type="number" inputMode="decimal" value={sm} onChange={(e) => setSm(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
            </label>
            <label className="text-xs text-gray-600">内臓脂肪
              <input type="number" inputMode="numeric" value={vf} onChange={(e) => setVf(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
            </label>
            <label className="text-xs text-gray-600">BMR (kcal)
              <input type="number" inputMode="numeric" value={bmr} onChange={(e) => setBmr(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
            </label>
            {isInbody && (
              <>
                <label className="text-xs text-gray-600">筋肉量 (kg)
                  <input type="number" inputMode="decimal" value={mm} onChange={(e) => setMm(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
                </label>
                <label className="text-xs text-gray-600">体水分率 (%)
                  <input type="number" inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
                </label>
                <label className="text-xs text-gray-600">腹囲 (cm)
                  <input type="number" inputMode="decimal" value={wc} onChange={(e) => setWc(e.target.value)} className="mt-0.5 w-full border rounded p-2 text-sm" />
                </label>
              </>
            )}
          </div>
        )}
        {showDetail && <p className="text-[10px] text-gray-400">{VISCERAL_NOTE}</p>}

        <label className="text-xs text-gray-600 block">メモ
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className="mt-0.5 w-full border rounded p-2 text-sm" />
        </label>

        {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}
        <button onClick={submit} disabled={saving} className="w-full py-3 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">
          {saving ? '保存中...' : '保存する'}
        </button>
      </div>
    </div>
  );
}

export default function BodyComp() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await callApi('getBodyComposition'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const remove = async (id: string) => {
    if (!window.confirm('この記録を削除しますか？')) return;
    setDeleting(true);
    try {
      await callApi('deleteBodyCompositionLog', { body_log_id: id });
      showToast('削除しました');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const trend: any[] = data?.weight_trend || [];
  const latest = trend.length && trend[0].weight_kg != null ? trend[0].weight_kg : null;
  let deltaText = '--';
  if (trend.length >= 2 && trend[0].weight_kg != null && trend[1].weight_kg != null) {
    const diff = Math.round((trend[0].weight_kg - trend[1].weight_kg) * 10) / 10;
    const arrow = diff < 0 ? '↓' : diff > 0 ? '↑' : '→';
    deltaText = `${diff > 0 ? '+' : ''}${diff} kg ${arrow}`;
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">体組成</h1>
        <button onClick={() => setFormOpen(true)} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold">＋ 記録</button>
      </div>

      {data?.plan_limits?.weight_days === 7 && (
        <p className="text-[10px] text-gray-400">無料プランは直近7日の体重を表示します。PROで全期間開放。</p>
      )}

      <div className="bg-white rounded-xl p-4 shadow-sm grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-gray-500">現在の体重</p>
          <p className="text-lg font-bold">{latest != null ? `${latest} kg` : '--'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">BMI</p>
          <p className="text-lg font-bold">{data?.bmi != null ? data.bmi : '--'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">前回比</p>
          <p className="text-lg font-bold text-blue-600">{deltaText}</p>
        </div>
      </div>

      {error && <p className="text-rose-600 text-sm">エラー: {error}</p>}

      {loading ? (
        <Loading />
      ) : (
        <>
          {(data?.detail_records || []).length > 0 && (
            <div className="bg-white rounded-xl p-4 shadow-sm space-y-3">
              <p className="text-sm font-bold text-gray-600">最新の詳細体組成</p>
              {data.detail_records.map((r: any, i: number) => (
                <div key={i} className="rounded-lg border border-gray-100 p-3 space-y-1">
                  <p className="text-xs text-gray-500">{fmt(r.measured_at)}</p>
                  <div className="grid grid-cols-3 gap-1 text-center">
                    {r.body_fat_pct != null && <div><p className="text-[10px] text-gray-400">体脂肪率</p><p className="text-sm font-bold">{r.body_fat_pct}</p></div>}
                    {r.skeletal_muscle_kg != null && <div><p className="text-[10px] text-gray-400">骨格筋量</p><p className="text-sm font-bold">{r.skeletal_muscle_kg}</p></div>}
                    {r.muscle_mass_kg != null && <div><p className="text-[10px] text-gray-400">筋肉量</p><p className="text-sm font-bold">{r.muscle_mass_kg}</p></div>}
                    {r.body_water_pct != null && <div><p className="text-[10px] text-gray-400">体水分率</p><p className="text-sm font-bold">{r.body_water_pct}</p></div>}
                    {r.visceral_fat != null && <div><p className="text-[10px] text-gray-400">内臓脂肪</p><p className="text-sm font-bold">{r.visceral_fat}</p></div>}
                    {r.bmr != null && <div><p className="text-[10px] text-gray-400">BMR</p><p className="text-sm font-bold">{r.bmr}</p></div>}
                    {r.waist_cm != null && <div><p className="text-[10px] text-gray-400">腹囲</p><p className="text-sm font-bold">{r.waist_cm}</p></div>}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-gray-400">{VISCERAL_NOTE}</p>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            {trend.length === 0 && <p className="p-4 text-sm text-gray-500">まだ記録がありません。</p>}
            {trend.map((t: any) => (
              <div key={t.body_log_id} className="p-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-gray-800">{t.weight_kg != null ? `${t.weight_kg} kg` : '--'}</p>
                  <p className="text-xs text-gray-500">{fmt(t.measured_at)}</p>
                </div>
                <button onClick={() => remove(t.body_log_id)} className="px-2 py-1 text-xs text-rose-600 bg-rose-50 rounded">削除</button>
              </div>
            ))}
          </div>
        </>
      )}

      {formOpen && (
        <FormModal
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            showToast('登録しました');
            load();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-800 text-white text-sm px-4 py-2 rounded-full">
          {toast}
        </div>
      )}
      {deleting && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center">
          <Loading />
        </div>
      )}
    </div>
  );
}