import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, num, datetime, isoDay } from '../lib/format.js';
import { Card, Button, Input, Modal, Badge, Empty, Loading, ErrorBox, useLoad, useToast, Table, Field, Select } from '../components/ui.jsx';
import PrintInvoice from '../components/Print.jsx';

export default function Invoices({ profile }) {
  const today = isoDay();
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(today);
  const [s, setS] = useState('');
  const [st, setSt] = useState('');
  const [open, setOpen] = useState(null);
  const list = useLoad(() => {
    let x = supabase.from('sales_invoices').select('*').gte('invoice_date', from + 'T00:00:00+07:00').lte('invoice_date', to + 'T23:59:59+07:00')
      .order('invoice_date', { ascending: false }).limit(500);
    if (st) x = x.eq('status', st);
    if (st === 'debt') x = supabase.from('sales_invoices').select('*').gt('debt_remaining', 0).eq('status', 'completed').order('invoice_date');
    return q(x);
  }, [from, to, st]);
  const rows = (list.data || []).filter(i => !s || i.invoice_code.toLowerCase().includes(s.toLowerCase()) || i.customer_name.toLowerCase().includes(s.toLowerCase()));
  const ok = rows.filter(i => i.status === 'completed');
  return (
    <div className="space-y-4">
      <Card title="Tra cứu hóa đơn" icon="🔎" accent="from-teal-500 to-emerald-400">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label="Từ ngày"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="Đến ngày"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
          <Field label="Trạng thái"><Select value={st} onChange={e => setSt(e.target.value)}>
            <option value="">Tất cả</option><option value="completed">Hoàn thành</option><option value="cancelled">Đã hủy</option><option value="debt">Còn nợ (mọi ngày)</option></Select></Field>
          <Field label="Tìm"><Input value={s} onChange={e => setS(e.target.value)} placeholder="Mã HĐ / tên khách" /></Field>
        </div>
        <div className="flex flex-wrap gap-2 mt-3 text-sm">
          <Badge>{ok.length} hóa đơn</Badge><Badge color="bg-lua-100 text-lua-700">Doanh thu {money(ok.reduce((a, i) => a + Number(i.total_amount), 0))}</Badge>
          <Badge color="bg-rose-100 text-rose-700">Còn nợ {money(ok.reduce((a, i) => a + Number(i.debt_remaining), 0))}</Badge>
        </div>
      </Card>
      <Card bodyClass="p-0 sm:p-4">
        {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !rows.length ? <Empty text="Không có hóa đơn" /> : (
          <div className="divide-y">
            {rows.map(i => (
              <button key={i.id} onClick={() => setOpen(i.id)} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-ruong-50">
                <span className="text-2xl">{i.status === 'cancelled' ? '🚫' : i.debt_remaining > 0 ? '📒' : '🧾'}</span>
                <div className="flex-1 min-w-0"><div className="font-bold">{i.invoice_code} · {i.customer_name}</div>
                  <div className="text-xs text-slate-500">{datetime(i.invoice_date)}</div></div>
                <div className="text-right"><b className={i.status === 'cancelled' ? 'line-through text-slate-400' : 'text-ruong-700'}>{money(i.total_amount)}</b>
                  {i.status === 'cancelled' ? <div><Badge color="bg-slate-200 text-slate-600">Đã hủy</Badge></div>
                    : i.debt_remaining > 0 && <div className="text-xs text-rose-600 font-bold">Nợ {money(i.debt_remaining)}</div>}</div>
              </button>))}
          </div>)}
      </Card>
      {open && <InvoiceDetail id={open} profile={profile} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}

export function InvoiceDetail({ id, profile, onClose, onChanged }) {
  const toast = useToast();
  const [print, setPrint] = useState(null);
  const [reason, setReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const d = useLoad(async () => {
    const [i, items, store] = await Promise.all([
      q(supabase.from('sales_invoices').select('*').eq('id', id).single()),
      q(supabase.from('sales_invoice_items').select('*').eq('invoice_id', id).order('line_no')),
      q(supabase.from('store_settings').select('*').single())]);
    return { i, items, store };
  }, [id]);
  const cancel = async () => {
    try { await rpc('cancel_sales_invoice', { p_id: id, p_reason: reason }); toast('Đã hủy hóa đơn, hàng đã nhập lại kho'); d.reload(); onChanged(); setCancelOpen(false); }
    catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Chi tiết hóa đơn" onClose={onClose} wide>
      {d.loading ? <Loading /> : d.error ? <ErrorBox error={d.error} /> : (() => {
        const { i, items } = d.data;
        return (<>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-extrabold flex-1">{i.invoice_code}</h3>
            {i.status === 'cancelled' ? <Badge color="bg-slate-200 text-slate-700">Đã hủy</Badge> : <Badge>Hoàn thành</Badge>}
            {i.price_tier === 'wholesale' && <Badge color="bg-violet-100 text-violet-700">Giá sỉ</Badge>}
          </div>
          <p className="text-sm text-slate-600">{datetime(i.invoice_date)} · Khách: <b>{i.customer_name}</b></p>
          {i.status === 'cancelled' && <p className="text-sm text-rose-600 mt-1">Lý do hủy: {i.cancel_reason} ({datetime(i.cancelled_at)})</p>}
          <div className="mt-3"><Table head={['Mã', 'Tên hàng', 'SL', { t: 'Đơn giá', r: 1 }, { t: 'Giảm', r: 1 }, { t: 'Thành tiền', r: 1 }]}>
            {items.map(it => <tr key={it.id}><td className="text-xs">{it.product_code}</td><td className="font-semibold">{it.product_name}</td>
              <td>{num(it.quantity, 3)} {it.unit_name}<div className="text-[11px] text-slate-500">{num(it.base_qty, 3)} bao</div></td>
              <td className="text-right">{money(it.unit_price)}{Number(it.unit_price) !== Number(it.list_price) && <div className="text-[11px] text-lua-700">niêm yết {money(it.list_price)}</div>}</td>
              <td className="text-right">{money(it.discount)}</td><td className="text-right font-bold">{money(it.line_total)}</td></tr>)}
          </Table></div>
          <div className="mt-3 rounded-2xl bg-lua-50 p-3 grid grid-cols-2 gap-1 text-sm">
            <span>Tạm tính</span><b className="text-right">{money(i.subtotal)}</b>
            <span>Giảm giá HĐ</span><b className="text-right">{money(i.discount)}</b>
            <span className="text-base">Tổng thanh toán</span><b className="text-right text-base text-ruong-700">{money(i.total_amount)}</b>
            <span>Đã trả lúc mua</span><b className="text-right">{money(i.paid_amount)}</b>
            <span>Nợ phát sinh / còn lại</span><b className="text-right text-rose-600">{money(i.debt_amount)} / {money(i.debt_remaining)}</b>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button color="gold" onClick={() => setPrint('k80')}>🖨️ In K80</Button>
            <Button color="sky" onClick={() => setPrint('a5')}>🖨️ In A5</Button>
            {i.status === 'completed' && profile.role !== 'staff' && <Button color="danger" onClick={() => setCancelOpen(true)}>🚫 Hủy hóa đơn</Button>}
          </div>
          {cancelOpen && <div className="mt-4 rounded-2xl ring-2 ring-rose-300 p-3">
            <p className="text-sm">Hủy sẽ <b>nhập lại hàng vào đúng lô cũ</b>, hoàn tiền khỏi quỹ, xóa khoản nợ. Hóa đơn vẫn được lưu với trạng thái “Đã hủy”.</p>
            <Field label="Lý do hủy (bắt buộc)" className="mt-2"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>
            <Button color="rose" className="mt-2" onClick={cancel} disabled={!reason.trim()}>Xác nhận hủy</Button>
          </div>}
          {print && <PrintInvoice inv={i} items={items} store={d.data.store} size={print} onDone={() => setPrint(null)} />}
        </>);
      })()}
    </Modal>
  );
}
