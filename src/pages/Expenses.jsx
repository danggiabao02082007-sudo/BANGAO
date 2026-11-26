import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, date, digits, isoDay } from '../lib/format.js';
import { Card, Button, Input, Select, Field, Modal, Empty, Loading, ErrorBox, useLoad, useToast, Badge, useSelection, BulkBar, Check, cx } from '../components/ui.jsx';

import { downloadXlsx } from '../lib/excel.js';

const blank = () => ({ id: null, expense_date: isoDay(), name: '', amount: '', note: '', account_code: 'cash' });
const QUICK = ['Tiền điện', 'Tiền nước', 'Vận chuyển', 'Bốc xếp', 'Lương nhân viên', 'Thuê mặt bằng', 'Bao bì', 'Ăn uống'];

export default function Expenses({ profile }) {
  const toast = useToast();
  const [from, setFrom] = useState(isoDay().slice(0, 8) + '01');
  const [to, setTo] = useState(isoDay());
  const [form, setForm] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = useLoad(() => q(supabase.from('expenses').select('*, cash_accounts(code,name)').gte('expense_date', from).lte('expense_date', to)
    .order('expense_date', { ascending: false }).order('created_at', { ascending: false })), [from, to]);
  const sel = useSelection(); const owner = profile?.role === 'owner';
  const exportXlsx = async () => {
    try { const n = await downloadXlsx(`bonbien-chitieu-${from}-den-${to}`, [{ name: 'Chi tiêu', head: ['Ngày', 'Tên khoản chi', 'Số tiền', 'Quỹ', 'Ghi chú'],
      rows: [...list.data.map(x => [date(x.expense_date), x.name, +x.amount, x.cash_accounts?.name || '', x.note || '']), ['TỔNG', '', total, '', '']] }]); if (n) toast('Đã xuất ' + n); }
    catch (e) { toast(e.message, 'err'); }
  };
  const total = (list.data || []).reduce((a, x) => a + Number(x.amount), 0);
  const byDay = (list.data || []).reduce((m, x) => { (m[x.expense_date] ||= []).push(x); return m; }, {});

  const save = async e => {
    e.preventDefault(); setBusy(true);
    try {
      await rpc('save_expense', { p: { ...form, amount: Number(form.amount) } });
      toast(form.id ? 'Đã sửa khoản chi' : 'Đã thêm khoản chi'); setForm(null); list.reload();
    } catch (er) { toast(er.message, 'err'); }
    setBusy(false);
  };
  const remove = async () => {
    try { await rpc('delete_expense', { p_id: del.id }); toast('Đã xóa khoản chi'); setDel(null); list.reload(); }
    catch (er) { toast(er.message, 'err'); }
  };

  return (
    <div className="space-y-4">
      <Card title="Chi tiêu phát sinh" icon="💸" accent="from-orange-500 to-rose-500"
        right={<Button small color="ghost" onClick={() => setForm(blank())}>＋ Thêm khoản chi</Button>}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Từ ngày"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="Đến ngày"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        </div>
        <div className="mt-3 rounded-2xl p-4 text-white bg-gradient-to-r from-orange-500 to-rose-500 flex justify-between items-center">
          <span className="font-bold">Tổng chi tiêu ({(list.data || []).length} khoản)</span>
          <span className="text-2xl font-extrabold">{money(total)}</span>
        </div>
        <Button className="w-full mt-3 sm:hidden" color="rose" onClick={() => setForm(blank())}>＋ Thêm khoản chi</Button>
        {list.data?.length > 0 && <Button small color="ghost" className="mt-3 mr-2" onClick={exportXlsx}>📊 Xuất Excel</Button>}
        {owner && list.data && <BulkBar s={sel} kind="expense" noun="khoản chi" className="mt-3" onDone={list.reload}
          items={list.data.map(x => ({ id: x.id, label: `${x.name} · ${money(x.amount)} · ${date(x.expense_date)}` }))} />}
      </Card>

      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !list.data.length
        ? <Card><Empty icon="💸" text="Chưa có khoản chi nào trong khoảng ngày này" /></Card>
        : Object.entries(byDay).map(([d, rows]) => (
          <Card key={d} title={`📅 ${date(d)}`} accent="from-amber-500 to-orange-400"
            right={<Badge color="bg-white/30 text-white">{money(rows.reduce((a, x) => a + Number(x.amount), 0))}</Badge>} bodyClass="p-0">
            <div className="divide-y">
              {rows.map(x => (
                <div key={x.id} onClick={() => sel.on && sel.toggle(x.id)} className={cx('flex items-center gap-3 px-4 py-3', sel.on && 'cursor-pointer', sel.has(x.id) && 'bg-rose-50')}>
                  {sel.on && <Check checked={sel.has(x.id)} />}
                  <span className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-rose-400 grid place-items-center text-white text-lg">💸</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold">{x.name}</div>
                    <div className="text-xs text-slate-500">{x.cash_accounts?.name}{x.note && ' · ' + x.note}</div>
                  </div>
                  <b className="text-rose-600 whitespace-nowrap">{money(x.amount)}</b>
                  {!sel.on && <><button onClick={() => setForm({ id: x.id, expense_date: x.expense_date, name: x.name, amount: String(Math.round(x.amount)), note: x.note, account_code: x.cash_accounts?.code || 'cash' })}
                    className="w-9 h-9 rounded-full bg-sky-100 text-sky-700" aria-label="Sửa">✏️</button>
                  <button onClick={() => setDel(x)} className="w-9 h-9 rounded-full bg-rose-100 text-rose-600" aria-label="Xóa">🗑️</button></>}
                </div>))}
            </div>
          </Card>))}

      {form && (
        <Modal title={form.id ? 'Sửa khoản chi' : 'Thêm khoản chi'} onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-3">
            <Field label="Tên khoản chi *"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="vd: Tiền điện tháng 11" /></Field>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map(t => <button type="button" key={t} onClick={() => setForm({ ...form, name: t })}
                className="rounded-full px-3 py-1 text-xs font-bold bg-orange-50 text-orange-700 ring-1 ring-orange-200">{t}</button>)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Số tiền (đ) *"><Input inputMode="numeric" value={form.amount} onChange={e => setForm({ ...form, amount: digits(e.target.value) })} required /></Field>
              <Field label="Ngày chi"><Input type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></Field>
            </div>
            <Field label="Trả bằng"><Select value={form.account_code} onChange={e => setForm({ ...form, account_code: e.target.value })}>
              <option value="cash">Tiền mặt</option><option value="bank">Chuyển khoản</option></Select></Field>
            <Field label="Ghi chú"><Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Không bắt buộc" /></Field>
            <Button className="w-full" color="rose" disabled={busy || !form.name.trim() || !Number(form.amount)}>💾 {form.id ? 'Lưu thay đổi' : 'Thêm khoản chi'}</Button>
          </form>
        </Modal>)}
      {del && (
        <Modal title="Xóa khoản chi?" onClose={() => setDel(null)}>
          <p><b>{del.name}</b> · {money(del.amount)} · {date(del.expense_date)}</p>
          <p className="text-sm text-slate-500 mt-1">Khoản chi bị xóa khỏi danh sách và sổ quỹ. Nội dung cũ vẫn được lưu trong nhật ký hệ thống.</p>
          <div className="flex gap-2 mt-4"><Button color="ghost" className="flex-1" onClick={() => setDel(null)}>Hủy</Button>
            <Button color="rose" className="flex-1" onClick={remove}>🗑️ Xóa</Button></div>
        </Modal>)}
    </div>
  );
}
