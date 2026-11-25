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
