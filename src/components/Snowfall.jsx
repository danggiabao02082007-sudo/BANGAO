// Tuyết rơi khắp màn hình (giao diện Giáng sinh). Nằm sau các thẻ, không nhận chạm/bấm.
// Mỗi bông tuyết là 1 phần tử chỉ chuyển động bằng CSS transform → nhẹ cho máy.
import { memo } from 'react';

const FLAKES = Array.from({ length: 46 }, (_, i) => ({
  left: (i * 37 + (i % 5) * 11) % 100,          // vị trí ngang (%)
  size: 4 + ((i * 7) % 9),                        // 4–12px
  dur: 9 + ((i * 13) % 12),                       // 9–20 giây
  delay: -((i * 29) % 20),                        // lệch nhịp để tuyết rơi đều ngay khi mở
  drift: ((i % 2) ? 1 : -1) * (12 + (i * 17) % 40), // độ lượn ngang (px)
  op: 0.55 + ((i * 3) % 5) / 10
}));

export default memo(function Snowfall({ className = '' }) {
  return (
    <div className={'snowfall pointer-events-none overflow-hidden ' + className} aria-hidden="true">
      {FLAKES.map((f, i) => (
        <span key={i} className="flake" style={{
          left: f.left + '%', width: f.size, height: f.size, opacity: f.op,
          animationDuration: f.dur + 's', animationDelay: f.delay + 's', '--drift': f.drift + 'px'
        }} />
      ))}
    </div>
  );
});
