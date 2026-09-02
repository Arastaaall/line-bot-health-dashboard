import { useEffect, useState } from 'react';
import { callApi } from '../../services/api';

export default function MenuManager() {
  const [menus, setMenus] = useState<any[]>([]);
  const [masters, setMasters] = useState<any[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [masterId, setMasterId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = () => {
    Promise.all([callApi('getTrainingMenus'), callApi('getTrainingMaster')])
      .then(([m, g]: any[]) => {
        setMenus(m.menus);
        setLimit(m.limit);
        setMasters(g.exercises);
      })
      .catch((e: any) => setError(e.message));
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    setError(null); setInfo(null);
    if (!name.trim()) { setError('メニュー名を入力してください'); return; }
    try {
      await callApi('createTrainingMenu', { menu_name: name.trim(), master_id: masterId || undefined });
      setName(''); setMasterId('');
      setInfo('追加しました');
      load();
    } catch (e: any) { setError(e.message); }
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= menus.length) return;
    try {
      await callApi('updateTrainingMenu', { menu_id: menus[i].menu_id, display_order: menus[j].display_order });
      await callApi('updateTrainingMenu', { menu_id: menus[j].menu_id, display_order: menus[i].display_order });
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

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {menus.length === 0 && <p className="p-4 text-sm text-gray-500">まだメニューがありません。</p>}
        {menus.map((m, i) => (
          <div key={m.menu_id} className="p-3 flex items-center gap-2">
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-800">{m.menu_name}</p>
              <p className="text-xs text-gray-500">{m.training_type}</p>
            </div>
            <button onClick={() => move(i, -1)} className="px-2 py-1 text-xs bg-gray-100 rounded">↑</button>
            <button onClick={() => move(i, 1)} className="px-2 py-1 text-xs bg-gray-100 rounded">↓</button>
            <button onClick={() => del(m.menu_id)} className="px-2 py-1 text-xs text-rose-600 bg-rose-50 rounded">削除</button>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
        <p className="text-sm font-bold text-gray-600">メニュー追加</p>
        <select value={masterId} onChange={(e) => setMasterId(e.target.value)} className="w-full border rounded p-2 text-sm">
          <option value="">種目マスターから選ばない（自由追加）</option>
          {masters.map((x) => <option key={x.master_id} value={x.master_id}>{x.exercise_name}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="メニュー名（例: 朝のランニング）" className="w-full border rounded p-2 text-sm" />
        {limit !== null && menus.length >= limit && (
          <p className="text-xs text-amber-600">無料枠（5件）が上限です。削除するかPROで無制限に。</p>
        )}
        {info && <p className="text-xs text-emerald-600">{info}</p>}
        {error && <p className="text-xs text-rose-600">エラー: {error}</p>}
        <button onClick={add} className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-bold">追加する</button>
      </div>
    </div>
  );
}