import { useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { money, date, isoDay, num } from '../lib/format.js';
import { Card, Input, Loading, ErrorBox, useLoad, cx } from '../components/ui.jsx';

const shift = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const lastDay = d => { const [y, m] = d.split('-').map(Number); return `${d.slice(0, 8)}${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export default function Reports() {
  const today = isoDay();
  const [day, setDay] = useState(today);
  const mFrom = day.slice(0, 8) + '01', mTo = lastDay(day) > today && day.slice(0, 7) === today.slice(0, 7) ? today : lastDay(day);
  const month = useLoad(() => rpc('daily_report', { p_from: mFrom, p_to: mTo }), [mFrom, mTo]);
  const detail = useLoad(() => rpc('daily_cost_detail', { p_day: day }), [day]);
  const sel = month.data?.find(r => r.day === day) || { revenue: 0, cost: 0, profit: 0, invoices: 0 };
  const sum = k => (month.data || []).reduce((a, r) => a + Number(r[k]), 0);
  const max = Math.max(1, ...(month.data || []).map(r => Number(r.revenue)));

  return (
    <div className="space-y-4">
      <Card title="Chọn ngày" icon="📅" accent="from-orange-500 to-red-400">
        <div className="flex items-center gap-2">
          <button onClick={() => setDay(shift(day, -1))} className="w-11 h-11 rounded-full bg-gradient-to-br from-lua-400 to-orange-500 text-white font-bold" aria-label="Ngày trước">◀</button>
          <Input type="date" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} className="text-center font-bold" />
          <button onClick={() => setDay(shift(day, 1))} disabled={day >= today} className="w-11 h-11 rounded-full bg-gradient-to-br from-lua-400 to-orange-500 text-white font-bold disabled:opacity-40" aria-label="Ngày sau">▶</button>
        </div>
        {day !== today && <button onClick={() => setDay(today)} className="mt-2 text-sm font-bold text-orange-600">↩ Về hôm nay</button>}
      </Card>

      {month.loading ? <Loading /> : month.error ? <ErrorBox error={month.error} /> : <>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-3xl p-5 text-white shadow-soft bg-gradient-to-br from-lua-500 to-orange-500 relative overflow-hidden">
            <div className="absolute -right-2 -bottom-4 text-7xl opacity-25">🌾</div>
            <div className="font-bold">Doanh thu bán ngày {date(day)}</div>
            <div className="text-3xl font-extrabold mt-1">{money(sel.revenue)}</div>
            <div className="text-sm opacity-90 mt-1">{sel.invoices} hóa đơn</div>
          </div>
          <div className={cx('rounded-3xl p-5 text-white shadow-soft bg-gradient-to-br relative overflow-hidden', Number(sel.profit) >= 0 ? 'from-ruong-600 to-lime-500' : 'from-rose-600 to-red-500')}>
            <div className="absolute -right-2 -bottom-4 text-7xl opacity-25">💰</div>
            <div className="font-bold">Lợi nhuận ngày {date(day)}</div>
            <div className="text-3xl font-extrabold mt-1">{money(sel.profit)}</div>
            <div className="text-sm opacity-90 mt-1">= Doanh thu {money(sel.revenue)} − Tiền vốn {money(sel.cost)}</div>
          </div>
        </div>

        <Card title={`Chi tiết tiền vốn ngày ${date(day)}`} icon="🧮" accent="from-violet-500 to-fuchsia-500" bodyClass="p-0">
          {detail.loading ? <Loading /> : detail.error ? <div className="p-4"><ErrorBox error={detail.error} /></div> : !detail.data.length
            ? <p className="p-4 text-slate-500">Ngày này chưa bán hàng.</p> : <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead><tr className="text-left text-slate-500 border-b">
                  <th className="px-4 py-2">Món</th><th className="px-2 py-2 text-right">Số kg bán</th>
                  <th className="px-2 py-2 text-right">Giá nhập/kg</th><th className="px-4 py-2 text-right">Vốn</th></tr></thead>
                <tbody>
                  {detail.data.map((r, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-4 py-2.5 font-semibold">{r.product_name}<div className="text-[11px] text-slate-500 font-normal">{r.product_code}</div></td>
                      <td className="px-2 py-2.5 text-right">{num(r.kg_sold, 3)} kg</td>
                      <td className="px-2 py-2.5 text-right">× {money(r.cost_per_kg)}{Number(r.cost_per_kg) === 0 && <div className="text-[11px] text-rose-600 font-bold">chưa có giá nhập</div>}</td>
                      <td className="px-4 py-2.5 text-right font-bold">{money(r.cost)}</td>
                    </tr>))}
                  <tr className="bg-violet-50"><td className="px-4 py-3 font-extrabold" colSpan={3}>Tổng tiền vốn</td>
                    <td className="px-4 py-3 text-right font-extrabold text-violet-700">{money(detail.data.reduce((a, r) => a + Number(r.cost), 0))}</td></tr>
                </tbody>
              </table>
            </div>
          </>}
        </Card>

        <Card title={`Lợi nhuận theo ngày · tháng ${day.slice(5, 7)}/${day.slice(0, 4)}`} icon="📈" accent="from-ruong-600 to-teal-500" bodyClass="p-0">
          <div className="grid grid-cols-2 gap-2 p-4">
            <div className="rounded-2xl bg-lua-50 p-3"><div className="text-xs font-semibold">Tổng doanh thu tháng</div><b className="text-lg text-lua-700">{money(sum('revenue'))}</b></div>
            <div className="rounded-2xl bg-ruong-50 p-3"><div className="text-xs font-semibold">Tổng lợi nhuận tháng</div><b className="text-lg text-ruong-700">{money(sum('profit'))}</b></div>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-4 py-2 text-xs font-bold text-slate-500 border-y"><span>Ngày</span><span className="text-right">Doanh thu</span><span className="text-right w-28">Lợi nhuận</span></div>
          <div className="divide-y">
            {[...month.data].reverse().map(r => (
              <button key={r.day} onClick={() => setDay(r.day)}
                className={cx('w-full grid grid-cols-[1fr_auto_auto] gap-x-3 items-center px-4 py-2.5 text-left', r.day === day ? 'bg-lua-100' : 'hover:bg-slate-50')}>
                <span>
                  <b>{WD[new Date(r.day + 'T12:00:00').getDay()]} {date(r.day).slice(0, 5)}</b>
                  <span className="block h-1.5 mt-1 rounded-full bg-gradient-to-r from-lua-400 to-orange-400" style={{ width: `${Number(r.revenue) / max * 100}%` }} />
                </span>
                <span className="text-right text-sm">{Number(r.revenue) ? money(r.revenue) : '—'}</span>
                <b className={cx('text-right w-28', Number(r.profit) < 0 ? 'text-rose-600' : Number(r.profit) ? 'text-ruong-700' : 'text-slate-400')}>{Number(r.revenue) ? money(r.profit) : '—'}</b>
              </button>))}
          </div>
        </Card>
        <p className="text-xs text-slate-600 bg-white/80 rounded-xl px-3 py-2">ℹ️ Tiền vốn = tổng (số kg bán của từng món × giá nhập/kg của món đó). Giá nhập lấy theo phiếu nhập gần nhất hoặc giá bạn sửa trong Sản phẩm, và được chốt tại lúc bán. Lợi nhuận ở đây <b>chưa trừ chi tiêu</b> (điện, nước, vận chuyển…), xem các khoản đó ở mục Chi tiêu. Hóa đơn đã hủy không được tính.</p>
      </>}
    </div>
  );
}
