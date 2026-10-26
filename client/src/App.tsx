import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { BackLink, Brand, Loading, Notice } from './components/ui';
import { SignIn } from './pages/SignIn';
import { InquiryList } from './pages/InquiryList';
import { CreateInquiry } from './pages/CreateInquiry';
import { InquiryDetailRoute } from './pages/InquiryDetail';

function Protected() {
  return useAuth().staff ? <Outlet /> : <Navigate to="/sign-in" replace />;
}

function AppRoutes() {
  const { state, restore } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => { document.getElementById('main-content')?.focus(); }, [pathname, state]);
  if (state !== 'ready') return <main className="session-check"><Brand />{state === 'checking' ? <Loading>Checking your session…</Loading> : <Notice>We couldn’t check your session. Please check your connection.<button className="btn btn-secondary" onClick={restore}>Try again</button></Notice>}</main>;
  return <Routes>
    <Route path="/sign-in" element={<SignIn />} />
    <Route element={<Protected />}><Route element={<AppShell />}>
      <Route path="/inquiries" element={<InquiryList />} />
      <Route path="/inquiries/new" element={<CreateInquiry />} />
      <Route path="/inquiries/:id" element={<InquiryDetailRoute />} />
    </Route></Route>
    <Route path="/" element={<Navigate to="/inquiries" replace />} />
    <Route path="*" element={<main id="main-content" className="workspace page-container" tabIndex={-1}><h1>Page unavailable</h1><p className="page-description">We couldn’t find that page.</p><BackLink /></main>} />
  </Routes>;
}

export function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
