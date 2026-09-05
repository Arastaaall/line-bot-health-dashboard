import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/', label: '📊 ダッシュボード' },
  { to: '/training', label: '🏋️ トレーニング' },
  { to: '/body', label: '⚖️ 体組成' },
    { to: '/growth', label: '📈 成長の記録' },
];

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-gray-100 flex">
      <aside className="hidden md:flex w-56 flex-col bg-white border-r border-gray-200 p-4 gap-1">
        <div className="text-lg font-bold text-blue-600 mb-4">NUTRITION</div>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) =>
              'px-3 py-2 rounded-lg text-sm ' + (isActive ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50')
            }
          >
            {l.label}
          </NavLink>
        ))}
        <div className="mt-auto text-xs text-gray-400">食事記録 / 栄養素<br />は順次開放</div>
      </aside>
      <main className="flex-1 p-4 md:p-6 overflow-x-hidden">
        <div className="md:hidden mb-4 flex gap-2">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                'px-3 py-1.5 rounded-full text-xs ' + (isActive ? 'bg-blue-600 text-white' : 'bg-white text-gray-600')
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
        <Outlet />
      </main>
    </div>
  );
}