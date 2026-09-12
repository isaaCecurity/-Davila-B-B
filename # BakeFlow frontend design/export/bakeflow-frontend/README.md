# BakeFlow — Frontend

Mobile-first operations frontend for a multi-branch bakery business. Orders,
sales, cash, expenses, production and delivery across six roles.

**No build step.** Plain HTML, CSS and JavaScript. No bundler, no framework, no
`npm install` required to run it.

---

## Run it

Any static file server works. From this folder:

```bash
npx serve .          # then open the printed URL
# or
python3 -m http.server 5173
# or
php -S localhost:5173
```

Then open <http://localhost:5173>.

> Open `index.html` via a **server**, not `file://` — the app fetches sibling
> files and `file://` blocks that in most browsers.

On a phone-width viewport you get the app alone. On tablet/desktop you also get
a companion panel with a role switcher, so you can jump between all six roles
without signing out.

---

## What's in here

```
index.html              app shell — phone frame, status bar, tab bar, overlay hosts
design-system.html      living style reference (tokens, components, icons)

css/
  tokens.css            colour, type, spacing, elevation, motion + dark theme
  app.css               shell, screen transitions, layout primitives
  components.css        every reusable component (buttons, cards, sheets, lists…)
  ds.css                styles for design-system.html only

js/
  data.js               ALL mock data + domain constants  ← backend seam
  icons.js              icon path set + icon() / brandMark() / flowMotif()
  charts.js             SVG chart builders (line, bars, ring, sparkline)
  shell.js              router, screen lifecycle, sheets, toasts, theme, audit
  screens-core.js       splash, get-started handoff, login, home per role, settings
  screens-orders.js     orders, tickets, order detail, production
  screens-money.js      sales, finance, P&L, expenses, cash sessions, reports
  screens-manage.js     staff, customers, products, org/branches, audit log, admin
  studio.js             desktop companion panel + role switcher
  ds-page.js            design-system.html only

sweetcrumbs/            self-contained get-started flow (splash → carousel → sign-in)
images/                 logo artwork + splash video
_a.html … _audit.html   deep-link redirects into specific screens
```

---

## Architecture in one page

**Routing.** `nav(name, params, mode)` in `shell.js` mounts a screen and pushes
it onto `APP.stack`. `back()` pops. `refresh()` re-renders in place, preserving
scroll. Modes: `push` `replace` `tab` `fade` `root`.

**Screens.** Every screen is an entry in the global `SCREENS` object:

```js
SCREENS.finance = {
  tab: 'finance',          // optional: which tab-bar item owns this screen
  chrome: true,            // optional: false hides the tab bar
  render(params) {         // must return an HTML string
    return \`<div class="body">…</div>\`;
  },
  mount(el, params) {      // optional: wire events after render
    $('#thing', el).onclick = () => …;
  }
};
```

Rendering is string-based and synchronous. There is no virtual DOM and no
reactive layer — after mutating state you call `refresh()`.

**Roles.** `APP.role` is one of `owner` `manager` `staff` `supervisor` `baker`
`driver`. `ROLE_TABS` maps each role to its tab bar, and home screens branch on
role. Permissions are presentation-level only in this frontend — **enforce them
server-side too.**

**Theme.** `applyTheme('light' | 'dark' | 'system')` sets `data-theme` on
`<html>` and persists to `localStorage.bakeflow-theme`. An inline script in
`index.html` applies it before first paint to avoid a flash.

**Shared helpers** (global, from `shell.js`): `toast()`, `undoToast()`,
`sheet()`, `closeSheet()`, `dialog()`, `confirmSheet()`, `logAudit()`,
`money()`, `$()`, `$$()`, `esc()`, `withSkeleton()`.

---

## Connecting your backend

**`js/data.js` is the only seam.** Everything the UI shows comes from the global
`DB` object defined there. Nothing else in the codebase hardcodes business data.

`DB` top-level keys: `users` `invites` `staffList` `orgs` `products`
`productCats` `customers` `orders` `tickets` `sales` `week` `weekPrev` `today`
`finance` `expenseCats` `expenses` `cash` `staffDrawers` `branches` `insights`
`mySales` `myCashSession` `myExpenses` `productionBatches` `myProduction`
`stockMovements` `salesBySalesperson` `dailyFinancialAudit` `driverTrip`
`driverRoute` `reports` `activity` `auditLog`.

Alongside `DB` are domain constants you'll want to mirror in your API:
`STATUS` (order lifecycle), `PAYSTATE` (payment state), `ROLE_TABS`,
`METHOD_ICON`.

### Recommended approach

Keep `data.js` as the shape contract and hydrate it before the app boots.

1. **Add an API module**, `js/api.js`:

```js
const API_BASE = '/api';

async function get(path) {
  const r = await fetch(API_BASE + path, { credentials: 'include' });
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

/** Replace mock data in place, preserving DB's getters. */
async function hydrate() {
  const [products, orders, customers, today] = await Promise.all([
    get('/products'), get('/orders'), get('/customers'), get('/metrics/today')
  ]);
  Object.assign(DB, { products, orders, customers, today });
}
```

2. **Load it after `data.js`** in `index.html`, and gate the first render on it:

```html
<script src="js/data.js"></script>
<script src="js/api.js"></script>
<!-- … remaining scripts … -->
```

Then in `studio.js` (or wherever you boot), `await hydrate()` before the first
`nav(...)` call.

3. **Route writes through your API.** Search the screen files for the mutation
points — they're all explicit. For example in `screens-orders.js`:

```js
APP.orderStates[o.id] = to;   // becomes:
await api.patch('/orders/' + o.id, { status: to });
refresh();
```

The undo affordances (`undoToast`) assume the mutation is reversible — either
implement a real reversal endpoint or switch those to `confirmSheet()`.

### Watch out for

- **`DB.cash` uses getters.** `expected`, `variance` and similar are computed
  properties, not stored values. Use `Object.assign(DB.cash, …)` rather than
  replacing the object, or you'll lose them.
- **`APP.orderStates`** is a session-local overlay of status changes. Once the
  backend owns status, drop it and read from `DB.orders`.
- **Auth.** `sweetcrumbs/` sign-in is presentational — it posts a
  `bakeflow:signed-in` message and the app trusts it. Wire it to your real auth
  and set `APP.role` from the server's response, never from the client.
- **Money is integer minor units** (kobo-free naira integers, e.g. `428500` =
  ₦428,500). `money()` formats for display. Keep your API integer-based to avoid
  float drift.
- **Role permissions** shown in the UI are cosmetic. Re-check every one on the
  server.

---

## Accessibility & UX baseline

Worth preserving as you extend it:

- All body text meets WCAG AA (4.5:1) against its background.
- Interactive controls have a ≥44px touch target — small controls keep their
  visual size and gain an invisible pad via the `::before` rule in
  `components.css`. If you add a small control, add it to that selector list.
- `prefers-reduced-motion` is honoured (`APP.reducedMotion`).
- Toast host is an `aria-live` region.
- Reversible actions get a 5-second undo; audit-logged ones get a confirm step
  instead, and removing a staff member requires typing their name.

---

## Browser support

Modern evergreen browsers. Uses CSS custom properties, `:has()`, CSS nesting-free
flat selectors, `Intl.NumberFormat`, and optional chaining. No transpilation.
