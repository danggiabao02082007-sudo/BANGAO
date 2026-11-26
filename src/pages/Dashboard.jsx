import { rpc } from '../lib/supabase.js';
import { money, num, date } from '../lib/format.js';
import { Card, Stat, Loading, ErrorBox, Empty, useLoad, cx } from '../components/ui.jsx';
import { effectiveTheme, daysTo } from '../lib/theme.js';

const BAR = ['from-lua-400 to-orange-400', 'from-lime-400 to-ruong-500', 'from-sky-400 to-cyan-400', 'from-pink-400 to-rose-500', 'from-violet-400 to-fuchsia-500', 'from-amber-400 to-yellow-300', 'from-teal-400 to-emerald-500'];

function Bars({ rows, label }) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return (
    <div className="flex items-end gap-2 h-44">
      {rows.map((r, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
          <div className="text-[10px] font-bold text-slate-600 mb-1">{r.v ? num(r.v / 1e6, 1) + 'tr' : ''}</div>
          <div className={cx('w-full rounded-t-xl bg-gradient-to-t origin-bottom', BAR[i % BAR.length])} style={{ height: `${Math.max(3, (r.v / max) * 100)}%`, animation: `growBar .8s ${i * .07}s cubic-bezier(.2,.8,.2,1) both` }} title={money(r.v)} />
          <div className="text-[11px] font-semibold mt-1">{r.l}</div>
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default function Dashboard({ go, profile }) {
  const { data: d, loading, error } = useLoad(async () => {
    const s = await rpc('dashboard_summary', {});
    if (s.can_see_profit) s.real = (await rpc('real_profit_report', { p_from: s.day, p_to: s.day }))[0];
    if (profile.role === 'owner') s.backup = await rpc('backup_status', {}).catch(() => null);
    return s;
  }, []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const quick = [
    ['🧾', 'Tạo hóa đơn', 'sales', 'from-ruong-600 to-lime-500'], ['🚚', 'Nhập hàng', 'purchase', 'from-sky-500 to-cyan-400', true],
    ['🍚', 'Thêm sản phẩm', 'products', 'from-lua-500 to-yellow-400', true], ['👨‍🌾', 'Thêm khách hàng', 'customers', 'from-pink-500 to-rose-400'],
    ['💵', 'Ghi thu', 'cash', 'from-emerald-500 to-teal-400', true], ['💸', 'Chi tiêu', 'expenses', 'from-orange-500 to-red-400', true]
  ].filter(q => !q[4] || profile.role !== 'staff');
  const th = effectiveTheme(), xd = th !== 'normal' ? daysTo(th) : null;
  const G = {
    xmas: ['🎅', 'from-red-600 via-rose-600 to-emerald-600', 'Giáng sinh', 'Giáng sinh an lành! 🎄', 'Chúc mừng mùa lễ hội! 🎉', 'chúc cả nhà buôn may bán đắt, gạo đầy kho, tiền đầy túi 🎁', '🎁🦌🛷'],
    tet: ['🧧', 'from-red-700 via-red-600 to-amber-500', 'Tết Nguyên Đán', 'Chúc mừng năm mới! An khang thịnh vượng 🧧', 'Chúc mừng năm mới! An khang thịnh vượng 🧧', 'chúc năm mới buôn bán phát tài, gạo đầy bồ, lộc đầy nhà 🌼', '🌼🌸🧨'],
    le304: ['⭐', 'from-red-700 via-red-600 to-yellow-500', 'ngày 30/4', 'Mừng ngày Giải phóng miền Nam, thống nhất đất nước 30/4 ⭐', 'Mừng ngày Quốc tế Lao động 1/5 💪', 'chúc cả nhà kỳ nghỉ lễ vui vẻ, buôn bán thuận lợi 🎆', '⭐🕊️🎆'],
    trungthu: ['🥮', 'from-indigo-800 via-purple-700 to-amber-500', 'Tết Trung Thu', 'Trung Thu vui vẻ, trăng rằm đoàn viên 🌕', 'Trung Thu vui vẻ, trăng rằm đoàn viên 🌕', 'chúc cả nhà Trung Thu sum vầy, buôn bán đắt hàng 🏮', '🌕🏮🐇'],
    halloween: ['🎃', 'from-orange-600 via-purple-700 to-slate-900', 'Halloween', 'Halloween vui vẻ! 🎃', 'Halloween vui vẻ! 🎃', 'chúc cả nhà một mùa Halloween vui, khách đến đông như ma 👻', '🎃🦇👻']
  }[th];
  return (
    <div className="space-y-4">
      {G && (
        <div className={cx('card relative overflow-hidden rounded-3xl p-4 text-white shadow-soft bg-gradient-to-r flex items-center gap-3', G[1])}>
          <span className="text-4xl floaty">{G[0]}</span>
          <div className="flex-1">
            <div className="text-lg font-extrabold">{xd === 0 ? G[3] : xd != null && xd > 0 && xd <= 40 ? `Còn ${xd} ngày nữa là ${G[2]}` : xd != null && xd < 0 ? G[4] : G[3]}</div>
            <div className="text-sm opacity-95">Đại lý Bốn Biển {G[5]}</div>
          </div>
          <span className="text-3xl hidden sm:block">{G[6]}</span>
        </div>)}
      {d.backup?.has_data && (d.backup.last_backup_at === null || d.backup.days_since >= 7) && (
        <button onClick={() => go('settings')} className="w-full text-left rounded-2xl p-3 bg-gradient-to-r from-sky-600 to-indigo-500 text-white font-semibold shadow-soft flex items-center gap-3">
          <span className="text-2xl floaty">💾</span>
          <span className="flex-1">{d.backup.last_backup_at === null ? 'Bạn chưa sao lưu dữ liệu lần nào.' : `Đã ${d.backup.days_since} ngày chưa sao lưu dữ liệu.`} Bấm để xuất sao lưu ngay.</span>
          <span>›</span>
        </button>)}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {quick.map(([i, t, p, g]) => (
          <button key={t} onClick={() => go(p)} className={cx('card relative overflow-hidden rounded-2xl p-3 text-white font-bold text-[13px] shadow-soft bg-gradient-to-br active:scale-95 transition', g)}>
            <div className="text-2xl">{i}</div>{t}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat icon="🌾" label="Doanh thu hôm nay" value={Number(d.revenue_today)} format={money} sub={`${d.invoices_today} hóa đơn · ${date(d.day)}`} grad="from-lua-500 to-orange-400" />
        <Stat icon="💵" label="Tiền thực thu hôm nay" value={Number(d.cash_in_today)} format={money} sub="Gồm tiền bán + thu nợ, trừ hoàn tiền" grad="from-ruong-600 to-emerald-400" />
        {d.can_see_profit && <Stat icon="📈" label="Lợi nhuận hôm nay" value={Number(d.gross_profit_today)} format={money} sub="Doanh thu − tiền vốn" grad="from-violet-600 to-fuchsia-400" />}
        {d.real && <Stat icon="🏆" label="Lợi nhuận thực hôm nay" value={Number(d.real.real_profit)} format={money}
          sub={`= ${money(d.real.revenue)} − vốn ${money(d.real.cost)} − chi ${money(d.real.expenses)} − cố định ${money(d.real.fixed_costs)}`}
          grad={Number(d.real.real_profit) >= 0 ? 'from-teal-600 to-cyan-400' : 'from-rose-600 to-red-400'} />}
        <Stat icon="📒" label="Khách còn nợ" value={Number(d.receivable)} format={money} grad="from-pink-500 to-rose-400" />
        <Stat icon="🏭" label="Nợ nhà cung cấp" value={Number(d.payable)} format={money} grad="from-sky-600 to-cyan-400" />
        {profile.stock && <Stat icon="🧺" label="Tồn kho" value={Number(d.stock_items || 0)} format={v => num(v, 0) + ' mặt hàng còn hàng'} sub={`${num(d.stock_bao, 1)} bao · ≈ ${num(d.stock_kg, 0)} kg hàng cân${d.stock_value != null ? ' · giá trị ' + money(d.stock_value) : ''}`} grad="from-amber-500 to-yellow-400" />}
      </div>
      <p className="text-xs text-slate-600 bg-white/80 rounded-xl px-3 py-2">ℹ️ Doanh thu, tiền thực thu và lợi nhuận là 3 chỉ tiêu riêng. Khách trả nợ cũ làm tăng <b>thực thu</b>, không làm tăng <b>doanh thu</b>. <b>Lợi nhuận thực</b> = doanh thu − tiền vốn − chi tiêu (điện, nước, vận chuyển…).</p>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Doanh thu 7 ngày" icon="📅" accent="from-lua-500 to-orange-400">
          <Bars rows={d.last7.map(r => ({ l: date(r.day).slice(0, 5), v: Number(r.revenue) }))} label="Doanh thu 7 ngày" />
        </Card>
        <Card title="Doanh thu theo tháng" icon="🗓️" accent="from-sky-500 to-violet-500">
          <Bars rows={d.by_month.map(r => ({ l: r.month.slice(0, 2) + '/' + r.month.slice(5), v: Number(r.revenue) }))} label="Doanh thu theo tháng" />
        </Card>
        <Card title="Top 5 sản phẩm bán chạy (30 ngày)" icon="🏆" accent="from-ruong-600 to-lime-500">
          {d.top_products.length ? d.top_products.map((p, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0">
              <span className="text-xl">{['🥇', '🥈', '🥉', '🎖️', '🏅'][i]}</span>
              <div className="flex-1 font-semibold">{p.name}<div className="text-xs text-slate-500">{num(p.qty_bao, 2)} {(p.unit || 'Bao').toLowerCase()}</div></div>
              <b className="text-ruong-700">{money(p.revenue)}</b>
            </div>)) : <Empty text="Chưa có dữ liệu bán hàng" />}
        </Card>
        {profile.stock && <Card title="Cảnh báo tồn thấp" icon="⚠️" accent="from-orange-500 to-red-500">
          {d.low_stock.length ? d.low_stock.map((p, i) => (
            <div key={i} className="flex justify-between py-2 border-b last:border-0"><span className="font-semibold">{p.name}</span>
              <span className="text-rose-600 font-bold">{num(p.qty, 2)} / {num(p.min, 2)} {(p.unit || 'Bao').toLowerCase()}</span></div>)) : <Empty icon="🌻" text="Không có sản phẩm nào dưới mức cảnh báo" />}
        </Card>}
        <Card title="Công nợ cũ nhất cần thu" icon="📒" accent="from-pink-500 to-fuchsia-500" className={profile.stock ? 'lg:col-span-2' : ''}>
          {d.debts_due.length ? d.debts_due.map(x => (
            <div key={x.invoice_code} className="flex justify-between py-2 border-b last:border-0 gap-2">
              <span><b>{x.customer_name}</b> <span className="text-xs text-slate-500">{x.invoice_code} · {date(x.day)}</span></span>
              <b className="text-rose-600">{money(x.debt_remaining)}</b></div>)) : <Empty icon="🎉" text="Không có khoản nợ nào" />}
        </Card>
      </div>
    </div>
  );
}
