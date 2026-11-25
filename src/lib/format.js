const nf = new Intl.NumberFormat('vi-VN');
/** 12.500.000đ */
export const money = v => nf.format(Math.round(Number(v) || 0)) + 'đ';
export const num = (v, d = 2) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(Number(v) || 0);
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
