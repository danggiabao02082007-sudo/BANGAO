import { useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { money, isoDay } from '../lib/format.js';
import { Card, Input, Field, Loading, ErrorBox, useLoad } from '../components/ui.jsx';

export default function Reports() {
  const now = isoDay();
  const [from, setFrom] = useState(now.slice(0, 8) + '01'); const [to, setTo] = useState(now);
  const r = useLoad(() => rpc('profit_report', { p_from: from, p_to: to }), [from, to]);
  const rows = r.data && [
    ['🌾 Doanh thu', r.data.revenue, 'from-lua-400 to-orange-400'], ['📦 Giá vốn hàng bán (FIFO)', -r.data.cogs, 'from-slate-400 to-slate-500'],
    ['📈 Lợi nhuận gộp', r.data.gross_profit, 'from-ruong-500 to-lime-400'], ['🧾 Chi phí vận hành', -r.data.operating_expenses, 'from-rose-400 to-pink-500'],
    ['🏆 Lợi nhuận ròng', r.data.net_profit, 'from-violet-500 to-fuchsia-500']];
  return (
    <Card title="Báo cáo lợi nhuận" icon="📊" accent="from-orange-500 to-red-400">
      <div className="grid grid-cols-2 gap-2"><Field label="Từ ngày"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="Đến ngày"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></div>
      {r.loading ? <Loading /> : r.error ? <ErrorBox error={r.error} /> : <div className="mt-4 space-y-2">
        {rows.map(([l, v, g]) => <div key={l} className={`rounded-2xl p-4 text-white bg-gradient-to-r ${g} flex justify-between font-bold`}><span>{l}</span><span>{money(v)}</span></div>)}
      </div>}
      <p className="text-xs text-slate-500 mt-3">Chi phí vận hành = vận chuyển + nhân công + điện nước + chi khác. Báo cáo chi tiết theo sản phẩm và xuất Excel/PDF: giai đoạn 3.</p>
    </Card>
  );
}
