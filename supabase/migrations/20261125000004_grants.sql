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
