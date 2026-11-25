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
