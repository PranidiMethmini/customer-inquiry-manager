import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { App } from '../App';

const staff = { id: 'staff-fixture', email: 'staff@example.test' };
const id = '74830630-64d7-42f4-b5b8-474fb53b82d6';
const inquiry = { id, customerName: 'Ada Customer', email: 'ada@example.test', phone: null,
  subject: 'Router issue', description: 'The router drops its connection.\nPlease investigate.', status: 'NEW',
  createdAt: '2026-10-22T05:00:00.000Z', updatedAt: '2026-10-22T05:00:00.000Z' };
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const failure = (code: string, status: number) => json({ error: { code, message: 'Safe API error' } }, status);
function mount(path = '/inquiries/new') { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
function writes(method = 'POST', path = '/api/inquiries') {
  return fetchMock.mock.calls.filter(([url, init]) => String(url) === path && init?.method === method);
}
async function fillCreateForm() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Customer name'), 'Ada Customer');
  await user.type(screen.getByLabelText(/Email address/), 'ada@example.test');
  await user.type(screen.getByLabelText('Subject'), 'Router issue');
  await user.type(screen.getByLabelText('Description'), 'The router drops its connection.');
  return user;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async url => {
    if (String(url) === '/api/auth/me') return json({ staff });
    if (String(url).startsWith('/api/inquiries?')) return json({ inquiries: [] });
    return json({ inquiry });
  });
  vi.stubGlobal('fetch', fetchMock);
});

test('failed creation preserves input and the submission key, then allows a successful retry', async () => {
  let saves = 0;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === '/api/auth/me') return json({ staff });
    if (String(url) === '/api/inquiries' && init?.method === 'POST') {
      saves++;
      if (saves === 1) throw new TypeError('Network unavailable');
      return json({ inquiry }, 201);
    }
    return json({ inquiry });
  });
  mount();
  const user = await fillCreateForm();
  await user.click(screen.getByRole('button', { name: 'Save inquiry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your details are still here');
  expect(screen.getByLabelText('Customer name')).toHaveValue('Ada Customer');
  expect(screen.getByLabelText(/Email address/)).toHaveValue('ada@example.test');
  expect(screen.getByLabelText('Subject')).toHaveValue('Router issue');
  expect(screen.getByLabelText('Description')).toHaveValue('The router drops its connection.');
  await user.click(screen.getByRole('button', { name: 'Save inquiry' }));
  expect(await screen.findByRole('heading', { name: 'Router issue' })).toBeInTheDocument();
  const requests = writes();
  expect(requests).toHaveLength(2);
  expect(JSON.parse(requests[0][1]!.body as string).submissionKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(requests[0][1]!.body).toBe(requests[1][1]!.body);
});

test('pending creation disables submission and guards even repeated form submit events', async () => {
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { complete = resolve; });
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === '/api/auth/me') return json({ staff });
    if (String(url) === '/api/inquiries' && init?.method === 'POST') return pending;
    return json({ inquiry });
  });
  mount();
  const user = await fillCreateForm();
  const form = screen.getByRole('button', { name: 'Save inquiry' }).closest('form')!;
  await user.dblClick(screen.getByRole('button', { name: 'Save inquiry' }));
  expect(screen.getByRole('button', { name: 'Saving inquiry…' })).toBeDisabled();
  fireEvent.submit(form);
  expect(writes()).toHaveLength(1);
  await act(async () => { complete(json({ inquiry }, 201)); });
  expect(await screen.findByRole('heading', { name: 'Router issue' })).toBeInTheDocument();
});

test('a stale status conflict refetches the current record and requires a fresh action', async () => {
  let reads = 0;
  let patches = 0;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === '/api/auth/me') return json({ staff });
    if (init?.method === 'PATCH') {
      patches++;
      return patches === 1 ? failure('STALE_STATUS', 409) : json({ inquiry: { ...inquiry, status: 'IN_PROGRESS' } });
    }
    reads++;
    return json({ inquiry: reads === 1 ? inquiry : { ...inquiry, status: 'RESOLVED', subject: 'Updated router issue' } });
  });
  mount(`/inquiries/${id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Start working' }));
  expect(await screen.findByText(/This inquiry changed\. The latest version is shown/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Updated router issue' })).toBeInTheDocument();
  expect(screen.getByText('Resolved', { selector: '.status-badge' })).toBeInTheDocument();
  const requests = writes('PATCH', `/api/inquiries/${id}/status`);
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0][1]!.body as string)).toEqual({ expectedStatus: 'NEW', status: 'IN_PROGRESS' });
  await user.click(screen.getByRole('button', { name: 'Reopen inquiry' }));
  await waitFor(() => expect(writes('PATCH', `/api/inquiries/${id}/status`)).toHaveLength(2));
  expect(JSON.parse(writes('PATCH', `/api/inquiries/${id}/status`)[1][1]!.body as string)).toEqual({ expectedStatus: 'RESOLVED', status: 'IN_PROGRESS' });
});

test('a failed conflict refetch blocks further status changes until Refresh succeeds', async () => {
  let reads = 0;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === '/api/auth/me') return json({ staff });
    if (init?.method === 'PATCH') return failure('STALE_STATUS', 409);
    reads++;
    if (reads === 2) throw new TypeError('Disconnected');
    return json({ inquiry: reads > 2 ? { ...inquiry, status: 'RESOLVED' } : inquiry });
  });
  mount(`/inquiries/${id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Start working' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh to continue');
  expect(screen.getByRole('button', { name: 'Start working' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('button', { name: 'Reopen inquiry' })).toBeEnabled();
  expect(writes('PATCH', `/api/inquiries/${id}/status`)).toHaveLength(1);
});

test('session restoration waits before rendering sign-in or protected content', async () => {
  let restore!: (response: Response) => void;
  fetchMock.mockImplementation(() => new Promise(resolve => { restore = resolve; }));
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Customer name')).not.toBeInTheDocument();
  await act(async () => { restore(failure('UNAUTHENTICATED', 401)); });
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
});

test('session restoration network failure shows feedback and allows a successful retry', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'));
  mount();
  const user = userEvent.setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('Please check your connection.');
  expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Customer name')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByLabelText('Customer name')).toBeInTheDocument();
  expect(screen.getByText(staff.email)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/auth/me')).toHaveLength(2);
});

test('logout failure shows feedback, retains the session and allows a successful retry', async () => {
  let attempts = 0;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === '/api/auth/me') return json({ staff });
    if (String(url) === '/api/auth/logout' && init?.method === 'POST') {
      attempts++;
      return attempts === 1 ? failure('INTERNAL_ERROR', 500) : new Response(null, { status: 204 });
    }
    return json({ inquiries: [] });
  });
  mount('/inquiries');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
  expect(screen.getByText(staff.email)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'My inquiries' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  expect(writes('POST', '/api/auth/logout')).toHaveLength(1);

  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  expect(screen.queryByText(staff.email)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(writes('POST', '/api/auth/logout')).toHaveLength(2);
});

test('session expiry on a protected request returns to sign-in with clear feedback', async () => {
  fetchMock.mockImplementation(async url => String(url) === '/api/auth/me' ? json({ staff }) : failure('UNAUTHENTICATED', 401));
  mount('/inquiries');
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  expect(screen.getByText('Your session expired. Please sign in again.')).toBeInTheDocument();
});

test('frontend validation requires a contact method before making a create request', async () => {
  mount();
  const user = await fillCreateForm();
  await user.clear(screen.getByLabelText(/Email address/));
  await user.click(screen.getByRole('button', { name: 'Save inquiry' }));
  expect(await screen.findByText('Enter an email address or phone number.')).toBeInTheDocument();
  expect(screen.getByLabelText(/Email address/)).toHaveAttribute('aria-invalid', 'true');
  expect(writes()).toHaveLength(0);
});

test('a save completing after Cancel does not redirect away from the list', async () => {
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { complete = resolve; });
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === '/api/auth/me') return json({ staff });
    if (init?.method === 'POST') return pending;
    return json({ inquiries: [] });
  });
  mount();
  const user = await fillCreateForm();
  await user.click(screen.getByRole('button', { name: 'Save inquiry' }));
  await user.click(screen.getByRole('link', { name: 'Cancel' }));
  expect(await screen.findByRole('heading', { name: 'My inquiries' })).toBeInTheDocument();
  await act(async () => { complete(json({ inquiry }, 201)); });
  expect(screen.getByRole('heading', { name: 'My inquiries' })).toBeInTheDocument();
});

test('an old request returning 401 cannot expire a newly signed-in session', async () => {
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { complete = resolve; });
  const nextStaff = { ...staff, email: 'next@example.test' };
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === '/api/auth/me') return json({ staff });
    if (String(url) === '/api/auth/logout') return new Response(null, { status: 204 });
    if (String(url) === '/api/auth/login') return json({ staff: nextStaff });
    if (init?.method === 'POST') return pending;
    return json({ inquiries: [] });
  });
  mount();
  const user = await fillCreateForm();
  await user.click(screen.getByRole('button', { name: 'Save inquiry' }));
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  await user.type(await screen.findByLabelText('Email address'), nextStaff.email);
  await user.type(screen.getByLabelText('Password'), 'fixture-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText(nextStaff.email)).toBeInTheDocument();
  await act(async () => { complete(failure('UNAUTHENTICATED', 401)); });
  expect(screen.getByText(nextStaff.email)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'My inquiries' })).toBeInTheDocument();
});
