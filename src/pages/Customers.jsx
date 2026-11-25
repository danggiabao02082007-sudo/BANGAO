import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, datetime, digits } from '../lib/format.js';
import { Card, Button, Input, Select, Modal, Badge, Empty, Loading, ErrorBox, useLoad, useToast, Field } from '../components/ui.jsx';
import { InvoiceDetail } from './Invoices.jsx';

export function CustomerForm({ initial, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(initial || { name: '', phone: '', address: '', customer_type: 'le', note: '' });
  const [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const save = async e => {
    e.preventDefault(); setBusy(true);
    try {
      const body = { name: f.name.trim(), phone: f.phone.trim(), address: f.address.trim(), customer_type: f.customer_type, note: f.note.trim() };
      const r = initial ? await q(supabase.from('customers').update(body).eq('id', initial.id).select('id,name').single())
        : await q(supabase.from('customers').insert(body).select('id,name,code').single());
      toast('Đã lưu khách hàng'); onSaved(r);
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="Tên khách hàng *"><Input value={f.name} onChange={set('name')} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Số điện thoại"><Input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Loại khách" hint="Khách sỉ tự áp giá sỉ"><Select value={f.customer_type} onChange={set('customer_type')}><option value="le">Lẻ</option><option value="si">Sỉ</option></Select></Field>
      </div>
      <Field label="Địa chỉ"><Input value={f.address} onChange={set('address')} /></Field>
      <Field label="Ghi chú"><Input value={f.note} onChange={set('note')} /></Field>
      <Button className="w-full" disabled={busy}>💾 Lưu</Button>
    </form>
  );
}

export default function Customers({ profile }) {
  const [s, setS] = useState(''); const [onlyDebt, setOnlyDebt] = useState(false);
  const [edit, setEdit] = useState(null); const [view, setView] = useState(null);
  const list = useLoad(() => q(supabase.from('v_customers').select('*').eq('is_active', true).order('name')), []);
  const rows = (list.data || []).filter(c => (!onlyDebt || Number(c.debt) > 0) &&
    (!s || [c.name, c.phone, c.code].some(x => x.toLowerCase().includes(s.toLowerCase()))));
  return (
    <div className="space-y-4">
      <Card title="Danh sách khách hàng" icon="👨‍🌾" accent="from-pink-500 to-rose-400" right={<Button small color="ghost" onClick={() => setEdit({})}>＋ Thêm</Button>}>
        <div className="flex gap-2 items-center">
          <Input value={s} onChange={e => setS(e.target.value)} placeholder="🔎 Tên, SĐT, mã khách" />
          <label className="flex items-center gap-1 text-sm font-semibold whitespace-nowrap"><input type="checkbox" checked={onlyDebt} onChange={e => setOnlyDebt(e.target.checked)} /> Còn nợ</label>
        </div>
        <div className="mt-2 text-sm"><Badge color="bg-rose-100 text-rose-700">Tổng nợ phải thu {money(rows.reduce((a, c) => a + Number(c.debt), 0))}</Badge></div>
      </Card>
      <Card bodyClass="p-0">
        {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !rows.length ? <Empty text="Chưa có khách hàng" /> : (
          <div className="divide-y">{rows.map(c => (
            <button key={c.id} onClick={() => setView(c)} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-pink-50">
              <span className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-lua-400 grid place-items-center text-white font-bold">{c.name[0]}</span>
              <div className="flex-1 min-w-0"><div className="font-bold">{c.name} {c.customer_type === 'si' && <Badge color="bg-violet-100 text-violet-700">Sỉ</Badge>}</div>
                <div className="text-xs text-slate-500">{c.code} · {c.phone || 'chưa có SĐT'} · đã mua {money(c.total_bought)}</div></div>
              {Number(c.debt) > 0 && <b className="text-rose-600">{money(c.debt)}</b>}
            </button>))}</div>)}
      </Card>
      {edit && <Modal title={edit.id ? 'Sửa khách hàng' : 'Thêm khách hàng'} onClose={() => setEdit(null)}>
        <CustomerForm initial={edit.id ? edit : null} onSaved={() => { setEdit(null); list.reload(); }} /></Modal>}
      {view && <CustomerView c={view} profile={profile} onClose={() => { setView(null); list.reload(); }} onEdit={() => { setEdit(view); setView(null); }} />}
    </div>
  );
}

function CustomerView({ c, profile, onClose, onEdit }) {
  const toast = useToast();
  const [amt, setAmt] = useState(''); const [acc, setAcc] = useState('cash'); const [busy, setBusy] = useState(false); const [inv, setInv] = useState(null);
  const d = useLoad(async () => {
    const [cust, invs, ledger] = await Promise.all([
      q(supabase.from('v_customers').select('*').eq('id', c.id).single()),
      q(supabase.from('sales_invoices').select('id,invoice_code,invoice_date,total_amount,debt_remaining,status').eq('customer_id', c.id).order('invoice_date', { ascending: false }).limit(100)),
      q(supabase.from('receivable_payable_entries').select('*').eq('party_type', 'customer').eq('party_id', c.id).order('entry_date', { ascending: false }).limit(100))]);
    return { cust, invs, ledger };
  }, [c.id]);
  const collect = async () => {
    setBusy(true);
    try { const r = await rpc('record_customer_payment', { p_customer: c.id, p_amount: Number(amt), p_account: acc, p_note: '' });
      toast(`Đã thu nợ ${money(amt)} (${r.payment_code})`); setAmt(''); d.reload(); }
    catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={c.name} onClose={onClose} wide>
      {d.loading ? <Loading /> : d.error ? <ErrorBox error={d.error} /> : <>
        <div className="grid sm:grid-cols-3 gap-2 text-sm">
          <div className="rounded-2xl bg-ruong-50 p-3">Mã: <b>{d.data.cust.code}</b><br />SĐT: {d.data.cust.phone || '—'}<br />{d.data.cust.address}</div>
          <div className="rounded-2xl bg-lua-50 p-3">Tổng mua<br /><b className="text-lg">{money(d.data.cust.total_bought)}</b></div>
          <div className="rounded-2xl bg-rose-50 p-3">Công nợ hiện tại<br /><b className="text-lg text-rose-600">{money(d.data.cust.debt)}</b></div>
        </div>
        {Number(d.data.cust.debt) > 0 && <div className="mt-3 rounded-2xl ring-2 ring-ruong-300 p-3">
          <b>💵 Thu nợ</b> <span className="text-xs text-slate-500">(trừ dần vào hóa đơn cũ nhất · không tính vào doanh thu)</span>
          <div className="flex gap-2 mt-2">
            <Input inputMode="numeric" value={amt} onChange={e => setAmt(digits(e.target.value))} placeholder="Số tiền" />
            <Select value={acc} onChange={e => setAcc(e.target.value)} className="!w-40"><option value="cash">Tiền mặt</option><option value="bank">Chuyển khoản</option></Select>
          </div>
          <div className="flex gap-2 mt-2"><Button small color="ghost" onClick={() => setAmt(String(Math.round(d.data.cust.debt)))}>Thu hết</Button>
            <Button small onClick={collect} disabled={busy || !Number(amt)}>Ghi nhận thu nợ</Button></div>
        </div>}
        <h4 className="font-bold mt-4 mb-1">🧾 Lịch sử mua hàng</h4>
        {d.data.invs.length ? d.data.invs.map(i => (
          <button key={i.id} onClick={() => setInv(i.id)} className="w-full flex justify-between py-2 border-b text-sm hover:bg-slate-50">
            <span>{i.invoice_code} · {datetime(i.invoice_date)} {i.status === 'cancelled' && <Badge color="bg-slate-200">Hủy</Badge>}</span>
            <span><b>{money(i.total_amount)}</b>{i.debt_remaining > 0 && <span className="text-rose-600"> · nợ {money(i.debt_remaining)}</span>}</span></button>))
          : <Empty text="Chưa mua hàng" />}
        <h4 className="font-bold mt-4 mb-1">📒 Sổ công nợ</h4>
        {d.data.ledger.map(e => <div key={e.id} className="flex justify-between py-1.5 border-b text-sm"><span>{datetime(e.entry_date)} · {e.note}</span>
          <b className={e.amount > 0 ? 'text-rose-600' : 'text-ruong-700'}>{e.amount > 0 ? '+' : ''}{money(e.amount)}</b></div>)}
        <Button color="ghost" className="mt-4" onClick={onEdit}>✏️ Sửa thông tin</Button>
      </>}
      {inv && <InvoiceDetail id={inv} profile={profile} onClose={() => setInv(null)} onChanged={d.reload} />}
    </Modal>
  );
}
