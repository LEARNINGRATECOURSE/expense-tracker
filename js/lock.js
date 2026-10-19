import { $, uid } from './util.js';
import { get, commit } from './store.js';

const enc = new TextEncoder();
async function hash(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const lockAvailable = () => !!globalThis.crypto?.subtle;
export const isLockSet = () => !!get().settings.lock;
export async function setPin(pin) {
  const salt = uid();
  const h = await hash(pin, salt);
  commit((s) => { s.settings.lock = { salt, hash: h }; });
}
export const removePin = () => commit((s) => { s.settings.lock = null; });
export async function checkPin(pin) {
  const l = get().settings.lock;
  return !!l && (await hash(pin, l.salt)) === l.hash;
}

let open = false;
let mode = null;        // 'unlock' while the mandatory lock pad is up
let cancelCurrent = null;
export const isLocked = () => open && mode === 'unlock';

const root = document.documentElement;
const setInert = (on) => {
  $('#app').inert = on || !$('#sheet').hidden;
  $('#sheet').inert = on;
};

/** Full-screen PIN pad. Resolves with the PIN once `validate` accepts it, or null if cancelled. */
export function askPin({ title, sub = '', cancelable = false, validate = async () => true, lockMode = false }) {
  const el = $('#lock');
  open = true;
  mode = lockMode ? 'unlock' : 'ask';
  el.hidden = false;
  setInert(true);
  let pin = '', busy = false;
  el.innerHTML = `
    <div class="lock-box" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="well float" style="width:72px;height:72px;font-size:2rem;border-radius:24px" aria-hidden="true">🔒</div>
      <div><h1 class="font-display" style="font-size:1.5rem">${title}</h1><p class="muted small" id="lk-sub" role="status" style="margin-top:6px">${sub}</p></div>
      <div class="dots" id="lk-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="btn" data-k="${n}" aria-label="${n}">${n}</button>`).join('')}
        ${cancelable ? '<button class="btn" data-k="x" style="font-size:.95rem">Cancel</button>' : '<span></span>'}
        <button class="btn" data-k="0" aria-label="0">0</button>
        <button class="btn" data-k="del" aria-label="Delete">⌫</button>
      </div>
    </div>`;
  const dots = $('#lk-dots', el);
  const subEl = $('#lk-sub', el);
  const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < pin.length));
  return new Promise((resolve) => {
    const done = (v) => {
      document.removeEventListener('keydown', onKey);
      open = false; mode = null; cancelCurrent = null;
      el.hidden = true; el.innerHTML = ''; el.onclick = null;
      root.classList.remove('locked');
      setInert(false);
      resolve(v);
    };
    cancelCurrent = () => done(null);
    const press = async (k) => {
      if (busy) return;
      if (k === 'x') return cancelable && done(null);
      if (k === 'del') pin = pin.slice(0, -1);
      else if (pin.length < 4) pin += k;
      paint();
      if (pin.length === 4) {
        busy = true;
        if (await validate(pin)) return done(pin);
        subEl.textContent = 'That PIN didn’t match. Try again.';
        dots.classList.add('shake');
        navigator.vibrate?.(80);
        setTimeout(() => { dots.classList.remove('shake'); pin = ''; paint(); busy = false; }, 400);
      }
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Escape') press('x');
    };
    document.addEventListener('keydown', onKey);
    el.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); };
    requestAnimationFrame(() => el.querySelector('[data-k="1"]')?.focus({ preventScroll: true }));
  });
}

export const unlock = () => askPin({ title: 'Kharcha is locked', sub: 'Enter your 4-digit PIN', validate: checkPin, lockMode: true });

/** Always (re-)lock: also dismisses any cancelable PIN pad, so cancelling it cannot reveal the app. */
export function lockNow() {
  if (!isLockSet() || isLocked()) return;
  if (open) cancelCurrent?.();
  return unlock();
}

/** Set (or change) the PIN: enter twice. Returns true on success. */
export async function createPin() {
  let first;
  for (;;) {
    first = await askPin({ title: 'Choose a PIN', sub: '4 digits to open the app', cancelable: true });
    if (first === null) return false;
    const again = await askPin({ title: 'Confirm PIN', sub: 'Enter it once more', cancelable: true, validate: async (p) => p === first });
    if (again === null) return false;
    await setPin(first);
    return true;
  }
}
