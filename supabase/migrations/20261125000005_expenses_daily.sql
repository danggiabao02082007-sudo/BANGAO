-- =====================================================================
-- CHI TIÊU (thêm / sửa / xóa) + BÁO CÁO DOANH THU & LỢI NHUẬN THEO NGÀY
-- =====================================================================
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  name text not null check (length(trim(name)) > 0),
  amount numeric(14,0) not null check (amount > 0),
  note text not null default '',
  account_id uuid not null references public.cash_accounts(id),
  cash_txn_id uuid references public.cash_transactions(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.expenses(expense_date);
alter table public.expenses enable row level security;
revoke all on public.expenses from anon;
revoke insert, update, delete, truncate on public.expenses from authenticated;
grant select on public.expenses to authenticated;
create policy "doc_quan_ly" on public.expenses for select to authenticated using (public.has_role('owner','manager'));

-- Thêm hoặc sửa khoản chi; sổ quỹ (cash_transactions) được cập nhật theo cùng transaction.
-- p = {id?, expense_date, name, amount, note, account_code}
create or replace function public.save_expense(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_acc uuid; v_amt numeric := (p->>'amount')::numeric; v_name text := trim(coalesce(p->>'name',''));
  v_date date := coalesce(nullif(p->>'expense_date','')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date); v_txn uuid; v_old record;
begin
  perform public.require_role('owner','manager');
  if v_name = '' then raise exception 'Phải nhập tên khoản chi'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Số tiền phải lớn hơn 0'; end if;
  select id into v_acc from public.cash_accounts where code = coalesce(nullif(p->>'account_code',''),'cash');
  if v_acc is null then raise exception 'Quỹ không hợp lệ'; end if;
  if v_id is null then
    insert into public.cash_transactions(account_id, txn_date, direction, amount, category, ref_table, party_name, note)
    values (v_acc, (v_date + time '12:00') at time zone 'Asia/Ho_Chi_Minh', 'out', v_amt, 'other_out', 'expenses', v_name, coalesce(p->>'note',''))
    returning id into v_txn;
    insert into public.expenses(expense_date, name, amount, note, account_id, cash_txn_id)
    values (v_date, v_name, v_amt, coalesce(p->>'note',''), v_acc, v_txn) returning id into v_id;
    update public.cash_transactions set ref_id = v_id where id = v_txn;
    perform public.audit('create_expense','expenses', v_id, p);
  else
    select * into v_old from public.expenses where id = v_id for update;
    if v_old.id is null then raise exception 'Không tìm thấy khoản chi'; end if;
    update public.expenses set expense_date = v_date, name = v_name, amount = v_amt, note = coalesce(p->>'note',''),
      account_id = v_acc, updated_at = now() where id = v_id;
    update public.cash_transactions set account_id = v_acc, txn_date = (v_date + time '12:00') at time zone 'Asia/Ho_Chi_Minh',
      amount = v_amt, party_name = v_name, note = coalesce(p->>'note','') where id = v_old.cash_txn_id;
    perform public.audit('update_expense','expenses', v_id, jsonb_build_object('old', to_jsonb(v_old), 'new', p));
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Xóa khoản chi (ghi lại nội dung cũ vào nhật ký) và xóa dòng tương ứng trong sổ quỹ.
create or replace function public.delete_expense(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old record;
begin
  perform public.require_role('owner','manager');
  select * into v_old from public.expenses where id = p_id for update;
  if v_old.id is null then raise exception 'Không tìm thấy khoản chi'; end if;
  delete from public.expenses where id = p_id;
  delete from public.cash_transactions where id = v_old.cash_txn_id;
  perform public.audit('delete_expense','expenses', p_id, to_jsonb(v_old));
end $$;

-- Doanh thu & lợi nhuận theo từng ngày. Lợi nhuận = doanh thu − tiền vốn hàng đã bán (FIFO).
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
    select sii.invoice_id, sum(sil.base_qty * sil.unit_cost) as v
    from public.sales_item_lots sil join public.sales_invoice_items sii on sii.id = sil.item_id
    where sii.invoice_id in (select id from inv) group by sii.invoice_id
  )
  select g::date, count(inv.id), coalesce(sum(inv.total_amount),0), round(coalesce(sum(c.v),0)),
         coalesce(sum(inv.total_amount),0) - round(coalesce(sum(c.v),0))
  from generate_series(p_from, p_to, interval '1 day') g
  left join inv on inv.d = g::date left join c on c.invoice_id = inv.id
  group by g order by g;
end $$;
revoke execute on function public.save_expense(jsonb), public.delete_expense(uuid), public.daily_report(date,date) from anon, public;
grant execute on function public.save_expense(jsonb), public.delete_expense(uuid), public.daily_report(date,date) to authenticated;
