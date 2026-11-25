const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [site, out] = process.argv.slice(2);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
http.createServer((q, r) => { let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(8777);
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const run = async (ctxOpts, email, tag) => {
    const ctx = await b.newContext(ctxOpts); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(tag + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::/.test(m.text())) errs.push(tag + ': ' + m.text()); });
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.goto('http://localhost:8777/');
    await p.screenshot({ path: `${out}/${tag}_0_login.png` });
    await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Matkhau@123'); await p.click('button:has-text("Đăng nhập")');
    await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 15000 }); await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/${tag}_1_dashboard.png` });
    return p;
  };
  // Chủ cửa hàng trên máy tính
  const d = await run({ viewport: { width: 1366, height: 900 } }, 'chu@test.vn', 'pc');
  await d.goto('http://localhost:8777/#sales'); await d.waitForSelector('text=Chọn hàng'); await d.waitForTimeout(600);
  await d.click('div:has(> div > div > div:text-is("Gạo Nàng Hoa 9")) >> button:has-text("+ Bao")');
  await d.click('div:has(> div > div > div:text-is("Nếp cái hoa vàng")) >> button:has-text("+ Kg")');
  await d.selectOption('select >> nth=0', { label: 'Anh Tư xóm Chợ · 0987654321' });
  await d.click('button:has-text("Chuyển khoản")');
  await d.screenshot({ path: `${out}/pc_2_ban_hang.png` });
  await d.click('button:has-text("Lưu hóa đơn")');
  await d.waitForSelector('text=Đã lưu hóa đơn', { timeout: 10000 });
  await d.screenshot({ path: `${out}/pc_3_da_luu.png` });
  await d.click('button:has-text("Tạo hóa đơn mới")');
  for (const [h, n] of [['products', 'san_pham'], ['invoices', 'hoa_don'], ['customers', 'khach'], ['purchase', 'nhap'], ['cash', 'thu_chi'], ['reports', 'bao_cao'], ['settings', 'cai_dat']]) {
    await d.goto('http://localhost:8777/#' + h); await d.waitForTimeout(1200); await d.screenshot({ path: `${out}/pc_${n}.png` });
  }
  // Nhân viên trên điện thoại
  const m = await run({ ...devices['iPhone 13'] }, 'nv@test.vn', 'mobile');
  const menuText = await m.locator('nav').last().innerText();
  console.log('Menu nhân viên:', menuText.replace(/\n/g, ' | '));
  await m.locator('nav').last().getByText('Bán hàng', { exact: true }).click(); await m.waitForTimeout(1000); await m.locator('button:has-text("+ Bao")').nth(1).click(); await m.waitForTimeout(300); await m.screenshot({ path: `${out}/mobile_2_ban_hang.png`, fullPage: false });
  await m.locator('nav').last().getByText('Thêm', { exact: true }).click(); await m.waitForTimeout(400); await m.screenshot({ path: `${out}/mobile_3_menu.png` });
  console.log('ERRORS:', JSON.stringify(errs));
  await b.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
