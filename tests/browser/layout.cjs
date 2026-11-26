// Bố cục máy tính: thu gọn thanh bên, giỏ hàng/thanh toán cuộn được tới nút Lưu. node tests/browser/layout.cjs <site> <ảnh>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [site, out] = process.argv.slice(2);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(8782);
const res = []; const ok = (c, m) => { res.push([c, m]); console.log(c ? '  ✔' : '  ✘', m); };
const U = 'http://localhost:8782/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [w, h] of [[1536, 730], [1280, 650], [1024, 600]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.goto(U); await p.fill('input[type=email]', 'chu@test.vn'); await p.fill('input[type=password]', 'Matkhau@123');
    await p.click('button:has-text("Đăng nhập")'); await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 15000 });
    await p.goto(U + '#sales'); await p.waitForSelector('text=Chọn hàng'); await p.waitForTimeout(700);
    const btns = p.locator('button:has-text("+ Bao"):not([disabled])');
    for (let i = 0; i < Math.min(4, await btns.count()); i++) await btns.nth(i).click();
    await p.waitForTimeout(300);
    // Nút Lưu hóa đơn phải cuộn tới được và nằm trong màn hình
    const save = p.locator('#cart button:has-text("Lưu hóa đơn")');
    await save.scrollIntoViewIfNeeded();
    const bb = await save.boundingBox();
    ok(bb && bb.y >= 0 && bb.y + bb.height <= h, `${w}×${h}: cuộn tới nút "Lưu hóa đơn" trong khung thanh toán (y=${bb && Math.round(bb.y)})`);
    const cart = await p.locator('#cart').evaluate(e => ({ sh: e.scrollHeight, ch: e.clientHeight, st: e.scrollTop, oy: getComputedStyle(e).overflowY }));
    ok(cart.oy === 'auto' && cart.ch <= h, `${w}×${h}: khung thanh toán không cao quá màn hình (cao ${cart.ch}px, nội dung ${cart.sh}px)`);
    await p.screenshot({ path: `${out}/${w}_1_thanh_toan_cuon.png` });
    await save.click(); await p.waitForSelector('text=Đã lưu hóa đơn', { timeout: 10000 });
    ok(true, `${w}×${h}: bấm được "Lưu hóa đơn"`);
    await p.click('button:has-text("Tạo hóa đơn mới")'); await p.waitForTimeout(300);
    // Thu gọn thanh bên
    const side = p.locator('aside');
    const w0 = (await side.boundingBox()).width;
    await p.click('button[aria-label="Thu gọn thanh bên"]'); await p.waitForTimeout(400);
    const w1 = (await side.boundingBox()).width;
    const mainLeft = await p.locator('main').evaluate(e => e.getBoundingClientRect().left);
    ok(w0 === 256 && w1 === 80 && mainLeft >= 80, `${w}×${h}: thu gọn thanh bên ${w0}px → ${w1}px, nội dung không bị che`);
    await p.screenshot({ path: `${out}/${w}_2_thu_gon.png` });
    await p.reload(); await p.waitForSelector('text=Chọn hàng'); await p.waitForTimeout(500);
    ok((await side.boundingBox()).width === 80, `${w}×${h}: tải lại trang vẫn nhớ thu gọn`);
    await p.click('aside button[title="Hóa đơn"]'); await p.waitForTimeout(800);
    ok(p.url().endsWith('#invoices'), `${w}×${h}: khi thu gọn vẫn bấm biểu tượng để chuyển trang`);
    await p.click('button[aria-label="Mở rộng thanh bên"]'); await p.waitForTimeout(400);
    ok((await side.boundingBox()).width === 256, `${w}×${h}: mở rộng lại được`);
    await ctx.close();
  }
  ok(errs.length === 0, 'Không có lỗi JavaScript ' + JSON.stringify(errs));
  await b.close(); srv.close(); process.exit(res.every(x => x[0]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
