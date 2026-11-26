// Thử nút xóa trên giao diện: node tests/browser/delete.cjs <thư mục site> <thư mục ảnh>
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [site, out] = process.argv.slice(2);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(8778);
const res = []; const ok = (c, m) => { res.push([c, m]); console.log(c ? '  ✔' : '  ✘', m); };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const login = async (opts, email) => {
    const ctx = await b.newContext(opts); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::|400|Bad Request/.test(m.text())) errs.push(m.text()); });
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.goto('http://localhost:8778/');
    await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Matkhau@123'); await p.click('button:has-text("Đăng nhập")');
    await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 15000 });
    return p;
  };
  const p = await login({ ...devices['iPhone 13'] }, 'chu@test.vn');
  // Tạo 1 hóa đơn rồi xóa
  await p.goto('http://localhost:8778/#sales'); await p.waitForSelector('text=Chọn hàng'); await p.waitForTimeout(500);
  await p.locator('button:has-text("+ Bao"):not([disabled])').first().click();
  await p.locator('button:has-text("Lưu hóa đơn")').first().click();
  await p.waitForSelector('text=Đã lưu hóa đơn', { timeout: 10000 });
  const code = (await p.locator('text=/HD\\d{6}/').first().innerText()).match(/HD\d{6}/)[0];
  await p.goto('http://localhost:8778/#invoices'); await p.waitForTimeout(1200);
  await p.click(`button:has-text("${code}")`);
  await p.click('button:has-text("Xóa hóa đơn (nhập sai)")');
  await p.waitForSelector(`text=Xóa hóa đơn ${code}?`);
  await p.screenshot({ path: `${out}/1_hoi_xoa_hoa_don.png` });
  await p.locator('button:text-is("Không xóa")').click();
  ok(await p.locator(`h3:text-is("${code}")`).isVisible(), 'Bấm "Không xóa" thì hóa đơn vẫn còn');
  await p.click('button:has-text("Xóa hóa đơn (nhập sai)")');
  await p.locator('button:text-is("🗑️ Xóa")').click();
  await p.waitForSelector(`text=Đã xóa hóa đơn ${code}`, { timeout: 10000 });
  await p.waitForTimeout(800);
  ok(await p.locator(`button:has-text("${code}")`).count() === 0, `Hóa đơn ${code} biến mất khỏi danh sách`);
  await p.screenshot({ path: `${out}/2_da_xoa_hoa_don.png` });
  // Phiếu nhập đã bán: báo lỗi rõ ràng
  await p.goto('http://localhost:8778/#purchase'); await p.waitForTimeout(1200);
  await p.locator('button[aria-label^="Xóa phiếu nhập"]').last().click();
  await p.locator('button:text-is("🗑️ Xóa")').click();
  await p.waitForSelector('text=/đã được bán trong hóa đơn/', { timeout: 10000 });
  ok(true, 'Xóa phiếu nhập đã bán: hiện thông báo phải xóa hóa đơn trước');
  await p.screenshot({ path: `${out}/3_phieu_nhap_da_ban.png` });
  await p.locator('button:text-is("Không xóa")').click();
  // Khoản thu ghi tay
  await p.goto('http://localhost:8778/#cash'); await p.waitForTimeout(1000);
  await p.fill('input[inputmode=numeric]', '77000'); await p.click('button:has-text("Ghi sổ")');
  await p.waitForSelector('text=Đã ghi sổ quỹ'); await p.waitForTimeout(800);
  const before = await p.locator('text=+77.000đ').count();
  await p.locator('div:has(> b:text-is("+77.000đ")) >> button[aria-label="Xóa khoản thu/chi này?"]').first().click();
  await p.locator('button:text-is("🗑️ Xóa")').click();
  await p.waitForSelector('text=Đã xóa khỏi sổ quỹ'); await p.waitForTimeout(800);
  ok(before === 1 && await p.locator('text=+77.000đ').count() === 0, 'Xóa khoản thu ghi tay khỏi sổ quỹ');
  // Nhân viên không thấy nút xóa
  const s = await login({ viewport: { width: 1280, height: 850 } }, 'nv@test.vn');
  await s.goto('http://localhost:8778/#invoices'); await s.waitForTimeout(1200);
  await s.locator('div.divide-y > button').first().click(); await s.waitForTimeout(800);
  ok(await s.locator('text=Xóa hóa đơn').count() === 0, 'Nhân viên không thấy nút xóa hóa đơn');
  ok(errs.length === 0, 'Không có lỗi JavaScript ' + JSON.stringify(errs));
  await b.close(); srv.close();
  process.exit(res.every(x => x[0]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
