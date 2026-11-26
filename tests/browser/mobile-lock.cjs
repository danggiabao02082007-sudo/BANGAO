// Điện thoại: không phóng to, không trượt ngang ở mọi trang: node tests/browser/mobile-lock.cjs <site> <ảnh>
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [site, out] = process.argv.slice(2);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(8787);
const res = []; const ok = (c, m) => { res.push([c, m]); console.log(c ? '  ✔' : '  ✘', m); };
const U = 'http://localhost:8787/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const dev of ['iPhone 13', 'iPhone SE', 'Pixel 5', 'Galaxy S9+']) {
    const p = await (await b.newContext({ ...devices[dev] })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.addInitScript(() => { localStorage.setItem('bonbien.motion', 'off'); });
    await p.goto(U); await p.fill('input[type=email]', 'chu@test.vn'); await p.fill('input[type=password]', 'Matkhau@123');
    await p.click('button:has-text("Đăng nhập")'); await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 15000 });
    const meta = await p.locator('meta[name=viewport]').getAttribute('content');
    ok(/maximum-scale=1/.test(meta) && /user-scalable=no/.test(meta), `${dev}: thẻ viewport khóa phóng to`);
    ok(await p.evaluate(() => getComputedStyle(document.documentElement).touchAction) === 'pan-y', `${dev}: chỉ cho trượt dọc (touch-action: pan-y)`);
    const wide = [];
    for (const pg of ['dashboard', 'sales', 'invoices', 'products', 'purchase', 'customers', 'suppliers', 'cash', 'expenses', 'reports', 'settings']) {
      await p.goto(U + '#' + pg); await p.waitForTimeout(900);
      if (pg === 'invoices' && await p.locator('div.divide-y > button').count()) { await p.locator('div.divide-y > button').first().click(); await p.waitForTimeout(700); }
      const m = await p.evaluate(() => {
        const w = innerWidth, over = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('[aria-hidden=true]'); });
        return { sw: document.documentElement.scrollWidth, w, n: over.length, ex: over.slice(0, 3).map(e => e.tagName + '.' + String(e.className).slice(0, 40)) };
      });
      if (m.sw > m.w || m.n) wide.push(`${pg}: rộng ${m.sw}/${m.w}, ${m.n} phần tử tràn ${m.ex.join(' | ')}`);
      if (pg === 'invoices') await p.keyboard.press('Escape');
      if (dev === 'iPhone SE' && ['sales', 'invoices', 'reports'].includes(pg)) await p.screenshot({ path: `${out}/${dev.replace(/ /g, '')}_${pg}.png` });
    }
    ok(!wide.length, `${dev}: 11 trang không trang nào trượt ngang được ${wide.join(' ; ')}`);
    await p.context().close();
  }
  ok(errs.length === 0, 'Không có lỗi JavaScript ' + JSON.stringify(errs));
  await b.close(); srv.close(); process.exit(res.every(x => x[0]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
