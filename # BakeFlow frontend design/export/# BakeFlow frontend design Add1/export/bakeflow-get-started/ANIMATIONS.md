# BakeFlow — Animation Inventory

Every animation in the product, get-started flow and main app, small and large.

**Reading this:** each entry gives the trigger, what moves, the timing, and
where it lives. Durations are as authored. Anything marked **RM** is skipped or
shortened under `prefers-reduced-motion: reduce`.

Two motion systems, deliberately separate:

| | Get-started flow | Main app |
|---|---|---|
| Files | `css/base.css`, `onboarding.css`, `auth.css`, `js/motion.js` | `css/app.css`, `components.css`, `js/shell.js` |
| Character | Expressive, once-off, a first impression | Restrained, repeatable, used hundreds of times a day |
| Helper namespace | `window.SC` | globals in `shell.js` |

The split is intentional. Onboarding is seen once and should charm; the
operational app is seen all day and must never make someone wait.

---

# PART 1 — GET STARTED FLOW

## 1. Ambient background (all screens)

Runs continuously behind everything, never stops.

| Element | Motion | Timing |
|---|---|---|
| `.blob--a` | Drifts +9%/+7%, scales 1 → 1.12 → 0.95 | `drift-a`, 22s, infinite |
| `.blob--b` | Drifts −12%/−8%, scales 1.05 → 0.92 | `drift-b`, 26s, infinite, reverse |
| `.blob--c` | Third blob, offset phase | `drift-a`, 30s, infinite |

Three large blurred cream/apricot circles at low opacity. Slow enough to read
as light rather than movement — you notice the screen feels alive without
seeing anything move. **RM: paused.**

*`base.css` — `drift-a`, `drift-b`*

---

## 2. Splash screen

A six-part sequence, all timed off a single 2.6s budget.

| # | Element | Motion | Timing |
|---|---|---|---|
| 2.1 | `.splash-bg` | Radial warm glow fades up | 0.8s ease-out |
| 2.2 | `.orbit-ring` | Scales 0.6 → 1 while un-rotating, then spins forever | `ring-in` 1.15s spring, then `ring-spin` 14s linear infinite |
| 2.3 | `.orbit-arm` | Orbits the logo | `orbit-run` 3.4s linear infinite, 0.7s delay |
| 2.4 | `.orbit-dot` | Single dot pops onto the arm | `dot-pop` 0.5s spring, 0.7s delay |
| 2.5 | `.splash-mark` | Logo breathes: −5px rise, 1.035 scale | `mark-breathe` 2.6s ease-in-out infinite, 1s delay |
| 2.6 | `#wordmark` letters | "BakeFlow" rises letter by letter | `letter-up` 0.6s spring each, staggered 45ms from 0.74s |
| 2.7 | `.splash-tag` | Tagline fades up | `fade-up` 0.7s, 1.2s delay |
| 2.8 | `.splash-bar` | Progress bar fills left → right | `bar-fill` 1.7s ease-in-out, 0.7s delay |

The wordmark stagger is built in JS, not CSS — `onboarding.js` splits the
string and sets `animationDelay` per character, so changing the product name
needs no CSS edit.

**RM: splash budget drops 2600ms → 200ms**, breathing and orbit don't run.

*`onboarding.css` — `ring-in`, `ring-spin`, `orbit-run`, `dot-pop`, `mark-breathe`, `letter-up`, `fade-up`, `bar-fill`*

---

## 3. Splash → onboarding hand-off ★

The signature moment. A **shared-element transition**: the splash logo physically
becomes the header logo rather than one screen cutting to another.

How it works:

1. The onboarding screen is already laid out underneath, so `getBoundingClientRect()`
   on the header logo returns a **real** target rect — nothing is guessed.
2. The breathing loop is removed first (`is-idle` off), or its transform would
   fight the flight transform.
3. Scale and delta are computed from the two rects, then applied as one
   `translate3d(...) scale(...)` — **0.72s, `cubic-bezier(.62,-0.02,.28,1)`**.
   The slight negative first control point gives an anticipatory dip before it
   flies.
4. A 14-crumb burst sprays from the logo's start position as it lifts.
5. At **640ms** the real header logo takes over (`is-landed`); at **820ms** the
   splash is removed from the DOM and slide 1's illustration starts.

That 820ms handover is load-bearing. An earlier version started slide 1 at the
same time as the hand-off and it read as the animation starting twice.

**RM: instant** — splash removed, logo landed, no flight.

*`onboarding.js` → `handOff()`*

---

## 4. Onboarding chrome

| Element | Motion | Timing |
|---|---|---|
| `.ob-top`, `.ob-dots`, CTA | Fade in, 8px rise | `fade-in-x` 0.5s, 60ms delay |
| `.dot.is-active` | Squashes open: scaleX 0.6 / scaleY 1.25 → rest | `dot-stretch` 0.5s spring |
| `.dot.is-active i` | Fill bar sweeps across, as a live 5.5s autoplay countdown | `dot-fill` 5500ms linear |
| `.dot.is-paused i` | Fill **freezes mid-sweep** while a finger is down | `animation-play-state: paused` |
| Skip button | Fades to 0 and goes `pointer-events: none` on the last slide | opacity transition |

The pausable dot fill is a small thing that does real work — the countdown
stopping under your thumb tells you the carousel noticed you.

*`onboarding.css` — `fade-in-x`, `dot-stretch`, `dot-fill`*

---

## 5. Carousel — parallax drag ★

Not a slide transition; a continuously interpolated one. `applyParallax(offset)`
runs on every pointer move, where offset is a fractional slide position (1.35 =
35% of the way from slide 1 to 2).

Per slide, as a function of distance `d` from centre:

| Layer | Transform | Effect |
|---|---|---|
| `.art` | `translate3d(d × 26%)` · `scale(1 − |d| × 0.12)` · `rotate(d × −3.5deg)` | Travels furthest, shrinks and tilts away |
| `.art` opacity | `1 − |d| × 0.55` | Fades as it leaves |
| `.copy` | `translate3d(d × 12%)` | Trails behind the art |
| `.copy` opacity | `1 − |d| × 0.9` | Fades much faster than the art |

Slides beyond `|d| > 1.15` have their transforms cleared — off-screen work is
wasted work.

Supporting behaviour:

- **Rubber band.** At the first or last slide, drag is damped to **0.34×** so
  the edge feels elastic rather than broken.
- **Axis lock.** The first 6px of movement decides horizontal or vertical, then
  commits — no diagonal ambiguity.
- **Flick detection.** Velocity is sampled per move; > 0.45 px/ms advances even
  on a short drag.
- **Threshold.** Otherwise `min(70px, 20% of width)` must be crossed.
- **Settle.** Release tweens to the target over **620ms** with a custom
  easeOutBack (overshoot constant 1.24) — it passes the target and comes back.
- **Neighbour pre-warm.** `prepare()` starts the incoming slide's illustration
  *while it travels*, so you never swipe onto a blank panel. `retireOthers()`
  only deactivates slides once movement stops, so the outgoing one doesn't
  vanish mid-view.

**RM: no parallax, no tween** — instant jump.

*`onboarding.js` → `applyParallax()`, `settleTo()`, `endDrag()`*

---

## 6. Slide 1 — "Every order, never missed"

Every delay is scaled by `var(--k)`, which is **1** normally and compressed
when the slide arrives mid-travel (`.is-swift`), so a swiped-to slide catches up.

| Element | Motion | Timing |
|---|---|---|
| `.s1-card-1/2/3` | Fly in from +58px/+26px, rotate 9deg, scale 0.86 → rest | `card-fly` spring, staggered 0.2 / 0.36 / 0.52s |
| then | Each card floats −4.5px forever, offset phase | `card-float` infinite, from 1.1 / 1.4 / 1.7s |
| `.s1-stamp` | Slams in: scale 2.1 rotate −16deg → 0.92 / +3deg → rest | `stamp` 0.66s spring, 1.05s |
| `.s1-check` | Checkmark draws itself | `draw` 0.4s, 1.4s |
| `.s1-badge` | Pops from scale 0.3, then pulses to 1.09 forever | `badge-pop` + `badge-pulse` 2.4s infinite |
| `.s1-ping` | Expanding ring, 0.6 → 2.2 scale, fading | `ping` 2.4s infinite, 1.8s |

*`onboarding.css` — `card-fly`, `card-float`, `stamp`, `draw`, `badge-pop`, `badge-pulse`, `ping`*

---

## 7. Slide 2 — "See what actually sells"

| Element | Motion | Timing |
|---|---|---|
| `.s2-bar-1…5` | Grow from `scaleY(0)`, bottom-anchored | `bar-grow` 0.92s spring, staggered 90ms |
| `.s2-bar-6` | Grows, then breathes scaleY 1.07 forever — the "best seller" | `bar-grow` + `bar-breathe` 2.8s infinite |
| `.s2-node-1/2/3` | Trend dots pop from scale 0 | `node-pop`, 1.04 / 1.22 / 1.4s |
| `.s2-chip` | Pops in, then hovers −6px forever | `node-pop` + `chip-hover` 3.4s infinite |
| `.s2-spark-1/2/3` | Sparkles scale + rotate 90deg, fade out | `spark` infinite, 1.6 / 2.1 / 2.6s |

The one breathing bar among five static ones is what carries the meaning — the
eye goes straight to the best seller without a label.

*`onboarding.css` — `bar-grow`, `bar-breathe`, `node-pop`, `chip-hover`, `spark`*

---

## 8. Slide 3 — "Know your real profit"

| Element | Motion | Timing |
|---|---|---|
| `.s3-ring` | Profit ring sweeps to 72% via `stroke-dashoffset` | `ring-fill` 1.3s, 0.24s |
| `.s3-coin-1…4` | Drop from −92px, rotate −30deg, overshoot +6px, settle | `coin-drop`, staggered 0.5 → 1.15s |
| `.s3-jar` | **Squashes 1.045/0.955 as the coins land** | `jar-squash` 0.5s, 0.93s |
| `.s3-arrow` | Rises and fades, repeating | `arrow-up` 2.6s infinite, 1.5s |
| `[data-count-to]` | Figure counts 0 → target, easeOutCubic | `countUp()` 1100ms |

The jar squash is timed to the coin landing, not to a fixed beat — cause and
effect, so the coins feel like they have weight.

Counters are re-seeded to 0 and re-run on every slide entry (820ms delay
normally, 260ms when arriving mid-swipe). **RM: value set directly.**

*`onboarding.css` — `ring-fill`, `coin-drop`, `jar-squash`, `arrow-up`; `motion.js` — `countUp()`*

---

## 9. Onboarding → sign-in: the dough bloom ★

The second signature moment. Not a slide — a **circular reveal originating at
the button you actually pressed**.

1. The CTA's centre is measured relative to the phone frame.
2. The radius needed to cover the frame is the **max distance to all four
   corners** — so the bloom always covers, wherever the button sits.
3. A warm circle scales 0 → full over **52% of a 1s curve**, holds, then fades
   as the sign-in screen settles beneath it.
4. A 10-crumb burst kicks off the bloom.
5. At **480ms** `sc:signin-show` fires, starting the form's staged entrance
   under cover of the dough.
6. At **900ms** focus moves to the Back button.

Note the asymmetry: the push blooms, but the **back gesture uses a classic
slide** (`stack--bloom` is removed on pop). Forward is an event; back is
navigation.

**RM: no bloom, no crumbs**, `sc:signin-show` fires immediately.

*`onboarding.js` → `push()`; `onboarding.css` — `dough-bloom`*

---

## 10. Interactive edge-swipe back ★

iOS-style, tracking the finger 1:1 — not a triggered animation.

- Only starts within the **left 40px**.
- 6px axis lock, vertical aborts.
- While dragging, `p = dx / width` drives **both** layers each frame:
  - sign-in: `translate3d(p × 100%)`
  - onboarding beneath: `translate3d(−24% + 24%·p)` · `scale(0.93 + 0.07·p)` · `opacity 0.42 + 0.58·p`
- Release past **32%** completes the pop; otherwise inline transforms are
  cleared and CSS transitions spring it back.

The layer underneath moving at a *different rate* is what sells the depth — it
reads as a card sitting on top of another card.

**RM: disabled entirely.**

*`onboarding.js` → `endBackDrag()`*

---

## 11. Sign-in screen

| Element | Motion | Timing |
|---|---|---|
| `.si-hero-glow` | Warm glow scales 0.6 → 1, fades up | `hero-glow` 1.2s, 0.3s |
| `.si-reveal` items | Rise + fade, per-item `--d` delay | `si-rise` 0.7s spring, staggered from 0.18s |
| `.si-title` letters | **Un-blur** from `blur(8px)` as they rise | `letter-focus` 0.55s |
| `.mark-steam` | Two steam wisps sway ±2.4deg, second reversed | `steam-sway` 3.1s infinite |
| `.field.-invalid` | Shakes −7px / +6px / −3px | `shake` 0.42s |
| `.si-submit.is-loading` | Label out, spinner scales in and rotates | `si-spin` 0.7s linear infinite |
| `.si-submit.is-success` | Turns green, label → "Welcome back!", 18-crumb burst | 900ms fake round trip |
| Password peek | Eye icon crossfades | 0.2s |

The staged entrance runs **under the dough bloom**, so by the time the bloom
clears the form is already composed — no visible assembly.

*`auth.css` — `hero-glow`, `si-rise`, `letter-focus`, `steam-sway`, `shake`, `si-spin`*

---

## 12. Confirmation & reset password

| Element | Motion | Timing |
|---|---|---|
| `.confirmation-ring` | Pops scale 0.55 rotate −8deg → 1.08/+2deg → rest | `confirmation-pop` spring |
| `.confirmation-check` | Checkmark draws | `check-draw` |
| `.reset-panel` | Rises 20px, **un-blurs from 8px**, scales 0.92 → 1 | `reset-bloom` 0.85s |

*`auth.css` — `confirmation-pop`, `check-draw`, `reset-bloom`*

---

## 13. Shared micro-interactions (get-started)

| Name | Trigger | Detail |
|---|---|---|
| **Ripple** | `pointerdown` on any `.btn` | Circle at the exact touch point, sized 2.2× the button's longest edge, 0.62s, removed after 640ms |
| **Press squash** | Any `[data-press]` | `.is-pressed` while the finger is down, spring release on lift. Also fires on `pointercancel` and `pointerleave` — the press never sticks |
| **Crumb burst** | Hand-off, bloom, sign-in success | 4 bakery colours, random size 4–11px, random angle, 46–124px distance, −18px upward bias, ±130deg spin, 0–80ms jitter, self-removing at 1100ms |
| **Haptics** | Taps, slide changes, push/pop | 6–24ms. **Gated on a prior real gesture** — browsers block and log vibrate calls before first interaction |
| **Counters** | Slide entry | easeOutCubic, locale-formatted, prefix/suffix aware |

*`motion.js`; `base.css` — `ripple`; `onboarding.css` — `crumb-fly`*

---
---

# PART 2 — MAIN APP

Different brief: these run hundreds of times a day, so nothing here is longer
than 460ms and nothing loops unless it's communicating live state.

## 14. Screen transitions

Driven by `nav(name, params, mode)` in `shell.js`. The mode picks the pair.

| Mode | Incoming | Outgoing | Timing |
|---|---|---|---|
| `push` | `push-in` — slides in from +100% | `push-out` — to −22%, opacity 0.55 | 360ms `--ease-nav` |
| `back()` | `pop-in` — from −22%, opacity 0.55 | `pop-out` — out to +100% | 340ms |
| `fade` | `fade-in` — opacity + scale 0.985 → 1 | `fade-out` 180ms linear | `--d-base` |
| `tab` | `tab-in` — 7px rise + fade | (none) | `--d-base` |

The outgoing screen only travelling **22%** rather than fully off is what makes
push/pop read as a stack with depth instead of two unrelated screens. Z-index is
managed per class so the incoming card is correctly above or below.

*`app.css` — `push-in`, `push-out`, `pop-in`, `pop-out`, `fade-in`, `fade-out`, `tab-in`*

---

## 15. Overlays

| Element | Motion | Timing |
|---|---|---|
| Bottom sheet in | `sheet-up` — `translateY(101%)` → 0 | 320ms `--ease-out` |
| Bottom sheet out | `sheet-down` | 260ms `--ease-inout` |
| Scrim | Opacity fade behind the sheet | matches |
| Dialog | `dlg-in` — scale 0.94 → 1 + fade, vertically centred | 300ms |
| Dialog out | `fade-out` | 160ms linear |
| Toast in | `toast-in` — −14px drop, scale 0.97 → 1 | 320ms |
| Toast out | `fade-out` | 220ms |
| Dock (cart bar) | `dock-in` — rises from `translateY(100%)` | 340ms |
| Confirm panel ring | `pop` — scale 0.6 → 1.04 → 1 | 460ms |

`101%` rather than `100%` on the sheet avoids a sub-pixel seam at the bottom
edge on fractional-DPR screens.

Sheets and dialogs close on a **240ms** delay before `refresh()` so the exit
animation completes before the list re-renders underneath — that's the
`setTimeout(..., 240)` you'll see throughout the screen files.

*`app.css` — `sheet-up`, `sheet-down`, `dlg-in`, `toast-in`; `components.css` — `dock-in`, `pop`*

---

## 16. Loading & live state

| Element | Motion | Timing |
|---|---|---|
| `.skel` | Shimmer sweeps across a 3-stop gradient at 220% background-size | `skel-shimmer` 1.25s infinite |
| `.sk` | Older skeleton, −200% → 200% sweep | `shimmer` |
| `.sync.-syncing` | Sync glyph rotates | `spin` 1.1s linear infinite |
| `.video-tint` | Splash video tint settles 0.55 → 0.16 opacity | `tint-settle` 2.4s |

Skeletons appear **only on Finance, Reports and P&L** — the three screens that
assemble derived totals. `withSkeleton()` holds them for **340ms**: long enough
to read as loading, short enough not to be a wait. Every other screen renders
instantly, so a skeleton there would invent a delay that doesn't exist.
**RM: skipped entirely** via `APP.reducedMotion`.

*`components.css` — `skel-shimmer`, `shimmer`, `spin`, `tint-settle`; `shell.js` — `withSkeleton()`*

---

## 17. Number counters

`animateAll(root)` finds every `[data-count]` after a screen mounts and tweens
it with **easeOutCubic** via `requestAnimationFrame`, formatting through
`money()` or the element's own formatter.

Used for revenue figures, order counts, P&L lines and cash totals — the
dominant number on a screen counts up, supporting numbers don't. If everything
counted, nothing would feel important.

*`shell.js` — `animateAll()`*

---

## 18. Charts

All SVG, all entrance-only, in `charts.js`:

| Chart | Motion |
|---|---|
| Line / area | Path draws via `stroke-dashoffset`, area fades up behind it |
| Bars | Grow from `scaleY(0)`, bottom-anchored, staggered |
| Ring | Sweeps to value via `stroke-dashoffset` |
| Sparkline | Draws left → right |

No looping chart animation anywhere — data that keeps moving is data you can't
read.

---

## 19. Micro-interactions (main app)

| Element | Motion |
|---|---|
| `.fab` | `fab-in` on mount (12px rise + scale 0.9); `scale(.94)` on `:active` |
| `.btn` | Transform + background transitions on press |
| `.chip` | Background and border transition on select |
| `.switch` | Knob slides, track colour crossfades |
| `.segmented` | Thumb **slides** between options — absolutely positioned, which is why it must stay `position: absolute` |
| `.stepper` | `::after` ripple on the +/− buttons |
| Tab bar | Active item colour + icon weight transition |
| Order rows | Swipe-to-advance tracks the finger, snaps back under threshold |
| `.field.-shake` | `field-shake` 0.42s on validation failure |
| `.dot` | Width 7px → 22px transition on becoming active |

*`components.css` — `fab-in`, `field-shake`*

---

## 20. Reduced motion

Both systems honour `prefers-reduced-motion: reduce`.

**Get-started:** `window.SC.reduced` is read once at load. Splash drops to
200ms, the hand-off is instant, parallax and settle tweens are skipped, crumb
bursts and haptics don't fire, counters jump to their value, edge-swipe back is
disabled.

**Main app:** `APP.reducedMotion` is wired to the media query and **updates
live** if the user changes the setting mid-session. Skeletons are skipped.

Ambient blobs and all decorative loops are paused by media query in CSS.

---

## Where to change things

| You want to… | Go to |
|---|---|
| Retime the splash | `SPLASH_MS` in `onboarding.js` |
| Retime the hand-off | `handOff()` — the 0.72s transition, 640ms and 820ms timeouts |
| Change carousel autoplay | `SLIDE_MS` in `onboarding.js` (also feeds the dot fill via `--slide-dur`) |
| Tune parallax depth | `applyParallax()` — the 26 / 0.12 / −3.5 / 12 constants |
| Change the settle bounce | `settleTo()` — overshoot constant `c = 1.24` |
| Adjust swipe sensitivity | `endDrag()` — `vel > 0.45`, `min(70, w × 0.2)` |
| Retune the bloom | `dough-bloom` keyframes + the 480ms `sc:signin-show` delay |
| Change app transition speed | `--ease-nav` and `--d-base` in `css/tokens.css` |
| Change skeleton hold | `withSkeleton()` in `shell.js` — the 340ms |
| Add a slide illustration | `onboarding.css`, gate on `.slide.is-active`, scale delays by `var(--k)` |

**One rule if you extend this:** new slide illustrations must key off
`.slide.is-active` and scale their delays by `var(--k)`. That's what lets a
swiped-to slide compress its stagger and catch up instead of playing late.
