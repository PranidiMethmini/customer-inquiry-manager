import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import type { InquirySummary } from '../lib/types';
import { ChevronRight, DateLabel, Loading, Notice, StatusBadge, usePageTitle } from '../components/ui';

export function InquiryList() {
  usePageTitle('My inquiries');
  const { api } = useAuth();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const [rows, setRows] = useState<InquirySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    const timer = setTimeout(() => {
      api<{ inquiries: InquirySummary[] }>(`/inquiries?search=${encodeURIComponent(search.trim())}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setRows(result.inquiries); })
        .catch(() => { if (!controller.signal.aborted) setError(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, search, refresh]);
  function updateSearch(value: string) { setParams(value ? { search: value } : {}, { replace: true }); }
  return <>
    <div className="page-heading"><h1>My inquiries</h1><Link className="btn btn-primary" to="/inquiries/new"><span aria-hidden="true">＋</span> New inquiry</Link></div>
    <section className="panel list-panel" aria-label="Your inquiries">
      <div className="list-toolbar"><div className="search-field"><label htmlFor="search">Search inquiries</label><input id="search" className="form-input search-input" type="search" placeholder="Customer name or subject" maxLength={200} value={search} onChange={event => updateSearch(event.target.value)} /></div><button className="btn btn-secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
      {loading ? <Loading>Loading your inquiries…</Loading> : error ? <div className="list-feedback"><Notice>We couldn’t load your inquiries. Check your connection and try again.<button className="btn btn-secondary" onClick={() => setRefresh(value => value + 1)}>Try again</button></Notice></div> : rows.length === 0 ? <div className="empty-state" role="status"><span className="empty-mark" aria-hidden="true">—</span><h2>{search.trim() ? 'No matching inquiries' : 'A clear space to start'}</h2><p>{search.trim() ? 'Try another customer name or subject.' : 'Create your first inquiry to keep the details in one place.'}</p>{search.trim() ? <button className="btn btn-secondary" onClick={() => updateSearch('')}>Clear search</button> : <Link className="btn btn-primary" to="/inquiries/new">Create an inquiry</Link>}</div> : <>
        <div className="desktop-inquiries"><table><caption className="sr-only">Your inquiries, newest first</caption><thead><tr><th scope="col">Customer</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col"><span className="sr-only">Open inquiry</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td className="customer-cell">{row.customerName}</td><td><Link className="subject-link" to={`/inquiries/${row.id}`}>{row.subject}</Link></td><td><StatusBadge status={row.status} /></td><td className="date-cell"><DateLabel value={row.createdAt} /></td><td><Link className="open-link" to={`/inquiries/${row.id}`} aria-label={`Open inquiry: ${row.subject}`}><ChevronRight /></Link></td></tr>)}</tbody></table></div>
        <ul className="mobile-inquiries">{rows.map(row => <li key={row.id}><div className="card-topline"><span className="customer-cell">{row.customerName}</span><StatusBadge status={row.status} /></div><Link className="subject-link" to={`/inquiries/${row.id}`}>{row.subject}</Link><div className="card-date">Created <DateLabel value={row.createdAt} /></div></li>)}</ul>
      </>}
      <div className="list-footnote">Only inquiries you created appear here.</div>
    </section>
  </>;
}
