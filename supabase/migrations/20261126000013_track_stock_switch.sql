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
