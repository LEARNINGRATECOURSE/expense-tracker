export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
export const money = (n, { sign = false } = {}) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return (v < 0 ? '-' : sign && v > 0 ? '+' : '') + '₹' + inr.format(Math.abs(v));
};
/** Compact form for tight spaces: ₹1.2L, ₹45K */
export const moneyShort = (n) => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e7) return `${s}₹${+(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${s}₹${+(a / 1e5).toFixed(2)}L`;
  if (a >= 1e4) return `${s}₹${+(a / 1e3).toFixed(1)}K`;
  return money(n);
};

export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => iso(new Date());
export const parseISO = (s) => new Date(s + 'T00:00:00');
export const ym = (s) => s.slice(0, 7);
export const monthLabel = (k) => parseISO(k + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
export const monthShort = (k) => parseISO(k + '-01').toLocaleDateString('en-IN', { month: 'short' });
export const shiftMonth = (k, n) => {
  const [y, m] = k.split('-').map(Number);
  return iso(new Date(y, m - 1 + n, 1)).slice(0, 7);
};
export const daysInMonth = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const fmtDate = (s) => parseISO(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const dayLabel = (s) => {
  const t = todayISO();
  if (s === t) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === iso(y)) return 'Yesterday';
  return parseISO(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);

export const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
