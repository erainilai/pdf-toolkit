import { getJSON } from './api.js';

/** Shared app state: public config (brand, plans, prices) and the current visitor (/api/me). */
export const state = { config: null, me: null, currency: null };
const listeners = new Set();

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn(state));

export async function loadConfig() {
  state.config = await getJSON('/api/config');
  const saved = safeGet('currency');
  const tzIndia = Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Calcutta' || Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Kolkata';
  const available = Object.keys(state.config.currencies || {});
  const guess = saved || state.config.suggestedCurrency || (tzIndia ? 'INR' : 'USD');
  state.currency = available.includes(guess) ? guess : (available[0] || guess);
  return state.config;
}

export async function refreshMe() {
  try { state.me = await getJSON('/api/me'); } catch { state.me = null; }
  emit();
  return state.me;
}

export function setCurrency(c) {
  state.currency = c;
  safeSet('currency', c);
  emit();
}

export function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
export function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

/** Formats a price in minor units, e.g. 19900 INR → "₹199", 699 USD → "$6.99". */
export function money(minor, currency) {
  const n = minor / 100;
  const opts = Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, ...opts }).format(n);
}

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
