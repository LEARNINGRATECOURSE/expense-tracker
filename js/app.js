import { $, $$, todayISO, ym, shiftMonth, download, toast } from './util.js';
import { get, subscribe, commit, replaceAll, resetAll, markPaid, category, acct, TX_TYPES, sanitize, deleteContribution } from './store.js';
import { checkReminders, enableReminders } from './reminders.js';
import { ui, routes, tabFor, activityList } from './views.js';
import { closeSheet, sheetOpen, onPopState, txForm, accountForm, budgetForm, recurringForm, categoriesSheet, categoryForm, confirmSheet, goalForm, goalDetail, contributionForm } from './forms.js';
import { isLockSet, unlock, lockNow, createPin, removePin, checkPin, askPin } from './lock.js';

const view = $('#view');
let route = 'home';

/* ---------- rendering ---------- */
function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  const fn = routes[route] || routes.home;
  try { view.innerHTML = fn(); }
  catch (e) {
    console.error('render failed', e);
    view.innerHTML = `<div class="card stack"><h2>Something went wrong</h2><p class="muted small">Your data may contain an entry the app can’t read. Your device data was not changed.</p>
      <a class="btn" href="#/settings">Open settings</a></div>`;
  }
  $$('#tabbar a').forEach((a) => (a.dataset.tab === tabFor[route] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (keepScroll) window.scrollTo(0, y);
}
function navigate() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  if (h === 'add' || h === 'add-income') { history.replaceState(null, '', '#/home'); route = 'home'; render(); txForm(null, h === 'add-income' ? 'income' : 'expense'); return; }
  const next = routes[h] ? h : 'home';
  const changed = next !== route;
  route = next;
  if (sheetOpen()) closeSheet();
  view.classList.add('enter');
  render();
  setTimeout(() => view.classList.remove('enter'), 400);
  if (changed) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
}
window.addEventListener('hashchange', navigate);
window.addEventListener('popstate', onPopState);
subscribe(() => render({ keepScroll: true }));
// Tab switches replace the history entry so Back doesn't have to walk through every tab visited.
document.addEventListener('click', (e) => {
  const a = e.target.closest('#tabbar a');
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); location.replace(a.getAttribute('href')); }
});

/* ---------- export / backup ---------- */
const csvCell = (v) => {
  v = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;   // stop spreadsheets from running user text as a formula
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
function exportCSV() {
  const rows = [['Date', 'Type', 'Amount', 'Category', 'Account', 'To account', 'Note']];
  [...get().transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) =>
    rows.push([t.date, TX_TYPES[t.type], t.amount.toFixed(2), category(t.categoryId)?.name || '', acct(t.accountId)?.name || '', acct(t.toAccountId)?.name || '', t.note]));
  if (rows.length === 1) return toast('No transactions to export yet');
  download(`kharcha-${todayISO()}.csv`, '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  toast('CSV downloaded');
}
async function backup() {
  const data = { ...get(), settings: { ...get().settings, lock: null, lastBackup: todayISO() } };   // never export the PIN hash
  await download(`kharcha-backup-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
  commit((s) => { s.settings.lastBackup = todayISO(); });
  toast('Backup saved');
}
async function restoreFrom(file) {
  try {
    if (file.size > 20e6) throw new Error('too big');
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data?.accounts) || !Array.isArray(data?.transactions) || !Array.isArray(data?.categories)) throw new Error('bad shape');
    const clean = sanitize(data);   // drops anything malformed instead of letting it break the app
    const dropped = data.transactions.length - clean.transactions.length;
    if (!(await confirmSheet('Restore backup?', `This replaces everything on this device with ${clean.transactions.length} transactions from the file.${dropped ? ` ${dropped} unreadable entr${dropped > 1 ? 'ies were' : 'y was'} skipped.` : ''}`, 'Replace'))) return;
    clean.settings.lock = get().settings.lock;
    replaceAll(clean);
    toast('Backup restored ✓');
  } catch { toast('That file isn’t a valid Kharcha backup'); }
}

/* ---------- actions ---------- */
const actions = {
  'add-tx': (d) => txForm(null, d.type),
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
  'pay-all': (d) => { const n = markPaid(d.id, { all: true }); toast(`Caught up ${n} payment${n > 1 ? 's' : ''} ✓`); },
  'remind-on': async () => {
    const r = await enableReminders();
    toast(r === 'granted' ? 'Reminders on ✓' : r === 'denied' ? 'Notifications are blocked for this site' : 'Reminders not turned on');
    render({ keepScroll: true });
  },
  'new-goal': () => goalForm(),
  'edit-goal': (d) => goalForm(d.id),
  goal: (d) => goalDetail(d.id),
  'goal-add': (d) => contributionForm(d.id),
  'goal-del-c': (d) => { deleteContribution(d.goal, d.id); goalDetail(d.goal); },
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen() && $('#lock').hidden) closeSheet(); });
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { ui.q = e.target.value; $('#txlist').innerHTML = activityList(); }
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'ftype') { ui.type = e.target.value; $('#txlist').innerHTML = activityList(); }
  if (e.target.id === 'restore-file' && e.target.files[0]) { restoreFrom(e.target.files[0]); e.target.value = ''; }
});

/* ---------- app lock ---------- */
const GRACE_MS = 30_000;
let hiddenAt = 0;
const root = document.documentElement;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    if (isLockSet()) root.classList.add('privacy');   // keep balances out of the app-switcher snapshot
    return;
  }
  if (hiddenAt && Date.now() - hiddenAt > GRACE_MS) lockNow();
  root.classList.remove('privacy');
  checkReminders();
});

/* ---------- PWA ---------- */
window.addEventListener('pagehide', () => { if (isLockSet()) root.classList.add('privacy'); });
window.addEventListener('pageshow', () => { if (!document.hidden) root.classList.remove('privacy'); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installPrompt = e; if (['more', 'settings'].includes(route)) render({ keepScroll: true }); });
window.addEventListener('appinstalled', () => { ui.installPrompt = null; toast('Installed 🎉'); });
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e)));
  // A new version took over: reload into it unless the user is mid-entry.
  // Tapping a bill reminder: the service worker asks an open window to go to that screen.
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'go' && e.data.hash) location.hash = e.data.hash; });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;   // first install, nothing to refresh
    if (sheetOpen() || !$('#lock').hidden) toast('Updated. Reopen the app to get the latest version.');
    else location.reload();
  });
}
navigator.storage?.persist?.().catch(() => {});

/* ---------- boot ---------- */
if (isLockSet()) unlock();
navigate();
checkReminders();
