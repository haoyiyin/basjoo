/**
 * Unit tests for AuthContext JWT parsing and token expiry logic.
 *
 * Run with: vitest run tests/unit/auth-context.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Polyfill atob/btoa and window for Node.js test environment
if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (str: string) => Buffer.from(str, 'base64').toString('binary');
}
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}

/** All expected JWT claims plus room for extras from the backend. */
interface JwtPayload {
  exp?: number;
  sub?: string;
  [key: string]: unknown;
}

/** Mirrors the AuthContext implementation. Keep in sync. */
function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(window.atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const payload = parseJwtPayload(token);
  if (!payload?.exp) {
    return false;
  }
  return payload.exp * 1000 <= Date.now();
}

describe('JWT Payload Parsing', () => {
  it('parses valid JWT payload', () => {
    const payload = { sub: '1', exp: 9999999999 };
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    const token = `${header}.${body}.signature`;

    const result = parseJwtPayload(token);
    expect(result).not.toBeNull();
    expect(result!.sub).toBe('1');
    expect(result!.exp).toBe(9999999999);
  });

  it('handles urlsafe base64 encoding', () => {
    // URL-safe base64 uses - and _ instead of + and /
    const payload = { exp: 9999999999 };
    const raw = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
    const token = `header.${raw}.sig`;

    const result = parseJwtPayload(token);
    expect(result).not.toBeNull();
    expect(result!.exp).toBe(9999999999);
  });

  it('returns null for malformed token', () => {
    expect(parseJwtPayload('')).toBeNull();
    expect(parseJwtPayload('not.a.token')).toBeNull();
    expect(parseJwtPayload('onlyonepart')).toBeNull();
  });

  it('returns null for invalid JSON in payload', () => {
    const header = btoa(JSON.stringify({}));
    const body = btoa('not-json');
    const token = `${header}.${body}.sig`;

    expect(parseJwtPayload(token)).toBeNull();
  });
});

describe('Token Expiry Detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for token without exp', () => {
    const payload = { sub: '1' };
    const header = btoa(JSON.stringify({}));
    const body = btoa(JSON.stringify(payload));
    const token = `${header}.${body}.sig`;

    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns false for non-expired token', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const payload = { sub: '1', exp: futureExp };
    const header = btoa(JSON.stringify({}));
    const body = btoa(JSON.stringify(payload));
    const token = `${header}.${body}.sig`;

    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for expired token', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
    const payload = { sub: '1', exp: pastExp };
    const header = btoa(JSON.stringify({}));
    const body = btoa(JSON.stringify(payload));
    const token = `${header}.${body}.sig`;

    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true for token expiring exactly now', () => {
    const nowExp = Math.floor(Date.now() / 1000);
    const payload = { sub: '1', exp: nowExp };
    const header = btoa(JSON.stringify({}));
    const body = btoa(JSON.stringify(payload));
    const token = `${header}.${body}.sig`;

    // exp * 1000 <= Date.now() means "expired at or before now"
    expect(isTokenExpired(token)).toBe(true);
  });
});
