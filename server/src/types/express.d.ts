import 'express-session';

declare module 'express-session' {
  interface SessionData {
    staffId: string;
    authenticatedAt: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      staff?: { id: string; email: string };
    }
  }
}
