-- TIỀN NHẬN ĐƯỢC THEO NGÀY, TÁCH TIỀN MẶT / CHUYỂN KHOẢN (chỉ chủ & quản lý).
-- = thu bán hàng + thu nợ khách − hoàn tiền hủy hóa đơn, theo quỹ (cash / bank) và ngày ghi sổ quỹ.
-- Không gồm "thu khác" (other_in) — trả riêng ở cột other_in để app hiện kèm.
-- Chỉ THÊM hàm; không đụng dữ liệu.
create or replace function public.cash_received_report(p_from date, p_to date)
returns table(day date, cash_sale numeric, cash_debt numeric, cash_refund numeric, cash_total numeric,
              bank_sale numeric, bank_debt numeric, bank_refund numeric, bank_total numeric, other_in numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('owner','manager');
  if p_to < p_from then raise exception 'Ngày kết thúc phải sau ngày bắt đầu'; end if;
  if p_to - p_from > 366 then raise exception 'Chỉ xem tối đa 1 năm mỗi lần'; end if;
  return query
  with days as (select g::date d from generate_series(p_from, p_to, interval '1 day') g),
  t as (
    select (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date d, a.code acc, c.category, c.direction, c.amount
    from public.cash_transactions c join public.cash_accounts a on a.id = c.account_id
    where (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
  ),
  g as (
    select t.d,
      sum(case when acc = 'cash' and category = 'sale' and direction = 'in' then amount else 0 end) cs,
      sum(case when acc = 'cash' and category = 'debt_collection' and direction = 'in' then amount else 0 end) cd,
      sum(case when acc = 'cash' and category = 'sale_cancel' and direction = 'out' then amount else 0 end) cr,
      sum(case when acc = 'bank' and category = 'sale' and direction = 'in' then amount else 0 end) bs,
      sum(case when acc = 'bank' and category = 'debt_collection' and direction = 'in' then amount else 0 end) bd,
      sum(case when acc = 'bank' and category = 'sale_cancel' and direction = 'out' then amount else 0 end) br,
      sum(case when category = 'other_in' and direction = 'in' then amount else 0 end) oi
    from t group by t.d
  )
  select days.d, coalesce(g.cs,0), coalesce(g.cd,0), coalesce(g.cr,0), coalesce(g.cs,0) + coalesce(g.cd,0) - coalesce(g.cr,0),
         coalesce(g.bs,0), coalesce(g.bd,0), coalesce(g.br,0), coalesce(g.bs,0) + coalesce(g.bd,0) - coalesce(g.br,0), coalesce(g.oi,0)
  from days left join g on g.d = days.d order by days.d;
end $$;
revoke execute on function public.cash_received_report(date,date) from anon, public;
grant execute on function public.cash_received_report(date,date) to authenticated;
