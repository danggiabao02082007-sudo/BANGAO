import { useEffect, useState, lazy, Suspense } from 'react';
import { supabase } from './lib/supabase.js';
import { ROLE } from './lib/format.js';
import RiceScene from './components/RiceScene.jsx';
import { cx, Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';

const pages = {
  dashboard: lazy(() => import('./pages/Dashboard.jsx')),
  sales: lazy(() => import('./pages/Sales.jsx')),
  invoices: lazy(() => import('./pages/Invoices.jsx')),
  products: lazy(() => import('./pages/Products.jsx')),
  purchase: lazy(() => import('./pages/Purchase.jsx')),
  customers: lazy(() => import('./pages/Customers.jsx')),
  suppliers: lazy(() => import('./pages/Suppliers.jsx')),
  cash: lazy(() => import('./pages/Cash.jsx')),
  reports: lazy(() => import('./pages/Reports.jsx')),
  expenses: lazy(() => import('./pages/Expenses.jsx')),
  settings: lazy(() => import('./pages/Settings.jsx'))
};

// 9 phân hệ theo SPEC (Bán hàng có thêm mục Hóa đơn)
export const MENU = [
  { id: 'dashboard', n: '01', icon: '🏡', label: 'Tổng quan', short: 'Tổng quan', g: 'from-lua-400 to-orange-400' },
  { id: 'sales', n: '02', icon: '🛒', label: 'Bán hàng', short: 'Bán hàng', g: 'from-ruong-500 to-lime-400' },
  { id: 'invoices', n: '02', icon: '🧾', label: 'Hóa đơn', short: 'Hóa đơn', g: 'from-teal-500 to-emerald-400' },
  { id: 'products', n: '03', icon: '🍚', label: 'Sản phẩm & kho', short: 'Kho', g: 'from-amber-500 to-yellow-400' },
  { id: 'purchase', n: '04', icon: '🚚', label: 'Nhập hàng', g: 'from-sky-500 to-cyan-400', roles: ['owner', 'manager'] },
  { id: 'customers', n: '05', icon: '👨‍🌾', label: 'Khách hàng', short: 'Khách', g: 'from-pink-500 to-rose-400' },
  { id: 'suppliers', n: '06', icon: '🏭', label: 'Nhà cung cấp', g: 'from-indigo-500 to-violet-400', roles: ['owner', 'manager'] },
  { id: 'cash', n: '07', icon: '💰', label: 'Thu chi & công nợ', g: 'from-fuchsia-500 to-purple-400', roles: ['owner', 'manager'] },
  { id: 'expenses', n: '07', icon: '💸', label: 'Chi tiêu', g: 'from-orange-500 to-rose-500', roles: ['owner', 'manager'] },
  { id: 'reports', n: '08', icon: '📊', label: 'Doanh thu & lợi nhuận', g: 'from-orange-500 to-red-400', roles: ['owner', 'manager'] },
  { id: 'settings', n: '09', icon: '⚙️', label: 'Cài đặt', g: 'from-slate-500 to-slate-400' }
];
const MOBILE = ['dashboard', 'sales', 'invoices', 'products', 'customers'];

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState(() => location.hash.slice(1) || 'dashboard');
  const [more, setMore] = useState(false);
  // Thu gọn thanh bên trên máy tính (nhớ theo máy)
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('bonbien.sidebar') === 'mini'; } catch { return false; } });
  const toggleMini = () => setMini(v => { try { localStorage.setItem('bonbien.sidebar', v ? 'full' : 'mini'); } catch { /* bỏ qua */ } return !v; });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setProfile(null); return; }
    // profile.stock = công tắc quản lý tồn kho (store_settings.track_stock). false = ẩn mọi phần kho
    Promise.all([supabase.from('profiles').select('*').eq('id', session.user.id).single(), supabase.from('store_settings').select('track_stock').single()])
      .then(([{ data }, { data: st }]) => setProfile(data ? { ...data, stock: st?.track_stock !== false } : { role: null }));
  }, [session]);
  useEffect(() => { const h = () => setPage(location.hash.slice(1) || 'dashboard'); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  // Phím tắt Ctrl+B / Cmd+B: thu gọn/mở rộng thanh bên (bỏ qua khi đang gõ chữ)
  useEffect(() => {
    const k = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b' || e.repeat) return;
      const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault(); toggleMini();
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  const go = id => { location.hash = id; setMore(false); scrollTo(0, 0); };

  if (session === undefined || (session && !profile)) return <Splash />;
  if (!session) return <Login />;
  if (!profile.role || !profile.is_active) return <Blocked onOut={() => supabase.auth.signOut()} />;

  const menu = MENU.filter(m => !m.roles || m.roles.includes(profile.role))
    .map(m => m.id === 'products' && !profile.stock ? { ...m, label: 'Sản phẩm', short: 'Sản phẩm' } : m);
  const cur = menu.find(m => m.id === page) || menu[0];
  const Page = pages[cur.id];

  return (
    <div className="min-h-screen">
      <RiceScene className="fixed inset-x-0 bottom-0 w-full h-[46vh] -z-10" />
      <div className="fixed inset-x-0 top-0 h-[60vh] -z-20 bg-gradient-to-b from-sky-300 via-sky-100 to-ruong-50" />
      {/* Thanh bên (máy tính) */}
      <aside className={cx('hidden lg:flex fixed inset-y-0 left-0 flex-col bg-white/90 backdrop-blur border-r border-ruong-100 z-30 transition-[width] duration-200', mini ? 'w-20' : 'w-64')}>
        <div className={cx('flex items-center', mini && 'justify-center pt-4 pb-3')}><Brand mini={mini} /></div>
        {/* Nút thu gọn / mở rộng: tròn nhỏ gắn ở mép phải thanh bên */}
        <button onClick={toggleMini} title={(mini ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên') + ' (Ctrl+B)'} aria-label={mini ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
          aria-expanded={!mini} aria-controls="side-nav" aria-keyshortcuts="Control+B Meta+B"
          className={cx('absolute -right-4 w-8 h-8', mini ? 'top-[66px]' : 'top-8', ' rounded-full bg-white ring-2 ring-ruong-300 shadow-md hover:bg-ruong-50 text-ruong-700 font-black grid place-items-center transition hover:scale-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-ruong-500 focus-visible:ring-offset-2')}>{mini ? '»' : '«'}</button>
        {/* Danh sách menu: cuộn dọc khi màn thấp, không bao giờ cuộn ngang */}
        <nav id="side-nav" aria-label="Menu chính" className={cx('thin-scroll flex-1 overflow-y-auto overflow-x-hidden pb-3 space-y-1', mini ? 'px-2 pt-2' : 'px-3')}>
          {menu.map(m => (
            <button key={m.id} onClick={() => go(m.id)} title={mini ? m.label : undefined} aria-label={mini ? m.label : undefined} aria-current={m.id === cur.id ? 'page' : undefined}
              className={cx('w-full flex items-center rounded-2xl py-2.5 text-left font-semibold transition', mini ? 'justify-center px-0' : 'gap-3 px-3',
                m.id === cur.id ? cx('text-white shadow-md bg-gradient-to-r', m.g) : 'hover:bg-ruong-50 text-ink')}>
              <span key={m.id === cur.id ? 'on' : 'off'} className={cx('text-xl', m.id === cur.id && 'wiggle')}>{m.icon}</span>
              {!mini && <><span className="flex-1">{m.label}</span><span className={cx('text-[11px] opacity-60')}>{m.n}</span></>}
            </button>
          ))}
        </nav>
        <UserBox profile={profile} mini={mini} />
      </aside>

      <div className={cx('transition-[padding] duration-200', mini ? 'lg:pl-20' : 'lg:pl-64')}>
        {/* Thanh trên */}
        <header className={cx('sticky top-0 z-20 text-white bg-gradient-to-r shadow-md grain-pattern', cur.g)} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className={cx('mx-auto flex items-center gap-3 px-4 py-3', mini ? 'max-w-[1440px]' : 'max-w-6xl')}>
            <span className="text-3xl drop-shadow floaty">{cur.icon}</span>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-extrabold leading-tight drop-shadow-sm">{cur.label}</h1>
              <p className="text-xs opacity-90 truncate">{profile.full_name} · {ROLE[profile.role]}</p>
            </div>
            {cur.id !== 'sales' && <button onClick={() => go('sales')} className="hidden sm:block rounded-2xl bg-white/25 hover:bg-white/35 px-4 py-2 font-bold">🛒 Tạo hóa đơn</button>}
          </div>
        </header>

        <main className={cx('mx-auto px-3 sm:px-4 pt-4 pb-32 lg:pb-10', mini ? 'lg:max-w-[1440px] max-w-6xl' : 'max-w-6xl')}>
          <Suspense fallback={<Loading />}><div key={cur.id} className="anim-in"><Page profile={profile} go={go} /></div></Suspense>
        </main>
      </div>

      {/* Thanh dưới (điện thoại) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-ruong-100 grid grid-cols-6"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {MOBILE.map(id => menu.find(m => m.id === id)).filter(Boolean).map(m => (
          <button key={m.id} onClick={() => go(m.id)} className="py-2 flex flex-col items-center">
            <span key={m.id === cur.id ? 'on' : 'off'} className={cx('text-xl w-11 h-8 grid place-items-center rounded-full', m.id === cur.id && cx('bg-gradient-to-r wiggle', m.g))}>{m.icon}</span>
            <span className={cx('text-[10px] leading-tight font-bold mt-0.5 whitespace-nowrap', m.id === cur.id ? 'text-ruong-700' : 'text-slate-600')}>{m.short || m.label}</span>
          </button>
        ))}
        <button onClick={() => setMore(true)} className="py-2 flex flex-col items-center">
          <span className="text-xl w-11 h-8 grid place-items-center">☰</span><span className="text-[10px] font-bold mt-0.5 text-slate-600">Thêm</span>
        </button>
      </nav>
      {more && (
        <div className="lg:hidden fixed inset-0 z-40 bg-ink/40" onClick={() => setMore(false)}>
          <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-3xl p-4 pb-8" onClick={e => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-3">
              {menu.map(m => (
                <button key={m.id} onClick={() => go(m.id)} className={cx('rounded-2xl p-3 text-white font-bold text-sm bg-gradient-to-br shadow', m.g)}>
                  <div className="text-2xl">{m.icon}</div>{m.label}
                </button>
              ))}
            </div>
            <div className="mt-4"><UserBox profile={profile} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Brand({ mini }) {
  if (mini) return <img src="icons/icon-192.png" alt="Đại lý Bốn Biển" className="w-11 h-11 rounded-2xl shadow heartbeat" />;
  return (
    <div className="flex-1 min-w-0 px-5 py-5 flex items-center gap-3">
      <img src="icons/icon-192.png" alt="" className="w-12 h-12 rounded-2xl shadow heartbeat" />
      <div className="min-w-0"><div className="font-extrabold text-lg bg-gradient-to-r from-ruong-700 via-lime-600 to-lua-600 bg-clip-text text-transparent">Đại lý Bốn Biển</div>
        <div className="text-xs text-slate-500">Quản lý cửa hàng gạo</div></div>
    </div>
  );
}
function UserBox({ profile, mini }) {
  if (mini) return (
    <div className="m-2 rounded-2xl bg-gradient-to-r from-lua-100 to-ruong-100 p-2 flex flex-col items-center gap-1" title={`${profile.full_name} · ${ROLE[profile.role]}`}>
      <div className="w-9 h-9 rounded-full bg-white grid place-items-center text-lg">👤</div>
      <button onClick={() => supabase.auth.signOut()} className="text-xs font-bold text-rose-600">Thoát</button>
    </div>);
  return (
    <div className="m-3 rounded-2xl bg-gradient-to-r from-lua-100 to-ruong-100 p-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-white grid place-items-center text-xl">👤</div>
      <div className="flex-1 min-w-0"><div className="font-bold truncate">{profile.full_name}</div><div className="text-xs">{ROLE[profile.role]}</div></div>
      <button onClick={() => supabase.auth.signOut()} className="text-sm font-bold text-rose-600">Thoát</button>
    </div>
  );
}
const Splash = () => <div className="min-h-screen grid place-items-center bg-ruong-50"><div className="text-center"><div className="text-6xl animate-bounce">🌾</div><div className="font-bold text-ruong-700 mt-2">Đại lý Bốn Biển</div></div></div>;
const Blocked = ({ onOut }) => <div className="min-h-screen grid place-items-center p-6 text-center"><div><div className="text-5xl">🔒</div><p className="font-bold mt-3">Tài khoản đang bị khóa. Liên hệ chủ cửa hàng.</p><button className="mt-4 underline" onClick={onOut}>Đăng xuất</button></div></div>;
