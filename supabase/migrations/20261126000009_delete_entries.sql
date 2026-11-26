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
