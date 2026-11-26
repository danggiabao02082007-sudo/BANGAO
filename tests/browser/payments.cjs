// Màu hóa đơn theo hình thức thanh toán + tiền mặt/chuyển khoản ở trang Doanh thu: node tests/browser/payments.cjs <site> <ảnh>
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [site, out] = process.argv.slice(2);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(8786);
const res = []; const ok = (c, m) => { res.push([c, m]); console.log(c ? '  ✔' : '  ✘', m); };
const U = 'http://localhost:8786/';
const num = t => Number((t.match(/[\d.]+(?=đ)/) || ['0'])[0].replace(/\./g, ''));
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [tag, opts] of [['pc', { viewport: { width: 1366, height: 900 } }], ['dt', { ...devices['iPhone 13'] }]]) {
    const p = await (await b.newContext(opts)).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.addInitScript(() => { localStorage.setItem('bonbien.theme', 'normal'); localStorage.setItem('bonbien.motion', 'off'); });
    await p.goto(U); await p.fill('input[type=email]', 'chu@test.vn'); await p.fill('input[type=password]', 'Matkhau@123');
    await p.click('button:has-text("Đăng nhập")'); await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 15000 });
    if (tag === 'pc') {
      // Bán 1 hóa đơn chuyển khoản
      await p.goto(U + '#sales'); await p.waitForSelector('text=Chọn hàng'); await p.waitForTimeout(600);
      await p.locator('button:has-text("+ Bao"):not([disabled])').first().click();
      await p.click('button:has-text("Chuyển khoản")');
      await p.locator('button:has-text("Lưu hóa đơn")').first().click(); await p.waitForSelector('text=Đã lưu hóa đơn', { timeout: 10000 });
      await p.click('button:has-text("Tạo hóa đơn mới")');
    }
    await p.goto(U + '#invoices'); await p.waitForTimeout(1500);
    const bankRows = p.locator('div.divide-y > button.border-l-sky-500'), cashRows = p.locator('div.divide-y > button.border-l-emerald-500');
    ok(await bankRows.count() >= 1 && await cashRows.count() >= 1, `${tag}: hóa đơn chuyển khoản (${await bankRows.count()}) và tiền mặt (${await cashRows.count()}) có màu khác nhau`);
    const bg = await bankRows.first().evaluate(e => getComputedStyle(e).backgroundColor), bg2 = await cashRows.first().evaluate(e => getComputedStyle(e).backgroundColor);
    ok(bg !== bg2 && await bankRows.first().locator('text=🏦 Chuyển khoản').count() === 1, `${tag}: nền xanh + nhãn "🏦 Chuyển khoản" (${bg} vs ${bg2})`);
    await p.selectOption('select >> nth=1', 'bank'); await p.waitForTimeout(400);
    ok(await cashRows.count() === 0 && await bankRows.count() >= 1, `${tag}: lọc "Chuyển khoản" chỉ còn hóa đơn chuyển khoản`);
    await p.selectOption('select >> nth=1', ''); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${tag}_hoa_don.png`, fullPage: tag === 'dt' });
    await p.goto(U + '#reports'); await p.waitForSelector('text=Tiền mặt nhận ngày', { timeout: 10000 }); await p.waitForTimeout(800);
    const cashTxt = await p.locator('div.card:has-text("💵 Tiền mặt nhận ngày")').innerText(), bankTxt = await p.locator('div.card:has-text("🏦 Chuyển khoản nhận ngày")').innerText();
    ok(num(cashTxt) > 0 && num(bankTxt) > 0, `${tag}: Doanh thu có tiền mặt nhận ${num(cashTxt)}đ, chuyển khoản nhận ${num(bankTxt)}đ`);
    ok(await p.locator('text=Tiền mặt nhận tháng').count() === 1 && await p.locator('text=Chuyển khoản nhận tháng').count() === 1, `${tag}: có tổng tiền mặt / chuyển khoản cả tháng`);
    await p.screenshot({ path: `${out}/${tag}_doanh_thu.png`, fullPage: tag === 'dt' });
    await p.goto(U + '#dashboard'); await p.waitForTimeout(1500);
    ok(await p.locator('text=/💵 Tiền mặt .*🏦 Chuyển khoản/').count() >= 1, `${tag}: Tổng quan tách tiền mặt / chuyển khoản`);
    await p.context().close();
  }
  ok(errs.length === 0, 'Không có lỗi JavaScript ' + JSON.stringify(errs));
  await b.close(); srv.close(); process.exit(res.every(x => x[0]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
