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
