import { useState } from 'react';
import { supabase, q, rpc } from '../lib/supabase.js';
import { money } from '../lib/format.js';
import { Card, Button, Input, Field, Modal, Empty, Loading, ErrorBox, useLoad, useToast, DeleteButton } from '../components/ui.jsx';

export default function Suppliers({ profile }) {
  const toast = useToast();
  const list = useLoad(() => q(supabase.from('v_suppliers').select('*').eq('is_active', true).order('name')), []);
  const [edit, setEdit] = useState(null);
  const save = async e => {
    e.preventDefault();
    const body = { name: edit.name.trim(), phone: (edit.phone || '').trim(), address: (edit.address || '').trim(), note: (edit.note || '').trim() };
    try { edit.id ? await q(supabase.from('suppliers').update(body).eq('id', edit.id)) : await q(supabase.from('suppliers').insert(body));
      toast('Đã lưu nhà cung cấp'); setEdit(null); list.reload(); } catch (er) { toast(er.message, 'err'); }
  };
  return (
    <div className="space-y-4">
      <Card title="Nhà cung cấp" icon="🏭" accent="from-indigo-500 to-violet-400" right={<Button small color="ghost" onClick={() => setEdit({ name: '' })}>＋ Thêm</Button>}>
        {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : list.data.length ? list.data.map(s => (
          <button key={s.id} onClick={() => setEdit(s)} className="w-full text-left flex justify-between py-3 border-b hover:bg-indigo-50">
            <span><b>{s.name}</b><div className="text-xs text-slate-500">{s.code} · {s.phone || '—'} · {s.address}</div></span>
            {Number(s.debt) > 0 && <b className="text-rose-600">Nợ {money(s.debt)}</b>}</button>)) : <Empty icon="🏭" text="Chưa có nhà cung cấp" />}
        <p className="text-xs text-slate-500 mt-3">Trả nợ NCC theo từng phiếu nhập: giai đoạn 2.</p>
      </Card>
      {edit && <Modal title={edit.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'} onClose={() => setEdit(null)}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Tên *"><Input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} required /></Field>
          <Field label="Số điện thoại"><Input value={edit.phone || ''} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="Địa chỉ"><Input value={edit.address || ''} onChange={e => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Field label="Ghi chú"><Input value={edit.note || ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></Field>
          <Button className="w-full">💾 Lưu</Button>
        </form>
        {edit.id && profile?.role === 'owner' && <DeleteButton title={`Xóa nhà cung cấp ${edit.name}?`} label="🗑️ Xóa nhà cung cấp" className="w-full mt-2"
          onConfirm={async () => { await rpc('delete_supplier', { p_id: edit.id }); toast(`Đã xóa ${edit.name}`); setEdit(null); list.reload(); }}>
          <p><b>{edit.name}</b> · {edit.code} · {edit.phone || '—'}</p>
          <p className="text-slate-500">Chỉ xóa được nhà cung cấp chưa có phiếu nhập. Nếu đã có, hãy xóa các phiếu đó trước.</p>
        </DeleteButton>}</Modal>}
    </div>
  );
}
