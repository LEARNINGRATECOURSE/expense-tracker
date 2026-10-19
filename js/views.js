import { esc, money, moneyShort, todayISO, ym, monthLabel, monthShort, shiftMonth, daysInMonth, fmtDate, dayLabel } from './util.js';
import {
  get, acct, category, balance, totals, monthStats, monthTx, categorySpend, budgetStatus, recStatus, pendingBillsThisMonth,
  ACCOUNT_TYPES, TX_TYPES, isLiability,
} from './store.js';
import { isLockSet, lockAvailable } from './lock.js';

/** Shared UI state that survives re-renders. */
export const ui = { month: ym(todayISO()), q: '', type: 'all', installPrompt: null };

const curMonth = () => ym(todayISO());

/* ---------- shared pieces ---------- */
const empty = (icon, title, text, action) => `<div class="empty"><div class="well float">${icon}</div><h3>${title}</h3><p class="small" style="max-width:260px">${text}</p>${action || ''}</div>`;

const monthNav = () => `<div class="month-nav">
  <button class="icon-btn sm" data-act="month" data-d="-1" aria-label="Previous month">‹</button>
  <strong>${monthLabel(ui.month)}</strong>
  <button class="icon-btn sm" data-act="month" data-d="1" aria-label="Next month" ${ui.month >= curMonth() ? 'disabled style="opacity:.4"' : ''}>›</button></div>`;

const progress = (pct, cls = '', label = 'Progress') => {
  const c = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
  return `<div class="track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.floor(pct))}"><div class="fill ${cls || c}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
};

export function txRow(t) {
  const c = t.categoryId && category(t.categoryId);
  const a = acct(t.accountId), to = t.toAccountId && acct(t.toAccountId);
  const isIn = t.type === 'income' || t.type === 'refund';
  const title = t.note || (t.type === 'transfer' ? 'Transfer' : c?.name || TX_TYPES[t.type]);
  const meta = t.type === 'transfer' ? `${esc(a?.name || '?')} → ${esc(to?.name || '?')}` : `${c ? esc(c.name) : TX_TYPES[t.type]} · ${esc(a?.name || '?')}`;
  const sign = t.type === 'transfer' ? '' : isIn ? '+' : '-';
  return `<button class="item" data-act="edit-tx" data-id="${t.id}">
    <span class="well sm" aria-hidden="true">${t.type === 'transfer' ? '↔️' : esc(c?.icon || '🧾')}</span>
    <span class="grow"><span class="title" style="display:block">${esc(title)}</span><span class="meta" style="display:block">${meta} · ${fmtDate(t.date)}</span></span>
    <span class="amt ${isIn ? 'pos' : ''}">${sign}${money(t.amount)}</span></button>`;
}

const sortedTx = (arr) => [...arr].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

const billRow = (r, withAction) => {
  const st = recStatus(r), c = category(r.categoryId);
  return `<div class="item" style="cursor:default">
    <button class="well sm" style="border:0;cursor:pointer" data-act="edit-rec" data-id="${r.id}" aria-label="Edit ${esc(r.name)}">${esc(c?.icon || '🧾')}</button>
    <span class="grow"><span class="title" style="display:block">${esc(r.name)}</span>
      <span class="meta" style="display:block"><span class="${st.key === 'overdue' ? 'neg' : ''}" style="${st.key === 'overdue' ? 'font-weight:700' : ''}">${st.label}</span> · ${fmtDate(r.nextDue)}</span></span>
    <span style="text-align:right"><span class="amt ${r.type === 'income' ? 'pos' : ''}" style="display:block">${r.type === 'income' ? '+' : ''}${money(r.amount)}</span>
      ${withAction ? `<button class="link" data-act="pay" data-id="${r.id}" style="padding:0;min-height:44px">${r.type === 'income' ? 'Received' : 'Mark paid'}</button>` : ''}</span></div>`;
};

/* ---------- Home ---------- */
export function home() {
  const s = get(), k = curMonth(), st = monthStats(k), prev = monthStats(shiftMonth(k, -1)), tot = totals();
  const bs = budgetStatus(k);
  const now = new Date(), daysLeft = daysInMonth(k) - now.getDate() + 1;
  const daysElapsed = now.getDate(), spentPerDay = st.expense / daysElapsed;
  const hot = bs.rows.filter((r) => r.pct >= 80).sort((a, b) => b.pct - a.pct);
  const recs = [...s.recurring].filter((r) => r.active !== false).sort((a, b) => a.nextDue.localeCompare(b.nextDue)).slice(0, 3);
  const recent = sortedTx(s.transactions).slice(0, 5);
  const delta = prev.expense > 0 ? ((st.expense - prev.expense) / prev.expense) * 100 : null;
  const dRound = delta === null ? 0 : Math.round(delta);
  const lastBackup = s.settings.lastBackup;
  const needsBackup = s.transactions.length >= 10 && (!lastBackup || (Date.now() - new Date(lastBackup + 'T00:00:00')) / 864e5 > 30);

  let budgetCard;
  if (bs.overall.limit > 0) {
    const pending = pendingBillsThisMonth();
    const free = bs.overall.limit - bs.overall.spent - pending;
    budgetCard = `<a class="card tap stack" href="#/budgets" style="display:flex;gap:14px">
      <div class="between row"><h3>Monthly budget</h3><span class="pill ${bs.overall.pct >= 100 ? 'warn' : ''}">${Math.floor(bs.overall.pct)}% used</span></div>
      ${progress(bs.overall.pct, '', 'Monthly budget used')}
      <div class="between row small"><span class="muted">${money(bs.overall.spent)} of ${money(bs.overall.limit)}</span>
        <span class="${free < 0 ? 'neg' : ''}" style="font-weight:700">${bs.overall.spent > bs.overall.limit ? `${money(bs.overall.spent - bs.overall.limit)} over` : free < 0 ? `${money(-free)} short after bills` : `${money(free)} left`}</span></div>
      <p class="small muted">${free > 0 ? `≈ <b style="color:var(--fg)">${money(free / daysLeft)}/day</b> safe to spend for the next ${daysLeft} day${daysLeft > 1 ? 's' : ''}${pending ? `, after ${money(pending)} of bills due` : ''}.` : bs.overall.spent > bs.overall.limit ? 'You have used up this month’s budget.' : `${money(pending)} of bills are still due this month, which is more than the ${money(bs.overall.limit - bs.overall.spent)} left in your budget.`}</p>
      <p class="small muted">Spent so far: <b style="color:var(--fg)">${money(spentPerDay)}/day</b> on average since the 1st (${money(st.expense)} over ${daysElapsed} day${daysElapsed > 1 ? 's' : ''}).</p></a>`;
  } else {
    budgetCard = `<a class="card tap row" href="#/budgets"><span class="well">🎯</span><span class="grow"><h3>Set a monthly budget</h3><p class="small muted">Know how much you can safely spend each day.</p></span><span aria-hidden="true">›</span></a>`;
  }

  return `
  <header class="page-head"><div><p class="sub">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Kharcha</h1></div>
    <a class="icon-btn" href="#/settings" aria-label="Settings">⚙️</a></header>
  <section class="card hero" aria-label="Overview">
    <p class="muted small" style="font-weight:700">Available balance</p>
    <p class="big num">${money(tot.spendable)}</p>
    <div class="stats">
      <div class="stat"><b class="pos num">${moneyShort(st.income)}</b><span>Income</span></div>
      <div class="stat"><b class="num">${moneyShort(st.expense)}</b><span>Spent</span></div>
      <div class="stat"><b class="num ${st.savings < 0 ? 'neg' : ''}">${moneyShort(st.savings)}</b><span>${st.rate === null ? 'Saved' : `${Math.round(st.rate)}% saved`}</span></div>
    </div>
    <div class="row" style="margin-top:18px"><button class="btn grow" data-act="add-tx" data-type="income">＋ Income</button><button class="btn grow" data-act="add-tx" data-type="expense">－ Expense</button></div>
    ${delta === null ? '' : `<p class="small muted" style="margin-top:16px">Spent ${money(st.expense)} so far. Last month’s total was ${money(prev.expense)} (${dRound === 0 ? 'about the same pace' : `<b class="${dRound > 0 ? 'neg' : 'pos'}">${dRound > 0 ? '+' : '−'}${Math.abs(dRound)}%</b> so far vs. that total`}).</p>`}
  </section>
  ${needsBackup ? `<a class="banner" href="#/settings"><span aria-hidden="true">💾</span><span><b>Back up your data.</b> ${lastBackup ? `Last backup was on ${fmtDate(lastBackup)}.` : 'You haven’t made a backup yet.'} Everything lives only on this phone.</span></a>` : ''}
  ${hot.length ? `<div class="stack">${hot.slice(0, 2).map((r) => { const c = category(r.id); return `<a class="banner" href="#/budgets"><span aria-hidden="true">${r.pct >= 100 ? '🚨' : '⚠️'}</span><span><b>${esc(c?.name)}</b> is at ${Math.floor(r.pct)}% of ${money(r.limit)}</span></a>`; }).join('')}</div>` : ''}
  ${budgetCard}
  ${recs.length ? `<section class="stack"><div class="section-head"><h2>Coming up</h2><a href="#/bills">All</a></div><div class="list">${recs.map((r) => billRow(r, false)).join('')}</div></section>` : ''}
  <section class="stack"><div class="section-head"><h2>Accounts</h2><a href="#/accounts">Manage</a></div>
    <div class="hscroll">${s.accounts.map((a) => { const b = balance(a), li = isLiability(a); return `<button class="mini-acc" data-act="edit-acc" data-id="${a.id}"><span class="well sm">${ACCOUNT_TYPES[a.type].icon}</span><b class="num ${li && b < 0 ? 'neg' : ''}">${money(li ? -b : b)}</b><span class="small muted">${esc(a.name)}${li ? ' · owed' : ''}</span></button>`; }).join('')}</div></section>
  <section class="stack"><div class="section-head"><h2>Recent</h2><a href="#/activity">See all</a></div>
    ${recent.length ? `<div class="list">${recent.map(txRow).join('')}</div>` : empty('✨', 'Nothing yet', 'Add your salary or another income first, then log expenses with the + button. It takes a few seconds.', '<button class="btn primary" data-act="add-tx" data-type="income">＋ Add income</button>')}</section>`;
}

/* ---------- Activity ---------- */
export function activityList() {
  const q = ui.q.trim().toLowerCase();
  const rows = sortedTx(monthTx(ui.month)).filter((t) => {
    if (ui.type !== 'all' && t.type !== ui.type) return false;
    if (!q) return true;
    const hay = `${t.note} ${category(t.categoryId)?.name || ''} ${acct(t.accountId)?.name || ''} ${t.amount}`.toLowerCase();
    return hay.includes(q);
  });
  if (!rows.length) return empty('🔎', 'No transactions', q || ui.type !== 'all' ? 'Try clearing the search or filters.' : 'Nothing recorded for this month.');
  const groups = {};
  rows.forEach((t) => (groups[t.date] ||= []).push(t));
  return Object.entries(groups).map(([d, list]) => {
    const net = list.reduce((n, t) => n + (t.type === 'income' || t.type === 'refund' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
    return `<div class="stack" style="gap:10px"><div class="day-head"><span>${dayLabel(d)}</span><span class="num">${net ? money(net, { sign: true }) : ''}</span></div><div class="list">${list.map(txRow).join('')}</div></div>`;
  }).join('');
}
export function activity() {
  const st = monthStats(ui.month);
  return `<header class="page-head"><h1>Activity</h1></header>
  ${monthNav()}
  <div class="card flat-inset row between small" style="padding:14px 20px"><span>In <b class="pos num">${money(st.income)}</b></span><span>Out <b class="num">${money(st.expense)}</b></span></div>
  <div class="field"><label for="search" class="sr">Search</label><input id="search" class="input" type="search" placeholder="Search note, category, amount…" value="${esc(ui.q)}" autocomplete="off"></div>
  <div class="chips scroll" role="radiogroup" aria-label="Filter by type">${[['all', 'All'], ...Object.entries(TX_TYPES)].map(([v, l]) =>
    `<label class="chip"><input type="radio" name="ftype" value="${v}" ${ui.type === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
  <div id="txlist" class="stack" style="gap:20px">${activityList()}</div>`;
}

/* ---------- Budgets ---------- */
export function budgets() {
  const s = get(), k = curMonth(), bs = budgetStatus(k), spend = categorySpend(k);
  const o = bs.overall;
  const cats = s.categories.filter((c) => c.kind === 'expense');
  const withLimit = cats.filter((c) => s.budgets.cats[c.id] > 0);
  const without = cats.filter((c) => !(s.budgets.cats[c.id] > 0));
  const step = (p) => (p >= 100 ? '100%' : p >= 80 ? '80%' : p >= 50 ? '50%' : null);
  const alerts = [...(o.limit ? [{ name: 'Monthly budget', pct: o.pct, icon: '🎯' }] : []), ...bs.rows.map((r) => ({ name: category(r.id)?.name, pct: r.pct, icon: category(r.id)?.icon }))]
    .filter((a) => a.pct >= 50).sort((a, b) => b.pct - a.pct);
  return `<header class="page-head"><div><p class="sub">${monthLabel(k)}</p><h1>Budgets</h1></div></header>
  <button class="card tap stack" data-act="budget" data-id="overall" style="text-align:left;border:0;display:flex">
    <div class="between row"><h3>Overall</h3><span class="link" style="padding:0;min-height:0">${o.limit ? 'Edit' : 'Set limit'}</span></div>
    ${o.limit ? `${progress(o.pct, '', 'Overall budget used')}<div class="between row small"><span class="muted">${money(o.spent)} spent</span><b class="${o.spent > o.limit ? 'neg' : ''}">${o.limit - o.spent >= 0 ? `${money(o.limit - o.spent)} left` : `${money(o.spent - o.limit)} over`}</b></div>`
      : '<p class="small muted">Set a total monthly limit to see what’s left to spend. Alerts fire at 50%, 80% and 100%.</p>'}
  </button>
  ${alerts.length ? `<div class="stack">${alerts.slice(0, 4).map((a) => `<div class="banner"><span aria-hidden="true">${a.pct >= 100 ? '🚨' : a.pct >= 80 ? '⚠️' : 'ℹ️'}</span><span><b>${esc(a.name)}</b> crossed ${step(a.pct)} (${Math.floor(a.pct)}%)</span></div>`).join('')}</div>` : ''}
  <section class="stack"><div class="section-head"><h2>By category</h2></div>
    ${withLimit.length ? `<div class="list">${withLimit.map((c) => { const lim = s.budgets.cats[c.id], sp = spend[c.id] || 0, pct = (sp / lim) * 100;
      return `<button class="item" data-act="budget" data-id="${c.id}" style="flex-direction:column;align-items:stretch;gap:10px">
        <span class="row"><span class="well sm">${esc(c.icon)}</span><span class="grow"><span class="title" style="display:block">${esc(c.name)}</span><span class="meta" style="display:block">${money(sp)} of ${money(lim)}</span></span><span class="amt ${pct >= 100 ? 'neg' : ''}">${Math.floor(pct)}%</span></span>${progress(pct, '', `${c.name} budget used`)}</button>`; }).join('')}</div>`
      : empty('📊', 'No category limits', 'Pick a category below to cap what you spend on it each month.')}
  </section>
  ${without.length ? `<section class="stack"><div class="section-head"><h2>Add a limit</h2></div><div class="chips">${without.map((c) => `<button class="btn sm" data-act="budget" data-id="${c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}</div></section>` : ''}`;
}

/* ---------- Accounts ---------- */
export function accounts() {
  const s = get(), tot = totals();
  const group = (liab) => s.accounts.filter((a) => isLiability(a) === liab).map((a) => {
    const b = balance(a);
    const util = a.type === 'card' && a.limit > 0 ? Math.max(0, (-b / a.limit) * 100) : null;
    return `<button class="item" data-act="edit-acc" data-id="${a.id}" style="flex-wrap:wrap">
      <span class="well sm">${ACCOUNT_TYPES[a.type].icon}</span>
      <span class="grow"><span class="title" style="display:block">${esc(a.name)}</span><span class="meta" style="display:block">${ACCOUNT_TYPES[a.type].label}${util !== null ? ` · ${Math.round(util)}% of ${moneyShort(a.limit)} used` : ''}</span></span>
      <span class="amt ${liab ? 'neg' : b < 0 ? 'neg' : ''}">${money(liab ? -b : b)}</span>
      ${util !== null ? `<span style="flex-basis:100%">${progress(util)}</span>` : ''}</button>`;
  }).join('');
  return `<header class="page-head"><div class="row"><a class="icon-btn sm" href="#/more" aria-label="Back">‹</a><h1>Accounts</h1></div><button class="icon-btn sm" data-act="new-acc" aria-label="Add account">+</button></header>
  <section class="card hero"><p class="muted small" style="font-weight:700">Net worth</p><p class="big num ${tot.netWorth < 0 ? 'neg' : ''}">${money(tot.netWorth)}</p>
    <div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b class="pos num">${moneyShort(tot.assets)}</b><span>Assets</span></div><div class="stat"><b class="num ${tot.owed > 0 ? 'neg' : ''}">${moneyShort(tot.owed)}</b><span>Owed</span></div></div></section>
  <section class="stack"><div class="section-head"><h2>Money you have</h2></div><div class="list">${group(false) || '<p class="muted small" style="padding:0 4px">No accounts yet.</p>'}</div></section>
  <section class="stack"><div class="section-head"><h2>Cards & loans</h2></div><div class="list">${group(true) || '<p class="muted small" style="padding:0 4px">Add a credit card or loan to track what you owe.</p>'}</div></section>
  <button class="btn primary block" data-act="new-acc">+ Add account</button>`;
}

/* ---------- Bills / recurring ---------- */
export function bills() {
  const s = get();
  const list = [...s.recurring].sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  const exp = list.filter((r) => r.type === 'expense'), inc = list.filter((r) => r.type === 'income');
  const monthly = exp.reduce((n, r) => n + r.amount, 0), monthlyIn = inc.reduce((n, r) => n + r.amount, 0);
  return `<header class="page-head"><div class="row"><a class="icon-btn sm" href="#/more" aria-label="Back">‹</a><h1>Bills & EMIs</h1></div><button class="icon-btn sm" data-act="new-rec" aria-label="Add recurring">+</button></header>
  ${list.length ? `<div class="card flat-inset stats" style="grid-template-columns:1fr 1fr;gap:16px"><div><p class="small muted">Monthly obligations</p><b class="font-display num">${money(monthly)}</b></div><div><p class="small muted">Expected income</p><b class="font-display num pos">${money(monthlyIn)}</b></div></div>
    ${exp.length ? `<section class="stack"><div class="section-head"><h2>Bills & EMIs</h2></div><div class="list">${exp.map((r) => billRow(r, true)).join('')}</div></section>` : ''}
    ${inc.length ? `<section class="stack"><div class="section-head"><h2>Recurring income</h2></div><div class="list">${inc.map((r) => billRow(r, true)).join('')}</div></section>` : ''}`
    : empty('🗓️', 'No recurring items', 'Add rent, EMIs, subscriptions or your salary. Kharcha will remind you what’s due and set it aside in your budget.')}
  <button class="btn primary block" data-act="new-rec">+ Add recurring</button>
  <p class="small muted" style="text-align:center">Tapping “Mark paid” records the transaction today and moves the due date to next month.</p>`;
}

/* ---------- Reports ---------- */
function barChart(months) {
  const W = 340, H = 170, pad = 22, max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const gw = (W - 10) / months.length, bw = Math.min(16, gw / 3);
  const hh = (v) => Math.max(v > 0 ? 3 : 0, (v / max) * (H - pad - 14));
  const summary = months.map((m) => `${monthShort(m.k)}: income ${money(m.income)}, expenses ${money(m.expense)}`).join('; ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income versus expenses, last ${months.length} months. ${esc(summary)}">
    <line x1="5" x2="${W - 5}" y1="${H - pad}" y2="${H - pad}" stroke="rgb(163 177 198 / .7)" stroke-width="2" stroke-linecap="round"/>
    ${months.map((m, i) => {
      const cx = 5 + gw * i + gw / 2, h1 = hh(m.income), h2 = hh(m.expense);
      return `<rect x="${cx - bw - 2}" y="${H - pad - h1}" width="${bw}" height="${h1}" rx="${Math.min(6, bw / 2)}" fill="#1F8A84"/>
        <rect x="${cx + 2}" y="${H - pad - h2}" width="${bw}" height="${h2}" rx="${Math.min(6, bw / 2)}" fill="#5148D8"/>
        <text x="${cx}" y="${H - 5}" text-anchor="middle" font-size="11" font-weight="500" fill="#6B7280">${monthShort(m.k)}</text>`;
    }).join('')}</svg>`;
}

export function reports() {
  const s = get(), k = ui.month, st = monthStats(k);
  const spend = categorySpend(k), prevSpend = categorySpend(shiftMonth(k, -1));
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  const rows = Object.entries(spend).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const months = [-5, -4, -3, -2, -1, 0].map((d) => { const mk = shiftMonth(k, d); return { k: mk, ...monthStats(mk) }; });
  let ess = 0, disc = 0;
  rows.forEach(([id, v]) => (category(id)?.essential ? (ess += v) : (disc += v)));

  const insights = [];
  if (rows.length) { const [id, v] = rows[0]; insights.push(`<b>${esc(category(id)?.name)}</b> is your biggest spend: ${money(v)} (${Math.round((v / total) * 100)}% of expenses).`); }
  Object.keys(spend).map((id) => ({ id, cur: spend[id], prev: prevSpend[id] || 0 })).filter((x) => x.prev >= 100 && x.cur > 0)
    .map((x) => ({ ...x, ch: ((x.cur - x.prev) / x.prev) * 100 })).filter((x) => Math.abs(x.ch) >= 15)
    .sort((a, b) => Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev)).slice(0, 3)
    .forEach((x) => insights.push(`<b>${esc(category(x.id)?.name)}</b> ${x.ch > 0 ? 'increased' : 'dropped'} <b class="${x.ch > 0 ? 'neg' : 'pos'}">${Math.abs(Math.round(x.ch))}%</b> compared with last month.`));
  if (st.rate !== null) insights.push(st.rate >= 20 ? `You saved <b class="pos">${Math.round(st.rate)}%</b> of your income. Nicely done.` : st.rate >= 0 ? `You saved ${Math.round(st.rate)}% of your income. A common target is 20%.` : `You spent <b class="neg">${money(-st.savings)}</b> more than you earned this month.`);

  const payees = {};
  monthTx(k).filter((t) => t.type === 'expense' && t.note).forEach((t) => { const key = t.note.trim().toLowerCase(); (payees[key] ||= { name: t.note.trim(), sum: 0, n: 0 }); payees[key].sum += t.amount; payees[key].n++; });
  const top = Object.values(payees).sort((a, b) => b.sum - a.sum).slice(0, 5);

  return `<header class="page-head"><div class="row"><a class="icon-btn sm" href="#/more" aria-label="Back">‹</a><h1>Reports</h1></div></header>
  ${monthNav()}
  <section class="card stack"><div class="between row"><h3>Income vs expenses</h3></div>${barChart(months)}
    <div class="legend"><span><i style="background:#1F8A84"></i>Income</span><span><i style="background:#5148D8"></i>Expenses</span></div></section>
  <section class="card stack"><h3>Insights</h3>${insights.length ? `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:10px">${insights.map((i) => `<li>${i}</li>`).join('')}</ul>` : '<p class="muted small">Add a few transactions to see insights here.</p>'}</section>
  <section class="card stack"><div class="between row"><h3>Where it went</h3><span class="num" style="font-weight:700">${money(total)}</span></div>
    ${rows.length ? rows.map(([id, v]) => { const c = category(id); const pct = (v / total) * 100; return `<div class="stack" style="gap:8px"><div class="between row small"><span>${c?.icon || ''} ${esc(c?.name || 'Unknown')}</span><span class="num"><b>${money(v)}</b> <span class="muted">· ${Math.round(pct)}%</span></span></div>${progress(pct, 'plain', c?.name || 'Category share')}</div>`; }).join('') : '<p class="muted small">No spending recorded this month.</p>'}</section>
  ${total > 0 ? `<section class="card stack"><h3>Essential vs discretionary</h3>
    <div class="stack" style="gap:8px"><div class="between row small"><span>Essential</span><b class="num">${money(ess)} · ${Math.round((ess / total) * 100)}%</b></div>${progress((ess / total) * 100, 'teal')}</div>
    <div class="stack" style="gap:8px"><div class="between row small"><span>Discretionary</span><b class="num">${money(disc)} · ${Math.round((disc / total) * 100)}%</b></div>${progress((disc / total) * 100)}</div></section>` : ''}
  ${top.length ? `<section class="card stack"><h3>Top payees</h3><p class="small muted" style="margin-top:-8px">Grouped by the note you add to expenses.</p>${top.map((p) => `<div class="kv small"><span>${esc(p.name)} <span class="muted">×${p.n}</span></span><b class="num">${money(p.sum)}</b></div>`).join('')}</section>` : ''}
  <button class="btn block" data-act="export-csv">⬇️ Export transactions (CSV)</button>`;
}

/* ---------- More / Settings ---------- */
export function more() {
  const link = (href, icon, title, sub) => `<a class="item" href="${href}"><span class="well sm">${icon}</span><span class="grow"><span class="title" style="display:block">${title}</span><span class="meta" style="display:block">${sub}</span></span><span aria-hidden="true">›</span></a>`;
  return `<header class="page-head"><h1>More</h1></header>
  <div class="list">
    ${link('#/accounts', '🏦', 'Accounts', 'Cash, banks, cards, loans & net worth')}
    ${link('#/bills', '🗓️', 'Bills & EMIs', 'Recurring payments and salary')}
    ${link('#/reports', '📈', 'Reports', 'Trends, categories and insights')}
    ${link('#/settings', '⚙️', 'Settings', 'App lock, backup, export')}
  </div>${installCard()}`;
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function installCard() {
  if (standalone()) return '';
  if (ui.installPrompt) return `<div class="card install-card"><span class="well">📲</span><span class="grow"><h3>Install Kharcha</h3><p class="small muted">Works offline, opens full-screen.</p></span><button class="btn primary sm" data-act="install">Install</button></div>`;
  if (isIOS()) return `<div class="card install-card"><span class="well">📲</span><span class="grow"><h3>Add to Home Screen</h3><p class="small muted">In Safari tap the <b>Share</b> button (the square with an arrow pointing up), then <b>Add to Home Screen</b>. Install <b>before</b> adding data: the home-screen app keeps its own storage.</p></span></div>`;
  return `<div class="card install-card"><span class="well">📲</span><span class="grow"><h3>Install the app</h3><p class="small muted">On Android open the browser menu <b>⋮</b> and choose <b>Install app</b>. On a computer use the install icon in the address bar.</p></span></div>`;
}

export function settings() {
  const set = (act, icon, title, sub, extra = '') => `<button class="item ${extra}" data-act="${act}"><span class="well sm">${icon}</span><span class="grow"><span class="title" style="display:block">${title}</span><span class="meta" style="display:block">${sub}</span></span></button>`;
  const locked = isLockSet();
  return `<header class="page-head"><div class="row"><a class="icon-btn sm" href="#/more" aria-label="Back">‹</a><h1>Settings</h1></div></header>
  <section class="stack"><div class="section-head"><h2>Privacy</h2></div><div class="list">
    ${lockAvailable() ? set('lock-set', '🔒', locked ? 'Change PIN' : 'Set app lock', locked ? 'App asks for your PIN on open' : 'Ask for a 4-digit PIN when the app opens') : '<p class="small muted">App lock needs a secure (https) connection.</p>'}
    ${locked ? set('lock-off', '🔓', 'Turn off app lock', 'Remove the PIN') : ''}
  </div><p class="small muted" style="padding:0 4px">All data stays on this device. Nothing is sent to a server. The PIN is a casual lock that hides the app; it does not encrypt the stored data.</p></section>
  <section class="stack"><div class="section-head"><h2>Data</h2></div><div class="list">
    ${set('categories', '🏷️', 'Categories', 'Add or edit categories')}
    ${set('export-csv', '📄', 'Export CSV', 'All transactions, opens in Excel / Sheets')}
    ${set('backup', '💾', 'Back up data', get().settings.lastBackup ? `Last backup: ${fmtDate(get().settings.lastBackup)}` : 'Download a full JSON backup. Do this regularly.')}
    ${set('restore', '♻️', 'Restore backup', 'Replace current data from a backup file')}
    ${set('clear', '🗑️', 'Clear all data', 'Delete everything on this device', '')}
  </div><input type="file" id="restore-file" accept="application/json,.json" hidden></section>
  ${installCard()}
  <p class="small muted" style="text-align:center">Kharcha · works offline · ${get().transactions.length} transactions stored</p>`;
}

export const routes = { home, activity, budgets, accounts, bills, reports, more, settings };
export const tabFor = { home: 'home', activity: 'activity', budgets: 'budgets', more: 'more', accounts: 'more', bills: 'more', reports: 'more', settings: 'more' };
