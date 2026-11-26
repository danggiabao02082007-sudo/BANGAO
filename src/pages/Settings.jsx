import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { ROLE, datetime } from '../lib/format.js';
import { downloadBackup } from '../lib/backup.js';
import { MODES, getMode, setMode, getEffective } from '../lib/motion.js';
import { THEMES, getTheme, setTheme, effectiveTheme } from '../lib/theme.js';
import { useEffect } from 'react';
import { Card, Button, Input, Select, Field, Loading, ErrorBox, useLoad, useToast, Badge, Modal, cx } from '../components/ui.jsx';

export default function Settings({ profile }) {
  const toast = useToast();
  const owner = profile.role === 'owner';
  const store = useLoad(() => q(supabase.from('store_settings').select('*').single()), []);
  const users = useLoad(() => owner ? q(supabase.from('profiles').select('*').order('created_at')) : Promise.resolve([]), [owner]);
  const [f, setF] = useState(null);
  const s = f || store.data;
  const saveStore = async () => {
    try { await q(supabase.from('store_settings').update({ store_name: s.store_name, address: s.address, phone: s.phone, invoice_footer: s.invoice_footer, updated_at: new Date().toISOString() }).eq('id', 1));
      toast('Đã lưu thông tin cửa hàng'); } catch (e) { toast(e.message, 'err'); }
  };
  const setRole = async (u, role, active) => {
    try { await rpc('set_user_role', { p_user: u.id, p_role: role, p_active: active }); toast('Đã cập nhật quyền'); users.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card title="Thông tin cửa hàng (in trên hóa đơn)" icon="🏪" accent="from-slate-500 to-slate-400">
        {store.loading ? <Loading /> : store.error ? <ErrorBox error={store.error} /> : <div className="space-y-3">
          {[['store_name', 'Tên cửa hàng'], ['address', 'Địa chỉ'], ['phone', 'Số điện thoại'], ['invoice_footer', 'Lời chào cuối hóa đơn']].map(([k, l]) =>
            <Field key={k} label={l}><Input value={s[k]} disabled={!owner} onChange={e => setF({ ...s, [k]: e.target.value })} /></Field>)}
          {owner && <Button onClick={saveStore}>💾 Lưu</Button>}
        </div>}
      </Card>
      {owner && <Card title="Tài khoản & phân quyền" icon="👥" accent="from-ruong-600 to-teal-500">
        {users.loading ? <Loading /> : users.error ? <ErrorBox error={users.error} /> : users.data.map(u => (
          <div key={u.id} className="py-3 border-b">
            <div className="font-bold">{u.full_name} {u.id === profile.id && <Badge>Bạn</Badge>} {!u.is_active && <Badge color="bg-slate-200">Đã khóa</Badge>}</div>
            <div className="text-xs text-slate-500">{u.email}</div>
            {u.id !== profile.id && <div className="flex gap-2 mt-2">
              <Select value={u.role} onChange={e => setRole(u, e.target.value, u.is_active)} className="!py-1.5">
                {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              <Button small color={u.is_active ? 'danger' : 'green'} onClick={() => setRole(u, u.role, !u.is_active)}>{u.is_active ? 'Khóa' : 'Mở khóa'}</Button>
            </div>}
          </div>))}
        <p className="text-xs text-slate-500 mt-3">Tạo tài khoản mới: Supabase → Authentication → Users → Add user. Tài khoản mới mặc định là Nhân viên, đổi quyền tại đây.</p>
      </Card>}
      {owner && <BackupCard />}
      {owner && <ResetCard />}
      {owner && <RestoreCard />}
      <ThemeCard />
      <MotionCard />
      <ChangePassword />
      <Card title="Quyền của từng vai trò" icon="🔐" accent="from-amber-500 to-lime-500" className="lg:col-span-2">
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li><b>Chủ cửa hàng:</b> toàn quyền, phân quyền, sửa thông tin cửa hàng.</li>
          <li><b>Quản lý:</b> sản phẩm, giá, nhập hàng, kho, hủy hóa đơn, thu chi, báo cáo lợi nhuận.</li>
          <li><b>Nhân viên:</b> bán hàng, in hóa đơn, thêm khách, thu nợ khách. Không đổi giá, không hủy hóa đơn, không xem giá vốn và lợi nhuận.</li>
          <li>Không ai xóa được hóa đơn; mọi thao tác quan trọng được ghi nhật ký.</li>
        </ul>
      </Card>
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (a.length < 8) return toast('Mật khẩu tối thiểu 8 ký tự', 'err');
    if (a !== b) return toast('Hai lần nhập không khớp', 'err');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: a });
    setBusy(false);
    if (error) return toast(error.message, 'err');
    setA(''); setB(''); toast('Đã đổi mật khẩu');
  };
  return (
    <Card title="Đổi mật khẩu của bạn" icon="🔑" accent="from-pink-500 to-orange-400">
      <div className="space-y-3">
        <Field label="Mật khẩu mới (tối thiểu 8 ký tự)"><Input type="password" autoComplete="new-password" value={a} onChange={e => setA(e.target.value)} /></Field>
        <Field label="Nhập lại"><Input type="password" autoComplete="new-password" value={b} onChange={e => setB(e.target.value)} /></Field>
        <Button color="rose" onClick={save} disabled={busy || !a}>🔑 Đổi mật khẩu</Button>
      </div>
    </Card>
  );
}

function BackupCard() {
  const toast = useToast();
  const st = useLoad(() => rpc('backup_status', {}), []);
  const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  const run = async () => {
    setBusy(true);
    try { const r = await downloadBackup(); setLast(r); toast('Đã xuất sao lưu ' + r.name); st.reload(); }
    catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const days = st.data?.days_since;
  return (
    <Card title="Sao lưu dữ liệu" icon="💾" accent="from-sky-600 to-indigo-500" className="lg:col-span-2">
      <p className="text-sm">Tải <b>toàn bộ dữ liệu</b> (sản phẩm, kho, lô hàng, hóa đơn, công nợ, sổ quỹ, chi tiêu, nhật ký) về máy thành 1 file. Cất file vào Google Drive, Zalo "Cloud của tôi" hoặc máy tính.</p>
      <div className="mt-3 rounded-2xl bg-sky-50 p-3 text-sm">
        {st.loading ? 'Đang kiểm tra…' : st.data?.last_backup_at
          ? <>Lần sao lưu gần nhất: <b>{datetime(st.data.last_backup_at)}</b>{days > 0 && <> ({days} ngày trước)</>}</>
          : <b className="text-rose-600">Chưa sao lưu lần nào.</b>}
      </div>
      <Button color="sky" className="w-full mt-3" onClick={run} disabled={busy}>{busy ? 'Đang chuẩn bị file…' : '💾 Xuất sao lưu'}</Button>
      {last && <p className="text-xs text-slate-600 mt-2">✅ {last.name} · {Math.max(1, Math.round(last.size / 1024))} KB · {last.counts.sales_invoices} hóa đơn, {last.counts.products} sản phẩm, {last.counts.expenses} khoản chi.</p>}
      <p className="text-xs text-slate-500 mt-2">Nên sao lưu ít nhất mỗi tuần. Gói Supabase miễn phí không tự sao lưu; app sẽ nhắc trên Tổng quan khi quá 7 ngày chưa sao lưu. File chứa toàn bộ dữ liệu kinh doanh, hãy giữ kín.</p>
    </Card>
  );
}

function MotionCard() {
  const [mode, setM] = useState(getMode());
  const [eff, setEff] = useState(getEffective());
  useEffect(() => { const h = e => setEff(e.detail); addEventListener('motionchange', h); return () => removeEventListener('motionchange', h); }, []);
  const pick = m => { setM(m); setMode(m); };
  const label = { full: 'đầy đủ', lite: 'nhẹ', off: 'tắt' }[eff];
  return (
    <Card title="Hiệu ứng động" icon="🎞️" accent="from-fuchsia-500 to-violet-500">
      <div className="grid grid-cols-2 gap-2">
        {MODES.map(([k, t]) => (
          <button key={k} onClick={() => pick(k)} aria-pressed={mode === k}
            className={'rounded-2xl py-3 px-2 font-bold text-sm ' + (mode === k ? 'bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white shadow' : 'bg-slate-100')}>{t}</button>))}
      </div>
      <p className="text-sm mt-3">{MODES.find(x => x[0] === mode)[2]}.</p>
      {mode === 'auto' && label && <p className="text-xs text-slate-500 mt-1">Máy này đang chạy ở mức: <b>{label}</b>.</p>}
      <p className="text-xs text-slate-500 mt-1">Lựa chọn chỉ áp dụng cho máy này. Nếu điện thoại bật “Giảm chuyển động”, chế độ Tự động sẽ tắt hiệu ứng.</p>
    </Card>
  );
}

// XÓA TẤT CẢ: luôn xuất sao lưu trước, rồi mới xóa (máy chủ cũng chặn nếu chưa sao lưu trong 15 phút)
const okAll = t => ['XÓA TẤT CẢ', 'XOA TAT CA'].includes(t.normalize('NFC').trim().toUpperCase().replace(/\s+/g, ' '));
function ResetCard() {
  const toast = useToast();
  const [scope, setScope] = useState('transactions'); const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(''); const [busy, setBusy] = useState(''); const [done, setDone] = useState(null);
  const run = async () => {
    try {
      setBusy('Đang xuất sao lưu…'); const b = await downloadBackup();
      setBusy('Đang xóa…'); const r = await rpc('reset_business_data', { p_confirm: 'XÓA TẤT CẢ', p_scope: scope });
      setDone({ backup: b.name, counts: r }); setOpen(false); setTyped(''); toast('Đã xóa tất cả dữ liệu');
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };
  const OPTS = [['transactions', 'Xóa mọi giao dịch, giữ danh mục', 'Xóa hóa đơn, phiếu nhập, kho, sổ quỹ, chi tiêu, công nợ. GIỮ sản phẩm (tồn về 0), khách hàng, nhà cung cấp. Số chứng từ đánh lại từ đầu.'],
    ['everything', 'Xóa sạch hết', 'Xóa cả sản phẩm, khách hàng, nhà cung cấp. Chỉ giữ tài khoản đăng nhập và thông tin cửa hàng.']];
  return (
    <Card title="Xóa tất cả dữ liệu" icon="🧹" accent="from-rose-600 to-orange-500" className="lg:col-span-2">
      <p className="text-sm">Dùng khi muốn làm lại từ đầu (ví dụ xóa hết dữ liệu nhập thử). App <b>tự xuất file sao lưu trước</b> rồi mới xóa. Muốn xóa vài mục thì dùng nút <b>☑️ Chọn nhiều để xóa</b> trong từng trang.</p>
      <div className="grid sm:grid-cols-2 gap-2 mt-3">{OPTS.map(([k, t, d]) => (
        <button key={k} type="button" onClick={() => setScope(k)} className={cx('text-left rounded-2xl p-3 ring-2', scope === k ? 'ring-rose-500 bg-rose-50' : 'ring-slate-200 bg-white')}>
          <b>{scope === k ? '🔘' : '⚪'} {t}</b><div className="text-xs text-slate-600 mt-1">{d}</div></button>))}</div>
      <Button color="rose" className="w-full mt-3" onClick={() => setOpen(true)}>🧹 Sao lưu rồi xóa tất cả</Button>
      {done && <p className="text-xs text-slate-600 mt-2">✅ Đã sao lưu vào {done.backup}, sau đó xóa {done.counts.sales_invoices} hóa đơn, {done.counts.purchase_receipts} phiếu nhập, {done.counts.expenses} khoản chi.</p>}
      {open && <Modal title="Xóa tất cả dữ liệu?" onClose={() => !busy && setOpen(false)}>
        <p className="text-sm"><b>{OPTS.find(o => o[0] === scope)[1]}</b>: {OPTS.find(o => o[0] === scope)[2]}</p>
        <p className="text-sm mt-2">Bước 1: app tải file sao lưu về máy (trên điện thoại sẽ hiện bảng Chia sẻ, hãy lưu file lại). Bước 2: xóa.</p>
        <Field label='Gõ "XÓA TẤT CẢ" để xác nhận (không dấu cũng được)' className="mt-3"><Input value={typed} onChange={e => setTyped(e.target.value)} placeholder="XÓA TẤT CẢ" /></Field>
        <p className="text-xs text-rose-600 font-semibold mt-2">Không hoàn tác được trong app. Chỉ khôi phục được từ file sao lưu.</p>
        <div className="flex gap-2 mt-4"><Button type="button" color="ghost" className="flex-1" onClick={() => setOpen(false)} disabled={!!busy}>Không xóa</Button>
          <Button type="button" color="rose" className="flex-1" onClick={run} disabled={!!busy || !okAll(typed)}>{busy || '🧹 Xóa tất cả'}</Button></div>
      </Modal>}
    </Card>
  );
}

// KHÔI PHỤC TỪ FILE SAO LƯU: chỉ khi chưa có giao dịch (sau "Xóa tất cả"), nên không ghi đè dữ liệu đang có
const okRestore = t => ['KHÔI PHỤC', 'KHOI PHUC'].includes(t.normalize('NFC').trim().toUpperCase().replace(/\s+/g, ' '));
function RestoreCard() {
  const toast = useToast();
  const [file, setFile] = useState(null); const [err, setErr] = useState(''); const [typed, setTyped] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null);
  const pick = async e => {
    setErr(''); setFile(null); setDone(null);
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.meta?.format !== 'bangao-backup-v1' || !j.tables) throw new Error('File này không phải file sao lưu của app.');
      setFile({ name: f.name, data: j });
    } catch (x) { setErr(x.message.startsWith('File') ? x.message : 'Không đọc được file: ' + x.message); }
    e.target.value = '';
  };
  const run = async () => {
    setBusy(true);
    try { const r = await rpc('restore_backup', { p: file.data }); setDone(r); setFile(null); setTyped(''); toast('Đã khôi phục dữ liệu từ file'); }
    catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  const c = file?.data.meta.row_counts || {};
  return (
    <Card title="Khôi phục từ file sao lưu" icon="♻️" accent="from-emerald-600 to-sky-500" className="lg:col-span-2">
      <p className="text-sm">Nạp lại dữ liệu từ file <b>bonbien-saoluu-….json</b>. Chỉ làm được khi app <b>chưa có giao dịch nào</b> (ví dụ ngay sau khi “Xóa tất cả”), nên không bao giờ ghi đè dữ liệu đang dùng.</p>
      <label className="mt-3 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-700 cursor-pointer">
        📂 Chọn file sao lưu<input type="file" accept=".json,application/json" className="hidden" onChange={pick} /></label>
      {err && <p className="text-sm text-rose-600 font-semibold mt-2">⚠️ {err}</p>}
      {file && <div className="mt-3 rounded-2xl ring-2 ring-emerald-300 p-3 text-sm">
        <p><b>{file.name}</b></p>
        <p>Sao lưu lúc <b>{datetime(file.data.meta.exported_at)}</b>{file.data.meta.exported_by && <> bởi {file.data.meta.exported_by}</>}</p>
        <p>Gồm {c.sales_invoices ?? '?'} hóa đơn, {c.purchase_receipts ?? '?'} phiếu nhập, {c.products ?? '?'} sản phẩm, {c.customers ?? '?'} khách, {c.expenses ?? '?'} khoản chi.</p>
        <Field label='Gõ "KHÔI PHỤC" để xác nhận (không dấu cũng được)' className="mt-2"><Input value={typed} onChange={e => setTyped(e.target.value)} placeholder="KHÔI PHỤC" /></Field>
        <Button color="green" className="w-full mt-2" onClick={run} disabled={busy || !okRestore(typed)}>{busy ? 'Đang khôi phục…' : '♻️ Khôi phục'}</Button>
      </div>}
      {done && <p className="text-xs text-slate-600 mt-2">✅ Đã khôi phục {done.sales_invoices} hóa đơn, {done.purchase_receipts} phiếu nhập, {done.products} sản phẩm, {done.cash_transactions} dòng sổ quỹ, {done.expenses} khoản chi.</p>}
    </Card>
  );
}

// Chủ đề giao diện (nhớ riêng trên từng máy)
function ThemeCard() {
  const [t, setT] = useState(getTheme());
  const pick = k => { setT(k); setTheme(k); };
  const eff = effectiveTheme(t);
  return (
    <Card title="Chủ đề giao diện" icon="🎨" accent="from-red-600 to-emerald-600">
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map(([k, n]) => (
          <button key={k} onClick={() => pick(k)} aria-pressed={t === k}
            className={'rounded-2xl py-3 px-2 font-bold text-sm ' + (t === k ? 'bg-gradient-to-r from-red-600 to-emerald-600 text-white shadow' : 'bg-slate-100')}>{n}</button>))}
      </div>
      <p className="text-sm mt-3">{THEMES.find(x => x[0] === t)[2]}.</p>
      <p className="text-xs text-slate-500 mt-1">Đang hiện: <b>{eff === 'xmas' ? 'Giáng sinh 🎄' : 'Cánh đồng lúa 🌾'}</b>. Lựa chọn chỉ áp dụng cho máy này. Tuyết rơi và xe tuần lộc tắt theo mục “Hiệu ứng động”.</p>
    </Card>
  );
}
