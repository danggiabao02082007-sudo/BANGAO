// Giao diện mùa lễ, lưu riêng trên từng máy (localStorage).
//  xmas: Giáng sinh — cây thông, quà, tuần lộc kéo xe, tuyết rơi, tuyết phủ trên thẻ
//  normal: cánh đồng lúa mặc định
const KEY = 'bonbien.theme';
export const THEMES = [
  ['xmas', '🎄 Giáng sinh', 'Cây thông Noel, hộp quà, tuần lộc kéo xe, tuyết rơi và tuyết phủ trên các thẻ'],
  ['normal', '🌾 Cánh đồng lúa', 'Giao diện mặc định quanh năm']
];
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export const getTheme = () => { const t = read(); return THEMES.some(x => x[0] === t) ? t : 'xmas'; };

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* chế độ riêng tư: bỏ qua */ }
  applyTheme(theme);
}
export function applyTheme(theme = getTheme()) {
  document.documentElement.classList.toggle('xmas', theme === 'xmas');
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}
