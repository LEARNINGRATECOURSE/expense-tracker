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
