// Thử chọn nhiều/xóa tất cả, trả nợ NCC, xuất Excel, xóa toàn bộ: node tests/browser/bulk.cjs <site> <ảnh>
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [site, out] = process.argv.slice(2);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(8779);
const res = []; const ok = (c, m) => { res.push([c, m]); console.log(c ? '  ✔' : '  ✘', m); };
const U = 'http://localhost:8779/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(U); await p.fill('input[type=email]', 'chu@test.vn'); await p.fill('input[type=password]', 'Matkhau@123');
  await p.click('button:has-text("Đăng nhập")'); await p.waitForSelector('text=Doanh thu hôm nay', { timeout: 15000 });
  const dl = async click => { const [d] = await Promise.all([p.waitForEvent('download'), click()]); const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); return f; };

  // 1. Hóa đơn: xuất Excel, chọn 2 để xóa
  await p.goto(U + '#invoices'); await p.waitForTimeout(1500);
  const n0 = await p.locator('div.divide-y > button').count();
  const xf = await dl(() => p.click('button:has-text("📊 Excel")'));
  ok(fs.statSync(xf).size > 1000 && xf.endsWith('.xlsx'), 'Xuất Excel hóa đơn: ' + path.basename(xf));
  await p.click('button:has-text("Chọn nhiều để xóa")');
  await p.locator('div.divide-y > button').nth(0).click(); await p.locator('div.divide-y > button').nth(1).click();
  ok(await p.locator('text=Đã chọn 2/').count() === 1, 'Bấm vào dòng để chọn: đã chọn 2');
  await p.screenshot({ path: `${out}/1_chon_nhieu.png` });
  await p.click('button:has-text("Xóa đã chọn (2)")'); await p.waitForSelector('text=Xóa 2 hóa đơn đã chọn?');
  await p.screenshot({ path: `${out}/2_hoi_xoa_2.png` });
  await p.locator('button:text-is("🗑️ Xóa 2")').click();
  await p.waitForSelector('text=/Đã xóa 2 hóa đơn|Kết quả xóa/', { timeout: 15000 }); await p.waitForTimeout(1000);
  if (await p.locator('text=Kết quả xóa').count()) { await p.screenshot({ path: `${out}/2b_ket_qua.png` }); await p.click('button:has-text("Đã hiểu")'); }
  const n1 = await p.locator('div.divide-y > button').count();
  ok(n1 < n0, `Danh sách hóa đơn giảm từ ${n0} còn ${n1}`);

  // 2. Chi tiêu: xóa tất cả (phải gõ XÓA)
  await p.goto(U + '#expenses'); await p.waitForTimeout(1200);
  for (const [nm, am] of [['Tiền điện', '300000'], ['Bốc xếp', '150000']]) {
    await p.locator('button:has-text("＋ Thêm khoản chi")').first().click();
    await p.fill('input[placeholder="vd: Tiền điện tháng 11"]', nm); await p.fill('form input[inputmode=numeric]', am);
    await p.click('form button:has-text("Thêm khoản chi")'); await p.waitForSelector('text=Đã thêm khoản chi'); await p.waitForTimeout(600);
  }
  await p.click('button:has-text("Chọn nhiều để xóa")');
  await p.click('button:has-text("Xóa tất cả (")');
  const btn = p.locator('button:has-text("🗑️ Xóa ")').last();
  ok(await btn.isDisabled(), 'Xóa tất cả: nút bị khóa khi chưa gõ XÓA');
  await p.fill('input[placeholder="XÓA"]', 'xoa'); ok(!(await btn.isDisabled()), 'Gõ "xoa" (không dấu) thì mở khóa');
  await p.screenshot({ path: `${out}/3_xoa_tat_ca_chi_tieu.png` });
  await btn.click(); await p.waitForSelector('text=/Đã xóa \\d+ khoản chi/', { timeout: 15000 }); await p.waitForTimeout(800);
  ok(await p.locator('text=Chưa có khoản chi nào').count() === 1, 'Không còn khoản chi nào');

  // 3. Trả nợ NCC
  await p.goto(U + '#suppliers'); await p.waitForTimeout(1200);
  const debtRow = p.locator('button:has(b:text-matches("^Nợ"))').first();
  if (await debtRow.count()) {
    await debtRow.click(); await p.waitForSelector('text=Trả nợ');
    await p.fill('input[placeholder="Số tiền"]', '1000000'); await p.click('button:has-text("Ghi nhận trả nợ")');
    await p.waitForSelector('text=/Đã trả nợ 1.000.000đ/', { timeout: 10000 }); await p.waitForTimeout(800);
    ok(await p.locator('text=/Trả nợ PC/').count() >= 1, 'Trả nợ NCC hiện trong sổ công nợ');
    await p.screenshot({ path: `${out}/4_tra_no_ncc.png` });
    await p.locator('button[aria-label="Xóa lần trả nợ này?"]').first().click(); await p.locator('button:text-is("🗑️ Xóa")').click();
    await p.waitForSelector('text=Đã xóa lần trả nợ'); ok(true, 'Xóa lần trả nợ NCC');
    await p.keyboard.press('Escape');
  } else ok(false, 'Không có NCC đang nợ để thử');

  // 4. Báo cáo: xuất Excel
  await p.goto(U + '#reports'); await p.waitForTimeout(1500);
  const rf = await dl(() => p.click('button:has-text("Xuất Excel")'));
  ok(rf.endsWith('.xlsx'), 'Xuất Excel lợi nhuận tháng: ' + path.basename(rf));

  // 5. Cài đặt: xóa tất cả (sao lưu trước)
  await p.goto(U + '#settings'); await p.waitForTimeout(1200);
  await p.click('button:has-text("Sao lưu rồi xóa tất cả")');
  const go = p.locator('button:has-text("🧹 Xóa tất cả")').last();
  ok(await go.isDisabled(), 'Xóa toàn bộ: khóa khi chưa gõ XÓA TẤT CẢ');
  await p.fill('input[placeholder="XÓA TẤT CẢ"]', 'XÓA TẤT CẢ');
  await p.screenshot({ path: `${out}/5_xoa_toan_bo.png` });
  const bf = await dl(() => go.click());
  ok(JSON.parse(fs.readFileSync(bf, 'utf8')).meta.format === 'bangao-backup-v1', 'Tự tải file sao lưu trước khi xóa: ' + path.basename(bf));
  await p.waitForSelector('text=Đã xóa tất cả dữ liệu', { timeout: 15000 });
  await p.goto(U + '#invoices'); await p.waitForTimeout(1500);
  ok(await p.locator('text=Không có hóa đơn').count() === 1, 'Sau khi xóa toàn bộ: không còn hóa đơn');
  // 6. Khôi phục từ file vừa sao lưu
  await p.goto(U + '#settings'); await p.waitForTimeout(1200);
  await p.setInputFiles('input[type=file]', bf);
  await p.waitForSelector('text=Gõ "KHÔI PHỤC"');
  await p.fill('input[placeholder="KHÔI PHỤC"]', 'khoi phuc');
  await p.screenshot({ path: `${out}/6_khoi_phuc.png` });
  await p.click('button:has-text("♻️ Khôi phục")');
  await p.waitForSelector('text=Đã khôi phục dữ liệu từ file', { timeout: 20000 });
  await p.goto(U + '#invoices'); await p.waitForTimeout(1500);
  ok(await p.locator('div.divide-y > button').count() > 0, 'Khôi phục xong: hóa đơn hiện lại');
  await p.goto(U + '#settings'); await p.waitForTimeout(1000);
  await p.setInputFiles('input[type=file]', bf); await p.fill('input[placeholder="KHÔI PHỤC"]', 'KHÔI PHỤC');
  await p.click('button:has-text("♻️ Khôi phục")');
  await p.waitForSelector('text=/chưa có giao dịch nào/', { timeout: 10000 });
  ok(true, 'Khôi phục lần 2 khi đã có dữ liệu: bị chặn, không ghi đè');
  ok(errs.length === 0, 'Không có lỗi JavaScript ' + JSON.stringify(errs));
  await b.close(); srv.close(); process.exit(res.every(x => x[0]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
