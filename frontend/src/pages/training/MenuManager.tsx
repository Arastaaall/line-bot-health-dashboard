import { useEffect, useMemo, useState } from 'react';
import { callApi } from '../../services/api';
import ExercisePicker from '../../components/ExercisePicker';
import type { PickedExercise } from '../../components/ExercisePicker';
import NamePicker from '../../components/NamePicker';
import Loading from '../../components/Loading';

const OTHER = 'その他';

export default function MenuManager() {
  const [loading, setLoading] = useState(true);
  const [menus, setMenus] = useState<any[]>([]);
  const [masters, setMasters] = useState<any[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [picked, setPicked] = useState<PickedExercise>({ master: null, freeName: '' });
  const [name, setName] = useState('');
  const [freeType, setFreeType] = useState('strength');
  const [group, setGroup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => `${Date.now()}_${Math.random().toString(36).slice(2)}`);

  const load = () => {
    callApi('getTrainingFormInit')
      .then((d: any) => {
        setMenus(d.menus);
        setLimit(d.limit);
        setMasters(d.exercises);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const groupOf = (m: any) => String(m.training_group || OTHER) || OTHER;

  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    menus.forEach((m) => {
      const g = groupOf(m);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(m);
    });
    const keys = Array.from(map.keys()).filter((k) => k !== OTHER);
    if (map.has(OTHER)) keys.push(OTHER);
    return keys.map((k) => ({ key: k, items: map.get(k)! }));
  }, [menus]);

  const persistOrder = async (newFlat: any[]) => {
    const orders: any[] = [];
    const gmap = new Map<string, any[]>();
    newFlat.forEach((m) => {
      const g = groupOf(m);
      if (!gmap.has(g)) gmap.set(g, []);
      gmap.get(g)!.push(m);
    });
    gmap.forEach((items, g) => {
      items.forEach((m, idx) => orders.push({ menu_id: m.menu_id, display_order: idx + 1, training_group: g }));
    });
    setMenus(newFlat); // 楽観更新（自動保存）
    try {
      await callApi('updateTrainingMenuOrder', { orders });
    } catch (e: any) {
      setError(e.message);
      load();
    }
  };

  const onDropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const dragged = menus.find((m) => m.menu_id === dragId);
    const target = menus.find((m) => m.menu_id === targetId);
    if (!dragged || !target) { setDragId(null); setOverId(null); return; }
    const without = menus.filter((m) => m.menu_id !== dragId);
    const moved = { ...dragged, training_group: groupOf(target) };
    const tIdx = without.findIndex((m) => m.menu_id === targetId);
    without.splice(tIdx, 0, moved);
    persistOrder(without);
    setDragId(null);
    setOverId(null);
  };

  const move = (groupItems: any[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= groupItems.length) return;
    const flat = menus.slice();
    const a = flat.findIndex((m) => m.menu_id === groupItems[i].menu_id);
    const b = flat.findIndex((m) => m.menu_id === groupItems[j].menu_id);
    [flat[a], flat[b]] = [flat[b], flat[a]];
    persistOrder(flat);
  };

  const add = async () => {
    setError(null); setInfo(null); setLimitMsg(null);
    const menuName = picked.master ? picked.master.exercise_name : name.trim();
    if (!menuName) { setError('種目を選択するかメニュー名を入力してください'); return; }
    try {
      const params: any = {
        menu_name: menuName,
        training_group: group.trim() || OTHER,
        client_id: clientId,
      };
      if (picked.master) params.master_id = picked.master.master_id;
      else params.training_type = freeType;
      await callApi('createTrainingMenu', params);
      setPicked({ master: null, freeName: '' });
      setName('');
      setGroup('');
      setInfo('追加しました');
      load();
    } catch (e: any) {
      if (e.code === 'LIMIT_EXCEEDED') setLimitMsg(e.message);
      else setError(e.message);
    } finally {
      setClientId(`${Date.now()}_${Math.random().toString(36).slice(2)}`);
    }
  };

  const del = async (id: string) => {
    if (!window.confirm('削除しますか？（過去ログは残ります）')) return;
    setError(null);
    try {
      await callApi('deleteTrainingMenu', { menu_id: id });
      load();
    } catch (e: any) { setError(e.message); }
  };

  if (loading) return <Loading />;

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">マイメニュー</h1>
        <span className="text-xs text-gray-500">{limit !== null ? `${menus.length}/${limit}枠` : '無制限'}</span>
      </div>
      <p className="text-[10px] text-gray-400">ドラッグ＆ドロップで並び替え・グループ移動（自動保存）</p>

      <div className="space-y-3">
        {groups.length === 0 && <p className="p-4 text-sm text-gray-500 bg-white rounded-xl">まだメニューがありません。</p>}
        {groups.map((g) => (
          <div key={g.key} className="bg-white rounded-xl shadow-sm overflow-hidden">
            <p className="px-3 py-2 text-xs font-bold text-white bg-gray-700">{g.key}</p>
            <div className="divide-y divide-gray-100">
              {g.items.map((m, i) => (
                <div
                  key={m.menu_id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(m.menu_id);
                    e.dataTransfer.setData('text/plain', m.menu_id);
                    e.dataTransfer.effectAllowed = 'move';
                    document.body.classList.add('cursor-grabbing');
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                    document.body.classList.remove('cursor-grabbing');
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDragEnter={() => setOverId(m.menu_id)}
                  onDrop={() => onDropOn(m.menu_id)}
                  className={
                    'p-3 flex items-center gap-2 cursor-grab transition-all ' +
                    (dragId === m.menu_id ? 'opacity-40 scale-[0.98] ring-2 ring-blue-300 ' : '') +
                    (overId === m.menu_id && dragId !== null && dragId !== m.menu_id ? 'bg-blue-50 border-t-2 border-blue-400 ' : '')
                  }
                >
                  <span className="text-gray-300 text-xs">⠿</span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-gray-800">{m.menu_name}</p>
                    <p className="text-xs text-gray-500">{m.training_type}</p>
                  </div>
                  <button onClick={() => move(g.items, i, -1)} className="px-2 py-1 text-xs bg-gray-100 rounded">↑</button>
                  <button onClick={() => move(g.items, i, 1)} className="px-2 py-1 text-xs bg-gray-100 rounded">↓</button>
                  <button onClick={() => del(m.menu_id)} className="px-2 py-1 text-xs text-rose-600 bg-rose-50 rounded">削除</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
        <p className="text-sm font-bold text-gray-600">メニュー追加</p>
        <ExercisePicker
          masters={masters}
          onPick={(p) => {
            setPicked(p);
            if (!p.master && p.freeName) setName(p.freeName);
          }}
        />
        <p className="text-sm font-bold text-gray-600">グループ</p>
        <NamePicker
          candidates={groups.map((g) => g.key).filter((k) => k !== OTHER)}
          onPick={setGroup}
          placeholder="例: 胸の日 / 有酸素"
        />
        {!picked.master && picked.freeName !== '' && (
          <select value={freeType} onChange={(e) => setFreeType(e.target.value)} className="w-full border rounded p-2 text-sm">
            <option value="strength">筋トレ</option>
            <option value="cardio">有酸素</option>
          </select>
        )}
        {limitMsg && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            {limitMsg}。PROなら無制限に登録できます。
          </div>
        )}
        {info && <p className="text-xs text-emerald-600">{info}</p>}
        {error && <p className="text-xs text-rose-600">エラー: {error}</p>}
        <button onClick={add} className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-bold">追加する</button>
      </div>
    </div>
  );
}