// Tranh nền cánh đồng lúa, vẽ bằng SVG.
// Hiệu năng: phần tĩnh nằm trong 1 SVG; mỗi thứ chuyển động (cò, chuồn chuồn, mây, hàng lúa, hạt lúa rơi) là 1 lớp riêng
// và chỉ được dịch chuyển nguyên lớp bằng CSS transform → trình duyệt dùng GPU, không phải vẽ lại cả bức tranh mỗi khung hình.
import { memo } from 'react';

const VB = '0 0 1060 480';
const Layer = ({ className = '', children, style }) => (
  <svg className={'absolute inset-0 w-full h-full ' + className} viewBox={VB} preserveAspectRatio="xMidYMax slice" aria-hidden="true" style={style}>{children}</svg>
);

function Stalk({ x, h, lean, hue }) {
  const tipX = x + lean, tipY = 400 - h;
  const grains = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 9, gx = tipX + lean * 0.4 * t + (i % 2 ? 5 : -5), gy = tipY + 6 + i * 6;
    grains.push(<ellipse key={i} cx={gx} cy={gy} rx="3.2" ry="5.5" fill={hue} transform={`rotate(${i % 2 ? 28 : -28} ${gx} ${gy})`} />);
  }
  return (
    <g>
      <path d={`M${x},400 Q${x + lean * 0.2},${400 - h * 0.6} ${tipX},${tipY}`} stroke="#6B8E23" strokeWidth="2.4" fill="none" />
      <path d={`M${x},400 Q${x - 18},${400 - h * 0.45} ${x - 30},${400 - h * 0.35}`} stroke="#7CB342" strokeWidth="3" fill="none" strokeLinecap="round" />
      {grains}
    </g>
  );
}

const Flock = ({ y, s }) => (
  <g transform={`translate(0 ${y}) scale(${s})`}>
    {[[0, 0], [34, 14], [-30, 18]].map(([dx, dy], i) => (
      <g key={i} transform={`translate(${dx} ${dy})`}>
        <ellipse cx="0" cy="0" rx="13" ry="5" fill="#fff" stroke="#CBD5E1" />
        <path d="M11 -2 l10 -3 l-9 6z" fill="#F59E0B" />
        <path d={i === 1 ? 'M-6 -2 Q-2 -20 10 -4 Z' : 'M-6 -2 Q0 -16 10 -3 Z'} fill="#F8FAFC" stroke="#CBD5E1" />
      </g>))}
  </g>
);
const Dragonfly = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="-1.5" y="-2" width="26" height="4" rx="2" fill="#0EA5E9" /><circle cx="-2" cy="0" r="4" fill="#0369A1" />
    <g fill="#E0F2FE" opacity=".85"><ellipse cx="6" cy="-7" rx="9" ry="3.5" /><ellipse cx="6" cy="7" rx="9" ry="3.5" />
      <ellipse cx="14" cy="-6" rx="8" ry="3" /><ellipse cx="14" cy="6" rx="8" ry="3" /></g>
  </g>
);

export default memo(function RiceScene({ className = '' }) {
  const stalks = [];
  for (let i = 0; i < 46; i++) {
    const x = i * 23 + (i % 3) * 5, h = 70 + ((i * 37) % 55), lean = 18 + ((i * 13) % 22);
    stalks.push(<Stalk key={i} x={x} h={h} lean={lean} hue={['#F6C445', '#F2B01E', '#FFD86B', '#E9A10F'][i % 4]} />);
  }
  const grains = [];
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % 1060, y = 410 + ((i * 53) % 70);
    grains.push(<ellipse key={i} cx={x} cy={y} rx="4" ry="7" fill={i % 3 ? '#FFFDF5' : '#FFF1C9'} stroke="#E8D8A8" strokeWidth=".8"
      transform={`rotate(${(i * 47) % 180} ${x} ${y})`} />);
  }
  return (
    <div className={'overflow-hidden ' + className} aria-hidden="true">
      {/* 1. Phần tĩnh */}
      <Layer>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7DD3FC" /><stop offset=".45" stopColor="#BAE6FD" /><stop offset=".75" stopColor="#FEF3C7" /><stop offset="1" stopColor="#FDE68A" />
          </linearGradient>
          <radialGradient id="sun"><stop offset="0" stopColor="#FFFDE7" /><stop offset=".55" stopColor="#FFD54F" /><stop offset="1" stopColor="#FF9800" /></radialGradient>
          <radialGradient id="glow"><stop offset="0" stopColor="#FFF59D" stopOpacity=".8" /><stop offset="1" stopColor="#FFF59D" stopOpacity="0" /></radialGradient>
          <linearGradient id="t1" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#A3E635" /><stop offset="1" stopColor="#65A30D" /></linearGradient>
          <linearGradient id="t2" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#FDE047" /><stop offset="1" stopColor="#EAB308" /></linearGradient>
          <linearGradient id="t3" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4ADE80" /><stop offset="1" stopColor="#15803D" /></linearGradient>
          <linearGradient id="t4" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#FACC15" /><stop offset="1" stopColor="#CA8A04" /></linearGradient>
          <linearGradient id="water" x1="0" x2="1"><stop offset="0" stopColor="#67E8F9" stopOpacity=".7" /><stop offset="1" stopColor="#A5F3FC" stopOpacity=".4" /></linearGradient>
        </defs>
        <rect width="1060" height="480" fill="url(#sky)" />
        <circle cx="860" cy="90" r="150" fill="url(#glow)" />
        <g stroke="#FFD54F" strokeWidth="5" strokeLinecap="round" opacity=".75">
          {Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6; return <line key={i} x1={860 + Math.cos(a) * 58} y1={90 + Math.sin(a) * 58} x2={860 + Math.cos(a) * (i % 2 ? 74 : 86)} y2={90 + Math.sin(a) * (i % 2 ? 74 : 86)} />; })}
        </g>
        <circle cx="860" cy="90" r="46" fill="url(#sun)" />
        <path d="M0 230 L120 150 L220 210 L340 130 L470 220 L600 140 L720 215 L850 150 L1060 230 V480 H0Z" fill="#86C5A4" opacity=".7" />
        <path d="M0 250 L150 190 L290 240 L430 180 L580 245 L760 185 L920 240 L1060 210 V480 H0Z" fill="#5FA67F" opacity=".8" />
        <path d="M0 260 C200 235 380 275 560 255 S900 240 1060 258 V480 H0Z" fill="url(#t1)" />
        <path d="M0 262 C200 237 380 277 560 257 S900 242 1060 260" stroke="#F0FDF4" strokeWidth="3" fill="none" opacity=".8" />
        <path d="M0 292 C220 270 420 308 640 288 S940 276 1060 292 V480 H0Z" fill="url(#t2)" />
        <path d="M0 294 C220 272 420 310 640 290 S940 278 1060 294" stroke="#FFFBEB" strokeWidth="3" fill="none" opacity=".9" />
        <path d="M0 322 C240 302 470 340 700 318 S960 310 1060 322 V480 H0Z" fill="url(#t3)" />
        <path d="M60 330 C260 318 420 342 620 330" stroke="url(#water)" strokeWidth="9" fill="none" strokeLinecap="round" />
        <g fill="#fff" opacity=".8">{[[120, 330], [260, 326], [410, 334], [560, 329]].map(([x, y], i) => <path key={i} d={`M${x} ${y} l3 -6 l3 6 l-3 6z`} />)}</g>
        <path d="M0 352 C260 334 500 370 760 348 S980 342 1060 354 V480 H0Z" fill="url(#t4)" />
        <path d="M0 354 C260 336 500 372 760 350 S980 344 1060 356" stroke="#FEF9C3" strokeWidth="3" fill="none" />
        <g stroke="#166534" strokeWidth="2" opacity=".5">
          {Array.from({ length: 50 }, (_, i) => <path key={i} d={`M${i * 22 + 6} 312 l-3 -9 M${i * 22 + 6} 312 l3 -9`} />)}
        </g>
        <rect y="398" width="1060" height="82" fill="#A16207" opacity=".25" />
        {grains}
      </Layer>
      {/* 2. Mây trôi */}
      <Layer className="cloud"><g fill="#fff" opacity=".9"><ellipse cx="180" cy="70" rx="60" ry="20" /><ellipse cx="220" cy="58" rx="40" ry="22" /><ellipse cx="150" cy="62" rx="30" ry="16" /></g></Layer>
      <Layer className="cloud slow"><g fill="#fff" opacity=".8"><ellipse cx="560" cy="110" rx="70" ry="18" /><ellipse cx="600" cy="98" rx="42" ry="20" /></g></Layer>
      {/* 3. Đàn cò bay ngang */}
      <Layer className="bird"><Flock y={60} s={1} /></Layer>
      <Layer className="bird b2"><Flock y={110} s={.8} /></Layer>
      <Layer className="bird b3"><Flock y={150} s={.65} /></Layer>
      {/* 4. Chuồn chuồn lượn */}
      <Layer className="dragonfly"><Dragonfly x={180} y={300} /></Layer>
      <Layer className="dragonfly d2"><Dragonfly x={640} y={280} /></Layer>
      {/* 5. Hạt lúa rơi (2 lớp lệch nhịp) */}
      {[0, 1].map(k => (
        <Layer key={k} className={'falling' + (k ? ' f2' : '')}>
          {Array.from({ length: 6 }, (_, i) => <ellipse key={i} cx={40 + i * 180 + k * 90} cy={-20 - ((i * 67) % 120)} rx="3.5" ry="6" fill={(i + k) % 2 ? '#FACC15' : '#FDE68A'} transform={`rotate(${i * 40} ${40 + i * 180 + k * 90} ${-20 - ((i * 67) % 120)})`} />)}
        </Layer>))}
      {/* 6. Hàng lúa tiền cảnh đung đưa */}
      <Layer className="stalk">{stalks}</Layer>
    </div>
  );
});
