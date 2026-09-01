import { useEffect, useState } from 'react';
import { initLiff, isLoggedIn, login, getAccessToken } from './services/liff';
import { callApi } from './services/api';

function App() {
  const [ready, setReady] = useState(false);
  const [initOk, setInitOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<unknown | null>(null);

  useEffect(() => {
    initLiff().then((ok) => {
      setInitOk(ok);
      setReady(true);
    });
  }, []);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await callApi('getDashboardData'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-500">LIFF 初期化中...</div>;
  }

  if (!initOk) {
    return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-rose-600">LIFF 初期化失敗（LIFF ID / エンドポイントURLを確認してください）</div>;
  }

  if (!isLoggedIn()) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold text-blue-600">Nutrition Dashboard</h1>
        <button onClick={login} className="px-6 py-3 rounded-lg bg-green-500 text-white font-bold">
          LINEでログイン
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-xl font-bold text-blue-600 mb-2">疎通テスト</h1>
      <p className="text-xs text-gray-500 mb-4">token: {getAccessToken()?.slice(0, 8)}...</p>
      <button
        onClick={handleFetch}
        disabled={loading}
        className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
      >
        {loading ? '取得中...' : 'GASからダッシュボードデータを取得'}
      </button>
      {error && <p className="mt-4 text-rose-600 text-sm">エラー: {error}</p>}
      {data && (
        <pre className="mt-4 p-4 bg-white rounded text-xs overflow-auto max-h-[70vh]">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default App;
