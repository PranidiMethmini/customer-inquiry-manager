import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiRequest } from '../lib/api';
import type { Staff } from '../lib/types';

interface AuthState {
  staff: Staff | null;
  state: 'checking' | 'ready' | 'error';
  message: string;
  restore: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  api: typeof apiRequest;
}
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [state, setState] = useState<AuthState['state']>('checking');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const sessionGeneration = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    setState('checking');
    apiRequest<{ staff: Staff }>('/auth/me', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setStaff(result.staff); setState('ready'); } })
      .catch(error => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) { setStaff(null); setState('ready'); }
        else setState('error');
      });
    return () => controller.abort();
  }, [attempt]);

  const api = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const generation = sessionGeneration.current;
    try { return await apiRequest<T>(path, options); }
    catch (error) {
      if (generation === sessionGeneration.current && !options.signal?.aborted && error instanceof ApiError && error.status === 401) {
        setStaff(null);
        setMessage('Your session expired. Please sign in again.');
      }
      throw error;
    }
  }, []);
  async function login(email: string, password: string) {
    const result = await apiRequest<{ staff: Staff }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    sessionGeneration.current++;
    setStaff(result.staff);
    setMessage('');
  }
  async function logout() {
    await api<void>('/auth/logout', { method: 'POST', body: '{}' });
    sessionGeneration.current++;
    setStaff(null);
    setMessage('');
  }
  return <AuthContext.Provider value={{ staff, state, message, restore: () => setAttempt(value => value + 1), login, logout, api }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
