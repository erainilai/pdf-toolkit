import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

/* ---------------- Cookies ---------------- */

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const secureCookies = () => process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

export function setCookie(res, name, value, { maxAgeDays, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (secureCookies()) parts.push('Secure');
  if (maxAgeDays !== undefined) parts.push(`Max-Age=${Math.round(maxAgeDays * 86400)}`);
  res.append('Set-Cookie', parts.join('; '));
}

export const clearCookie = (res, name) => setCookie(res, name, '', { maxAgeDays: 0 });

/* ---------------- Passwords ---------------- */

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, saltB64, keyB64] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: R, p: P });
  return timingSafeEqual(key, expected);
}

/* ---------------- Region ---------------- */

/** Best-effort country of the visitor, used only to pre-select the currency on the pricing
 *  page (the user can switch). CDNs/load balancers add a country header; configure which one
 *  with COUNTRY_HEADER (e.g. cf-ipcountry on Cloudflare, cloudfront-viewer-country on AWS). */
export function visitorCountry(req) {
  const header = (process.env.COUNTRY_HEADER || 'cf-ipcountry').toLowerCase();
  const fromCdn = req.headers[header] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'];
  if (fromCdn && /^[A-Z]{2}$/i.test(fromCdn)) return String(fromCdn).toUpperCase();
  return null;
}

export const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '')) && String(e).length <= 254;
