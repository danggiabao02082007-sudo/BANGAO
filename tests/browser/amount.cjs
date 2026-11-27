// Bán theo số tiền ("50 nghìn gạo"): node tests/browser/amount.cjs <site> <ảnh> <service key>
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [site, out, SVC] = process.argv.slice(2);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(8787);
const res = []; const ok = (c, m) => { res.push([c, m]); console.log(c ? '  ✔' : '  ✘', m); };
const U = 'http://localhost:8787/';
const db = async (pathq) => (await fetch('http://127.0.0.1:54321/rest/v1/' + pathq, { headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } })).json();
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [tag, opts] of [['pc', { viewport: { width: 1366, height: 900 } }], ['dt', { ...devices['iPhone 13'] }]]) {
    const p = await (await b.newContext(opts)).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.addInitScript(() => { localStorage.setItem('bonbien.theme', 'normal'); localStorage.setItem('bonbien.motion', 'off'); });
    await p.goto(U); await p.fill('input[type=email]', 'chu@test.vn'); await p.fill('input[type=password]', 'Matkhau@123');
    await p.click('form button:not([type=button])'); await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 15000 });
    await p.goto(U + '#sales'); await p.waitForSelector('text=Chọn hàng'); await p.waitForTimeout(600);
    const card = p.locator('div.rounded-2xl:has-text("Gạo Nàng Hoa 9")').filter({ has: p.locator('button:has-text("+ Kg")') }).first();
    // Bấm "+ Bao" rồi nhập tiền → tự chuyển sang kg
    await card.locator('button:has-text("+ Bao")').click();
    const amt = p.locator('input[aria-label="Số tiền khách muốn mua"]').first();
    await amt.fill('50000'); await p.waitForTimeout(300);
    const line = p.locator('#cart div.rounded-2xl.bg-ruong-50').first();
    ok(await line.locator('select').inputValue() === 'kg', `${tag}: hàng bán theo bao, nhập số tiền → tự chuyển sang kg`);
    const lineTxt = await line.innerText();
    ok(/Cân 2,273 kg/.test(lineTxt) && /≈ 2\.273 g/.test(lineTxt), `${tag}: 50.000đ ÷ 22.000đ/kg = 2,273 kg (≈ 2.273 g)`);
    ok(/50\.000đ/.test(await line.locator('text=Thành tiền >> xpath=..').innerText()), `${tag}: thành tiền đúng 50.000đ`);
    // nút nhanh 20k
    await line.locator('button:has-text("20k")').click(); await p.waitForTimeout(200);
    ok(/0,909 kg/.test(await line.innerText()) && /20\.000đ/.test(await line.locator('text=Thành tiền >> xpath=..').innerText()), `${tag}: nút nhanh 20k → 0,909 kg, 20.000đ`);
    await line.locator('button:has-text("50k")').click(); await p.waitForTimeout(200);
    if (tag === 'dt') await p.screenshot({ path: `${out}/${tag}_theo_tien.png`, fullPage: true });
    else await line.screenshot({ path: `${out}/${tag}_theo_tien.png` });
    await p.locator('button:has-text("Lưu hóa đơn")').first().click(); await p.waitForSelector('text=Đã lưu hóa đơn', { timeout: 10000 });
    const inv = (await db('sales_invoices?select=id,invoice_code,total_amount,paid_amount&order=created_at.desc&limit=1'))[0];
    const it = (await db(`sales_invoice_items?select=quantity,unit_price,line_total&invoice_id=eq.${inv.id}`))[0];
    ok(Number(inv.total_amount) === 50000 && Number(inv.paid_amount) === 50000, `${tag}: hóa đơn ${inv.invoice_code} lưu tổng 50.000đ, đã thu 50.000đ`);
    ok(Number(it.line_total) === 50000 && Math.abs(Number(it.quantity) - 2.2727) < 1e-4 && Number(it.unit_price) === 22000, `${tag}: dòng hàng lưu ${it.quantity} kg × ${it.unit_price}đ = ${it.line_total}đ`);
    await p.click('button:has-text("Tạo hóa đơn mới")');
    // Sửa tay số lượng → bỏ chế độ theo tiền
    await card.locator('button:has-text("+ Kg")').click(); await amt.fill('30000'); await p.waitForTimeout(200);
    await line.locator('button[aria-label="Bỏ mua theo số tiền"]').click(); await p.waitForTimeout(200);
    
    ok(await amt.inputValue() === '' && /30\.008đ/.test(await line.locator('text=Thành tiền >> xpath=..').innerText()), `${tag}: bỏ "theo số tiền" → giữ số kg đã tính, sửa tay được`);
    await line.locator('button[aria-label="Xóa dòng"]').click();
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(w[0] <= w[1], `${tag}: không tràn ngang (${w})`);
  }
  ok(!errs.length, 'Không có lỗi JavaScript ' + JSON.stringify(errs.slice(0, 2)));
  await b.close(); srv.close();
  console.log(`\nKẾT QUẢ: ${res.filter(x => x[0]).length} đạt, ${res.filter(x => !x[0]).length} lỗi`);
  process.exit(res.every(x => x[0]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
