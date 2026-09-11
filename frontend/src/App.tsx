import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initLiff, isLoggedIn, login } from './services/liff';
import AppLayout from './layouts/AppLayout';
import Loading from './components/Loading';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const TrainingHome = lazy(() => import('./pages/training/TrainingHome'));
const LogForm = lazy(() => import('./pages/training/LogForm'));
const MenuManager = lazy(() => import('./pages/training/MenuManager'));
const LogHistory = lazy(() => import('./pages/training/LogHistory'));
const LogDetail = lazy(() => import('./pages/training/LogDetail'));
const BodyComp = lazy(() => import('./pages/BodyComp'));
const Growth = lazy(() => import('./pages/Growth'));
const NutritionPage = lazy(() => import('./pages/nutrition/NutritionPage'));

function App() {
  const [ready, setReady] = useState(false);
  const [initOk, setInitOk] = useState(false);

  useEffect(() => {
    initLiff().then((ok) => {
      setInitOk(ok);
      setReady(true);
    });
  }, []);

  if (!ready) return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-500">読み込み中...</div>;
  if (!initOk) return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-rose-600 px-4 text-center">LIFF 初期化失敗（エンドポイントURL / LIFF IDを確認してください）</div>;
  if (!isLoggedIn()) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold text-blue-600">Nutrition Dashboard</h1>
        <button onClick={login} className="px-6 py-3 rounded-lg bg-green-500 text-white font-bold">LINEでログイン</button>
      </div>
    );
  }

  return (
    <HashRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/training" element={<TrainingHome />} />
            <Route path="/training/log" element={<LogForm />} />
            <Route path="/training/menus" element={<MenuManager />} />
            <Route path="/training/history" element={<LogHistory />} />
            <Route path="/training/log/:id" element={<LogDetail />} />
            <Route path="/body" element={<BodyComp />} />
            <Route path="/growth" element={<Growth />} />
            <Route path="/nutrition" element={<NutritionPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}

export default App;
