const { chromium, devices } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const [site, out, rate] = [process.argv[2], process.argv[3], Number(process.argv[4] || 4)];
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(8799);
const fpsIn = p => p.evaluate(() => new Promise(res => { let n = 0, t0 = 0; const f = t => { if (!t0) t0 = t; n++; if (t - t0 < 3000) requestAnimationFrame(f); else res(Math.round((n - 1) * 1000 / (t - t0))); }; requestAnimationFrame(f); }));
(async () => {
  const b = await chromium.launch(); const errs = []; const results = {};
  // đăng nhập 1 lần, lưu phiên
  const ctx = await b.newContext({ ...devices['iPhone 13'] }); const p0 = await ctx.newPage(); await p0.route(/fonts\./, r => r.abort());
  await p0.goto('http://localhost:8799/'); await p0.fill('input[type=email]', 'chu@test.vn'); await p0.fill('input[type=password]', 'Matkhau@123');
  await p0.click('button:has-text("Đăng nhập")'); await p0.waitForSelector('text=Doanh thu hôm nay'); await p0.close();
  for (const mode of ['full', 'lite', 'off', 'auto']) {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(mode + ': ' + e.message)); await p.route(/fonts\./, r => r.abort());
    await p.addInitScript(m => { try { localStorage.setItem('bonbien.motion', m); } catch {} }, mode);
    const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await p.goto('http://localhost:8799/#dashboard'); await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 60000 });
    if (mode === 'auto') await p.waitForTimeout(6000); else await p.waitForTimeout(2000);
    const fps = await fpsIn(p); const cls = await p.evaluate(() => document.documentElement.className);
    const auto = await p.evaluate(() => window.__lastFps ? Math.round(window.__lastFps) : null);
    results[mode] = { fps, cls, auto };
    if (mode === 'auto') await p.screenshot({ path: out + '/auto_slow.png' });
    await p.close();
  }
  console.log(`CPU chậm ${rate}x:`, JSON.stringify(results));
  console.log('Lỗi JS:', JSON.stringify(errs)); await b.close(); srv.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
