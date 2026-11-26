-- GẠO VIỆT — CÀI ĐẶT CSDL (dán toàn bộ file này vào Supabase → SQL Editor → Run, chạy 1 lần trên project mới)

-- ===== 20261125000001_schema.sql =====
-- =====================================================================
-- ỨNG DỤNG QUẢN LÝ & BÁN GẠO — LƯỢC ĐỒ CSDL (Giai đoạn 1)
-- Quyết định đã chốt: Supabase cloud · chỉ online · giá vốn FIFO theo lô ·
-- tồn kho tính theo BAO (mỗi SP có số kg/bao riêng để quy đổi).
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- Vai trò ----------
create type public.app_role as enum ('owner','manager','staff');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  role public.app_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.has_role(variadic r public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = any(r), false)
$$;

-- Người đăng ký đầu tiên = Chủ cửa hàng, các tài khoản sau = Nhân viên.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, email, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          new.email,
          case when exists(select 1 from public.profiles) then 'staff'::public.app_role else 'owner'::public.app_role end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Hệ thống ----------
create table public.store_settings (
  id int primary key default 1 check (id = 1),
  store_name text not null default 'Cửa hàng gạo',
  address text not null default '',
  phone text not null default '',
  invoice_footer text not null default 'Cảm ơn quý khách!',
  updated_at timestamptz not null default now()
);
insert into public.store_settings default values;

create table public.doc_counters (prefix text primary key, last_no int not null default 0);

create table public.audit_logs (
  id bigserial primary key,
  user_id uuid default auth.uid(),
  action text not null,
  table_name text,
  record_id uuid,
  data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.next_code(p_prefix text, p_width int) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.doc_counters(prefix, last_no) values (p_prefix, 1)
  on conflict (prefix) do update set last_no = public.doc_counters.last_no + 1
  returning last_no into n;
  return p_prefix || lpad(n::text, p_width, '0');
end $$;

-- ---------- Nhóm A: Sản phẩm ----------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  emoji text not null default '🌾',
  sort int not null default 0
);
insert into public.categories(name, emoji, sort) values ('Gạo','🍚',1), ('Lúa','🌾',2), ('Cám','🟤',3);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);
insert into public.units(code, name) values ('bao','Bao'), ('kg','Kg'), ('tan','Tấn');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique,
  barcode text unique,
  name text not null,
  category_id uuid not null references public.categories(id),
  kg_per_bao numeric(10,3) not null check (kg_per_bao > 0),
  cost_price numeric(14,2) not null default 0,         -- giá nhập tham khảo / bao (chỉ chủ & quản lý xem)
  min_stock numeric(14,4) not null default 0,           -- mức cảnh báo, tính theo bao
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Quy đổi & giá theo từng đơn vị bán. factor = số BAO tương ứng 1 đơn vị.
create table public.product_units (
  product_id uuid not null references public.products(id),
  unit_id uuid not null references public.units(id),
  factor numeric(18,8) not null check (factor > 0),
  retail_price numeric(14,0) not null default 0 check (retail_price >= 0),
  wholesale_price numeric(14,0) not null default 0 check (wholesale_price >= 0),
  is_active boolean not null default true,
  primary key (product_id, unit_id)
);

-- Lịch sử giá bán (ghi tự động khi giá thay đổi)
create table public.product_prices (
  id bigserial primary key,
  product_id uuid not null references public.products(id),
  unit_id uuid not null references public.units(id),
  retail_price numeric(14,0) not null,
  wholesale_price numeric(14,0) not null,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create or replace function public.log_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.retail_price is distinct from old.retail_price
     or new.wholesale_price is distinct from old.wholesale_price then
    insert into public.product_prices(product_id, unit_id, retail_price, wholesale_price)
    values (new.product_id, new.unit_id, new.retail_price, new.wholesale_price);
  end if;
  return new;
end $$;
create trigger trg_price_history after insert or update on public.product_units
  for each row execute function public.log_price_change();

-- ---------- Nhóm B: Đối tác ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  phone text not null default '',
  address text not null default '',
  email text not null default '',
  customer_type text not null default 'le' check (customer_type in ('le','si')),
  note text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  phone text not null default '',
  address text not null default '',
  email text not null default '',
  note text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Nhóm D: Kho (FIFO theo lô) ----------
create table public.warehouses (id uuid primary key default gen_random_uuid(), name text not null);
insert into public.warehouses(name) values ('Kho chính');

create table public.inventory_balances (
  product_id uuid primary key references public.products(id),
  qty numeric(14,4) not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now()
);

create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  seq bigserial,
  product_id uuid not null references public.products(id),
  lot_code text not null,
  source_type text not null check (source_type in ('purchase','adjustment')),
  source_id uuid,
  received_at timestamptz not null default now(),
  qty_in numeric(14,4) not null check (qty_in > 0),
  qty_remaining numeric(14,4) not null check (qty_remaining >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),   -- giá vốn / bao
  created_at timestamptz not null default now()
);
create index on public.inventory_lots(product_id, received_at, seq) where qty_remaining > 0;

create table public.inventory_transactions (
  id bigserial primary key,
  product_id uuid not null references public.products(id),
  lot_id uuid references public.inventory_lots(id),
  txn_type text not null check (txn_type in ('purchase','sale','sale_cancel','adjust_in','adjust_out')),
  qty_change numeric(14,4) not null check (qty_change <> 0),  -- theo bao
  unit_cost numeric(14,2),
  ref_table text,
  ref_id uuid,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.inventory_transactions(product_id, created_at);

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_code text not null unique,
  reason text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.stock_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.stock_adjustments(id),
  product_id uuid not null references public.products(id),
  unit_id uuid not null references public.units(id),
  quantity numeric(14,4) not null check (quantity <> 0),
  conversion_factor numeric(18,8) not null,
  base_qty numeric(14,4) not null,
  unit_cost numeric(14,2)
);

-- ---------- Nhóm E: Tài chính ----------
create table public.cash_accounts (id uuid primary key default gen_random_uuid(), code text not null unique, name text not null);
insert into public.cash_accounts(code, name) values ('cash','Tiền mặt'), ('bank','Chuyển khoản');

create table public.expense_categories (code text primary key, name text not null, direction text not null check (direction in ('in','out')));
insert into public.expense_categories(code, name, direction) values
  ('sale','Thu bán hàng','in'), ('debt_collection','Thu công nợ','in'), ('other_in','Thu khác','in'),
  ('purchase','Chi nhập hàng','out'), ('supplier_payment','Trả nợ nhà cung cấp','out'), ('transport','Chi vận chuyển','out'),
  ('labor','Chi nhân công','out'), ('utility','Điện nước','out'), ('sale_cancel','Hoàn tiền hủy hóa đơn','out'),
  ('other_out','Chi khác','out');

create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.cash_accounts(id),
  txn_date timestamptz not null default now(),
  direction text not null check (direction in ('in','out')),
  amount numeric(14,0) not null check (amount > 0),
  category text not null references public.expense_categories(code),
  ref_table text,
  ref_id uuid,
  party_name text not null default '',
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_code text not null unique,
  party_type text not null check (party_type in ('customer','supplier')),
  party_id uuid,
  kind text not null check (kind in ('sale','debt_collection','purchase','supplier_payment')),
  account_id uuid not null references public.cash_accounts(id),
  amount numeric(14,0) not null check (amount > 0),
  payment_date timestamptz not null default now(),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- Nhóm C: Chứng từ ----------
create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_code text not null unique,
  supplier_id uuid references public.suppliers(id),
  receipt_date timestamptz not null default now(),
  total_amount numeric(14,0) not null,
  paid_amount numeric(14,0) not null default 0,
  debt_amount numeric(14,0) not null default 0,
  debt_remaining numeric(14,0) not null default 0,
  status text not null default 'completed' check (status in ('completed','cancelled')),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts(id),
  line_no int not null,
  product_id uuid not null references public.products(id),
  unit_id uuid not null references public.units(id),
  quantity numeric(14,4) not null check (quantity > 0),
  conversion_factor numeric(18,8) not null,
  base_qty numeric(14,4) not null,
  unit_price numeric(14,0) not null check (unit_price >= 0),  -- giá nhập thực tế / đơn vị nhập
  line_total numeric(14,0) not null,
  lot_id uuid references public.inventory_lots(id)
);

create table public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_code text not null unique,
  customer_id uuid references public.customers(id),
  customer_name text not null default 'Khách lẻ',
  invoice_date timestamptz not null default now(),
  price_tier text not null default 'retail' check (price_tier in ('retail','wholesale')),
  subtotal numeric(14,0) not null,
  discount numeric(14,0) not null default 0,
  total_amount numeric(14,0) not null,
  paid_amount numeric(14,0) not null default 0,
  debt_amount numeric(14,0) not null default 0,     -- nợ phát sinh lúc bán
  debt_remaining numeric(14,0) not null default 0,  -- nợ còn lại sau khi thu
  cash_given numeric(14,0),
  account_id uuid references public.cash_accounts(id),
  status text not null default 'completed' check (status in ('completed','cancelled')),
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.sales_invoices(invoice_date);
create index on public.sales_invoices(customer_id) where debt_remaining > 0;

create table public.sales_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sales_invoices(id),
  line_no int not null,
  product_id uuid not null references public.products(id),
  product_code text not null,
  product_name text not null,
  unit_id uuid not null references public.units(id),
  unit_name text not null,
  quantity numeric(14,4) not null check (quantity > 0),
  conversion_factor numeric(18,8) not null,
  base_qty numeric(14,4) not null,
  unit_price numeric(14,0) not null,       -- giá tại thời điểm bán (không tính lại)
  list_price numeric(14,0) not null,
  discount numeric(14,0) not null default 0,
  line_total numeric(14,0) not null
);

-- Phân bổ lô FIFO cho từng dòng bán (giá vốn chính xác) — chỉ chủ & quản lý xem
create table public.sales_item_lots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.sales_invoice_items(id),
  lot_id uuid not null references public.inventory_lots(id),
  base_qty numeric(14,4) not null check (base_qty > 0),
  unit_cost numeric(14,2) not null
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  invoice_id uuid references public.sales_invoices(id),
  receipt_id uuid references public.purchase_receipts(id),
  amount numeric(14,0) not null check (amount > 0),
  check ((invoice_id is null) <> (receipt_id is null))
);

-- Sổ công nợ: amount > 0 tăng nợ, < 0 giảm nợ
create table public.receivable_payable_entries (
  id bigserial primary key,
  party_type text not null check (party_type in ('customer','supplier')),
  party_id uuid not null,
  entry_date timestamptz not null default now(),
  amount numeric(14,0) not null check (amount <> 0),
  ref_table text,
  ref_id uuid,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index on public.receivable_payable_entries(party_type, party_id);

-- ===== 20261125000002_functions.sql =====
-- =====================================================================
-- HÀM NGHIỆP VỤ — mỗi hàm chạy trong MỘT transaction (nguyên tắc 6)
-- =====================================================================

create or replace function public.require_role(variadic r public.app_role[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(variadic r) then
    raise exception 'Bạn không có quyền thực hiện thao tác này' using errcode = '42501';
  end if;
end $$;

create or replace function public.audit(p_action text, p_table text, p_id uuid, p_data jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs(action, table_name, record_id, data) values (p_action, p_table, p_id, p_data);
$$;

-- Cộng/trừ số tồn (luôn đi kèm bản ghi inventory_transactions)
create or replace function public._bump_balance(p_product uuid, p_delta numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.inventory_balances set qty = qty + p_delta, updated_at = now() where product_id = p_product;
  if not found then
    insert into public.inventory_balances(product_id, qty) values (p_product, p_delta);
  end if;
end $$;

-- Tạo lô mới (nhập hàng / điều chỉnh tăng)
create or replace function public._add_lot(p_product uuid, p_qty numeric, p_cost numeric, p_source text, p_source_id uuid,
  p_txn text, p_lot_code text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_lot uuid;
begin
  insert into public.inventory_lots(product_id, lot_code, source_type, source_id, qty_in, qty_remaining, unit_cost)
  values (p_product, p_lot_code, p_source, p_source_id, p_qty, p_qty, p_cost) returning id into v_lot;
  insert into public.inventory_transactions(product_id, lot_id, txn_type, qty_change, unit_cost, ref_table, ref_id, note)
  values (p_product, v_lot, p_txn, p_qty, p_cost, case p_source when 'purchase' then 'purchase_receipts' else 'stock_adjustments' end, p_source_id, p_note);
  perform public._bump_balance(p_product, p_qty);
  return v_lot;
end $$;

-- Xuất kho theo FIFO: lô nhập trước xuất trước. Không đủ tồn → báo lỗi, hủy cả giao dịch.
create or replace function public._fifo_consume(p_product uuid, p_qty numeric, p_txn text, p_ref_table text, p_ref_id uuid, p_note text)
returns table(lot_id uuid, qty numeric, unit_cost numeric)
language plpgsql security definer set search_path = public as $$
declare r record; v_need numeric := p_qty; v_take numeric; v_have numeric; v_name text;
begin
  select coalesce(b.qty,0), p.name into v_have, v_name
    from public.products p left join public.inventory_balances b on b.product_id = p.id where p.id = p_product;
  if v_have < p_qty then
    raise exception 'Không đủ tồn kho "%": còn % bao, cần % bao', v_name, trim_scale(v_have), trim_scale(p_qty);
  end if;
  for r in select l.id, l.qty_remaining, l.unit_cost from public.inventory_lots l
           where l.product_id = p_product and l.qty_remaining > 0
           order by l.received_at, l.seq for update loop
    exit when v_need <= 0;
    v_take := least(v_need, r.qty_remaining);
    update public.inventory_lots set qty_remaining = qty_remaining - v_take where id = r.id;
    insert into public.inventory_transactions(product_id, lot_id, txn_type, qty_change, unit_cost, ref_table, ref_id, note)
    values (p_product, r.id, p_txn, -v_take, r.unit_cost, p_ref_table, p_ref_id, p_note);
    lot_id := r.id; qty := v_take; unit_cost := r.unit_cost;
    return next;
    v_need := v_need - v_take;
  end loop;
  if v_need > 0 then
    raise exception 'Dữ liệu lô của "%" không khớp số tồn. Chạy đối soát kho.', v_name;
  end if;
  perform public._bump_balance(p_product, -p_qty);
end $$;

-- ---------------------------------------------------------------------
-- SẢN PHẨM: lưu SP + bảng quy đổi/giá theo đơn vị (bao, kg, tấn)
-- p = {id?, product_code?, barcode, name, category_id, kg_per_bao, min_stock, description, is_active,
--      cost_price?, units:[{unit_code, retail_price, wholesale_price, is_active}]}
-- ---------------------------------------------------------------------
create or replace function public.save_product(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_code text; v_kg numeric := (p->>'kg_per_bao')::numeric; u jsonb; v_unit record; v_factor numeric;
begin
  perform public.require_role('owner','manager');
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Tên sản phẩm không được trống'; end if;
  if v_kg is null or v_kg <= 0 then raise exception 'Số kg mỗi bao phải lớn hơn 0'; end if;
  v_code := upper(nullif(trim(p->>'product_code'),''));
  if v_id is null then
    if v_code is null then
      v_code := public.next_code(case (select name from public.categories where id = (p->>'category_id')::uuid)
                  when 'Gạo' then 'GAO' when 'Lúa' then 'LUA' when 'Cám' then 'CAM' else 'SP' end, 3);
    end if;
    insert into public.products(product_code, barcode, name, category_id, kg_per_bao, cost_price, min_stock, description)
    values (v_code, nullif(trim(p->>'barcode'),''), trim(p->>'name'), (p->>'category_id')::uuid, v_kg,
            coalesce((p->>'cost_price')::numeric,0), coalesce((p->>'min_stock')::numeric,0), coalesce(p->>'description',''))
    returning id into v_id;
    insert into public.inventory_balances(product_id, qty) values (v_id, 0);
  else
    if exists(select 1 from public.products where id = v_id and kg_per_bao <> v_kg)
       and exists(select 1 from public.inventory_transactions where product_id = v_id) then
      raise exception 'Không đổi được số kg/bao khi sản phẩm đã có phát sinh kho. Hãy tạo sản phẩm mới.';
    end if;
    update public.products set
      product_code = coalesce(v_code, product_code), barcode = nullif(trim(p->>'barcode'),''), name = trim(p->>'name'),
      category_id = (p->>'category_id')::uuid, kg_per_bao = v_kg, min_stock = coalesce((p->>'min_stock')::numeric,0),
      description = coalesce(p->>'description',''), is_active = coalesce((p->>'is_active')::boolean, true),
      cost_price = case when public.has_role('owner') and p ? 'cost_price' then (p->>'cost_price')::numeric else cost_price end,
      updated_at = now()
    where id = v_id;
  end if;
  for u in select * from jsonb_array_elements(coalesce(p->'units','[]'::jsonb)) loop
    select * into v_unit from public.units where code = u->>'unit_code';
    if v_unit.id is null then raise exception 'Đơn vị không hợp lệ: %', u->>'unit_code'; end if;
    v_factor := case v_unit.code when 'bao' then 1 when 'kg' then 1 / v_kg when 'tan' then 1000 / v_kg end;
    insert into public.product_units(product_id, unit_id, factor, retail_price, wholesale_price, is_active)
    values (v_id, v_unit.id, v_factor, coalesce((u->>'retail_price')::numeric,0), coalesce((u->>'wholesale_price')::numeric,0),
            coalesce((u->>'is_active')::boolean,true))
    on conflict (product_id, unit_id) do update set factor = excluded.factor, retail_price = excluded.retail_price,
      wholesale_price = excluded.wholesale_price, is_active = excluded.is_active;
  end loop;
  if not exists(select 1 from public.product_units pu join public.units un on un.id = pu.unit_id
                where pu.product_id = v_id and un.code = 'bao') then
    raise exception 'Sản phẩm phải có đơn vị Bao';
  end if;
  perform public.audit('save_product','products', v_id, p);
  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------------
-- BÁN HÀNG
-- p = {customer_id?, price_tier?, items:[{product_id, unit_code, quantity, unit_price?, discount?}],
--      discount?, paid_amount, cash_given?, account_code ('cash'|'bank'), note?}
-- Tính lại mọi số tiền phía máy chủ; trừ kho FIFO + ghi quỹ + ghi công nợ trong cùng transaction.
-- ---------------------------------------------------------------------
create or replace function public.create_sales_invoice(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv uuid; v_code text; v_cust record; v_tier text; v_acc uuid; it jsonb; v_line int := 0;
  v_pu record; v_qty numeric; v_price numeric; v_list numeric; v_disc numeric; v_total_line numeric;
  v_sub numeric := 0; v_inv_disc numeric := coalesce((p->>'discount')::numeric,0); v_total numeric;
  v_paid numeric := coalesce((p->>'paid_amount')::numeric,0); v_item uuid; a record; v_pay uuid;
begin
  perform public.require_role('owner','manager','staff');
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Hóa đơn chưa có sản phẩm'; end if;
  select null::uuid as id, null::text as name, null::text as customer_type into v_cust;
  if nullif(p->>'customer_id','') is not null then
    select * into v_cust from public.customers where id = (p->>'customer_id')::uuid and is_active;
    if v_cust.id is null then raise exception 'Không tìm thấy khách hàng'; end if;
  end if;
  v_tier := coalesce(nullif(p->>'price_tier',''), case when v_cust.customer_type = 'si' then 'wholesale' else 'retail' end);
  select id into v_acc from public.cash_accounts where code = coalesce(nullif(p->>'account_code',''),'cash');
  if v_acc is null then raise exception 'Hình thức thanh toán không hợp lệ'; end if;

  v_code := public.next_code('HD', 6);
  insert into public.sales_invoices(invoice_code, customer_id, customer_name, price_tier, subtotal, discount, total_amount,
    paid_amount, debt_amount, debt_remaining, cash_given, account_id, note)
  values (v_code, v_cust.id, coalesce(v_cust.name,'Khách lẻ'), v_tier, 0, 0, 0, 0, 0, 0,
    nullif(p->>'cash_given','')::numeric, v_acc, coalesce(p->>'note',''))
  returning id into v_inv;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_line := v_line + 1;
    select pu.*, pr.name as pname, pr.product_code, pr.is_active as p_active, un.name as uname
      into v_pu
      from public.product_units pu join public.products pr on pr.id = pu.product_id join public.units un on un.id = pu.unit_id
     where pu.product_id = (it->>'product_id')::uuid and un.code = it->>'unit_code' and pu.is_active;
    if v_pu.product_id is null or not v_pu.p_active then raise exception 'Dòng %: sản phẩm/đơn vị không hợp lệ', v_line; end if;
    v_qty := (it->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Dòng % (%): số lượng phải > 0', v_line, v_pu.pname; end if;
    v_list := case v_tier when 'wholesale' then v_pu.wholesale_price else v_pu.retail_price end;
    v_price := coalesce(nullif(it->>'unit_price','')::numeric, v_list);
    if v_price < 0 then raise exception 'Dòng %: đơn giá không hợp lệ', v_line; end if;
    if v_price <> v_list and not public.has_role('owner','manager') then
      raise exception 'Nhân viên không được đổi giá bán (dòng %: %)', v_line, v_pu.pname;
    end if;
    v_disc := coalesce(nullif(it->>'discount','')::numeric, 0);
    if v_disc < 0 or v_disc > round(v_qty * v_price) then raise exception 'Dòng %: giảm giá không hợp lệ', v_line; end if;
    v_total_line := round(v_qty * v_price) - v_disc;   -- Thành tiền = SL × Đơn giá − Giảm giá dòng
    insert into public.sales_invoice_items(invoice_id, line_no, product_id, product_code, product_name, unit_id, unit_name,
      quantity, conversion_factor, base_qty, unit_price, list_price, discount, line_total)
    values (v_inv, v_line, v_pu.product_id, v_pu.product_code, v_pu.pname, v_pu.unit_id, v_pu.uname,
      v_qty, v_pu.factor, round(v_qty * v_pu.factor, 4), v_price, v_list, v_disc, v_total_line)
    returning id into v_item;
    for a in select * from public._fifo_consume(v_pu.product_id, round(v_qty * v_pu.factor, 4), 'sale', 'sales_invoices', v_inv, v_code) loop
      insert into public.sales_item_lots(item_id, lot_id, base_qty, unit_cost) values (v_item, a.lot_id, a.qty, a.unit_cost);
    end loop;
    v_sub := v_sub + v_total_line;
  end loop;

  if v_inv_disc < 0 or v_inv_disc > v_sub then raise exception 'Giảm giá hóa đơn không hợp lệ'; end if;
  v_total := v_sub - v_inv_disc;
  if v_paid < 0 then raise exception 'Số tiền thanh toán không hợp lệ'; end if;
  if v_paid > v_total then v_paid := v_total; end if;           -- tiền thừa trả lại khách, không ghi vào quỹ
  if v_paid < v_total and v_cust.id is null then raise exception 'Ghi nợ phải chọn khách hàng'; end if;

  update public.sales_invoices set subtotal = v_sub, discount = v_inv_disc, total_amount = v_total, paid_amount = v_paid,
    debt_amount = v_total - v_paid, debt_remaining = v_total - v_paid where id = v_inv;

  if v_paid > 0 then
    insert into public.payments(payment_code, party_type, party_id, kind, account_id, amount, note)
    values (public.next_code('TT', 6), 'customer', v_cust.id, 'sale', v_acc, v_paid, v_code) returning id into v_pay;
    insert into public.payment_allocations(payment_id, invoice_id, amount) values (v_pay, v_inv, v_paid);
    insert into public.cash_transactions(account_id, direction, amount, category, ref_table, ref_id, party_name, note)
    values (v_acc, 'in', v_paid, 'sale', 'sales_invoices', v_inv, coalesce(v_cust.name,'Khách lẻ'), v_code);
  end if;
  if v_total - v_paid > 0 then
    insert into public.receivable_payable_entries(party_type, party_id, amount, ref_table, ref_id, note)
    values ('customer', v_cust.id, v_total - v_paid, 'sales_invoices', v_inv, 'Nợ ' || v_code);
  end if;
  perform public.audit('create_invoice','sales_invoices', v_inv, p);
  return jsonb_build_object('id', v_inv, 'invoice_code', v_code, 'total_amount', v_total, 'paid_amount', v_paid, 'debt_amount', v_total - v_paid);
end $$;

-- HỦY HÓA ĐƠN: không xóa; đổi trạng thái, trả hàng về đúng lô cũ, hoàn quỹ, xóa nợ, ghi log.
create or replace function public.cancel_sales_invoice(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v record; r record;
begin
  perform public.require_role('owner','manager');
  if coalesce(trim(p_reason),'') = '' then raise exception 'Phải nhập lý do hủy'; end if;
  select * into v from public.sales_invoices where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy hóa đơn'; end if;
  if v.status <> 'completed' then raise exception 'Hóa đơn đã bị hủy trước đó'; end if;
  if v.debt_remaining <> v.debt_amount then
    raise exception 'Hóa đơn đã được thu nợ một phần, không hủy được. Hãy dùng chức năng trả hàng (giai đoạn sau).';
  end if;
  for r in select sil.lot_id, sil.base_qty, sil.unit_cost, sii.product_id
           from public.sales_item_lots sil join public.sales_invoice_items sii on sii.id = sil.item_id
           where sii.invoice_id = p_id loop
    update public.inventory_lots set qty_remaining = qty_remaining + r.base_qty where id = r.lot_id;
    insert into public.inventory_transactions(product_id, lot_id, txn_type, qty_change, unit_cost, ref_table, ref_id, note)
    values (r.product_id, r.lot_id, 'sale_cancel', r.base_qty, r.unit_cost, 'sales_invoices', p_id, 'Hủy ' || v.invoice_code);
    perform public._bump_balance(r.product_id, r.base_qty);
  end loop;
  if v.paid_amount > 0 then
    insert into public.cash_transactions(account_id, direction, amount, category, ref_table, ref_id, party_name, note)
    values (v.account_id, 'out', v.paid_amount, 'sale_cancel', 'sales_invoices', p_id, v.customer_name, 'Hủy ' || v.invoice_code);
  end if;
  if v.debt_amount > 0 then
    insert into public.receivable_payable_entries(party_type, party_id, amount, ref_table, ref_id, note)
    values ('customer', v.customer_id, -v.debt_amount, 'sales_invoices', p_id, 'Hủy ' || v.invoice_code);
  end if;
  update public.sales_invoices set status = 'cancelled', cancel_reason = trim(p_reason), cancelled_at = now(),
    cancelled_by = auth.uid(), debt_remaining = 0 where id = p_id;
  perform public.audit('cancel_invoice','sales_invoices', p_id, jsonb_build_object('reason', p_reason));
end $$;

-- THU NỢ KHÁCH: trừ dần vào hóa đơn nợ cũ nhất. KHÔNG phải doanh thu (nguyên tắc 3).
create or replace function public.record_customer_payment(p_customer uuid, p_amount numeric, p_account text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_debt numeric; v_pay uuid; v_left numeric := p_amount; r record; v_take numeric; v_name text; v_code text;
begin
  perform public.require_role('owner','manager','staff');
  if p_amount is null or p_amount <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  select name into v_name from public.customers where id = p_customer;
  if v_name is null then raise exception 'Không tìm thấy khách hàng'; end if;
  select coalesce(sum(amount),0) into v_debt from public.receivable_payable_entries where party_type='customer' and party_id = p_customer;
  if p_amount > v_debt then raise exception 'Khách chỉ còn nợ % đ', v_debt; end if;
  select id into v_acc from public.cash_accounts where code = coalesce(p_account,'cash');
  v_code := public.next_code('PT', 6);
  insert into public.payments(payment_code, party_type, party_id, kind, account_id, amount, note)
  values (v_code, 'customer', p_customer, 'debt_collection', v_acc, p_amount, coalesce(p_note,'')) returning id into v_pay;
  for r in select id, debt_remaining from public.sales_invoices
           where customer_id = p_customer and status = 'completed' and debt_remaining > 0
           order by invoice_date, invoice_code for update loop
    exit when v_left <= 0;
    v_take := least(v_left, r.debt_remaining);
    insert into public.payment_allocations(payment_id, invoice_id, amount) values (v_pay, r.id, v_take);
    update public.sales_invoices set debt_remaining = debt_remaining - v_take where id = r.id;
    v_left := v_left - v_take;
  end loop;
  insert into public.cash_transactions(account_id, direction, amount, category, ref_table, ref_id, party_name, note)
  values (v_acc, 'in', p_amount, 'debt_collection', 'payments', v_pay, v_name, v_code);
  insert into public.receivable_payable_entries(party_type, party_id, amount, ref_table, ref_id, note)
  values ('customer', p_customer, -p_amount, 'payments', v_pay, 'Thu nợ ' || v_code);
  perform public.audit('collect_debt','payments', v_pay, jsonb_build_object('customer', p_customer, 'amount', p_amount));
  return jsonb_build_object('payment_code', v_code);
end $$;

-- NHẬP HÀNG: mỗi dòng tạo 1 lô FIFO với giá nhập thực tế.
-- p = {supplier_id?, items:[{product_id, unit_code, quantity, unit_price}], paid_amount, account_code, note}
create or replace function public.create_purchase_receipt(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; it jsonb; v_line int := 0; v_pu record; v_qty numeric; v_price numeric; v_total numeric := 0;
  v_lt numeric; v_base numeric; v_lot uuid; v_paid numeric := coalesce((p->>'paid_amount')::numeric,0); v_acc uuid; v_sup record; v_pay uuid;
begin
  perform public.require_role('owner','manager');
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Phiếu nhập chưa có sản phẩm'; end if;
  select null::uuid as id, null::text as name into v_sup;
  if nullif(p->>'supplier_id','') is not null then
    select * into v_sup from public.suppliers where id = (p->>'supplier_id')::uuid;
  end if;
  select id into v_acc from public.cash_accounts where code = coalesce(nullif(p->>'account_code',''),'cash');
  v_code := public.next_code('PN', 4);
  insert into public.purchase_receipts(receipt_code, supplier_id, total_amount, note)
  values (v_code, v_sup.id, 0, coalesce(p->>'note','')) returning id into v_id;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_line := v_line + 1;
    select pu.*, pr.name as pname into v_pu from public.product_units pu join public.products pr on pr.id = pu.product_id
      join public.units un on un.id = pu.unit_id where pu.product_id = (it->>'product_id')::uuid and un.code = it->>'unit_code';
    if v_pu.product_id is null then raise exception 'Dòng %: sản phẩm/đơn vị không hợp lệ', v_line; end if;
    v_qty := (it->>'quantity')::numeric; v_price := (it->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Dòng % (%): số lượng phải > 0', v_line, v_pu.pname; end if;
    if v_price is null or v_price < 0 then raise exception 'Dòng % (%): giá nhập không hợp lệ', v_line, v_pu.pname; end if;
    v_lt := round(v_qty * v_price); v_base := round(v_qty * v_pu.factor, 4);
    v_lot := public._add_lot(v_pu.product_id, v_base, round(v_lt / v_base, 2), 'purchase', v_id, 'purchase',
                             v_code || '-' || v_line, v_code);
    insert into public.purchase_receipt_items(receipt_id, line_no, product_id, unit_id, quantity, conversion_factor, base_qty, unit_price, line_total, lot_id)
    values (v_id, v_line, v_pu.product_id, v_pu.unit_id, v_qty, v_pu.factor, v_base, v_price, v_lt, v_lot);
    update public.products set cost_price = round(v_lt / v_base, 2), updated_at = now() where id = v_pu.product_id;
    v_total := v_total + v_lt;
  end loop;
  if v_paid < 0 or v_paid > v_total then raise exception 'Số tiền đã trả không hợp lệ'; end if;
  if v_paid < v_total and v_sup.id is null then raise exception 'Còn nợ thì phải chọn nhà cung cấp'; end if;
  update public.purchase_receipts set total_amount = v_total, paid_amount = v_paid, debt_amount = v_total - v_paid,
    debt_remaining = v_total - v_paid where id = v_id;
  if v_paid > 0 then
    insert into public.payments(payment_code, party_type, party_id, kind, account_id, amount, note)
    values (public.next_code('PC', 6), 'supplier', v_sup.id, 'purchase', v_acc, v_paid, v_code) returning id into v_pay;
    insert into public.payment_allocations(payment_id, receipt_id, amount) values (v_pay, v_id, v_paid);
    insert into public.cash_transactions(account_id, direction, amount, category, ref_table, ref_id, party_name, note)
    values (v_acc, 'out', v_paid, 'purchase', 'purchase_receipts', v_id, coalesce(v_sup.name,''), v_code);
  end if;
  if v_total - v_paid > 0 then
    insert into public.receivable_payable_entries(party_type, party_id, amount, ref_table, ref_id, note)
    values ('supplier', v_sup.id, v_total - v_paid, 'purchase_receipts', v_id, 'Nợ ' || v_code);
  end if;
  perform public.audit('create_receipt','purchase_receipts', v_id, p);
  return jsonb_build_object('id', v_id, 'receipt_code', v_code, 'total_amount', v_total);
end $$;

-- ĐIỀU CHỈNH KHO (hao hụt, chênh lệch cân, kiểm kê). quantity âm = giảm (FIFO), dương = tăng (tạo lô).
create or replace function public.create_stock_adjustment(p_product uuid, p_unit text, p_quantity numeric, p_reason text, p_unit_cost numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; v_pu record; v_base numeric; v_cost numeric;
begin
  perform public.require_role('owner','manager');
  if coalesce(trim(p_reason),'') = '' then raise exception 'Phải nhập lý do điều chỉnh'; end if;
  if p_quantity is null or p_quantity = 0 then raise exception 'Số lượng điều chỉnh phải khác 0'; end if;
  select pu.* into v_pu from public.product_units pu join public.units un on un.id = pu.unit_id
    where pu.product_id = p_product and un.code = p_unit;
  if v_pu.product_id is null then raise exception 'Sản phẩm/đơn vị không hợp lệ'; end if;
  v_base := round(p_quantity * v_pu.factor, 4);
  v_code := public.next_code('DC', 4);
  insert into public.stock_adjustments(adjustment_code, reason) values (v_code, trim(p_reason)) returning id into v_id;
  if v_base < 0 then
    perform public._fifo_consume(p_product, -v_base, 'adjust_out', 'stock_adjustments', v_id, v_code || ' ' || trim(p_reason));
  else
    v_cost := coalesce(p_unit_cost, (select unit_cost from public.inventory_lots where product_id = p_product order by received_at desc, seq desc limit 1),
                       (select cost_price from public.products where id = p_product), 0);
    perform public._add_lot(p_product, v_base, v_cost, 'adjustment', v_id, 'adjust_in', v_code, v_code || ' ' || trim(p_reason));
  end if;
  insert into public.stock_adjustment_items(adjustment_id, product_id, unit_id, quantity, conversion_factor, base_qty, unit_cost)
  values (v_id, p_product, v_pu.unit_id, p_quantity, v_pu.factor, v_base, v_cost);
  perform public.audit('stock_adjust','stock_adjustments', v_id, jsonb_build_object('product', p_product, 'qty', p_quantity, 'reason', p_reason));
  return jsonb_build_object('id', v_id, 'adjustment_code', v_code);
end $$;

-- GHI THU / CHI KHÁC (vận chuyển, nhân công, điện nước…)
create or replace function public.record_cash(p_direction text, p_category text, p_amount numeric, p_account text, p_party text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_acc uuid;
begin
  perform public.require_role('owner','manager');
  if p_amount is null or p_amount <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  if p_category in ('sale','debt_collection','purchase','supplier_payment','sale_cancel') then
    raise exception 'Khoản này được ghi tự động từ hóa đơn/phiếu, không ghi tay';
  end if;
  if not exists(select 1 from public.expense_categories where code = p_category and direction = p_direction) then
    raise exception 'Danh mục thu/chi không hợp lệ';
  end if;
  select id into v_acc from public.cash_accounts where code = coalesce(p_account,'cash');
  insert into public.cash_transactions(account_id, direction, amount, category, party_name, note)
  values (v_acc, p_direction, p_amount, p_category, coalesce(p_party,''), coalesce(p_note,''));
end $$;

-- ĐỐI SOÁT KHO: số tồn phải = tổng giao dịch = tổng lô còn lại
create or replace function public.reconcile_inventory()
returns table(product_id uuid, product_name text, balance numeric, txn_sum numeric, lot_sum numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, coalesce(b.qty,0),
         coalesce((select sum(qty_change) from public.inventory_transactions t where t.product_id = p.id),0),
         coalesce((select sum(qty_remaining) from public.inventory_lots l where l.product_id = p.id),0)
  from public.products p left join public.inventory_balances b on b.product_id = p.id
  where public.has_role('owner','manager')
    and (coalesce(b.qty,0) <> coalesce((select sum(qty_change) from public.inventory_transactions t where t.product_id = p.id),0)
      or coalesce(b.qty,0) <> coalesce((select sum(qty_remaining) from public.inventory_lots l where l.product_id = p.id),0))
$$;

-- TỔNG QUAN: doanh thu, thực thu, lợi nhuận là 3 chỉ tiêu RIÊNG.
create or replace function public.dashboard_summary(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_d date := coalesce(p_day, (now() at time zone 'Asia/Ho_Chi_Minh')::date); v_can_profit boolean; res jsonb;
begin
  perform public.require_role('owner','manager','staff');
  v_can_profit := public.has_role('owner','manager');
  with inv as (
    select i.*, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as d from public.sales_invoices i where i.status = 'completed'
  ), cogs as (
    select sii.invoice_id, sum(sil.base_qty * sil.unit_cost) as cogs
    from public.sales_item_lots sil join public.sales_invoice_items sii on sii.id = sil.item_id group by sii.invoice_id
  )
  select jsonb_build_object(
    'day', v_d,
    'revenue_today', coalesce((select sum(total_amount) from inv where inv.d = v_d),0),
    'invoices_today', (select count(*) from inv where inv.d = v_d),
    'cash_in_today', coalesce((select sum(amount) from public.cash_transactions c
        where c.direction = 'in' and c.category in ('sale','debt_collection') and (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date = v_d),0)
      - coalesce((select sum(amount) from public.cash_transactions c
        where c.category = 'sale_cancel' and (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date = v_d),0),
    'receivable', coalesce((select sum(amount) from public.receivable_payable_entries where party_type='customer'),0),
    'payable', coalesce((select sum(amount) from public.receivable_payable_entries where party_type='supplier'),0),
    'gross_profit_today', case when v_can_profit then
        coalesce((select sum(inv.total_amount - coalesce(cogs.cogs,0)) from inv left join cogs on cogs.invoice_id = inv.id where inv.d = v_d),0) end,
    'stock_bao', coalesce((select sum(qty) from public.inventory_balances),0),
    'stock_kg', coalesce((select sum(b.qty * p.kg_per_bao) from public.inventory_balances b join public.products p on p.id = b.product_id),0),
    'stock_value', case when v_can_profit then coalesce((select sum(qty_remaining * unit_cost) from public.inventory_lots),0) end,
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', b.qty, 'min', p.min_stock) order by b.qty)
        from public.products p join public.inventory_balances b on b.product_id = p.id
        where p.is_active and p.min_stock > 0 and b.qty <= p.min_stock), '[]'::jsonb),
    'last7', (select jsonb_agg(jsonb_build_object('day', g::date, 'revenue', coalesce((select sum(total_amount) from inv where inv.d = g::date),0)) order by g)
        from generate_series(v_d - 6, v_d, interval '1 day') g),
    'by_month', (select jsonb_agg(jsonb_build_object('month', to_char(m,'MM/YYYY'),
          'revenue', coalesce((select sum(total_amount) from inv where date_trunc('month', inv.d) = m),0)) order by m)
        from generate_series(date_trunc('month', v_d) - interval '5 months', date_trunc('month', v_d), interval '1 month') m),
    'top_products', coalesce((select jsonb_agg(t) from (
        select sii.product_name as name, sum(sii.base_qty) as qty_bao, sum(sii.line_total) as revenue
        from public.sales_invoice_items sii join inv on inv.id = sii.invoice_id
        where inv.d > v_d - 30 group by sii.product_name order by sum(sii.line_total) desc limit 5) t), '[]'::jsonb),
    'debts_due', coalesce((select jsonb_agg(t) from (
        select i.invoice_code, i.customer_name, i.debt_remaining, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as day
        from public.sales_invoices i where i.status = 'completed' and i.debt_remaining > 0
        order by i.invoice_date limit 5) t), '[]'::jsonb),
    'can_see_profit', v_can_profit
  ) into res;
  return res;
end $$;

-- Báo cáo lợi nhuận theo khoảng ngày (chỉ chủ & quản lý)
create or replace function public.profit_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.require_role('owner','manager');
  with inv as (select * from public.sales_invoices where status='completed'
               and (invoice_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to),
  cogs as (select coalesce(sum(sil.base_qty * sil.unit_cost),0) v from public.sales_item_lots sil
           join public.sales_invoice_items sii on sii.id = sil.item_id join inv on inv.id = sii.invoice_id),
  opex as (select coalesce(sum(amount),0) v from public.cash_transactions where direction='out'
           and category in ('transport','labor','utility','other_out') and (txn_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to)
  select jsonb_build_object('revenue', (select coalesce(sum(total_amount),0) from inv), 'cogs', (select v from cogs),
    'gross_profit', (select coalesce(sum(total_amount),0) from inv) - (select v from cogs), 'operating_expenses', (select v from opex),
    'net_profit', (select coalesce(sum(total_amount),0) from inv) - (select v from cogs) - (select v from opex)) into res;
  return res;
end $$;

-- Phân quyền người dùng (chỉ Chủ cửa hàng)
create or replace function public.set_user_role(p_user uuid, p_role public.app_role, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('owner');
  if p_user = auth.uid() and (p_role <> 'owner' or not p_active) then
    raise exception 'Không tự hạ quyền hoặc khóa chính mình';
  end if;
  update public.profiles set role = p_role, is_active = p_active where id = p_user;
  perform public.audit('set_role','profiles', p_user, jsonb_build_object('role', p_role, 'active', p_active));
end $$;

create or replace function public.product_costs() returns table(product_id uuid, cost_price numeric)
language sql stable security definer set search_path = public as $$
  select id, cost_price from public.products where public.has_role('owner','manager')
$$;

-- ===== 20261125000003_security.sql =====
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

-- ===== 20261125000004_grants.sql =====
-- Cấp quyền đọc TƯỜNG MINH (project Supabase mới không tự cấp quyền cho bảng trong schema public).
-- Thu hồi trước để môi trường cục bộ giống hệt cloud; RLS vẫn quyết định từng dòng được xem.
revoke select on all tables in schema public from authenticated, anon;
do $$
declare t text;
begin
  foreach t in array array['profiles','store_settings','categories','units','product_units','product_prices','customers','suppliers',
    'warehouses','inventory_balances','inventory_lots','inventory_transactions','stock_adjustments','stock_adjustment_items',
    'cash_accounts','expense_categories','cash_transactions','payments','purchase_receipts','purchase_receipt_items',
    'sales_invoices','sales_invoice_items','sales_item_lots','payment_allocations','receivable_payable_entries','audit_logs'] loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- products: không có cột giá vốn
grant select (id, product_code, barcode, name, category_id, kg_per_bao, min_stock, description, is_active, created_at, updated_at)
  on public.products to authenticated;
grant select on public.v_products, public.v_customers, public.v_suppliers to authenticated;

-- ===== 20261125000005_expenses_daily.sql =====
-- =====================================================================
-- CHI TIÊU (thêm / sửa / xóa) + BÁO CÁO DOANH THU & LỢI NHUẬN THEO NGÀY
-- =====================================================================
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  name text not null check (length(trim(name)) > 0),
  amount numeric(14,0) not null check (amount > 0),
  note text not null default '',
  account_id uuid not null references public.cash_accounts(id),
  cash_txn_id uuid references public.cash_transactions(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.expenses(expense_date);
alter table public.expenses enable row level security;
revoke all on public.expenses from anon;
revoke insert, update, delete, truncate on public.expenses from authenticated;
grant select on public.expenses to authenticated;
create policy "doc_quan_ly" on public.expenses for select to authenticated using (public.has_role('owner','manager'));

-- Thêm hoặc sửa khoản chi; sổ quỹ (cash_transactions) được cập nhật theo cùng transaction.
-- p = {id?, expense_date, name, amount, note, account_code}
create or replace function public.save_expense(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_acc uuid; v_amt numeric := (p->>'amount')::numeric; v_name text := trim(coalesce(p->>'name',''));
  v_date date := coalesce(nullif(p->>'expense_date','')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date); v_txn uuid; v_old record;
begin
  perform public.require_role('owner','manager');
  if v_name = '' then raise exception 'Phải nhập tên khoản chi'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  select id into v_acc from public.cash_accounts where code = coalesce(nullif(p->>'account_code',''),'cash');
  if v_acc is null then raise exception 'Quỹ không hợp lệ'; end if;
  if v_id is null then
    insert into public.cash_transactions(account_id, txn_date, direction, amount, category, ref_table, party_name, note)
    values (v_acc, (v_date + time '12:00') at time zone 'Asia/Ho_Chi_Minh', 'out', v_amt, 'other_out', 'expenses', v_name, coalesce(p->>'note',''))
    returning id into v_txn;
    insert into public.expenses(expense_date, name, amount, note, account_id, cash_txn_id)
    values (v_date, v_name, v_amt, coalesce(p->>'note',''), v_acc, v_txn) returning id into v_id;
    update public.cash_transactions set ref_id = v_id where id = v_txn;
    perform public.audit('create_expense','expenses', v_id, p);
  else
    select * into v_old from public.expenses where id = v_id for update;
    if v_old.id is null then raise exception 'Không tìm thấy khoản chi'; end if;
    update public.expenses set expense_date = v_date, name = v_name, amount = v_amt, note = coalesce(p->>'note',''),
      account_id = v_acc, updated_at = now() where id = v_id;
    update public.cash_transactions set account_id = v_acc, txn_date = (v_date + time '12:00') at time zone 'Asia/Ho_Chi_Minh',
      amount = v_amt, party_name = v_name, note = coalesce(p->>'note','') where id = v_old.cash_txn_id;
    perform public.audit('update_expense','expenses', v_id, jsonb_build_object('old', to_jsonb(v_old), 'new', p));
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Xóa khoản chi (ghi lại nội dung cũ vào nhật ký) và xóa dòng tương ứng trong sổ quỹ.
create or replace function public.delete_expense(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old record;
begin
  perform public.require_role('owner','manager');
  select * into v_old from public.expenses where id = p_id for update;
  if v_old.id is null then raise exception 'Không tìm thấy khoản chi'; end if;
  delete from public.expenses where id = p_id;
  delete from public.cash_transactions where id = v_old.cash_txn_id;
  perform public.audit('delete_expense','expenses', p_id, to_jsonb(v_old));
end $$;

-- Doanh thu & lợi nhuận theo từng ngày. Lợi nhuận = doanh thu − tiền vốn hàng đã bán (FIFO).
create or replace function public.daily_report(p_from date, p_to date)
returns table(day date, invoices bigint, revenue numeric, cost numeric, profit numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('owner','manager');
  if p_to < p_from then raise exception 'Ngày kết thúc phải sau ngày bắt đầu'; end if;
  if p_to - p_from > 366 then raise exception 'Chỉ xem tối đa 1 năm mỗi lần'; end if;
  return query
  with inv as (
    select i.id, i.total_amount, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as d
    from public.sales_invoices i
    where i.status = 'completed' and (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
  ), c as (
    select sii.invoice_id, sum(sil.base_qty * sil.unit_cost) as v
    from public.sales_item_lots sil join public.sales_invoice_items sii on sii.id = sil.item_id
    where sii.invoice_id in (select id from inv) group by sii.invoice_id
  )
  select g::date, count(inv.id), coalesce(sum(inv.total_amount),0), round(coalesce(sum(c.v),0)),
         coalesce(sum(inv.total_amount),0) - round(coalesce(sum(c.v),0))
  from generate_series(p_from, p_to, interval '1 day') g
  left join inv on inv.d = g::date left join c on c.invoice_id = inv.id
  group by g order by g;
end $$;
revoke execute on function public.save_expense(jsonb), public.delete_expense(uuid), public.daily_report(date,date) from anon, public;
grant execute on function public.save_expense(jsonb), public.delete_expense(uuid), public.daily_report(date,date) to authenticated;

-- ===== 20261125000006_cost_by_kg.sql =====
-- =====================================================================
-- TIỀN VỐN = Σ (số kg bán của từng món × giá nhập/kg của món đó)
-- Giá nhập/kg được CHỐT lúc bán (lấy từ giá nhập hiện hành của sản phẩm), nên đổi giá nhập sau này
-- không làm thay đổi lợi nhuận các ngày đã qua. Kho vẫn xuất theo lô như cũ.
-- =====================================================================
create table public.sales_item_costs (
  item_id uuid primary key references public.sales_invoice_items(id),
  kg_qty numeric(14,3) not null,            -- số kg bán của dòng
  cost_per_kg numeric(14,2) not null,       -- giá nhập/kg tại thời điểm bán
  cost numeric(14,0) not null               -- = round(kg_qty × cost_per_kg)
);
alter table public.sales_item_costs enable row level security;
revoke all on public.sales_item_costs from anon;
revoke insert, update, delete, truncate on public.sales_item_costs from authenticated;
grant select on public.sales_item_costs to authenticated;
create policy "doc_quan_ly" on public.sales_item_costs for select to authenticated using (public.has_role('owner','manager'));

-- Số kg của một dòng bán, tính trực tiếp theo đơn vị (không qua hệ số làm tròn)
create or replace function public._kg_of(p_unit uuid, p_qty numeric, p_kg_per_bao numeric) returns numeric
language sql immutable as $$
  select case (select code from public.units where id = p_unit) when 'kg' then p_qty when 'tan' then p_qty * 1000 else p_qty * p_kg_per_bao end
$$;

create or replace function public._snapshot_item_cost() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kgpb numeric; v_cost_bao numeric; v_kg numeric; v_ckg numeric;
begin
  select kg_per_bao, cost_price into v_kgpb, v_cost_bao from public.products where id = new.product_id;
  v_kg := round(public._kg_of(new.unit_id, new.quantity, v_kgpb), 3);
  v_ckg := round(coalesce(v_cost_bao, 0) / v_kgpb, 2);
  insert into public.sales_item_costs(item_id, kg_qty, cost_per_kg, cost) values (new.id, v_kg, v_ckg, round(v_kg * v_ckg));
  return new;
end $$;
create trigger trg_item_cost after insert on public.sales_invoice_items for each row execute function public._snapshot_item_cost();

-- Dữ liệu cũ (nếu có): dùng giá nhập thực tế của lô đã xuất
insert into public.sales_item_costs(item_id, kg_qty, cost_per_kg, cost)
select sii.id, k.kg, round(coalesce(l.v,0) / nullif(k.kg,0), 2), round(coalesce(l.v,0))
from public.sales_invoice_items sii join public.products p on p.id = sii.product_id
cross join lateral (select round(public._kg_of(sii.unit_id, sii.quantity, p.kg_per_bao), 3) as kg) k
left join lateral (select sum(base_qty * unit_cost) v from public.sales_item_lots where item_id = sii.id) l on true
on conflict (item_id) do nothing;

-- Quản lý cũng được sửa giá nhập (nhân viên thì không)
create or replace function public.save_product(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_code text; v_kg numeric := (p->>'kg_per_bao')::numeric; u jsonb; v_unit record; v_factor numeric;
begin
  perform public.require_role('owner','manager');
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Tên sản phẩm không được trống'; end if;
  if v_kg is null or v_kg <= 0 then raise exception 'Số kg mỗi bao phải lớn hơn 0'; end if;
  v_code := upper(nullif(trim(p->>'product_code'),''));
  if v_id is null then
    if v_code is null then
      v_code := public.next_code(case (select name from public.categories where id = (p->>'category_id')::uuid)
                  when 'Gạo' then 'GAO' when 'Lúa' then 'LUA' when 'Cám' then 'CAM' else 'SP' end, 3);
    end if;
    insert into public.products(product_code, barcode, name, category_id, kg_per_bao, cost_price, min_stock, description)
    values (v_code, nullif(trim(p->>'barcode'),''), trim(p->>'name'), (p->>'category_id')::uuid, v_kg,
            coalesce((p->>'cost_price')::numeric,0), coalesce((p->>'min_stock')::numeric,0), coalesce(p->>'description',''))
    returning id into v_id;
    insert into public.inventory_balances(product_id, qty) values (v_id, 0);
  else
    if exists(select 1 from public.products where id = v_id and kg_per_bao <> v_kg)
       and exists(select 1 from public.inventory_transactions where product_id = v_id) then
      raise exception 'Không đổi được số kg/bao khi sản phẩm đã có phát sinh kho. Hãy tạo sản phẩm mới.';
    end if;
    update public.products set
      product_code = coalesce(v_code, product_code), barcode = nullif(trim(p->>'barcode'),''), name = trim(p->>'name'),
      category_id = (p->>'category_id')::uuid, kg_per_bao = v_kg, min_stock = coalesce((p->>'min_stock')::numeric,0),
      description = coalesce(p->>'description',''), is_active = coalesce((p->>'is_active')::boolean, true),
      cost_price = case when public.has_role('owner','manager') and p ? 'cost_price' then (p->>'cost_price')::numeric else cost_price end,
      updated_at = now()
    where id = v_id;
  end if;
  for u in select * from jsonb_array_elements(coalesce(p->'units','[]'::jsonb)) loop
    select * into v_unit from public.units where code = u->>'unit_code';
    if v_unit.id is null then raise exception 'Đơn vị không hợp lệ: %', u->>'unit_code'; end if;
    v_factor := case v_unit.code when 'bao' then 1 when 'kg' then 1 / v_kg when 'tan' then 1000 / v_kg end;
    insert into public.product_units(product_id, unit_id, factor, retail_price, wholesale_price, is_active)
    values (v_id, v_unit.id, v_factor, coalesce((u->>'retail_price')::numeric,0), coalesce((u->>'wholesale_price')::numeric,0),
            coalesce((u->>'is_active')::boolean,true))
    on conflict (product_id, unit_id) do update set factor = excluded.factor, retail_price = excluded.retail_price,
      wholesale_price = excluded.wholesale_price, is_active = excluded.is_active;
  end loop;
  if not exists(select 1 from public.product_units pu join public.units un on un.id = pu.unit_id
                where pu.product_id = v_id and un.code = 'bao') then
    raise exception 'Sản phẩm phải có đơn vị Bao';
  end if;
  perform public.audit('save_product','products', v_id, p);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.dashboard_summary(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_d date := coalesce(p_day, (now() at time zone 'Asia/Ho_Chi_Minh')::date); v_can_profit boolean; res jsonb;
begin
  perform public.require_role('owner','manager','staff');
  v_can_profit := public.has_role('owner','manager');
  with inv as (
    select i.*, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as d from public.sales_invoices i where i.status = 'completed'
  ), cogs as (
    select sii.invoice_id, sum(sic.cost) as cogs
    from public.sales_item_costs sic join public.sales_invoice_items sii on sii.id = sic.item_id group by sii.invoice_id
  )
  select jsonb_build_object(
    'day', v_d,
    'revenue_today', coalesce((select sum(total_amount) from inv where inv.d = v_d),0),
    'invoices_today', (select count(*) from inv where inv.d = v_d),
    'cash_in_today', coalesce((select sum(amount) from public.cash_transactions c
        where c.direction = 'in' and c.category in ('sale','debt_collection') and (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date = v_d),0)
      - coalesce((select sum(amount) from public.cash_transactions c
        where c.category = 'sale_cancel' and (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date = v_d),0),
    'receivable', coalesce((select sum(amount) from public.receivable_payable_entries where party_type='customer'),0),
    'payable', coalesce((select sum(amount) from public.receivable_payable_entries where party_type='supplier'),0),
    'gross_profit_today', case when v_can_profit then
        coalesce((select sum(inv.total_amount - coalesce(cogs.cogs,0)) from inv left join cogs on cogs.invoice_id = inv.id where inv.d = v_d),0) end,
    'stock_bao', coalesce((select sum(qty) from public.inventory_balances),0),
    'stock_kg', coalesce((select sum(b.qty * p.kg_per_bao) from public.inventory_balances b join public.products p on p.id = b.product_id),0),
    'stock_value', case when v_can_profit then coalesce((select sum(qty_remaining * unit_cost) from public.inventory_lots),0) end,
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', b.qty, 'min', p.min_stock) order by b.qty)
        from public.products p join public.inventory_balances b on b.product_id = p.id
        where p.is_active and p.min_stock > 0 and b.qty <= p.min_stock), '[]'::jsonb),
    'last7', (select jsonb_agg(jsonb_build_object('day', g::date, 'revenue', coalesce((select sum(total_amount) from inv where inv.d = g::date),0)) order by g)
        from generate_series(v_d - 6, v_d, interval '1 day') g),
    'by_month', (select jsonb_agg(jsonb_build_object('month', to_char(m,'MM/YYYY'),
          'revenue', coalesce((select sum(total_amount) from inv where date_trunc('month', inv.d) = m),0)) order by m)
        from generate_series(date_trunc('month', v_d) - interval '5 months', date_trunc('month', v_d), interval '1 month') m),
    'top_products', coalesce((select jsonb_agg(t) from (
        select sii.product_name as name, sum(sii.base_qty) as qty_bao, sum(sii.line_total) as revenue
        from public.sales_invoice_items sii join inv on inv.id = sii.invoice_id
        where inv.d > v_d - 30 group by sii.product_name order by sum(sii.line_total) desc limit 5) t), '[]'::jsonb),
    'debts_due', coalesce((select jsonb_agg(t) from (
        select i.invoice_code, i.customer_name, i.debt_remaining, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as day
        from public.sales_invoices i where i.status = 'completed' and i.debt_remaining > 0
        order by i.invoice_date limit 5) t), '[]'::jsonb),
    'can_see_profit', v_can_profit
  ) into res;
  return res;
end $$;

create or replace function public.profit_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.require_role('owner','manager');
  with inv as (select * from public.sales_invoices where status='completed'
               and (invoice_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to),
  cogs as (select coalesce(sum(sic.cost),0) v from public.sales_item_costs sic
           join public.sales_invoice_items sii on sii.id = sic.item_id join inv on inv.id = sii.invoice_id),
  opex as (select coalesce(sum(amount),0) v from public.cash_transactions where direction='out'
           and category in ('transport','labor','utility','other_out') and (txn_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to)
  select jsonb_build_object('revenue', (select coalesce(sum(total_amount),0) from inv), 'cogs', (select v from cogs),
    'gross_profit', (select coalesce(sum(total_amount),0) from inv) - (select v from cogs), 'operating_expenses', (select v from opex),
    'net_profit', (select coalesce(sum(total_amount),0) from inv) - (select v from cogs) - (select v from opex)) into res;
  return res;
end $$;

-- Doanh thu & lợi nhuận theo ngày: Lợi nhuận = Doanh thu − Σ(kg bán × giá nhập/kg)
create or replace function public.daily_report(p_from date, p_to date)
returns table(day date, invoices bigint, revenue numeric, cost numeric, profit numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('owner','manager');
  if p_to < p_from then raise exception 'Ngày kết thúc phải sau ngày bắt đầu'; end if;
  if p_to - p_from > 366 then raise exception 'Chỉ xem tối đa 1 năm mỗi lần'; end if;
  return query
  with inv as (
    select i.id, i.total_amount, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as d
    from public.sales_invoices i
    where i.status = 'completed' and (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
  ), c as (
    select sii.invoice_id, sum(sic.cost) as v
    from public.sales_item_costs sic join public.sales_invoice_items sii on sii.id = sic.item_id
    where sii.invoice_id in (select id from inv) group by sii.invoice_id
  )
  select g::date, count(inv.id), coalesce(sum(inv.total_amount),0), coalesce(sum(c.v),0),
         coalesce(sum(inv.total_amount),0) - coalesce(sum(c.v),0)
  from generate_series(p_from, p_to, interval '1 day') g
  left join inv on inv.d = g::date left join c on c.invoice_id = inv.id
  group by g order by g;
end $$;

-- Chi tiết tiền vốn của 1 ngày: từng món × số kg × giá nhập/kg
create or replace function public.daily_cost_detail(p_day date)
returns table(product_code text, product_name text, kg_sold numeric, cost_per_kg numeric, cost numeric, revenue numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('owner','manager');
  return query
  select sii.product_code, sii.product_name, sum(sic.kg_qty), sic.cost_per_kg, sum(sic.cost), sum(sii.line_total)
  from public.sales_invoice_items sii
  join public.sales_invoices i on i.id = sii.invoice_id
  join public.sales_item_costs sic on sic.item_id = sii.id
  where i.status = 'completed' and (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date = p_day
  group by sii.product_code, sii.product_name, sic.cost_per_kg
  order by sum(sic.cost) desc;
end $$;

revoke execute on function public._snapshot_item_cost(), public._kg_of(uuid,numeric,numeric) from anon, public, authenticated;
revoke execute on function public.daily_cost_detail(date) from anon, public;
grant execute on function public.daily_cost_detail(date) to authenticated;

-- ===== 20261126000007_real_profit.sql =====
-- =====================================================================
-- LỢI NHUẬN THỰC = DOANH THU − VỐN − CHI TIÊU (theo ngày)
-- Chỉ THÊM hàm mới; không sửa hàm cũ, không đụng dữ liệu.
-- Chi tiêu = các khoản chi vận hành trong sổ quỹ (mục Chi tiêu + khoản chi ghi tay kiểu cũ):
--   transport, labor, utility, other_out. Không gồm chi nhập hàng (đã nằm trong vốn) và hoàn tiền hủy HĐ.
-- =====================================================================
create or replace function public.real_profit_report(p_from date, p_to date)
returns table(day date, invoices bigint, revenue numeric, cost numeric, expenses numeric, gross_profit numeric, real_profit numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('owner','manager');
  if p_to < p_from then raise exception 'Ngày kết thúc phải sau ngày bắt đầu'; end if;
  if p_to - p_from > 366 then raise exception 'Chỉ xem tối đa 1 năm mỗi lần'; end if;
  return query
  with days as (select g::date d from generate_series(p_from, p_to, interval '1 day') g),
  inv as (
    select i.id, i.total_amount, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as d
    from public.sales_invoices i
    where i.status = 'completed' and (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
  ),
  rev as (select inv.d, count(*) n, sum(inv.total_amount) v from inv group by inv.d),
  cst as (select inv.d, sum(sic.cost) v from public.sales_item_costs sic
          join public.sales_invoice_items sii on sii.id = sic.item_id join inv on inv.id = sii.invoice_id group by inv.d),
  exp as (select (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date d, sum(c.amount) v from public.cash_transactions c
          where c.direction = 'out' and c.category in ('transport','labor','utility','other_out')
            and (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to group by 1)
  select days.d, coalesce(rev.n,0), coalesce(rev.v,0), coalesce(cst.v,0), coalesce(exp.v,0),
         coalesce(rev.v,0) - coalesce(cst.v,0),
         coalesce(rev.v,0) - coalesce(cst.v,0) - coalesce(exp.v,0)
  from days left join rev on rev.d = days.d left join cst on cst.d = days.d left join exp on exp.d = days.d
  order by days.d;
end $$;
revoke execute on function public.real_profit_report(date,date) from anon, public;
grant execute on function public.real_profit_report(date,date) to authenticated;

-- ===== 20261126000008_backup.sql =====
-- =====================================================================
-- SAO LƯU: xuất toàn bộ dữ liệu (chỉ Chủ cửa hàng) + nhật ký sao lưu để nhắc định kỳ.
-- Chỉ THÊM bảng/hàm mới.
-- =====================================================================
create table public.backup_logs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  row_counts jsonb not null
);
alter table public.backup_logs enable row level security;
revoke all on public.backup_logs from anon;
revoke insert, update, delete, truncate on public.backup_logs from authenticated;
grant select on public.backup_logs to authenticated;
create policy "doc_chu" on public.backup_logs for select to authenticated using (public.has_role('owner'));

-- Trả về toàn bộ dữ liệu nghiệp vụ dạng JSON: { meta: {...}, tables: { ten_bang: [ ...dòng ] } }
create or replace function public.export_backup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; v_rows jsonb; v_tables jsonb := '{}'::jsonb; v_counts jsonb := '{}'::jsonb;
begin
  perform public.require_role('owner');
  foreach t in array array['store_settings','profiles','categories','units','products','product_units','product_prices',
    'customers','suppliers','warehouses','inventory_balances','inventory_lots','inventory_transactions',
    'stock_adjustments','stock_adjustment_items','cash_accounts','expense_categories','cash_transactions','payments',
    'payment_allocations','purchase_receipts','purchase_receipt_items','sales_invoices','sales_invoice_items',
    'sales_item_lots','sales_item_costs','receivable_payable_entries','expenses','doc_counters','audit_logs','backup_logs'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_rows;
    v_tables := v_tables || jsonb_build_object(t, v_rows);
    v_counts := v_counts || jsonb_build_object(t, jsonb_array_length(v_rows));
  end loop;
  insert into public.backup_logs(row_counts) values (v_counts);
  return jsonb_build_object(
    'meta', jsonb_build_object('app', 'Đại lý Bốn Biển', 'format', 'bangao-backup-v1', 'exported_at', now(),
      'exported_by', (select email from public.profiles where id = auth.uid()), 'row_counts', v_counts),
    'tables', v_tables);
end $$;

-- Lần sao lưu gần nhất (để nhắc trên Tổng quan)
create or replace function public.backup_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.has_role('owner') then jsonb_build_object(
    'last_backup_at', (select max(created_at) from public.backup_logs),
    'days_since', (select extract(day from now() - max(created_at))::int from public.backup_logs),
    'has_data', exists(select 1 from public.sales_invoices) or exists(select 1 from public.products)) end
$$;
revoke execute on function public.export_backup(), public.backup_status() from anon, public;
grant execute on function public.export_backup(), public.backup_status() to authenticated;

-- ===== 20261126000009_delete_entries.sql =====
-- XÓA PHẦN NHẬP SAI (chỉ Chủ cửa hàng). Mỗi hàm là 1 transaction: xóa chứng từ + gỡ mọi ảnh hưởng
-- (kho, lô FIFO, sổ quỹ, công nợ, thanh toán). Bản chụp dữ liệu bị xóa được lưu vào audit_logs.
-- Migration này chỉ THÊM hàm, không đụng dữ liệu có sẵn.

-- 1. Xóa hóa đơn bán (kể cả hóa đơn đã hủy). Hóa đơn còn hiệu lực thì trả hàng về đúng lô cũ.
create or replace function public.delete_sales_invoice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record; r record; v_snap jsonb; v_pt text; v_pays uuid[];
begin
  perform public.require_role('owner');
  select * into v from public.sales_invoices where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy hóa đơn'; end if;
  select string_agg(p.payment_code, ', ') into v_pt from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
   where pa.invoice_id = p_id and p.kind <> 'sale';
  if v_pt is not null then
    raise exception 'Hóa đơn % đã được thu nợ (phiếu %). Hãy xóa phiếu thu nợ đó trước (trong trang Khách hàng).', v.invoice_code, v_pt;
  end if;
  v_snap := jsonb_build_object('invoice', to_jsonb(v),
    'items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.sales_invoice_items i where i.invoice_id = p_id));
  if v.status = 'completed' then
    for r in select sil.lot_id, sil.base_qty, sii.product_id from public.sales_item_lots sil
             join public.sales_invoice_items sii on sii.id = sil.item_id where sii.invoice_id = p_id loop
      update public.inventory_lots set qty_remaining = qty_remaining + r.base_qty where id = r.lot_id;
      perform public._bump_balance(r.product_id, r.base_qty);
    end loop;
  end if;
  delete from public.inventory_transactions where ref_table = 'sales_invoices' and ref_id = p_id;
  delete from public.cash_transactions where ref_table = 'sales_invoices' and ref_id = p_id;
  delete from public.receivable_payable_entries where ref_table = 'sales_invoices' and ref_id = p_id;
  select array_agg(payment_id) into v_pays from public.payment_allocations where invoice_id = p_id;
  delete from public.payment_allocations where invoice_id = p_id;
  delete from public.payments where id = any(coalesce(v_pays, '{}'))
    and not exists (select 1 from public.payment_allocations pa where pa.payment_id = payments.id);
  delete from public.sales_item_lots where item_id in (select id from public.sales_invoice_items where invoice_id = p_id);
  delete from public.sales_item_costs where item_id in (select id from public.sales_invoice_items where invoice_id = p_id);
  delete from public.sales_invoice_items where invoice_id = p_id;
  delete from public.sales_invoices where id = p_id;
  perform public.audit('delete_invoice', 'sales_invoices', p_id, v_snap);
end $$;

-- 2. Xóa phiếu nhập. Chỉ được khi hàng của phiếu chưa bán/xuất (lô còn nguyên).
create or replace function public.delete_purchase_receipt(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record; v_bad text; v_snap jsonb; r record; v_pays uuid[]; v_lots uuid[]; v_prods uuid[];
begin
  perform public.require_role('owner');
  select * into v from public.purchase_receipts where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy phiếu nhập'; end if;
  perform 1 from public.inventory_lots where source_type = 'purchase' and source_id = p_id for update;
  select string_agg(distinct si.invoice_code, ', ') into v_bad
    from public.inventory_lots l join public.sales_item_lots sil on sil.lot_id = l.id
    join public.sales_invoice_items sii on sii.id = sil.item_id join public.sales_invoices si on si.id = sii.invoice_id
   where l.source_type = 'purchase' and l.source_id = p_id;
  if v_bad is not null then
    raise exception 'Hàng của phiếu % đã được bán trong hóa đơn %. Hãy xóa các hóa đơn đó trước.', v.receipt_code, v_bad;
  end if;
  if exists (select 1 from public.inventory_lots l where l.source_type = 'purchase' and l.source_id = p_id
             and (l.qty_remaining <> l.qty_in or exists (select 1 from public.inventory_transactions t where t.lot_id = l.id and t.ref_id <> p_id))) then
    raise exception 'Hàng của phiếu % đã được xuất/điều chỉnh kho. Hãy xóa phiếu điều chỉnh kho đó trước.', v.receipt_code;
  end if;
  if exists (select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
             where pa.receipt_id = p_id and p.kind <> 'purchase') then
    raise exception 'Phiếu % đã có lần trả nợ nhà cung cấp, không xóa được.', v.receipt_code;
  end if;
  if exists (select 1 from public.inventory_lots l join public.inventory_balances b on b.product_id = l.product_id
             where l.source_type = 'purchase' and l.source_id = p_id
             group by b.product_id, b.qty having b.qty < sum(l.qty_in)) then
    raise exception 'Tồn kho hiện tại nhỏ hơn số lượng của phiếu %, không xóa được.', v.receipt_code;
  end if;
  v_snap := jsonb_build_object('receipt', to_jsonb(v),
    'items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.purchase_receipt_items i where i.receipt_id = p_id));
  select array_agg(id), array_agg(distinct product_id) into v_lots, v_prods
    from public.inventory_lots where source_type = 'purchase' and source_id = p_id;
  v_lots := coalesce(v_lots, '{}'); v_prods := coalesce(v_prods, '{}');
  for r in select product_id, sum(qty_in) q from public.inventory_lots where id = any(v_lots) group by product_id loop
    perform public._bump_balance(r.product_id, -r.q);
  end loop;
  delete from public.inventory_transactions where lot_id = any(v_lots);
  delete from public.purchase_receipt_items where receipt_id = p_id;
  delete from public.inventory_lots where id = any(v_lots);
  -- Giá nhập của sản phẩm quay về giá của lô nhập gần nhất còn lại (nếu có)
  update public.products p set cost_price = l.unit_cost, updated_at = now()
    from (select distinct on (product_id) product_id, unit_cost from public.inventory_lots
          where product_id = any(v_prods) and source_type = 'purchase'
          order by product_id, received_at desc, seq desc) l
   where p.id = l.product_id;
  delete from public.cash_transactions where ref_table = 'purchase_receipts' and ref_id = p_id;
  delete from public.receivable_payable_entries where ref_table = 'purchase_receipts' and ref_id = p_id;
  select array_agg(payment_id) into v_pays from public.payment_allocations where receipt_id = p_id;
  delete from public.payment_allocations where receipt_id = p_id;
  delete from public.payments where id = any(coalesce(v_pays, '{}'))
    and not exists (select 1 from public.payment_allocations pa where pa.payment_id = payments.id);
  delete from public.purchase_receipts where id = p_id;
  perform public.audit('delete_receipt', 'purchase_receipts', p_id, v_snap);
end $$;

-- 3. Xóa phiếu điều chỉnh kho
create or replace function public.delete_stock_adjustment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record; r record; v_snap jsonb;
begin
  perform public.require_role('owner');
  select * into v from public.stock_adjustments where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy phiếu điều chỉnh'; end if;
  if exists (select 1 from public.inventory_lots l where l.source_type = 'adjustment' and l.source_id = p_id
             and (l.qty_remaining <> l.qty_in or exists (select 1 from public.sales_item_lots s where s.lot_id = l.id)
                  or exists (select 1 from public.inventory_transactions t where t.lot_id = l.id and t.ref_id <> p_id))) then
    raise exception 'Hàng tăng thêm từ phiếu % đã được bán/xuất. Hãy xóa các hóa đơn đó trước.', v.adjustment_code;
  end if;
  v_snap := jsonb_build_object('adjustment', to_jsonb(v),
    'items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.stock_adjustment_items i where i.adjustment_id = p_id));
  -- Phiếu giảm: trả hàng về đúng lô đã trừ
  for r in select lot_id, product_id, qty_change from public.inventory_transactions
           where ref_table = 'stock_adjustments' and ref_id = p_id and qty_change < 0 loop
    update public.inventory_lots set qty_remaining = qty_remaining - r.qty_change where id = r.lot_id;
    perform public._bump_balance(r.product_id, -r.qty_change);
  end loop;
  -- Phiếu tăng: bỏ lô đã tạo
  for r in select id, product_id, qty_in from public.inventory_lots where source_type = 'adjustment' and source_id = p_id loop
    perform public._bump_balance(r.product_id, -r.qty_in);
  end loop;
  delete from public.inventory_transactions where ref_table = 'stock_adjustments' and ref_id = p_id;
  delete from public.inventory_lots where source_type = 'adjustment' and source_id = p_id;
  delete from public.stock_adjustment_items where adjustment_id = p_id;
  delete from public.stock_adjustments where id = p_id;
  perform public.audit('delete_adjustment', 'stock_adjustments', p_id, v_snap);
end $$;

-- 4. Xóa phiếu thu nợ khách: nợ của các hóa đơn quay lại như trước
create or replace function public.delete_debt_collection(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record; r record;
begin
  perform public.require_role('owner');
  select * into v from public.payments where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy phiếu thu nợ'; end if;
  if v.kind <> 'debt_collection' then raise exception 'Phiếu % không phải phiếu thu nợ', v.payment_code; end if;
  for r in select invoice_id, amount from public.payment_allocations where payment_id = p_id and invoice_id is not null loop
    update public.sales_invoices set debt_remaining = debt_remaining + r.amount where id = r.invoice_id;
  end loop;
  delete from public.payment_allocations where payment_id = p_id;
  delete from public.cash_transactions where ref_table = 'payments' and ref_id = p_id;
  delete from public.receivable_payable_entries where ref_table = 'payments' and ref_id = p_id;
  delete from public.payments where id = p_id;
  perform public.audit('delete_debt_collection', 'payments', p_id, to_jsonb(v));
end $$;

-- 5. Xóa khoản thu khác ghi tay trong sổ quỹ (khoản tự động thì xóa từ chứng từ gốc)
create or replace function public.delete_cash_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public.require_role('owner');
  select * into v from public.cash_transactions where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy khoản thu/chi'; end if;
  if v.ref_table = 'expenses' then raise exception 'Khoản chi này xóa ở mục Chi tiêu'; end if;
  if v.ref_table is not null then raise exception 'Khoản này ghi tự động từ hóa đơn/phiếu. Hãy xóa hóa đơn/phiếu gốc.'; end if;
  delete from public.cash_transactions where id = p_id;
  perform public.audit('delete_cash', 'cash_transactions', p_id, to_jsonb(v));
end $$;

-- 6. Xóa khách hàng / nhà cung cấp / sản phẩm: chỉ khi chưa có giao dịch nào
create or replace function public.delete_customer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public.require_role('owner');
  select * into v from public.customers where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy khách hàng'; end if;
  if exists (select 1 from public.sales_invoices where customer_id = p_id)
     or exists (select 1 from public.payments where party_type = 'customer' and party_id = p_id)
     or exists (select 1 from public.receivable_payable_entries where party_type = 'customer' and party_id = p_id) then
    raise exception 'Khách % đã có hóa đơn hoặc công nợ. Hãy xóa các hóa đơn đó trước.', v.name;
  end if;
  delete from public.customers where id = p_id;
  perform public.audit('delete_customer', 'customers', p_id, to_jsonb(v));
end $$;

create or replace function public.delete_supplier(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public.require_role('owner');
  select * into v from public.suppliers where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy nhà cung cấp'; end if;
  if exists (select 1 from public.purchase_receipts where supplier_id = p_id)
     or exists (select 1 from public.payments where party_type = 'supplier' and party_id = p_id)
     or exists (select 1 from public.receivable_payable_entries where party_type = 'supplier' and party_id = p_id) then
    raise exception 'Nhà cung cấp % đã có phiếu nhập hoặc công nợ. Hãy xóa các phiếu đó trước.', v.name;
  end if;
  delete from public.suppliers where id = p_id;
  perform public.audit('delete_supplier', 'suppliers', p_id, to_jsonb(v));
end $$;

create or replace function public.delete_product(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public.require_role('owner');
  select * into v from public.products where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy sản phẩm'; end if;
  if exists (select 1 from public.inventory_transactions where product_id = p_id)
     or exists (select 1 from public.inventory_lots where product_id = p_id)
     or exists (select 1 from public.sales_invoice_items where product_id = p_id)
     or exists (select 1 from public.purchase_receipt_items where product_id = p_id)
     or exists (select 1 from public.stock_adjustment_items where product_id = p_id) then
    raise exception 'Sản phẩm % đã có nhập/bán. Hãy xóa các phiếu đó trước, hoặc chọn "ngừng bán".', v.name;
  end if;
  delete from public.product_prices where product_id = p_id;
  delete from public.product_units where product_id = p_id;
  delete from public.inventory_balances where product_id = p_id;
  delete from public.products where id = p_id;
  perform public.audit('delete_product', 'products', p_id, to_jsonb(v));
end $$;

revoke execute on function public.delete_sales_invoice(uuid), public.delete_purchase_receipt(uuid), public.delete_stock_adjustment(uuid),
  public.delete_debt_collection(uuid), public.delete_cash_entry(uuid), public.delete_customer(uuid), public.delete_supplier(uuid),
  public.delete_product(uuid) from anon, public;
grant execute on function public.delete_sales_invoice(uuid), public.delete_purchase_receipt(uuid), public.delete_stock_adjustment(uuid),
  public.delete_debt_collection(uuid), public.delete_cash_entry(uuid), public.delete_customer(uuid), public.delete_supplier(uuid),
  public.delete_product(uuid) to authenticated;

-- ===== 20261126000010_bulk_delete_supplier_pay.sql =====
-- 1) XÓA NHIỀU CÙNG LÚC, 2) XÓA TẤT CẢ (có sao lưu bắt buộc), 3) TRẢ NỢ NHÀ CUNG CẤP.
-- Migration này chỉ THÊM hàm, không đụng dữ liệu có sẵn.

-- TRẢ NỢ NCC: trừ dần vào phiếu nhập nợ cũ nhất. Không phải chi tiêu (đã nằm trong vốn).
create or replace function public.record_supplier_payment(p_supplier uuid, p_amount numeric, p_account text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_debt numeric; v_pay uuid; v_left numeric := p_amount; r record; v_take numeric; v_name text; v_code text;
begin
  perform public.require_role('owner','manager');
  if p_amount is null or p_amount <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  select name into v_name from public.suppliers where id = p_supplier;
  if v_name is null then raise exception 'Không tìm thấy nhà cung cấp'; end if;
  select coalesce(sum(amount),0) into v_debt from public.receivable_payable_entries where party_type='supplier' and party_id = p_supplier;
  if p_amount > v_debt then raise exception 'Chỉ còn nợ nhà cung cấp % đ', v_debt; end if;
  select id into v_acc from public.cash_accounts where code = coalesce(p_account,'cash');
  if v_acc is null then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  v_code := public.next_code('PC', 6);
  insert into public.payments(payment_code, party_type, party_id, kind, account_id, amount, note)
  values (v_code, 'supplier', p_supplier, 'supplier_payment', v_acc, p_amount, coalesce(p_note,'')) returning id into v_pay;
  for r in select id, debt_remaining from public.purchase_receipts
           where supplier_id = p_supplier and debt_remaining > 0 order by receipt_date, receipt_code for update loop
    exit when v_left <= 0;
    v_take := least(v_left, r.debt_remaining);
    insert into public.payment_allocations(payment_id, receipt_id, amount) values (v_pay, r.id, v_take);
    update public.purchase_receipts set debt_remaining = debt_remaining - v_take where id = r.id;
    v_left := v_left - v_take;
  end loop;
  insert into public.cash_transactions(account_id, direction, amount, category, ref_table, ref_id, party_name, note)
  values (v_acc, 'out', p_amount, 'supplier_payment', 'payments', v_pay, v_name, v_code);
  insert into public.receivable_payable_entries(party_type, party_id, amount, ref_table, ref_id, note)
  values ('supplier', p_supplier, -p_amount, 'payments', v_pay, 'Trả nợ ' || v_code);
  perform public.audit('pay_supplier','payments', v_pay, jsonb_build_object('supplier', p_supplier, 'amount', p_amount));
  return jsonb_build_object('payment_code', v_code);
end $$;

-- Xóa lần trả nợ NCC nhập sai (chỉ chủ): nợ của các phiếu nhập quay lại như trước
create or replace function public.delete_supplier_payment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record; r record;
begin
  perform public.require_role('owner');
  select * into v from public.payments where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy phiếu trả nợ'; end if;
  if v.kind <> 'supplier_payment' then raise exception 'Phiếu % không phải phiếu trả nợ nhà cung cấp', v.payment_code; end if;
  for r in select receipt_id, amount from public.payment_allocations where payment_id = p_id and receipt_id is not null loop
    update public.purchase_receipts set debt_remaining = debt_remaining + r.amount where id = r.receipt_id;
  end loop;
  delete from public.payment_allocations where payment_id = p_id;
  delete from public.cash_transactions where ref_table = 'payments' and ref_id = p_id;
  delete from public.receivable_payable_entries where ref_table = 'payments' and ref_id = p_id;
  delete from public.payments where id = p_id;
  perform public.audit('delete_supplier_payment', 'payments', p_id, to_jsonb(v));
end $$;

-- XÓA NHIỀU: mỗi mục xóa riêng (mục nào bị chặn thì bỏ qua, các mục khác vẫn xóa). Trả về số đã xóa + danh sách lỗi.
create or replace function public.delete_many(p_kind text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok int := 0; v_fail jsonb := '[]'; v_fn text;
begin
  perform public.require_role('owner');
  v_fn := case p_kind
    when 'invoice' then 'delete_sales_invoice' when 'receipt' then 'delete_purchase_receipt'
    when 'adjustment' then 'delete_stock_adjustment' when 'debt_collection' then 'delete_debt_collection'
    when 'supplier_payment' then 'delete_supplier_payment' when 'cash' then 'delete_cash_entry'
    when 'expense' then 'delete_expense' when 'customer' then 'delete_customer'
    when 'supplier' then 'delete_supplier' when 'product' then 'delete_product' end;
  if v_fn is null then raise exception 'Loại dữ liệu không hợp lệ: %', p_kind; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Chưa chọn mục nào'; end if;
  if array_length(p_ids, 1) > 2000 then raise exception 'Mỗi lần xóa tối đa 2000 mục'; end if;
  foreach v_id in array p_ids loop
    begin
      execute format('select public.%I($1)', v_fn) using v_id;
      v_ok := v_ok + 1;
    exception when others then
      v_fail := v_fail || jsonb_build_object('id', v_id, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('deleted', v_ok, 'failed', v_fail);
end $$;

-- XÓA TẤT CẢ: chỉ chủ, phải gõ đúng "XÓA TẤT CẢ" và phải vừa xuất sao lưu trong 15 phút gần nhất.
-- p_scope = 'transactions': xóa mọi giao dịch, GIỮ sản phẩm/khách/NCC (tồn kho về 0)
-- p_scope = 'everything'  : xóa cả sản phẩm, khách hàng, nhà cung cấp
-- Luôn giữ: tài khoản đăng nhập, thông tin cửa hàng, danh mục, đơn vị, nhật ký hệ thống, nhật ký sao lưu.
create or replace function public.reset_business_data(p_confirm text, p_scope text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_counts jsonb;
begin
  perform public.require_role('owner');
  if p_confirm is distinct from 'XÓA TẤT CẢ' then raise exception 'Phải gõ đúng: XÓA TẤT CẢ'; end if;
  if p_scope not in ('transactions','everything') then raise exception 'Phạm vi xóa không hợp lệ'; end if;
  if not exists (select 1 from public.backup_logs where created_by = auth.uid() and created_at > now() - interval '15 minutes') then
    raise exception 'Phải xuất sao lưu trước khi xóa tất cả (trong 15 phút gần nhất)';
  end if;
  v_counts := jsonb_build_object(
    'sales_invoices', (select count(*) from public.sales_invoices), 'purchase_receipts', (select count(*) from public.purchase_receipts),
    'cash_transactions', (select count(*) from public.cash_transactions), 'expenses', (select count(*) from public.expenses),
    'stock_adjustments', (select count(*) from public.stock_adjustments), 'payments', (select count(*) from public.payments),
    'products', (select count(*) from public.products), 'customers', (select count(*) from public.customers),
    'suppliers', (select count(*) from public.suppliers));
  delete from public.payment_allocations where true;
  delete from public.payments where true;
  delete from public.sales_item_lots where true;
  delete from public.sales_item_costs where true;
  delete from public.sales_invoice_items where true;
  delete from public.sales_invoices where true;
  delete from public.receivable_payable_entries where true;
  delete from public.expenses where true;
  delete from public.cash_transactions where true;
  delete from public.inventory_transactions where true;
  delete from public.purchase_receipt_items where true;
  delete from public.stock_adjustment_items where true;
  delete from public.stock_adjustments where true;
  delete from public.inventory_lots where true;
  delete from public.purchase_receipts where true;
  delete from public.doc_counters where prefix in ('HD','TT','PT','PN','PC','DC');
  if p_scope = 'everything' then
    delete from public.product_prices where true;
    delete from public.product_units where true;
    delete from public.inventory_balances where true;
    delete from public.products where true;
    delete from public.customers where true;
    delete from public.suppliers where true;
    delete from public.doc_counters where true;
  else
    update public.inventory_balances set qty = 0, updated_at = now() where qty <> 0;
  end if;
  perform public.audit('reset_all', 'all', null, jsonb_build_object('scope', p_scope, 'deleted', v_counts));
  return v_counts;
end $$;

revoke execute on function public.record_supplier_payment(uuid,numeric,text,text), public.delete_supplier_payment(uuid),
  public.delete_many(text,uuid[]), public.reset_business_data(text,text) from anon, public;
grant execute on function public.record_supplier_payment(uuid,numeric,text,text), public.delete_supplier_payment(uuid),
  public.delete_many(text,uuid[]), public.reset_business_data(text,text) to authenticated;

-- ===== 20261126000011_restore_backup.sql =====
-- KHÔI PHỤC TỪ FILE SAO LƯU (chỉ chủ). Chỉ chạy khi chưa có giao dịch nào (ví dụ ngay sau "Xóa tất cả"),
-- nên không bao giờ ghi đè dữ liệu đang có. Sản phẩm/khách/NCC đang có cùng mã sẽ được cập nhật theo file.
-- Migration này chỉ THÊM hàm, không đụng dữ liệu có sẵn.

create or replace function public._restore_rows(p_table text, p_rows jsonb, p_conflict text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_cols text; v_set text; n int;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then return 0; end if;
  select string_agg(format('%I', column_name), ', ' order by ordinal_position),
         string_agg(format('%I = excluded.%I', column_name, column_name), ', ' order by ordinal_position)
    into v_cols, v_set
    from information_schema.columns where table_schema = 'public' and table_name = p_table and is_generated = 'NEVER';
  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) %s',
    p_table, v_cols, v_cols, p_table,
    case when p_conflict is null then '' else format('on conflict (%s) do update set %s', p_conflict, v_set) end) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.restore_backup(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t jsonb := p->'tables'; v_counts jsonb := '{}'; v_bad text; v_n int; v_tbl text;
begin
  perform public.require_role('owner');
  if p->'meta'->>'format' is distinct from 'bangao-backup-v1' or t is null then
    raise exception 'File không phải file sao lưu của app (bangao-backup-v1)';
  end if;
  if exists (select 1 from public.sales_invoices) or exists (select 1 from public.purchase_receipts)
     or exists (select 1 from public.cash_transactions) or exists (select 1 from public.inventory_lots)
     or exists (select 1 from public.inventory_transactions) or exists (select 1 from public.payments)
     or exists (select 1 from public.expenses) or exists (select 1 from public.stock_adjustments)
     or exists (select 1 from public.receivable_payable_entries) then
    raise exception 'Chỉ khôi phục được khi chưa có giao dịch nào. Hãy dùng "Xóa tất cả" (xóa mọi giao dịch) trước.';
  end if;
  -- Danh mục gốc (nhóm hàng, đơn vị, quỹ) phải trùng với project hiện tại
  select string_agg(distinct x, ', ') into v_bad from (
    select 'nhóm hàng' x from jsonb_array_elements(coalesce(t->'products','[]')) e
      where not exists (select 1 from public.categories c where c.id = (e->>'category_id')::uuid)
    union all select 'đơn vị' from jsonb_array_elements(coalesce(t->'product_units','[]')) e
      where not exists (select 1 from public.units u where u.id = (e->>'unit_id')::uuid)
    union all select 'quỹ tiền' from jsonb_array_elements(coalesce(t->'cash_transactions','[]')) e
      where not exists (select 1 from public.cash_accounts a where a.id = (e->>'account_id')::uuid)) z;
  if v_bad is not null then
    raise exception 'File sao lưu thuộc một cơ sở dữ liệu khác (không khớp %). Chỉ khôi phục được vào đúng project đã sao lưu.', v_bad;
  end if;

  v_counts := v_counts || jsonb_build_object('customers', public._restore_rows('customers', t->'customers', 'id'));
  v_counts := v_counts || jsonb_build_object('suppliers', public._restore_rows('suppliers', t->'suppliers', 'id'));
  v_counts := v_counts || jsonb_build_object('products', public._restore_rows('products', t->'products', 'id'));
  perform public._restore_rows('product_units', t->'product_units', 'product_id, unit_id');
  delete from public.product_prices where changed_at = now();   -- dòng do trigger tự sinh trong lần khôi phục này
  perform public._restore_rows('product_prices', t->'product_prices', 'id');
  perform public._restore_rows('inventory_balances', t->'inventory_balances', 'product_id');
  v_counts := v_counts || jsonb_build_object('purchase_receipts', public._restore_rows('purchase_receipts', t->'purchase_receipts'));
  perform public._restore_rows('stock_adjustments', t->'stock_adjustments');
  perform public._restore_rows('inventory_lots', t->'inventory_lots');
  perform public._restore_rows('purchase_receipt_items', t->'purchase_receipt_items');
  perform public._restore_rows('stock_adjustment_items', t->'stock_adjustment_items');
  perform public._restore_rows('inventory_transactions', t->'inventory_transactions');
  v_counts := v_counts || jsonb_build_object('sales_invoices', public._restore_rows('sales_invoices', t->'sales_invoices'));
  perform public._restore_rows('sales_invoice_items', t->'sales_invoice_items');
  delete from public.sales_item_costs where true;               -- trigger tự sinh; thay bằng vốn đã chốt trong file
  perform public._restore_rows('sales_item_costs', t->'sales_item_costs');
  perform public._restore_rows('sales_item_lots', t->'sales_item_lots');
  perform public._restore_rows('payments', t->'payments');
  perform public._restore_rows('payment_allocations', t->'payment_allocations');
  v_counts := v_counts || jsonb_build_object('cash_transactions', public._restore_rows('cash_transactions', t->'cash_transactions'));
  v_counts := v_counts || jsonb_build_object('expenses', public._restore_rows('expenses', t->'expenses'));
  perform public._restore_rows('receivable_payable_entries', t->'receivable_payable_entries');
  -- Bộ đếm số chứng từ: lấy số lớn hơn giữa file và hiện tại
  insert into public.doc_counters(prefix, last_no)
  select e->>'prefix', (e->>'last_no')::int from jsonb_array_elements(coalesce(t->'doc_counters','[]')) e
  on conflict (prefix) do update set last_no = greatest(public.doc_counters.last_no, excluded.last_no);
  -- Đặt lại các bộ đếm tự tăng
  perform setval(pg_get_serial_sequence('public.inventory_transactions','id'), greatest(1, (select coalesce(max(id),0) from public.inventory_transactions)));
  perform setval(pg_get_serial_sequence('public.receivable_payable_entries','id'), greatest(1, (select coalesce(max(id),0) from public.receivable_payable_entries)));
  perform setval(pg_get_serial_sequence('public.product_prices','id'), greatest(1, (select coalesce(max(id),0) from public.product_prices)));
  perform setval(pg_get_serial_sequence('public.inventory_lots','seq'), greatest(1, (select coalesce(max(seq),0) from public.inventory_lots)));
  perform public.audit('restore_backup', 'all', null, jsonb_build_object('exported_at', p->'meta'->'exported_at', 'restored', v_counts));
  return v_counts;
end $$;

revoke execute on function public._restore_rows(text, jsonb, text) from anon, public, authenticated;
revoke execute on function public.restore_backup(jsonb) from anon, public;
grant execute on function public.restore_backup(jsonb) to authenticated;

-- ===== 20261126000012_units_fixed_costs.sql =====
-- =====================================================================
-- 1) ĐƠN VỊ TỒN KHO LINH HOẠT: mặt hàng có thể tính kho theo Bao (như cũ), theo Kg, hoặc theo cái/hủ/bịch/máng/miếng.
--    Quy ước: products.kg_per_bao = số kg của 1 đơn vị tồn kho (bao: 25/50…; kg: 1; hàng đếm cái: 1).
--    Nhờ quy ước này, FIFO, giá vốn (= số lượng × giá nhập), phiếu nhập… giữ nguyên công thức.
-- 2) CHI PHÍ CỐ ĐỊNH MỖI NGÀY (thuê nhà, lương, điện…) trừ vào lợi nhuận thực từng ngày.
-- 3) NHẬP TỒN KHO ĐẦU KỲ hàng loạt.
-- Chỉ THÊM đơn vị/cột/bảng/hàm; không xóa hay sửa dữ liệu có sẵn.
-- =====================================================================

insert into public.units(code, name) values
  ('hu','Hủ'), ('hu_lon','Hủ lớn'), ('hu_nho','Hủ nhỏ'), ('bich','Bịch'), ('mang','Máng'), ('mieng','Miếng'), ('cai','Cái')
on conflict (code) do nothing;
insert into public.categories(name, emoji, sort) values ('Hàng hóa','📦',4) on conflict (name) do nothing;

alter table public.products add column if not exists stock_unit_id uuid references public.units(id);   -- null = Bao (dữ liệu cũ)
alter table public.product_units add column if not exists label text;                                   -- tên hiển thị khi bán, vd "bể 4 bao"
grant select (stock_unit_id) on public.products to authenticated;

create or replace function public._stock_unit_code(p_product uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select u.code from public.products p join public.units u on u.id = p.stock_unit_id where p.id = p_product), 'bao')
$$;

-- Xem sản phẩm: thêm đơn vị tồn kho, có tính theo cân hay không, nhãn đơn vị
create or replace view public.v_products with (security_invoker = on) as
select p.id, p.product_code, p.barcode, p.name, p.category_id, c.name as category_name, c.emoji, p.kg_per_bao, p.min_stock,
       p.description, p.is_active, coalesce(b.qty,0) as stock_bao,
       case when coalesce(su.code,'bao') in ('bao','kg') then coalesce(b.qty,0) * p.kg_per_bao else 0 end as stock_kg,
       (select jsonb_agg(jsonb_build_object('unit_code', u.code, 'unit_name', u.name, 'factor', pu.factor, 'label', pu.label,
          'retail_price', pu.retail_price, 'wholesale_price', pu.wholesale_price, 'is_active', pu.is_active) order by pu.factor desc)
        from public.product_units pu join public.units u on u.id = pu.unit_id where pu.product_id = p.id) as units,
       coalesce(su.code,'bao') as stock_unit_code, coalesce(su.name,'Bao') as stock_unit_name,
       coalesce(su.code,'bao') in ('bao','kg') as weighed
from public.products p join public.categories c on c.id = p.category_id left join public.inventory_balances b on b.product_id = p.id
left join public.units su on su.id = p.stock_unit_id;
grant select on public.v_products to authenticated;

-- LƯU SẢN PHẨM (thay bản cũ): p.stock_unit = 'bao' (mặc định) | 'kg' | 'hu' | 'bich' | …
create or replace function public.save_product(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_code text; v_su text := coalesce(nullif(p->>'stock_unit',''), 'bao');
  v_su_id uuid; v_kg numeric; u jsonb; v_unit record; v_factor numeric; v_old_su text;
begin
  perform public.require_role('owner','manager');
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Tên sản phẩm không được trống'; end if;
  select id into v_su_id from public.units where code = v_su;
  if v_su_id is null then raise exception 'Đơn vị tồn kho không hợp lệ: %', v_su; end if;
  if v_su = 'bao' then
    v_kg := (p->>'kg_per_bao')::numeric;
    if v_kg is null or v_kg <= 0 then raise exception 'Số kg mỗi bao phải lớn hơn 0'; end if;
  else
    v_kg := 1;
  end if;
  v_code := upper(nullif(trim(p->>'product_code'),''));
  if v_id is null then
    if v_code is null then
      v_code := public.next_code(case (select name from public.categories where id = (p->>'category_id')::uuid)
                  when 'Gạo' then 'GAO' when 'Lúa' then 'LUA' when 'Cám' then 'CAM' else 'SP' end, 3);
    end if;
    insert into public.products(product_code, barcode, name, category_id, kg_per_bao, cost_price, min_stock, description, stock_unit_id)
    values (v_code, nullif(trim(p->>'barcode'),''), trim(p->>'name'), (p->>'category_id')::uuid, v_kg,
            coalesce((p->>'cost_price')::numeric,0), coalesce((p->>'min_stock')::numeric,0), coalesce(p->>'description',''), v_su_id)
    returning id into v_id;
    insert into public.inventory_balances(product_id, qty) values (v_id, 0);
  else
    v_old_su := public._stock_unit_code(v_id);
    if exists(select 1 from public.inventory_transactions where product_id = v_id)
       and (v_old_su <> v_su or exists(select 1 from public.products where id = v_id and kg_per_bao <> v_kg)) then
      raise exception 'Không đổi được đơn vị tồn kho hoặc số kg/bao khi sản phẩm đã có phát sinh kho. Hãy tạo sản phẩm mới.';
    end if;
    update public.products set
      product_code = coalesce(v_code, product_code), barcode = nullif(trim(p->>'barcode'),''), name = trim(p->>'name'),
      category_id = (p->>'category_id')::uuid, kg_per_bao = v_kg, min_stock = coalesce((p->>'min_stock')::numeric,0),
      description = coalesce(p->>'description',''), is_active = coalesce((p->>'is_active')::boolean, true), stock_unit_id = v_su_id,
      cost_price = case when public.has_role('owner','manager') and p ? 'cost_price' then (p->>'cost_price')::numeric else cost_price end,
      updated_at = now()
    where id = v_id;
    -- đơn vị không còn hợp lệ với đơn vị tồn kho mới thì tắt
    update public.product_units pu set is_active = false from public.units un
     where un.id = pu.unit_id and pu.product_id = v_id
       and not (case v_su when 'bao' then un.code in ('bao','kg','tan') when 'kg' then un.code in ('kg','tan') else un.code = v_su end);
  end if;
  for u in select * from jsonb_array_elements(coalesce(p->'units','[]'::jsonb)) loop
    select * into v_unit from public.units where code = u->>'unit_code';
    if v_unit.id is null then raise exception 'Đơn vị không hợp lệ: %', u->>'unit_code'; end if;
    v_factor := case
      when v_su = 'bao' and v_unit.code = 'bao' then 1
      when v_su = 'bao' and v_unit.code = 'kg' then 1 / v_kg
      when v_su = 'bao' and v_unit.code = 'tan' then 1000 / v_kg
      when v_su = 'kg' and v_unit.code = 'kg' then 1
      when v_su = 'kg' and v_unit.code = 'tan' then 1000
      when v_unit.code = v_su then 1 end;
    if v_factor is null then raise exception 'Đơn vị % không dùng được cho hàng tính kho theo %', v_unit.name, v_su; end if;
    insert into public.product_units(product_id, unit_id, factor, retail_price, wholesale_price, is_active, label)
    values (v_id, v_unit.id, v_factor, coalesce((u->>'retail_price')::numeric,0), coalesce((u->>'wholesale_price')::numeric,0),
            coalesce((u->>'is_active')::boolean,true), nullif(trim(u->>'label'),''))
    on conflict (product_id, unit_id) do update set factor = excluded.factor, retail_price = excluded.retail_price,
      wholesale_price = excluded.wholesale_price, is_active = excluded.is_active, label = excluded.label;
  end loop;
  if not exists(select 1 from public.product_units pu where pu.product_id = v_id and pu.unit_id = v_su_id) then
    raise exception 'Sản phẩm phải có đơn vị bán là đơn vị tồn kho (%)', v_su;
  end if;
  perform public.audit('save_product','products', v_id, p);
  return jsonb_build_object('id', v_id);
end $$;

-- Không bán ở giá 0 khi mặt hàng chưa có giá bán (trừ khi chủ/quản lý tự nhập giá)
create or replace function public._guard_zero_price() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.unit_price = 0 and new.list_price = 0 then
    raise exception 'Mặt hàng "%" (%) chưa có giá bán. Hãy nhập giá cho mặt hàng trước.', new.product_name, new.unit_name;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_zero_price on public.sales_invoice_items;
create trigger trg_guard_zero_price before insert on public.sales_invoice_items for each row execute function public._guard_zero_price();

-- ---------- CHI PHÍ CỐ ĐỊNH MỖI NGÀY ----------
create table if not exists public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  amount_per_day numeric(14,0) not null check (amount_per_day > 0),
  note text not null default '',
  start_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  end_date date,
  sort int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.fixed_costs enable row level security;
revoke all on public.fixed_costs from anon;
revoke insert, update, delete, truncate on public.fixed_costs from authenticated;
grant select on public.fixed_costs to authenticated;
drop policy if exists "doc_quan_ly" on public.fixed_costs;
create policy "doc_quan_ly" on public.fixed_costs for select to authenticated using (public.has_role('owner','manager'));

-- Lưu: khoản mới bắt đầu hôm nay (hoặc ngày chọn). Sửa số tiền của khoản đã chạy từ trước → khoản cũ dừng hôm qua,
-- khoản mới bắt đầu hôm nay, để lợi nhuận các ngày cũ không bị đổi.
create or replace function public.save_fixed_cost(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_id uuid := nullif(p->>'id','')::uuid; v_old record; v_new uuid;
  v_amt numeric := (p->>'amount_per_day')::numeric; v_start date := coalesce(nullif(p->>'start_date','')::date, v_today);
begin
  perform public.require_role('owner','manager');
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Tên khoản chi phí không được trống'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Số tiền mỗi ngày phải lớn hơn 0'; end if;
  if v_id is null then
    insert into public.fixed_costs(name, amount_per_day, note, start_date, sort)
    values (trim(p->>'name'), v_amt, coalesce(p->>'note',''), v_start, coalesce((p->>'sort')::int, 0)) returning id into v_new;
    perform public.audit('create_fixed_cost','fixed_costs', v_new, p);
    return jsonb_build_object('id', v_new);
  end if;
  select * into v_old from public.fixed_costs where id = v_id for update;
  if v_old.id is null then raise exception 'Không tìm thấy khoản chi phí'; end if;
  if v_old.amount_per_day <> v_amt and v_old.start_date < v_today then
    update public.fixed_costs set end_date = v_today - 1 where id = v_id;
    insert into public.fixed_costs(name, amount_per_day, note, start_date, sort)
    values (trim(p->>'name'), v_amt, coalesce(p->>'note',''), v_today, v_old.sort) returning id into v_new;
  else
    update public.fixed_costs set name = trim(p->>'name'), amount_per_day = v_amt, note = coalesce(p->>'note',''),
      start_date = case when v_old.start_date >= v_today then v_start else v_old.start_date end where id = v_id;
    v_new := v_id;
  end if;
  perform public.audit('save_fixed_cost','fixed_costs', v_new, jsonb_build_object('old', to_jsonb(v_old), 'new', p));
  return jsonb_build_object('id', v_new);
end $$;

-- Ngừng: khoản đã chạy từ trước thì dừng từ hôm nay (giữ cho các ngày cũ); khoản chưa chạy thì xóa hẳn.
create or replace function public.stop_fixed_cost(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v record;
begin
  perform public.require_role('owner','manager');
  select * into v from public.fixed_costs where id = p_id for update;
  if v.id is null then raise exception 'Không tìm thấy khoản chi phí'; end if;
  if v.start_date >= v_today then delete from public.fixed_costs where id = p_id;
  else update public.fixed_costs set end_date = v_today - 1 where id = p_id; end if;
  perform public.audit('stop_fixed_cost','fixed_costs', p_id, to_jsonb(v));
end $$;

-- LỢI NHUẬN THỰC (thêm cột chi phí cố định): = doanh thu − vốn − chi tiêu − chi phí cố định
drop function if exists public.real_profit_report(date, date);
create function public.real_profit_report(p_from date, p_to date)
returns table(day date, invoices bigint, revenue numeric, cost numeric, expenses numeric, gross_profit numeric, real_profit numeric, fixed_costs numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('owner','manager');
  if p_to < p_from then raise exception 'Ngày kết thúc phải sau ngày bắt đầu'; end if;
  if p_to - p_from > 366 then raise exception 'Chỉ xem tối đa 1 năm mỗi lần'; end if;
  return query
  with days as (select g::date d from generate_series(p_from, p_to, interval '1 day') g),
  inv as (
    select i.id, i.total_amount, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as d
    from public.sales_invoices i
    where i.status = 'completed' and (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
  ),
  rev as (select inv.d, count(*) n, sum(inv.total_amount) v from inv group by inv.d),
  cst as (select inv.d, sum(sic.cost) v from public.sales_item_costs sic
          join public.sales_invoice_items sii on sii.id = sic.item_id join inv on inv.id = sii.invoice_id group by inv.d),
  exp as (select (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date d, sum(c.amount) v from public.cash_transactions c
          where c.direction = 'out' and c.category in ('transport','labor','utility','other_out')
            and (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to group by 1),
  fix as (select days.d, coalesce(sum(f.amount_per_day),0) v from days
          left join public.fixed_costs f on f.start_date <= days.d and (f.end_date is null or f.end_date >= days.d) group by days.d)
  select days.d, coalesce(rev.n,0), coalesce(rev.v,0), coalesce(cst.v,0), coalesce(exp.v,0),
         coalesce(rev.v,0) - coalesce(cst.v,0),
         coalesce(rev.v,0) - coalesce(cst.v,0) - coalesce(exp.v,0) - coalesce(fix.v,0),
         coalesce(fix.v,0)
  from days left join rev on rev.d = days.d left join cst on cst.d = days.d left join exp on exp.d = days.d
  left join fix on fix.d = days.d
  order by days.d;
end $$;

-- TỔNG QUAN: tồn kho theo bao/kg chỉ cộng hàng cân; thêm số mặt hàng còn hàng; tên đơn vị cho hàng sắp hết & bán chạy
create or replace function public.dashboard_summary(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_d date := coalesce(p_day, (now() at time zone 'Asia/Ho_Chi_Minh')::date); v_can_profit boolean; res jsonb;
begin
  perform public.require_role('owner','manager','staff');
  v_can_profit := public.has_role('owner','manager');
  with inv as (
    select i.*, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as d from public.sales_invoices i where i.status = 'completed'
  ), cogs as (
    select sii.invoice_id, sum(sic.cost) as cogs
    from public.sales_item_costs sic join public.sales_invoice_items sii on sii.id = sic.item_id group by sii.invoice_id
  ), pv as (
    select p.id, p.name, p.kg_per_bao, p.min_stock, p.is_active, coalesce(u.code,'bao') su, coalesce(u.name,'Bao') su_name, coalesce(b.qty,0) qty
    from public.products p left join public.units u on u.id = p.stock_unit_id left join public.inventory_balances b on b.product_id = p.id
  )
  select jsonb_build_object(
    'day', v_d,
    'revenue_today', coalesce((select sum(total_amount) from inv where inv.d = v_d),0),
    'invoices_today', (select count(*) from inv where inv.d = v_d),
    'cash_in_today', coalesce((select sum(amount) from public.cash_transactions c
        where c.direction = 'in' and c.category in ('sale','debt_collection') and (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date = v_d),0)
      - coalesce((select sum(amount) from public.cash_transactions c
        where c.category = 'sale_cancel' and (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date = v_d),0),
    'receivable', coalesce((select sum(amount) from public.receivable_payable_entries where party_type='customer'),0),
    'payable', coalesce((select sum(amount) from public.receivable_payable_entries where party_type='supplier'),0),
    'gross_profit_today', case when v_can_profit then
        coalesce((select sum(inv.total_amount - coalesce(cogs.cogs,0)) from inv left join cogs on cogs.invoice_id = inv.id where inv.d = v_d),0) end,
    'stock_bao', coalesce((select sum(qty) from pv where su = 'bao'),0),
    'stock_kg', coalesce((select sum(qty * kg_per_bao) from pv where su in ('bao','kg')),0),
    'stock_items', (select count(*) from pv where qty > 0),
    'stock_value', case when v_can_profit then coalesce((select sum(qty_remaining * unit_cost) from public.inventory_lots),0) end,
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'min', min_stock, 'unit', su_name) order by qty)
        from pv where is_active and min_stock > 0 and qty <= min_stock), '[]'::jsonb),
    'last7', (select jsonb_agg(jsonb_build_object('day', g::date, 'revenue', coalesce((select sum(total_amount) from inv where inv.d = g::date),0)) order by g)
        from generate_series(v_d - 6, v_d, interval '1 day') g),
    'by_month', (select jsonb_agg(jsonb_build_object('month', to_char(m,'MM/YYYY'),
          'revenue', coalesce((select sum(total_amount) from inv where date_trunc('month', inv.d) = m),0)) order by m)
        from generate_series(date_trunc('month', v_d) - interval '5 months', date_trunc('month', v_d), interval '1 month') m),
    'top_products', coalesce((select jsonb_agg(t) from (
        select sii.product_name as name, sum(sii.base_qty) as qty_bao, sum(sii.line_total) as revenue, max(pv.su_name) as unit
        from public.sales_invoice_items sii join inv on inv.id = sii.invoice_id left join pv on pv.id = sii.product_id
        where inv.d > v_d - 30 group by sii.product_name order by sum(sii.line_total) desc limit 5) t), '[]'::jsonb),
    'debts_due', coalesce((select jsonb_agg(t) from (
        select i.invoice_code, i.customer_name, i.debt_remaining, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as day
        from public.sales_invoices i where i.status = 'completed' and i.debt_remaining > 0
        order by i.invoice_date limit 5) t), '[]'::jsonb),
    'can_see_profit', v_can_profit
  ) into res;
  return res;
end $$;

-- NHẬP TỒN KHO ĐẦU KỲ: [{product_id, quantity}] theo đơn vị tồn kho, giá vốn = giá nhập hiện hành của mặt hàng
create or replace function public.create_opening_stock(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_n int := 0; v_q numeric; v_cost numeric; v_pid uuid;
begin
  perform public.require_role('owner','manager');
  for it in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_pid := (it->>'product_id')::uuid; v_q := (it->>'quantity')::numeric;
    continue when v_q is null or v_q = 0;
    if v_q < 0 then raise exception 'Số lượng tồn đầu kỳ không được âm'; end if;
    select cost_price into v_cost from public.products where id = v_pid;
    perform public.create_stock_adjustment(v_pid, public._stock_unit_code(v_pid), v_q, 'Tồn đầu kỳ', coalesce(v_cost,0));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('count', v_n);
end $$;

-- SAO LƯU / KHÔI PHỤC / XÓA TẤT CẢ: thêm bảng chi phí cố định
create or replace function public.export_backup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; v_rows jsonb; v_tables jsonb := '{}'::jsonb; v_counts jsonb := '{}'::jsonb;
begin
  perform public.require_role('owner');
  foreach t in array array['store_settings','profiles','categories','units','products','product_units','product_prices',
    'customers','suppliers','warehouses','inventory_balances','inventory_lots','inventory_transactions',
    'stock_adjustments','stock_adjustment_items','cash_accounts','expense_categories','cash_transactions','payments',
    'payment_allocations','purchase_receipts','purchase_receipt_items','sales_invoices','sales_invoice_items',
    'sales_item_lots','sales_item_costs','receivable_payable_entries','expenses','fixed_costs','doc_counters','audit_logs','backup_logs'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_rows;
    v_tables := v_tables || jsonb_build_object(t, v_rows);
    v_counts := v_counts || jsonb_build_object(t, jsonb_array_length(v_rows));
  end loop;
  insert into public.backup_logs(row_counts) values (v_counts);
  return jsonb_build_object(
    'meta', jsonb_build_object('app', 'Đại lý Bốn Biển', 'format', 'bangao-backup-v1', 'exported_at', now(),
      'exported_by', (select email from public.profiles where id = auth.uid()), 'row_counts', v_counts),
    'tables', v_tables);
end $$;

-- Khôi phục: đơn vị mới (hủ, bịch…) có thể chưa có ở project cũ → tạo theo file; thêm chi phí cố định
create or replace function public.restore_backup(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t jsonb := p->'tables'; v_counts jsonb := '{}'; v_bad text;
begin
  perform public.require_role('owner');
  if p->'meta'->>'format' is distinct from 'bangao-backup-v1' or t is null then
    raise exception 'File không phải file sao lưu của app (bangao-backup-v1)';
  end if;
  if exists (select 1 from public.sales_invoices) or exists (select 1 from public.purchase_receipts)
     or exists (select 1 from public.cash_transactions) or exists (select 1 from public.inventory_lots)
     or exists (select 1 from public.inventory_transactions) or exists (select 1 from public.payments)
     or exists (select 1 from public.expenses) or exists (select 1 from public.stock_adjustments)
     or exists (select 1 from public.receivable_payable_entries) then
    raise exception 'Chỉ khôi phục được khi chưa có giao dịch nào. Hãy dùng "Xóa tất cả" (xóa mọi giao dịch) trước.';
  end if;
  insert into public.units(id, code, name)
  select (e->>'id')::uuid, e->>'code', e->>'name' from jsonb_array_elements(coalesce(t->'units','[]')) e
  where not exists (select 1 from public.units u where u.code = e->>'code' or u.id = (e->>'id')::uuid);
  insert into public.categories(id, name, emoji, sort)
  select (e->>'id')::uuid, e->>'name', coalesce(e->>'emoji','🌾'), coalesce((e->>'sort')::int,0) from jsonb_array_elements(coalesce(t->'categories','[]')) e
  where not exists (select 1 from public.categories c where c.name = e->>'name' or c.id = (e->>'id')::uuid);
  select string_agg(distinct x, ', ') into v_bad from (
    select 'nhóm hàng' x from jsonb_array_elements(coalesce(t->'products','[]')) e
      where not exists (select 1 from public.categories c where c.id = (e->>'category_id')::uuid)
    union all select 'đơn vị' from jsonb_array_elements(coalesce(t->'product_units','[]')) e
      where not exists (select 1 from public.units u where u.id = (e->>'unit_id')::uuid)
    union all select 'quỹ tiền' from jsonb_array_elements(coalesce(t->'cash_transactions','[]')) e
      where not exists (select 1 from public.cash_accounts a where a.id = (e->>'account_id')::uuid)) z;
  if v_bad is not null then
    raise exception 'File sao lưu thuộc một cơ sở dữ liệu khác (không khớp %). Chỉ khôi phục được vào đúng project đã sao lưu.', v_bad;
  end if;
  v_counts := v_counts || jsonb_build_object('customers', public._restore_rows('customers', t->'customers', 'id'));
  v_counts := v_counts || jsonb_build_object('suppliers', public._restore_rows('suppliers', t->'suppliers', 'id'));
  v_counts := v_counts || jsonb_build_object('products', public._restore_rows('products', t->'products', 'id'));
  perform public._restore_rows('product_units', t->'product_units', 'product_id, unit_id');
  delete from public.product_prices where changed_at = now();
  perform public._restore_rows('product_prices', t->'product_prices', 'id');
  perform public._restore_rows('inventory_balances', t->'inventory_balances', 'product_id');
  v_counts := v_counts || jsonb_build_object('purchase_receipts', public._restore_rows('purchase_receipts', t->'purchase_receipts'));
  perform public._restore_rows('stock_adjustments', t->'stock_adjustments');
  perform public._restore_rows('inventory_lots', t->'inventory_lots');
  perform public._restore_rows('purchase_receipt_items', t->'purchase_receipt_items');
  perform public._restore_rows('stock_adjustment_items', t->'stock_adjustment_items');
  perform public._restore_rows('inventory_transactions', t->'inventory_transactions');
  v_counts := v_counts || jsonb_build_object('sales_invoices', public._restore_rows('sales_invoices', t->'sales_invoices'));
  perform public._restore_rows('sales_invoice_items', t->'sales_invoice_items');
  delete from public.sales_item_costs where true;
  perform public._restore_rows('sales_item_costs', t->'sales_item_costs');
  perform public._restore_rows('sales_item_lots', t->'sales_item_lots');
  perform public._restore_rows('payments', t->'payments');
  perform public._restore_rows('payment_allocations', t->'payment_allocations');
  v_counts := v_counts || jsonb_build_object('cash_transactions', public._restore_rows('cash_transactions', t->'cash_transactions'));
  v_counts := v_counts || jsonb_build_object('expenses', public._restore_rows('expenses', t->'expenses'));
  perform public._restore_rows('receivable_payable_entries', t->'receivable_payable_entries');
  v_counts := v_counts || jsonb_build_object('fixed_costs', public._restore_rows('fixed_costs', t->'fixed_costs', 'id'));
  insert into public.doc_counters(prefix, last_no)
  select e->>'prefix', (e->>'last_no')::int from jsonb_array_elements(coalesce(t->'doc_counters','[]')) e
  on conflict (prefix) do update set last_no = greatest(public.doc_counters.last_no, excluded.last_no);
  perform setval(pg_get_serial_sequence('public.inventory_transactions','id'), greatest(1, (select coalesce(max(id),0) from public.inventory_transactions)));
  perform setval(pg_get_serial_sequence('public.receivable_payable_entries','id'), greatest(1, (select coalesce(max(id),0) from public.receivable_payable_entries)));
  perform setval(pg_get_serial_sequence('public.product_prices','id'), greatest(1, (select coalesce(max(id),0) from public.product_prices)));
  perform setval(pg_get_serial_sequence('public.inventory_lots','seq'), greatest(1, (select coalesce(max(seq),0) from public.inventory_lots)));
  perform public.audit('restore_backup', 'all', null, jsonb_build_object('exported_at', p->'meta'->'exported_at', 'restored', v_counts));
  return v_counts;
end $$;

create or replace function public.reset_business_data(p_confirm text, p_scope text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_counts jsonb;
begin
  perform public.require_role('owner');
  if p_confirm is distinct from 'XÓA TẤT CẢ' then raise exception 'Phải gõ đúng: XÓA TẤT CẢ'; end if;
  if p_scope not in ('transactions','everything') then raise exception 'Phạm vi xóa không hợp lệ'; end if;
  if not exists (select 1 from public.backup_logs where created_by = auth.uid() and created_at > now() - interval '15 minutes') then
    raise exception 'Phải xuất sao lưu trước khi xóa tất cả (trong 15 phút gần nhất)';
  end if;
  v_counts := jsonb_build_object(
    'sales_invoices', (select count(*) from public.sales_invoices), 'purchase_receipts', (select count(*) from public.purchase_receipts),
    'cash_transactions', (select count(*) from public.cash_transactions), 'expenses', (select count(*) from public.expenses),
    'stock_adjustments', (select count(*) from public.stock_adjustments), 'payments', (select count(*) from public.payments),
    'products', (select count(*) from public.products), 'customers', (select count(*) from public.customers),
    'suppliers', (select count(*) from public.suppliers), 'fixed_costs', (select count(*) from public.fixed_costs));
  delete from public.payment_allocations where true;
  delete from public.payments where true;
  delete from public.sales_item_lots where true;
  delete from public.sales_item_costs where true;
  delete from public.sales_invoice_items where true;
  delete from public.sales_invoices where true;
  delete from public.receivable_payable_entries where true;
  delete from public.expenses where true;
  delete from public.cash_transactions where true;
  delete from public.inventory_transactions where true;
  delete from public.purchase_receipt_items where true;
  delete from public.stock_adjustment_items where true;
  delete from public.stock_adjustments where true;
  delete from public.inventory_lots where true;
  delete from public.purchase_receipts where true;
  delete from public.doc_counters where prefix in ('HD','TT','PT','PN','PC','DC');
  if p_scope = 'everything' then
    delete from public.product_prices where true;
    delete from public.product_units where true;
    delete from public.inventory_balances where true;
    delete from public.products where true;
    delete from public.customers where true;
    delete from public.suppliers where true;
    delete from public.fixed_costs where true;
    delete from public.doc_counters where true;
  else
    update public.inventory_balances set qty = 0, updated_at = now() where qty <> 0;
  end if;
  perform public.audit('reset_all', 'all', null, jsonb_build_object('scope', p_scope, 'deleted', v_counts));
  return v_counts;
end $$;

revoke execute on function public._stock_unit_code(uuid), public._guard_zero_price() from anon, public, authenticated;
revoke execute on function public.save_fixed_cost(jsonb), public.stop_fixed_cost(uuid), public.create_opening_stock(jsonb),
  public.real_profit_report(date,date) from anon, public;
grant execute on function public.save_fixed_cost(jsonb), public.stop_fixed_cost(uuid), public.create_opening_stock(jsonb),
  public.real_profit_report(date,date) to authenticated;

-- Chi tiết vốn trong ngày: thêm đơn vị tính (kg cho hàng cân; hủ/bịch… cho hàng đếm)
drop function if exists public.daily_cost_detail(date);
create function public.daily_cost_detail(p_day date)
returns table(product_code text, product_name text, kg_sold numeric, cost_per_kg numeric, cost numeric, revenue numeric, unit text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('owner','manager');
  return query
  select sii.product_code, sii.product_name, sum(sic.kg_qty), sic.cost_per_kg, sum(sic.cost), sum(sii.line_total),
         case when coalesce(u.code,'bao') in ('bao','kg') then 'kg' else lower(u.name) end
  from public.sales_invoice_items sii
  join public.sales_invoices i on i.id = sii.invoice_id
  join public.sales_item_costs sic on sic.item_id = sii.id
  left join public.products p on p.id = sii.product_id left join public.units u on u.id = p.stock_unit_id
  where i.status = 'completed' and (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date = p_day
  group by sii.product_code, sii.product_name, sic.cost_per_kg, 7
  order by sum(sic.cost) desc;
end $$;
revoke execute on function public.daily_cost_detail(date) from anon, public;
grant execute on function public.daily_cost_detail(date) to authenticated;

-- ===== 20261126000013_track_stock_switch.sql =====
-- =====================================================================
-- CÔNG TẮC QUẢN LÝ TỒN KHO (store_settings.track_stock)
--   true  = như trước: bán trừ kho FIFO, không cho bán quá tồn, nhập hàng tạo lô.
--   false = TẮT: bán không cần tồn kho, nhập hàng không tạo lô; vốn vẫn = số lượng × giá nhập của mặt hàng.
-- Mã kho (lô FIFO, điều chỉnh, tồn đầu kỳ, đối soát) GIỮ NGUYÊN để bật lại khi cần (xem README: "Bật lại quản lý tồn kho").
-- Chỉ THÊM cột/hàm; không xóa dữ liệu.
-- =====================================================================
alter table public.store_settings add column if not exists track_stock boolean not null default true;

create or replace function public._track_stock() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select track_stock from public.store_settings where id = 1), true)
$$;

create or replace function public.create_sales_invoice(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv uuid; v_code text; v_cust record; v_tier text; v_acc uuid; it jsonb; v_line int := 0;
  v_pu record; v_qty numeric; v_price numeric; v_list numeric; v_disc numeric; v_total_line numeric;
  v_sub numeric := 0; v_inv_disc numeric := coalesce((p->>'discount')::numeric,0); v_total numeric;
  v_paid numeric := coalesce((p->>'paid_amount')::numeric,0); v_item uuid; a record; v_pay uuid;
begin
  perform public.require_role('owner','manager','staff');
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Hóa đơn chưa có sản phẩm'; end if;
  select null::uuid as id, null::text as name, null::text as customer_type into v_cust;
  if nullif(p->>'customer_id','') is not null then
    select * into v_cust from public.customers where id = (p->>'customer_id')::uuid and is_active;
    if v_cust.id is null then raise exception 'Không tìm thấy khách hàng'; end if;
  end if;
  v_tier := coalesce(nullif(p->>'price_tier',''), case when v_cust.customer_type = 'si' then 'wholesale' else 'retail' end);
  select id into v_acc from public.cash_accounts where code = coalesce(nullif(p->>'account_code',''),'cash');
  if v_acc is null then raise exception 'Hình thức thanh toán không hợp lệ'; end if;

  v_code := public.next_code('HD', 6);
  insert into public.sales_invoices(invoice_code, customer_id, customer_name, price_tier, subtotal, discount, total_amount,
    paid_amount, debt_amount, debt_remaining, cash_given, account_id, note)
  values (v_code, v_cust.id, coalesce(v_cust.name,'Khách lẻ'), v_tier, 0, 0, 0, 0, 0, 0,
    nullif(p->>'cash_given','')::numeric, v_acc, coalesce(p->>'note',''))
  returning id into v_inv;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_line := v_line + 1;
    select pu.*, pr.name as pname, pr.product_code, pr.is_active as p_active, un.name as uname
      into v_pu
      from public.product_units pu join public.products pr on pr.id = pu.product_id join public.units un on un.id = pu.unit_id
     where pu.product_id = (it->>'product_id')::uuid and un.code = it->>'unit_code' and pu.is_active;
    if v_pu.product_id is null or not v_pu.p_active then raise exception 'Dòng %: sản phẩm/đơn vị không hợp lệ', v_line; end if;
    v_qty := (it->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Dòng % (%): số lượng phải > 0', v_line, v_pu.pname; end if;
    v_list := case v_tier when 'wholesale' then v_pu.wholesale_price else v_pu.retail_price end;
    v_price := coalesce(nullif(it->>'unit_price','')::numeric, v_list);
    if v_price < 0 then raise exception 'Dòng %: đơn giá không hợp lệ', v_line; end if;
    if v_price <> v_list and not public.has_role('owner','manager') then
      raise exception 'Nhân viên không được đổi giá bán (dòng %: %)', v_line, v_pu.pname;
    end if;
    v_disc := coalesce(nullif(it->>'discount','')::numeric, 0);
    if v_disc < 0 or v_disc > round(v_qty * v_price) then raise exception 'Dòng %: giảm giá không hợp lệ', v_line; end if;
    v_total_line := round(v_qty * v_price) - v_disc;   -- Thành tiền = SL × Đơn giá − Giảm giá dòng
    insert into public.sales_invoice_items(invoice_id, line_no, product_id, product_code, product_name, unit_id, unit_name,
      quantity, conversion_factor, base_qty, unit_price, list_price, discount, line_total)
    values (v_inv, v_line, v_pu.product_id, v_pu.product_code, v_pu.pname, v_pu.unit_id, v_pu.uname,
      v_qty, v_pu.factor, round(v_qty * v_pu.factor, 4), v_price, v_list, v_disc, v_total_line)
    returning id into v_item;
    if public._track_stock() then   -- đang quản lý tồn kho: trừ kho theo FIFO; tắt thì bỏ qua, vốn vẫn tính theo giá nhập
      for a in select * from public._fifo_consume(v_pu.product_id, round(v_qty * v_pu.factor, 4), 'sale', 'sales_invoices', v_inv, v_code) loop
        insert into public.sales_item_lots(item_id, lot_id, base_qty, unit_cost) values (v_item, a.lot_id, a.qty, a.unit_cost);
      end loop;
    end if;
    v_sub := v_sub + v_total_line;
  end loop;

  if v_inv_disc < 0 or v_inv_disc > v_sub then raise exception 'Giảm giá hóa đơn không hợp lệ'; end if;
  v_total := v_sub - v_inv_disc;
  if v_paid < 0 then raise exception 'Số tiền thanh toán không hợp lệ'; end if;
  if v_paid > v_total then v_paid := v_total; end if;           -- tiền thừa trả lại khách, không ghi vào quỹ
  if v_paid < v_total and v_cust.id is null then raise exception 'Ghi nợ phải chọn khách hàng'; end if;

  update public.sales_invoices set subtotal = v_sub, discount = v_inv_disc, total_amount = v_total, paid_amount = v_paid,
    debt_amount = v_total - v_paid, debt_remaining = v_total - v_paid where id = v_inv;

  if v_paid > 0 then
    insert into public.payments(payment_code, party_type, party_id, kind, account_id, amount, note)
    values (public.next_code('TT', 6), 'customer', v_cust.id, 'sale', v_acc, v_paid, v_code) returning id into v_pay;
    insert into public.payment_allocations(payment_id, invoice_id, amount) values (v_pay, v_inv, v_paid);
    insert into public.cash_transactions(account_id, direction, amount, category, ref_table, ref_id, party_name, note)
    values (v_acc, 'in', v_paid, 'sale', 'sales_invoices', v_inv, coalesce(v_cust.name,'Khách lẻ'), v_code);
  end if;
  if v_total - v_paid > 0 then
    insert into public.receivable_payable_entries(party_type, party_id, amount, ref_table, ref_id, note)
    values ('customer', v_cust.id, v_total - v_paid, 'sales_invoices', v_inv, 'Nợ ' || v_code);
  end if;
  perform public.audit('create_invoice','sales_invoices', v_inv, p);
  return jsonb_build_object('id', v_inv, 'invoice_code', v_code, 'total_amount', v_total, 'paid_amount', v_paid, 'debt_amount', v_total - v_paid);
end $$;

create or replace function public.create_purchase_receipt(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; it jsonb; v_line int := 0; v_pu record; v_qty numeric; v_price numeric; v_total numeric := 0;
  v_lt numeric; v_base numeric; v_lot uuid; v_paid numeric := coalesce((p->>'paid_amount')::numeric,0); v_acc uuid; v_sup record; v_pay uuid;
begin
  perform public.require_role('owner','manager');
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Phiếu nhập chưa có sản phẩm'; end if;
  select null::uuid as id, null::text as name into v_sup;
  if nullif(p->>'supplier_id','') is not null then
    select * into v_sup from public.suppliers where id = (p->>'supplier_id')::uuid;
  end if;
  select id into v_acc from public.cash_accounts where code = coalesce(nullif(p->>'account_code',''),'cash');
  v_code := public.next_code('PN', 4);
  insert into public.purchase_receipts(receipt_code, supplier_id, total_amount, note)
  values (v_code, v_sup.id, 0, coalesce(p->>'note','')) returning id into v_id;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_line := v_line + 1;
    select pu.*, pr.name as pname into v_pu from public.product_units pu join public.products pr on pr.id = pu.product_id
      join public.units un on un.id = pu.unit_id where pu.product_id = (it->>'product_id')::uuid and un.code = it->>'unit_code';
    if v_pu.product_id is null then raise exception 'Dòng %: sản phẩm/đơn vị không hợp lệ', v_line; end if;
    v_qty := (it->>'quantity')::numeric; v_price := (it->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Dòng % (%): số lượng phải > 0', v_line, v_pu.pname; end if;
    if v_price is null or v_price < 0 then raise exception 'Dòng % (%): giá nhập không hợp lệ', v_line, v_pu.pname; end if;
    v_lt := round(v_qty * v_price); v_base := round(v_qty * v_pu.factor, 4);
    v_lot := case when public._track_stock() then public._add_lot(v_pu.product_id, v_base, round(v_lt / v_base, 2), 'purchase', v_id, 'purchase',
                             v_code || '-' || v_line, v_code) end;   -- tắt quản lý tồn kho: không tạo lô, vẫn cập nhật giá nhập
    insert into public.purchase_receipt_items(receipt_id, line_no, product_id, unit_id, quantity, conversion_factor, base_qty, unit_price, line_total, lot_id)
    values (v_id, v_line, v_pu.product_id, v_pu.unit_id, v_qty, v_pu.factor, v_base, v_price, v_lt, v_lot);
    update public.products set cost_price = round(v_lt / v_base, 2), updated_at = now() where id = v_pu.product_id;
    v_total := v_total + v_lt;
  end loop;
  if v_paid < 0 or v_paid > v_total then raise exception 'Số tiền đã trả không hợp lệ'; end if;
  if v_paid < v_total and v_sup.id is null then raise exception 'Còn nợ thì phải chọn nhà cung cấp'; end if;
  update public.purchase_receipts set total_amount = v_total, paid_amount = v_paid, debt_amount = v_total - v_paid,
    debt_remaining = v_total - v_paid where id = v_id;
  if v_paid > 0 then
    insert into public.payments(payment_code, party_type, party_id, kind, account_id, amount, note)
    values (public.next_code('PC', 6), 'supplier', v_sup.id, 'purchase', v_acc, v_paid, v_code) returning id into v_pay;
    insert into public.payment_allocations(payment_id, receipt_id, amount) values (v_pay, v_id, v_paid);
    insert into public.cash_transactions(account_id, direction, amount, category, ref_table, ref_id, party_name, note)
    values (v_acc, 'out', v_paid, 'purchase', 'purchase_receipts', v_id, coalesce(v_sup.name,''), v_code);
  end if;
  if v_total - v_paid > 0 then
    insert into public.receivable_payable_entries(party_type, party_id, amount, ref_table, ref_id, note)
    values ('supplier', v_sup.id, v_total - v_paid, 'purchase_receipts', v_id, 'Nợ ' || v_code);
  end if;
  perform public.audit('create_receipt','purchase_receipts', v_id, p);
  return jsonb_build_object('id', v_id, 'receipt_code', v_code, 'total_amount', v_total);
end $$;

create or replace function public.create_stock_adjustment(p_product uuid, p_unit text, p_quantity numeric, p_reason text, p_unit_cost numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; v_pu record; v_base numeric; v_cost numeric;
begin
  perform public.require_role('owner','manager');
  if not public._track_stock() then raise exception 'Đang tắt quản lý tồn kho'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Phải nhập lý do điều chỉnh'; end if;
  if p_quantity is null or p_quantity = 0 then raise exception 'Số lượng điều chỉnh phải khác 0'; end if;
  select pu.* into v_pu from public.product_units pu join public.units un on un.id = pu.unit_id
    where pu.product_id = p_product and un.code = p_unit;
  if v_pu.product_id is null then raise exception 'Sản phẩm/đơn vị không hợp lệ'; end if;
  v_base := round(p_quantity * v_pu.factor, 4);
  v_code := public.next_code('DC', 4);
  insert into public.stock_adjustments(adjustment_code, reason) values (v_code, trim(p_reason)) returning id into v_id;
  if v_base < 0 then
    perform public._fifo_consume(p_product, -v_base, 'adjust_out', 'stock_adjustments', v_id, v_code || ' ' || trim(p_reason));
  else
    v_cost := coalesce(p_unit_cost, (select unit_cost from public.inventory_lots where product_id = p_product order by received_at desc, seq desc limit 1),
                       (select cost_price from public.products where id = p_product), 0);
    perform public._add_lot(p_product, v_base, v_cost, 'adjustment', v_id, 'adjust_in', v_code, v_code || ' ' || trim(p_reason));
  end if;
  insert into public.stock_adjustment_items(adjustment_id, product_id, unit_id, quantity, conversion_factor, base_qty, unit_cost)
  values (v_id, p_product, v_pu.unit_id, p_quantity, v_pu.factor, v_base, v_cost);
  perform public.audit('stock_adjust','stock_adjustments', v_id, jsonb_build_object('product', p_product, 'qty', p_quantity, 'reason', p_reason));
  return jsonb_build_object('id', v_id, 'adjustment_code', v_code);
end $$;

-- Tồn đầu kỳ: chặn khi đang tắt quản lý tồn kho
create or replace function public.create_opening_stock(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_n int := 0; v_q numeric; v_cost numeric; v_pid uuid;
begin
  perform public.require_role('owner','manager');
  if not public._track_stock() then raise exception 'Đang tắt quản lý tồn kho'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_pid := (it->>'product_id')::uuid; v_q := (it->>'quantity')::numeric;
    continue when v_q is null or v_q = 0;
    if v_q < 0 then raise exception 'Số lượng tồn đầu kỳ không được âm'; end if;
    select cost_price into v_cost from public.products where id = v_pid;
    perform public.create_stock_adjustment(v_pid, public._stock_unit_code(v_pid), v_q, 'Tồn đầu kỳ', coalesce(v_cost,0));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('count', v_n);
end $$;

-- Bật/tắt quản lý tồn kho (chỉ chủ). Bật lại: tồn kho các mặt hàng bắt đầu từ số đang lưu, hãy "Nhập tồn đầu kỳ" sau khi bật.
create or replace function public.set_track_stock(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('owner');
  update public.store_settings set track_stock = p_on, updated_at = now() where id = 1;
  perform public.audit('set_track_stock', 'store_settings', null, jsonb_build_object('track_stock', p_on));
end $$;

revoke execute on function public._track_stock() from anon, public, authenticated;
revoke execute on function public.set_track_stock(boolean) from anon, public;
grant execute on function public.set_track_stock(boolean) to authenticated;

-- ===== 20261126000014_cash_by_account.sql =====
-- TIỀN NHẬN ĐƯỢC THEO NGÀY, TÁCH TIỀN MẶT / CHUYỂN KHOẢN (chỉ chủ & quản lý).
-- = thu bán hàng + thu nợ khách − hoàn tiền hủy hóa đơn, theo quỹ (cash / bank) và ngày ghi sổ quỹ.
-- Không gồm "thu khác" (other_in) — trả riêng ở cột other_in để app hiện kèm.
-- Chỉ THÊM hàm; không đụng dữ liệu.
create or replace function public.cash_received_report(p_from date, p_to date)
returns table(day date, cash_sale numeric, cash_debt numeric, cash_refund numeric, cash_total numeric,
              bank_sale numeric, bank_debt numeric, bank_refund numeric, bank_total numeric, other_in numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('owner','manager');
  if p_to < p_from then raise exception 'Ngày kết thúc phải sau ngày bắt đầu'; end if;
  if p_to - p_from > 366 then raise exception 'Chỉ xem tối đa 1 năm mỗi lần'; end if;
  return query
  with days as (select g::date d from generate_series(p_from, p_to, interval '1 day') g),
  t as (
    select (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date d, a.code acc, c.category, c.direction, c.amount
    from public.cash_transactions c join public.cash_accounts a on a.id = c.account_id
    where (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
  ),
  g as (
    select t.d,
      sum(case when acc = 'cash' and category = 'sale' and direction = 'in' then amount else 0 end) cs,
      sum(case when acc = 'cash' and category = 'debt_collection' and direction = 'in' then amount else 0 end) cd,
      sum(case when acc = 'cash' and category = 'sale_cancel' and direction = 'out' then amount else 0 end) cr,
      sum(case when acc = 'bank' and category = 'sale' and direction = 'in' then amount else 0 end) bs,
      sum(case when acc = 'bank' and category = 'debt_collection' and direction = 'in' then amount else 0 end) bd,
      sum(case when acc = 'bank' and category = 'sale_cancel' and direction = 'out' then amount else 0 end) br,
      sum(case when category = 'other_in' and direction = 'in' then amount else 0 end) oi
    from t group by t.d
  )
  select days.d, coalesce(g.cs,0), coalesce(g.cd,0), coalesce(g.cr,0), coalesce(g.cs,0) + coalesce(g.cd,0) - coalesce(g.cr,0),
         coalesce(g.bs,0), coalesce(g.bd,0), coalesce(g.br,0), coalesce(g.bs,0) + coalesce(g.bd,0) - coalesce(g.br,0), coalesce(g.oi,0)
  from days left join g on g.d = days.d order by days.d;
end $$;
revoke execute on function public.cash_received_report(date,date) from anon, public;
grant execute on function public.cash_received_report(date,date) to authenticated;
