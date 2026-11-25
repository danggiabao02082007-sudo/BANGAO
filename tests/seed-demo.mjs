// Thêm dữ liệu mẫu để xem giao diện (chỉ dùng cho môi trường thử nghiệm cục bộ)
import { createClient } from '@supabase/supabase-js';
const c = createClient('http://127.0.0.1:54321', process.env.SB_ANON, { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: 'chu@test.vn', password: 'Matkhau@123' });
const cats = Object.fromEntries((await c.from('categories').select('*')).data.map(x => [x.name, x.id]));
const mk = async (name, cat, kg, bao, baoS, kgR, kgS, min) => (await c.rpc('save_product', { p: { name, category_id: cats[cat], kg_per_bao: kg, min_stock: min,
  units: [{ unit_code: 'bao', retail_price: bao, wholesale_price: baoS }, { unit_code: 'kg', retail_price: kgR, wholesale_price: kgS, is_active: kgR > 0 }] } })).data.id;
const ids = [await mk('Gạo Nàng Hoa 9', 'Gạo', 25, 520000, 495000, 22000, 20500, 4), await mk('Nếp cái hoa vàng', 'Gạo', 10, 380000, 360000, 40000, 38000, 3),
  await mk('Gạo Tài Nguyên', 'Gạo', 50, 950000, 910000, 20000, 19000, 3), await mk('Lúa OM5451', 'Lúa', 40, 360000, 340000, 0, 0, 5),
  await mk('Cám gạo loại 1', 'Cám', 40, 260000, 245000, 7000, 6500, 5)];
const { data: sup } = await c.from('suppliers').insert({ name: 'HTX Nông nghiệp Cần Thơ', phone: '0292 3800 000' }).select().single();
await c.rpc('create_purchase_receipt', { p: { supplier_id: sup.id, paid_amount: 20000000, items: [
  { product_id: ids[0], unit_code: 'bao', quantity: 40, unit_price: 450000 }, { product_id: ids[1], unit_code: 'bao', quantity: 20, unit_price: 320000 },
  { product_id: ids[2], unit_code: 'bao', quantity: 15, unit_price: 830000 }, { product_id: ids[3], unit_code: 'bao', quantity: 30, unit_price: 300000 },
  { product_id: ids[4], unit_code: 'bao', quantity: 4, unit_price: 210000 }] } });
const kh = (await c.from('customers').insert([{ name: 'Quán cơm Bà Năm', phone: '0912345678', customer_type: 'si' }, { name: 'Anh Tư xóm Chợ', phone: '0987654321', customer_type: 'le' }]).select()).data;
await c.rpc('create_sales_invoice', { p: { customer_id: kh[0].id, paid_amount: 2000000, items: [{ product_id: ids[0], unit_code: 'bao', quantity: 6 }, { product_id: ids[1], unit_code: 'kg', quantity: 15 }] } });
await c.rpc('create_sales_invoice', { p: { customer_id: kh[1].id, paid_amount: 900000, account_code: 'bank', items: [{ product_id: ids[2], unit_code: 'bao', quantity: 1 }] } });
await c.rpc('create_sales_invoice', { p: { paid_amount: 999999999, cash_given: 500000, items: [{ product_id: ids[0], unit_code: 'kg', quantity: 10 }, { product_id: ids[4], unit_code: 'bao', quantity: 1 }] } });
await c.rpc('record_cash', { p_direction: 'out', p_category: 'transport', p_amount: 150000, p_account: 'cash', p_party: 'Xe ba gác', p_note: 'Chở gạo' });
await c.from('store_settings').update({ store_name: 'Cửa hàng gạo Gia Bảo', address: '123 Đường Lúa Vàng', phone: '0900 000 000' }).eq('id', 1);
console.log('seeded');
