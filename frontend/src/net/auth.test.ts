import { describe, it, expect } from 'vitest';
import { HttpError } from './http';
import { isUnauthorized, signInHref } from './auth';

describe('HttpError', () => {
  it('carries the status code and a descriptive message', () => {
    const err = new HttpError('save', 401);
    expect(err.status).toBe(401);
    expect(err.message).toContain('save');
    expect(err.message).toContain('401');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('isUnauthorized', () => {
  it('is true only for a 401-bearing error', () => {
    expect(isUnauthorized(new HttpError('load', 401))).toBe(true);
    expect(isUnauthorized(new HttpError('load', 404))).toBe(false);
    expect(isUnauthorized(new HttpError('save', 503))).toBe(false);
    expect(isUnauthorized(new Error('boom'))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
    expect(isUnauthorized('401')).toBe(false);
  });
});

describe('signInHref', () => {
  it('encodes the returnTo path so the backend can round-trip it', () => {
    expect(signInHref('/edit')).toBe('/api/auth/sign-in?returnTo=%2Fedit');
    expect(signInHref('/design/main-menu?x=1')).toBe('/api/auth/sign-in?returnTo=%2Fdesign%2Fmain-menu%3Fx%3D1');
  });
});
