import { useRef, useState } from 'react';
import { Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Brand, Notice } from './ui';

export function AppShell() {
  const { staff, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const locked = useRef(false);
  async function signOut() {
    if (locked.current) return;
    locked.current = true; setPending(true); setError(false);
    try { await logout(); } catch { setError(true); }
    finally { locked.current = false; setPending(false); }
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="app-header"><div className="header-inner page-container">
      <Brand />
      <div className="account"><span className="account-email" title={staff?.email}>{staff?.email}</span><button className="btn btn-secondary sign-out" onClick={signOut} disabled={pending}>{pending ? 'Signing out…' : 'Sign out'}</button></div>
    </div></header>
    <main id="main-content" className="workspace page-container" tabIndex={-1}>
      {error && <Notice>We couldn’t sign you out. Please try again.</Notice>}
      <Outlet />
    </main>
    <footer className="app-footer page-container">Customer Inquiry Manager</footer>
  </div>;
}
