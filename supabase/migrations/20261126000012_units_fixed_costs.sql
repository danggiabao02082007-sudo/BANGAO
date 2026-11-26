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
