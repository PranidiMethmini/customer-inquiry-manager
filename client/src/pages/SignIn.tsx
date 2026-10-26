import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import { fieldErrors, signInSchema } from '../lib/validation';
import { Brand, Field, Notice, usePageTitle } from '../components/ui';

export function SignIn() {
  usePageTitle('Sign in');
  const { staff, message, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const parsed = signInSchema.safeParse({ email, password });
    setError('');
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); setTimeout(() => document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(), 0); return; }
    locked.current = true; setPending(true); setErrors({});
    try { await login(parsed.data.email, parsed.data.password); navigate('/inquiries', { replace: true }); }
    catch (failure) {
      setError(failure instanceof ApiError && failure.status === 401 ? 'Invalid email or password.' : failure instanceof ApiError && failure.status === 429 ? 'Too many sign-in attempts. Please try again in 15 minutes.' : 'We couldn’t sign you in. Check your connection and try again.');
    } finally { locked.current = false; setPending(false); }
  }
  if (staff) return <Navigate to="/inquiries" replace />;
  return <main id="main-content" className="sign-in-page" tabIndex={-1}>
    <div className="sign-in-wrap"><div className="sign-in-brand"><Brand /></div>
      <section className="panel sign-in-panel" aria-labelledby="sign-in-title">
        <p className="eyebrow">Staff workspace</p><h1 id="sign-in-title">Welcome back</h1><p className="page-description">Sign in to manage your customer inquiries.</p>
        {message && <Notice kind="info">{message}</Notice>}
        {error && <Notice>{error}</Notice>}
        <form noValidate onSubmit={submit} aria-busy={pending} className="form-stack">
          <Field id="email" label="Email address" type="email" autoComplete="username" required value={email} onChange={setEmail} error={errors.email} maxLength={254} disabled={pending} />
          <Field id="password" label="Password" type="password" autoComplete="current-password" required value={password} onChange={setPassword} error={errors.password} maxLength={256} disabled={pending} />
          <button className="btn btn-primary w-full" disabled={pending} type="submit">{pending ? 'Signing in…' : 'Sign in'}</button>
          <span className="sr-only" role="status">{pending ? 'Signing in. Please wait.' : ''}</span>
        </form>
      </section>
    </div>
  </main>;
}
