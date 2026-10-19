import { $, $$, todayISO, ym, shiftMonth, download, toast, esc } from './util.js';
import { get, subscribe, commit, replaceAll, resetAll, markPaid, category, acct, TX_TYPES, didSaveFail } from './store.js';
import { ui, routes, tabFor, activityList } from './views.js';
import { openSheet, closeSheet, sheetOpen, txForm, accountForm, budgetForm, recurringForm, categoriesSheet, categoryForm, confirmSheet } from './forms.js';
import { isLockSet, isLocked, unlock, createPin, removePin, checkPin, askPin } from './lock.js';

const view = $('#view');
let route = 'home';

/* ---------- rendering ---------- */
function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  const fn = routes[route] || routes.home;
  view.innerHTML = fn();
  $$('#tabbar a').forEach((a) => (a.dataset.tab === tabFor[route] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (keepScroll) window.scrollTo(0, y);
}
function navigate() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  if (h === 'add') { history.replaceState(null, '', '#/home'); route = 'home'; render(); txForm(); return; }
  const next = routes[h] ? h : 'home';
  const changed = next !== route;
  route = next;
  if (sheetOpen()) closeSheet();
  render();
  if (changed) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
}
window.addEventListener('hashchange', navigate);
subscribe(() => { render({ keepScroll: true }); if (didSaveFail()) toast('⚠️ Storage is full or blocked — changes may not persist'); });

/* ---------- export / backup ---------- */
const csvCell = (v) => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
function exportCSV() {
  const rows = [['Date', 'Type', 'Amount', 'Category', 'Account', 'To account', 'Note']];
  [...get().transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) =>
    rows.push([t.date, TX_TYPES[t.type], t.amount, category(t.categoryId)?.name || '', acct(t.accountId)?.name || '', acct(t.toAccountId)?.name || '', t.note]));
  if (rows.length === 1) return toast('No transactions to export yet');
  download(`kharcha-${todayISO()}.csv`, '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  toast('CSV downloaded');
}
function backup() {
  download(`kharcha-backup-${todayISO()}.json`, JSON.stringify(get(), null, 2), 'application/json');
  toast('Backup downloaded');
}
async function restoreFrom(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.accounts) || !Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error('bad shape');
    if (!(await confirmSheet('Restore backup?', `This replaces everything on this device with ${data.transactions.length} transactions from the file.`, 'Replace'))) return;
    const keepLock = get().settings.lock;
    replaceAll({ ...data, settings: { ...data.settings, lock: keepLock } });
    toast('Backup restored ✓');
  } catch { toast('That file isn’t a valid Kharcha backup'); }
}

/* ---------- actions ---------- */
const actions = {
  'add-tx': () => txForm(),
  'edit-tx': (d) => txForm(d.id),
  'close-sheet': () => closeSheet(),
  month: (d) => {
    const n = shiftMonth(ui.month, +d.d);
    if (n > ym(todayISO())) return;
    ui.month = n; render({ keepScroll: true });
  },
  'new-acc': () => accountForm(),
  'edit-acc': (d) => accountForm(d.id),
  budget: (d) => budgetForm(d.id),
  'new-rec': () => recurringForm(),
  'edit-rec': (d) => recurringForm(d.id),
  pay: (d) => { markPaid(d.id); toast('Recorded ✓'); },
  'export-csv': exportCSV,
  backup,
  restore: () => $('#restore-file').click(),
  categories: categoriesSheet,
  'new-cat': () => categoryForm(),
  'edit-cat': (d) => categoryForm(d.id),
  'lock-set': async () => { if (isLockSet() && !(await askPin({ title: 'Current PIN', cancelable: true, validate: checkPin }))) return; if (await createPin()) toast('App lock is on 🔒'); },
  'lock-off': async () => { if (await askPin({ title: 'Enter PIN to turn off', cancelable: true, validate: checkPin })) { removePin(); toast('App lock removed'); } },
  clear: async () => {
    if (!(await confirmSheet('Clear all data?', 'Every transaction, account, budget and bill on this device will be deleted. Download a backup first if unsure.', 'Delete everything'))) return;
    resetAll(); toast('All data cleared'); location.hash = '#/home';
  },
  install: async () => {
    const p = ui.installPrompt; if (!p) return;
    p.prompt(); await p.userChoice; ui.installPrompt = null; render({ keepScroll: true });
  },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen() && !isLocked()) closeSheet(); });
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { ui.q = e.target.value; $('#txlist').innerHTML = activityList(); }
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'ftype') { ui.type = e.target.value; $('#txlist').innerHTML = activityList(); }
  if (e.target.id === 'restore-file' && e.target.files[0]) { restoreFrom(e.target.files[0]); e.target.value = ''; }
});

/* ---------- app lock ---------- */
let hiddenAt = 0;
async function lockIfNeeded() { if (isLockSet() && !isLocked()) await unlock(); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 60_000) lockIfNeeded();
});

/* ---------- PWA ---------- */
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installPrompt = e; if (['more', 'settings'].includes(route)) render({ keepScroll: true }); });
window.addEventListener('appinstalled', () => { ui.installPrompt = null; toast('Installed 🎉'); });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e)));
}
navigator.storage?.persist?.().catch(() => {});

/* ---------- boot ---------- */
if (isLockSet()) { $('#lock').hidden = false; lockIfNeeded(); }
navigate();
