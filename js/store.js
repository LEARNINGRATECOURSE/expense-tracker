import { uid, todayISO, ym, iso, parseISO, daysInMonth, setStorageBad } from './util.js';

const KEY = 'kharcha.v1';

export const ACCOUNT_TYPES = {
  cash: { label: 'Cash', icon: '💵', liability: false },
  bank: { label: 'Bank account', icon: '🏦', liability: false },
  upi: { label: 'UPI / Wallet', icon: '📱', liability: false },
  card: { label: 'Credit card', icon: '💳', liability: true },
  loan: { label: 'Loan', icon: '🧾', liability: true },
};
export const TX_TYPES = { expense: 'Expense', income: 'Income', transfer: 'Transfer', refund: 'Refund' };

const cat = (id, name, icon, kind, essential = false, kw = []) => ({ id, name, icon, kind, essential, kw });
const DEFAULT_CATEGORIES = [
  cat('groceries', 'Groceries', '🛒', 'expense', true, ['grocery', 'vegetable', 'milk', 'fruit', 'bigbasket', 'blinkit', 'zepto']),
  cat('dining', 'Dining', '🍽️', 'expense', false, ['food', 'lunch', 'dinner', 'breakfast', 'swiggy', 'zomato', 'restaurant', 'coffee', 'tea', 'snack']),
  cat('transport', 'Transport', '🚗', 'expense', true, ['petrol', 'diesel', 'fuel', 'uber', 'ola', 'cab', 'auto', 'metro', 'bus', 'train', 'parking', 'toll']),
  cat('home', 'Rent & Home', '🏠', 'expense', true, ['rent', 'maid', 'repair', 'furniture', 'maintenance']),
  cat('bills', 'Bills & Utilities', '💡', 'expense', true, ['electricity', 'water', 'gas', 'wifi', 'internet', 'recharge', 'mobile', 'bill']),
  cat('emi', 'EMI & Loans', '🏦', 'expense', true, ['emi', 'loan', 'interest']),
  cat('insurance', 'Insurance', '🛡️', 'expense', true, ['insurance', 'premium', 'lic']),
  cat('health', 'Health', '💊', 'expense', true, ['doctor', 'medicine', 'pharmacy', 'hospital', 'gym', 'medical']),
  cat('shopping', 'Shopping', '🛍️', 'expense', false, ['amazon', 'flipkart', 'myntra', 'clothes', 'shoes', 'shopping']),
  cat('entertainment', 'Entertainment', '🎬', 'expense', false, ['movie', 'cinema', 'game', 'concert', 'show']),
  cat('subs', 'Subscriptions', '📺', 'expense', false, ['netflix', 'spotify', 'prime', 'hotstar', 'subscription', 'youtube']),
  cat('travel', 'Travel', '✈️', 'expense', false, ['flight', 'hotel', 'trip', 'vacation', 'holiday']),
  cat('education', 'Education', '📚', 'expense', true, ['school', 'tuition', 'course', 'books', 'fees']),
  cat('other', 'Other', '🧾', 'expense', false),
  cat('salary', 'Salary', '💼', 'income', false, ['salary', 'payroll']),
  cat('business', 'Business', '🏪', 'income', false, ['business', 'client', 'freelance', 'invoice']),
  cat('interest', 'Interest & Returns', '📈', 'income', false, ['dividend', 'returns']),
  cat('gift', 'Gift', '🎁', 'income', false, ['gift']),
  cat('otherin', 'Other income', '💰', 'income', false),
];

const fresh = () => ({
  v: 1,
  accounts: [
    { id: uid(), name: 'Cash', type: 'cash', opening: 0 },
    { id: uid(), name: 'Bank account', type: 'bank', opening: 0 },
  ],
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  transactions: [],
  budgets: { overall: 0, cats: {} },
  recurring: [],
  settings: { lock: null },
});

let state;
const subs = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('load failed', e); }
  return fresh();
}
const migrate = sanitize;

/* ---------- validation: everything read from storage or a backup file passes through here ---------- */
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && s >= '2000-01-01';
const safeId = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null);
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');
const money2 = (v) => { const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const MAX_AMOUNT = 1e10;
/** One grapheme, no markup characters. */
export function cleanIcon(v, fallback = '🏷️') {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) return fallback;
  const g = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter().segment(t)][0].segment : [...t][0];
  return /[<>&"'`]/.test(g) ? fallback : g;
}

export function sanitize(raw) {
  const base = fresh();
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const seen = new Set();
  const uniq = (id) => { if (!id || seen.has(id)) return null; seen.add(id); return id; };

  let accounts = arr(o.accounts).map((a) => {
    const id = uniq(safeId(a?.id));
    if (!id || !ACCOUNT_TYPES[a.type]) return null;
    const opening = money2(a.opening), limit = money2(a.limit);
    return { id, name: text(a.name, 32) || 'Account', type: a.type, opening: Number.isFinite(opening) ? opening : 0, limit: a.type === 'card' && limit > 0 ? limit : 0 };
  }).filter(Boolean);
  if (!accounts.length) accounts = base.accounts;
  const accIds = new Set(accounts.map((a) => a.id));

  seen.clear();
  let categories = arr(o.categories).map((c) => {
    const id = uniq(safeId(c?.id));
    if (!id || (c.kind !== 'expense' && c.kind !== 'income')) return null;
    return { id, name: text(c.name, 24) || 'Category', icon: cleanIcon(c.icon), kind: c.kind, essential: c.kind === 'expense' && !!c.essential, kw: arr(c.kw).filter((k) => typeof k === 'string' && /^[\w ]{1,20}$/.test(k)).slice(0, 20) };
  }).filter(Boolean);
  for (const d of DEFAULT_CATEGORIES) if ((d.id === 'other' || d.id === 'otherin') && !categories.some((c) => c.id === d.id)) categories.push({ ...d });
  if (!categories.length) categories = base.categories;
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const fallbackCat = (type) => (type === 'income' ? 'otherin' : 'other');

  seen.clear();
  const transactions = arr(o.transactions).map((t) => {
    const id = uniq(safeId(t?.id));
    const amount = money2(t?.amount);
    if (!id || !TX_TYPES[t.type] || !(amount >= 0.01 && amount <= MAX_AMOUNT) || !isDate(t.date) || !accIds.has(t.accountId)) return null;
    const tx = { id, type: t.type, amount, date: t.date, accountId: t.accountId, note: text(t.note, 80), createdAt: Number.isFinite(+t.createdAt) ? +t.createdAt : 0 };
    if (t.type === 'transfer') {
      if (!accIds.has(t.toAccountId) || t.toAccountId === t.accountId) return null;
      tx.toAccountId = t.toAccountId; tx.categoryId = null;
    } else {
      const want = t.type === 'income' ? 'income' : 'expense';
      tx.categoryId = catById[t.categoryId]?.kind === want ? t.categoryId : fallbackCat(t.type);
      tx.toAccountId = null;
    }
    if (safeId(t.recurringId)) tx.recurringId = t.recurringId;
    return tx;
  }).filter(Boolean);

  const budgets = { overall: 0, cats: {} };
  const ov = money2(o.budgets?.overall);
  if (ov > 0 && ov <= MAX_AMOUNT) budgets.overall = ov;
  for (const [id, v] of Object.entries(o.budgets?.cats && typeof o.budgets.cats === 'object' ? o.budgets.cats : {})) {
    const n = money2(v);
    if (catById[id]?.kind === 'expense' && n > 0 && n <= MAX_AMOUNT) budgets.cats[id] = n;
  }

  seen.clear();
  const recurring = arr(o.recurring).map((r) => {
    const id = uniq(safeId(r?.id));
    const amount = money2(r?.amount), day = Math.trunc(Number(r?.day));
    if (!id || (r.type !== 'expense' && r.type !== 'income') || !(amount >= 0.01 && amount <= MAX_AMOUNT) || !(day >= 1 && day <= 31) || !accIds.has(r.accountId)) return null;
    const want = r.type === 'income' ? 'income' : 'expense';
    return {
      id, name: text(r.name, 40) || 'Recurring', type: r.type, amount, day, accountId: r.accountId,
      toAccountId: accIds.has(r.toAccountId) && r.toAccountId !== r.accountId ? r.toAccountId : null,
      categoryId: catById[r.categoryId]?.kind === want ? r.categoryId : fallbackCat(r.type),
      nextDue: isDate(r.nextDue) ? r.nextDue : firstDue(day), active: r.active !== false,
    };
  }).filter(Boolean);

  const lock = o.settings?.lock;
  const settings = {
    lock: lock && typeof lock.salt === 'string' && typeof lock.hash === 'string' && /^[0-9a-f]{64}$/.test(lock.hash) ? { salt: lock.salt.slice(0, 64), hash: lock.hash } : null,
    lastAcc: accIds.has(o.settings?.lastAcc) ? o.settings.lastAcc : null,
    lastBackup: isDate(o.settings?.lastBackup) ? o.settings.lastBackup : null,
  };
  return { v: 1, accounts, categories, transactions, budgets, recurring, settings };
}

let saveFailed = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); saveFailed = false; }
  catch (e) { saveFailed = true; console.warn('save failed', e); }
  setStorageBad(saveFailed);
}

state = load();
export const didSaveFail = () => saveFailed;

export const get = () => state;
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function commit(mutator) { mutator(state); save(); subs.forEach((f) => f()); }
export function replaceAll(next) { state = sanitize(next); save(); subs.forEach((f) => f()); }
export function resetAll() { state = fresh(); save(); subs.forEach((f) => f()); }

/* ---------- lookups ---------- */
export const acct = (id) => state.accounts.find((a) => a.id === id);
export const category = (id) => state.categories.find((c) => c.id === id);
export const isLiability = (a) => ACCOUNT_TYPES[a.type]?.liability;

/* ---------- accounting ----------
   income / refund  -> +amount on account
   expense          -> -amount on account
   transfer         -> -amount on source, +amount on destination (never income/expense)
   Liabilities (cards, loans) hold a negative balance = amount owed. Paying a card or
   an EMI is a transfer from a bank account to that liability. */
export function balance(a) {
  let b = Number(a.opening) || 0;
  for (const t of state.transactions) {
    if (t.accountId === a.id) b += t.type === 'income' || t.type === 'refund' ? t.amount : -t.amount;
    if (t.type === 'transfer' && t.toAccountId === a.id) b += t.amount;
  }
  return Math.round(b * 100) / 100;
}
export const totals = () => {
  let assets = 0, owed = 0, spendable = 0;
  for (const a of state.accounts) {
    const b = balance(a);
    if (isLiability(a)) owed += -b; else { assets += b; spendable += b; }
  }
  return { assets, owed, spendable, netWorth: assets - owed };
};

export const monthTx = (k) => state.transactions.filter((t) => ym(t.date) === k);
export function monthStats(k) {
  let income = 0, spent = 0, refunds = 0;
  for (const t of monthTx(k)) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') spent += t.amount;
    else if (t.type === 'refund') refunds += t.amount;
  }
  const expense = Math.max(0, spent - refunds);
  const savings = income - expense;
  return { income, expense, savings, rate: income > 0 ? (savings / income) * 100 : null };
}
/** Net spend per expense category for a month (refunds reduce it). */
export function categorySpend(k) {
  const m = {};
  for (const t of monthTx(k)) {
    if (!t.categoryId) continue;
    if (t.type === 'expense') m[t.categoryId] = (m[t.categoryId] || 0) + t.amount;
    else if (t.type === 'refund') m[t.categoryId] = (m[t.categoryId] || 0) - t.amount;
  }
  for (const id in m) if (m[id] < 0) m[id] = 0;
  return m;
}

/* ---------- budgets ---------- */
export function budgetStatus(k = ym(todayISO())) {
  const { cats, overall } = state.budgets;
  const spend = categorySpend(k);
  const { expense } = monthStats(k);
  const rows = Object.entries(cats).filter(([, v]) => v > 0).map(([id, limit]) => ({
    id, limit, spent: spend[id] || 0, pct: ((spend[id] || 0) / limit) * 100,
  }));
  return { overall: { limit: overall, spent: expense, pct: overall > 0 ? (expense / overall) * 100 : 0 }, rows };
}
export const ALERT_STEPS = [50, 80, 100];
/** Which thresholds does a given spend cross when moving from before -> after? */
export const crossed = (limit, before, after) =>
  limit > 0 ? ALERT_STEPS.filter((s) => before / limit * 100 < s && after / limit * 100 >= s) : [];

/* ---------- recurring ---------- */
export function nextDueAfter(dateISO, day) {
  const d = parseISO(dateISO);
  const k = iso(new Date(d.getFullYear(), d.getMonth() + 1, 1)).slice(0, 7);
  return `${k}-${String(Math.min(day, daysInMonth(k))).padStart(2, '0')}`;
}
export function firstDue(day, from = todayISO()) {
  const k = ym(from);
  const cand = `${k}-${String(Math.min(day, daysInMonth(k))).padStart(2, '0')}`;
  return cand >= from ? cand : nextDueAfter(from, day);
}
export function recStatus(r, today = todayISO()) {
  const diff = Math.round((parseISO(r.nextDue) - parseISO(today)) / 864e5);
  if (diff < 0) return { key: 'overdue', label: `Overdue by ${-diff}d`, diff };
  if (diff === 0) return { key: 'soon', label: 'Due today', diff };
  if (diff <= 7) return { key: 'soon', label: `Due in ${diff}d`, diff };
  return { key: 'upcoming', label: `Due in ${diff}d`, diff };
}
/** Unpaid expense obligations falling in the current month (incl. overdue). */
export function pendingBillsThisMonth(today = todayISO()) {
  const k = ym(today);
  return state.recurring.filter((r) => r.type === 'expense' && r.active !== false && r.nextDue <= `${k}-31`)
    .reduce((s, r) => s + r.amount, 0);
}

/* ---------- mutations ---------- */
export function addTransaction(t) {
  const tx = { id: uid(), createdAt: Date.now(), ...t };
  commit((s) => { s.transactions.push(tx); if (tx.type !== 'transfer') s.settings.lastAcc = tx.accountId; });
  return tx;
}
export function updateTransaction(id, patch) {
  commit((s) => { const t = s.transactions.find((x) => x.id === id); if (t) Object.assign(t, patch); });
}
export function deleteTransaction(id) {
  commit((s) => { s.transactions = s.transactions.filter((t) => t.id !== id); });
}
export function markPaid(id) {
  const r = state.recurring.find((x) => x.id === id);
  if (!r) return;
  const toAcc = r.type === 'expense' && r.toAccountId && acct(r.toAccountId);
  // An EMI / card bill that pays off a liability is a transfer, so the debt shrinks and it isn't counted twice.
  addTransaction(toAcc
    ? { type: 'transfer', amount: r.amount, date: todayISO(), accountId: r.accountId, toAccountId: r.toAccountId, categoryId: null, note: r.name, recurringId: r.id }
    : { type: r.type, amount: r.amount, date: todayISO(), accountId: r.accountId, categoryId: r.categoryId, note: r.name, recurringId: r.id });
  commit((s) => { const x = s.recurring.find((y) => y.id === id); x.nextDue = nextDueAfter(x.nextDue, x.day); });
}
