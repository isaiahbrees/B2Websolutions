import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SESSION_DAYS = 7;

const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn(
    '[reelworks] SESSION_SECRET not set — using a random secret, logins reset on every restart.',
  );
}

function credentials(): { email: string; password: string } {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env to enable the web app login.');
  }
  return { email, password };
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const sign = (payload: string) =>
  b64url(crypto.createHmac('sha256', secret).update(payload).digest());

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function createSessionToken(email: string): string {
  const payload = b64url(
    Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 86_400_000 })),
  );
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): { email: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.email !== 'string' || Date.now() > data.exp) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionFromRequest(req: Request): { email: string } | null {
  return verifySessionToken(parseCookies(req.headers.cookie).session);
}

// Small in-memory brute-force guard: 20 attempts per IP per 15 minutes.
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkLogin(req: Request, email: string, password: string): boolean {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && now < entry.resetAt && entry.count >= 20) {
    throw new Error('Too many login attempts — try again in a few minutes.');
  }
  if (!entry || now >= entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
  } else {
    entry.count += 1;
  }

  const creds = credentials();
  const ok = safeEqual(email.toLowerCase(), creds.email.toLowerCase()) && safeEqual(password, creds.password);
  if (ok) attempts.delete(ip);
  return ok;
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

/** Protects /api/* — everything except login. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = sessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  (req as Request & { user: { email: string } }).user = session;
  next();
}
