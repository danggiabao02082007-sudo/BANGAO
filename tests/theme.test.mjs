// Lịch tự đổi chủ đề theo mùa lễ: node tests/theme.test.mjs
import { seasonOf, daysTo } from '../src/lib/theme.js';
let pass = 0, fail = 0;
const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 10); };
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); } };
const cases = [
  ['2026-11-19', 'normal'], ['2026-11-20', 'xmas'], ['2026-11-26', 'xmas'], ['2026-12-25', 'xmas'], ['2027-01-06', 'xmas'], ['2027-01-07', 'normal'],
  ['2027-01-23', 'tet'], ['2027-02-06', 'tet'], ['2027-02-16', 'tet'], ['2027-02-17', 'normal'],
  ['2027-04-17', 'normal'], ['2027-04-18', 'le304'], ['2027-04-30', 'le304'], ['2027-05-03', 'le304'], ['2027-05-04', 'normal'],
  ['2027-08-24', 'normal'], ['2027-08-25', 'trungthu'], ['2027-09-15', 'trungthu'], ['2027-09-19', 'normal'],
  ['2027-10-14', 'normal'], ['2027-10-15', 'halloween'], ['2027-10-31', 'halloween'], ['2027-11-02', 'halloween'], ['2027-11-03', 'normal'],
  ['2028-01-12', 'tet'], ['2028-01-26', 'tet'], ['2027-12-31', 'xmas'],
  ['2026-07-01', 'normal'], ['2031-02-01', 'normal']
];
for (const [d, want] of cases) ok(seasonOf(D(d)) === want, `${d} → ${want} (được ${seasonOf(D(d))})`);
ok(daysTo('xmas', D('2026-11-26')) === 29, 'Còn 29 ngày tới Giáng sinh từ 26/11/2026');
ok(daysTo('tet', D('2027-01-30')) === 7, 'Còn 7 ngày tới Tết Đinh Mùi (06/02/2027) từ 30/01/2027');
ok(daysTo('le304', D('2027-04-25')) === 5, 'Còn 5 ngày tới 30/4');
ok(daysTo('halloween', D('2026-11-26')) > 300, 'Sau Halloween: đếm sang năm sau');
console.log(`\nKẾT QUẢ: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
