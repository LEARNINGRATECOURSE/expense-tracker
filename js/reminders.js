import { billsDueSoon } from './store.js';
import { fmtDate, todayISO } from './util.js';

/* Bill reminders. Notifications can only be shown while the app is running or has been
   opened: a truly closed-app alert needs a server-sent Web Push, which this offline-only app doesn't have.
   Which bills were already notified is kept per device, not in the backup. */
const KEY = 'kharcha.notified';
const readSeen = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const writeSeen = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked: may repeat a notice */ } };

export const reminderStatus = () => {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;   // 'granted' | 'denied' | 'default'
};

export async function enableReminders() {
  if (!('Notification' in window)) return 'unsupported';
  const result = await Notification.requestPermission();
  if (result === 'granted') checkReminders();
  return result;
}

async function show(title, body, tag) {
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { hash: '#/bills' } };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) return reg.showNotification(title, opts);
  } catch { /* fall through to the page API */ }
  return new Notification(title, opts);
}

/** Notify once per bill per due date for bills that are overdue or due soon. Call on open and on resume. */
export function checkReminders(days = 3) {
  if (reminderStatus() !== 'granted') return;
  const seen = readSeen(), next = {};
  for (const { r, diff } of billsDueSoon(days)) {
    const key = `${r.id}:${r.nextDue}`;
    next[key] = todayISO();
    if (seen[key]) continue;
    const when = diff < 0 ? `overdue by ${-diff} day${-diff > 1 ? 's' : ''}` : diff === 0 ? 'due today' : `due in ${diff} day${diff > 1 ? 's' : ''} (${fmtDate(r.nextDue)})`;
    show(`Bill ${diff < 0 ? 'overdue' : 'reminder'}: ${r.name}`, `${r.name} is ${when}.`, key).catch(() => {});
  }
  writeSeen(next);   // keeps only the bills still due soon, so the list stays small
}
