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
