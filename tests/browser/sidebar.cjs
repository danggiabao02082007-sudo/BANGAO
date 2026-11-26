// Thanh bên máy tính: thu gọn/mở rộng, aria, phím tắt Ctrl+B, nhớ trạng thái, không cuộn ngang. node tests/browser/sidebar.cjs <dist>
const { chromium } = require('playwright');
const path = require('path');
const { serve, open } = require('./mock.cjs');
const site = path.resolve(process.argv[2] || 'dist'), port = 8813;
const srv = serve(site, port);
const res = []; const ok = (c, m) => { res.push([c, m]); console.log(c ? '  ✔' : '  ✘', m); };
const BTN = 'aside > button[aria-controls]';

// Đo trạng thái: chiều rộng aside, aria-expanded, vị trí main, cuộn ngang trang và trong nav
const state = p => p.evaluate(sel => {
  const a = document.querySelector('aside'), b = document.querySelector(sel), n = document.querySelector('aside nav');
  return { w: Math.round(a.getBoundingClientRect().width), exp: b.getAttribute('aria-expanded'), ctl: b.getAttribute('aria-controls'), navId: n.id,
    main: Math.round(document.querySelector('main').getBoundingClientRect().left), docW: document.documentElement.scrollWidth, vw: innerWidth,
    nsw: n.scrollWidth, ncw: n.clientWidth, nsh: n.scrollHeight, nch: n.clientHeight, oy: getComputedStyle(n).overflowY, ox: getComputedStyle(n).overflowX };
}, BTN);

(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [w, h] of [[1280, 650], [1024, 600]]) {
    const { ctx, p } = await open(b, { w, h, mini: false, invoices: 3, items: 1, port, hash: 'invoices' });
    await p.waitForSelector('text=Tra cứu hóa đơn', { timeout: 15000 });
    const T = `${w}×${h}:`;
    let s = await state(p);
    ok(s.w === 256 && s.exp === 'true' && s.ctl === s.navId && s.navId, `${T} mở rộng ${s.w}px, aria-expanded=${s.exp}, aria-controls=#${s.ctl}`);
    ok(s.main >= s.w && s.docW <= s.vw && s.nsw <= s.ncw, `${T} mở rộng: main left ${s.main} ≥ ${s.w}, không cuộn ngang (trang ${s.docW}/${s.vw}, nav ${s.nsw}/${s.ncw})`);
    ok(s.oy === 'auto' && s.ox === 'hidden', `${T} nav cuộn dọc được (overflow-y ${s.oy}, overflow-x ${s.ox}, nội dung ${s.nsh}/${s.nch}px)`);
    // Bấm nút thu gọn
    await p.click('button[aria-label="Thu gọn thanh bên"]'); await p.waitForTimeout(400);
    s = await state(p);
    ok(s.w === 80 && s.exp === 'false', `${T} bấm nút → thu gọn ${s.w}px, aria-expanded=${s.exp}`);
    ok(s.main >= s.w && s.docW <= s.vw && s.nsw <= s.ncw, `${T} thu gọn: main left ${s.main} ≥ ${s.w}, không cuộn ngang (trang ${s.docW}/${s.vw}, nav ${s.nsw}/${s.ncw})`);
    // Vòng focus bàn phím trên nút
    const sh0 = await p.$eval(BTN, e => getComputedStyle(e).boxShadow);
    await p.focus(BTN); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); await p.waitForTimeout(400);
    const ring = await p.evaluate(sel => { const e = document.querySelector(sel); return document.activeElement === e && e.matches(':focus-visible') ? getComputedStyle(e).boxShadow : ''; }, BTN);
    ok(ring && ring !== sh0, `${T} nút có vòng focus khi dùng bàn phím (box-shadow đổi khi focus)`);
    // Ctrl+B đổi trạng thái
    await p.locator('main').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.keyboard.press('Control+b'); await p.waitForTimeout(400);
    s = await state(p); ok(s.w === 256 && s.exp === 'true', `${T} Ctrl+B → mở rộng (${s.w}px)`);
    await p.keyboard.press('Meta+b'); await p.waitForTimeout(400);
    s = await state(p); ok(s.w === 80 && s.exp === 'false', `${T} Cmd+B → thu gọn (${s.w}px)`);
    // Ctrl+B khi đang gõ trong ô tìm kiếm: không đổi
    await p.focus('input[placeholder="Mã HĐ / tên khách"]'); await p.keyboard.press('Control+b'); await p.waitForTimeout(400);
    s = await state(p); ok(s.w === 80, `${T} Ctrl+B trong ô tìm kiếm không đổi trạng thái (${s.w}px)`);
    // Tải lại giữ trạng thái (mock.cjs đặt lại localStorage mỗi lần tải, nên mang giá trị qua sessionStorage)
    const saved = await p.evaluate(() => localStorage.getItem('bonbien.sidebar'));
    await ctx.addInitScript(() => { const v = sessionStorage.getItem('keep'); if (v) localStorage.setItem('bonbien.sidebar', v); });
    await p.evaluate(v => sessionStorage.setItem('keep', v), saved);
    await p.reload(); await p.waitForSelector('text=Tra cứu hóa đơn', { timeout: 15000 });
    s = await state(p); ok(saved === 'mini' && s.w === 80 && s.exp === 'false', `${T} tải lại trang vẫn thu gọn (lưu "${saved}", ${s.w}px)`);
    // Khi thu gọn: nút menu có aria-label, bấm chuyển trang, aria-current
    await p.click('aside nav button[aria-label="Sản phẩm & kho"]'); await p.waitForTimeout(800);
    const cur = await p.evaluate(() => [...document.querySelectorAll('aside nav button[aria-current="page"]')].map(e => e.getAttribute('aria-label')));
    ok(p.url().endsWith('#products') && cur.length === 1 && cur[0] === 'Sản phẩm & kho', `${T} thu gọn: bấm "Sản phẩm & kho" → #products, aria-current=${JSON.stringify(cur)}`);
    errs.push(...p.errs); await ctx.close();
  }
  // Điện thoại: không có thanh bên / nút thu gọn
  const { ctx, p } = await open(b, { w: 390, h: 780, invoices: 3, items: 1, port, hash: 'invoices' });
  await p.waitForSelector('text=Tra cứu hóa đơn', { timeout: 15000 });
  const m = await p.evaluate(() => ({ d: getComputedStyle(document.querySelector('aside')).display, docW: document.documentElement.scrollWidth, vw: innerWidth }));
  const vis = await p.locator(BTN).isVisible();
  ok(m.d === 'none' && !vis && m.docW <= m.vw, `390×780: thanh bên ẩn (display ${m.d}), nút thu gọn ẩn, không cuộn ngang`);
  errs.push(...p.errs); await ctx.close();
  ok(errs.length === 0, 'Không có lỗi JavaScript ' + JSON.stringify(errs));
  await b.close(); srv.close(); process.exit(res.every(x => x[0]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
