import { useState } from 'react';
import { supabase, q, rpc } from '../lib/supabase.js';
import { money, datetime, digits } from '../lib/format.js';
import { Card, Button, Input, Select, Field, Modal, Empty, Loading, ErrorBox, useLoad, useToast, DeleteButton, useSelection, BulkBar, Check, cx } from '../components/ui.jsx';

export default function Suppliers({ profile }) {
  const toast = useToast();
  const owner = profile?.role === 'owner'; const mgr = profile?.role !== 'staff';
  const list = useLoad(() => q(supabase.from('v_suppliers').select('*').eq('is_active', true).order('name')), []);
  const [edit, setEdit] = useState(null);
  const sel = useSelection();
  const save = async e => {
    e.preventDefault();
    const body = { name: edit.name.trim(), phone: (edit.phone || '').trim(), address: (edit.address || '').trim(), note: (edit.note || '').trim() };
    try { edit.id ? await q(supabase.from('suppliers').update(body).eq('id', edit.id)) : await q(supabase.from('suppliers').insert(body));
      toast('Đã lưu nhà cung cấp'); setEdit(null); list.reload(); } catch (er) { toast(er.message, 'err'); }
  };
  const close = () => { setEdit(null); list.reload(); };
  return (
    <div className="space-y-4">
      <Card title="Nhà cung cấp" icon="🏭" accent="from-indigo-500 to-violet-400" right={<Button small color="ghost" onClick={() => setEdit({ name: '' })}>＋ Thêm</Button>}>
        {owner && list.data && <BulkBar s={sel} kind="supplier" noun="nhà cung cấp" className="mb-2" onDone={list.reload}
          items={list.data.map(s => ({ id: s.id, label: `${s.code} · ${s.name}` }))} />}
        {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : list.data.length ? list.data.map(s => (
          <button key={s.id} onClick={() => sel.on ? sel.toggle(s.id) : setEdit(s)} className={cx('w-full text-left flex items-center gap-3 py-3 border-b', sel.has(s.id) ? 'bg-rose-50' : 'hover:bg-indigo-50')}>
            {sel.on && <Check checked={sel.has(s.id)} />}
            <span className="flex-1"><b>{s.name}</b><div className="text-xs text-slate-500">{s.code} · {s.phone || '—'} · {s.address}</div></span>
            {Number(s.debt) > 0 && <b className="text-rose-600">Nợ {money(s.debt)}</b>}</button>)) : <Empty icon="🏭" text="Chưa có nhà cung cấp" />}
        <p className="text-xs text-slate-500 mt-3">Bấm vào nhà cung cấp để sửa thông tin, trả nợ và xem sổ công nợ.</p>
      </Card>
      {edit && <Modal title={edit.id ? edit.name || 'Nhà cung cấp' : 'Thêm nhà cung cấp'} onClose={close} wide={!!edit.id}>
        {edit.id && <SupplierDebt s={edit} owner={owner} mgr={mgr} />}
        <form onSubmit={save} className="space-y-3">
          {edit.id && <h4 className="font-bold mt-4">✏️ Thông tin</h4>}
          <Field label="Tên *"><Input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} required /></Field>
          <Field label="Số điện thoại"><Input value={edit.phone || ''} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="Địa chỉ"><Input value={edit.address || ''} onChange={e => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Field label="Ghi chú"><Input value={edit.note || ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></Field>
          <Button className="w-full">💾 Lưu</Button>
        </form>
        {edit.id && owner && <DeleteButton title={`Xóa nhà cung cấp ${edit.name}?`} label="🗑️ Xóa nhà cung cấp" className="w-full mt-2"
          onConfirm={async () => { await rpc('delete_supplier', { p_id: edit.id }); toast(`Đã xóa ${edit.name}`); close(); }}>
          <p><b>{edit.name}</b> · {edit.code} · {edit.phone || '—'}</p>
          <p className="text-slate-500">Chỉ xóa được nhà cung cấp chưa có phiếu nhập. Nếu đã có, hãy xóa các phiếu đó trước.</p>
        </DeleteButton>}</Modal>}
    </div>
  );
}

// Trả nợ nhà cung cấp + sổ công nợ
function SupplierDebt({ s, owner, mgr }) {
  const toast = useToast();
  const [amt, setAmt] = useState(''); const [acc, setAcc] = useState('cash'); const [busy, setBusy] = useState(false);
  const d = useLoad(async () => {
    const [sup, ledger] = await Promise.all([
      q(supabase.from('v_suppliers').select('debt').eq('id', s.id).single()),
      q(supabase.from('receivable_payable_entries').select('*').eq('party_type', 'supplier').eq('party_id', s.id).order('entry_date', { ascending: false }).limit(100))]);
    return { debt: Number(sup.debt), ledger };
  }, [s.id]);
  const pay = async () => {
    setBusy(true);
    try { const r = await rpc('record_supplier_payment', { p_supplier: s.id, p_amount: Number(amt), p_account: acc, p_note: '' });
      toast(`Đã trả nợ ${money(amt)} (${r.payment_code})`); setAmt(''); d.reload(); }
    catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  if (d.loading) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} />;
  return (<>
    <div className="rounded-2xl bg-rose-50 p-3 text-sm">Còn nợ nhà cung cấp<br /><b className="text-lg text-rose-600">{money(d.data.debt)}</b></div>
    {mgr && d.data.debt > 0 && <div className="mt-3 rounded-2xl ring-2 ring-indigo-300 p-3">
      <b>💸 Trả nợ</b> <span className="text-xs text-slate-500">(trừ dần vào phiếu nhập nợ cũ nhất · không tính vào chi tiêu vì đã nằm trong vốn)</span>
      <div className="flex gap-2 mt-2">
        <Input inputMode="numeric" value={amt} onChange={e => setAmt(digits(e.target.value))} placeholder="Số tiền" />
        <Select value={acc} onChange={e => setAcc(e.target.value)} className="!w-40"><option value="cash">Tiền mặt</option><option value="bank">Chuyển khoản</option></Select>
      </div>
      <div className="flex gap-2 mt-2"><Button small color="ghost" onClick={() => setAmt(String(Math.round(d.data.debt)))}>Trả hết</Button>
        <Button small color="sky" onClick={pay} disabled={busy || !Number(amt)}>Ghi nhận trả nợ</Button></div>
    </div>}
    <h4 className="font-bold mt-4 mb-1">📒 Sổ công nợ</h4>
    {d.data.ledger.length ? d.data.ledger.map(e => <div key={e.id} className="flex justify-between items-center gap-2 py-1.5 border-b text-sm">
      <span className="flex-1">{datetime(e.entry_date)} · {e.note}</span>
      <b className={e.amount > 0 ? 'text-rose-600' : 'text-ruong-700'}>{e.amount > 0 ? '+' : ''}{money(e.amount)}</b>
      {owner && e.ref_table === 'payments' && <DeleteButton icon title="Xóa lần trả nợ này?"
        onConfirm={async () => { await rpc('delete_supplier_payment', { p_id: e.ref_id }); toast('Đã xóa lần trả nợ, công nợ đã cộng lại'); d.reload(); }}>
        <p><b>{e.note}</b> · {money(-e.amount)} · {datetime(e.entry_date)}</p>
        <p>Khoản chi bị gỡ khỏi sổ quỹ, nợ nhà cung cấp cộng lại như trước khi trả.</p>
      </DeleteButton>}</div>) : <Empty text="Chưa có công nợ" />}
  </>);
}
