import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import { App } from '../App';

test('late search responses cannot replace the current search results', async () => {
  let finishOld!: (response: Response) => void;
  const oldResponse = new Promise<Response>(resolve => { finishOld = resolve; });
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const row = (id: string, subject: string) => ({ id, subject, customerName: 'Customer', status: 'NEW', createdAt: '2026-10-22T05:00:00Z' });
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async url => {
    if (String(url) === '/api/auth/me') return json({ staff: { id: 'staff', email: 'staff@example.test' } });
    if (String(url).endsWith('search=old')) return oldResponse; // Deliberately ignores the abort signal.
    if (String(url).endsWith('search=new')) return json({ inquiries: [row('new', 'Current result')] });
    return json({ inquiries: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter initialEntries={['/inquiries']}><App /></MemoryRouter>);
  const user = userEvent.setup();
  const search = await screen.findByLabelText('Search inquiries');
  await user.type(search, 'old');
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('search=old'))).toBe(true));
  await user.clear(search);
  await user.type(search, 'new');
  expect((await screen.findAllByRole('link', { name: 'Current result' })).length).toBeGreaterThan(0);
  await act(async () => { finishOld(json({ inquiries: [row('old', 'Outdated result')] })); });
  expect(screen.queryByText('Outdated result')).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Current result' }).length).toBeGreaterThan(0);
});
