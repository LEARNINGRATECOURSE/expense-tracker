import { $, esc, money, todayISO, ym, toast } from './util.js';
import {
  get, commit, acct, category, ACCOUNT_TYPES, TX_TYPES, addTransaction, updateTransaction, deleteTransaction,
  categorySpend, monthStats, crossed, firstDue, isLiability, balance, cleanIcon,
} from './store.js';
import { uid } from './util.js';

/* ---------- sheet plumbing ---------- */
const sheet = () => $('#sheet');
let lastFocus = null, lastSel = null, confirmResolve = null, ignorePop = false;
const selFor = (el) => (el?.dataset?.act ? `[data-act="${el.dataset.act}"]${el.dataset.id ? `[data-id="${el.dataset.id}"]` : ''}` : null);

export function openSheet(title, html, mount) {
  const el = sheet();
  if (el.hidden || !el.classList.contains('open')) { lastFocus = document.activeElement; lastSel = selFor(lastFocus); }
  // Android Back should close the sheet, not leave the app.
  if (!history.state?.sheet) history.pushState({ sheet: 1 }, '');
  $('#app').inert = true;
  el.innerHTML = `<div class="scrim" data-act="close-sheet"></div>
    <div class="panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grab"></div><h2>${esc(title)}</h2>${html}</div>`;
  el.hidden = false;
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => el.classList.add('open'));
  const panel = $('.panel', el);
  mount?.(panel);
  setTimeout(() => (panel.querySelector('#amt, #bl') || panel.querySelector('input:not([type=radio]):not([type=hidden]),select,button'))?.focus({ preventScroll: true }), 50);
  return panel;
}
export function closeSheet() {
  const el = sheet();
  if (el.hidden) return;
  const r = confirmResolve; confirmResolve = null; r?.(false);
  el.classList.remove('open');
  document.body.classList.remove('no-scroll');
  $('#app').inert = false;
  setTimeout(() => {
    if (el.classList.contains('open')) return;
    el.hidden = true; el.innerHTML = '';
    if (history.state?.sheet) { ignorePop = true; history.back(); }
  }, 300);
  // The view re-renders after edits, so restore focus by selector rather than the stale node.
  const target = (lastSel && $(lastSel)) || (lastFocus?.isConnected ? lastFocus : $('#view'));
  target?.focus?.({ preventScroll: true });
}
export const sheetOpen = () => !sheet().hidden && sheet().classList.contains('open');
/** Wire to `popstate`: the Back button closes an open sheet. */
export function onPopState() {
  if (ignorePop) { ignorePop = false; return; }
  if (sheetOpen()) closeSheet();
}

export function confirmSheet(title, msg, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const panel = openSheet(title, `<p class="muted">${esc(msg)}</p>
      <div class="row"><button class="btn grow" data-r="0">Cancel</button><button class="btn grow danger" data-r="1">${esc(okLabel)}</button></div>`);
    confirmResolve = resolve;   // any way of closing (scrim, Esc, Back) resolves false
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      confirmResolve = null; closeSheet(); resolve(b.dataset.r === '1');
    });
  });
}

/** Strict money parser: "12abc" and "1e20" are rejected, results are rounded to paise. */
const num = (v) => {
  const t = String(v).replace(/[,₹\s]/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  const n = Math.round(Number(t) * 100) / 100;
  return Math.abs(n) <= 1e10 ? n : NaN;
};
const acctOptions = (sel, skip) => get().accounts.filter((a) => a.id !== skip)
  .map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${ACCOUNT_TYPES[a.type].icon} ${esc(a.name)}</option>`).join('');
const radio = (name, items, checked) => items.map(([v, l]) =>
  `<label><input type="radio" name="${name}" value="${v}" ${v === checked ? 'checked' : ''}><span>${l}</span></label>`).join('');

/* ---------- natural-language quick entry ---------- */
const INCOME_RE = /\b(salary|received|credited|income|earned|bonus|freelance|invoice|client payment|got paid)\b/;
const EXPENSE_RE = /\b(spent|paid|bought|purchase|expense)\b/;
/** "Spent ₹350 on petrol" -> { amount: 350, categoryId: 'transport', note: 'Petrol' }.
    `type` is only returned when the text clearly says so, otherwise the user's current choice stands. */
export function parseQuick(text, currentType = 'expense') {
  const out = {};
  // blank out clock times ("12:30 pm") so they aren't mistaken for the amount, keeping string indices intact
  const masked = text.replace(/\b\d{1,2}[:.]\d{2}\s*(?:am|pm)?/gi, (m) => ' '.repeat(m.length));
  const hits = [...masked.matchAll(/((?:₹|rs\.?|inr)\s*)?(\d[\d,]*(?:\.\d+)?)(\s*k\b)?/gi)];
  const pick = hits.find((h) => h[1]) || hits[hits.length - 1];
  if (pick) { const v = num(pick[2]); if (v > 0) out.amount = v * (pick[3] ? 1000 : 1); }

  const t = text.toLowerCase();
  if (/\b(refund|cashback|returned)\b/.test(t)) out.type = 'refund';
  else if (INCOME_RE.test(t) && !/income tax/.test(t)) out.type = 'income';
  else if (EXPENSE_RE.test(t)) out.type = 'expense';
  const type = out.type || currentType;

  const kind = type === 'income' ? 'income' : 'expense';
  let best = null, bestScore = 0;
  for (const c of get().categories.filter((c) => c.kind === kind)) {
    let score = 0;
    if (t.includes(c.name.toLowerCase())) score += 3;
    for (const k of c.kw || []) if (new RegExp(`\\b${k}`).test(t)) score += 2;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  if (best) out.categoryId = best.id;

  let rest = text;
  if (pick) rest = rest.slice(0, pick.index) + ' ' + rest.slice(pick.index + pick[0].length);
  rest = rest.replace(/₹/g, ' ').replace(/\b(?:spent|paid|received|got|rs|inr|on|for|of|at)\b\.?/gi, ' ').replace(/\s+/g, ' ').trim();
  if (rest) out.note = rest.charAt(0).toUpperCase() + rest.slice(1);
  return out;
}

/* ---------- transaction ---------- */
export function txForm(id, presetType) {
  const s = get();
  const ex = id && s.transactions.find((t) => t.id === id);
  if (!s.accounts.length) { toast('Add an account first'); location.hash = '#/accounts'; return; }
  const today = todayISO();
  const lastAcc = s.accounts.some((a) => a.id === s.settings.lastAcc) ? s.settings.lastAcc : s.accounts[0].id;
  const type0 = presetType && TX_TYPES[presetType] ? presetType : 'expense';
  const t = ex || { type: type0, amount: '', date: today, accountId: lastAcc, toAccountId: '', categoryId: type0 === 'income' && category('salary') ? 'salary' : null, note: '' };
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

  const html = `<form id="txf" class="stack" novalidate>
    ${ex ? '' : `<div class="field"><label for="q">Quick add</label>
      <div class="row"><input id="q" class="input" placeholder='"Salary 85000" or "Petrol 350"' autocomplete="off" enterkeyhint="done">
      ${SR ? '<button type="button" class="icon-btn" id="mic" aria-label="Speak a transaction">🎙️</button>' : ''}</div></div>`}
    <div class="seg" role="radiogroup" aria-label="Type">${radio('type', Object.entries(TX_TYPES), t.type)}</div>
    <div class="field"><label for="amt">Amount (₹)</label>
      <input id="amt" name="amount" class="input amount-input" inputmode="decimal" placeholder="0" value="${esc(t.amount)}" autocomplete="off" required></div>
    <div class="field" id="catfield"><span class="label">Category</span><div id="catbox" class="cat-grid" role="radiogroup" aria-label="Category"></div></div>
    <div class="field"><label for="acc" id="acclabel">Account</label><select id="acc" name="accountId" class="input">${acctOptions(t.accountId)}</select></div>
    <div class="field" id="tofield" hidden><label for="to">To account</label><select id="to" name="toAccountId" class="input"></select></div>
    <div class="field"><label for="dt">Date</label><input id="dt" name="date" type="date" class="input" value="${esc(t.date)}" min="2000-01-01" max="${today}" required></div>
    <div class="field"><label for="note">Note / payee (optional)</label><input id="note" name="note" class="input" value="${esc(t.note)}" maxlength="80" autocomplete="off"></div>
    <p id="err" class="neg small" role="alert" hidden></p>
    <div class="row actions">${ex ? '<button type="button" class="btn danger" id="del">Delete</button>' : ''}<button class="btn primary grow" type="submit">${ex ? 'Save changes' : 'Add transaction'}</button></div>
  </form>`;

  openSheet(ex ? 'Edit transaction' : presetType === 'income' ? 'Add income' : 'Add transaction', html, (p) => {
    const f = $('#txf', p);
    let selCat = t.categoryId;
    const typeNow = () => f.elements.type.value;
    const renderCats = () => {
      const ty = typeNow();
      const kind = ty === 'income' ? 'income' : 'expense';
      const cats = s.categories.filter((c) => c.kind === kind);
      if (!cats.some((c) => c.id === selCat)) selCat = ty === 'income' && !ex && category('salary') ? 'salary' : null;
      $('#catbox', p).innerHTML = cats.map((c) =>
        `<label class="chip"><input type="radio" name="categoryId" value="${esc(c.id)}" ${c.id === selCat ? 'checked' : ''}><span>${esc(c.icon)} ${esc(c.name)}</span></label>`).join('');
      $('#catfield', p).hidden = ty === 'transfer';
      $('#tofield', p).hidden = ty !== 'transfer';
      $('#acclabel', p).textContent = ty === 'transfer' ? 'From account' : ty === 'income' || ty === 'refund' ? 'Received in' : 'Paid from';
      syncTo();
    };
    const syncTo = () => {
      const from = f.elements.accountId.value;
      const cur = f.elements.toAccountId.value || t.toAccountId;
      f.elements.toAccountId.innerHTML = acctOptions(cur, from);
    };
    f.addEventListener('change', (e) => {
      if (e.target.name === 'type') renderCats();
      if (e.target.name === 'categoryId') selCat = e.target.value;
      if (e.target.name === 'accountId') syncTo();
    });
    renderCats();
    if (t.type === 'transfer' && t.toAccountId) f.elements.toAccountId.value = t.toAccountId;

    // quick-add: only applied when the text changed, and it never overrides a type the text doesn't state
    let lastQuick = '';
    const applyQuick = (text) => {
      text = text.trim();
      if (!text || text === lastQuick) return;
      lastQuick = text;
      const q = parseQuick(text, typeNow());
      if (q.type && q.type !== typeNow()) { f.elements.type.value = q.type; selCat = null; }
      if (q.categoryId) selCat = q.categoryId;
      if (q.amount) f.elements.amount.value = q.amount;
      if (q.note) f.elements.note.value = q.note;
      renderCats();
    };
    $('#q', p)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyQuick(e.target.value); f.elements.amount.focus(); } });
    $('#q', p)?.addEventListener('blur', (e) => applyQuick(e.target.value));
    $('#mic', p)?.addEventListener('click', () => {
      const r = new SR(); r.lang = 'en-IN'; r.interimResults = false;
      r.onresult = (ev) => { const text = ev.results[0][0].transcript; $('#q', p).value = text; applyQuick(text); };
      r.onerror = () => toast('Could not hear that — try typing instead');
      try { r.start(); toast('Listening…'); } catch { /* already started */ }
    });

    $('#del', p)?.addEventListener('click', async () => {
      if (await confirmSheet('Delete transaction?', 'This cannot be undone.')) { deleteTransaction(id); toast('Transaction deleted'); }
      else txForm(id);
    });

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const err = $('#err', p);
      const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); };
      const amount = num(d.amount);
      if (!(amount >= 0.01)) return fail(Number.isNaN(amount) ? 'Enter a valid amount, for example 250 or 99.50.' : 'Amount must be at least ₹0.01.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date < '2000-01-01') return fail('Pick a valid date.');
      if (d.date > today) return fail('The date can’t be in the future.');
      const tx = { type: d.type, amount, date: d.date, accountId: d.accountId, note: d.note.trim() };
      if (d.type === 'transfer') {
        if (!d.toAccountId || d.toAccountId === d.accountId) return fail('Choose two different accounts.');
        tx.toAccountId = d.toAccountId; tx.categoryId = null;
      } else {
        if (d.type === 'refund' && !d.categoryId) return fail('Pick the category this refund belongs to, so budgets and reports stay accurate.');
        const dflt = d.type === 'income' ? 'otherin' : 'other';
        tx.categoryId = d.categoryId || (category(dflt) ? dflt : s.categories.find((c) => c.kind === (d.type === 'income' ? 'income' : 'expense'))?.id);
        tx.toAccountId = null;
      }
      const k = ym(tx.date);
      const snap = () => ({ cat: categorySpend(k)[tx.categoryId] || 0, tot: monthStats(k).expense });
      const before = snap();
      if (ex) updateTransaction(id, tx); else addTransaction(tx);
      closeSheet();
      const msg = [];
      if (tx.type === 'expense' && !ex) {
        const after = snap(), b = get().budgets;
        const cs = crossed(b.cats[tx.categoryId], before.cat, after.cat);
        const os = crossed(b.overall, before.tot, after.tot);
        if (cs.length) msg.push(`${category(tx.categoryId).name} budget at ${Math.max(...cs)}%`);
        if (os.length) msg.push(`Monthly budget at ${Math.max(...os)}%`);
      }
      toast(msg.length ? `⚠️ ${msg.join(' · ')}` : ex ? 'Saved' : tx.type === 'income' ? 'Income added ✓' : 'Added ✓');
    });
  });
}

/* ---------- accounts ---------- */
/** What the balance field shows: money owed for cards/loans (positive = you owe), balance otherwise. Sign preserved. */
const signedShown = (a) => { const b = balance(a); const v = isLiability(a) ? -b : b; return v === 0 ? '' : Math.round(v * 100) / 100; };

export function accountForm(id) {
  const ex = id && acct(id);
  const a = ex || { name: '', type: 'bank', opening: 0 };
  const liab = isLiability(a);
  const html = `<form id="af" class="stack" novalidate>
    <div class="field"><label for="an">Name</label><input id="an" name="name" class="input" value="${esc(a.name)}" maxlength="32" placeholder="e.g. HDFC Savings" required></div>
    <div class="field"><label for="at">Type</label><select id="at" name="type" class="input">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></div>
    <div class="field"><label for="ao" id="aolabel">${liab ? 'Amount owed (₹)' : 'Current balance (₹)'}</label><input id="ao" name="opening" class="input" inputmode="decimal" value="${ex ? signedShown(ex) : ''}" placeholder="0"></div>
    <div class="field" id="limfield" ${a.type === 'card' ? '' : 'hidden'}><label for="al">Credit limit (₹, optional)</label><input id="al" name="limit" class="input" inputmode="decimal" value="${a.limit || ''}" placeholder="0"></div>
    <p class="muted small">Overdrawn? Start the balance with a minus sign. Credit cards and loans count as money you owe. Paying a card or EMI is a <b>transfer</b> from a bank account, so it is never counted as an expense twice.</p>
    <p id="err" class="neg small" role="alert" hidden></p>
    <div class="row actions">${ex ? '<button type="button" class="btn danger" id="del">Delete</button>' : ''}<button class="btn primary grow">${ex ? 'Save' : 'Add account'}</button></div>
  </form>`;
  openSheet(ex ? 'Edit account' : 'New account', html, (p) => {
    const f = $('#af', p);
    f.elements.type.addEventListener('change', () => {
      const ty = f.elements.type.value;
      $('#aolabel', p).textContent = ACCOUNT_TYPES[ty].liability ? 'Amount owed (₹)' : 'Current balance (₹)';
      $('#limfield', p).hidden = ty !== 'card';
    });
    $('#del', p)?.addEventListener('click', async () => {
      const used = get().transactions.some((t) => t.accountId === id || t.toAccountId === id);
      if (used) return toast('This account has transactions — delete or move them first');
      if (await confirmSheet('Delete account?', `Remove “${a.name}”? Any bills or EMIs set up on it are removed too.`)) commit((s) => { s.accounts = s.accounts.filter((x) => x.id !== id); s.recurring = s.recurring.filter((r) => r.accountId !== id); });
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (!d.name.trim()) { const er = $('#err', p); er.textContent = 'Give the account a name.'; er.hidden = false; return; }
      const er = $('#err', p);
      const entered = d.opening.trim() === '' ? 0 : num(d.opening);
      const lim = d.limit.trim() === '' ? 0 : num(d.limit);
      if (Number.isNaN(entered) || Number.isNaN(lim) || lim < 0) { er.textContent = 'Enter valid amounts (a credit limit can’t be negative).'; er.hidden = false; return; }
      const liability = ACCOUNT_TYPES[d.type].liability;
      // Signed target balance: for cards/loans the entered figure is what you OWE (negative balance).
      const target = liability ? -entered : entered;
      const next = { name: d.name.trim(), type: d.type, opening: target, limit: d.type === 'card' ? lim : 0 };
      if (ex) {
        // The figure typed is the *current* balance, so back out the transaction flows to get the opening balance.
        next.opening = Math.round((target - balance({ ...ex, opening: 0 })) * 100) / 100;
        commit((s) => Object.assign(s.accounts.find((x) => x.id === id), next));
      } else commit((s) => s.accounts.push({ id: uid(), ...next }));
      closeSheet(); toast(ex ? 'Account updated' : 'Account added ✓');
    });
  });
}

/* ---------- budgets ---------- */
export function budgetForm(target) {
  const b = get().budgets;
  const isOverall = target === 'overall';
  const c = !isOverall && category(target);
  const cur = isOverall ? b.overall : b.cats[target] || 0;
  const html = `<form id="bf" class="stack" novalidate>
    <p class="muted">${isOverall ? 'Your total spending limit for each month.' : `Monthly limit for ${esc(c.name)}.`}</p>
    <div class="field"><label for="bl">Limit (₹ per month)</label><input id="bl" class="input amount-input" inputmode="decimal" value="${cur || ''}" placeholder="0" required></div>
    <p id="err" class="neg small" role="alert" hidden></p>
    <div class="row actions">${cur ? '<button type="button" class="btn danger" id="rm">Remove</button>' : ''}<button class="btn primary grow">Save limit</button></div>
  </form>`;
  openSheet(isOverall ? 'Monthly budget' : `${c.icon} ${c.name} budget`, html, (p) => {
    $('#rm', p)?.addEventListener('click', () => {
      commit((s) => { if (isOverall) s.budgets.overall = 0; else delete s.budgets.cats[target]; });
      closeSheet(); toast('Limit removed');
    });
    $('#bf', p).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = num($('#bl', p).value);
      if (!(v >= 1)) { const er = $('#err', p); er.textContent = 'Enter an amount of at least ₹1.'; er.hidden = false; return; }
      commit((s) => { if (isOverall) s.budgets.overall = v; else s.budgets.cats[target] = v; });
      closeSheet(); toast('Budget saved ✓');
    });
  });
}

/* ---------- recurring / bills ---------- */
export function recurringForm(id) {
  const s = get();
  if (!s.accounts.length) { toast('Add an account first'); location.hash = '#/accounts'; return; }
  const ex = id && s.recurring.find((r) => r.id === id);
  const r = ex || { name: '', type: 'expense', amount: '', day: new Date().getDate(), categoryId: 'bills', accountId: s.accounts[0]?.id };
  const catOpts = (type) => s.categories.filter((c) => c.kind === (type === 'income' ? 'income' : 'expense'))
    .map((c) => `<option value="${c.id}" ${c.id === r.categoryId ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('');
  const html = `<form id="rf" class="stack" novalidate>
    <div class="seg" role="radiogroup" aria-label="Type">${radio('type', [['expense', 'Bill / EMI'], ['income', 'Income']], r.type)}</div>
    <div class="field"><label for="rn">Name</label><input id="rn" name="name" class="input" value="${esc(r.name)}" maxlength="40" placeholder="e.g. Rent, Home loan EMI, Salary" required></div>
    <div class="field"><label for="ra">Amount (₹)</label><input id="ra" name="amount" class="input" inputmode="decimal" value="${r.amount}" placeholder="0" required></div>
    <div class="field"><label for="rd">Day of month (1–31)</label><input id="rd" name="day" type="number" min="1" max="31" class="input" value="${r.day}" required></div>
    <div class="field"><label for="rc">Category</label><select id="rc" name="categoryId" class="input">${catOpts(r.type)}</select></div>
    <div class="field"><label for="rac">Paid from / received in</label><select id="rac" name="accountId" class="input">${acctOptions(r.accountId)}</select></div>
    <div class="field" id="payoff" ${r.type === 'income' ? 'hidden' : ''}><label for="rto">Pays off a card or loan? (optional)</label>
      <select id="rto" name="toAccountId" class="input"><option value="">No, it’s a normal expense</option>${s.accounts.filter(isLiability).map((a) => `<option value="${a.id}" ${a.id === r.toAccountId ? 'selected' : ''}>${ACCOUNT_TYPES[a.type].icon} ${esc(a.name)}</option>`).join('')}</select>
      <p class="small muted">For an EMI, choose the loan: paying it then lowers what you owe and isn’t counted as spending twice.</p></div>
    <p id="err" class="neg small" role="alert" hidden></p>
    <div class="row actions">${ex ? '<button type="button" class="btn danger" id="del">Delete</button>' : ''}<button class="btn primary grow">${ex ? 'Save' : 'Add'}</button></div>
  </form>`;
  openSheet(ex ? 'Edit recurring' : 'New recurring', html, (p) => {
    const f = $('#rf', p);
    f.addEventListener('change', (e) => {
      if (e.target.name === 'type') {
        const kind = e.target.value === 'income' ? 'income' : 'expense';
        $('#payoff', p).hidden = kind === 'income';
        f.elements.categoryId.innerHTML = s.categories.filter((c) => c.kind === kind)
          .map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('');
      }
    });
    $('#del', p)?.addEventListener('click', async () => {
      if (await confirmSheet('Delete?', `Stop tracking “${r.name}”? Past transactions stay.`)) commit((x) => { x.recurring = x.recurring.filter((y) => y.id !== id); });
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const er = $('#err', p);
      const amount = num(d.amount), day = parseInt(d.day, 10);
      if (!d.name.trim() || !(amount >= 0.01) || !(day >= 1 && day <= 31)) { er.textContent = 'Fill in a name, an amount above zero and a day between 1 and 31.'; er.hidden = false; return; }
      const toId = d.type === 'expense' && d.toAccountId && d.toAccountId !== d.accountId ? d.toAccountId : null;
      const next = { name: d.name.trim(), type: d.type, amount, day, categoryId: d.categoryId, accountId: d.accountId, toAccountId: toId, active: true };
      const oldDay = ex?.day;   // `ex` is the live state object, so read it before assigning
      if (ex) commit((x) => { const y = x.recurring.find((z) => z.id === id); Object.assign(y, next); if (oldDay !== day) y.nextDue = firstDue(day); });
      else commit((x) => x.recurring.push({ id: uid(), ...next, nextDue: firstDue(day) }));
      closeSheet(); toast('Saved ✓');
    });
  });
}

/* ---------- categories ---------- */
export function categoriesSheet() {
  const s = get();
  const row = (c) => `<button class="item" data-act="edit-cat" data-id="${c.id}"><span class="well sm">${esc(c.icon)}</span><span class="grow"><span class="title">${esc(c.name)}</span><span class="meta" style="display:block">${c.kind === 'income' ? 'Income' : c.essential ? 'Essential' : 'Discretionary'}</span></span></button>`;
  openSheet('Categories', `<div class="list">${s.categories.map(row).join('')}</div><button class="btn primary block" data-act="new-cat">+ New category</button>`);
}
export function categoryForm(id) {
  const ex = id && category(id);
  const c = ex || { name: '', icon: '🏷️', kind: 'expense', essential: false };
  const html = `<form id="cf" class="stack" novalidate>
    <div class="field"><label for="cn">Name</label><input id="cn" name="name" class="input" value="${esc(c.name)}" maxlength="24" required></div>
    <div class="field"><label for="ci">Icon (emoji)</label><input id="ci" name="icon" class="input" value="${esc(c.icon)}" maxlength="8" autocomplete="off"></div>
    <div class="seg" role="radiogroup" aria-label="Kind">${radio('kind', [['expense', 'Expense'], ['income', 'Income']], c.kind)}</div>
    <label class="row" style="min-height:44px"><input type="checkbox" name="essential" ${c.essential ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accent)"> <span>Essential spending (needs, not wants)</span></label>
    <p id="err" class="neg small" role="alert" hidden></p>
    <div class="row actions">${ex && id !== 'other' && id !== 'otherin' ? '<button type="button" class="btn danger" id="del">Delete</button>' : ''}<button class="btn primary grow">Save</button></div>
  </form>`;
  openSheet(ex ? 'Edit category' : 'New category', html, (p) => {
    $('#del', p)?.addEventListener('click', () => {
      if (id === 'other' || id === 'otherin') return toast('This is a built-in fallback category');
      if (get().transactions.some((t) => t.categoryId === id) || get().recurring.some((r) => r.categoryId === id)) return toast('Category is in use — can’t delete');
      commit((s) => { s.categories = s.categories.filter((x) => x.id !== id); delete s.budgets.cats[id]; });
      closeSheet(); toast('Category deleted');
    });
    $('#cf', p).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target, d = Object.fromEntries(new FormData(f));
      if (!d.name.trim()) { const er = $('#err', p); er.textContent = 'Give it a name.'; er.hidden = false; return; }
      if (ex && d.kind !== ex.kind && (get().transactions.some((t) => t.categoryId === id) || get().recurring.some((r) => r.categoryId === id))) {
        const er = $('#err', p); er.textContent = 'This category is in use, so its type can’t change.'; er.hidden = false; return;
      }
      const next = { name: d.name.trim(), icon: cleanIcon(d.icon), kind: d.kind, essential: !!d.essential && d.kind === 'expense' };
      if (ex) commit((s) => Object.assign(s.categories.find((x) => x.id === id), next));
      else commit((s) => s.categories.push({ id: uid(), kw: [], ...next }));
      closeSheet(); toast('Saved ✓');
    });
  });
}
