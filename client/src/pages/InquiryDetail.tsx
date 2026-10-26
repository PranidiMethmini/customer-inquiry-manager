import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import type { Inquiry, Status } from '../lib/types';
import { Breadcrumbs, DateLabel, Loading, Notice, StatusBadge, usePageTitle } from '../components/ui';

const nextAction: Record<Status, { status: Status; label: string }> = {
  NEW: { status: 'IN_PROGRESS', label: 'Start working' },
  IN_PROGRESS: { status: 'RESOLVED', label: 'Mark as resolved' },
  RESOLVED: { status: 'IN_PROGRESS', label: 'Reopen inquiry' },
};

export function InquiryDetailRoute() {
  const { id = '' } = useParams();
  return <InquiryDetail key={id} id={id} />;
}

export function InquiryDetail({ id }: { id: string }) {
  const { api } = useAuth();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const locked = useRef(false);
  usePageTitle(inquiry?.subject ?? 'Inquiry');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setNotice('');
    api<{ inquiry: Inquiry }>(`/inquiries/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setInquiry(result.inquiry); setUnavailable(false); setNeedsRefresh(false); } })
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && [400, 404].includes(failure.status)) { setUnavailable(true); setInquiry(null); }
        else setError('We couldn’t load this inquiry. Check your connection and try again.');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, id, refresh]);

  async function updateStatus() {
    if (locked.current || !inquiry || needsRefresh || loading) return;
    locked.current = true; setPending(true); setError(''); setNotice('');
    try {
      const result = await api<{ inquiry: Inquiry }>(`/inquiries/${id}/status`, { method: 'PATCH', body: JSON.stringify({ expectedStatus: inquiry.status, status: nextAction[inquiry.status].status }) });
      setInquiry(result.inquiry); setNotice('Status updated.');
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        setNeedsRefresh(true);
        try {
          const current = await api<{ inquiry: Inquiry }>(`/inquiries/${id}`);
          setInquiry(current.inquiry); setNeedsRefresh(false);
          setNotice('This inquiry changed. The latest version is shown. Choose a status action again.');
        } catch (refreshFailure) {
          if (refreshFailure instanceof ApiError && [400, 404].includes(refreshFailure.status)) { setUnavailable(true); setInquiry(null); }
          else setError('This inquiry changed, but we couldn’t load the latest version. Refresh to continue.');
        }
      } else if (failure instanceof ApiError && [400, 404].includes(failure.status)) { setUnavailable(true); setInquiry(null); }
      else setError('We couldn’t confirm the status update. Refresh or try again.');
    } finally { locked.current = false; setPending(false); }
  }

  return <div className="detail-page">
    <Breadcrumbs current="Inquiry details" />
    <div className="detail-heading">
      <div className="detail-title"><h1>{inquiry?.subject ?? (unavailable ? 'Inquiry unavailable' : 'Inquiry details')}</h1></div>
      <div className="detail-actions">
        {inquiry && !unavailable && <button className="btn btn-primary" disabled={pending || loading || needsRefresh} onClick={updateStatus}>{pending ? 'Updating status…' : nextAction[inquiry.status].label}</button>}
        <button className="btn btn-secondary" disabled={loading || pending} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {inquiry && !unavailable && <div className="detail-meta"><StatusBadge status={inquiry.status} /><span>Created <DateLabel value={inquiry.createdAt} full /></span><span>Updated <DateLabel value={inquiry.updatedAt} full /></span></div>}
    </div>
    <div className="detail-feedback">
      {error && <Notice>{error}<button className="btn btn-secondary" disabled={loading || pending} onClick={() => setRefresh(value => value + 1)}>Try again</button></Notice>}
      {notice && <Notice kind="info">{notice}</Notice>}
      <span className="sr-only" role="status">{pending ? 'Updating status. Please wait.' : ''}</span>
    </div>
    {loading && !inquiry ? <Loading>Loading inquiry…</Loading> : unavailable ? <section className="panel empty-state"><p>This inquiry doesn’t exist or isn’t available to your account.</p><Link className="btn btn-secondary" to="/inquiries">My inquiries</Link></section> : inquiry ?
      <div className="panel detail-panel">
        <section className="detail-description" aria-labelledby="description-title"><h2 id="description-title">Description</h2><p className="inquiry-description">{inquiry.description}</p></section>
        <section className="detail-customer" aria-labelledby="customer-title"><h2 id="customer-title">Customer</h2><dl><div><dt>Name</dt><dd>{inquiry.customerName}</dd></div>{inquiry.email && <div><dt>Email address</dt><dd><a href={`mailto:${inquiry.email}`}>{inquiry.email}</a></dd></div>}{inquiry.phone && <div><dt>Phone number</dt><dd><a href={`tel:${inquiry.phone.replace(/[^+0-9]/g, '')}`}>{inquiry.phone}</a></dd></div>}</dl></section>
      </div> : null}
  </div>;
}
