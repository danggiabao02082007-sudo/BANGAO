// Thanh cuộn hộp "Chi tiết hóa đơn": không cuộn lây trang nền, đáy hộp trong màn hình (dvh), tiêu đề cột dính,
// khóa/gỡ khóa cuộn trang nền (kể cả hộp lồng nhau). Dùng giả lập Supabase. node tests/browser/invoice-scroll.cjs <dist>
const { chromium } = require('playwright');
const path = require('path');
const { serve, open } = require('./mock.cjs');
const site = path.resolve(process.argv[2] || 'dist'), PORT = 8801;
const srv = serve(site, PORT);
const res = []; const ok = (c, m) => { res.push([c, m]); console.log(c ? '  ✔' : '  ✘', m); };
const BOX = 'div.fixed.inset-0 > div';
const box = p => p.locator(BOX).first();
const locked = p => p.evaluate(() => document.documentElement.classList.contains('scroll-lock'));

async function openDetail(p) {
  await p.click('main button:has-text("HD1000")');
  await p.waitForSelector(`${BOX} th:has-text("Thành tiền")`, { timeout: 10000 });
  // Chờ hiệu ứng hiện dần (fadeUp) xong; đưa trang nền về đầu (Playwright có thể đã cuộn trang để bấm nút)
  await p.waitForTimeout(900); await p.evaluate(() => scrollTo(0, 0));
}

(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [w, h] of [[1280, 650], [390, 780]]) {
    for (const items of [25, 1]) {
      const tag = `${w}×${h} ${items} dòng:`;
      const { ctx, p } = await open(b, { w, h, invoices: 30, items, port: PORT, hash: 'invoices' });
      await p.waitForSelector('text=Tra cứu hóa đơn', { timeout: 15000 }); await p.waitForTimeout(400);
      await openDetail(p);
      ok(await locked(p), `${tag} mở hộp → <html> có lớp scroll-lock`);
      const m = await box(p).evaluate(e => { const r = e.getBoundingClientRect(); return { oy: getComputedStyle(e).overflowY, ob: getComputedStyle(e).overscrollBehaviorY, sh: e.scrollHeight, ch: e.clientHeight, top: r.top, bottom: r.bottom }; });
      if (items > 1) {
        ok(m.oy === 'auto' && m.sh > m.ch, `${tag} hộp cuộn được (overflowY=${m.oy}, nội dung ${m.sh}px > khung ${m.ch}px)`);
        ok(m.ob === 'contain', `${tag} vùng cuộn có overscroll-behavior: contain (${m.ob})`);
        ok(m.top >= 0 && m.bottom <= h + 0.5, `${tag} đáy hộp nằm trong màn hình (top=${Math.round(m.top)}, bottom=${Math.round(m.bottom)})`);
        // Cuộn bánh xe tới đáy hộp: trang nền không được cuộn theo
        const y0 = await p.evaluate(() => scrollY);
        const bb = await box(p).boundingBox();
        await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
        for (let i = 0; i < 15; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(40); }
        await p.waitForTimeout(300);
        const s = await p.evaluate(sel => { const e = document.querySelector(sel); return { y: scrollY, st: e.scrollTop, max: e.scrollHeight - e.clientHeight }; }, BOX);
        ok(y0 === 0 && s.y === 0, `${tag} cuộn 15×400px trên hộp → trang nền vẫn scrollY=${s.y} (trước khi cuộn ${y0})`);
        ok(s.st >= s.max - 1, `${tag} hộp đã cuộn tới đáy (scrollTop=${Math.round(s.st)}/${s.max})`);
        // Tiêu đề cột vẫn nhìn thấy, nằm dưới thanh tiêu đề hộp
        const th = await p.evaluate(sel => {
          const e = document.querySelector(sel), bar = e.firstElementChild.getBoundingClientRect(), r = e.getBoundingClientRect();
          const t = [...e.querySelectorAll('th')].find(x => x.textContent.includes('Thành tiền')).getBoundingClientRect();
          const hit = document.elementFromPoint(Math.min(t.left + t.width / 2, r.right - 2), t.top + t.height / 2);
          return { t: t.top, b: t.bottom, bar: bar.bottom, top: r.top, bot: r.bottom, hit: !!hit && hit.closest('th')?.textContent.includes('Thành tiền') };
        }, BOX);
        ok(th.t >= th.bar - 1 && th.b <= th.bot && th.t < th.bar + 4 && th.hit,
          `${tag} sau khi cuộn tới đáy tiêu đề cột "Thành tiền" vẫn hiện ngay dưới thanh tiêu đề (th ${Math.round(th.t)}–${Math.round(th.b)}, thanh tiêu đề đáy ${Math.round(th.bar)})`);
        const a5 = p.locator(`${BOX} button:has-text("In A5")`);
        await a5.scrollIntoViewIfNeeded(); const ab = await a5.boundingBox();
        ok(ab && ab.y >= 0 && ab.y + ab.height <= h && ab.x >= 0 && ab.x + ab.width <= w, `${tag} nút "In A5" cuộn tới được, nằm trọn trong màn hình (y=${ab && Math.round(ab.y)})`);
        const hs = await box(p).evaluate(e => e.scrollWidth - e.clientWidth);
        ok(hs <= 1, `${tag} hộp không tràn ngang (thừa ${hs}px)`);
        // Hộp lồng nhau: mở hộp xác nhận xóa rồi đóng → hộp chi tiết còn mở nên vẫn khóa cuộn
        await p.click(`${BOX} button:has-text("Xóa hóa đơn")`); await p.waitForSelector('text=Xóa hóa đơn HD1000?');
        ok(await p.locator(BOX).count() === 2 && await locked(p), `${tag} mở hộp lồng nhau (xác nhận xóa) vẫn khóa cuộn`);
        await p.locator('button[aria-label="Đóng"]').last().click(); await p.waitForTimeout(200);
        ok(await p.locator(BOX).count() === 1 && await locked(p), `${tag} đóng hộp lồng nhau → hộp chi tiết còn mở, vẫn khóa cuộn`);
      } else {
        ok(m.sh <= m.ch + 1, `${tag} hóa đơn ngắn không có thanh cuộn (nội dung ${m.sh}px, khung ${m.ch}px)`);
        ok(m.top >= 0 && m.bottom <= h + 0.5, `${tag} hộp nằm trọn trong màn hình`);
      }
      // Đóng bằng nút ✕
      await p.click(`${BOX} button[aria-label="Đóng"]`); await p.waitForTimeout(200);
      ok(await p.locator(BOX).count() === 0 && !(await locked(p)), `${tag} đóng bằng nút ✕ → gỡ lớp scroll-lock`);
      // Mở lại, đóng bằng phím Escape
      await openDetail(p); ok(await locked(p), `${tag} mở lại → khóa cuộn`);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      ok(await p.locator(BOX).count() === 0 && !(await locked(p)), `${tag} đóng bằng Escape → gỡ lớp scroll-lock`);
      // Trang nền cuộn lại được
      await p.mouse.move(w / 2, h / 2);
      for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(60); }
      await p.waitForTimeout(300);
      const y = await p.evaluate(() => scrollY);
      ok(y > 0, `${tag} sau khi đóng hộp trang nền cuộn lại được (scrollY=${y})`);
      errs.push(...p.errs); await ctx.close();
    }
  }
  ok(errs.length === 0, 'Không có lỗi JavaScript ' + JSON.stringify(errs));
  await b.close(); srv.close(); process.exit(res.every(x => x[0]) ? 0 : 1);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
