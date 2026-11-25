import { useState } from 'react';
import { supabase, rpc, q } from '../lib/supabase.js';
import { ROLE, datetime } from '../lib/format.js';
import { downloadBackup } from '../lib/backup.js';
import { Card, Button, Input, Select, Field, Loading, ErrorBox, useLoad, useToast, Badge } from '../components/ui.jsx';

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
