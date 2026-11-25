import { rpc } from '../lib/supabase.js';
import { money, num, date } from '../lib/format.js';
import { Card, Stat, Loading, ErrorBox, Empty, useLoad, cx } from '../components/ui.jsx';

const BAR = ['from-lua-400 to-orange-400', 'from-lime-400 to-ruong-500', 'from-sky-400 to-cyan-400', 'from-pink-400 to-rose-500', 'from-violet-400 to-fuchsia-500', 'from-amber-400 to-yellow-300', 'from-teal-400 to-emerald-500'];

function Bars({ rows, label }) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return (
    <div className="flex items-end gap-2 h-44">
      {rows.map((r, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
          <div className="text-[10px] font-bold text-slate-600 mb-1">{r.v ? num(r.v / 1e6, 1) + 'tr' : ''}</div>
          <div className={cx('w-full rounded-t-xl bg-gradient-to-t', BAR[i % BAR.length])} style={{ height: `${Math.max(3, (r.v / max) * 100)}%` }} title={money(r.v)} />
          <div className="text-[11px] font-semibold mt-1">{r.l}</div>
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default function Dashboard({ go, profile }) {
  const { data: d, loading, error } = useLoad(() => rpc('dashboard_summary', {}), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const quick = [
    ['🧾', 'Tạo hóa đơn', 'sales', 'from-ruong-600 to-lime-500'], ['🚚', 'Nhập hàng', 'purchase', 'from-sky-500 to-cyan-400', true],
    ['🍚', 'Thêm sản phẩm', 'products', 'from-lua-500 to-yellow-400', true], ['👨‍🌾', 'Thêm khách hàng', 'customers', 'from-pink-500 to-rose-400'],
    ['💵', 'Ghi thu', 'cash', 'from-emerald-500 to-teal-400', true], ['💸', 'Chi tiêu', 'expenses', 'from-orange-500 to-red-400', true]
  ].filter(q => !q[4] || profile.role !== 'staff');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {quick.map(([i, t, p, g]) => (
          <button key={t} onClick={() => go(p)} className={cx('rounded-2xl p-3 text-white font-bold text-[13px] shadow-soft bg-gradient-to-br active:scale-95 transition', g)}>
            <div className="text-2xl">{i}</div>{t}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat icon="🌾" label="Doanh thu hôm nay" value={money(d.revenue_today)} sub={`${d.invoices_today} hóa đơn · ${date(d.day)}`} grad="from-lua-500 to-orange-400" />
        <Stat icon="💵" label="Tiền thực thu hôm nay" value={money(d.cash_in_today)} sub="Gồm tiền bán + thu nợ, trừ hoàn tiền" grad="from-ruong-600 to-emerald-400" />
        {d.can_see_profit && <Stat icon="📈" label="Lợi nhuận hôm nay" value={money(d.gross_profit_today)} sub="Doanh thu − tiền vốn" grad="from-violet-600 to-fuchsia-400" />}
        <Stat icon="📒" label="Khách còn nợ" value={money(d.receivable)} grad="from-pink-500 to-rose-400" />
        <Stat icon="🏭" label="Nợ nhà cung cấp" value={money(d.payable)} grad="from-sky-600 to-cyan-400" />
        <Stat icon="🧺" label="Tồn kho" value={`${num(d.stock_bao, 1)} bao`} sub={`≈ ${num(d.stock_kg, 0)} kg${d.stock_value != null ? ' · giá trị ' + money(d.stock_value) : ''}`} grad="from-amber-500 to-yellow-400" />
      </div>
      <p className="text-xs text-slate-600 bg-white/80 rounded-xl px-3 py-2">ℹ️ Doanh thu, tiền thực thu và lợi nhuận là 3 chỉ tiêu riêng. Khách trả nợ cũ làm tăng <b>thực thu</b>, không làm tăng <b>doanh thu</b>.</p>
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
              <div className="flex-1 font-semibold">{p.name}<div className="text-xs text-slate-500">{num(p.qty_bao, 2)} bao</div></div>
              <b className="text-ruong-700">{money(p.revenue)}</b>
            </div>)) : <Empty text="Chưa có dữ liệu bán hàng" />}
        </Card>
        <Card title="Cảnh báo tồn thấp" icon="⚠️" accent="from-orange-500 to-red-500">
          {d.low_stock.length ? d.low_stock.map((p, i) => (
            <div key={i} className="flex justify-between py-2 border-b last:border-0"><span className="font-semibold">{p.name}</span>
              <span className="text-rose-600 font-bold">{num(p.qty, 2)} / {num(p.min, 2)} bao</span></div>)) : <Empty icon="🌻" text="Không có sản phẩm nào dưới mức cảnh báo" />}
        </Card>
        <Card title="Công nợ cũ nhất cần thu" icon="📒" accent="from-pink-500 to-fuchsia-500" className="lg:col-span-2">
          {d.debts_due.length ? d.debts_due.map(x => (
            <div key={x.invoice_code} className="flex justify-between py-2 border-b last:border-0 gap-2">
              <span><b>{x.customer_name}</b> <span className="text-xs text-slate-500">{x.invoice_code} · {date(x.day)}</span></span>
              <b className="text-rose-600">{money(x.debt_remaining)}</b></div>)) : <Empty icon="🎉" text="Không có khoản nợ nào" />}
        </Card>
      </div>
    </div>
  );
}
