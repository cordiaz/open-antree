import type { CookieOptions, Request } from 'express';

export const SESSION_COOKIE = 'antree_session';

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.cookie;
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      return decodeURIComponent(value.join('='));
    }
  }
  return null;
}

export function sessionCookieOptions(
  secure: boolean,
  maxAgeSeconds: number,
): CookieOptions {
  return {
    httpOnly: true,
    // Lax: not sent on cross-site POSTs, which covers CSRF for the JSON API.
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}
