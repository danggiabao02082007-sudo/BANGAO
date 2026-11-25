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
