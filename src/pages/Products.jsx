import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, num, datetime, digits } from '../lib/format.js';
import { Card, Button, Input, Select, Modal, Badge, Empty, Loading, ErrorBox, useLoad, useToast, Field, cx } from '../components/ui.jsx';

const TXN = { purchase: ['Nhập hàng', 'text-ruong-700'], sale: ['Bán', 'text-rose-600'], sale_cancel: ['Hủy HĐ (nhập lại)', 'text-sky-700'],
  adjust_in: ['Điều chỉnh tăng', 'text-ruong-700'], adjust_out: ['Điều chỉnh giảm', 'text-orange-600'] };

export default function Products({ profile }) {
  const mgr = profile.role !== 'staff';
  const [tab, setTab] = useState('list');
  const [s, setS] = useState(''); const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null); const [view, setView] = useState(null);
  const list = useLoad(() => q(supabase.from('v_products').select('*').order('name')), []);
  const rows = (list.data || []).filter(p => (!cat || p.category_name === cat) && (!s || [p.name, p.product_code, p.barcode || ''].some(x => x.toLowerCase().includes(s.toLowerCase()))));
  const tabs = [['list', '🍚 Sản phẩm & tồn'], ['history', '📜 Lịch sử kho'], ...(mgr ? [['check', '⚖️ Đối soát']] : [])];
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {tabs.map(([k, t]) => <button key={k} onClick={() => setTab(k)} className={cx('rounded-2xl px-4 py-2 font-bold whitespace-nowrap shadow-sm',
          tab === k ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-white' : 'bg-white/90')}>{t}</button>)}
      </div>
      {tab === 'list' && <>
        <Card title="Sản phẩm" icon="🍚" accent="from-amber-500 to-yellow-400" right={mgr && <Button small color="ghost" onClick={() => setEdit({})}>＋ Thêm</Button>}>
          <div className="flex gap-2">
            <Input value={s} onChange={e => setS(e.target.value)} placeholder="🔎 Tên, mã, mã vạch" />
            <Select value={cat} onChange={e => setCat(e.target.value)} className="!w-32"><option value="">Mọi nhóm</option><option>Gạo</option><option>Lúa</option><option>Cám</option></Select>
          </div>
        </Card>
        {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !rows.length ? <Card><Empty text={mgr ? 'Chưa có sản phẩm, bấm “＋ Thêm”' : 'Chưa có sản phẩm'} /></Card> : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.map(p => {
              const low = Number(p.stock_bao) <= Number(p.min_stock); const bao = p.units.find(u => u.unit_code === 'bao'); const kg = p.units.find(u => u.unit_code === 'kg');
              return (
                <button key={p.id} onClick={() => setView(p)} className={cx('text-left rounded-3xl bg-white/95 shadow-soft p-4 ring-2', low ? 'ring-rose-300' : 'ring-transparent', !p.is_active && 'opacity-60')}>
                  <div className="flex gap-3 items-start">
                    <span className="text-3xl w-12 h-12 rounded-2xl bg-gradient-to-br from-lua-200 to-ruong-200 grid place-items-center">{p.emoji}</span>
                    <div className="flex-1 min-w-0"><div className="font-extrabold">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.product_code} · {p.category_name} · bao {num(p.kg_per_bao, 1)} kg</div>
                      {!p.is_active && <Badge color="bg-slate-200">Ngừng bán</Badge>}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                    <div className={cx('rounded-xl p-2', low ? 'bg-rose-50' : 'bg-ruong-50')}>Tồn<br /><b className={low ? 'text-rose-600' : 'text-ruong-700'}>{num(p.stock_bao, 3)} bao</b><div className="text-[11px]">≈ {num(p.stock_kg, 1)} kg</div></div>
                    <div className="rounded-xl p-2 bg-lua-50">Giá lẻ<br />{bao && <b>{money(bao.retail_price)}/bao</b>}{kg?.is_active && <div className="text-[11px]">{money(kg.retail_price)}/kg</div>}</div>
                  </div>
                  {low && <div className="text-xs text-rose-600 font-bold mt-2">⚠️ Dưới mức cảnh báo ({num(p.min_stock, 2)} bao)</div>}
                </button>);
            })}
          </div>)}
      </>}
      {tab === 'history' && <StockHistory />}
      {tab === 'check' && <Reconcile />}
      {edit && <Modal title={edit.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'} onClose={() => setEdit(null)}><ProductForm p={edit.id ? edit : null} canCost={mgr} onSaved={() => { setEdit(null); list.reload(); }} /></Modal>}
      {view && <ProductView p={view} mgr={mgr} onClose={() => setView(null)} onEdit={() => { setEdit(view); setView(null); }} onChanged={list.reload} />}
    </div>
  );
}

function ProductForm({ p, canCost, onSaved }) {
  const toast = useToast();
  const cats = useLoad(async () => {
    const [c, costs] = await Promise.all([q(supabase.from('categories').select('*').order('sort')), canCost && p ? rpc('product_costs', {}) : []]);
    const cb = costs.find(x => x.product_id === p?.id)?.cost_price;
    if (cb != null) setF(f => ({ ...f, cost_kg: String(Math.round(cb / p.kg_per_bao)) }));
    return c;
  }, []);
  const u = c => p?.units.find(x => x.unit_code === c);
  const [f, setF] = useState({
    name: p?.name || '', product_code: p?.product_code || '', barcode: p?.barcode || '', category_id: p?.category_id || '',
    kg_per_bao: p ? String(p.kg_per_bao) : '50', min_stock: p ? String(p.min_stock) : '5', description: p?.description || '', is_active: p ? p.is_active : true,
    bao_r: String(u('bao')?.retail_price ?? ''), bao_w: String(u('bao')?.wholesale_price ?? ''),
    kg_on: p ? !!u('kg')?.is_active : true, kg_r: String(u('kg')?.retail_price ?? ''), kg_w: String(u('kg')?.wholesale_price ?? ''),
    tan_on: !!u('tan')?.is_active, tan_r: String(u('tan')?.retail_price ?? ''), tan_w: String(u('tan')?.wholesale_price ?? ''),
    cost_kg: ''
  });
  const set = (k, fn = x => x) => e => setF({ ...f, [k]: fn(e.target.type === 'checkbox' ? e.target.checked : e.target.value) });
  const save = async e => {
    e.preventDefault();
    try {
      await rpc('save_product', { p: {
        id: p?.id, name: f.name, product_code: f.product_code, barcode: f.barcode, category_id: f.category_id || cats.data[0].id,
        kg_per_bao: Number(f.kg_per_bao.replace(',', '.')), ...(canCost && f.cost_kg !== '' ? { cost_price: Number(f.cost_kg) * Number(f.kg_per_bao.replace(',', '.')) } : {}), min_stock: Number(f.min_stock.replace(',', '.')) || 0, description: f.description, is_active: f.is_active,
        units: [{ unit_code: 'bao', retail_price: +f.bao_r || 0, wholesale_price: +f.bao_w || 0 },
          { unit_code: 'kg', retail_price: +f.kg_r || 0, wholesale_price: +f.kg_w || 0, is_active: f.kg_on },
          { unit_code: 'tan', retail_price: +f.tan_r || 0, wholesale_price: +f.tan_w || 0, is_active: f.tan_on }] } });
      toast('Đã lưu sản phẩm'); onSaved();
    } catch (e) { toast(e.message, 'err'); }
  };
  if (cats.loading) return <Loading />;
  const priceRow = (k, label, on) => (
    <div className={cx('grid grid-cols-[90px_1fr_1fr] gap-2 items-end', on === false && 'opacity-50')}>
      <span className="font-bold pb-3">{label}</span>
      <Field label="Giá lẻ (đ)"><Input inputMode="numeric" value={f[k + '_r']} onChange={set(k + '_r', digits)} disabled={on === false} /></Field>
      <Field label="Giá sỉ (đ)"><Input inputMode="numeric" value={f[k + '_w']} onChange={set(k + '_w', digits)} disabled={on === false} /></Field>
    </div>);
  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="Tên sản phẩm *"><Input value={f.name} onChange={set('name')} required placeholder="vd: Gạo ST25" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nhóm"><Select value={f.category_id} onChange={set('category_id')}>{cats.data.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</Select></Field>
        <Field label="Mã SP" hint="Để trống: tự sinh GAO001…"><Input value={f.product_code} onChange={set('product_code')} /></Field>
        <Field label="Số kg mỗi bao *" hint="Tồn kho tính theo bao"><Input inputMode="decimal" value={f.kg_per_bao} onChange={set('kg_per_bao')} required /></Field>
        <Field label="Cảnh báo khi tồn ≤ (bao)"><Input inputMode="decimal" value={f.min_stock} onChange={set('min_stock')} /></Field>
      </div>
      <Field label="Mã vạch"><Input value={f.barcode} onChange={set('barcode')} placeholder="Quét hoặc nhập" /></Field>
      {canCost && <div className="rounded-2xl bg-violet-50 p-3">
        <Field label="📦 Giá nhập (đ/kg)" hint={`Dùng để tính tiền vốn = số kg bán × giá nhập/kg. Tự cập nhật theo phiếu nhập gần nhất. ${f.cost_kg && f.kg_per_bao ? '≈ ' + money(Number(f.cost_kg) * Number(f.kg_per_bao.replace(',', '.'))) + '/bao' : ''}`}>
          <Input inputMode="numeric" value={f.cost_kg} onChange={set('cost_kg', digits)} placeholder="vd: 24.000" /></Field>
      </div>}
      <div className="rounded-2xl bg-lua-50 p-3 space-y-2">
        <b>💰 Giá bán theo đơn vị</b>
        {priceRow('bao', '1 Bao')}
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.kg_on} onChange={set('kg_on')} /> Bán lẻ theo kg</label>
        {priceRow('kg', '1 Kg', f.kg_on)}
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.tan_on} onChange={set('tan_on')} /> Bán theo tấn</label>
        {priceRow('tan', '1 Tấn', f.tan_on)}
        <p className="text-xs text-slate-500">Quy đổi tự động: 1 kg = 1/{f.kg_per_bao || '?'} bao; 1 tấn = 1000/{f.kg_per_bao || '?'} bao.</p>
      </div>
      <Field label="Mô tả"><Input value={f.description} onChange={set('description')} /></Field>
      {p && <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={f.is_active} onChange={set('is_active')} /> Đang kinh doanh (bỏ chọn = ngừng bán, không xóa)</label>}
      <Button className="w-full">💾 Lưu sản phẩm</Button>
    </form>
  );
}

function ProductView({ p, mgr, onClose, onEdit, onChanged }) {
  const toast = useToast();
  const [adj, setAdj] = useState({ unit: 'kg', qty: '', sign: '-', reason: '' });
  const d = useLoad(async () => {
    const [txns, lots, cost] = await Promise.all([
      q(supabase.from('inventory_transactions').select('*').eq('product_id', p.id).order('created_at', { ascending: false }).limit(60)),
      mgr ? q(supabase.from('inventory_lots').select('*').eq('product_id', p.id).gt('qty_remaining', 0).order('received_at')) : [],
      mgr ? rpc('product_costs', {}) : []]);
    return { txns, lots, cost: cost.find(c => c.product_id === p.id)?.cost_price };
  }, [p.id]);
  const doAdj = async () => {
    try {
      const r = await rpc('create_stock_adjustment', { p_product: p.id, p_unit: adj.unit, p_quantity: Number(adj.qty.replace(',', '.')) * (adj.sign === '-' ? -1 : 1), p_reason: adj.reason });
      toast('Đã tạo phiếu ' + r.adjustment_code); setAdj({ ...adj, qty: '', reason: '' }); d.reload(); onChanged();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title={`${p.emoji} ${p.name}`} onClose={onClose} wide>
      {d.loading ? <Loading /> : d.error ? <ErrorBox error={d.error} /> : <>
        <div className="grid sm:grid-cols-3 gap-2 text-sm">
          <div className="rounded-2xl bg-ruong-50 p-3">Tồn kho<br /><b className="text-lg text-ruong-700">{num(p.stock_bao, 3)} bao</b><br />≈ {num(p.stock_kg, 1)} kg</div>
          <div className="rounded-2xl bg-lua-50 p-3">{p.units.filter(u => u.is_active).map(u => <div key={u.unit_code}>{u.unit_name}: <b>{money(u.retail_price)}</b> · sỉ {money(u.wholesale_price)}</div>)}</div>
          {mgr && <div className="rounded-2xl bg-violet-50 p-3">Giá nhập hiện hành<br /><b className="text-lg">{money(Number(d.data.cost || 0) / Number(p.kg_per_bao))}/kg</b><br /><span className="text-xs">= {money(d.data.cost)}/bao</span></div>}
        </div>
        {mgr && <>
          <h4 className="font-bold mt-4 mb-1">📦 Lô hàng còn tồn (xuất theo FIFO từ trên xuống)</h4>
          {d.data.lots.length ? d.data.lots.map(l => <div key={l.id} className="flex justify-between text-sm border-b py-1.5">
            <span>{l.lot_code} · {datetime(l.received_at)}</span><span><b>{num(l.qty_remaining, 3)}</b>/{num(l.qty_in, 3)} bao · {money(l.unit_cost)}/bao</span></div>) : <Empty icon="📦" text="Hết hàng" />}
          <div className="mt-4 rounded-2xl ring-2 ring-orange-300 p-3">
            <b>⚖️ Điều chỉnh kho</b> <span className="text-xs text-slate-500">(hao hụt, chênh lệch cân, kiểm kê)</span>
            <div className="grid grid-cols-[80px_1fr_100px] gap-2 mt-2">
              <Select value={adj.sign} onChange={e => setAdj({ ...adj, sign: e.target.value })}><option value="-">Giảm</option><option value="+">Tăng</option></Select>
              <Input inputMode="decimal" placeholder="Số lượng" value={adj.qty} onChange={e => setAdj({ ...adj, qty: e.target.value })} />
              <Select value={adj.unit} onChange={e => setAdj({ ...adj, unit: e.target.value })}>{p.units.map(u => <option key={u.unit_code} value={u.unit_code}>{u.unit_name}</option>)}</Select>
            </div>
            <Input className="mt-2" placeholder="Lý do (bắt buộc), vd: Cân lại thiếu 5 kg" value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} />
            <Button small color="gold" className="mt-2" onClick={doAdj} disabled={!Number(adj.qty) || !adj.reason.trim()}>Tạo phiếu điều chỉnh</Button>
          </div>
        </>}
        <h4 className="font-bold mt-4 mb-1">📜 Biến động kho gần đây</h4>
        <TxnList rows={d.data.txns} />
        {mgr && <Button color="ghost" className="mt-4" onClick={onEdit}>✏️ Sửa sản phẩm / giá</Button>}
      </>}
    </Modal>
  );
}

const TxnList = ({ rows, names }) => rows.length ? rows.map(t => (
  <div key={t.id} className="flex justify-between gap-2 text-sm border-b py-1.5">
    <span>{datetime(t.created_at)} · <b className={TXN[t.txn_type][1]}>{TXN[t.txn_type][0]}</b>{names && <> · {names[t.product_id]}</>} <span className="text-slate-500">{t.note}</span></span>
    <b className={t.qty_change > 0 ? 'text-ruong-700' : 'text-rose-600'}>{t.qty_change > 0 ? '+' : ''}{num(t.qty_change, 3)} bao</b></div>)) : <Empty text="Chưa có biến động" />;

function StockHistory() {
  const d = useLoad(async () => {
    const [rows, prods] = await Promise.all([q(supabase.from('inventory_transactions').select('*').order('created_at', { ascending: false }).limit(200)),
      q(supabase.from('products').select('id,name'))]);
    return { rows, names: Object.fromEntries(prods.map(p => [p.id, p.name])) };
  }, []);
  return <Card title="Lịch sử biến động kho (200 dòng gần nhất)" icon="📜" accent="from-amber-500 to-orange-400">
    {d.loading ? <Loading /> : d.error ? <ErrorBox error={d.error} /> : <TxnList rows={d.data.rows} names={d.data.names} />}
    <p className="text-xs text-slate-500 mt-2">Mọi thay đổi tồn đều có dòng ở đây. Tồn cuối = Tồn đầu + Nhập − Xuất.</p></Card>;
}

function Reconcile() {
  const d = useLoad(() => rpc('reconcile_inventory', {}), []);
  return <Card title="Đối soát tồn kho" icon="⚖️" accent="from-ruong-600 to-teal-500" right={<Button small color="ghost" onClick={d.reload}>Chạy lại</Button>}>
    {d.loading ? <Loading /> : d.error ? <ErrorBox error={d.error} /> : !d.data.length
      ? <Empty icon="✅" text="Khớp hoàn toàn: số tồn = tổng giao dịch = tổng lô còn lại" />
      : d.data.map(r => <div key={r.product_id} className="text-rose-600 font-semibold">{r.product_name}: tồn {num(r.balance, 3)} · giao dịch {num(r.txn_sum, 3)} · lô {num(r.lot_sum, 3)}</div>)}
  </Card>;
}
