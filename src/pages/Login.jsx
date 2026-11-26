import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import RiceScene from '../components/RiceScene.jsx';
import { FEST } from '../components/themes.js';
import { effectiveTheme } from '../lib/theme.js';
import { Button, Field, Input } from '../components/ui.jsx';

export default function Login() {
  const fest = FEST[effectiveTheme()];
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Sai email hoặc mật khẩu' : error.message);
    setBusy(false);
  };
  return (
    <div className="min-h-screen relative flex items-start sm:items-center justify-center px-4 pt-16 sm:pt-0">
      {fest ? <><fest.Sky /><fest.Scene className="fixed inset-x-0 bottom-0 w-full h-[55vh] -z-10" /><fest.Overlay /></> : <RiceScene className="fixed inset-0 w-full h-full -z-10" />}
      <form onSubmit={submit} className={'card relative w-full max-w-sm rounded-[2rem] bg-white/95 shadow-2xl p-6 ring-4 ' + (fest ? 'ring-white/80' : 'ring-lua-200/70')}>
        <div className="text-center mb-5">
          <span className="relative inline-block"><img src="icons/icon-192.png" alt="" className="w-20 h-20 rounded-3xl mx-auto shadow-lg heartbeat" />
            {fest && <fest.Hat className={fest.hat.replace(/w-\d+/, 'w-14').replace(/-top-\d+/, '-top-6').replace(/-left-\d+/, '-left-5')} />}</span>
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
