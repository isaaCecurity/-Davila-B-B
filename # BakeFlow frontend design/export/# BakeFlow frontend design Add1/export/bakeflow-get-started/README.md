# BakeFlow — Get Started flow (standalone)

Splash → 3-slide onboarding carousel → sign-in → confirmation.
Self-contained: open it and it runs. No build step, no dependencies.

---

## Why it didn't render for you locally

Two things, both fixed in this folder:

**1. The logos pointed outside the folder.** The three `<img>` tags referenced
`../images/bakeflow-mark-transparent.png` — correct when the flow sits inside
the main app (where `images/` is a sibling of `sweetcrumbs/`), but a 404 the
moment you run the folder on its own. The logo is now bundled in `images/` here
and the paths are local.

**2. `file://` won't work.** Opening `index.html` by double-clicking it makes the
browser block the stylesheets and scripts as cross-origin. **You must serve it
over HTTP.** This is the most common cause of "it looked completely unstyled".

---

## Run it

```bash
cd bakeflow-get-started
npx serve .                 # then open the URL it prints
```

Or without Node:

```bash
python3 -m http.server 5173     # → http://localhost:5173
php -S localhost:5173
```

**Check it worked:** you should see a cream screen, the logo breathing gently,
"BakeFlow" typing in letter by letter, and a progress bar filling. If you get
black-on-white unstyled text, you're on `file://` — use a server.

### Fastest sanity check
Open DevTools → Network. Any red 404 row is a path problem. There should be none.

---

## What's here

```
index.html              all four screens in one document
css/base.css            tokens, resets, ambient background, ripple, crumbs
css/onboarding.css      splash + carousel + all three slide illustrations
css/auth.css            sign-in, reset-password, confirmation
js/motion.js            shared helpers — must load FIRST (defines window.SC)
js/auth.js              sign-in validation, password peek, submit states
js/onboarding.js        splash hand-off, carousel, swipe, push navigation
images/                 logo artwork
ANIMATIONS.md           complete animation inventory (this flow + the main app)
```

**Script order matters.** `motion.js` defines `window.SC`, which the other two
consume at parse time. Keep it first or they throw.

---

## The four screens

| # | Screen | Leaves via |
|---|--------|-----------|
| 1 | Splash | auto after 2.6s — logo flies into the header |
| 2 | Onboarding carousel (3 slides) | "Get started" on slide 3, or "Skip" |
| 3 | Sign-in | valid submit, or Back / edge-swipe to return |
| 4 | Confirmation | "Continue" |

Splash and onboarding are the same screen — the splash overlays it and is
removed once the logo hand-off lands, so the target position is real rather
than guessed. Sign-in is a separate layer pushed over the top, which is what
makes the interactive edge-swipe back possible.

---

## How it links to sign-in

Two hops.

**Onboarding → sign-in** is internal, in `onboarding.js`:

```js
function push() {          // fired by the CTA on the last slide, and by Skip
  stack.classList.add('stack--bloom', 'is-pushed');
  // dough bloom covers the screen, then the sign-in screen's staged entrance
  setTimeout(() => window.dispatchEvent(new CustomEvent('sc:signin-show')), 480);
}
```

`auth.js` listens for `sc:signin-show` / `sc:signin-hide` and runs the form's
staggered reveal. Nothing else couples them.

**Sign-in → your app** is one line. On a successful sign-in `auth.js` posts:

```js
window.parent.postMessage('bakeflow:signed-in', '*');
```

That's the whole integration contract. In the main app the flow is embedded in
an `<iframe>` and the host listens:

```js
window.addEventListener('message', e => {
  if (e.data === 'bakeflow:signed-in') {
    // set the role from YOUR server's response, never from the client
    nav('home', {}, 'fade');
  }
});
```

### Wiring it to a real backend

The form is presentational — it accepts anything non-empty after a fake 900ms
delay. In `auth.js`, find the submit handler's `setTimeout` and replace it:

```js
const res = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: idInput.value, password: passInput.value })
});
if (!res.ok) { showError('Those details did not match.'); resetSubmit(); return; }
const { role } = await res.json();
window.parent.postMessage({ type: 'bakeflow:signed-in', role }, location.origin);
```

Two cautions: send a **structured** message and a **real target origin** rather
than `'*'` once money is involved, and treat the role as the server's word —
the client must never choose its own permissions.

---

## Accessibility notes worth keeping

- Every animation is gated behind `prefers-reduced-motion`; `window.SC.reduced`
  short-circuits the JS ones, and the splash drops from 2600ms to 200ms.
- Focus moves deliberately across the push (into Back) and the pop (back to the
  CTA), so keyboard users follow the navigation.
- Carousel dots are real `<button role="tab">` elements with `aria-selected`;
  off-screen slides are `aria-hidden`.
- Arrow keys drive the carousel; Escape pops the sign-in screen.
- `navigator.vibrate` only fires after a real gesture — browsers block and log
  it otherwise.
