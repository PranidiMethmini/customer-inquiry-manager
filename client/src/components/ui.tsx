import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Status } from '../lib/types';

export function Brand() {
  return <Link className="brand" to="/inquiries" aria-label="Customer Inquiry Manager home">
    <span className="brand-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></span>
    <span className="brand-wordmark"><span>Customer Inquiry</span><span className="brand-subtitle">Manager</span></span>
  </Link>;
}

export const statusLabels: Record<Status, string> = { NEW: 'New', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved' };
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><span aria-hidden="true" className="status-dot" />{statusLabels[status]}</span>;
}

export function Notice({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'info' | 'success' }) {
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return <div className="loading-state" role="status"><span className="spinner" aria-hidden="true" />{children}</div>;
}

interface FieldProps {
  id: string; label: string; value: string; onChange: (value: string) => void;
  error?: string; hint?: string; describedBy?: string; type?: string; required?: boolean; maxLength?: number;
  autoComplete?: string; multiline?: boolean; disabled?: boolean;
}
export function Field({ id, label, value, onChange, error, hint, describedBy, type = 'text', required, maxLength, autoComplete, multiline, disabled }: FieldProps) {
  const props = {
    id, name: id, value, required, maxLength, autoComplete, disabled,
    'aria-invalid': Boolean(error),
    'aria-describedby': [describedBy, hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined,
    className: `form-input${error ? ' input-error' : ''}`,
  };
  return <div className="field">
    <label htmlFor={id} className={required ? 'required-label' : undefined}>{label}</label>
    {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
    {multiline ? <textarea {...props} rows={6} onChange={event => onChange(event.target.value)} /> : <input {...props} type={type} onChange={event => onChange(event.target.value)} />}
    {error && <p id={`${id}-error`} className="field-error">{error}</p>}
  </div>;
}

export function BackLink({ to = '/inquiries', children = 'All inquiries' }: { to?: string; children?: ReactNode }) {
  return <Link className="back-link" to={to}><span aria-hidden="true">←</span> {children}</Link>;
}

export function Breadcrumbs({ current }: { current: string }) {
  return <nav className="breadcrumbs" aria-label="Breadcrumb"><ol>
    <li><Link to="/inquiries">My inquiries</Link></li>
    <li className="breadcrumb-separator" aria-hidden="true">/</li>
    <li><span aria-current="page">{current}</span></li>
  </ol></nav>;
}

export function ChevronRight() {
  return <svg className="chevron-right" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function usePageTitle(title: string) {
  useEffect(() => { document.title = `${title} · Customer Inquiry Manager`; }, [title]);
}

export function DateLabel({ value, full = false }: { value: string; full?: boolean }) {
  return <time dateTime={value}>{new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', ...(full ? { hour: 'numeric', minute: '2-digit' } as const : {}) }).format(new Date(value))}</time>;
}
