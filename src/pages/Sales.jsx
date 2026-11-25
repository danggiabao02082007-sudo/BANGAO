import { useMemo, useRef, useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, num, digits } from '../lib/format.js';
import { Card, Button, Input, Select, Modal, Badge, Empty, Loading, ErrorBox, useLoad, useToast, cx, Field } from '../components/ui.jsx';
import PrintInvoice from '../components/Print.jsx';
import { CustomerForm } from './Customers.jsx';

const priceOf = (u, tier) => Number(tier === 'wholesale' ? u.wholesale_price : u.retail_price);

export default function Sales({ profile }) {
  const toast = useToast();
  const canPrice = profile.role !== 'staff';
  const prods = useLoad(() => q(supabase.from('v_products').select('*').eq('is_active', true).order('name')), []);
  const custs = useLoad(() => q(supabase.from('v_customers').select('id,code,name,phone,customer_type,debt').eq('is_active', true).order('name')), []);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState([]);
  const [custId, setCustId] = useState('');
  const [custQ, setCustQ] = useState('');
  const [invDisc, setInvDisc] = useState('');
  const [method, setMethod] = useState('cash');
  const [paid, setPaid] = useState('');
  const [given, setGiven] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [addCust, setAddCust] = useState(false);
  const searchRef = useRef();

  const cust = custs.data?.find(c => c.id === custId);
  const tier = cust?.customer_type === 'si' ? 'wholesale' : 'retail';
  const lines = cart.map(l => {
    const p = prods.data?.find(x => x.id === l.product_id); const u = p?.units.find(x => x.unit_code === l.unit_code);
    const list = u ? priceOf(u, tier) : 0;
    const price = l.price === '' || l.price == null ? list : Number(l.price);
    const qty = Number(l.qty) || 0, disc = Number(l.disc) || 0;
    return { ...l, p, u, list, price, qtyN: qty, discN: disc, total: Math.round(qty * price) - disc, base: qty * (u?.factor || 0) };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const total = Math.max(0, subtotal - (Number(invDisc) || 0));
  const paidN = method === 'debt' ? 0 : paid === '' ? total : Math.min(Number(paid), total);
  const debt = total - paidN;
  const change = method === 'cash' && given ? Math.max(0, Number(given) - paidN) : 0;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (prods.data || []).filter(p => (!cat || p.category_name === cat) &&
      (!s || p.name.toLowerCase().includes(s) || p.product_code.toLowerCase().includes(s) || (p.barcode || '').toLowerCase() === s));
  }, [prods.data, search, cat]);

  const add = (p, unit = 'bao') => {
    const u = p.units.find(x => x.unit_code === unit && x.is_active) || p.units.find(x => x.is_active);
    if (!u) return toast('Sản phẩm chưa có đơn vị bán', 'err');
    setCart(c => {
      const i = c.findIndex(x => x.product_id === p.id && x.unit_code === u.unit_code);
      if (i >= 0) return c.map((x, j) => j === i ? { ...x, qty: String(Number(x.qty) + 1) } : x);
      return [...c, { key: Math.random(), product_id: p.id, unit_code: u.unit_code, qty: '1', price: '', disc: '' }];
    });
  };
  const onSearchKey = e => {
    if (e.key !== 'Enter') return;
    const s = search.trim().toLowerCase();
    const exact = prods.data?.find(p => (p.barcode || '').toLowerCase() === s || p.product_code.toLowerCase() === s) || (filtered.length === 1 && filtered[0]);
    if (exact) { add(exact); setSearch(''); }
  };
  const upd = (key, patch) => setCart(c => c.map(x => x.key === key ? { ...x, ...patch } : x));

  const save = async () => {
    if (!lines.length) return toast('Chưa có sản phẩm trong giỏ', 'err');
    if (debt > 0 && !custId) return toast('Ghi nợ phải chọn khách hàng', 'err');
    const over = lines.find(l => l.base > Number(l.p.stock_bao) + 1e-9);
    if (over) return toast(`Không đủ tồn: ${over.p.name} còn ${num(over.p.stock_bao, 3)} bao`, 'err');
    setBusy(true);
    try {
      const r = await rpc('create_sales_invoice', { p: {
        customer_id: custId || null, account_code: method === 'bank' ? 'bank' : 'cash', paid_amount: paidN,
        cash_given: method === 'cash' && given ? Number(given) : null, discount: Number(invDisc) || 0,
        items: lines.map(l => ({ product_id: l.product_id, unit_code: l.unit_code, quantity: l.qtyN,
          unit_price: canPrice && l.price !== '' ? l.price : null, discount: l.discN }))
      } });
      setDone(r); setCart([]); setInvDisc(''); setPaid(''); setGiven(''); setCustId(''); setMethod('cash');
      prods.reload(); custs.reload();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  if (prods.loading || custs.loading) return <Loading />;
  if (prods.error) return <ErrorBox error={prods.error} />;
  const cats = [...new Set(prods.data.map(p => p.category_name))];
  const custList = custs.data.filter(c => !custQ || c.name.toLowerCase().includes(custQ.toLowerCase()) || c.phone.includes(custQ) || c.code.toLowerCase().includes(custQ.toLowerCase()));

  return (
    <div className="grid lg:grid-cols-[1fr_420px] gap-4 items-start">
      {/* Danh sách hàng */}
      <Card title="Chọn hàng" icon="🌾" accent="from-ruong-600 to-lime-500">
        <Input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={onSearchKey} autoFocus
          placeholder="🔎 Tên, mã hàng hoặc quét mã vạch rồi Enter" />
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {['', ...cats].map(c => (
            <button key={c} onClick={() => setCat(c)} className={cx('rounded-full px-4 py-1.5 text-sm font-bold whitespace-nowrap',
              cat === c ? 'bg-gradient-to-r from-lua-500 to-orange-400 text-white' : 'bg-lua-50 text-lua-700 ring-1 ring-lua-200')}>{c || 'Tất cả'}</button>))}
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
          {filtered.map(p => {
            const bao = p.units.find(u => u.unit_code === 'bao'), kg = p.units.find(u => u.unit_code === 'kg' && u.is_active);
            const low = Number(p.stock_bao) <= Number(p.min_stock);
            return (
              <div key={p.id} className="rounded-2xl ring-1 ring-ruong-100 bg-gradient-to-br from-white to-lua-50 p-3 flex flex-col">
                <div className="flex items-start gap-2">
                  <span className="text-2xl">{p.emoji}</span>
                  <div className="flex-1 min-w-0"><div className="font-bold leading-tight">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.product_code} · bao {num(p.kg_per_bao, 1)} kg</div></div>
                </div>
                <div className="text-sm mt-2">
                  {bao && <div>Bao: <b className="text-ruong-700">{money(priceOf(bao, tier))}</b></div>}
                  {kg && <div>Kg: <b className="text-ruong-700">{money(priceOf(kg, tier))}</b></div>}
                </div>
                <div className={cx('text-xs mt-1 font-semibold', low ? 'text-rose-600' : 'text-slate-600')}>Tồn: {num(p.stock_bao, 2)} bao{low && ' ⚠️'}</div>
                <div className="flex gap-2 mt-2">
                  <Button small onClick={() => add(p, 'bao')} disabled={Number(p.stock_bao) <= 0} className="flex-1">+ Bao</Button>
                  {kg && <Button small color="gold" onClick={() => add(p, 'kg')} disabled={Number(p.stock_bao) <= 0} className="flex-1">+ Kg</Button>}
                </div>
              </div>);
          })}
          {!filtered.length && <div className="sm:col-span-2 xl:col-span-3"><Empty text={prods.data.length ? 'Không tìm thấy hàng' : 'Chưa có sản phẩm. Vào "Sản phẩm & kho" để thêm.'} /></div>}
        </div>
      </Card>

      {lines.length > 0 && (
        <button onClick={() => document.getElementById('cart')?.scrollIntoView({ behavior: 'smooth' })}
          className="lg:hidden fixed z-20 left-3 right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] rounded-2xl px-4 py-3 flex justify-between items-center text-white font-extrabold shadow-xl bg-gradient-to-r from-lua-500 to-orange-500">
          <span>🧺 Giỏ hàng ({lines.length})</span><span>{money(total)} ›</span>
        </button>)}
      {/* Giỏ hàng & thanh toán */}
      <div id="cart" className="space-y-4 lg:sticky lg:top-24 scroll-mt-24">
        <Card title={`Giỏ hàng (${lines.length})`} icon="🧺" accent="from-lua-500 to-orange-400"
          right={tier === 'wholesale' && <Badge color="bg-white/30 text-white">Giá sỉ</Badge>}>
          <Field label="Khách hàng">
            <div className="flex gap-2">
              <Select value={custId} onChange={e => setCustId(e.target.value)} className="flex-1">
                <option value="">Khách lẻ (không ghi nợ)</option>
                {custList.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone && '· ' + c.phone}{c.customer_type === 'si' ? ' · Sỉ' : ''}</option>)}
              </Select>
              <Button color="ghost" small onClick={() => setAddCust(true)} title="Thêm khách">＋</Button>
            </div>
            <Input className="mt-2 !py-1.5 text-sm" placeholder="Lọc khách theo tên / SĐT" value={custQ} onChange={e => setCustQ(e.target.value)} />
          </Field>
          {cust && Number(cust.debt) > 0 && <p className="text-sm text-rose-600 font-semibold mt-1">Khách đang nợ {money(cust.debt)}</p>}

          <div className="mt-3 space-y-2">
            {lines.map(l => (
              <div key={l.key} className="rounded-2xl bg-ruong-50 p-3">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 font-bold leading-tight">{l.p?.name}<div className="text-xs font-normal text-slate-500">{l.p?.product_code} · xuất {num(l.base, 3)} bao</div></div>
                  <button onClick={() => setCart(c => c.filter(x => x.key !== l.key))} className="text-rose-500 font-bold px-1" aria-label="Xóa dòng">✕</button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <label className="text-xs">SL<Input inputMode="decimal" value={l.qty} onChange={e => upd(l.key, { qty: e.target.value.replace(',', '.').replace(/[^\d.]/g, '') })} className="!py-1.5" /></label>
                  <label className="text-xs">Đơn vị<Select value={l.unit_code} onChange={e => upd(l.key, { unit_code: e.target.value, price: '' })} className="!py-1.5">
                    {l.p?.units.filter(u => u.is_active).map(u => <option key={u.unit_code} value={u.unit_code}>{u.unit_name}</option>)}</Select></label>
                  <label className="text-xs">Đơn giá<Input inputMode="numeric" disabled={!canPrice} value={l.price === '' ? l.list : l.price}
                    onChange={e => upd(l.key, { price: digits(e.target.value) })} className="!py-1.5" /></label>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-xs flex-1">Giảm giá dòng<Input inputMode="numeric" value={l.disc} placeholder="0" onChange={e => upd(l.key, { disc: digits(e.target.value) })} className="!py-1.5" /></label>
                  <div className="text-right"><div className="text-xs text-slate-500">Thành tiền</div><b className="text-ruong-700">{money(l.total)}</b></div>
                </div>
                {l.base > Number(l.p?.stock_bao) && <p className="text-xs text-rose-600 font-bold mt-1">Vượt tồn ({num(l.p.stock_bao, 3)} bao)</p>}
              </div>))}
            {!lines.length && <Empty icon="🧺" text="Bấm “+ Bao” hoặc “+ Kg” để thêm hàng" />}
          </div>
        </Card>

        <Card title="Thanh toán" icon="💵" accent="from-violet-500 to-fuchsia-500">
          <div className="space-y-1 text-[15px]">
            <Row l="Tạm tính" v={money(subtotal)} />
            <div className="flex items-center gap-2"><span className="flex-1">Giảm giá hóa đơn</span>
              <Input inputMode="numeric" value={invDisc} onChange={e => setInvDisc(digits(e.target.value))} className="!w-36 !py-1.5 text-right" placeholder="0" /></div>
            <div className="flex justify-between text-xl font-extrabold pt-2"><span>Tổng thanh toán</span><span className="text-ruong-700">{money(total)}</span></div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[['cash', '💵 Tiền mặt'], ['bank', '🏦 Chuyển khoản'], ['debt', '📒 Ghi nợ']].map(([k, t]) => (
              <button key={k} onClick={() => { setMethod(k); setPaid(''); }} className={cx('rounded-2xl py-2 text-sm font-bold',
                method === k ? 'bg-gradient-to-r from-ruong-600 to-lime-500 text-white' : 'bg-slate-100')}>{t}</button>))}
          </div>
          {method !== 'debt' && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Field label="Khách trả (thanh toán)" hint="Bớt đi = trả một phần, phần còn lại ghi nợ">
                <Input inputMode="numeric" value={paid === '' ? total : paid} onChange={e => setPaid(digits(e.target.value))} /></Field>
              {method === 'cash' && <Field label="Khách đưa" hint={change ? `Tiền thừa: ${money(change)}` : ' '}>
                <Input inputMode="numeric" value={given} onChange={e => setGiven(digits(e.target.value))} placeholder="Để tính tiền thừa" /></Field>}
            </div>)}
          <div className="mt-3 rounded-2xl bg-lua-50 p-3 space-y-1">
            <Row l="Tiền đã thanh toán" v={money(paidN)} />
            <Row l="Còn phải trả (ghi nợ)" v={money(debt)} red={debt > 0} />
            {change > 0 && <Row l="Tiền thừa trả khách" v={money(change)} />}
          </div>
          <Button className="w-full mt-4 text-lg" onClick={save} disabled={busy || !lines.length}>{busy ? 'Đang lưu…' : '💾 Lưu hóa đơn'}</Button>
        </Card>
      </div>

      {done && <DoneModal inv={done} onClose={() => { setDone(null); searchRef.current?.focus(); }} />}
      {addCust && <Modal title="Thêm khách hàng" onClose={() => setAddCust(false)}>
        <CustomerForm onSaved={c => { setAddCust(false); custs.reload(); setCustId(c.id); }} /></Modal>}
    </div>
  );
}

const Row = ({ l, v, red }) => <div className="flex justify-between"><span>{l}</span><b className={red ? 'text-rose-600' : ''}>{v}</b></div>;

export function DoneModal({ inv, onClose }) {
  const [print, setPrint] = useState(null);
  const data = useLoad(async () => {
    const [i, items, store] = await Promise.all([
      q(supabase.from('sales_invoices').select('*').eq('id', inv.id).single()),
      q(supabase.from('sales_invoice_items').select('*').eq('invoice_id', inv.id).order('line_no')),
      q(supabase.from('store_settings').select('*').single())]);
    return { i, items, store };
  }, [inv.id]);
  return (
    <Modal title="Đã lưu hóa đơn" onClose={onClose}>
      <div className="text-center">
        <div className="text-5xl">🎉</div>
        <p className="text-xl font-extrabold mt-2">{inv.invoice_code}</p>
        <p className="mt-1">Tổng {money(inv.total_amount)} · Đã trả {money(inv.paid_amount)}</p>
        {inv.debt_amount > 0 && <p className="text-rose-600 font-bold">Ghi nợ {money(inv.debt_amount)}</p>}
        <p className="text-xs text-slate-500 mt-2">Kho, quỹ và công nợ đã được cập nhật cùng lúc.</p>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Button color="gold" disabled={!data.data} onClick={() => setPrint('k80')}>🖨️ In K80</Button>
          <Button color="sky" disabled={!data.data} onClick={() => setPrint('a5')}>🖨️ In A5</Button>
        </div>
        <Button color="ghost" className="w-full mt-2" onClick={onClose}>Tạo hóa đơn mới</Button>
      </div>
      {print && data.data && <PrintInvoice inv={data.data.i} items={data.data.items} store={data.data.store} size={print} onDone={() => setPrint(null)} />}
    </Modal>
  );
}
