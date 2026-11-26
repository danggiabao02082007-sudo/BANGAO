// Tranh nền Giáng sinh, vẽ bằng SVG (thay cho tranh cánh đồng lúa vào mùa Noel).
// Hiệu năng: phần tĩnh nằm trong 1 SVG; mỗi thứ chuyển động (xe tuần lộc, đèn nhấp nháy) là 1 lớp riêng
// và chỉ được dịch chuyển / đổi độ mờ nguyên lớp bằng CSS → trình duyệt dùng GPU, không phải vẽ lại cả bức tranh.
// Mọi id trong <defs> có tiền tố "x-" để không trùng với RiceScene.
import { memo } from 'react';

const VB = '0 0 1060 480';
const Layer = ({ className = '', children, style }) => (
  <svg className={'absolute inset-0 w-full h-full ' + className} viewBox={VB} preserveAspectRatio="xMidYMax slice" aria-hidden="true" style={style}>{children}</svg>
);

// ---------- Hàm vẽ phụ ----------
const f = n => +n.toFixed(1);

// Ngôi sao 5 cánh
const starPath = (cx, cy, R, r) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
    return (i ? 'L' : 'M') + f(cx + Math.cos(a) * rr) + ' ' + f(cy + Math.sin(a) * rr);
  }).join(' ') + 'Z';

// Ngôi sao lấp lánh 4 cánh
const sparkle = (x, y, s) =>
  `M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z`;

// Một tầng lá thông: cạnh hơi lõm, đáy gợn sóng. Trả về cả hình tầng (d) và đường đáy (edge) để phủ tuyết.
function tier(cx, apex, bottom, hw, n = 5) {
  const seg = (2 * hw) / n, depth = (bottom - apex) * 0.6;
  let d = `M${cx} ${apex} Q${f(cx + hw * 0.35)} ${f(apex + depth)} ${cx + hw} ${bottom}`;
  let edge = `M${cx + hw} ${bottom}`;
  for (let i = 0; i < n; i++) {
    const x = cx + hw - seg * (i + 1), q = ` Q${f(x + seg / 2)} ${bottom + 10} ${f(x)} ${bottom}`;
    d += q; edge += q;
  }
  d += ` Q${f(cx - hw * 0.35)} ${f(apex + depth)} ${cx} ${apex}Z`;
  return { d, edge };
}

// Điểm trên đường cong bậc 2 (dùng để rải đèn theo dây kim tuyến)
const qpt = ([x0, y0, cx, cy, x1, y1], t) => [
  (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1,
  (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1,
];

// ---------- Cây thông lớn ----------
const TREE_X = 800;
const TIERS = [
  tier(TREE_X, 285, 400, 125, 6),
  tier(TREE_X, 240, 340, 100, 5),
  tier(TREE_X, 200, 285, 75, 5),
  tier(TREE_X, 170, 235, 48, 4),
];
const GARLANDS = [
  [776, 203, 800, 222, 826, 210],
  [758, 246, 800, 272, 846, 252],
  [744, 298, 800, 330, 858, 304],
  [726, 352, 800, 390, 876, 358],
];
const ORNAMENTS = [
  [796, 193, 'r'], [813, 226, 'g'], [785, 228, 'b'],
  [818, 244, 'b'], [776, 262, 'g'], [828, 268, 'r'], [800, 279, 'b'],
  [772, 292, 'r'], [832, 291, 'g'], [722, 333, 'g'], [878, 331, 'r'], [800, 335, 'r'], [758, 320, 'b'], [842, 322, 'b'],
  [770, 362, 'b'], [833, 372, 'r'], [745, 391, 'r'], [851, 393, 'b'], [800, 398, 'g'], [705, 390, 'b'], [895, 391, 'g'],
];
const ORN_COLOR = { r: ['#E53935', '#B71C1C'], g: ['#FBBF24', '#B45309'], b: ['#3B82F6', '#1E3A8A'] };

const Ornament = ({ x, y, c }) => (
  <g>
    <rect x={x - 2} y={y - 9} width="4" height="3" rx="1" fill="#D4AF37" />
    <circle cx={x} cy={y} r="6.5" fill={`url(#x-orn-${c})`} />
    <circle cx={x - 2.2} cy={y - 2.4} r="1.8" fill="#fff" opacity=".7" />
  </g>
);

// ---------- Hộp quà ----------
function Gift({ x, bottom, w, h, box, dark, ribbon }) {
  const y = bottom - h, cx = x + w / 2;
  return (
    <g>
      <rect x={x} y={y + 6} width={w} height={h - 6} rx="2" fill={box} />
      <rect x={x + w * 0.62} y={y + 6} width={w * 0.38} height={h - 6} fill={dark} opacity=".35" />
      <rect x={x - 3} y={y} width={w + 6} height="9" rx="2" fill={box} />
      <rect x={x - 3} y={y + 7} width={w + 6} height="2.5" fill={dark} opacity=".4" />
      <rect x={cx - 3.5} y={y} width="7" height={h} fill={ribbon} />
      <rect x={x - 3} y={y + 1.5} width={w + 6} height="5" fill={ribbon} opacity=".9" />
      {/* Nơ */}
      <path d={`M${cx} ${y} C${cx - 16} ${y - 14} ${cx - 18} ${y + 2} ${cx} ${y}Z`} fill={ribbon} stroke={dark} strokeWidth=".6" strokeOpacity=".4" />
      <path d={`M${cx} ${y} C${cx + 16} ${y - 14} ${cx + 18} ${y + 2} ${cx} ${y}Z`} fill={ribbon} stroke={dark} strokeWidth=".6" strokeOpacity=".4" />
      <path d={`M${cx - 1} ${y + 1} L${cx - 7} ${y + 11} M${cx + 1} ${y + 1} L${cx + 7} ${y + 11}`} stroke={ribbon} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={y} r="3" fill={ribbon} stroke={dark} strokeWidth=".6" strokeOpacity=".5" />
    </g>
  );
}
const GIFTS = [
  { x: 688, bottom: 446, w: 44, h: 36, box: '#DC2626', dark: '#7F1D1D', ribbon: '#FCD34D' },
  { x: 738, bottom: 448, w: 34, h: 52, box: '#16A34A', dark: '#14532D', ribbon: '#EF4444' },
  { x: 780, bottom: 450, w: 52, h: 30, box: '#2563EB', dark: '#1E3A8A', ribbon: '#F1F5F9' },
  { x: 838, bottom: 446, w: 40, h: 42, box: '#F59E0B', dark: '#92400E', ribbon: '#DC2626' },
  { x: 884, bottom: 448, w: 46, h: 28, box: '#9333EA', dark: '#4C1D95', ribbon: '#FDE047' },
  { x: 793, bottom: 420, w: 26, h: 22, box: '#EC4899', dark: '#831843', ribbon: '#FFFFFF' },
];

// ---------- Bao gạo thắt nơ đỏ ----------
const RiceSack = ({ x, bottom }) => (
  <g transform={`translate(${x} ${bottom})`}>
    <ellipse cx="34" cy="0" rx="40" ry="6" fill="#B8CBE6" opacity=".6" />
    <path d="M6 0 Q-2 -34 10 -58 Q22 -66 34 -62 Q46 -66 58 -58 Q70 -34 62 0 Q34 6 6 0Z" fill="url(#x-sack)" stroke="#D6CBB0" strokeWidth="1.2" />
    {/* Miệng bao túm lại */}
    <path d="M18 -60 Q16 -76 24 -82 Q30 -74 34 -80 Q38 -74 44 -82 Q52 -76 50 -60Z" fill="#FBF7EC" stroke="#D6CBB0" strokeWidth="1.2" />
    <g fill="#FFFDF5" stroke="#E8D8A8" strokeWidth=".6">
      <ellipse cx="28" cy="-80" rx="2" ry="3.4" transform="rotate(-20 28 -80)" />
      <ellipse cx="40" cy="-81" rx="2" ry="3.4" transform="rotate(25 40 -81)" />
    </g>
    {/* Dây và nơ đỏ */}
    <path d="M16 -60 Q34 -54 52 -60" stroke="#DC2626" strokeWidth="4.5" fill="none" strokeLinecap="round" />
    <path d="M34 -58 C20 -72 14 -54 34 -58Z M34 -58 C48 -72 54 -54 34 -58Z" fill="#EF4444" stroke="#991B1B" strokeWidth=".8" />
    <path d="M33 -57 L26 -44 M35 -57 L42 -44" stroke="#DC2626" strokeWidth="3" strokeLinecap="round" />
    <circle cx="34" cy="-58" r="3.2" fill="#B91C1C" />
    {/* Đường may + chữ */}
    <path d="M10 -14 Q34 -10 58 -14" stroke="#D6CBB0" strokeWidth="1" strokeDasharray="3 3" fill="none" />
    <text x="34" y="-24" textAnchor="middle" fontFamily="system-ui, 'Segoe UI', Arial, sans-serif" fontWeight="800" fontSize="15" fill="#C62828" letterSpacing="1">GẠO</text>
    <path d="M22 -40 l3 -5 l3 5 l-3 5z M40 -40 l3 -5 l3 5 l-3 5z" fill="#F59E0B" opacity=".8" />
  </g>
);

// ---------- Cây thông nhỏ phía xa ----------
const SMALL_TIERS = [tier(0, -34, -4, 26, 4), tier(0, -48, -22, 20, 3), tier(0, -60, -38, 14, 3)];
const SmallPine = ({ x, y, s = 1, fill = '#2F6B5A' }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x="-3" y="-6" width="6" height="8" fill="#5D4037" />
    {SMALL_TIERS.map((t, i) => (
      <g key={i}>
        <path d={t.d} fill={fill} />
        <path d={t.edge} stroke="#F8FAFF" strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>
    ))}
    <path d="M0 -62 l-5 9 q5 -3 10 0z" fill="#F8FAFF" />
  </g>
);

// ---------- Tuần lộc (hướng mặt sang phải, tư thế phi trên không) ----------
const Reindeer = ({ x, y, lead }) => (
  <g transform={`translate(${x} ${y})`}>
    {/* Chân sau (xa) & chân trước (xa) */}
    <path d="M-12 4 L-22 10 L-28 9 M14 4 L22 12 L28 10" stroke="#6D3F1B" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    {/* Đuôi */}
    <ellipse cx="-19" cy="-4" rx="4" ry="2.6" fill="#F5F0E6" transform="rotate(-25 -19 -4)" />
    {/* Thân */}
    <ellipse cx="0" cy="0" rx="19" ry="8.5" fill="#8D5524" />
    <ellipse cx="2" cy="4" rx="13" ry="4" fill="#C08A55" />
    {/* Chân gần */}
    <path d="M-10 5 L-20 13 L-27 13 M11 5 L18 15 L25 14" stroke="#7B4A22" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M-27 13 l-2 1 M25 14 l2 .5" stroke="#2D1B0E" strokeWidth="3" strokeLinecap="round" />
    {/* Cổ + đầu */}
    <path d="M10 -4 Q16 -12 20 -18 L27 -14 Q21 -6 16 2Z" fill="#8D5524" />
    <ellipse cx="26" cy="-18" rx="8" ry="5.5" fill="#8D5524" transform="rotate(12 26 -18)" />
    <ellipse cx="32" cy="-15.5" rx="4.5" ry="3.4" fill="#A86B36" />
    <path d="M21 -22 l-6 -3 l3 5z" fill="#6D3F1B" />
    <circle cx="26" cy="-20" r="1.2" fill="#1F130A" />
    {/* Gạc */}
    <path d="M23 -23 Q20 -32 24 -40 M22 -30 L16 -35 M23 -35 L28 -40 M27 -22 Q29 -31 35 -36 M29 -29 L35 -28 M32 -33 L33 -40"
      stroke="#E0C49A" strokeWidth="2" fill="none" strokeLinecap="round" />
    {/* Mũi */}
    {lead ? (
      <>
        <circle cx="36.5" cy="-15.5" r="6" fill="#FF5252" opacity=".35" />
        <circle cx="36.5" cy="-15.5" r="3" fill="#EF4444" />
        <circle cx="35.6" cy="-16.5" r=".9" fill="#fff" opacity=".8" />
      </>
    ) : <circle cx="36" cy="-15.5" r="2" fill="#2D1B0E" />}
    {/* Dây cương + chuông */}
    <path d="M8 -7 Q11 0 8 8" stroke="#B91C1C" strokeWidth="3" fill="none" />
    <circle cx="9.5" cy="9" r="2.2" fill="#FBBF24" stroke="#B45309" strokeWidth=".6" />
  </g>
);

// ---------- Xe trượt tuyết chở quà ----------
const Sleigh = () => (
  <g transform="translate(18 78)">
    {/* Bao quà */}
    <rect x="10" y="-14" width="14" height="14" rx="1.5" fill="#16A34A" />
    <rect x="15.5" y="-14" width="3" height="14" fill="#FDE047" />
    <rect x="40" y="-18" width="16" height="18" rx="1.5" fill="#2563EB" />
    <rect x="46.5" y="-18" width="3" height="18" fill="#F8FAFC" />
    <path d="M18 8 Q14 -18 34 -24 Q54 -18 50 8Z" fill="#9A6234" />
    <path d="M26 -21 Q34 -30 42 -21" stroke="#7A4A22" strokeWidth="2.5" fill="none" />
    <path d="M34 -22 c-6 -8 -10 -1 0 0z M34 -22 c6 -8 10 -1 0 0z" fill="#EF4444" />
    {/* Thân xe */}
    <path d="M-6 -2 Q-12 -12 -4 -16 Q2 -18 2 -10 L4 4 L66 4 Q78 4 76 16 L72 28 Q70 34 62 34 L10 34 Q0 34 -2 24Z" fill="#C62828" />
    <path d="M-6 -2 Q-12 -12 -4 -16 Q2 -18 2 -10 L4 4 L66 4 Q78 4 76 16 L72 28 Q70 34 62 34 L10 34 Q0 34 -2 24Z" fill="none" stroke="#FBBF24" strokeWidth="2" />
    <path d="M8 14 L66 14" stroke="#FBBF24" strokeWidth="1.5" opacity=".8" />
    <path d="M30 22 q4 -6 8 0 q-4 6 -8 0z" fill="#FBBF24" />
    {/* Càng trượt */}
    <path d="M12 34 L14 44 M58 34 L56 44" stroke="#D4A017" strokeWidth="2.5" />
    <path d="M-4 44 L76 44 Q92 44 90 30 Q89 25 84 26" stroke="#F5C542" strokeWidth="3" fill="none" strokeLinecap="round" />
  </g>
);

// ---------- Dữ liệu sao ----------
const SKY_STARS = Array.from({ length: 70 }, (_, i) => {
  const x = (i * 151 + 37) % 1060, y = 8 + ((i * 89) % 210);
  return [x, y, 0.6 + ((i * 7) % 10) / 10];
}).filter(([x, y]) => Math.hypot(x - 150, y - 80) > 60);
const TWINKLE_STARS = [[60, 40], [250, 30], [330, 110], [420, 55], [520, 140], [610, 35], [700, 95], [880, 45], [960, 120], [1020, 30], [470, 190], [990, 200], [380, 170], [640, 180]];
const LIGHT_COLORS = ['#FFE066', '#FF6B6B', '#7DD3FC', '#86EFAC', '#F9A8D4'];
const LIGHTS = GARLANDS.flatMap((g, gi) =>
  Array.from({ length: 7 }, (_, i) => {
    const [x, y] = qpt(g, (i + 0.5) / 7);
    return { x: f(x), y: f(y + 2), c: LIGHT_COLORS[(gi * 2 + i) % LIGHT_COLORS.length], set: (gi + i) % 2 };
  }));

const Bulb = ({ x, y, c }) => (
  <g>
    <circle cx={x} cy={y} r="5.5" fill={c} opacity=".35" />
    <circle cx={x} cy={y} r="2.6" fill={c} />
    <circle cx={x - .8} cy={y - .8} r=".9" fill="#fff" opacity=".85" />
  </g>
);

function TwinkleLayer({ set }) {
  return (
    <>
      {LIGHTS.filter(l => l.set === set).map((l, i) => <Bulb key={i} {...l} />)}
      <g>
        {TWINKLE_STARS.filter((_, i) => i % 2 === set).map(([x, y], i) =>
          <path key={i} d={sparkle(x, y, 4 + (i % 3))} fill={i % 2 ? '#FFFFFF' : '#FCD34D'} stroke={i % 2 ? '#FDE68A' : '#F59E0B'} strokeWidth=".6" />)}
      </g>
      {set === 1 && <circle cx={TREE_X} cy="160" r="22" fill="url(#x-starglow)" />}
    </>
  );
}

export default memo(function ChristmasScene({ className = '' }) {
  return (
    <div className={'overflow-hidden ' + className} aria-hidden="true">
      {/* 1. Phần tĩnh */}
      <Layer>
        <defs>
          <linearGradient id="x-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#C7D2FE" /><stop offset=".45" stopColor="#E0E7FF" /><stop offset="1" stopColor="#FCE7F3" />
          </linearGradient>
          <radialGradient id="x-moonglow"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".85" /><stop offset=".45" stopColor="#FFF4D6" stopOpacity=".35" /><stop offset="1" stopColor="#FFF4D6" stopOpacity="0" /></radialGradient>
          <radialGradient id="x-moon" cx=".4" cy=".38"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".6" stopColor="#FFF8E1" /><stop offset="1" stopColor="#FDE7B8" /></radialGradient>
          <linearGradient id="x-hill1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#CFC6EA" /><stop offset="1" stopColor="#A9A3D6" /></linearGradient>
          <linearGradient id="x-hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E6E9F8" /><stop offset="1" stopColor="#C3CCEB" /></linearGradient>
          <linearGradient id="x-snow-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F5F8FF" /><stop offset="1" stopColor="#D6E1F3" /></linearGradient>
          <linearGradient id="x-snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".6" stopColor="#EEF4FC" /><stop offset="1" stopColor="#DCE7F6" /></linearGradient>
          <linearGradient id="x-pine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#2E8B57" /><stop offset=".55" stopColor="#1F6E43" /><stop offset="1" stopColor="#134E2F" /></linearGradient>
          <radialGradient id="x-win"><stop offset="0" stopColor="#FFD166" stopOpacity=".7" /><stop offset="1" stopColor="#FFD166" stopOpacity="0" /></radialGradient>
          <radialGradient id="x-starglow"><stop offset="0" stopColor="#FFF3B0" stopOpacity=".9" /><stop offset="1" stopColor="#FFE066" stopOpacity="0" /></radialGradient>
          <linearGradient id="x-star" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFF59D" /><stop offset="1" stopColor="#F59E0B" /></linearGradient>
          <linearGradient id="x-sack" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".7" stopColor="#F7F2E4" /><stop offset="1" stopColor="#E7DDC4" /></linearGradient>
          {Object.entries(ORN_COLOR).map(([k, [c1, c2]]) => (
            <radialGradient key={k} id={`x-orn-${k}`} cx=".35" cy=".35"><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset=".25" stopColor={c1} /><stop offset="1" stopColor={c2} /></radialGradient>
          ))}
        </defs>

        {/* Bầu trời, trăng, sao */}
        <rect width="1060" height="480" fill="url(#x-sky)" />
        <circle cx="150" cy="80" r="120" fill="url(#x-moonglow)" />
        <circle cx="150" cy="80" r="34" fill="url(#x-moon)" />
        <g fill="#fff">{SKY_STARS.map(([x, y, o], i) => <circle key={i} cx={x} cy={y} r={i % 5 ? 1.2 : 1.8} opacity={o * 0.9} />)}</g>

        {/* Đồi tuyết phía xa */}
        <path d="M0 268 C110 232 210 250 320 240 S520 210 640 238 S860 222 1060 252 V480 H0Z" fill="url(#x-hill1)" />
        <path d="M0 268 C110 232 210 250 320 240 S520 210 640 238 S860 222 1060 252" stroke="#F1EDFF" strokeWidth="2" fill="none" opacity=".7" />
        <g>
          {[[60, 268, .55], [92, 262, .7], [120, 266, .5], [560, 238, .55], [590, 232, .65], [940, 246, .6], [975, 250, .5], [1010, 252, .62]].map(([x, y, s], i) =>
            <SmallPine key={i} x={x} y={y} s={s} fill="#4A6E8A" />)}
        </g>
        <path d="M0 300 C160 272 300 296 460 284 S760 262 1060 292 V480 H0Z" fill="url(#x-hill2)" />
        <path d="M0 300 C160 272 300 296 460 284 S760 262 1060 292" stroke="#fff" strokeWidth="2.5" fill="none" opacity=".8" />
        <g>
          {[[30, 302, .8], [180, 290, .9], [215, 296, .7], [440, 290, .85], [478, 290, .7], [640, 280, .8], [1000, 296, .9], [1040, 300, .7]].map(([x, y, s], i) =>
            <SmallPine key={i} x={x} y={y} s={s} fill="#2F6B5A" />)}
        </g>

        {/* Lớp tuyết giữa */}
        <path d="M0 340 C180 320 340 350 520 336 S860 320 1060 342 V480 H0Z" fill="url(#x-snow-mid)" />

        {/* Ngôi nhà nhỏ */}
        <ellipse cx="312" cy="356" rx="80" ry="10" fill="url(#x-win)" />
        <rect x="338" y="246" width="15" height="34" fill="#7C3A2A" />
        <path d="M335 246 h21 v-4 q-10 -6 -21 0z" fill="#fff" />
        <g fill="#E5E7EB" opacity=".55">
          <circle cx="348" cy="232" r="6" /><circle cx="356" cy="218" r="8" /><circle cx="368" cy="202" r="10" /><circle cx="384" cy="188" r="11" opacity=".7" />
        </g>
        <rect x="262" y="290" width="100" height="56" fill="#9A5534" />
        <g stroke="#7A3F25" strokeWidth="1" opacity=".6">{[300, 310, 320, 330, 340].map(y => <line key={y} x1="262" x2="362" y1={y} y2={y} />)}</g>
        <path d="M250 294 L312 248 L374 294Z" fill="#6B2D1F" />
        <path d="M244 293 L312 240 L380 293 Q378 300 371 298 Q365 304 358 298 Q350 303 343 298 Q333 304 322 298 Q312 303 302 298 Q292 304 282 298 Q272 304 264 298 Q254 303 247 299Z" fill="#FFFFFF" />
        <path d="M250 297 Q312 288 374 297" stroke="#C9D8F0" strokeWidth="2" fill="none" />
        <circle cx="285" cy="314" r="22" fill="url(#x-win)" />
        <rect x="274" y="304" width="22" height="19" rx="1.5" fill="#FFD166" stroke="#5B2C1E" strokeWidth="2.5" />
        <path d="M285 304 v19 M274 313.5 h22" stroke="#5B2C1E" strokeWidth="1.6" />
        <rect x="272" y="322" width="26" height="4" rx="2" fill="#fff" />
        <rect x="318" y="312" width="22" height="34" rx="2" fill="#5B2C1E" />
        <circle cx="329" cy="322" r="6" fill="none" stroke="#15803D" strokeWidth="3" />
        <circle cx="329" cy="327" r="1.6" fill="#DC2626" />
        <circle cx="336" cy="331" r="1.3" fill="#FBBF24" />
        <rect x="345" y="306" width="12" height="14" rx="1" fill="#FFD166" stroke="#5B2C1E" strokeWidth="2" />
        <path d="M256 346 Q312 338 368 346 Q340 352 312 351 Q284 352 256 346Z" fill="#fff" />

        {/* Người tuyết */}
        <g transform="translate(540 352)">
          <ellipse cx="0" cy="2" rx="22" ry="4" fill="#C3D2EC" opacity=".7" />
          <circle cx="0" cy="-14" r="17" fill="#FFFFFF" stroke="#D5E0F2" strokeWidth="1.5" />
          <circle cx="0" cy="-38" r="12" fill="#FFFFFF" stroke="#D5E0F2" strokeWidth="1.5" />
          <circle cx="0" cy="-56" r="9" fill="#FFFFFF" stroke="#D5E0F2" strokeWidth="1.5" />
          <path d="M-10 -40 L-28 -50 M-24 -48 l-4 -6 M10 -40 L27 -52 M23 -49 l2 -7" stroke="#6D4C41" strokeWidth="2" strokeLinecap="round" />
          <path d="M-9 -48 Q0 -44 9 -48 L9 -44 Q0 -40 -9 -44Z" fill="#DC2626" />
          <path d="M5 -45 l4 12 l-6 -1z" fill="#DC2626" />
          <circle cx="-3" cy="-58" r="1.3" fill="#1F2937" /><circle cx="3" cy="-58" r="1.3" fill="#1F2937" />
          <path d="M0 -55 l9 2 l-9 2z" fill="#F97316" />
          <g fill="#1F2937"><circle cx="0" cy="-38" r="1.4" /><circle cx="0" cy="-32" r="1.4" /><circle cx="0" cy="-20" r="1.6" /></g>
          <rect x="-11" y="-66" width="22" height="3" rx="1" fill="#1F2937" />
          <rect x="-7" y="-78" width="14" height="13" rx="1" fill="#1F2937" />
          <rect x="-7" y="-69" width="14" height="2.5" fill="#B91C1C" />
        </g>

        {/* Tuyết tiền cảnh */}
        <path d="M0 392 C140 372 260 398 400 386 S640 372 760 392 S960 400 1060 380 V480 H0Z" fill="url(#x-snow)" />
        <path d="M0 392 C140 372 260 398 400 386 S640 372 760 392 S960 400 1060 380" stroke="#fff" strokeWidth="3" fill="none" />
        <g fill="#C9D9F0" opacity=".55">
          <path d="M40 420 Q160 406 300 418 Q170 426 40 420Z" />
          <path d="M380 440 Q480 428 590 438 Q480 446 380 440Z" />
          <path d="M940 430 Q1000 420 1060 424 L1060 434 Q1000 438 940 430Z" />
        </g>

        {/* Cây thông Noel lớn */}
        <rect x="788" y="392" width="24" height="34" fill="#6D4C41" />
        <rect x="800" y="392" width="12" height="34" fill="#4E342E" />
        {TIERS.map((t, i) => (
          <g key={i}>
            <path d={t.d} fill="url(#x-pine)" />
            <path d={t.edge} stroke="#B8CDEA" strokeWidth="4" fill="none" strokeLinecap="round" transform="translate(0 3)" />
            <path d={t.edge} stroke="#FFFFFF" strokeWidth="7" fill="none" strokeLinecap="round" />
          </g>
        ))}
        {/* Tuyết đọng trên sườn cây */}
        <g fill="#FFFFFF" opacity=".92">
          <ellipse cx="786" cy="214" rx="9" ry="3" /><ellipse cx="770" cy="262" rx="11" ry="3.2" /><ellipse cx="834" cy="258" rx="8" ry="2.6" />
          <ellipse cx="752" cy="312" rx="12" ry="3.4" /><ellipse cx="846" cy="316" rx="10" ry="3" /><ellipse cx="738" cy="368" rx="13" ry="3.4" /><ellipse cx="866" cy="374" rx="12" ry="3.2" />
        </g>
        {/* Dây kim tuyến */}
        <g fill="none" strokeLinecap="round">
          {GARLANDS.map(([x0, y0, cx, cy, x1, y1], i) => (
            <path key={i} d={`M${x0} ${y0} Q${cx} ${cy} ${x1} ${y1}`} stroke={i % 2 ? '#F8D66D' : '#E5B93C'} strokeWidth="2.2" strokeDasharray="5 2" />
          ))}
        </g>
        {ORNAMENTS.map(([x, y, c], i) => <Ornament key={i} x={x} y={y} c={c} />)}
        {/* Ngôi sao trên đỉnh */}
        <path d={starPath(TREE_X, 160, 17, 7)} fill="url(#x-star)" stroke="#D97706" strokeWidth="1.2" strokeLinejoin="round" />
        <path d={starPath(TREE_X, 160, 7, 3)} fill="#FFFBEA" opacity=".8" />

        {/* Ụ tuyết quanh gốc + quà + bao gạo */}
        <ellipse cx="800" cy="430" rx="175" ry="20" fill="#FFFFFF" />
        <ellipse cx="800" cy="444" rx="160" ry="10" fill="#C9D9F0" opacity=".5" />
        <RiceSack x={608} bottom={450} />
        {GIFTS.map((g, i) => <Gift key={i} {...g} />)}

        {/* Lấp lánh trên tuyết */}
        <g fill="#FFFFFF">{[[90, 440], [220, 460], [470, 420], [560, 462], [980, 452], [1030, 410], [350, 470]].map(([x, y], i) => <path key={i} d={sparkle(x, y, 3)} />)}</g>
      </Layer>

      {/* 2. Xe trượt tuyết tuần lộc bay ngang trời (CSS di chuyển cả lớp) */}
      <Layer className="sleigh">
        {/* Hạ xe xuống vùng trời luôn nhìn thấy (màn hình rộng cắt mất phần trên của tranh) */}
        <g transform="translate(0 85)">
        <g fill="#FFF3B0" opacity=".8">
          {[[6, 100, 1.6], [-8, 106, 1.2], [-22, 98, 1], [-36, 104, .8], [-50, 100, .6]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />)}
        </g>
        <path d="M100 96 Q130 92 158 94 Q190 90 214 90 Q245 86 268 86" stroke="#7F1D1D" strokeWidth="1.4" fill="none" />
        <Sleigh />
        <Reindeer x={150} y={98} />
        <Reindeer x={205} y={93} />
        <Reindeer x={260} y={88} lead />
        </g>
      </Layer>

      {/* 3. Đèn và sao nhấp nháy (2 lớp lệch nhịp) */}
      <Layer className="twinkle"><TwinkleLayer set={0} /></Layer>
      <Layer className="twinkle t2"><TwinkleLayer set={1} /></Layer>
    </div>
  );
});
