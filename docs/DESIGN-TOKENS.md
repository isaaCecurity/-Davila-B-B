# BakeFlow — Design Tokens & Component Specification

**Status:** canonical. This document instantiates the design system that `EB-015` mandates in principle but does not define in concrete values. Where `EB-015` says "the Primary Brand Color SHALL represent the BakeFlow identity," this document says what that color is.

If `EB-015` and this document conflict, `EB-015` governs *policy* (there shall be a primary color, semantic colors shall be used consistently) and this document governs *values*.

---

## 1. Design direction

BakeFlow uses a **hybrid** direction: the information architecture of a ledger, with the warmth of a consumer app.

- **Ledger structure.** Lists are hairline-ruled rows, not stacked cards. Numbers align on a shared grid using tabular numerals. Lists that represent money carry a running total in a footer row. Density is a feature — an owner scanning fourteen orders should see most of them without scrolling.
- **Warm surface.** Brand color is a deep sienna; neutrals are warm-tinted, never cold gray. Headers, primary actions, and active navigation carry the brand.
- **Cards only for single objects.** A detail screen showing one order, one batch, one till session may use a card. A *list* never does.

**Rationale:** the product's core value is financial accuracy, which the ledger structure serves. The target users are switching from a paper notebook, which the warmth serves.

---

## 2. Color tokens

### Brand

| Token | Value | Use |
|---|---|---|
| `color.brand.primary` | `#9A3412` | Screen headers, primary buttons, active tab, key actions |
| `color.brand.primary.pressed` | `#7C2D12` | Pressed state of primary controls |
| `color.brand.primary.subtle` | `#FDF0E9` | Tinted backgrounds carrying brand meaning |
| `color.brand.on-primary` | `#FFFFFF` | Text and icons on `brand.primary` |
| `color.brand.secondary` | `#0F766E` | Production and operational states, secondary actions |
| `color.brand.secondary.subtle` | `#E0F2F1` | Production status pills |
| `color.brand.accent` | `#D97706` | Sparing emphasis: featured metrics, highlights |

### Neutrals (warm-tinted — never use pure gray)

| Token | Value | Use |
|---|---|---|
| `color.canvas` | `#FAF8F5` | Screen background |
| `color.surface` | `#FFFFFF` | Cards, list rows, headers, sheets |
| `color.surface.sunken` | `#F5F3F0` | Inactive chips, footer totals, table headers |
| `color.rule` | `#E7E2DA` | Container borders, dividers between sections |
| `color.rule.subtle` | `#F0EDE8` | Dividers *inside* a container |
| `color.text.primary` | `#1C1917` | Body text, figures, headings |
| `color.text.secondary` | `#78716C` | Labels, supporting detail, metadata |
| `color.text.muted` | `#A8A29E` | Placeholders, settled or historical records |

### Semantic

| Token | Fill | Subtle bg | Use |
|---|---|---|---|
| `color.success` | `#15803D` | `#E8F5E9` | Paid, completed, in stock, positive variance |
| `color.warning` | `#EAB308` | `#FEF9E7` | Low stock, deposit due, till variance, pending action |
| `color.danger` | `#B91C1C` | `#FEECEC` | Out of stock, failed batch, destructive actions |
| `color.info` | `#1D4ED8` | `#EAF0FD` | Neutral informational notices |
| `color.text.on-warning` | `#713F12` | — | Text on `warning.subtle` |
| `color.text.on-success` | `#14532D` | — | Text on `success.subtle` |
| `color.text.on-danger` | `#7F1D1D` | — | Text on `danger.subtle` |

**Contrast rule:** text on a subtle background always uses the matching `text.on-*` token, never `text.primary` and never black.

**Warning/brand adjacency:** `warning` (#EAB308) and `brand.primary` (#9A3412) are both warm. They must never be the sole differentiator between two states. Every warning carries an icon and a text label in addition to color. This is an accessibility requirement, not a preference.

### Dark mode

Deferred for MVP. The primary use context is a bright kitchen or outdoors in daylight. When dark mode is added, every value above must gain a paired dark value in this file — screens must not hardcode colors, so that the addition is a token-layer change only.

---

## 3. Typography

**Family:** Inter (variable), loaded via `expo-font`. One family only.

**Numerals:** every figure — money, quantity, count, percentage — renders with `fontVariant: ['tabular-nums']`. This is what makes ledger rows align. It is not optional and applies even to single figures, so that a number does not shift width when it updates.

**Weights:** 400 regular and 500 medium only. No 600, no 700, no italics.

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `type.display` | 30 / 36 | 500 | The single hero figure on a dashboard |
| `type.figure.lg` | 22 / 28 | 500 | Totals, balances on detail screens |
| `type.figure` | 16 / 22 | 500 | Amounts in list rows |
| `type.title` | 17 / 24 | 500 | Screen titles |
| `type.subtitle` | 15 / 22 | 500 | Section headings, row primary text |
| `type.body` | 14 / 20 | 400 | Default body text |
| `type.label` | 12 / 16 | 400 | Field labels, row secondary text |
| `type.caption` | 11 / 15 | 400 | Metadata, status pills, timestamps |

**Minimum size is 11px.** Nothing smaller ships. Body text never goes below 14.

**Casing:** sentence case everywhere. No ALL CAPS, no Title Case except proper nouns.

---

## 4. Spacing, radii, sizing

**Spacing scale** (4pt base): `space.1` = 4, `space.2` = 8, `space.3` = 12, `space.4` = 16, `space.5` = 20, `space.6` = 24, `space.8` = 32.

Screen horizontal padding is `space.4` (16). Vertical rhythm between sections is `space.4`.

**Radii:** `radius.sm` = 6 (chips, small controls), `radius.md` = 8 (buttons, inputs, cards), `radius.lg` = 12 (bottom sheets, modals), `radius.pill` = 999 (status pills).

**Never round a single-sided border.** Accent stripes on alert rows use `borderLeftWidth: 3` with `borderRadius: 0`.

**Sizing:**

| Token | Value | Note |
|---|---|---|
| `size.touch.min` | 48 | Minimum tappable dimension. Non-negotiable — this app is used with floury hands. |
| `size.control.height` | 48 | Buttons, inputs, select rows |
| `size.row.min` | 64 | List row minimum height |
| `size.icon` | 20 | Inline icons; 24 for tab bar |
| `size.rule` | 1 | Hairline width (`StyleSheet.hairlineWidth` where finer is wanted) |

---

## 5. Components

### List row (the primary pattern)

White surface, `rule.subtle` bottom divider, no card, no outer margin, no shadow. Minimum height 64. Padding `space.3` vertical, `space.4` horizontal.

Layout is two lines:
- Line 1: primary text (`type.subtitle`) left, figure (`type.figure`, tabular) right, baseline-aligned.
- Line 2: supporting text (`type.label`, `text.secondary`) left, status (`type.caption`, semantic color) right.

Settled records (paid, completed, archived) drop the whole row to `text.secondary` / `text.muted` rather than being hidden — history stays visible but recedes.

### List footer total

Any list of monetary rows ends with a `surface.sunken` row: label in `type.label` left, total in `type.figure` right. This is a hard requirement, not a decoration — it is how the owner sees position at a glance.

### Card

Only for a single bounded object on a detail screen. `surface` background, `radius.md`, `1px solid rule`, padding `space.3`. No shadows anywhere in the app; elevation is communicated by border and background, not by blur.

### Status pill

`radius.pill`, padding 3 vertical / 8 horizontal, `type.caption`, subtle semantic background with matching `text.on-*`. Always paired with a word — never a bare colored dot.

### Alert row

Subtle semantic background, `borderLeftWidth: 3` in the solid semantic color, `borderRadius: 0`, padding `space.2`/`space.3`. Line 1 is what happened (weight 500), line 2 is what to do about it.

### Buttons

- **Primary:** `brand.primary` fill, `on-primary` text, `radius.md`, height 48, full width at the bottom of a flow. At most one per screen.
- **Secondary:** transparent, `1px solid brand.primary`, `brand.primary` text.
- **Destructive:** `danger` fill. Always behind a confirmation.
- Labels are verb-first and 1–3 words: "Confirm order", "Complete batch", "Close session". Never "Submit", "OK", or "Click here".

### Money display

Format via `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })`. Show the ₦ symbol on hero figures, totals, and standalone amounts. In a column of repeated figures, the symbol may be dropped once the column is unambiguously monetary.

Display rounds to 2 decimal places. **Storage and calculation remain `NUMERIC(19,4)`** — display rounding is presentation only and must never be written back. Quantities display up to 4 decimal places, trailing zeros trimmed.

---

## 6. Navigation

Six bottom tabs, per `EB-018`, with plain-language labels chosen for a non-accountant (Core Principle 5):

| Tab | Label | Icon | Not called |
|---|---|---|---|
| 1 | Today | dashboard | "Dashboard" |
| 2 | Orders | receipt | — |
| 3 | Production | flame | "Manufacturing" |
| 4 | Stock | stack | "Inventory" |
| 5 | Money | coins | "Finance" |
| 6 | More | menu | — |

Active tab uses `brand.primary`; inactive uses `text.muted`. Additional modules (Customers, Employees, Drivers, Purchasing, Payroll, Reports, Settings, Administration) live under More, per `EB-018`'s rule against growing the tab bar.

**Role-based tabs.** A Cashier and a Baker should not see the same six. Tabs are filtered by role: Baker sees Today / Production / Stock / More; Cashier sees Today / Orders / Money / More; Driver sees Today / Deliveries / More. Owner and Admin see all six.

---

## 7. Implementation rules

1. **No hardcoded colors, sizes, or font values in screens or components.** Everything resolves through the theme. A screen containing `#9A3412` is a bug.
2. Tokens live in `src/theme/tokens.ts`, exposed via a theme provider. Adding a value means editing that file, not the component.
3. No shadows, gradients, blurs, or glows anywhere.
4. Every interactive element meets `size.touch.min` (48), including icon-only buttons.
5. Text and background pairs meet WCAG AA (4.5:1 body, 3:1 for text 18px+). Check any new pair before adding it here.
6. State is never conveyed by color alone — always color plus text, and usually plus icon.
7. Loading uses skeleton rows matching the real row height, per `EB-018`. Never a centered spinner on a list.
8. Every list has a defined empty state: a headline naming the space, one line of body, and a verb-first action. Never "Nothing here yet."
