// Kiểm thử nghiệp vụ trên Supabase chạy cục bộ: node tests/business.test.mjs
import { createClient } from '@supabase/supabase-js';
const URL = process.env.SB_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SB_ANON, SERVICE = process.env.SB_SERVICE;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); } };
const eq = (a, b, m) => ok(Number(a) === Number(b), `${m} (được ${a}, mong đợi ${b})`);

async function user(email, name) {
  await admin.auth.admin.createUser({ email, password: 'Matkhau@123', email_confirm: true, user_metadata: { full_name: name } });
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: 'Matkhau@123' });
  if (error) throw error;
  return c;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error: error?.message }; };

const owner = await user('chu@test.vn', 'Chủ cửa hàng');
const staff = await user('nv@test.vn', 'Nhân viên A');
const myRole = async c => (await c.from('profiles').select('role').eq('id', (await c.auth.getUser()).data.user.id).single()).data;
const me = await myRole(owner);
ok(me.role === 'owner', 'Tài khoản đầu tiên là Chủ cửa hàng');
const meS = await myRole(staff);
ok(meS.role === 'staff', 'Tài khoản sau là Nhân viên');

console.log('\n1. Sản phẩm & quy đổi đơn vị (kho theo bao)');
const { data: cats } = await owner.from('categories').select('*');
const gao = cats.find(c => c.name === 'Gạo').id;
let r = await rpc(owner, 'save_product', { p: { name: 'Gạo ST25', category_id: gao, kg_per_bao: 50, min_stock: 5,
  units: [{ unit_code: 'bao', retail_price: 1500000, wholesale_price: 1400000 }, { unit_code: 'kg', retail_price: 32000, wholesale_price: 30000 }] } });
ok(!r.error, 'Chủ tạo được sản phẩm ' + (r.error || ''));
const st25 = r.data.id;
r = await rpc(staff, 'save_product', { p: { name: 'Lậu', category_id: gao, kg_per_bao: 10, units: [{ unit_code: 'bao', retail_price: 1 }] } });
ok(r.error?.includes('không có quyền'), 'Nhân viên KHÔNG tạo được sản phẩm');
const { data: vp } = await owner.from('v_products').select('*').eq('id', st25).single();
ok(vp.product_code === 'GAO001', 'Mã SP tự sinh GAO001');
eq(vp.units.find(u => u.unit_code === 'kg').factor, 0.02, '1 kg = 0,02 bao (bao 50 kg)');

console.log('\n2. Nhập hàng tạo lô FIFO');
const { data: sup } = await owner.from('suppliers').insert({ name: 'Nhà máy xay Sóc Trăng' }).select().single();
r = await rpc(owner, 'create_purchase_receipt', { p: { supplier_id: sup.id, items: [{ product_id: st25, unit_code: 'bao', quantity: 10, unit_price: 1000000 }], paid_amount: 10000000 } });
ok(!r.error && r.data.receipt_code === 'PN0001', 'Phiếu nhập PN0001: 10 bao giá 1.000.000');
r = await rpc(owner, 'create_purchase_receipt', { p: { supplier_id: sup.id, items: [{ product_id: st25, unit_code: 'bao', quantity: 10, unit_price: 1200000 }], paid_amount: 2000000 } });
ok(!r.error, 'Phiếu nhập PN0002: 10 bao giá 1.200.000, trả 2 triệu (nợ NCC 10 triệu)');
r = await rpc(staff, 'create_purchase_receipt', { p: { items: [{ product_id: st25, unit_code: 'bao', quantity: 1, unit_price: 1 }], paid_amount: 1 } });
ok(r.error?.includes('không có quyền'), 'Nhân viên KHÔNG tạo được phiếu nhập');

console.log('\n3. Bán hàng: trừ kho FIFO qua 2 lô, kho + quỹ + công nợ cùng transaction');
const { data: kh } = await staff.from('customers').insert({ name: 'Cô Ba tạp hóa', phone: '0900000000', customer_type: 'le' }).select().single();
ok(kh?.code === 'KH0001', 'Nhân viên thêm được khách, mã KH0001');
r = await rpc(staff, 'create_sales_invoice', { p: { customer_id: kh.id, items: [
  { product_id: st25, unit_code: 'bao', quantity: 12 }, { product_id: st25, unit_code: 'kg', quantity: 25, discount: 0 }],
  discount: 100000, paid_amount: 10000000, account_code: 'cash' } });
ok(!r.error, 'Nhân viên lập hóa đơn ' + (r.error || r.data.invoice_code));
const inv1 = r.data;
eq(inv1.total_amount, 12 * 1500000 + 25 * 32000 - 100000, 'Tổng = 12 bao × 1,5tr + 25 kg × 32k − 100k');
eq(inv1.debt_amount, inv1.total_amount - 10000000, 'Còn nợ = Tổng − Đã trả');
let { data: bal } = await owner.from('inventory_balances').select('qty').eq('product_id', st25).single();
eq(bal.qty, 20 - 12.5, 'Tồn còn 7,5 bao (12 bao + 25 kg = 12,5 bao)');
const { data: lots } = await owner.from('inventory_lots').select('lot_code,qty_remaining').eq('product_id', st25).order('seq');
eq(lots[0].qty_remaining, 0, 'Lô PN0001 dùng hết trước (FIFO)');
eq(lots[1].qty_remaining, 7.5, 'Lô PN0002 còn 7,5 bao');
const { data: pr } = await owner.rpc('profit_report', { p_from: '2000-01-01', p_to: '2100-01-01' });
eq(pr.cogs, 625 * 24000, 'Vốn = 625 kg bán × giá nhập 24.000đ/kg (giá nhập hiện hành lúc bán)');

console.log('\n4. Quy tắc chặn');
r = await rpc(staff, 'create_sales_invoice', { p: { customer_id: kh.id, items: [{ product_id: st25, unit_code: 'bao', quantity: 1, unit_price: 1000 }], paid_amount: 1000 } });
ok(r.error?.includes('không được đổi giá'), 'Nhân viên không đổi được giá bán');
r = await rpc(staff, 'create_sales_invoice', { p: { items: [{ product_id: st25, unit_code: 'bao', quantity: 1 }], paid_amount: 0 } });
ok(r.error?.includes('phải chọn khách'), 'Khách lẻ không được ghi nợ ' + r.error);
r = await rpc(staff, 'create_sales_invoice', { p: { items: [{ product_id: st25, unit_code: 'bao', quantity: 1 }, { product_id: st25, unit_code: 'bao', quantity: 100 }], paid_amount: 999999999 } });
ok(r.error?.includes('Không đủ tồn kho'), 'Bán vượt tồn bị chặn ' + r.error);
({ data: bal } = await owner.from('inventory_balances').select('qty').eq('product_id', st25).single());
eq(bal.qty, 7.5, 'Hóa đơn lỗi được hoàn tác toàn bộ (dòng 1 không bị trừ kho)');
let e = await staff.from('sales_invoices').insert({ invoice_code: 'X', subtotal: 0, total_amount: 0 });
ok(!!e.error, 'Không ghi thẳng vào bảng hóa đơn được');
e = await staff.from('inventory_balances').update({ qty: 999 }).eq('product_id', st25).select();
ok(!!e.error || (e.data || []).length === 0, 'Không sửa thẳng số tồn được');
e = await owner.from('sales_invoices').delete().eq('id', inv1.id).select();
ok(!!e.error || (e.data || []).length === 0, 'Không xóa được hóa đơn (kể cả Chủ)');
e = await staff.from('products').select('cost_price');
ok(!!e.error, 'Nhân viên không đọc được giá vốn');
e = await staff.from('inventory_lots').select('*');
ok((e.data || []).length === 0, 'Nhân viên không xem được lô hàng / giá nhập');
r = await rpc(staff, 'profit_report', { p_from: '2000-01-01', p_to: '2100-01-01' });
ok(r.error?.includes('không có quyền'), 'Nhân viên không xem được báo cáo lợi nhuận');

console.log('\n5. Thu nợ KHÔNG tính là doanh thu');
let { data: d1 } = await owner.rpc('dashboard_summary');
r = await rpc(staff, 'record_customer_payment', { p_customer: kh.id, p_amount: 3000000, p_account: 'bank', p_note: '' });
ok(!r.error, 'Thu nợ 3 triệu ' + (r.error || r.data.payment_code));
let { data: d2, error: de } = await owner.rpc('dashboard_summary'); if (de) console.log(de);
eq(d2.revenue_today, d1.revenue_today, 'Doanh thu không đổi sau khi thu nợ');
eq(d2.cash_in_today - d1.cash_in_today, 3000000, 'Thực thu tăng 3 triệu');
eq(d1.receivable - d2.receivable, 3000000, 'Công nợ phải thu giảm 3 triệu');
eq(d2.payable, 10000000, 'Nợ NCC = 10 triệu');
r = await rpc(staff, 'record_customer_payment', { p_customer: kh.id, p_amount: 999999999, p_account: 'cash', p_note: '' });
ok(r.error?.includes('chỉ còn nợ'), 'Không thu quá số nợ');

console.log('\n6. Hủy hóa đơn: trả hàng về đúng lô, hoàn quỹ, giữ lịch sử');
r = await rpc(staff, 'create_sales_invoice', { p: { items: [{ product_id: st25, unit_code: 'bao', quantity: 2 }], paid_amount: 3000000, account_code: 'cash' } });
const inv2 = r.data;
r = await rpc(staff, 'cancel_sales_invoice', { p_id: inv2.id, p_reason: 'Khách đổi ý' });
ok(r.error?.includes('không có quyền'), 'Nhân viên không hủy được hóa đơn');
r = await rpc(owner, 'cancel_sales_invoice', { p_id: inv2.id, p_reason: 'Khách đổi ý' });
ok(!r.error, 'Chủ hủy được hóa đơn ' + (r.error || ''));
({ data: bal } = await owner.from('inventory_balances').select('qty').eq('product_id', st25).single());
eq(bal.qty, 7.5, 'Tồn trở lại 7,5 bao');
const { data: inv2row } = await owner.from('sales_invoices').select('status,cancel_reason').eq('id', inv2.id).single();
ok(inv2row.status === 'cancelled' && inv2row.cancel_reason === 'Khách đổi ý', 'Hóa đơn vẫn còn, trạng thái "đã hủy" kèm lý do');
r = await rpc(owner, 'cancel_sales_invoice', { p_id: inv1.id, p_reason: 'thử' });
ok(r.error?.includes('thu nợ một phần'), 'Hóa đơn đã thu nợ thì không hủy ngang được');

console.log('\n7. Điều chỉnh hao hụt cân');
r = await rpc(owner, 'create_stock_adjustment', { p_product: st25, p_unit: 'kg', p_quantity: -5, p_reason: 'Cân lại thiếu 5 kg' });
ok(!r.error, 'Phiếu điều chỉnh −5 kg ' + (r.error || r.data.adjustment_code));
({ data: bal } = await owner.from('inventory_balances').select('qty').eq('product_id', st25).single());
eq(bal.qty, 7.4, 'Tồn còn 7,4 bao');
r = await rpc(owner, 'create_stock_adjustment', { p_product: st25, p_unit: 'kg', p_quantity: -5, p_reason: '' });
ok(r.error?.includes('lý do'), 'Điều chỉnh bắt buộc có lý do');

console.log('\n8. Đối soát kho');
const { data: rec } = await owner.rpc('reconcile_inventory');
ok(rec.length === 0, 'Số tồn = tổng giao dịch = tổng lô còn lại');
const { data: d3 } = await owner.rpc('dashboard_summary');
ok(d3.gross_profit_today !== null && d3.revenue_today > 0, 'Dashboard chủ thấy lợi nhuận');
const { data: d4 } = await staff.rpc('dashboard_summary');
ok(d4.gross_profit_today === null && d4.stock_value === null, 'Dashboard nhân viên ẩn lợi nhuận & giá trị kho');


console.log('\n9. Chi tiêu: thêm / sửa / xóa, đồng bộ sổ quỹ');
r = await rpc(owner, 'save_expense', { p: { name: 'Tiền điện tháng 11', amount: 850000, note: 'EVN' } });
ok(!r.error, 'Thêm khoản chi ' + (r.error || ''));
const exId = r.data.id;
let { data: ex } = await owner.from('expenses').select('*').eq('id', exId).single();
let { data: ct } = await owner.from('cash_transactions').select('*').eq('id', ex.cash_txn_id).single();
eq(ct.amount, 850000, 'Sổ quỹ có dòng chi 850.000');
r = await rpc(owner, 'save_expense', { p: { id: exId, name: 'Tiền điện T11', amount: 900000, note: 'sửa', account_code: 'bank' } });
ok(!r.error, 'Sửa khoản chi');
({ data: ct } = await owner.from('cash_transactions').select('amount,party_name').eq('id', ex.cash_txn_id).single());
ok(Number(ct.amount) === 900000 && ct.party_name === 'Tiền điện T11', 'Sổ quỹ cập nhật theo khi sửa');
r = await rpc(staff, 'save_expense', { p: { name: 'x', amount: 1 } });
ok(r.error?.includes('không có quyền'), 'Nhân viên không ghi được chi tiêu');
r = await rpc(owner, 'save_expense', { p: { name: '', amount: 1000 } });
ok(r.error?.includes('tên khoản chi'), 'Bắt buộc có tên khoản chi');
r = await rpc(owner, 'delete_expense', { p_id: exId });
ok(!r.error, 'Xóa khoản chi');
({ data: ct } = await owner.from('cash_transactions').select('id').eq('id', ex.cash_txn_id));
ok(ct.length === 0, 'Dòng sổ quỹ bị xóa theo');
const { data: lg } = await owner.from('audit_logs').select('action').eq('record_id', exId);
ok(lg.some(x => x.action === 'delete_expense'), 'Nhật ký giữ lại khoản chi đã xóa');

console.log('\n10. Doanh thu & lợi nhuận theo ngày');
const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
r = await rpc(owner, 'daily_report', { p_from: iso, p_to: iso });
const { data: pr2 } = await owner.rpc('profit_report', { p_from: iso, p_to: iso });
eq(r.data[0].revenue, pr2.revenue, 'Doanh thu ngày khớp');
eq(r.data[0].profit, Number(pr2.revenue) - Number(pr2.cogs), 'Lợi nhuận ngày = doanh thu − vốn');
r = await rpc(staff, 'daily_report', { p_from: iso, p_to: iso });
ok(r.error?.includes('không có quyền'), 'Nhân viên không xem được lợi nhuận ngày');


console.log('\n11. Vốn = kg bán × giá nhập/kg, chốt lúc bán');
const day = iso;
const det = (await owner.rpc('daily_cost_detail', { p_day: day })).data;
const rep = (await owner.rpc('daily_report', { p_from: day, p_to: day })).data[0];
eq(det.reduce((a, x) => a + Number(x.cost), 0), rep.cost, 'Tổng chi tiết vốn = vốn trong báo cáo ngày');
ok(det.every(x => Math.abs(Math.round(Number(x.kg_sold) * Number(x.cost_per_kg)) - Number(x.cost)) <= 1), 'Từng món: vốn = kg × giá nhập/kg');
r = await rpc(owner, 'save_product', { p: { id: st25, name: 'Gạo ST25', category_id: gao, kg_per_bao: 50, min_stock: 5, cost_price: 50 * 30000,
  units: [{ unit_code: 'bao', retail_price: 1500000, wholesale_price: 1400000 }, { unit_code: 'kg', retail_price: 32000, wholesale_price: 30000 }] } });
ok(!r.error, 'Chủ sửa giá nhập thành 30.000đ/kg ' + (r.error || ''));
const rep2 = (await owner.rpc('daily_report', { p_from: day, p_to: day })).data[0];
eq(rep2.cost, rep.cost, 'Đổi giá nhập KHÔNG làm thay đổi vốn các hóa đơn đã bán');
r = await rpc(owner, 'create_sales_invoice', { p: { items: [{ product_id: st25, unit_code: 'kg', quantity: 10 }], paid_amount: 320000 } });
const rep3 = (await owner.rpc('daily_report', { p_from: day, p_to: day })).data[0];
eq(rep3.cost - rep2.cost, 10 * 30000, 'Hóa đơn mới: 10 kg × 30.000đ = 300.000đ vốn');
r = await rpc(staff, 'daily_cost_detail', { p_day: day });
ok(r.error?.includes('không có quyền'), 'Nhân viên không xem được chi tiết vốn');
e = await staff.from('sales_item_costs').select('*');
ok((e.data || []).length === 0, 'Nhân viên không đọc được bảng giá vốn');

console.log(`\nKẾT QUẢ: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
