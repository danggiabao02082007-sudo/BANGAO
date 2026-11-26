import { useMemo, useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { money, num, datetime, digits, su, suCode, qtyU, stockText, unitLabel, baoPerKg, costText } from '../lib/format.js';
import { Card, Button, Input, Select, Modal, Badge, Empty, Loading, ErrorBox, useLoad, useToast, Field, cx, DeleteButton, useSelection, BulkBar, Check } from '../components/ui.jsx';

const TXN = { purchase: ['Nhập hàng', 'text-ruong-700'], sale: ['Bán', 'text-rose-600'], sale_cancel: ['Hủy HĐ (nhập lại)', 'text-sky-700'],
  adjust_in: ['Điều chỉnh tăng', 'text-ruong-700'], adjust_out: ['Điều chỉnh giảm', 'text-orange-600'] };
// Cách tính tồn kho
export const STOCK_UNITS = [['bao', 'Bao (bán nguyên bao, có thể bán lẻ kg)'], ['kg', 'Kg (chỉ bán theo kg)'], ['hu', 'Hủ'], ['hu_lon', 'Hủ lớn'],
  ['hu_nho', 'Hủ nhỏ'], ['bich', 'Bịch'], ['mang', 'Máng'], ['mieng', 'Miếng'], ['cai', 'Cái']];
const UNIT_NAME = { bao: 'Bao', kg: 'Kg', tan: 'Tấn', hu: 'Hủ', hu_lon: 'Hủ lớn', hu_nho: 'Hủ nhỏ', bich: 'Bịch', mang: 'Máng', mieng: 'Miếng', cai: 'Cái' };

/** Giá đang bán của mặt hàng, mỗi đơn vị một dòng: "250.000đ/bao (10.000đ/kg)", "11.000đ/kg" */
export const priceLines = p => (p.units || []).filter(u => u.is_active).map(u => {
  const pk = baoPerKg(p, u);
  return `${money(u.retail_price)}/${u.unit_name.toLowerCase()}${u.unit_code === 'bao' ? ` ${num(p.kg_per_bao, 0)}kg` : ''}${pk != null ? ` (${money(pk)}/kg)` : ''}`;
});
const noPrice = p => !(p.units || []).some(u => u.is_active && Number(u.retail_price) > 0);

export default function Products({ profile }) {
  const mgr = profile.role !== 'staff'; const stockOn = profile.stock;
  const [tab, setTab] = useState('list');
  const [s, setS] = useState(''); const [cat, setCat] = useState(''); const [warn, setWarn] = useState('');
  const [edit, setEdit] = useState(null); const [view, setView] = useState(null); const [opening, setOpening] = useState(false);
  const list = useLoad(() => q(supabase.from('v_products').select('*').order('product_code')), []);
  const costs = useLoad(() => mgr ? rpc('product_costs', {}) : Promise.resolve([]), [mgr]);
  const cost = useMemo(() => Object.fromEntries((costs.data || []).map(c => [c.product_id, Number(c.cost_price)])), [costs.data]);
  const owner = profile.role === 'owner'; const sel = useSelection();
  const cats = [...new Set((list.data || []).map(p => p.category_name))];
  const rows = (list.data || []).filter(p => (!cat || p.category_name === cat)
    && (!warn || (warn === 'cost' ? mgr && !cost[p.id] : warn === 'price' ? noPrice(p) : Number(p.stock_bao) <= 0))
    && (!s || [p.name, p.product_code, p.barcode || ''].some(x => x.toLowerCase().includes(s.toLowerCase()))));
  const nCost = mgr ? (list.data || []).filter(p => !cost[p.id]).length : 0, nPrice = (list.data || []).filter(noPrice).length;
  const tabs = stockOn ? [['list', '🍚 Sản phẩm & tồn'], ['history', '📜 Lịch sử kho'], ...(mgr ? [['check', '⚖️ Đối soát']] : [])] : [];
  const reload = () => { list.reload(); costs.reload(); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map(([k, t]) => <button key={k} onClick={() => setTab(k)} className={cx('rounded-2xl px-4 py-2 font-bold whitespace-nowrap shadow-sm',
          tab === k ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-white' : 'bg-white/90')}>{t}</button>)}
      </div>
      {tab === 'list' && <>
        <Card title={`Sản phẩm (${(list.data || []).length})`} icon="🍚" accent="from-amber-500 to-yellow-400"
          right={mgr && <div className="flex gap-2">{stockOn && <Button small color="ghost" onClick={() => setOpening(true)}>📥 Nhập tồn đầu kỳ</Button>}<Button small color="ghost" onClick={() => setEdit({})}>＋ Thêm</Button></div>}>
          <div className="flex gap-2">
            <Input value={s} onChange={e => setS(e.target.value)} placeholder="🔎 Tên, mã, mã vạch" />
            <Select value={cat} onChange={e => setCat(e.target.value)} className="!w-36"><option value="">Mọi nhóm</option>{cats.map(c => <option key={c}>{c}</option>)}</Select>
          </div>
          <div className="flex flex-wrap gap-2 mt-2 text-sm">
            {[['', 'Tất cả'], ...(stockOn ? [['stock', '📦 Hết hàng']] : []), ['price', `💰 Chưa có giá bán (${nPrice})`], ...(mgr ? [['cost', `🧾 Chưa có giá nhập (${nCost})`]] : [])].map(([k, t]) =>
              <button key={k} onClick={() => setWarn(k)} className={cx('rounded-full px-3 py-1 font-bold', warn === k ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200')}>{t}</button>)}
          </div>
          {owner && <BulkBar s={sel} kind="product" noun="sản phẩm" className="mt-3" onDone={reload}
            items={rows.map(p => ({ id: p.id, label: `${p.product_code} · ${p.name}` }))} />}
        </Card>
        {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !rows.length ? <Card><Empty text={mgr ? 'Không có sản phẩm phù hợp' : 'Chưa có sản phẩm'} /></Card> : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.map(p => {
              const low = stockOn && Number(p.min_stock) > 0 && Number(p.stock_bao) <= Number(p.min_stock);
              return (
                <button key={p.id} onClick={() => sel.on ? sel.toggle(p.id) : setView(p)} className={cx('text-left rounded-3xl bg-white/95 shadow-soft p-4 ring-2', sel.has(p.id) ? 'ring-rose-400' : low ? 'ring-rose-300' : 'ring-transparent', !p.is_active && 'opacity-60')}>
                  <div className="flex gap-3 items-start">
                    {sel.on && <Check checked={sel.has(p.id)} />}
                    <span className="text-3xl w-12 h-12 rounded-2xl bg-gradient-to-br from-lua-200 to-ruong-200 grid place-items-center">{p.emoji}</span>
                    <div className="flex-1 min-w-0"><div className="font-extrabold">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.product_code} · {suCode(p) === 'bao' ? `bao ${num(p.kg_per_bao, 1)} kg` : `tính theo ${su(p)}`}</div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {!p.is_active && <Badge color="bg-slate-200">Ngừng bán</Badge>}
                        {noPrice(p) && <Badge color="bg-rose-100 text-rose-700">Chưa có giá bán</Badge>}
                        {mgr && costs.data && !cost[p.id] && <Badge color="bg-orange-100 text-orange-700">Chưa có giá nhập</Badge>}</div></div>
                  </div>
                  <div className={cx('grid gap-2 mt-3 text-sm', stockOn ? 'grid-cols-2' : 'grid-cols-1')}>
                    {stockOn && <div className={cx('rounded-xl p-2', low || Number(p.stock_bao) <= 0 ? 'bg-rose-50' : 'bg-ruong-50')}>Tồn<br /><b className={low || Number(p.stock_bao) <= 0 ? 'text-rose-600' : 'text-ruong-700'}>{qtyU(p, p.stock_bao)}</b>
                      {suCode(p) === 'bao' && <div className="text-[11px]">≈ {num(p.stock_kg, 1)} kg</div>}</div>}
                    <div className="rounded-xl p-2 bg-lua-50">Giá bán{priceLines(p).map(t => <div key={t} className="font-bold text-[13px] leading-tight">{t}</div>)}</div>
                  </div>
                  {low && <div className="text-xs text-rose-600 font-bold mt-2">⚠️ Dưới mức cảnh báo ({qtyU(p, p.min_stock, 2)})</div>}
                </button>);
            })}
          </div>)}
      </>}
      {tab === 'history' && <StockHistory />}
      {tab === 'check' && <Reconcile />}
      {edit && <Modal title={edit.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'} onClose={() => setEdit(null)}><ProductForm p={edit.id ? edit : null} canCost={mgr} stockOn={stockOn} onSaved={() => { setEdit(null); reload(); }} /></Modal>}
      {view && <ProductView p={view} mgr={mgr} owner={owner} stockOn={stockOn} onClose={() => setView(null)} onEdit={() => { setEdit(view); setView(null); }} onChanged={reload} />}
      {opening && <OpeningStock prods={list.data || []} cost={cost} onClose={() => setOpening(false)} onDone={reload} />}
    </div>
  );
}

function ProductForm({ p, canCost, stockOn = true, onSaved }) {
  const toast = useToast();
  const cats = useLoad(async () => {
    const [c, costs] = await Promise.all([q(supabase.from('categories').select('*').order('sort')), canCost && p ? rpc('product_costs', {}) : []]);
    const cb = costs.find(x => x.product_id === p?.id)?.cost_price;
    if (cb != null) setF(f => ({ ...f, cost: String(Math.round(suCode(p) === 'bao' ? cb / p.kg_per_bao : cb)) }));
    return c;
  }, []);
  const u = c => p?.units.find(x => x.unit_code === c);
  const su0 = p ? suCode(p) : 'bao';
  const [f, setF] = useState({
    name: p?.name || '', product_code: p?.product_code || '', barcode: p?.barcode || '', category_id: p?.category_id || '',
    stock_unit: su0, kg_per_bao: p && su0 === 'bao' ? String(p.kg_per_bao) : '25', min_stock: p ? String(p.min_stock) : '0',
    description: p?.description || '', is_active: p ? p.is_active : true,
    bao_r: String(u('bao')?.retail_price ?? ''), bao_w: String(u('bao')?.wholesale_price ?? ''), bao_label: u('bao')?.label || '',
    kg_on: p ? !!u('kg')?.is_active : true, kg_r: String(u('kg')?.retail_price ?? ''), kg_w: String(u('kg')?.wholesale_price ?? ''),
    tan_on: !!u('tan')?.is_active, tan_r: String(u('tan')?.retail_price ?? ''), tan_w: String(u('tan')?.wholesale_price ?? ''),
    pc_r: String(u(su0)?.retail_price ?? ''), pc_w: String(u(su0)?.wholesale_price ?? ''),
    cost: ''
  });
  const set = (k, fn = x => x) => e => setF({ ...f, [k]: fn(e.target.type === 'checkbox' ? e.target.checked : e.target.value) });
  const kgpb = Number(String(f.kg_per_bao).replace(',', '.'));
  const isBao = f.stock_unit === 'bao', isKg = f.stock_unit === 'kg', isPiece = !isBao && !isKg;
  const unitWord = (UNIT_NAME[f.stock_unit] || '').toLowerCase();
  const save = async e => {
    e.preventDefault();
    const units = isBao ? [{ unit_code: 'bao', retail_price: +f.bao_r || 0, wholesale_price: +f.bao_w || +f.bao_r || 0, label: f.bao_label },
        { unit_code: 'kg', retail_price: +f.kg_r || 0, wholesale_price: +f.kg_w || +f.kg_r || 0, is_active: f.kg_on },
        { unit_code: 'tan', retail_price: +f.tan_r || 0, wholesale_price: +f.tan_w || +f.tan_r || 0, is_active: f.tan_on }]
      : isKg ? [{ unit_code: 'kg', retail_price: +f.kg_r || 0, wholesale_price: +f.kg_w || +f.kg_r || 0 },
        { unit_code: 'tan', retail_price: +f.tan_r || 0, wholesale_price: +f.tan_w || +f.tan_r || 0, is_active: f.tan_on }]
      : [{ unit_code: f.stock_unit, retail_price: +f.pc_r || 0, wholesale_price: +f.pc_w || +f.pc_r || 0 }];
    try {
      await rpc('save_product', { p: {
        id: p?.id, name: f.name, product_code: f.product_code, barcode: f.barcode, category_id: f.category_id || cats.data.find(c => c.name === 'Hàng hóa')?.id || cats.data[0].id,
        stock_unit: f.stock_unit, kg_per_bao: isBao ? kgpb : 1,
        ...(canCost && f.cost !== '' ? { cost_price: Number(f.cost) * (isBao ? kgpb : 1) } : {}),
        min_stock: Number(String(f.min_stock).replace(',', '.')) || 0, description: f.description, is_active: f.is_active, units } });
      toast('Đã lưu sản phẩm'); onSaved();
    } catch (er) { toast(er.message, 'err'); }
  };
  if (cats.loading) return <Loading />;
  const priceRow = (k, label, on) => (
    <div className={cx('grid grid-cols-[80px_1fr_1fr] gap-2 items-end', on === false && 'opacity-50')}>
      <span className="font-bold pb-3">{label}</span>
      <Field label="Giá lẻ (đ)"><Input inputMode="numeric" value={f[k + '_r']} onChange={set(k + '_r', digits)} disabled={on === false} /></Field>
      <Field label="Giá sỉ (đ)" hint="Trống = bằng giá lẻ"><Input inputMode="numeric" value={f[k + '_w']} onChange={set(k + '_w', digits)} disabled={on === false} /></Field>
    </div>);
  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="Tên sản phẩm *"><Input value={f.name} onChange={set('name')} required placeholder="vd: Gạo ST25" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nhóm"><Select value={f.category_id || cats.data.find(c => c.name === 'Hàng hóa')?.id || ''} onChange={set('category_id')}>{cats.data.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</Select></Field>
        <Field label="Mã SP" hint="Để trống: tự sinh"><Input value={f.product_code} onChange={set('product_code')} /></Field>
        <Field label={stockOn ? 'Tính tồn kho theo *' : 'Đơn vị bán *'} className="col-span-2" hint={p && stockOn ? 'Không đổi được khi đã nhập/bán' : ''}>
          <Select value={f.stock_unit} onChange={set('stock_unit')}>{STOCK_UNITS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</Select></Field>
        {isBao && <Field label="Số kg mỗi bao *"><Input inputMode="decimal" value={f.kg_per_bao} onChange={set('kg_per_bao')} required /></Field>}
        {stockOn && <Field label={`Cảnh báo khi tồn ≤ (${unitWord})`} hint="0 = không cảnh báo"><Input inputMode="decimal" value={f.min_stock} onChange={set('min_stock')} /></Field>}
      </div>
      <Field label="Mã vạch"><Input value={f.barcode} onChange={set('barcode')} placeholder="Quét hoặc nhập" /></Field>
      {canCost && <div className="rounded-2xl bg-violet-50 p-3">
        <Field label={`📦 Giá nhập (đ/${isPiece ? unitWord : 'kg'})`} hint={`Dùng để tính tiền vốn. Tự cập nhật theo phiếu nhập gần nhất.${isBao && f.cost && kgpb ? ' ≈ ' + money(Number(f.cost) * kgpb) + '/bao' : ''}`}>
          <Input inputMode="numeric" value={f.cost} onChange={set('cost', digits)} placeholder="vd: 12.000" /></Field>
      </div>}
      <div className="rounded-2xl bg-lua-50 p-3 space-y-2">
        <b>💰 Giá bán</b>
        {isBao && <>{priceRow('bao', '1 Bao')}
          <Field label="Tên khi bán nguyên bao (không bắt buộc)" hint="vd: bể 4 bao"><Input value={f.bao_label} onChange={set('bao_label')} /></Field>
          {Number(f.bao_r) > 0 && kgpb > 0 && <p className="text-xs text-slate-600">= {money(Number(f.bao_r) / kgpb)}/kg khi mua nguyên bao</p>}
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.kg_on} onChange={set('kg_on')} /> Bán lẻ theo kg</label></>}
        {(isBao || isKg) && priceRow('kg', '1 Kg', isBao ? f.kg_on : undefined)}
        {(isBao || isKg) && <><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.tan_on} onChange={set('tan_on')} /> Bán theo tấn</label>
          {priceRow('tan', '1 Tấn', f.tan_on)}</>}
        {isPiece && priceRow('pc', `1 ${UNIT_NAME[f.stock_unit]}`)}
        {isBao && <p className="text-xs text-slate-500">Quy đổi tự động: 1 kg = 1/{f.kg_per_bao || '?'} bao; 1 tấn = 1000/{f.kg_per_bao || '?'} bao.</p>}
      </div>
      <Field label="Mô tả"><Input value={f.description} onChange={set('description')} /></Field>
      {p && <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={f.is_active} onChange={set('is_active')} /> Đang kinh doanh (bỏ chọn = ngừng bán, không xóa)</label>}
      <Button className="w-full">💾 Lưu sản phẩm</Button>
    </form>
  );
}

function ProductView({ p, mgr, owner, stockOn = true, onClose, onEdit, onChanged }) {
  const toast = useToast();
  const [adj, setAdj] = useState({ unit: suCode(p), qty: '', sign: '-', reason: '' });
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
  const units = p.units.filter(u => u.is_active || u.unit_code === suCode(p));
  return (
    <Modal title={`${p.emoji} ${p.name}`} onClose={onClose} wide>
      {d.loading ? <Loading /> : d.error ? <ErrorBox error={d.error} /> : <>
        <div className={cx('grid gap-2 text-sm', stockOn ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {stockOn && <div className="rounded-2xl bg-ruong-50 p-3">Tồn kho<br /><b className="text-lg text-ruong-700">{qtyU(p, p.stock_bao)}</b>{suCode(p) === 'bao' && <><br />≈ {num(p.stock_kg, 1)} kg</>}</div>}
          <div className="rounded-2xl bg-lua-50 p-3">{p.units.filter(u => u.is_active).map(u => <div key={u.unit_code}>{unitLabel(u)}: <b>{money(u.retail_price)}</b>
            {baoPerKg(p, u) != null && <span className="text-xs"> ({money(baoPerKg(p, u))}/kg)</span>} · sỉ {money(u.wholesale_price)}</div>)}
            {!p.units.some(u => u.is_active && Number(u.retail_price) > 0) && <b className="text-rose-600">Chưa có giá bán</b>}</div>
          {mgr && <div className="rounded-2xl bg-violet-50 p-3">Giá nhập hiện hành<br /><b className="text-lg">{costText(p, d.data.cost)}</b>
            {!Number(d.data.cost) && <div className="text-xs text-rose-600 font-bold">Chưa có giá nhập: vốn sẽ tính 0</div>}</div>}
        </div>
        {p.description && <p className="text-xs text-slate-500 mt-2">{p.description}</p>}
        {mgr && stockOn && <>
          <h4 className="font-bold mt-4 mb-1">📦 Lô hàng còn tồn (xuất theo FIFO từ trên xuống)</h4>
          {d.data.lots.length ? d.data.lots.map(l => <div key={l.id} className="flex justify-between text-sm border-b py-1.5">
            <span>{l.lot_code} · {datetime(l.received_at)}</span><span><b>{num(l.qty_remaining, 3)}</b>/{qtyU(p, l.qty_in)} · {money(l.unit_cost)}/{su(p)}</span></div>) : <Empty icon="📦" text="Hết hàng" />}
          <div className="mt-4 rounded-2xl ring-2 ring-orange-300 p-3">
            <b>⚖️ Điều chỉnh kho</b> <span className="text-xs text-slate-500">(hao hụt, chênh lệch cân, kiểm kê)</span>
            <div className="grid grid-cols-[80px_1fr_110px] gap-2 mt-2">
              <Select value={adj.sign} onChange={e => setAdj({ ...adj, sign: e.target.value })}><option value="-">Giảm</option><option value="+">Tăng</option></Select>
              <Input inputMode="decimal" placeholder="Số lượng" value={adj.qty} onChange={e => setAdj({ ...adj, qty: e.target.value })} />
              <Select value={adj.unit} onChange={e => setAdj({ ...adj, unit: e.target.value })}>{units.map(u => <option key={u.unit_code} value={u.unit_code}>{u.unit_name}</option>)}</Select>
            </div>
            <Input className="mt-2" placeholder="Lý do (bắt buộc), vd: Cân lại thiếu 5 kg" value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} />
            <Button small color="gold" className="mt-2" onClick={doAdj} disabled={!Number(adj.qty) || !adj.reason.trim()}>Tạo phiếu điều chỉnh</Button>
          </div>
        </>}
        {stockOn && <h4 className="font-bold mt-4 mb-1">📜 Biến động kho gần đây</h4>}
        {stockOn && <TxnList rows={d.data.txns} unit={() => su(p)} onDelAdj={owner ? async t => { await rpc('delete_stock_adjustment', { p_id: t.ref_id }); toast('Đã xóa phiếu điều chỉnh, kho đã trả lại'); d.reload(); onChanged(); } : null} />}
        <div className="flex flex-wrap gap-2 mt-4">
          {mgr && <Button color="ghost" onClick={onEdit}>✏️ Sửa sản phẩm / giá</Button>}
          {owner && <DeleteButton title={`Xóa sản phẩm ${p.name}?`} label="🗑️ Xóa sản phẩm"
            onConfirm={async () => { await rpc('delete_product', { p_id: p.id }); toast(`Đã xóa ${p.name}`); onChanged(); onClose(); }}>
            <p><b>{p.product_code} · {p.name}</b></p>
            <p className="text-slate-500">Chỉ xóa được sản phẩm chưa nhập/bán lần nào. Nếu đã có, hãy xóa các phiếu đó trước, hoặc bỏ chọn “Đang kinh doanh” để ngừng bán.</p>
          </DeleteButton>}
        </div>
      </>}
    </Modal>
  );
}

// NHẬP TỒN KHO ĐẦU KỲ: gõ số lượng đang có của từng mặt hàng (theo đơn vị tồn kho), lưu 1 lần
function OpeningStock({ prods, cost, onClose, onDone }) {
  const toast = useToast();
  const [qty, setQty] = useState({}); const [s, setS] = useState(''); const [busy, setBusy] = useState(false);
  const list = prods.filter(p => p.is_active && (!s || [p.name, p.product_code].some(x => x.toLowerCase().includes(s.toLowerCase()))));
  const items = Object.entries(qty).map(([id, v]) => ({ product_id: id, quantity: Number(String(v).replace(',', '.')) })).filter(x => x.quantity > 0);
  const value = items.reduce((a, x) => a + x.quantity * (cost[x.product_id] || 0), 0);
  const save = async () => {
    setBusy(true);
    try { const r = await rpc('create_opening_stock', { p_items: items }); toast(`Đã nhập tồn đầu kỳ cho ${r.count} mặt hàng`); onDone(); onClose(); }
    catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title="📥 Nhập tồn kho đầu kỳ" onClose={() => !busy && onClose()} wide>
      <p className="text-sm">Gõ số lượng <b>đang có trong kho</b> của từng mặt hàng (theo đơn vị ghi bên cạnh). Số này được <b>cộng thêm</b> vào tồn hiện tại, giá vốn lấy theo giá nhập của mặt hàng. Ô để trống thì bỏ qua.</p>
      <Input className="mt-3" value={s} onChange={e => setS(e.target.value)} placeholder="🔎 Tìm tên hoặc mã" />
      <div className="mt-2 max-h-[50vh] overflow-auto divide-y">
        {list.map(p => (
          <label key={p.id} className="flex items-center gap-2 py-2">
            <span className="flex-1 min-w-0 text-sm"><b>{p.name}</b><div className="text-xs text-slate-500">{p.product_code} · đang có {qtyU(p, p.stock_bao)}{!cost[p.id] && <span className="text-orange-600"> · chưa có giá nhập</span>}</div></span>
            <Input inputMode="decimal" className="!w-28 text-right" value={qty[p.id] || ''} onChange={e => setQty({ ...qty, [p.id]: e.target.value })} placeholder="0" />
            <span className="w-14 text-sm font-semibold">{su(p)}</span>
          </label>))}
      </div>
      <div className="mt-3 rounded-2xl bg-ruong-50 p-3 text-sm flex justify-between"><span>{items.length} mặt hàng</span><b>Giá trị theo giá nhập ≈ {money(value)}</b></div>
      <Button className="w-full mt-3" onClick={save} disabled={busy || !items.length}>{busy ? 'Đang lưu…' : `💾 Lưu tồn đầu kỳ (${items.length})`}</Button>
    </Modal>
  );
}

const TxnList = ({ rows, names, unit = () => 'bao', onDelAdj }) => rows.length ? rows.map(t => (
  <div key={t.id} className="flex justify-between items-center gap-2 text-sm border-b py-1.5">
    <span className="flex-1">{datetime(t.created_at)} · <b className={TXN[t.txn_type][1]}>{TXN[t.txn_type][0]}</b>{names && <> · {names[t.product_id]}</>} <span className="text-slate-500">{t.note}</span></span>
    <b className={t.qty_change > 0 ? 'text-ruong-700' : 'text-rose-600'}>{t.qty_change > 0 ? '+' : ''}{num(t.qty_change, 3)} {unit(t.product_id)}</b>
    {onDelAdj && t.ref_table === 'stock_adjustments' && <DeleteButton icon title="Xóa phiếu điều chỉnh này?" onConfirm={() => onDelAdj(t)}>
      <p><b>{t.note}</b> · {t.qty_change > 0 ? '+' : ''}{num(t.qty_change, 3)} {unit(t.product_id)} · {datetime(t.created_at)}</p>
      <p>Số lượng đã {t.qty_change > 0 ? 'cộng thêm sẽ bị trừ lại' : 'trừ sẽ được trả lại đúng lô'}.</p>
    </DeleteButton>}</div>)) : <Empty text="Chưa có biến động" />;

function StockHistory() {
  const d = useLoad(async () => {
    const [rows, prods] = await Promise.all([q(supabase.from('inventory_transactions').select('*').order('created_at', { ascending: false }).limit(200)),
      q(supabase.from('v_products').select('id,name,stock_unit_name'))]);
    return { rows, names: Object.fromEntries(prods.map(p => [p.id, p.name])), units: Object.fromEntries(prods.map(p => [p.id, su(p)])) };
  }, []);
  return <Card title="Lịch sử biến động kho (200 dòng gần nhất)" icon="📜" accent="from-amber-500 to-orange-400">
    {d.loading ? <Loading /> : d.error ? <ErrorBox error={d.error} /> : <TxnList rows={d.data.rows} names={d.data.names} unit={id => d.data.units[id] || ''} />}
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
