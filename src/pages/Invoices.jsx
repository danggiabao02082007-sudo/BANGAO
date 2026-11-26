import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, num, datetime, isoDay } from '../lib/format.js';
import { cx, Card, Button, Input, Modal, Badge, Empty, Loading, ErrorBox, useLoad, useToast, Table, Field, Select, DeleteButton, useSelection, BulkBar, Check } from '../components/ui.jsx';
import { downloadXlsx } from '../lib/excel.js';
import PrintInvoice from '../components/Print.jsx';

// Hình thức thanh toán: chuyển khoản / tiền mặt / ghi nợ (chưa trả đồng nào)
export const payKind = i => Number(i.paid_amount) === 0 && Number(i.total_amount) > 0 ? 'debt' : i.cash_accounts?.code === 'bank' ? 'bank' : 'cash';
export const PAY = {
  cash: { label: '💵 Tiền mặt', badge: 'bg-emerald-100 text-emerald-800', row: 'border-l-emerald-500', tint: '' },
  bank: { label: '🏦 Chuyển khoản', badge: 'bg-sky-100 text-sky-800', row: 'border-l-sky-500', tint: 'bg-sky-50/80' },
  debt: { label: '📒 Ghi nợ', badge: 'bg-rose-100 text-rose-700', row: 'border-l-rose-400', tint: 'bg-rose-50/50' }
};

export default function Invoices({ profile }) {
  const today = isoDay();
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(today);
  const [s, setS] = useState('');
  const [st, setSt] = useState(''); const [pk, setPk] = useState('');
  const [open, setOpen] = useState(null);
  const list = useLoad(() => {
    let x = supabase.from('sales_invoices').select('*, cash_accounts(code,name)').gte('invoice_date', from + 'T00:00:00+07:00').lte('invoice_date', to + 'T23:59:59+07:00')
      .order('invoice_date', { ascending: false }).limit(500);
    if (st) x = x.eq('status', st);
    if (st === 'debt') x = supabase.from('sales_invoices').select('*, cash_accounts(code,name)').gt('debt_remaining', 0).eq('status', 'completed').order('invoice_date');
    return q(x);
  }, [from, to, st]);
  const rows = (list.data || []).filter(i => !pk || payKind(i) === pk).filter(i => !s || i.invoice_code.toLowerCase().includes(s.toLowerCase()) || i.customer_name.toLowerCase().includes(s.toLowerCase()));
  const ok = rows.filter(i => i.status === 'completed');
  const sel = useSelection();
  const toast = useToast();
  const exportXlsx = async () => {
    try {
      const ids = rows.map(i => i.id); const items = [];
      for (let k = 0; k < ids.length; k += 150) items.push(...await q(supabase.from('sales_invoice_items').select('*').in('invoice_id', ids.slice(k, k + 150)).order('line_no')));
      const code = Object.fromEntries(rows.map(i => [i.id, i]));
      const n = await downloadXlsx(`bonbien-hoadon-${from}-den-${to}`, [
        { name: 'Hóa đơn', head: ['Mã HĐ', 'Ngày', 'Khách', 'Trạng thái', 'Hình thức', 'Tạm tính', 'Giảm giá', 'Tổng', 'Đã trả lúc mua', 'Còn nợ', 'Ghi chú'],
          rows: rows.map(i => [i.invoice_code, datetime(i.invoice_date), i.customer_name, i.status === 'cancelled' ? 'Đã hủy' : 'Hoàn thành', PAY[payKind(i)].label.slice(3), +i.subtotal, +i.discount, +i.total_amount, +i.paid_amount, +i.debt_remaining, i.note || '']) },
        { name: 'Chi tiết hàng', head: ['Mã HĐ', 'Ngày', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn vị', 'Quy ra đơn vị tồn kho', 'Đơn giá', 'Giảm', 'Thành tiền'],
          rows: items.map(it => [code[it.invoice_id]?.invoice_code, datetime(code[it.invoice_id]?.invoice_date), it.product_code, it.product_name, +it.quantity, it.unit_name, +it.base_qty, +it.unit_price, +it.discount, +it.line_total]) }]);
      if (n) toast('Đã xuất ' + n);
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="space-y-4">
      <Card title="Tra cứu hóa đơn" icon="🔎" accent="from-teal-500 to-emerald-400" right={rows.length > 0 && <Button small color="ghost" onClick={exportXlsx}>📊 Excel</Button>}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Field label="Từ ngày"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="Đến ngày"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
          <Field label="Trạng thái"><Select value={st} onChange={e => setSt(e.target.value)}>
            <option value="">Tất cả</option><option value="completed">Hoàn thành</option><option value="cancelled">Đã hủy</option><option value="debt">Còn nợ (mọi ngày)</option></Select></Field>
          <Field label="Hình thức"><Select value={pk} onChange={e => setPk(e.target.value)}>
            <option value="">Tất cả</option><option value="cash">💵 Tiền mặt</option><option value="bank">🏦 Chuyển khoản</option><option value="debt">📒 Ghi nợ</option></Select></Field>
          <Field label="Tìm"><Input value={s} onChange={e => setS(e.target.value)} placeholder="Mã HĐ / tên khách" /></Field>
        </div>
        <div className="flex flex-wrap gap-2 mt-3 text-sm">
          <Badge>{ok.length} hóa đơn</Badge><Badge color="bg-lua-100 text-lua-700">Doanh thu {money(ok.reduce((a, i) => a + Number(i.total_amount), 0))}</Badge>
          <Badge color="bg-rose-100 text-rose-700">Còn nợ {money(ok.reduce((a, i) => a + Number(i.debt_remaining), 0))}</Badge>
          <Badge color={PAY.cash.badge}>💵 Tiền mặt {money(ok.filter(i => i.cash_accounts?.code !== 'bank').reduce((a, i) => a + Number(i.paid_amount), 0))}</Badge>
          <Badge color={PAY.bank.badge}>🏦 Chuyển khoản {money(ok.filter(i => i.cash_accounts?.code === 'bank').reduce((a, i) => a + Number(i.paid_amount), 0))}</Badge>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">Số tiền mặt / chuyển khoản ở đây là tiền khách trả lúc mua của các hóa đơn đang hiện. Tiền thu nợ sau đó xem ở trang Doanh thu & lợi nhuận.</p>
        {profile.role === 'owner' && <BulkBar s={sel} kind="invoice" noun="hóa đơn" className="mt-3" onDone={list.reload}
          items={rows.map(i => ({ id: i.id, label: `${i.invoice_code} · ${i.customer_name} · ${money(i.total_amount)}${i.status === 'cancelled' ? ' (đã hủy)' : ''}` }))} />}
      </Card>
      <Card bodyClass="p-0 sm:p-4">
        {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !rows.length ? <Empty text="Không có hóa đơn" /> : (
          <div className="divide-y">
            {rows.map(i => (
              <button key={i.id} onClick={() => sel.on ? sel.toggle(i.id) : setOpen(i.id)} className={cx('w-full text-left flex items-center gap-3 px-4 py-3 border-l-4', i.status === 'cancelled' ? 'border-l-slate-300' : PAY[payKind(i)].row,
                sel.has(i.id) ? 'bg-rose-50' : cx(i.status !== 'cancelled' && PAY[payKind(i)].tint, 'hover:bg-ruong-50'))}>
                {sel.on && <Check checked={sel.has(i.id)} />}
                <span className="text-2xl">{i.status === 'cancelled' ? '🚫' : i.debt_remaining > 0 ? '📒' : '🧾'}</span>
                <div className="flex-1 min-w-0"><div className="font-bold">{i.invoice_code} · {i.customer_name}</div>
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">{datetime(i.invoice_date)}
                    {i.status !== 'cancelled' && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', PAY[payKind(i)].badge)}>{PAY[payKind(i)].label}</span>}</div></div>
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
      q(supabase.from('sales_invoices').select('*, cash_accounts(code,name)').eq('id', id).single()),
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
            <Badge color={PAY[payKind(i)].badge}>{PAY[payKind(i)].label}</Badge>
            {i.price_tier === 'wholesale' && <Badge color="bg-violet-100 text-violet-700">Giá sỉ</Badge>}
          </div>
          <p className="text-sm text-slate-600">{datetime(i.invoice_date)} · Khách: <b>{i.customer_name}</b></p>
          {i.status === 'cancelled' && <p className="text-sm text-rose-600 mt-1">Lý do hủy: {i.cancel_reason} ({datetime(i.cancelled_at)})</p>}
          <div className="mt-3"><Table head={[{ t: 'Mã', sm: 1 }, { t: 'Tên hàng', cls: '!pl-4' }, 'SL', { t: 'Đơn giá', r: 1 }, { t: 'Giảm', r: 1, sm: 1 }, { t: 'Thành tiền', r: 1 }]}>
            {items.map(it => <tr key={it.id}><td className="text-xs hidden sm:table-cell">{it.product_code}</td>
              <td className="font-semibold !pl-4 sm:!pl-4">{it.product_name}<div className="sm:hidden text-[11px] font-normal text-slate-500">{it.product_code}{Number(it.discount) > 0 && ` · giảm ${money(it.discount)}`}</div></td>
              <td>{num(it.quantity, 3)} {it.unit_name}{Number(it.conversion_factor) !== 1 && <div className="text-[11px] text-slate-500">{num(it.base_qty, 3)} bao</div>}</td>
              <td className="text-right">{money(it.unit_price)}{Number(it.unit_price) !== Number(it.list_price) && <div className="text-[11px] text-lua-700">niêm yết {money(it.list_price)}</div>}</td>
              <td className="text-right hidden sm:table-cell">{money(it.discount)}</td><td className="text-right font-bold">{money(it.line_total)}</td></tr>)}
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
            {profile.role === 'owner' && <DeleteButton title={`Xóa hóa đơn ${i.invoice_code}?`} label="🗑️ Xóa hóa đơn (nhập sai)"
              onConfirm={async () => { await rpc('delete_sales_invoice', { p_id: id }); toast(`Đã xóa hóa đơn ${i.invoice_code}`); onChanged(); onClose(); }}>
              <p><b>{i.invoice_code}</b> · {i.customer_name} · {money(i.total_amount)}</p>
              <p>Hóa đơn bị xóa hẳn khỏi danh sách và báo cáo.{i.status === 'completed' && ' Hàng được trả lại đúng lô trong kho.'} Khoản tiền đã thu bị gỡ khỏi sổ quỹ, công nợ của hóa đơn bị gỡ.</p>
              <p className="text-slate-500">Khác với “Hủy hóa đơn”: hủy thì vẫn giữ lại hóa đơn với trạng thái “Đã hủy”.</p>
            </DeleteButton>}
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
