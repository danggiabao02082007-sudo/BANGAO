import { useEffect, useState, createContext, useContext, useCallback } from 'react';

export const cx = (...a) => a.filter(Boolean).join(' ');

export function Card({ title, icon, accent = 'from-ruong-500 to-lime-400', right, children, className = '', bodyClass = '' }) {
  return (
    <section className={cx('rounded-3xl bg-white/95 shadow-soft ring-1 ring-black/5 overflow-hidden', className)}>
      {title && (
        <header className={cx('flex items-center gap-2 px-4 py-3 text-white bg-gradient-to-r', accent)}>
          {icon && <span className="text-xl leading-none">{icon}</span>}
          <h2 className="font-bold text-[15px] flex-1">{title}</h2>
          {right}
        </header>
      )}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

const BTN = {
  green: 'bg-gradient-to-r from-ruong-600 to-emerald-500 text-white',
  gold: 'bg-gradient-to-r from-lua-500 to-orange-400 text-white',
  sky: 'bg-gradient-to-r from-sky-500 to-cyan-400 text-white',
  rose: 'bg-gradient-to-r from-rose-500 to-pink-500 text-white',
  violet: 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white',
  ghost: 'bg-white text-ink ring-1 ring-slate-300',
  danger: 'bg-white text-rose-600 ring-2 ring-rose-400'
};
export function Button({ color = 'green', className = '', small, ...p }) {
  return <button {...p} className={cx('rounded-2xl font-bold shadow-sm active:scale-[.98] transition disabled:opacity-50 disabled:pointer-events-none',
    small ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5', BTN[color], className)} />;
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-[13px] font-semibold text-slate-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}
export const inputCls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[16px] focus:outline-none focus:ring-2 focus:ring-ruong-400';
const groupDigits = v => String(v ?? '').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Ô nhập. inputMode="numeric" = ô tiền: tự hiển thị 1.000.000 khi gõ (trang gọi digits() để bỏ dấu chấm). */
export const Input = p => p.inputMode === 'numeric'
  ? <input {...p} value={groupDigits(p.value)} className={cx(inputCls, p.className)} />
  : <input {...p} className={cx(inputCls, p.className)} />;
export const Select = ({ children, ...p }) => <select {...p} className={cx(inputCls, p.className)}>{children}</select>;

export function Stat({ label, value, sub, icon, grad }) {
  return (
    <div className={cx('rounded-3xl p-4 text-white shadow-soft bg-gradient-to-br relative overflow-hidden', grad)}>
      <div className="absolute -right-3 -bottom-4 text-6xl opacity-25 select-none">{icon}</div>
      <div className="text-[13px] font-semibold opacity-95">{icon} {label}</div>
      <div className="text-[18px] sm:text-[22px] font-extrabold mt-1 leading-tight whitespace-nowrap">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-90">{sub}</div>}
    </div>
  );
}

export const Badge = ({ color = 'bg-ruong-100 text-ruong-800', children }) =>
  <span className={cx('inline-block rounded-full px-2.5 py-0.5 text-xs font-bold', color)}>{children}</span>;

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-ink/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={cx('bg-white w-full rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-auto shadow-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-lua-400 via-lime-400 to-ruong-500 text-white">
          <h3 className="font-extrabold flex-1">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/30 font-bold" aria-label="Đóng">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon = '🌾', text }) {
  return <div className="text-center py-8 text-slate-500"><div className="text-4xl mb-2">{icon}</div>{text}</div>;
}

export function Table({ head, children }) {
  return (
    <div className="overflow-x-auto -mx-4">
      <table className="w-full text-sm min-w-[560px]">
        <thead><tr className="text-left text-slate-500 border-b">{head.map((h, i) => <th key={i} className={cx('px-4 py-2 font-semibold', h.r && 'text-right')}>{h.t ?? h}</th>)}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr:last-child]:border-0 [&_td]:px-4 [&_td]:py-2.5">{children}</tbody>
      </table>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((text, type = 'ok') => {
    const id = Math.random(); setList(l => [...l, { id, text, type }]);
    setTimeout(() => setList(l => l.filter(x => x.id !== id)), type === 'err' ? 6000 : 2500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[60] top-3 left-1/2 -translate-x-1/2 space-y-2 w-[92%] max-w-md pointer-events-none">
        {list.map(t => <div key={t.id} className={cx('rounded-2xl px-4 py-3 font-semibold shadow-xl text-white',
          t.type === 'err' ? 'bg-rose-600' : 'bg-ruong-700')}>{t.type === 'err' ? '⚠️ ' : '✅ '}{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/** Tải dữ liệu bất đồng bộ với trạng thái loading/lỗi */
export function useLoad(fn, deps = []) {
  const [state, set] = useState({ data: null, loading: true, error: null });
  const reload = useCallback(() => {
    set(s => ({ ...s, loading: true }));
    fn().then(data => set({ data, loading: false, error: null })).catch(e => set({ data: null, loading: false, error: e.message }));
  }, deps); // eslint-disable-line
  useEffect(reload, [reload]);
  return { ...state, reload };
}

export const Loading = () => <div className="py-10 text-center text-slate-500 animate-pulse">🌾 Đang tải…</div>;
export const ErrorBox = ({ error }) => <div className="rounded-2xl bg-rose-50 text-rose-700 p-4 font-semibold">⚠️ {error}</div>;
