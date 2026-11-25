const { chromium, devices } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const [site] = process.argv.slice(2);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(8800);
const metric = (m, k) => m.metrics.find(x => x.name === k).value;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const p0 = await ctx.newPage(); await p0.route(/fonts\./, r => r.abort()); await p0.goto('http://localhost:8800/');
  await p0.fill('input[type=email]', 'chu@test.vn'); await p0.fill('input[type=password]', 'Matkhau@123'); await p0.click('button:has-text("Đăng nhập")');
  await p0.waitForSelector('text=Doanh thu hôm nay'); await p0.close();
  const out = {};
  for (const mode of ['full', 'lite', 'off']) {
    const p = await ctx.newPage(); await p.route(/fonts\./, r => r.abort());
    await p.addInitScript(m => { try { localStorage.setItem('bonbien.motion', m); } catch {} }, mode);
    const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await cdp.send('Performance.enable');
    await p.goto('http://localhost:8800/#dashboard'); await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 60000 }); await p.waitForTimeout(3000);
    const a = await cdp.send('Performance.getMetrics'); await p.waitForTimeout(5000); const z = await cdp.send('Performance.getMetrics');
    const busy = (metric(z, 'TaskDuration') - metric(a, 'TaskDuration')) / 5 * 100;
    const style = (metric(z, 'RecalcStyleDuration') - metric(a, 'RecalcStyleDuration')) / 5 * 1000;
    out[mode] = { 'CPU bận %': Math.round(busy), 'tính lại style ms/giây': Math.round(style) };
    await p.close();
  }
  console.log('CPU chậm 4x, trang Tổng quan:', JSON.stringify(out));
  // Giả lập máy rất yếu: mỗi khung hình tốn thêm 45ms → ~20 fps
  const p = await ctx.newPage(); await p.route(/fonts\./, r => r.abort());
  await p.addInitScript(() => { try { localStorage.setItem('bonbien.motion', 'auto'); } catch {}
    const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(t => { const s = performance.now(); while (performance.now() - s < 45); cb(t); }); });
  await p.goto('http://localhost:8800/#dashboard'); await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 60000 }); await p.waitForTimeout(7000);
  console.log('Máy yếu giả lập: fps đo được', Math.round(await p.evaluate(() => window.__lastFps)), '→ chế độ', await p.evaluate(() => document.documentElement.className));
  await p.goto('http://localhost:8800/#settings'); await p.waitForSelector('text=Hiệu ứng động'); await p.waitForTimeout(500);
  console.log('Cài đặt hiển thị:', (await p.locator('text=Máy này đang chạy ở mức').innerText()));
  await b.close(); srv.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
