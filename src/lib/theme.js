// Chủ đề giao diện, lưu riêng trên từng máy.
//  auto  : tự bật Giáng sinh từ 20/11 đến 06/01, còn lại là giao diện thường (cánh đồng lúa)
//  xmas  : luôn Giáng sinh   ·   normal: luôn giao diện thường
const KEY = 'bonbien.theme';
export const THEMES = [
  ['auto', '🗓️ Tự động', 'Tự bật Giáng sinh từ 20/11 đến 06/01'],
  ['xmas', '🎄 Giáng sinh', 'Cây thông, quà, tuần lộc kéo xe, tuyết phủ các thẻ'],
  ['normal', '🌾 Cánh đồng lúa', 'Giao diện thường']
];
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = v => { try { localStorage.setItem(KEY, v); } catch { /* bỏ qua */ } };

export const getTheme = () => { const t = read(); return THEMES.some(x => x[0] === t) ? t : 'auto'; };
/** Mùa Giáng sinh: 20/11 → 06/01 */
export const isXmasSeason = (d = new Date()) => { const m = d.getMonth() + 1, day = d.getDate(); return (m === 11 && day >= 20) || m === 12 || (m === 1 && day <= 6); };
export const effectiveTheme = (t = getTheme()) => t === 'auto' ? (isXmasSeason() ? 'xmas' : 'normal') : t;

export function applyTheme(t = getTheme()) {
  const eff = effectiveTheme(t);
  document.documentElement.classList.toggle('theme-xmas', eff === 'xmas');
  window.dispatchEvent(new CustomEvent('themechange', { detail: eff }));
  return eff;
}
export const setTheme = t => { write(t); return applyTheme(t); };

/** Số ngày còn lại tới Giáng sinh (0 = hôm nay) */
export function daysToXmas(d = new Date()) {
  const y = d.getMonth() === 11 && d.getDate() > 25 ? d.getFullYear() + 1 : d.getFullYear();
  const x = new Date(y, 11, 25), t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((x - t) / 864e5);
}
