import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, num, datetime, digits } from '../lib/format.js';
import { Card, Button, Input, Select, Field, Empty, Loading, ErrorBox, useLoad, useToast } from '../components/ui.jsx';

export default function Purchase() {
  const toast = useToast();
  const prods = useLoad(() => q(supabase.from('v_products').select('*').eq('is_active', true).order('name')), []);
  const sups = useLoad(() => q(supabase.from('suppliers').select('id,name').eq('is_active', true).order('name')), []);
  const hist = useLoad(() => q(supabase.from('purchase_receipts').select('*, suppliers(name)').order('receipt_date', { ascending: false }).limit(30)), []);
  const [sup, setSup] = useState(''); const [lines, setLines] = useState([]); const [paid, setPaid] = useState(null); const [acc, setAcc] = useState('cash'); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const addLine = () => setLines(l => [...l, { key: Math.random(), product_id: prods.data[0]?.id || '', unit_code: 'bao', qty: '', price: '' }]);
  const upd = (k, patch) => setLines(l => l.map(x => x.key === k ? { ...x, ...patch } : x));
  const calc = lines.map(l => { const p = prods.data?.find(x => x.id === l.product_id); const u = p?.units.find(x => x.unit_code === l.unit_code);
    const qty = Number(String(l.qty).replace(',', '.')) || 0;
    const kgPerUnit = l.unit_code === 'kg' ? 1 : l.unit_code === 'tan' ? 1000 : Number(p?.kg_per_bao || 0);
    const perKg = kgPerUnit ? (Number(l.price) || 0) / kgPerUnit : 0;
    const kgU = p?.units.find(x => x.unit_code === 'kg' && x.is_active), baoU = p?.units.find(x => x.unit_code === 'bao');
    const saleKg = kgU ? Number(kgU.retail_price) : baoU && p ? Number(baoU.retail_price) / Number(p.kg_per_bao) : 0;
    const warn = Number(l.price) > 0 && saleKg > 0 && (perKg < saleKg * 0.3 || perKg > saleKg * 1.5);
    return { ...l, p, u, qtyN: qty, kgPerUnit, perKg, saleKg, warn, total: Math.round(qty * (Number(l.price) || 0)), base: qty * (u?.factor || 0) }; });
  const total = calc.reduce((a, l) => a + l.total, 0);
  const paidN = paid == null ? total : Math.min(Number(paid || 0), total);
  const save = async () => {
    setBusy(true);
    try {
      const r = await rpc('create_purchase_receipt', { p: { supplier_id: sup || null, paid_amount: paidN, account_code: acc, note,
        items: calc.map(l => ({ product_id: l.product_id, unit_code: l.unit_code, quantity: l.qtyN, unit_price: Number(l.price) || 0 })) } });
      toast(`Đã lưu phiếu ${r.receipt_code}, kho đã cộng thêm`); setLines([]); setPaid(null); setNote(''); hist.reload(); prods.reload();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  if (prods.loading || sups.loading) return <Loading />;
  if (prods.error) return <ErrorBox error={prods.error} />;
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-4 items-start">
      <Card title="Phiếu nhập hàng mới" icon="🚚" accent="from-sky-500 to-cyan-400">
        <Field label="Nhà cung cấp"><Select value={sup} onChange={e => setSup(e.target.value)}>
          <option value="">— Không chọn (phải trả đủ) —</option>{sups.data.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div className="space-y-2 mt-3">
          {calc.map(l => (
            <div key={l.key} className="rounded-2xl bg-sky-50 p-3">
              <div className="flex gap-2"><Select value={l.product_id} onChange={e => upd(l.key, { product_id: e.target.value, unit_code: 'bao' })} className="flex-1">
                {prods.data.map(p => <option key={p.id} value={p.id}>{p.product_code} · {p.name}</option>)}</Select>
                <button onClick={() => setLines(x => x.filter(y => y.key !== l.key))} className="text-rose-500 font-bold px-2" aria-label="Xóa dòng">✕</button></div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <label className="text-xs">Số lượng<Input inputMode="decimal" value={l.qty} onChange={e => upd(l.key, { qty: e.target.value })} /></label>
                <label className="text-xs">Đơn vị<Select value={l.unit_code} onChange={e => upd(l.key, { unit_code: e.target.value })}>{l.p?.units.map(u => <option key={u.unit_code} value={u.unit_code}>{u.unit_name}</option>)}</Select></label>
                <label className="text-xs">Giá nhập cho 1 {l.u?.unit_name || 'đơn vị'} (đ)<Input inputMode="numeric" value={l.price} onChange={e => upd(l.key, { price: digits(e.target.value) })} /></label>
              </div>
              <div className="text-sm mt-1 flex justify-between gap-2"><span>= {num(l.qtyN * l.kgPerUnit, 1)} kg · giá nhập <b>{money(l.perKg)}/kg</b></span><b>{money(l.total)}</b></div>
              {l.warn && <div className="mt-2 rounded-xl bg-rose-100 text-rose-700 text-sm font-semibold p-2">⚠️ Giá nhập {money(l.perKg)}/kg rất khác giá bán {money(l.saleKg)}/kg. Ô này là giá cho <b>1 {l.u?.unit_name}</b>{l.unit_code !== 'kg' && ` (${num(l.kgPerUnit, 1)} kg)`}.
                {l.unit_code !== 'kg' && <button type="button" onClick={() => upd(l.key, { price: String(Math.round(Number(l.price) * l.kgPerUnit)) })}
                  className="block mt-2 rounded-xl bg-white text-rose-700 ring-2 ring-rose-300 px-3 py-1.5 font-bold">
                  {money(l.price)} là giá mỗi kg → đổi thành {money(Number(l.price) * l.kgPerUnit)}/{l.u?.unit_name.toLowerCase()}</button>}</div>}
            </div>))}
          {!calc.length && <Empty icon="🚚" text="Chưa có dòng hàng" />}
          <Button color="ghost" onClick={addLine} disabled={!prods.data.length}>＋ Thêm dòng hàng</Button>
        </div>
      </Card>
      <Card title="Thanh toán cho NCC" icon="💸" accent="from-violet-500 to-sky-500">
        <div className="flex justify-between text-xl font-extrabold"><span>Tổng tiền</span><span className="text-sky-700">{money(total)}</span></div>
        <Field label="Đã trả" className="mt-3" hint="Phần chưa trả ghi vào công nợ NCC"><Input inputMode="numeric" value={paid == null ? total : paid} placeholder="0" onChange={e => setPaid(digits(e.target.value))} /></Field>
        <Field label="Trả bằng" className="mt-2"><Select value={acc} onChange={e => setAcc(e.target.value)}><option value="cash">Tiền mặt</option><option value="bank">Chuyển khoản</option></Select></Field>
        <Field label="Ghi chú" className="mt-2"><Input value={note} onChange={e => setNote(e.target.value)} /></Field>
        <div className="flex justify-between mt-3"><span>Còn nợ NCC</span><b className="text-rose-600">{money(total - paidN)}</b></div>
        <Button className="w-full mt-4" color="sky" onClick={save} disabled={busy || !calc.length}>💾 Lưu phiếu nhập</Button>
      </Card>
      <Card title="Phiếu nhập gần đây" icon="📜" accent="from-sky-600 to-indigo-500" className="lg:col-span-2">
        {hist.loading ? <Loading /> : hist.error ? <ErrorBox error={hist.error} /> : hist.data.length ? hist.data.map(r => (
          <div key={r.id} className="flex justify-between text-sm py-2 border-b"><span><b>{r.receipt_code}</b> · {datetime(r.receipt_date)} · {r.suppliers?.name || 'Không NCC'}</span>
            <span><b>{money(r.total_amount)}</b>{r.debt_remaining > 0 && <span className="text-rose-600"> · nợ {money(r.debt_remaining)}</span>}</span></div>)) : <Empty text="Chưa có phiếu nhập" />}
      </Card>
    </div>
  );
}
