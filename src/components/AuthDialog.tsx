import { useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle, LockKeyhole } from 'lucide-react';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { supabase } from '../services/repository';
export function AuthDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    else onClose();
  }
  return (
    <Modal
      title="让旅程，跟着你走"
      description="登录个人账户，在电脑和手机间访问相同的旅行记录。"
      onClose={onClose}
    >
      <div className="form-body">
        <div className="auth-art">
          <LockKeyhole size={30} />
          <span>你的旅程，只有你可见</span>
        </div>
        {supabase ? (
          <form onSubmit={submit}>
            <label>
              邮箱
              <input
                aria-label="邮箱"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              密码
              <input
                aria-label="密码"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <p className="small muted">
              此应用供个人使用。首次使用请在 Supabase Auth 后台创建账户，随后关闭公开注册。
            </p>
            <Button type="submit" disabled={busy} className="full-width">
              {busy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}
              登录云端账户
            </Button>
          </form>
        ) : (
          <>
            <p className="notice">当前为本地模式。记录仅保存在这个浏览器，尚未连接云端。</p>
            <p className="muted">
              配置 .env 中的 Supabase URL 与 Publishable
              Key，并执行数据库迁移后，即可启用个人账户和云端同步。详细步骤见项目 README。
            </p>
            <Button variant="outline" onClick={onClose} className="full-width">
              继续使用本地模式
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
