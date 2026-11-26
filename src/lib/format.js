/** Nhóm 3 chữ số bằng dấu chấm: 1000000 -> 1.000.000 (không phụ thuộc ngôn ngữ trình duyệt) */
export const group = s => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** 12.500.000đ */
export const money = v => { const n = Math.round(Number(v) || 0); return (n < 0 ? '-' : '') + group(Math.abs(n)) + 'đ'; };
/** Số thập phân kiểu Việt Nam: 1.234,5 */
export const num = (v, d = 2) => {
  const n = Number(v) || 0, f = Math.abs(n).toFixed(d).replace(/\.?0+$/, '');
  const [i, dec] = f.split('.');
  return (n < 0 ? '-' : '') + group(i) + (dec ? ',' + dec : '');
};
const pad = n => String(n).padStart(2, '0');
const vn = d => new Date(new Date(d).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
/** dd/mm/yyyy */
export const date = d => { if (!d) return ''; const x = vn(d); return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`; };
export const datetime = d => { if (!d) return ''; const x = vn(d); return `${date(d)} ${pad(x.getHours())}:${pad(x.getMinutes())}`; };
export const isoDay = (d = new Date()) => { const x = vn(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
/** Hiển thị số bao kèm quy đổi kg */
export const baoKg = (bao, kgPerBao) => `${num(bao, 3)} bao · ${num(bao * kgPerBao, 1)} kg`;
export const digits = s => String(s ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
export const ROLE = { owner: 'Chủ cửa hàng', manager: 'Quản lý', staff: 'Nhân viên' };

// ---------- Đơn vị tồn kho của mặt hàng: Bao (như cũ), Kg, hoặc Hủ/Bịch/Máng/Miếng/Cái ----------
export const suCode = p => p?.stock_unit_code || 'bao';
/** tên đơn vị tồn kho viết thường: "bao", "kg", "hủ"… */
export const su = p => (p?.stock_unit_name || 'Bao').toLowerCase();
/** số lượng theo đơn vị tồn kho, vd "2,8 bao", "48 kg", "9 hủ" */
export const qtyU = (p, qty, d = 3) => `${num(qty, d)} ${su(p)}`;
/** tồn kho kèm quy ra kg với hàng tính theo bao */
export const stockText = (p, qty = p?.stock_bao, d = 3) => suCode(p) === 'bao' ? `${qtyU(p, qty, d)} · ${num(Number(qty) * Number(p.kg_per_bao), 1)} kg` : qtyU(p, qty, d);
/** tên nút bán: nhãn riêng (vd "bể 4 bao") hoặc tên đơn vị */
export const unitLabel = u => u?.label || u?.unit_name || '';
/** giá 1 kg khi bán nguyên bao */
export const baoPerKg = (p, u) => u?.unit_code === 'bao' && Number(p?.kg_per_bao) > 0 ? Number(u.retail_price) / Number(p.kg_per_bao) : null;
/** giá nhập (lưu theo đơn vị tồn kho) hiển thị dễ hiểu */
export const costText = (p, cost) => suCode(p) === 'bao'
  ? `${money(Number(cost || 0) / Number(p.kg_per_bao))}/kg (= ${money(cost)}/bao)` : `${money(cost)}/${su(p)}`;
