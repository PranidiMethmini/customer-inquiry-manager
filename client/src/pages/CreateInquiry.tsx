import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import type { Inquiry } from '../lib/types';
import { fieldErrors, inquiryFormSchema } from '../lib/validation';
import { Breadcrumbs, Field, Notice, StatusBadge, usePageTitle } from '../components/ui';

export function CreateInquiry() {
  usePageTitle('New inquiry');
  const { api } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ customerName: '', email: '', phone: '', subject: '', description: '' });
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const change = (name: keyof typeof values) => (value: string) => setValues(previous => ({ ...previous, [name]: value }));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    setError('');
    const parsed = inquiryFormSchema.safeParse(values);
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); setTimeout(() => document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(), 0); return; }
    locked.current = true; setPending(true); setErrors({});
    try {
      const result = await api<{ inquiry: Inquiry }>('/inquiries', { method: 'POST', body: JSON.stringify({ ...parsed.data, submissionKey }) });
      if (active.current) navigate(`/inquiries/${result.inquiry.id}`, { replace: true });
    } catch (failure) {
      if (!active.current) return;
      if (failure instanceof ApiError && failure.status === 400) { setErrors(failure.fields); setError('Check the highlighted details and try again.'); }
      else if (failure instanceof ApiError && failure.code === 'SUBMISSION_KEY_CONFLICT') setError('This attempt was already saved with different details. Return to your inquiries to check the saved record.');
      else setError('We couldn’t confirm the save. Your details are still here. Please try again.');
    } finally { locked.current = false; if (active.current) setPending(false); }
  }
  return <div className="form-page">
    <Breadcrumbs current="New inquiry" /><div className="page-heading form-heading"><h1>New inquiry</h1><p className="field-hint">Fields marked * are required.</p></div>
    <form className="panel inquiry-form" noValidate onSubmit={submit} aria-busy={pending}>
      <div className="form-section"><div className="section-heading"><h2>Customer details</h2></div>
        <div className="form-fields"><Field id="customerName" label="Customer name" required value={values.customerName} onChange={change('customerName')} maxLength={120} autoComplete="name" error={errors.customerName} disabled={pending} />
          <fieldset className="contact-group"><legend className="sr-only">Customer contact</legend><p id="contact-hint" className="field-hint">Provide at least one: email or phone.</p><div className="form-grid"><Field id="email" label="Email address" type="email" value={values.email} onChange={change('email')} maxLength={254} autoComplete="email" describedBy="contact-hint" error={errors.email} disabled={pending} /><Field id="phone" label="Phone number" type="tel" value={values.phone} onChange={change('phone')} maxLength={40} autoComplete="tel" describedBy="contact-hint" error={errors.phone} disabled={pending} /></div></fieldset>
        </div>
      </div>
      <div className="form-section"><div className="section-heading"><h2>Inquiry details</h2></div>
        <div className="form-fields"><Field id="subject" label="Subject" required value={values.subject} onChange={change('subject')} maxLength={200} error={errors.subject} disabled={pending} /><Field id="description" label="Description" required multiline value={values.description} onChange={change('description')} maxLength={5000} hint="Up to 5,000 characters." error={errors.description} disabled={pending} /></div>
      </div>
      {error && <div className="form-notice"><Notice>{error}</Notice></div>}
      <div className="form-actions"><div className="initial-status">Starts as <StatusBadge status="NEW" /></div><div className="action-group"><Link className="btn btn-quiet" to="/inquiries">Cancel</Link><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Saving inquiry…' : 'Save inquiry'}</button></div></div>
      <span className="sr-only" role="status">{pending ? 'Saving your inquiry. Please wait.' : ''}</span>
    </form>
  </div>;
}
