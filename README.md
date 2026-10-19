# Kharcha – personal expense tracker (PWA)

Offline-first, privacy-first expense tracker for phones (Android + iOS), styled with a Neumorphism (Soft UI) design system.
No build step, no dependencies, no server: all data lives in the device's `localStorage`.

## Run
```
python3 -m http.server 8080   # or any static server
```
Open http://localhost:8080. A service worker needs `https` or `localhost`; deploy the folder to any static host (Netlify, GitHub Pages, Cloudflare Pages).

## Install
- **Android (Chrome):** menu ⋮ → *Install app* (or the in-app Install button).
- **iOS (Safari):** Share → *Add to Home Screen*.

## Features
Dashboard, fast entry (+ natural-language / voice quick add), income / expense / transfer / refund as distinct types,
multiple accounts (cash, bank, UPI, credit cards, loans) with net worth, category + overall budgets with 50/80/100% alerts,
recurring bills / EMIs / salary with paid / due / overdue status, reports (6-month trend, categories, essential vs discretionary,
insights, top payees), CSV export, JSON backup / restore, PIN app lock.

Accounting rule: card payments and EMIs are **transfers** to a liability account, so they are never double-counted as spending.

## Deploy (GitHub Pages)
Settings → Pages → Source: **GitHub Actions**, then merge to `main` (or run the workflow manually from an allowed branch).
The workflow stamps a fresh service-worker cache name on every deploy so installed apps update themselves.

## Adding income
Home → **＋ Income**, or the **+** button → *Income* tab, or type `salary 85000` in Quick add.
Recurring salary: More → Bills & EMIs → *Income* → **Received** each month.

## Bills, reminders and goals
- **Mark paid** records one payment on the bill's due date and moves to the next due date.
- **Catch up all** records every missed month, each on its own due date, so each month's budget is right.
- **Bill reminders** (Settings → Bill reminders): alerts for bills overdue or due within 3 days, shown when the app opens or comes back to the front. Alerts for a closed app need a server-sent push, which this offline-only app does not have. On iPhone, add the app to the Home Screen first.
- **Savings goals** (More → Savings goals): earmarked money with a target, optional deadline and a monthly target. Goals don't move money between accounts.
