// Giả lập Supabase để kiểm thử giao diện KHÔNG cần CSDL thật (không gửi mạng ra ngoài).
// Dùng: const { serve, open } = require('./mock.cjs'); const p = await open(browser, { w, h, invoices, items, mini });
const http = require('http'), fs = require('fs'), path = require('path');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

function serve(site, port) {
  return http.createServer((q, r) => {
    let p = path.join(site, q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'text/plain' }); r.end(d); } });
  }).listen(port);
}

const UID = '00000000-0000-0000-0000-000000000001';
function data({ invoices = 30, items = 3 }) {
  const now = Date.now();
  const inv = Array.from({ length: invoices }, (_, k) => ({
    id: 'inv-' + k, invoice_code: 'HD' + String(1000 + k), customer_name: 'Khách lẻ ' + k, invoice_date: new Date(now - k * 36e5).toISOString(),
    status: 'completed', price_tier: 'retail', subtotal: 500000, discount: 0, total_amount: 500000, paid_amount: 500000, debt_amount: 0, debt_remaining: 0, note: ''
  }));
  const it = Array.from({ length: items }, (_, k) => ({
    id: 'it-' + k, line_no: k + 1, product_code: 'SP' + k, product_name: 'Gạo ST25 loại ' + k, quantity: 1, unit_name: 'bao', conversion_factor: 1,
    base_qty: 1, unit_price: 500000, list_price: 500000, discount: 0, line_total: 500000
  }));
  const prods = Array.from({ length: 6 }, (_, k) => ({
    id: 'p' + k, product_code: 'SP' + k, name: 'Gạo ' + k, emoji: '🍚', category_name: 'Gạo', kg_per_bao: 10, stock_bao: 100, min_stock: 0, is_active: true,
    base_unit: 'bao', units: [{ unit_code: 'bao', unit_name: 'Bao', is_active: true, conversion_factor: 1, retail_price: 500000, wholesale_price: 480000 }]
  }));
  return { inv, it, prods };
}

async function open(browser, opt) {
  const { w, h, mini = false, hash = 'invoices' } = opt; const d = data(opt);
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const sess = { access_token: 'x.' + Buffer.from(JSON.stringify({ sub: UID, exp })).toString('base64url') + '.x', token_type: 'bearer', expires_in: 86400, expires_at: exp,
    refresh_token: 'r', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'chu@test.vn' } };
  await ctx.addInitScript(([s, m]) => {
    localStorage.setItem('sb-yqiccylhkdvtripgmung-auth-token', s);
    localStorage.setItem('bonbien.sidebar', m ? 'mini' : 'full');
  }, [JSON.stringify(sess), mini]);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/supabase\.co/, async r => {
    const u = new URL(r.request().url()); const t = u.pathname.split('/').pop(); const one = (r.request().headers()['accept'] || '').includes('vnd.pgrst.object');
    const body = {
      profiles: { id: UID, full_name: 'Chủ cửa hàng', role: 'owner', is_active: true },
      store_settings: { track_stock: true, store_name: 'Bốn Biển', address: '', phone: '' },
      sales_invoices: one ? d.inv.find(i => u.search.includes(i.id)) || d.inv[0] : d.inv,
      sales_invoice_items: d.it, v_products: d.prods, v_customers: []
    }[t];
    if (body === undefined) return r.fulfill({ status: 200, contentType: 'application/json', body: one ? '{}' : '[]' });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(`http://localhost:${opt.port}/#${hash}`);
  return { ctx, p };
}
module.exports = { serve, open };
