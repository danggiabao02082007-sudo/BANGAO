// Ma trận 4 trường hợp: thanh bên mở/thu gọn × hóa đơn dài/ngắn (giả lập Supabase). node tests/browser/matrix.cjs <dist> [thư mục ảnh]
const { chromium } = require('playwright'); const { serve, open } = require('./mock.cjs');
const [site, out] = process.argv.slice(2); const PORT = 8795; const srv = serve(site, PORT);
const res = []; const ok = (c, m) => { res.push(c); console.log(c ? '  ✔' : '  ✘', m); };
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [w, h] of [[1280, 650], [1024, 600]]) for (const mini of [false, true]) for (const [kind, items] of [['dài', 25], ['ngắn', 1]]) {
    const tag = `${w}×${h} thanh bên ${mini ? 'thu gọn' : 'mở'} · HĐ ${kind}`;
    const { ctx, p } = await open(b, { w, h, mini, invoices: 40, items, port: PORT });
    await p.waitForSelector('text=Tra cứu hóa đơn', { timeout: 10000 }); await p.waitForTimeout(600);
    const aw = (await p.locator('aside').boundingBox()).width;
    const lay = await p.evaluate(() => ({ left: document.querySelector('main').getBoundingClientRect().left, sx: document.documentElement.scrollWidth > innerWidth }));
    ok(aw === (mini ? 80 : 256) && lay.left >= aw && !lay.sx, `${tag}: thanh bên ${aw}px, nội dung không bị che, không cuộn ngang`);
    await p.locator('main button:has-text("HD1000")').click(); await p.waitForSelector('text=Chi tiết hóa đơn'); await p.waitForTimeout(500);
    const box = p.locator('.fixed.inset-0.z-50 > div').first();
    const m = await box.evaluate(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, sh: e.scrollHeight, ch: e.clientHeight }; });
    ok(m.top >= 0 && m.bottom <= h + 1, `${tag}: hộp chi tiết nằm trọn trong màn hình`);
    ok(items > 1 ? m.sh > m.ch : m.sh <= m.ch + 1, `${tag}: ${items > 1 ? 'có' : 'không có'} thanh cuộn trong hộp (${m.sh}/${m.ch})`);
    ok(await p.evaluate(() => document.documentElement.classList.contains('scroll-lock')), `${tag}: khóa cuộn trang nền khi mở hộp`);
    await p.mouse.move(w / 2, h / 2); for (let i = 0; i < 12; i++) await p.mouse.wheel(0, 400); await p.waitForTimeout(300);
    ok(await p.evaluate(() => scrollY) === 0, `${tag}: cuộn trong hộp không kéo trang nền`);
    const a5 = p.locator('button:has-text("In A5")'); await a5.scrollIntoViewIfNeeded(); const bb = await a5.boundingBox();
    ok(bb && bb.y >= 0 && bb.y + bb.height <= h, `${tag}: tới được nút In A5`);
    if (items > 1) {
      const th = await p.locator('.fixed.inset-0.z-50 th:has-text("Thành tiền")').boundingBox();
      ok(th && th.y >= m.top && th.y + th.height <= m.bottom, `${tag}: tiêu đề cột vẫn hiện khi cuộn tới đáy`);
    }
    if (out) await p.screenshot({ path: `${out}/m_${w}_${mini ? 'mini' : 'full'}_${items > 1 ? 'dai' : 'ngan'}.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(!(await p.evaluate(() => document.documentElement.classList.contains('scroll-lock'))), `${tag}: đóng hộp thì gỡ khóa cuộn`);
    await p.mouse.wheel(0, 800); await p.waitForTimeout(300);
    ok(await p.evaluate(() => scrollY) > 0, `${tag}: trang danh sách hóa đơn cuộn lại được`);
    errs.push(...p.errs); await ctx.close();
  }
  ok(errs.length === 0, 'Không có lỗi JavaScript ' + JSON.stringify(errs));
  await b.close(); srv.close(); process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
