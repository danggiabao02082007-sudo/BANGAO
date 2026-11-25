-- =====================================================================
-- BẢO MẬT (Row Level Security)
-- · Mọi bảng chứng từ/kho/quỹ: KHÔNG cho ghi trực tiếp — chỉ qua hàm nghiệp vụ.
-- · Không có quyền DELETE ở bất kỳ bảng nào (xóa mềm bằng is_active / trạng thái).
-- · Nhân viên không xem giá vốn, lô hàng, phiếu nhập, lợi nhuận.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['profiles','store_settings','doc_counters','audit_logs','categories','units','products','product_units',
    'product_prices','customers','suppliers','warehouses','inventory_balances','inventory_lots','inventory_transactions',
    'stock_adjustments','stock_adjustment_items','cash_accounts','expense_categories','cash_transactions','payments',
    'purchase_receipts','purchase_receipt_items','sales_invoices','sales_invoice_items','sales_item_lots',
    'payment_allocations','receivable_payable_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- Đọc: mọi tài khoản đang hoạt động
do $$
declare t text;
begin
  foreach t in array array['store_settings','categories','units','products','product_units','customers','suppliers','warehouses',
    'inventory_balances','inventory_transactions','cash_accounts','expense_categories','sales_invoices','sales_invoice_items',
    'payments','payment_allocations','receivable_payable_entries','stock_adjustments','stock_adjustment_items'] loop
    execute format('create policy "doc_moi_nguoi" on public.%I for select to authenticated using (public.my_role() is not null)', t);
  end loop;
end $$;

-- Đọc: chỉ Chủ & Quản lý
do $$
declare t text;
begin
  foreach t in array array['inventory_lots','sales_item_lots','purchase_receipts','purchase_receipt_items','cash_transactions',
    'product_prices','audit_logs'] loop
    execute format('create policy "doc_quan_ly" on public.%I for select to authenticated using (public.has_role(''owner'',''manager''))', t);
  end loop;
end $$;

-- Hồ sơ người dùng
create policy "xem_ho_so" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('owner'));
grant update (full_name) on public.profiles to authenticated;
create policy "sua_ten_minh" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Nhân viên không đọc được cột giá vốn
revoke select on public.products from authenticated;
grant select (id, product_code, barcode, name, category_id, kg_per_bao, min_stock, description, is_active, created_at, updated_at)
  on public.products to authenticated;
revoke select on public.sales_invoices from authenticated;
grant select on public.sales_invoices to authenticated;  -- hóa đơn không chứa giá vốn

-- Danh mục khách hàng: mọi nhân sự được thêm/sửa (cần khi bán hàng)
grant insert (code, name, phone, address, email, customer_type, note), update (name, phone, address, email, customer_type, note, is_active)
  on public.customers to authenticated;
create policy "them_khach" on public.customers for insert to authenticated with check (public.my_role() is not null);
create policy "sua_khach" on public.customers for update to authenticated using (public.my_role() is not null);

-- Nhà cung cấp & thông tin cửa hàng: Chủ & Quản lý
grant insert (code, name, phone, address, email, note), update (name, phone, address, email, note, is_active) on public.suppliers to authenticated;
create policy "them_ncc" on public.suppliers for insert to authenticated with check (public.has_role('owner','manager'));
create policy "sua_ncc" on public.suppliers for update to authenticated using (public.has_role('owner','manager'));
grant update (store_name, address, phone, invoice_footer, updated_at) on public.store_settings to authenticated;
create policy "sua_cua_hang" on public.store_settings for update to authenticated using (public.has_role('owner'));

-- Mã khách hàng / NCC tự sinh
create or replace function public.auto_party_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.code,'') = '' then
    new.code := public.next_code(case tg_table_name when 'customers' then 'KH' else 'NCC' end, 4);
  end if;
  return new;
end $$;
alter table public.customers alter column code drop not null;
alter table public.suppliers alter column code drop not null;
create trigger trg_customer_code before insert on public.customers for each row execute function public.auto_party_code();
create trigger trg_supplier_code before insert on public.suppliers for each row execute function public.auto_party_code();

-- Hàm: chỉ người đăng nhập được gọi
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._add_lot(uuid,numeric,numeric,text,uuid,text,text,text), public._fifo_consume(uuid,numeric,text,text,uuid,text),
  public._bump_balance(uuid,numeric), public.next_code(text,int), public.audit(text,text,uuid,jsonb) from authenticated;

-- Chế độ xem tiện dụng (tuân theo RLS của người xem)
create view public.v_products with (security_invoker = on) as
select p.id, p.product_code, p.barcode, p.name, p.category_id, c.name as category_name, c.emoji, p.kg_per_bao, p.min_stock,
       p.description, p.is_active, coalesce(b.qty,0) as stock_bao, coalesce(b.qty,0) * p.kg_per_bao as stock_kg,
       (select jsonb_agg(jsonb_build_object('unit_code', u.code, 'unit_name', u.name, 'factor', pu.factor,
          'retail_price', pu.retail_price, 'wholesale_price', pu.wholesale_price, 'is_active', pu.is_active) order by pu.factor desc)
        from public.product_units pu join public.units u on u.id = pu.unit_id where pu.product_id = p.id) as units
from public.products p join public.categories c on c.id = p.category_id left join public.inventory_balances b on b.product_id = p.id;

create view public.v_customers with (security_invoker = on) as
select c.*, coalesce((select sum(amount) from public.receivable_payable_entries e where e.party_type='customer' and e.party_id = c.id),0) as debt,
       coalesce((select sum(total_amount) from public.sales_invoices i where i.customer_id = c.id and i.status='completed'),0) as total_bought
from public.customers c;

create view public.v_suppliers with (security_invoker = on) as
select s.*, coalesce((select sum(amount) from public.receivable_payable_entries e where e.party_type='supplier' and e.party_id = s.id),0) as debt
from public.suppliers s;

grant select on public.v_products, public.v_customers, public.v_suppliers to authenticated;
