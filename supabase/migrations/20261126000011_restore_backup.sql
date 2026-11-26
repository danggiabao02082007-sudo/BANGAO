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
