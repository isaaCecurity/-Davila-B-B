/* ==========================================================================
   BAKEFLOW — Shell: state, router, navigation, sheets, toasts, helpers
   ========================================================================== */

const APP = {
  role: 'owner',
  org: DB.orgs[0],
  branch: 'Ikeja',
  viewBranch: 'All',       // owner-only: which branch's data to scope screens to
  sync: 'synced',          // synced | syncing | offline | attention
  queued: 0,
  stack: [],               // [{name, params}]
  tab: 'home',
  draft: null,             // in-flight ticket / order / expense
  sale: null,              // in-flight salesperson counter sale
  cashCounted: null,
  orderStates: {},         // id -> overridden status
  demo: { finPeriod: '30d', salesFilter: 'all' },
  unreadIds: new Set(['n1', 'n9', 'n15', 'n17', 'n21']),  // unread notification ids
  theme: localStorage.getItem('bakeflow-theme') || 'system',
};

function branchMatch(b) { return APP.role !== 'owner' || APP.viewBranch === 'All' || b === APP.viewBranch; }
/* Best-effort branch lookup from a first name — several mock datasets (sales
   rows, activity) only carry a staff first name, not a branch. */
function staffBranchByFirst(first) {
  const s = DB.staffList.find(x => x.name.split(' ')[0] === first);
  return s ? s.branch : null;
}

const $  = (s, r = document) => r.querySelector(s);

const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function user() { return DB.users[APP.role]; }
function orderStatus(o) { return APP.orderStates[o.id] || o.status; }

/* ------------------------------------------------------------- THEME --- */
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)');
APP.reducedMotion = prefersReduced.matches;
prefersReduced.addEventListener('change', e => { APP.reducedMotion = e.matches; });

function resolvedTheme(pref) { return pref === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref; }
function applyTheme(pref) {
  APP.theme = pref;
  localStorage.setItem('bakeflow-theme', pref);
  if (resolvedTheme(pref) === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (APP.theme === 'system') applyTheme('system'); });

/* -------------------------------------------------------------- AUDIT --- */
function logAudit(action, detail, entity) {
  DB.auditLog.unshift({ id:'al' + Date.now(), time:'Just now', actor:user().name, role:user().title, action, detail, entity });
}

/* ------------------------------------------------------------- ROUTER --- */
/* Screens register themselves into SCREENS:
   SCREENS.name = { tab, render(params) -> html, mount(el, params) }         */
const SCREENS = {};

function screensHost() { return $('#screens'); }

function currentEl() { const all = $$('#screens > .screen:not([hidden])'); return all[all.length - 1]; }

/**
 * Navigate.
 * @param {string} name
 * @param {object} params
 * @param {'push'|'replace'|'tab'|'fade'|'root'} mode
 */
function nav(name, params = {}, mode = 'push') {
  const def = SCREENS[name];
  if (!def) { console.warn('No screen:', name); return; }
  const host = screensHost();
  const prev = currentEl();

  const el = document.createElement('section');
  el.className = 'screen';
  el.dataset.screen = name;
  host.appendChild(el);

  const paint = () => {
    el.innerHTML = def.render(params) || '';
    def.mount?.(el, params);
    wireScroll(el);
    wireCommon(el);
  };

  if (mode === 'root' || mode === 'replace') APP.stack = [{ name, params }];
  else if (mode === 'tab') APP.stack = [{ name, params }];
  else APP.stack.push({ name, params });

  if (def.tab) APP.tab = def.tab;
  renderTabbar();

  const inCls  = mode === 'push' ? 'anim-push-in' : (mode === 'tab' ? 'anim-tab-in' : 'anim-fade-in');
  const outCls = mode === 'push' ? 'anim-push-out' : 'anim-fade-out';
  el.classList.add(inCls);
  if (prev) {
    prev.classList.add(outCls);
    const done = () => { prev.remove(); };
    prev.addEventListener('animationend', done, { once: true });
    setTimeout(done, 480);
  }
  el.addEventListener('animationend', () => el.classList.remove(inCls), { once: true });

  withSkeleton(name, el, paint);
  return el;
}

function back() {
  if (APP.stack.length < 2) return;
  APP.stack.pop();
  const { name, params } = APP.stack[APP.stack.length - 1];
  const def = SCREENS[name];
  const host = screensHost();
  const prev = currentEl();

  const el = document.createElement('section');
  el.className = 'screen anim-pop-in';
  el.dataset.screen = name;
  host.insertBefore(el, prev);
  if (def.tab) { APP.tab = def.tab; renderTabbar(); }
  prev.classList.add('anim-pop-out');
  prev.addEventListener('animationend', () => prev.remove(), { once: true });
  setTimeout(() => prev.remove(), 420);
  withSkeleton(name, el, () => {
    el.innerHTML = def.render(params) || '';
    def.mount?.(el, params);
    wireScroll(el);
    wireCommon(el);
  });
}

/** Re-render the current screen in place (no animation). */
function refresh() {
  const cur = APP.stack[APP.stack.length - 1];
  if (!cur) return;
  const def = SCREENS[cur.name], el = currentEl();
  if (!def || !el) return;
  const sc = el.querySelector('.body')?.scrollTop || 0;
  el.innerHTML = def.render(cur.params) || '';
  def.mount?.(el, cur.params);
  wireScroll(el);
  wireCommon(el);
  const b = el.querySelector('.body'); if (b) b.scrollTop = sc;
}

/* ------------------------------------------------------------ TAB BAR --- */
const TABS = [
  { k:'home',    label:'Home',    icon:'home' },
  { k:'orders',  label:'Orders',  icon:'orders' },
  { k:'sales',   label:'Sales',   icon:'sales' },
  { k:'finance', label:'Finance', icon:'finance' },
  { k:'more',    label:'More',    icon:'grid' },
];
/* Role-adaptive primary navigation: the IA itself changes, not just visibility. */
const ROLE_TABS = {
  owner:   ['home','orders','sales','finance','more'],
  manager: ['home','orders','sales','cash','more'],
  staff:   ['home','mysales','mycash','settings'],
  supervisor: ['home','operations','staffmon','settings'],
  driver:  ['home','route','tickets','more'],
  baker:   ['home','production','notifications','settings'],
  admin:   ['home'],
};
const EXTRA_TABS = {
  cash:     { k:'cash',     label:'Cash',     icon:'cash',     screen:'cash' },
  route:    { k:'route',    label:'Routes',   icon:'truck',    screen:'route' },
  tickets:  { k:'tickets',  label:'Tickets',  icon:'ticket',   screen:'tickets' },
  mysales:  { k:'mysales',  label:'Sales',    icon:'sales',    screen:'my-sales' },
  mycash:   { k:'mycash',   label:'Cash',     icon:'cash',     screen:'my-cash' },
  settings: { k:'settings', label:'More', icon:'grid', screen:'settings' },
  operations:{ k:'operations', label:'Operations', icon:'layers', screen:'operations' },
  staffmon: { k:'staffmon', label:'Staff',    icon:'users',    screen:'staff' },
  production:{ k:'production', label:'Production', icon:'flame', screen:'production' },
  notifications:{ k:'notifications', label:'Alerts', icon:'bell', screen:'notifications' },
  profile:  { k:'profile',  label:'Profile',  icon:'user',     screen:'profile' },
};

function tabDef(k) { return TABS.find(t => t.k === k) || EXTRA_TABS[k]; }

function renderTabbar() {
  const host = $('#tabbar');
  const keys = ROLE_TABS[APP.role];
  const visible = SCREENS[APP.stack.at(-1)?.name]?.chrome !== false;
  host.hidden = !visible;
  if (!visible) return;
  const isDriver = APP.role === 'driver';
  host.classList.toggle('-fab', isDriver);
  const tabBtns = keys.map(k => {
    const t = tabDef(k);
    const on = APP.tab === k;
    const badge = k === 'orders' && DB.today.pending ? '<i class="tab-dot"></i>' : '';
    return `<button class="tab" role="tab" data-tab="${k}" aria-selected="${on}">
      ${badge}${icon(t.icon, 23)}<span>${t.label}</span></button>`;
  });
  if (isDriver) {
    /* Driver's whole job is logging a ticket, so that action gets the raised
       centre button instead of living in a tab slot. */
    tabBtns.splice(2, 0, `<div class="tab-fab-slot"></div>`);
    host.innerHTML = `<div class="fab-pill">${tabBtns.join('')}
      <button class="fab-btn" data-fab-nav="new-ticket" aria-label="New ticket">${icon('plus', 26, { stroke:2.4 })}</button>
    </div>`;
  } else {
    host.innerHTML = tabBtns.join('');
  }
  $$('#tabbar .tab').forEach(b => b.onclick = () => {
    const k = b.dataset.tab;
    if (k === APP.tab && APP.stack.length === 1) return;
    const screen = EXTRA_TABS[k]?.screen || k;
    nav(screen, {}, 'tab');
  });
  $('#tabbar [data-fab-nav]')?.addEventListener('click', () => nav($('#tabbar [data-fab-nav]').dataset.fabNav));
}

/* --------------------------------------------------------------- SHEET --- */
function sheet({ title, body, foot, grip = true, onMount, onClose, tall }) {
  closeSheet(true);
  const host = $('#overlays');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const s = document.createElement('div');
  s.className = 'sheet';
  if (tall) s.style.height = '86%';
  s.innerHTML = `
    ${grip ? '<div class="sheet-grip"><i></i></div>' : ''}
    ${title ? `<div class="sheet-head"><h3>${title}</h3><div class="spacer"></div>
      <button class="iconbtn" data-close aria-label="Close">${icon('close', 19)}</button></div>` : ''}
    <div class="sheet-body">${body}</div>
    ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
  host.append(scrim, s);
  scrim.onclick = () => closeSheet();
  $$('[data-close]', s).forEach(b => b.onclick = () => closeSheet());
  s._onClose = onClose;

  /* drag-to-dismiss on the grip */
  const grabber = $('.sheet-grip', s);
  if (grabber) {
    let y0 = null;
    grabber.addEventListener('pointerdown', e => { y0 = e.clientY; grabber.setPointerCapture(e.pointerId); });
    grabber.addEventListener('pointermove', e => {
      if (y0 === null) return;
      const dy = Math.max(0, e.clientY - y0);
      s.style.transition = 'none'; s.style.transform = `translateY(${dy}px)`;
      scrim.style.opacity = String(Math.max(.2, 1 - dy / 400));
    });
    grabber.addEventListener('pointerup', e => {
      if (y0 === null) return;
      const dy = e.clientY - y0; y0 = null;
      s.style.transition = 'transform 260ms var(--ease-out)';
      if (dy > 96) closeSheet(); else { s.style.transform = ''; scrim.style.opacity = ''; }
    });
  }
  wireCommon(s);
  onMount?.(s);
  return s;
}

function closeSheet(instant) {
  const s = $('#overlays .sheet'), d = $('#overlays .dialog'), scrim = $('#overlays .scrim');
  const cb = s?._onClose || d?._onClose;
  if (instant) { s?.remove(); d?.remove(); scrim?.remove(); return; }
  if (s) { s.classList.add('-closing'); s.addEventListener('animationend', () => s.remove(), { once:true }); }
  if (d) { d.classList.add('-closing'); d.addEventListener('animationend', () => d.remove(), { once:true }); }
  if (scrim) { scrim.classList.add('-closing'); scrim.addEventListener('animationend', () => scrim.remove(), { once:true }); }
  setTimeout(() => { s?.remove(); d?.remove(); scrim?.remove(); }, 320);
  cb?.();
}

function dialog({ body, onMount, onClose }) {
  closeSheet(true);
  const host = $('#overlays');
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const d = document.createElement('div'); d.className = 'dialog'; d.innerHTML = body;
  host.append(scrim, d);
  scrim.onclick = () => closeSheet();
  $$('[data-close]', d).forEach(b => b.onclick = () => closeSheet());
  d._onClose = onClose;
  wireCommon(d);
  onMount?.(d);
  return d;
}

/* --------------------------------------------------------------- ERROR --- */
/* Server errors are never shown raw — every code maps to plain language.
   The UI greys out illegal actions for usability, but every action is
   re-validated server-side; a stale screen offering something illegal
   gets one of these codes back, not a silent failure or a UI bypass. */
const ERROR_COPY = {
  invalid_transition: 'That is no longer possible — this has moved on, or is not ready yet. Pull to refresh.',
  insufficient_role: 'Only the assigned driver or a manager can do this.',
  session_expired: 'Your session has expired. Sign in again.',
  network_unavailable: 'No connection. This has not been saved.',
  invalid_request: 'Something in that request was not accepted. Check the details and try again.',
  refund_required: 'Record a refund before cancelling this order.',
  order_locked: "This order can't be changed once it's ready.",
  session_already_open: 'A till session is already open at this branch.',
  variance_note_required: 'Add a note explaining the difference.',
  insufficient_stock: 'Not enough stock for this.',
};
function apiError(code) {
  toast({ title: ERROR_COPY[code] || 'That did not work. Nothing has been changed.', kind: 'err' });
}

/* --------------------------------------------------------------- TOAST --- */
/* Header height varies per screen (appbar copy, sync chip, or none at all on
   chrome:false screens like login), so the toast slot can't use one fixed
   offset — it reads the live screen's own header and sits just under it. */
function positionToastHost() {
  const host = $('#toasts');
  const viewport = host.closest('.viewport');
  const active = $$('.screen', viewport).find(s => !s.hidden);
  const bar = active && active.querySelector('.appbar, .greet, .login-head');
  const vTop = viewport.getBoundingClientRect().top;
  const clear = bar ? bar.getBoundingClientRect().bottom - vTop + 10 : 44 + 14;
  host.style.top = Math.max(44 + 14, clear) + 'px';
}
const TOAST_CAP = 3;
const TOAST_KIND_DEFAULT = {
  ok:   { letter: '\u2713', color: 'var(--success)' },
  warn: { letter: '!',      color: 'var(--warning)' },
  err:  { letter: '!',      color: 'var(--error)' },
  sync: { letter: '~',      color: 'var(--info)' },
  info: { letter: 'i',      color: 'var(--info)' },
};
function layoutToastStack() {
  const host = $('#toasts');
  const toasts = $$('.toast', host).filter(t => !t.classList.contains('-out'));
  toasts.forEach((t, i) => { t.style.display = i < TOAST_CAP ? '' : 'none'; });
  const hidden = Math.max(0, toasts.length - TOAST_CAP);
  let peek = $('.toast-peek', host);
  if (hidden > 0) {
    if (!peek) {
      peek = document.createElement('div');
      peek.className = 'toast-peek';
      peek.onclick = () => nav('notifications');
      host.appendChild(peek);
    }
    peek.textContent = `+${hidden} more`;
  } else if (peek) peek.remove();
}
function toast(opt) {
  const o = typeof opt === 'string' ? { title: opt } : opt;
  const { title, text, kind = 'ok', ms = 4000, action, letter, color } = o;
  positionToastHost();
  const host = $('#toasts');
  const fallback = TOAST_KIND_DEFAULT[kind] || TOAST_KIND_DEFAULT.ok;
  const glyphLetter = letter || fallback.letter, glyphColor = color || fallback.color;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="t-ico" style="color:${glyphColor}">${glyphLetter}</span>
    <span class="t-txt">${title ? `<b>${title}</b>` : ''}${text ? `<em>${text}</em>` : ''}
      ${action ? `<button class="t-action" style="border-color:${glyphColor};color:${glyphColor}">${action.label}</button>` : ''}
    </span>`;
  const dismiss = () => { el.classList.add('-out'); setTimeout(() => { el.remove(); layoutToastStack(); }, 240); };
  host.prepend(el);
  layoutToastStack();
  if (action) $('.t-action', el).onclick = () => { action.onClick(); dismiss(); };
  setTimeout(dismiss, ms);
}

/* ------------------------------------------------- number animation --- */
/** Count a money figure up to its value — used when periods/orgs change. */
function animateFigure(el, to, fmt = money, dur = 620) {
  const from = +(el.dataset.v || 0);
  el.dataset.v = to;
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function animateAll(root) {
  $$('[data-figure]', root).forEach(el => {
    const to = +el.dataset.figure;
    const short = el.dataset.short === '1';
    el.dataset.v = el.dataset.from || 0;
    animateFigure(el, to, short ? moneyShort : (el.dataset.plain === '1' ? (n => Math.round(n).toLocaleString('en-NG')) : money));
  });
}

/* ---------------------------------------------------------- UNDO TOAST ---
   Reversible actions get a 5-second window instead of a confirm dialog:
   one tap forward, one tap back. Audit-logged actions (remove staff, close
   cash session, submit daily audit) deliberately do NOT use this — undoing
   them would rewrite a trail other people may already have acted on, so
   they take a confirm step up front instead. */
function undoToast({ title, text, onUndo, ms = 5000 }) {
  toast({ title, text, kind: 'ok', ms, action: { label: 'Undo', onClick: onUndo } });
}

/* ------------------------------------------------------------ SKELETONS ---
   Only the screens that assemble real figures get one — Finance, Reports and
   P&L each pull several derived totals. Everything else renders instantly, so
   a skeleton there would invent a wait that does not exist. Each block echoes
   the height of the thing it stands in for, so nothing shifts on swap. */
const SKELETONS = {
  finance: `<div class="body skel-stack">
    <div class="skel -text" style="width:38%"></div>
    <div class="skel -figure" style="width:64%"></div>
    <div class="skel -chart"></div>
    <div class="skel -row"></div><div class="skel -row"></div>
  </div>`,
  pnl: `<div class="body skel-stack">
    <div class="skel -text" style="width:30%"></div>
    <div class="skel -figure" style="width:58%"></div>
    <div class="skel -row"></div><div class="skel -row"></div><div class="skel -row"></div>
  </div>`,
  reports: `<div class="body skel-stack">
    <div class="skel -title" style="width:44%"></div>
    <div class="skel -row"></div><div class="skel -row"></div><div class="skel -row"></div>
  </div>`
};

/** Paints a screen's skeleton, then swaps in the real markup after a short,
    deliberate beat — long enough to read as loading, short enough not to be
    a wait. Skipped entirely under reduced-motion. */
function withSkeleton(name, el, paint) {
  const mock = SKELETONS[name];
  if (!mock || APP.reducedMotion) { paint(); return; }
  el.innerHTML = mock;
  setTimeout(paint, 340);
}

/* -------------------------------------------------------- CONFIRM SHEET ---
   For the consequential, audit-logged actions. `typeToConfirm` requires the
   exact phrase before the button unlocks — used for removing a staff member,
   where a mis-tap costs someone their access. */
function confirmSheet({ title, body, confirmLabel, tone = '-primary', typeToConfirm, onConfirm }) {
  sheet({
    title,
    body: `<p class="meta" style="line-height:1.5">${body}</p>
      ${typeToConfirm ? `<label class="field" style="margin-top:var(--s-4)">
        <span class="f-label">Type <b style="color:var(--cocoa)">${esc(typeToConfirm)}</b> to confirm</span>
        <input class="f-ctl" id="cf-type" autocomplete="off" autocapitalize="off" spellcheck="false">
      </label>` : ''}`,
    foot: `<button class="btn ${tone} -block -lg" id="cf-go"${typeToConfirm ? ' disabled data-hint="Type the name above to unlock this"' : ''}>${confirmLabel}</button>`,
    onMount(s) {
      const go = $('#cf-go', s);
      if (typeToConfirm) {
        const inp = $('#cf-type', s);
        inp.oninput = () => {
          go.disabled = inp.value.trim().toLowerCase() !== typeToConfirm.toLowerCase();
          wireDisabledHints(s);
        };
        setTimeout(() => inp.focus(), 80);
      }
      go.onclick = () => { closeSheet(); onConfirm(); };
      wireDisabledHints(s);
    }
  });
}

/* ---------------------------------------------- disabled-button hinting ---
   A dead button teaches nothing. Any disabled [data-hint] button gets a line
   beneath it naming what is still missing, and loses it once satisfied. */
function wireDisabledHints(root) {
  $$('button[data-hint]', root).forEach(b => {
    let hint = b.nextElementSibling;
    if (!hint || !hint.classList?.contains('btn-hint')) {
      hint = document.createElement('p');
      hint.className = 'btn-hint';
      b.after(hint);
    }
    hint.textContent = b.dataset.hint;
    hint.hidden = !b.disabled;
  });
}

/* ------------------------------------------------------ common wiring --- */
function wireScroll(el) {
  const body = $('.body', el), bar = $('.appbar', el);
  if (!body || !bar) return;
  body.addEventListener('scroll', () => {
    bar.classList.toggle('is-stuck', body.scrollTop > 8);
  }, { passive: true });
}

/** data-nav / data-back / data-sheet / data-toast / data-toggle wiring. */
function wireCommon(root) {
  wireDisabledHints(root);
  $$('[data-nav]', root).forEach(b => {
    if (b._w) return; b._w = 1;
    b.onclick = (e) => {
      e.stopPropagation();
      if ($('#overlays .sheet')) closeSheet();
      const p = b.dataset.navParams ? JSON.parse(b.dataset.navParams) : {};
      setTimeout(() => nav(b.dataset.nav, p, b.dataset.navMode || 'push'), $('#overlays .sheet') ? 180 : 0);
    };
  });
  $$('[data-back]', root).forEach(b => { if (b._w) return; b._w = 1; b.onclick = () => back(); });
  $$('[data-close-sheet]', root).forEach(b => { if (b._w) return; b._w = 1; b.onclick = () => closeSheet(); });
  $$('[data-toast]', root).forEach(b => {
    if (b._w) return; b._w = 1;
    b.onclick = () => toast({ title: b.dataset.toast, text: b.dataset.toastText || '', kind: b.dataset.toastKind || 'ok' });
  });
  $$('.switch', root).forEach(sw => {
    if (sw._w) return; sw._w = 1;
    sw.onclick = () => sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
  });
  $$('.segmented', root).forEach(seg => {
    if (seg._w) return; seg._w = 1;
    const thumb = $('.seg-thumb', seg), btns = $$('button', seg);
    const place = () => {
      const on = btns.find(b => b.getAttribute('aria-pressed') === 'true') || btns[0];
      if (!thumb || !on) return;
      thumb.style.width = `${on.offsetWidth}px`;
      thumb.style.transform = `translateX(${on.offsetLeft - 3}px)`;
    };
    btns.forEach(b => b.addEventListener('click', () => {
      btns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      place();
    }));
    requestAnimationFrame(place);
  });
  /* chip groups: single-select within [data-chipgroup] */
  $$('[data-chipgroup]', root).forEach(g => {
    if (g._w) return; g._w = 1;
    $$('.chip', g).forEach(c => c.addEventListener('click', () => {
      $$('.chip', g).forEach(x => x.setAttribute('aria-pressed', String(x === c)));
      g.dispatchEvent(new CustomEvent('chipchange', { detail: c.dataset.val }));
    }));
  });
  animateAll(root);
}

/* -------------------------------------------------- sync simulation --- */
function setSync(state, queued = 0) {
  APP.sync = state; APP.queued = queued;
  $$('[data-sync-host]').forEach(h => h.outerHTML = syncChip());
  refresh();
}
function syncChip() {
  const map = {
    synced:    { cls:'-synced',    ico:'check',      txt:'Synced' },
    syncing:   { cls:'-syncing',   ico:'refresh',    txt:'Syncing…' },
    offline:   { cls:'-offline',   ico:'wifiOff',    txt: APP.queued ? `${APP.queued} waiting` : 'Offline' },
    attention: { cls:'-attention', ico:'alert',      txt:'Needs attention' },
  };
  const m = map[APP.sync];
  return `<button class="sync ${m.cls}" data-sync-host data-open-sync aria-label="Connection status: ${m.txt}">
    <span class="s-glyph">${icon(m.ico, 13, { stroke: 2.1 })}</span>${m.txt}</button>`;
}

/* Delegated: any sync chip opens the sync sheet. */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-open-sync]');
  if (b) syncSheet();
});

/* --------------------------------------------------------- appbar bits --- */
function appbar({ title, back: hasBack = true, right = '', sub = '' }) {
  return `<header class="appbar">
    ${hasBack ? `<button class="iconbtn" data-back aria-label="Back">${icon('chevLeft', 21)}</button>` : ''}
    <div style="min-width:0"><h2>${title}</h2>${sub ? `<div class="meta">${sub}</div>` : ''}</div>
    <div class="spacer"></div>${right}
  </header>`;
}

function openBranchPicker() {
  const options = ['All', ...APP.org.branches];
  sheet({
    title: 'View branch',
    body: `<div class="list">${options.map(b => `<button class="li" data-pick-branch="${b}" style="width:100%;text-align:left">
        <span class="itile -sm ${b === APP.viewBranch ? '-accent' : ''}">${icon(b === 'All' ? 'grid' : 'store', 16)}</span>
        <span class="li-main"><b>${b === 'All' ? 'All branches' : b}</b></span>
        ${b === APP.viewBranch ? `<span class="chev">${icon('check', 16)}</span>` : ''}
      </button>`).join('')}</div>`,
    foot: `<button class="btn -secondary -block" data-close>Cancel</button>`,
    onMount(s) {
      $$('[data-pick-branch]', s).forEach(b => b.onclick = () => {
        APP.viewBranch = b.dataset.pickBranch;
        closeSheet();
        setTimeout(refresh, 220);
      });
    }
  });
}
document.addEventListener('click', e => { if (e.target.closest('[data-open-branch-picker]')) openBranchPicker(); });


function statusBadge(status) {
  const s = STATUS[status]; if (!s) return '';
  return `<span class="badge ${s.cls}">${icon(s.icon, 11, { stroke: 2.2 })}${s.label}</span>`;
}
function payBadge(p) {
  const s = PAYSTATE[p]; if (!s) return '';
  return `<span class="badge ${s.cls}">${icon(s.icon, 11, { stroke: 2.2 })}${s.label}</span>`;
}
function deltaChip(v, onDark = false) {
  const cls = `${v < 0 ? '-down ' : ''}${onDark ? '-on-dark' : ''}`;
  return `<span class="delta ${cls}">${icon(v < 0 ? 'trendDown' : 'trendUp', 11, { stroke: 2.2 })}${pct(v)}</span>`;
}

/* ------------------------------------------------------------- BOOT --- */
/* Deep-link support for review. The hash accepts a screen, an optional role,
   or both, so any state can be linked to directly:
     #finance            a screen
     #driver             a role, opening that role's home
     #driver/route       both
   #splash holds the launch screen instead of auto-advancing. */
function boot() {
  applyTheme(APP.theme);
  const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
  const parts = raw.split('/').filter(Boolean);

  /* A leading role segment re-roots the whole IA before anything renders. */
  if (parts[0] && ROLE_TABS[parts[0]]) {
    APP.role = parts.shift();
    APP.tab = ROLE_TABS[APP.role][0];
  }

  const want = parts[0];
  renderTabbar();

  if (want && SCREENS[want] && want !== 'splash') {
    const def = SCREENS[want];
    if (def.tab) APP.tab = def.tab;
    nav(want, {}, 'root');
    return;
  }
  /* A bare role link lands on that role's home, skipping the launch sequence. */
  if (!want && APP.role !== 'owner') { nav('home', {}, 'root'); return; }

  nav('splash', { hold: want === 'splash' }, 'root');
}
document.addEventListener('DOMContentLoaded', boot);
