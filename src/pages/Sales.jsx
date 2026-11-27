import { useMemo, useRef, useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, num, digits, su, suCode, qtyU, unitLabel } from '../lib/format.js';
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
  const [paid, setPaid] = useState(null);   // null = trả đủ
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
    const price = l.price == null || l.price === '' ? list : Number(l.price);
    // Mua theo số tiền (vd "50 nghìn gạo"): số lượng = số tiền ÷ đơn giá, thành tiền đúng bằng số tiền khách đưa
    const amt = Number(l.amt) || 0, byAmt = amt > 0 && price > 0;
    const qty = byAmt ? amt / price : Number(l.qty) || 0, disc = Number(l.disc) || 0;
    return { ...l, p, u, list, priceN: price, qtyN: qty, byAmt, discN: disc, total: (byAmt ? amt : Math.round(qty * price)) - disc, base: qty * (u?.factor || 0) };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const total = Math.max(0, subtotal - (Number(invDisc) || 0));
  const paidN = method === 'debt' ? 0 : paid == null ? total : Math.min(Number(paid || 0), total);
  const debt = total - paidN;
  const change = method === 'cash' && given ? Math.max(0, Number(given) - paidN) : 0;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (prods.data || []).filter(p => (!cat || p.category_name === cat) &&
      (!s || p.name.toLowerCase().includes(s) || p.product_code.toLowerCase().includes(s) || (p.barcode || '').toLowerCase() === s));
  }, [prods.data, search, cat]);

  const add = (p, unit) => {
    const u = p.units.find(x => x.unit_code === (unit || suCode(p)) && x.is_active) || p.units.find(x => x.is_active);
    if (!u) return toast('Sản phẩm chưa có đơn vị bán', 'err');
    setCart(c => {
      const i = c.findIndex(x => x.product_id === p.id && x.unit_code === u.unit_code);
      if (i >= 0) return c.map((x, j) => j === i ? { ...x, qty: String(Number(x.qty) + 1) } : x);
      return [...c, { key: Math.random(), product_id: p.id, unit_code: u.unit_code, qty: '1', price: null, disc: '' }];
    });
  };
  const onSearchKey = e => {
    if (e.key !== 'Enter') return;
    const s = search.trim().toLowerCase();
    const exact = prods.data?.find(p => (p.barcode || '').toLowerCase() === s || p.product_code.toLowerCase() === s) || (filtered.length === 1 && filtered[0]);
    if (exact) { add(exact); setSearch(''); }
  };
  const upd = (key, patch) => setCart(c => c.map(x => x.key === key ? { ...x, ...patch } : x));
  // Bật "theo số tiền": hàng bán theo bao thì chuyển sang đơn vị kg (không bán lẻ "nửa bao")
  const setAmt = (l, v) => {
    const patch = { amt: v };
    if (v && l.unit_code === 'bao') { const kg = l.p?.units.find(u => u.is_active && u.unit_code === 'kg'); if (kg) Object.assign(patch, { unit_code: 'kg', price: null }); }
    upd(l.key, patch);
  };

  const save = async () => {
    if (!lines.length) return toast('Chưa có sản phẩm trong giỏ', 'err');
    if (debt > 0 && !custId) return toast('Ghi nợ phải chọn khách hàng', 'err');
    const over = profile.stock && lines.find(l => l.base > Number(l.p.stock_bao) + 1e-9);
    if (over) return toast(`Không đủ tồn: ${over.p.name} còn ${qtyU(over.p, over.p.stock_bao)}`, 'err');
    const free = lines.find(l => l.priceN <= 0 && l.list <= 0);
    if (free) return toast(`"${free.p.name}" chưa có giá bán. Vào Sản phẩm để nhập giá.`, 'err');
    setBusy(true);
    try {
      const r = await rpc('create_sales_invoice', { p: {
        customer_id: custId || null, account_code: method === 'bank' ? 'bank' : 'cash', paid_amount: paidN,
        cash_given: method === 'cash' && given ? Number(given) : null, discount: Number(invDisc) || 0,
        items: lines.map(l => ({ product_id: l.product_id, unit_code: l.unit_code, quantity: l.qtyN,
          unit_price: canPrice && l.price != null && l.price !== '' ? Number(l.price) : null, discount: l.discN }))
      } });
      setDone(r); setCart([]); setInvDisc(''); setPaid(null); setGiven(''); setCustId(''); setMethod('cash');
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
        <div className="flex flex-wrap gap-2 mt-3 pb-1">
          {['', ...cats].map(c => (
            <button key={c} onClick={() => setCat(c)} className={cx('rounded-full px-4 py-1.5 text-sm font-bold whitespace-nowrap',
              cat === c ? 'bg-gradient-to-r from-lua-500 to-orange-400 text-white' : 'bg-lua-50 text-lua-700 ring-1 ring-lua-200')}>{c || 'Tất cả'}</button>))}
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
          {filtered.map(p => {
            const sell = p.units.filter(u => u.is_active);
            const low = profile.stock && Number(p.min_stock) > 0 && Number(p.stock_bao) <= Number(p.min_stock), out = profile.stock && Number(p.stock_bao) <= 0;
            return (
              <div key={p.id} className="rounded-2xl ring-1 ring-ruong-100 bg-gradient-to-br from-white to-lua-50 p-3 flex flex-col">
                <div className="flex items-start gap-2">
                  <span className="text-2xl">{p.emoji}</span>
                  <div className="flex-1 min-w-0"><div className="font-bold leading-tight">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.product_code} · {suCode(p) === 'bao' ? `bao ${num(p.kg_per_bao, 1)} kg` : `bán theo ${su(p)}`}</div></div>
                </div>
                <div className="text-sm mt-2 space-y-0.5">
                  {sell.map(u => <div key={u.unit_code}>{unitLabel(u)}: <b className="text-ruong-700">{Number(priceOf(u, tier)) > 0 ? money(priceOf(u, tier)) : 'chưa có giá'}</b>
                    {u.unit_code === 'bao' && Number(priceOf(u, tier)) > 0 && <span className="text-[11px] text-slate-500"> ({money(priceOf(u, tier) / p.kg_per_bao)}/kg)</span>}</div>)}
                </div>
                {profile.stock && <div className={cx('text-xs mt-1 font-semibold', low || out ? 'text-rose-600' : 'text-slate-600')}>Tồn: {qtyU(p, p.stock_bao, 2)}{low && ' ⚠️'}{out && ' · hết hàng'}</div>}
                <div className="flex gap-2 mt-auto pt-2">
                  {sell.map((u, i) => <Button key={u.unit_code} small color={i ? 'gold' : 'green'} onClick={() => add(p, u.unit_code)} disabled={out || Number(priceOf(u, tier)) <= 0} className="flex-1">+ {u.unit_name}</Button>)}
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
      <div id="cart" className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-2 lg:pr-1 scroll-mt-24 cart-scroll">
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
                  <div className="flex-1 font-bold leading-tight">{l.p?.name}<div className="text-xs font-normal text-slate-500">{l.p?.product_code}{profile.stock && suCode(l.p) === 'bao' && l.unit_code !== 'bao' ? ` · xuất ${num(l.base, 3)} bao` : ''}</div></div>
                  <button onClick={() => setCart(c => c.filter(x => x.key !== l.key))} className="text-rose-500 font-bold px-1" aria-label="Xóa dòng">✕</button>
                </div>
                <div className="mt-2 rounded-xl bg-white/80 ring-1 ring-lua-200 p-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-lua-700 whitespace-nowrap">💵 Mua theo số tiền</span>
                    <Input inputMode="numeric" value={l.amt || ''} placeholder="vd 50000" onChange={e => setAmt(l, digits(e.target.value))} className="!py-1 text-right" aria-label="Số tiền khách muốn mua" />
                    {l.amt && <button onClick={() => upd(l.key, { amt: '', qty: String(Math.round(l.qtyN * 1000) / 1000 || 1) })} className="text-xs text-slate-500 font-bold px-1" aria-label="Bỏ mua theo số tiền">✕</button>}
                  </div>
                  <div className="flex gap-1 mt-1.5">{[10000, 20000, 50000, 100000].map(v => (
                    <button key={v} onClick={() => setAmt(l, String(v))} className={cx('flex-1 rounded-lg py-1 text-xs font-bold', Number(l.amt) === v ? 'bg-lua-500 text-white' : 'bg-lua-50 text-lua-700')}>{v / 1000}k</button>))}</div>
                  {l.byAmt && <p className="text-sm mt-1.5 text-ruong-800">⚖️ Cân <b className="text-base">{num(l.qtyN, 3)} {l.u?.unit_name?.toLowerCase()}</b>{l.u?.unit_code === 'kg' && <> (≈ <b>{num(l.qtyN * 1000, 0)} g</b>)</>} <span className="text-xs text-slate-500">· giá {money(l.priceN)}/{l.u?.unit_name?.toLowerCase()}</span></p>}
                  {Number(l.amt) > 0 && !l.byAmt && <p className="text-xs mt-1.5 text-rose-600">Chưa có đơn giá để tính số lượng</p>}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <label className="text-xs">SL<Input inputMode="decimal" value={l.byAmt ? num(l.qtyN, 3) : l.qty} readOnly={l.byAmt} title={l.byAmt ? 'Đang tính theo số tiền' : undefined}
                    onChange={e => upd(l.key, { qty: e.target.value.replace(',', '.').replace(/[^\d.]/g, ''), amt: '' })} className={cx('!py-1.5', l.byAmt && '!bg-lua-50')} /></label>
                  <label className="text-xs">Đơn vị<Select value={l.unit_code} onChange={e => upd(l.key, { unit_code: e.target.value, price: null })} className="!py-1.5">
                    {l.p?.units.filter(u => u.is_active).map(u => <option key={u.unit_code} value={u.unit_code}>{unitLabel(u)}</option>)}</Select></label>
                  <label className="text-xs">Đơn giá (đ)<Input inputMode="numeric" disabled={!canPrice} value={l.price == null ? l.list : l.price} placeholder={String(l.list)}
                    onChange={e => upd(l.key, { price: digits(e.target.value) })} className="!py-1.5" /></label>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-xs flex-1">Giảm giá dòng<Input inputMode="numeric" value={l.disc} placeholder="0" onChange={e => upd(l.key, { disc: digits(e.target.value) })} className="!py-1.5" /></label>
                  <div className="text-right"><div className="text-xs text-slate-500">Thành tiền</div><b className="text-ruong-700">{money(l.total)}</b></div>
                </div>
                {profile.stock && l.base > Number(l.p?.stock_bao) && <p className="text-xs text-rose-600 font-bold mt-1">Vượt tồn ({qtyU(l.p, l.p.stock_bao)})</p>}
              </div>))}
            {!lines.length && <Empty icon="🧺" text="Bấm nút “+” ở mặt hàng để thêm vào giỏ" />}
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
              <button key={k} onClick={() => { setMethod(k); setPaid(null); }} className={cx('rounded-2xl py-2 text-sm font-bold',
                method === k ? 'bg-gradient-to-r from-ruong-600 to-lime-500 text-white' : 'bg-slate-100')}>{t}</button>))}
          </div>
          {method !== 'debt' && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Field label="Khách trả (thanh toán)" hint="Bớt đi = trả một phần, phần còn lại ghi nợ">
                <Input inputMode="numeric" value={paid == null ? total : paid} placeholder="0" onChange={e => setPaid(digits(e.target.value))} /></Field>
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
      <div className="text-center relative">
        <div className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden="true">
          {Array.from({ length: 26 }, (_, i) => { const a = (i / 26) * Math.PI * 2, d = 90 + (i % 5) * 22;
            return <span key={i} className="grain-burst" style={{ '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 30}px`, '--r': `${i * 47}deg`,
              background: ['#FACC15', '#FFFFFF', '#F59E0B', '#FDE047', '#84CC16'][i % 5], boxShadow: '0 0 0 1.5px #B45309', animationDelay: `${(i % 3) * .05}s` }} />; })}
        </div>
        <div className="text-5xl floaty">🎉</div>
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
