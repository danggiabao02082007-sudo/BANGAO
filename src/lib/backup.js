import { rpc } from './supabase.js';

const pad = n => String(n).padStart(2, '0');
/** Gọi máy chủ lấy toàn bộ dữ liệu rồi lưu thành file JSON trên máy */
export async function downloadBackup() {
  const data = await rpc('export_backup', {});
  const d = new Date();
  const name = `bonbien-saoluu-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  // Điện thoại: mở bảng Chia sẻ để lưu vào Tệp / Google Drive / Zalo…; máy tính: tải file xuống
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: name }); return { name, counts: data.meta.row_counts, size: blob.size }; }
    catch (e) { if (e.name === 'AbortError') throw new Error('Đã hủy lưu file sao lưu'); }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { name, counts: data.meta.row_counts, size: blob.size };
}
