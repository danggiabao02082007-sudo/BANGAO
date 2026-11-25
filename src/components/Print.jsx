import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { money, num, datetime } from '../lib/format.js';

/** In hóa đơn khổ K80 (giấy nhiệt 80mm) hoặc A5 */
export default function PrintInvoice({ inv, items, store, size, onDone }) {
  useEffect(() => {
    const t = setTimeout(() => { window.print(); onDone(); }, 300);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line
  const k80 = size === 'k80';
  const css = `@page { size: ${k80 ? '80mm auto' : 'A5'}; margin: ${k80 ? '3mm' : '10mm'}; }
    #print-root { font-family: Arial, sans-serif; color: #000; width: ${k80 ? '72mm' : '100%'}; font-size: ${k80 ? '11px' : '12px'}; }
    #print-root table { width: 100%; border-collapse: collapse; } #print-root td, #print-root th { padding: 2px 0; vertical-align: top; }
    #print-root .r { text-align: right; } #print-root .c { text-align: center; } #print-root hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }`;
  return createPortal(
    <div>
      <style>{css}</style>
      <div className="c"><b style={{ fontSize: k80 ? 14 : 18 }}>{store.store_name}</b><br />{store.address}<br />{store.phone && 'ĐT: ' + store.phone}</div>
      <hr />
      <div className="c"><b style={{ fontSize: k80 ? 13 : 16 }}>HÓA ĐƠN BÁN HÀNG</b><br />Số: {inv.invoice_code} · {datetime(inv.invoice_date)}</div>
      <div>Khách hàng: {inv.customer_name}</div>
      {inv.status === 'cancelled' && <div className="c"><b>*** ĐÃ HỦY ***</b></div>}
      <hr />
      <table>
        <thead><tr><th style={{ textAlign: 'left' }}>Hàng</th><th className="r">SL</th><th className="r">Đ.giá</th><th className="r">T.tiền</th></tr></thead>
        <tbody>{items.map(it => (
          <tr key={it.id}><td>{it.product_name}{it.discount > 0 && <><br /><i>Giảm {money(it.discount)}</i></>}</td>
            <td className="r">{num(it.quantity, 3)} {it.unit_name}</td><td className="r">{num(it.unit_price, 0)}</td><td className="r">{num(it.line_total, 0)}</td></tr>))}</tbody>
      </table>
      <hr />
      <table><tbody>
        <tr><td>Tạm tính</td><td className="r">{money(inv.subtotal)}</td></tr>
        {inv.discount > 0 && <tr><td>Giảm giá</td><td className="r">−{money(inv.discount)}</td></tr>}
        <tr><td><b>TỔNG THANH TOÁN</b></td><td className="r"><b>{money(inv.total_amount)}</b></td></tr>
        <tr><td>Đã trả</td><td className="r">{money(inv.paid_amount)}</td></tr>
        {inv.cash_given > 0 && <tr><td>Khách đưa / Tiền thừa</td><td className="r">{money(inv.cash_given)} / {money(Math.max(0, inv.cash_given - inv.paid_amount))}</td></tr>}
        {inv.debt_amount > 0 && <tr><td><b>Còn nợ</b></td><td className="r"><b>{money(inv.debt_amount)}</b></td></tr>}
      </tbody></table>
      <hr />
      <div className="c">{store.invoice_footer}</div>
    </div>,
    document.getElementById('print-root')
  );
}
