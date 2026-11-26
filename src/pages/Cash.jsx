import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, datetime, digits, isoDay } from '../lib/format.js';
import { Card, Button, Input, Select, Field, Empty, Loading, ErrorBox, useLoad, useToast, Badge, cx, DeleteButton } from '../components/ui.jsx';

export default function Cash({ profile }) {
  const toast = useToast();
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 864e5))); const [to, setTo] = useState(isoDay());
  const [f, setF] = useState({ direction: 'in', category: 'other_in', amount: '', account: 'cash', party: '', note: '' });
  const cats = useLoad(() => q(supabase.from('expense_categories').select('*')), []);
  const rows = useLoad(() => q(supabase.from('cash_transactions').select('*, cash_accounts(name)').gte('txn_date', from + 'T00:00:00+07:00')
    .lte('txn_date', to + 'T23:59:59+07:00').order('txn_date', { ascending: false }).limit(500)), [from, to]);
  const manual = (cats.data || []).filter(c => ['other_in', 'transport', 'labor', 'utility', 'other_out'].includes(c.code) && c.direction === f.direction);
  const name = Object.fromEntries((cats.data || []).map(c => [c.code, c.name]));
  const save = async () => {
    try { await rpc('record_cash', { p_direction: f.direction, p_category: f.category, p_amount: Number(f.amount), p_account: f.account, p_party: f.party, p_note: f.note });
      toast('Đã ghi sổ quỹ'); setF({ ...f, amount: '', party: '', note: '' }); rows.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const tin = (rows.data || []).filter(r => r.direction === 'in').reduce((a, r) => a + Number(r.amount), 0);
  const tout = (rows.data || []).filter(r => r.direction === 'out').reduce((a, r) => a + Number(r.amount), 0);
  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-4 items-start">
      <Card title="Ghi thu khác" icon="✍️" accent="from-fuchsia-500 to-purple-400">
        <div className="grid grid-cols-1 gap-2">
          {[['in', '💵 Ghi thu khác', 'other_in']].map(([d, t, c]) => (
            <button key={d} onClick={() => setF({ ...f, direction: d, category: c })} className={cx('rounded-2xl py-2 font-bold',
              f.direction === d ? (d === 'in' ? 'bg-gradient-to-r from-ruong-600 to-lime-500 text-white' : 'bg-gradient-to-r from-orange-500 to-rose-500 text-white') : 'bg-slate-100')}>{t}</button>))}
        </div>
        <Field label="Danh mục" className="mt-3"><Select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{manual.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
        <Field label="Số tiền (đ)" className="mt-2"><Input inputMode="numeric" value={f.amount} onChange={e => setF({ ...f, amount: digits(e.target.value) })} /></Field>
        <Field label="Quỹ" className="mt-2"><Select value={f.account} onChange={e => setF({ ...f, account: e.target.value })}><option value="cash">Tiền mặt</option><option value="bank">Ngân hàng</option></Select></Field>
        <Field label="Đối tượng" className="mt-2"><Input value={f.party} onChange={e => setF({ ...f, party: e.target.value })} /></Field>
        <Field label="Ghi chú" className="mt-2"><Input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
        <Button className="w-full mt-3" color="violet" onClick={save} disabled={!Number(f.amount)}>💾 Ghi sổ</Button>
        <p className="text-xs text-slate-500 mt-2">Thu bán hàng, thu nợ, chi nhập hàng được ghi tự động. Các khoản chi (điện, nước, vận chuyển…) ghi ở mục <b>💸 Chi tiêu</b> và tự hiện trong sổ quỹ.</p>
        <p className="text-xs text-slate-500 mt-1">Nút 🗑️ chỉ có ở khoản ghi tay. Khoản tự động thì xóa từ hóa đơn/phiếu gốc, khoản chi thì xóa ở mục Chi tiêu.</p>
      </Card>
      <Card title="Sổ quỹ" icon="📒" accent="from-purple-500 to-pink-500">
        <div className="grid grid-cols-2 gap-2"><Field label="Từ ngày"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="Đến ngày"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></div>
        <div className="flex flex-wrap gap-2 my-3"><Badge>Thu {money(tin)}</Badge><Badge color="bg-rose-100 text-rose-700">Chi {money(tout)}</Badge>
          <Badge color="bg-violet-100 text-violet-700">Chênh lệch {money(tin - tout)}</Badge></div>
        {rows.loading ? <Loading /> : rows.error ? <ErrorBox error={rows.error} /> : rows.data.length ? rows.data.map(r => (
          <div key={r.id} className="flex justify-between items-center gap-2 py-2 border-b text-sm">
            <span className="flex-1">{datetime(r.txn_date)} · <b>{name[r.category]}</b> · {r.cash_accounts?.name}<div className="text-xs text-slate-500">{r.party_name} {r.note}</div></span>
            <b className={r.direction === 'in' ? 'text-ruong-700' : 'text-rose-600'}>{r.direction === 'in' ? '+' : '−'}{money(r.amount)}</b>
            {profile?.role === 'owner' && !r.ref_table && <DeleteButton icon title="Xóa khoản thu/chi này?"
              onConfirm={async () => { await rpc('delete_cash_entry', { p_id: r.id }); toast('Đã xóa khỏi sổ quỹ'); rows.reload(); }}>
              <p><b>{name[r.category]}</b> · {money(r.amount)} · {datetime(r.txn_date)}</p><p>{r.party_name} {r.note}</p>
            </DeleteButton>}</div>)) : <Empty text="Không có giao dịch" />}
      </Card>
    </div>
  );
}
