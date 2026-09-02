import { useEffect, useMemo, useState } from 'react';
import { callApi } from '../../services/api';
import ExercisePicker from '../../components/ExercisePicker';
import type { PickedExercise } from '../../components/ExercisePicker';

const OTHER = 'その他';

export default function MenuManager() {
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
  const [clientId, setClientId] = useState(() => `${Date.now()}_${Math.random().toString(36).slice(2)}`);

  const load = () => {
    callApi('getTrainingFormInit')
      .then((d: any) => {
        setMenus(d.menus);
        setLimit(d.limit);
        setMasters(d.exercises);
      })
      .catch((e: any) => setError(e.message));
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

  const allGroupNames = useMemo(() => groups.map((g) => g.key), [groups]);

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
      setInfo('追加しました');
      load();
    } catch (e: any) {
      if (e.code === 'LIMIT_EXCEEDED') setLimitMsg(e.message);
      else setError(e.message);
    } finally {
      setClientId(`${Date.now()}_${Math.random().toString(36).slice(2)}`);
    }
  };

  const move = async (groupItems: any[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= groupItems.length) return;
    try {
      await callApi('updateTrainingMenu', { menu_id: groupItems[i].menu_id, display_order: groupItems[j].display_order });
      await callApi('updateTrainingMenu', { menu_id: groupItems[j].menu_id, display_order: groupItems[i].display_order });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const changeGroup = async (menuId: string, g: string) => {
    setError(null);
    try {
      await callApi('updateTrainingMenu', { menu_id: menuId, training_group: g });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const del = async (id: string) => {
    if (!window.confirm('削除しますか？（過去ログは残ります）')) return;
    setError(null);
    try {
      await callApi('deleteTrainingMenu', { menu_id: id });
      load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">マイメニュー</h1>
        <span className="text-xs text-gray-500">{limit !== null ? `${menus.length}/${limit}枠` : '無制限'}</span>
      </div>

      <div className="space-y-3">
        {groups.length === 0 && <p className="p-4 text-sm text-gray-500 bg-white rounded-xl">まだメニューがありません。</p>}
        {groups.map((g) => (
          <div key={g.key} className="bg-white rounded-xl shadow-sm overflow-hidden">
            <p className="px-3 py-2 text-xs font-bold text-white bg-gray-700">{g.key}</p>
            <div className="divide-y divide-gray-100">
              {g.items.map((m, i) => (
                <div key={m.menu_id} className="p-3 flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-gray-800">{m.menu_name}</p>
                    <p className="text-xs text-gray-500">{m.training_type}</p>
                  </div>
                  <select
                    value={groupOf(m)}
                    onChange={(e) => changeGroup(m.menu_id, e.target.value)}
                    className="text-[10px] border rounded px-1 py-0.5 text-gray-500"
                  >
                    {(allGroupNames.includes(groupOf(m)) ? allGroupNames : [groupOf(m), ...allGroupNames]).map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
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
        <input
          list="group-suggestions"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="グループ（例: 胸の日 / 有酸素）※未入力ならその他"
          className="w-full border rounded p-2 text-sm"
        />
        <datalist id="group-suggestions">
          {allGroupNames.filter((g) => g !== OTHER).map((g) => <option key={g} value={g} />)}
        </datalist>
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