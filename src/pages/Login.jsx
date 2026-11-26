import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import RiceScene from '../components/RiceScene.jsx';
import { XmasScene, XmasSky, XmasOverlay, SantaHat } from '../components/ChristmasScene.jsx';
import { effectiveTheme } from '../lib/theme.js';
import { Button, Field, Input } from '../components/ui.jsx';

export default function Login() {
  const xmas = effectiveTheme() === 'xmas';
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Sai email hoặc mật khẩu' : error.message);
    setBusy(false);
  };
  return (
    <div className="min-h-screen relative flex items-start sm:items-center justify-center px-4 pt-16 sm:pt-0">
      {xmas ? <><XmasSky /><XmasScene className="fixed inset-x-0 bottom-0 w-full h-[55vh] -z-10" /><XmasOverlay /></> : <RiceScene className="fixed inset-0 w-full h-full -z-10" />}
      <form onSubmit={submit} className={'card relative w-full max-w-sm rounded-[2rem] bg-white/95 shadow-2xl p-6 ring-4 ' + (xmas ? 'ring-red-200/80' : 'ring-lua-200/70')}>
        <div className="text-center mb-5">
          <span className="relative inline-block"><img src="icons/icon-192.png" alt="" className="w-20 h-20 rounded-3xl mx-auto shadow-lg heartbeat" />
            {xmas && <SantaHat className="absolute -top-6 -left-5 w-14 -rotate-12 drop-shadow" />}</span>
          <h1 className="mt-3 text-3xl font-extrabold bg-gradient-to-r from-ruong-700 via-lime-600 to-lua-600 bg-clip-text text-transparent">Đại lý Bốn Biển</h1>
          <p className="text-slate-600 text-sm">Quản lý nhập · bán · kho · công nợ</p>
        </div>
        <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
        <Field label="Mật khẩu" className="mt-3"><Input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} required /></Field>
        {err && <p className="mt-3 text-rose-600 font-semibold">⚠️ {err}</p>}
        <Button className="w-full mt-5 text-lg" disabled={busy}>{busy ? 'Đang đăng nhập…' : '🌾 Đăng nhập'}</Button>
        <p className="text-xs text-slate-500 mt-4 text-center">Tài khoản do chủ cửa hàng tạo. Ứng dụng nội bộ, cần kết nối Internet.</p>
      </form>
    </div>
  );
}
