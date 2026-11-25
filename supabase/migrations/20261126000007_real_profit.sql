-- =====================================================================
-- LỢI NHUẬN THỰC = DOANH THU − VỐN − CHI TIÊU (theo ngày)
-- Chỉ THÊM hàm mới; không sửa hàm cũ, không đụng dữ liệu.
-- Chi tiêu = các khoản chi vận hành trong sổ quỹ (mục Chi tiêu + khoản chi ghi tay kiểu cũ):
--   transport, labor, utility, other_out. Không gồm chi nhập hàng (đã nằm trong vốn) và hoàn tiền hủy HĐ.
-- =====================================================================
create or replace function public.real_profit_report(p_from date, p_to date)
returns table(day date, invoices bigint, revenue numeric, cost numeric, expenses numeric, gross_profit numeric, real_profit numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('owner','manager');
  if p_to < p_from then raise exception 'Ngày kết thúc phải sau ngày bắt đầu'; end if;
  if p_to - p_from > 366 then raise exception 'Chỉ xem tối đa 1 năm mỗi lần'; end if;
  return query
  with days as (select g::date d from generate_series(p_from, p_to, interval '1 day') g),
  inv as (
    select i.id, i.total_amount, (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date as d
    from public.sales_invoices i
    where i.status = 'completed' and (i.invoice_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
  ),
  rev as (select inv.d, count(*) n, sum(inv.total_amount) v from inv group by inv.d),
  cst as (select inv.d, sum(sic.cost) v from public.sales_item_costs sic
          join public.sales_invoice_items sii on sii.id = sic.item_id join inv on inv.id = sii.invoice_id group by inv.d),
  exp as (select (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date d, sum(c.amount) v from public.cash_transactions c
          where c.direction = 'out' and c.category in ('transport','labor','utility','other_out')
            and (c.txn_date at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to group by 1)
  select days.d, coalesce(rev.n,0), coalesce(rev.v,0), coalesce(cst.v,0), coalesce(exp.v,0),
         coalesce(rev.v,0) - coalesce(cst.v,0),
         coalesce(rev.v,0) - coalesce(cst.v,0) - coalesce(exp.v,0)
  from days left join rev on rev.d = days.d left join cst on cst.d = days.d left join exp on exp.d = days.d
  order by days.d;
end $$;
revoke execute on function public.real_profit_report(date,date) from anon, public;
grant execute on function public.real_profit_report(date,date) to authenticated;
