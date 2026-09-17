# Prototype → React Native port

Living record of porting the design prototype into `apps/mobile`. Phase reports,
decisions, PORT-NOTEs and the final status table all land here.

- **Visual/UX source of truth (read-only):** `# BakeFlow frontend design/export/bakeflow-frontend/`
- **Write target:** `bakeflow-frontend/apps/mobile` + `bakeflow-frontend/packages/*`
- **Rule:** the prototype is the approved visual and interaction target. Nothing is
  transliterated mechanically — every screen is rebuilt with RN primitives, NativeWind,
  Reanimated and the existing hooks while preserving the prototype's composition and
  behavior as closely as the target platform allows.

## Fidelity gate

Every port entry must identify the prototype screen, canonical role, theme, viewport, and
data state being compared. Validate the same state in both implementations. Use fixture
data first when live data prevents a meaningful visual comparison, then connect the live
hooks without changing the approved layout.

The prototype's 390 × 844 phone viewport, desktop studio presentation, app chrome, type,
spacing, colors, radii, elevation, icons, motion, copy, and loading/empty/error states are
part of the acceptance target. A screen is not complete because it has the same route or
backend behavior. It is complete only when its behavior is verified and every remaining
visual difference is either fixed or explicitly recorded with a platform/backend reason.

For each screen, attach or record a screenshot comparison at the target viewport and check:

- shell, safe areas, app bar, tab bar, and phone/studio frame
- layout geometry, spacing, content density, cards, rows, sheets, and controls
- typography, weights, line heights, copy, icons, colors, borders, shadows, and gradients
- loading, empty, error, success, dark-theme, reduced-motion, and role-specific states
- responsive behavior at phone width and the supported desktop preview width

Do not introduce a redesign, generic replacement component, new palette, default typography,
or navigation change while porting a prototype screen without explicit owner approval.

---

## Decisions taken during recon

**D1 — Prototype visual values supersede `docs/DESIGN-TOKENS.md`.** That doc is marked
canonical and specifies a different design (sienna `#9A3412`, weights 400/500 only, no
shadows or gradients, ledger rows instead of cards, radii 6/8/12, 48px touch, no dark
mode). The owner has repeatedly directed that the prototype *is* the product UI, and the
port brief's Phase 1 says to extract tokens from it. So colour, type weights, radii,
elevation, card-vs-row layout, tab IA and dark mode follow the prototype.
The doc's **correctness** rules are not contradicted and still bind: tabular numerals on
every figure, `en-NG` money formatting, display-only rounding (never written back),
state never conveyed by colour alone, WCAG AA pairs, a defined empty state on every list,
no hardcoded colours inside screens.

**D2 — Reanimated 4, not 3.** The brief says Reanimated 3; the repo has
`react-native-reanimated@4.5.1` + `react-native-worklets@0.10.1`. The worklet API used
(`useSharedValue`, `useAnimatedStyle`, `withTiming`, `withSpring`, `Easing.bezier`,
`entering/exiting` layout animations) is the same, and repo convention wins.

**D3 — Prototype personas map onto canonical roles.** `owner`→Owner, `manager`→Branch
Manager, `staff` ("Salesperson": own sales, own cash drawer, own expenses)→Cashier,
`supervisor`→Supervisor, `baker`→Baker, `driver`→Driver, `admin`→Admin. Accountant stays
disabled. Tab *layout* follows the prototype; what a role can *reach* is decided by the
real resolved role/permissions — the prototype's own README says its role gating is
cosmetic.

**D4 — No new dependency for graphics.** `react-native-svg` is absent, but the repo already
ships `@shopify/react-native-skia@2.6.2` and `victory-native@41` (Skia + Reanimated
charts), unused so far. Icon geometry is extracted from the prototype as a design asset by
`scripts/port-icons.mjs` → `packages/ui/icons.ts` (74 icons). `<Icon>` **rasterises each
icon once** through a Skia CPU surface, caches it as a PNG data URI, and renders an
`<Image>`. A live `<Canvas>` per icon was built first and failed verification: on web each
canvas holds a WebGL context and browsers keep ~16, so tab icons vanished once a list screen
mounted; on native each canvas is a GPU surface. Charts (few per screen) will use Victory.
**All Skia access goes through `packages/ui/skia.ts`'s lazy `skia()`** — Skia binds CanvasKit
at module evaluation, and a static import breaks every icon on web.

**D5 — Typography falls back to the system face.** Inter needs `expo-font` (not a declared
dependency). Weights and sizes are ported; the family is a one-line token change once
`expo-font` is approved.

---

## Phase 1 — Design tokens ✅

- **Single source of truth:** `packages/ui/tokens.ts` — typed, pure data. Colours (13
  themeable × light/dark, 9 fixed), semantic role map + `colorFor()`, radii, layout
  constants, type scale with **pixel** line-heights, weights, elevation, easings (bezier
  tuples for Reanimated), every prototype duration, keyframe distances/scales.
- **No duplicated values:** `apps/mobile/tailwind.config.js` imports `tokens.ts` (Tailwind
  3.4.17 loads config through jiti with a TS transform); `global.css` holds no values.
- **Theming:** `packages/ui/ThemeProvider` sets the CSS variables per scheme via NativeWind
  `vars()` and applies a `light | dark | system` preference.
- **Bugs found and fixed on the way:**
  - Unitless line-heights (`1.06`) would have collapsed text on device — RN reads px.
  - Dark mode never engaged on web: with `darkMode:'class'` NativeWind initialises to an
    explicit `light` and ignores the OS until `setColorScheme('system')` is called.
  - Three components hardcoded hex (spinners, placeholder) — now resolved per scheme.
- **Verified:** Tailwind compile emits token values; `tsc` ✓; `eslint` ✓; `expo export` ✓;
  Playwright light → ground `#F7F3EC`/text `#2A211C`, dark → `#17130F`/`#EFE7DC`, 36px
  display line-height, zero console errors.
- **Doc fix:** `docs/DESIGN-TOKENS.md` now carries a supersession notice (D1).

---

## Phase 2 — App shell & navigation ✅

**Routing.** `app/(tabs)/` holds 14 tab routes; the bar shows each persona's set from the JWT
`roles` claim (`navigation/tabs.ts`, `features/auth/hooks/useActivePersona.ts`) — advisory,
RLS stays the authority. Existing screens were moved, not deleted: catalog `app/index.tsx` →
`app/products/index.tsx`; `finance/index` and `production/index` → `(tabs)/finance.tsx`,
`(tabs)/production.tsx` (via `git mv`). The auth gate in `app/_layout.tsx` is unchanged.

**Chrome built (`packages/ui`).** `AppBar` (+`IconButton`, scroll-linked hairline),
`ScreenScroll` (app bar + UI-thread scroll + pull-to-refresh), `TabBar` (standard + driver
floating pill with Skia-gradient FAB), `Sheet` (Reanimated + Gesture Handler, drag-to-dismiss),
`Toast`, `Skeleton`, `PressableScale`, `Icon`, `IconTile`, `Avatar`, `Menu`/`MenuItem`/
`GroupLabel`, `Card` (raised/quiet/recessed/ink, tappable), `motion.ts` (`timing()` honours OS
Reduce Motion via `ReduceMotion.System`). App side: `stores/ui/toast.store.ts` (+`toast`,
`undoToast`), `stores/settings/settings.store.ts` (theme preference, SecureStore/web split),
`components/ToastHost.tsx`, `providers/SkiaReady(.web).tsx`.

**Motion.** Stack push = `ios_from_right`; tab switch = navigator scene interpolator matching
`tab-in` (opacity + 7px, 215ms ease-out), off under reduced motion; sheet 400ms `nav` in /
260ms `inout` out; toast `Keyframe` 320ms; press .985 (.93 tabs, .9 icon buttons).

**Screens done in this phase:** `more` (full prototype menu for the routes that exist).
**Holding screens** (`components/PortPending.tsx`, replaced in Phase 3): index, orders, sales,
cash, my-sales, my-cash, operations, staff, route, tickets, alerts.

**Defects found by verification and fixed:**
1. Icons drew blank on web — Skia binds CanvasKit at import; fixed with lazy `skia()` + gate.
   (A custom `index.web.js` entry with a dynamic import was tried and reverted: the static web
   export cannot resolve the lazy chunk — "Requiring unknown module".)
2. Tab icons vanished after navigating — WebGL context limit; fixed by rasterising (D4).
3. `className` ignored on Reanimated `Animated.View`/`ScrollView` (grey body, no gutter) —
   registered via `cssInterop` in `packages/ui/interop.ts`.
4. Tab selected state not exposed on web — added `aria-selected`.
5. Navigator's default grey showed through transparent scenes — ground painted in `ThemeProvider`.

**Verified** (static web export, Playwright, live Supabase, smoke owner): sign-in → Owner bar
`Home · Orders · Sales · Finance · More`; selected state follows taps; More renders every group;
stack push `/products` and back; 19 icon images, 0 broken, 0 canvases; light + dark; zero page
errors. `tsc` ✓ `eslint` ✓. Sheet and Toast are typechecked and bundled but first exercised by
a Phase 3 screen.

**Process notes.** Typed routes regenerate only under `expo start`, not `expo export` — run the
dev server once after adding routes before `tsc`. The command sandbox blocks outbound network;
live-backend browser checks run outside it.

---

## Phase 0 — Inventory

### (e) Global chrome (prototype `js/shell.js`, `css/app.css`)

| Chrome | Prototype | RN plan |
|---|---|---|
| Router | string-render stack, modes `push` `replace` `tab` `fade` `root` | Expo Router Stack + Tabs |
| Push / pop | translateX 100%→0, outgoing −22% & .55 opacity, 360/340ms `ease-nav` | native-stack slide + Reanimated screen enter |
| Tab switch | fade + translateY 7px→0, 215ms `ease-out` | Reanimated `entering` on tab screen root |
| Fade | opacity + scale .985→1, 215ms | Reanimated `FadeIn` custom |
| Tab bar | role-adaptive, 62px, 4–5 items | custom `tabBar` on Expo Router `Tabs` |
| App bar | `appbar({title, back, right, sub})`, 52px | `<AppBar>` in `packages/ui` |
| Bottom sheet | scrim fade + `sheet-up` / `sheet-down` 260ms `ease-inout`, grip | Reanimated + Gesture Handler sheet (no new dep) |
| Dialog / confirm | `dialog()`, `confirmSheet()` incl. type-to-confirm | `<ConfirmSheet>` |
| Toasts | stacked, `toast-in` 14px/.97 scale, 4s; `undoToast` 5s | `<ToastHost>` + Zustand `ui` store |
| Skeletons | `withSkeleton()` 340ms shimmer | `<Skeleton>` rows (DESIGN-TOKENS rule 7) |
| Theme | light / dark / system, persisted | NativeWind `colorScheme` + `settings` store |
| Reduced motion | `prefers-reduced-motion` | `useReducedMotion()` from Reanimated |

### Role-adaptive tab bars (`ROLE_TABS`)

| Role | Tabs |
|---|---|
| Owner | Home · Orders · Sales · Finance · More |
| Branch Manager | Home · Orders · Sales · Cash · More |
| Cashier | Home · Sales(my) · Cash(my) · More |
| Supervisor | Home · Operations · Staff · More |
| Driver | Home · Routes · Tickets · More |
| Baker | Home · Production · Alerts · More |
| Admin | Home |

### (a–d) Screens

`DB` keys are the mock collections each screen reads (approximate — helper functions that
sit between screen definitions can bleed in). `orders` **and** `tickets` both map to the
live `tickets` table. **Hook: NEW** means no hook exists yet and one must be created in
`packages/api` + `packages/hooks` following the existing pattern.

| # | Prototype screen | Existing RN route | Mock collections | API domain → hook |
|---|---|---|---|---|
| 1 | splash | — | — | — |
| 2 | get-started | `sign-in` (partial) | users | auth → `signInWithPassword` |
| 3 | login | `sign-in` | users | auth → `signInWithPassword` |
| 4 | org | `select-organization` | orgs, today | organization → `useMyOrganizations`, `useMyOrganizationRoles` |
| 5 | home (role-adaptive) | `index` | orders, tickets, customers, products, productionBatches, driverRoute | dashboard → `useDailyRevenueSummary`, tickets **NEW**, `useProductionBatches`, `useCurrentDriverTrip` |
| 6 | search | — | many | cross-domain **NEW** |
| 7 | more | — | — | navigation only |
| 8 | my-activity | — | orders, tickets, productionBatches, stockMovements | tickets **NEW**, `useProductionBatches` |
| 9 | profile | — | — | auth/session |
| 10 | notifications | — | today, finance | **NEW** (no table verified) |
| 11 | orders | — | orders | sales → tickets list **NEW** |
| 12 | order | — | orders | sales → `useTicketsByIds`, `useRecordPayment` |
| 13 | new-ticket | `driver/sell` (driver) | customers, products, productCats | sales → `useCreateRoadsideTicket`, `useProducts`, `useProductCategories`, customers **NEW** |
| 14 | created | — | products, mySales | sales |
| 15 | new-sale | — | products, productCats | sales → `useProducts`, `useProductVariants`, create-ticket **NEW** |
| 16 | new-customer-order | — | products, productCats | sales → create-ticket **NEW** |
| 17 | record-production | — | productionBatches, products | production → `useStartProductionBatch`, `useCompleteProductionBatch` |
| 18 | tickets | `driver/sell` (partial) | tickets | driver-trips → `useDriverTripTickets` |
| 19 | trip | `driver/home` | driverTrip, staffList, stockMovements | driver-trips → `useCurrentDriverTrip`, `useStartDriverTrip`, `useDepartDriverTrip` |
| 20 | trip-verify | — | driverTrip | driver-trips → `useVerifyTripLoading` |
| 21 | trip-reconcile | — | driverTrip, cash | driver-trips → `useReconcileDriverTrip`, `useReturnDriverTrip`, `useCompleteDriverTrip` |
| 22 | route | `driver/home` | driverRoute, driverTrip | driver-trips → `useDriverTrip`, `useRecordDriverTripPayment`, `useCompleteDriverFieldSale` |
| 23 | sales | — | sales, today, week | sales → `useDailyRevenueSummary` |
| 24 | finance | `finance/index` | finance, cash | finance → `useDailyRevenueSummary`, `useCashSessions`, `useExpenses` |
| 25 | pnl | — | finance | finance → P&L **NEW** |
| 26 | supervisor-reports | — | mySales, week | reports **NEW** |
| 27 | expenses | — | expenses, expenseCats | finance → `useExpenses`, categories **NEW** |
| 28 | add-expense | — | expenseCats | finance → `useCreateExpense` |
| 29 | my-sales | — | mySales | sales → tickets-by-me **NEW** |
| 30 | cash | — | cash, myCashSession | finance → `useCashSessions`, `useOpenCashSession`, `useCloseCashSession` |
| 31 | my-cash | — | myCashSession, mySales, myExpenses | finance → `useCashSessions` (own), `useExpenses` |
| 32 | add-my-expense | — | myExpenses | finance → `useCreateExpense` |
| 33 | reports | `reports/index` | week, reports | reports → `useDailyRevenueSummary`, **NEW** |
| 34 | report-products | — | products | reports **NEW** |
| 35 | report-branches | — | branches, week | reports **NEW** |
| 36 | products | — | products, productCats | catalog → `useProducts`, `useProductCategories` |
| 37 | product-detail | `product/[id]` | products, week | catalog → `useProduct`, `useProductVariants`, `useProductStockLevels` |
| 38 | customers | — | customers | customers **NEW** |
| 39 | customer | — | customers, orders | customers **NEW**, tickets **NEW** |
| 40 | staff | — | staffList, activity, invites | staff **NEW**, invitations |
| 41 | invites | — | invites | invitations → `mutations/invitations.ts` (no hook) |
| 42 | operations | — | mySales, products, productionBatches, driverRoute | dashboard → composite of existing hooks |
| 43 | sales-monitor | — | salesBySalesperson | reports **NEW** |
| 44 | inventory-monitor | `inventory/index`, `inventory/[warehouseId]` | products, stockMovements | inventory → `useWarehouses`, `useProductStockLevels`, `useIngredientStockLevels`, `useAdjustStock` |
| 45 | production | `production/index` | productionBatches, myProduction | production → `useProductionBatches` |
| 46 | production-monitor | `production/index`, `production/[batchId]` | productionBatches | production → `useProductionBatch`, `useFail/CancelProductionBatch` |
| 47 | delivery-monitor | `delivery/index` | staffList, driverRoute | delivery → `useDeliveries`, `useDrivers` |
| 48 | driver-detail | `delivery/[deliveryId]` | driverRoute | delivery → `useDelivery`, `useTransitionDelivery`, `useUpdateDeliveryDetails` |
| 49 | account | — | — | auth/session |
| 50 | settings | — | — | settings (personal) |
| 51 | audit | — | auditLog | audit **NEW** |
| 52 | states | — | — | dev showcase — not ported |
| 53 | ds | — | — | dev showcase — not ported |
| 54 | admin-org | — | branches | Web workspace per `ROLES-AND-PERMISSIONS.md` |
| 55 | admin-staff | — | staffList | Web workspace |
| 56 | admin-records | — | orders | Web workspace |
| 57 | admin-settings | — | — | Web workspace |

**Coverage today:** 13 of 57 prototype screens have an RN route; 47 hooks already exist;
roughly 14 read surfaces need a new hook (tickets list, customers, expense categories, P&L,
reports, staff, audit, notifications, search).

---

## Phase 3 — Screen-by-screen port

### Sales — slice 1: Orders list + Order detail ✅

**Screens.** `orders` → `app/(tabs)/orders.tsx`; `order` → `app/order/[id].tsx`.

**API created (`packages/api`).**
- `queries/sales.ts`: `listTicketItemsForTickets` (batched lines for a page of tickets),
  `listCustomersByIds` (batched names); `TicketFilters.statuses` (explicit status set).
- `mutations/tickets.ts` (new module): `advanceTicket`, `cancelTicket`, `nextTicketStatus`.
  Picks the RPC per target from the live contract — `confirm_ticket` (recomputes totals,
  issues the invoice), `complete_ticket` (writes one sale stock movement per variant; a plain
  status write would skip it), `cancel_ticket` (reason + refund precondition), otherwise
  `update_ticket(p_status)` — verified live that it `COALESCE`s every argument, so pricing is
  never touched. Kept out of `mutations/sales.ts`, whose header forbids generic transitions in
  the driver module.

**Hooks created (`packages/hooks`).** `useTickets`, `useTicketPages` (infinite keyset),
`useTicketWithItems`, `useTicketItemsForTickets`, `useCustomersByIds`, `useAdvanceTicket`,
`useCancelTicket`. All keys `orgScoped`; transitions invalidate tickets, the ticket, payment
tickets, daily revenue and product stock.

**UI created.** `packages/ui`: `Badge` (+`onDark`), `Chips`, `EmptyState`, `Fab`, `SearchBar`,
`SwipeRow` (Gesture Handler, horizontal-only), `ScreenList` (virtualised FlatList + app bar).
`features/tickets`: `ticketDisplay.ts`, `useOrderRows`, `OrderCard`, `AdvanceTicketSheet`,
`RecordPaymentSheet` (reuses finance's open-till rule), `CancelTicketSheet`.

**PORT-NOTEs.**
- Ten live statuses vs the prototype's six; prototype wording kept where meaning matches.
- Undo → confirm sheet: the lifecycle has no backward hops, so an Undo could not undo.
- No client-side money arithmetic: list footer counts orders, detail shows only
  database-computed figures, "outstanding" is shown as "₦X received of ₦Y".
- Chip counts on the active chip only; search filters loaded pages (no search endpoint).
- "Today" = device local midnight (reporting uses org timezone server-side).
- Names resolve from the first 200 products/variants (API page ceiling).
- Timeline shows done/current/not-yet from status alone — no status-history read exists.
- Not ported: share/print receipt, reassign, edit items (no endpoints; submitted items frozen).
- "New order" FAB deferred to the create-order flow.

**Defects found by verification and fixed.** Drafts appeared under no filter (80 live orders
invisible) → `draft` added to Pending. Neutral badges invisible on the ink hero (a draft showed
no status) → `Badge onDark`. "Nothing to pay yet" rendered as a red alarm → neutral tile.

**Verified** (static web export, Playwright, live Supabase, smoke owner, **read-only** — a
request guard confirmed zero mutating calls): Today empty state; Pending first page 50 cards,
chip `50+`, scroll → keyset page 2 → `80` (= live count of drafts); search empty state;
Completed 1 card (= live); detail sections and recap; dock hidden when completed; draft dock →
advance sheet `Draft → Pending`; cancel disabled until a reason is typed; zero page errors.
`tsc` ✓ `eslint` ✓. **Not executed:** confirm/complete/cancel/payment writes — the backend is
production and those RPCs issue invoices and move stock; they are verified by typecheck and by
reading the live function definitions only.

### Sales — slice 2: Customers + Customer detail ✅ (detail not exercised)

**Screens.** `customers` → `app/customers/index.tsx`; `customer` → `app/customer/[id].tsx`;
linked from More → Operations.

**Hooks created.** `useCustomerPages` (infinite, `isWalkIn: false`), `useCustomer`,
`useCustomersByPhone` (server-side exact-number search via the existing
`findCustomersByPhone`). **UI created.** `packages/ui` `List` / `ListRow` (the prototype's `.li`).

**PORT-NOTEs.** Lifetime spend, order count per row, average order, outstanding credit, credit
ledger and "What they buy" are aggregates with no read endpoint, and money is not summed on the
device — not shown; order history (the underlying record) is. Directory sorted by name, not
spend. "Add customer", "Statement" and "New order" wait for endpoints / the create flow.

**Verified** (read-only, request guard: zero mutating calls): More → `/customers`; named-only
filter sent to the server (`is_walk_in=eq.false`); smoke bakery has no named customers → "No
customers yet"; phone-shaped query shows its hint, fires `phone=eq.` server lookup, renders the
no-match copy; zero page errors. `tsc` ✓ `eslint` ✓. **Not exercised:** customer detail — no
named customer exists in the smoke bakery; typechecked and bundled only.

**Environment notes.** The Supabase MCP host failed DNS mid-slice and the Supabase auth host
dropped connections briefly; both recovered. Browser checks don't depend on MCP.

### Sales — slice 3: Products + Product detail ✅

**Screens.** `products` → `app/products/index.tsx`; `product-detail` → `app/product/[id].tsx`.
Both **existing** P8.1/P9.1 screens, restyled to the prototype (rule 8) with their data logic and
domain comments kept: no price is summarised (prices are per variant; comparing exact decimal
strings is wrong across digit counts); not-found stays collapsed with wrong-organization.

**Navigation fix.** The old catalog header was a developer hub (Stock, Drops, Finance, Reports,
My Trip, Switch). Removing it would have stranded Stock and Deliveries, so both were added to
More → Operations first; the rest were already reachable.

**PORT-NOTEs.** Price, units left and margin per row are not shown (price per variant; stock per
warehouse; margin needs cost arithmetic). The detail hero names the product rather than showing
one price. The prototype's wholesale/contract tier prices are *derived from the base price*
(`× 0.88`, `× 0.82`) — porting that would invent a pricing rule, which CLAUDE.md lists as a
blocker; not ported. Units sold, revenue and the 7-day chart need a per-product sales series.
"Add product" / "Edit" wait for endpoints.

**Verified** (read-only, zero mutating calls; run after DNS to Supabase recovered): More shows
Stock and Deliveries; 34 live products with categories resolved (`Breads A` / `No category`),
chips `All · Breads A`; product detail lists variant prices as exact decimals (`₦1,500.50`,
`₦850.00`) with SKUs; zero page errors. `tsc` ✓ `eslint` ✓.

### Sales — slice 4: Sales tab ✅

**Screen.** `sales` → `app/(tabs)/sales.tsx` (owner tab).

**Created.** `packages/ui` `TrendChart` (one Skia canvas via lazy `skia()`: Catmull-Rom flow line,
fading apricot area, active-day dot, day labels, accessibility label).
`features/branch/hooks/useBranchOptions` — branches derived from warehouses, extracted from the
logic duplicated in Reports and Finance. `features/reports/hooks/useRevenueWeek` — seven
`get_daily_revenue_summary()` reads via `useQueries`; today shares `useDailyRevenueSummary`'s key.

**Decision — chart coordinates.** Plotting a line requires converting the day's `net_revenue`
string to a number. `TrendChart` documents this as the single allowed conversion: the numbers
position the line only and are never displayed, summed, compared for business purposes or
stored; every figure a person reads is formatted from the exact string. Emptiness is judged on
the strings (`isZeroDecimalString`), not the plot numbers.

**PORT-NOTEs.** Week-over-week delta, average ticket, per-method split and the grouped payment
transaction feed need money arithmetic or a payments read that does not exist — replaced with
server-computed gross revenue / collected / refunds and a preview of today's real orders.
Branch picker shows branches as their stockroom name (no branches read exists).

**Verified** (read-only; the daily-summary RPC is the only RPC called, zero other non-GET calls):
hero renders today's server figures (`₦0.00` — correct, the smoke branch's only completed
ticket is from 22 Aug); collected line carries the server-resolved timezone `Africa/Lagos`;
exactly one canvas with its accessibility label (Skia charts confirmed working on web); 7
daily-summary calls; today's orders section with its empty state; zero page errors.
`tsc` ✓ `eslint` ✓. Added a "No sales recorded in the last 7 days" caption after the screenshot
showed an all-zero week read as an empty box.

**Verification harness fix.** Earlier drive failures after sign-in were fixed-delay timeouts on
a slow, flaky connection, not app faults — drives now wait on the tab bar itself.

### Sales — slice 5: New order wizard ✅ (create not executed)

**Screens.** `new-ticket` / `new-customer-order` → `app/new-order.tsx` (optional `?customerId=`).
Launched from the Orders FAB (not shown to drivers or bakers) and Customer → New order.
`created` (prototype confirmation screen) → replaced by navigating to the new order with a toast.

**API/hooks created.** `mutations/tickets.ts` `createTicket` — the plain-INSERT draft contract
`createRoadsideTicket` established, for operational roles. **Live RLS verified 2026-09-13:**
`tickets_insert` admits owner/admin/branch_manager/cashier/driver (drivers must stamp
`created_by`); `ticket_items_insert` follows the parent ticket's branch access.
`sale_customer_type` = `REGISTERED` with a customer, `ROADSIDE` for walk-in. Price is never sent
(`guard_order_item_price()` overwrites it); the subtotal comes from `recalculate_ticket_totals()`.
Hook `useCreateTicket` (invalidates ticket lists, seeds the detail cache).

**BLOCKER-030 raised.** The prototype's one-tap counter sale (`new-sale`: pick, pay, done) has no
lifecycle path for non-drivers — draft→completed is six guarded hops, and orchestrating them plus
a payment client-side would be a non-atomic financial event. Recorded in `BLOCKERS.md` and
`NOTIFICATIONS.md`; `new-sale` is not ported until decided.

**PORT-NOTEs.** No running money total in the dock (items and products are counted; the server
total appears on the created order). Payment at creation and customer-credit calculation belong
to BLOCKER-030. Order notes have no column.

**Verified** (read-only; request guard: zero mutating calls): Orders FAB → `/new-order`; Continue
disabled until a buyer is chosen; walk-in → step 2 lists 35 live active variants with steppers;
2 + 1 taps → dock "3 items · 2 products"; review shows fulfilment chips and the draft notice;
discard asks first; zero page errors. `tsc` ✓ `eslint` ✓. **Not executed:** Create order — an
INSERT into production.

**Harness.** Orphaned `expo start` node processes survived `TaskStop` on 8084–8086 and were
killed by port. Drives now wait on real UI state rather than fixed delays.

### Sales — slice 6: My sales ✅

**Screen.** `my-sales` → `app/(tabs)/my-sales.tsx` (cashier tab).

**Read-model change (`packages/types`, `packages/validation`, `packages/api`).** `Ticket` gains
`created_by: Uuid | null` and `completed_at: Timestamptz | null`, and `TicketFilters` gains
`createdBy`. Both columns exist live and are nullable (verified 2026-09-13); the projection is
generated from the schema, so every ticket read now carries them. **Why it was needed:**
`tickets_select` is scoped by tenant and branch only (verified live), so without a creator filter a
cashier's "My sales" would list the whole branch. `npm test` 39/39 ✓. **Regression-verified:** the
full Orders drive re-run against live data after the change reproduced every result (50 → 80 drafts,
completed ticket, detail, dock, sheets) — all 81 live tickets parse with the new columns.

**PORT-NOTEs.** The header's day total is a money sum (not done on the device); payment-method chips
need a payments read — the header counts sales, search covers number/customer/items. Rows open the
full order instead of a bottom sheet.

**Verified** (read-only): `/my-sales` sends `created_by=eq.<uid>` and `created_at=gte.<midnight>`;
projection includes `created_by` and `completed_at`; empty state for a user with no sales today;
zero mutating calls, zero errors. `tsc` ✓ `eslint` ✓.

---

### Sales domain — report

| Prototype screen | App route | Status |
|---|---|---|
| orders | `app/(tabs)/orders.tsx` | ✅ verified |
| order | `app/order/[id].tsx` | ✅ verified (writes not executed) |
| customers | `app/customers/index.tsx` | ✅ verified |
| customer | `app/customer/[id].tsx` | ✅ built — no live customer to open |
| products | `app/products/index.tsx` | ✅ verified |
| product-detail | `app/product/[id].tsx` | ✅ verified |
| sales | `app/(tabs)/sales.tsx` | ✅ verified |
| my-sales | `app/(tabs)/my-sales.tsx` | ✅ verified |
| new-ticket / new-customer-order | `app/new-order.tsx` | ✅ verified to review (create not executed) |
| created | → navigates to the new order | ✅ replaced |
| new-sale | `new-sale` | ✅ AD-024 |
| tickets (driver) | — | → driver-trips domain |

**API created:** `listTicketItemsForTickets`, `listCustomersByIds`, `TicketFilters.statuses` /
`createdBy`, `mutations/tickets.ts` (`advanceTicket`, `cancelTicket`, `createTicket`,
`nextTicketStatus`), `Ticket.created_by` / `completed_at`.
**Hooks created:** `useTickets`, `useTicketPages`, `useTicketWithItems`, `useTicketItemsForTickets`,
`useCustomersByIds`, `useAdvanceTicket`, `useCancelTicket`, `useCreateTicket`, `useCustomerPages`,
`useCustomer`, `useCustomersByPhone`.
**Cross-cutting rules applied:** no client-side money arithmetic; writes to production never
executed during verification; every transition and create path checked against the live function
or policy definition first.


### Finance — slice 1: Cash sessions + Expenses ✅

**Screens.** `cash` → `app/(tabs)/cash.tsx`, `my-cash` → `app/(tabs)/my-cash.tsx` (both render
`features/finance/components/CashScreen` with `mine`), `expenses` → `app/expenses/index.tsx`,
`add-expense` → `app/add-expense.tsx`.
**Components.** `CashSessionPanel` (open session ledger), `CashSessionSheets` (`OpenSessionSheet`,
`CloseSessionSheet` — Reanimated `Sheet`), `features/finance/financeDisplay.ts` (`CATEGORY_META`,
`METHOD_LABEL`, `varianceView`, `when`).
**Hooks used (existing):** `useCashSessions`, `useOpenCashSession`, `useCloseCashSession`,
`useExpenses`, `useCreateExpense`. No new API.

**PORT-NOTEs.** Variance is described from the sign of the server's exact figure; the prototype's
₦5,000 warning threshold and percentage-of-drawer are invented rule + money arithmetic, not ported.
"Spent today", month total, category flow bar and per-day subtotals are money sums (belong to a
server report). "My cash" narrows to `opened_by = me` as presentation only — RLS decides. Cash is
not hidden from supervisors (authorization is the database's call). Receipt photos wait for an
upload flow. A cash expense requires the branch's open till (same rule the old finance form used).

**Verified** (read-only; zero mutating calls, zero errors): More → Cash sessions sends
branch-scoped `cash_sessions` and `expenses` reads; "No open till" empty state; open-session sheet
keeps submit disabled until a valid float and shows the amount hint (never submitted); `/my-cash`
deep link; `/expenses` empty state + category chips; Add expense — save disabled when empty, bad
amount hint, cash + no till → warning and disabled, transfer → enabled (not pressed).

### Finance — slice 2: Finance overview + Reports ✅

**Screens.** `finance` → `app/(tabs)/finance.tsx` (replaces the 443-line do-everything form: its
payment, till and expense forms now live on Order detail, Cash sessions and Add expense), `reports`
→ `app/reports/index.tsx` (restyled; also covers `supervisor-reports`).

**Finance tab.** Ink hero "Money in today" (`net_collected`), 7-day net revenue `TrendChart` with a
quiet-week notice, foot stats (net revenue, refunds paid), four drill-in tiles (Revenue → Sales,
Expenses count today → Expenses, Cash session state + last variance → Cash, Reports), a profit
callout (revenue and cash only in this version), and the latest four expenses.
**Reports.** Hero (today's net revenue + week chart), a day switcher over the cached week (no extra
requests on switch — verified), the daily statement as ledger lines, and a menu of reports that
exist. Menu varies by persona (presentation only).

**Navigation fix.** `(tabs)/_layout.tsx` now uses `backBehavior="history"`: tab routes pushed from
another screen (Finance → `/cash`) previously returned to Home on back. Verified: back now lands
on `/finance`.

**PORT-NOTEs.** Net profit, margin, cost of goods, gross-margin tile and the "how revenue divides"
bar are out of MVP scope by decision (AD-022, which resolved BLOCKER-018 by descope), and the
prototype's fixed 40%/21.2% ratios are invented. Period switch (7/30/90 days), month hero, expense donut, P&L, Product performance, Branch
performance, PDF/spreadsheet export and scheduled e-mail need endpoints that do not exist — none is
shown as if available. `get_daily_revenue_summary` refuses supervisors server-side; shown as
returned.

**Verified** (read-only; zero mutating calls, zero errors): Finance tab issues 7 summary RPCs (one
per day, shared cache with Sales), 1 canvas, tiles and callout render, latest-expenses empty state;
Cash tile → `/cash` → back → `/finance`; Reports statement for 2026-09-13 Africa/Lagos, switching
to Sat shows 2026-09-12 with 0 new RPCs; menu Sales/Expenses/Cash sessions for owner.
`tsc` ✓ `eslint` ✓.

---

### Finance domain — report

| Prototype screen | App route | Status |
|---|---|---|
| finance | `app/(tabs)/finance.tsx` | ✅ verified (profit out of MVP scope — AD-022) |
| cash | `app/(tabs)/cash.tsx` | ✅ verified (open/close not executed) |
| my-cash | `app/(tabs)/my-cash.tsx` | ✅ verified |
| expenses | `app/expenses/index.tsx` | ✅ verified |
| add-expense | `app/add-expense.tsx` | ✅ verified to validation (save not executed) |
| reports / supervisor-reports | `app/reports/index.tsx` | ✅ verified |
| pnl | — | ⏸ out of MVP scope (AD-022) |
| report-products / report-branches | `reports/products` / — | ✅ products (Q2); branches ⛔ needs an endpoint |

**API created:** none. **Hooks created:** none (feature hooks reused: `useBranchOptions`,
`useRevenueWeek`). **Files changed:** `app/(tabs)/finance.tsx`, `app/(tabs)/cash.tsx`,
`app/(tabs)/my-cash.tsx`, `app/(tabs)/_layout.tsx`, `app/expenses/index.tsx`, `app/add-expense.tsx`,
`app/reports/index.tsx`, `features/finance/*`.


---

### Inventory domain — Stock ✅

**Screens.** `inventory-monitor` (+ the product screen's "Adjust") → `app/inventory/index.tsx` and
`app/inventory/[warehouseId].tsx`, both rendering `features/inventory/components/StockScreen`.
**Components.** `AdjustStockSheet` (Reanimated `Sheet`; absolute target, reason chips, note),
`features/inventory/stockDisplay.ts` (`REASON_LABEL`, `ADJUST_REASONS`, `signedDelta`,
`levelView`), `features/catalog/hooks/useVariantLabels.ts` (variant id → name; extracted from
`useOrderRows`, which now uses it). Removed: `components/AdjustStockAction.tsx` (replaced).
**Hooks created (`packages/hooks`).** `useStockMovementPages` (keyset pages of the ledger) and
`queryKeys.stockMovements`; `useAdjustStock` now also invalidates the movement feed.

**Behaviour.** Stockroom chips (default first) · search by product or SKU · sections Below zero /
Out of stock / On the shelf · tap a row → adjust sheet pre-filled with the current count (a target,
never a delta), validated by `nonNegativeQuantitySchema`, server errors in plain words, "No change"
toast when the target equals the level · recent movements with signed deltas and reason labels,
expandable and pageable.

**PORT-NOTEs.** "Running low" needs a reorder level product variants do not have (AD-022) — only out
and below-zero are flagged. Levels load one page of 200 per stockroom, with a visible notice beyond.
Items never moved have no level row. Ingredient stock deactivated for MVP (AD-022).

**Verified** (read-only; zero mutating calls, zero errors): More → Stock shows "Smoke Store A · 32
products", one level read and one movement read, 8 movement rows, no unnamed rows; search no-match
notice; adjust sheet pre-filled "42", 5-decimal and negative input show the hint and disable save,
Waste shows its hint, Escape closes (never saved). **Regression:** Orders → Pending still shows 25
named item lines, 0 generic. `tsc` ✓ `eslint` ✓ `npm test` 39/39 ✓.

### Production domain — order queue ✅ (batches out of MVP scope)

**Finding.** AD-022 (2026-09-01) deactivated production batches and ingredient tracking for MVP:
client grants on `production_batches`, `recipes`, `ingredients` are revoked and the batch RPCs are
not executable. The prototype's Record production / batch cards / production records / entry
corrections therefore have no backend in this version. What a baker *can* do — verified in
`IMPLEMENTATION_LOG.md` (update_ticket role-gate fix, 12 live assertions) — is move orders
`scheduled → in_production → ready`.

**Screens.** `production` + `production-monitor` → `app/(tabs)/production.tsx` (the kitchen queue:
Preparing / To start / Confirmed · not yet scheduled / Ready, with To start · Preparing · Ready
counts, a Stock link for waste); `app/production/[batchId].tsx` → a "not tracked in this version"
notice with a way to the queue. More → Operations gains Production for owner/manager.
**Components.** `features/production/components/ProductionCard.tsx` (Reanimated `FadeIn` entering +
`LinearTransition` layout, both `ReduceMotion.System`).
**Optimistic updates.** A move shows the card in its next section immediately with a busy button;
a refusal restores it and raises an error toast. No new API or hooks (`useOrderRows`,
`useAdvanceTicket`).

**Also.** `navigation/useOffBarBack.ts` — the prototype's `back: !ROLE_TABS[role].includes(tab)`:
tab screens reached from More (Production, Finance, Sales, My sales, Cash, My cash) get a back
arrow only when the tab is not on the persona's bar.

**PORT-NOTEs.** Batches/recipes/record-production quantity: AD-022. Schedule is hidden from bakers
because the trigger refuses it for them (advisory). The old batch screen and
`ProductionBatchActions`/`BatchStatusBadge` components remain in the repo for v2, unreferenced.

**Verified** (read-only): queue reads carry `in_production` status filters; zero reads of
`production_batches`/`recipes`; empty state for this branch (no orders currently in the queue — the
card and move path are typechecked but have no live row to render); old batch deep link shows the
notice; zero mutating calls, zero errors.

### Delivery domain ✅

**Screens.** `delivery-monitor` → `app/delivery/index.tsx` (stat tiles Need a driver / On the road /
Problems, Needs a driver section folded at 6, Drivers with stop/problem counts and an active
badge); `driver-detail` → `app/delivery/driver/[driverId].tsx` (new; grouped Active / Pending /
Problems / Completed / Returned, failure reasons shown, Call); delivery detail →
`app/delivery/[deliveryId].tsx` (ink hero with address, customer and Call; next-step buttons;
details; proof; link to the order).
**Components.** `features/delivery/deliveryDisplay.ts` (`DELIVERY_META`, `NEXT_ACTIONS` transcribed
from `guard_delivery_transition()`, `DRIVER_GROUPS`, `describeDeliveryError`),
`features/delivery/components/DeliveryActionSheet.tsx` (assign-driver radio list, dispatch confirm,
recipient name, failure reason, return confirm — each required field gates the button),
`features/delivery/hooks/useDeliveryBoard.ts` (open + today's deliveries, tickets, customers and
drivers joined in four batched reads). Removed (replaced): `components/DeliveryActions.tsx`,
`DriverPicker.tsx`, `DeliveryStatusBadge.tsx`. No new API or hooks.

**PORT-NOTEs.** Proof of delivery is a recipient name only (photo/signature needs upload + camera).
BLOCKER-016: a return restores no stock live — the return step says only that the delivery closes.
Stop items and amounts are one tap away on the order; unassigned stops get their own section (the
prototype lists drivers only).

**Verified** (read-only; zero mutating calls, zero errors): board reads use the open-status filter;
36 unassigned deliveries listed, no drivers in this tenant (driver detail typechecked, no live
driver to open); opening a delivery shows 4 detail lines and "Assign a driver"; its sheet shows the
"No drivers yet" callout with submit disabled; Escape closes. `tsc` ✓ `eslint` ✓.


### Driver-trips domain ✅

**Screens.**
| Prototype | App route |
|---|---|
| route (driver tab) | `app/(tabs)/route.tsx` — trip card, ink hero with animated progress track (Reanimated `withTiming`, `ReduceMotion.System`), stop cards with Call / Directions / Start / Delivered / Report a problem / Return, FAB New ticket |
| tickets (driver tab) | `app/(tabs)/tickets.tsx` — `created_by` scoped; Today / This trip / Not finished / Completed; search; FAB |
| trip | `app/trip.tsx` — no trip → pick vehicle + Start · created → waiting for loading · ready_to_depart → loaded stock + Confirm departure · in_transit → on-the-road hero, Create-ticket CTA, stock with you, Count what's left → Submit return · returning/reconciled → waiting states. `app/driver/home.tsx` now redirects here. |
| trip-verify + trip-reconcile | `app/trips/index.tsx` (Driver trips hub: Needs you / On the road / Completed today) and `app/trips/[tripId].tsx` (verify load from the default stockroom · reconcile with inventory ledger, sales and counted cash · settle into an open till · review) |
| new-ticket / created (driver) | `app/driver/sell.tsx` — products from the vehicle's stock with steppers → check → server total + payment (method chips, amount pre-filled with the server's exact total, "Customer pays later") → confirm panel (Reanimated `ZoomIn` spring) |

**Components / helpers.** `features/driverTrip/quantity.ts` (exact BigInt scale-4 quantity arithmetic —
`toUnits`, `fromUnits`, `sumQuantities`, `stepQuantity`, `isPositiveQuantity`; 18 unit tests),
`tripDisplay.ts` (`TRIP_STAGE`, `describeTripError`, `tripTime`), `components/CountStepper.tsx`,
`hooks/useWarehouseStock.ts`. `useDeliveryBoard` gained `{ branchId, driverId }` and item lines.
`DeliveryActionSheet` gained the prototype's failure-reason presets (+ "Other" with a note). More →
Driver trips (non-drivers), My trip → `/trip` (drivers). No new API or hooks.

**Data-integrity fix (`packages/types`).** `STOCK_REFERENCE_TYPES` lacked `'driver_trip'`, which
the live CHECK allows (read 2026-09-13) and `verify_trip_loading()`/`return_driver_trip()` write.
The first verified load would have made every ledger read containing those rows fail schema
parsing. Added; `npm test` ✓.

**Retry safety.** If `completeDriverFieldSale` fails after `createRoadsideTicket` succeeded, the
sell screen keeps the draft id and "Try again" completes that ticket instead of creating another.

**PORT-NOTEs.** Loading is one-party live (ADR-001 §23 item 5): the verifier records the load on
their device, so the driver's load-entry step is not ported. "Held by you" cash, per-method totals,
change and customer-credit maths are money sums — the server's `expected_cash`, `cash_variance`
and ticket totals replace them. Live reconciliation needs a note only for a *cash* variance and a
completed trip cannot be reopened (the prototype's stock-variance note and "Flag for correction"
have no backend). Roadside tickets have no customer by contract. Directions open maps.

**Verified** (read-only; zero mutating calls, zero errors): `/trips` reads trips (empty today);
`/trip` as owner shows the driver-view notice, vehicle chips and a disabled Start; `/route` sends
`driver_id=eq.` and shows the empty route, trip card and FAB; `/tickets` sends `created_by=eq.`,
"Not finished" lists 50 drafts; `/driver/sell` shows "No trip on the road"; `/driver/home` lands on
`/trip`. Trip mutations (start, verify, depart, return, reconcile, complete, sale, payment) are
typechecked against their live contracts and **not executed** against production.
`tsc` ✓ `eslint` ✓ `npm test` ✓ (57).


### Invitations & staff domain ✅

**Screens.** `staff` → `app/(tabs)/staff.tsx` (supervisor tab; More → Staff & activity for
owner/manager): searchable team grouped per person with role · branch lines, suspended badge, person
sheet (roles held, since, Call), Invite (+) and an Invites row for owner/admin. `invites` →
`app/invites.tsx` (status badges, detail sheet, "Send a new invite"). **New:** `app/invite.tsx` — the
invitee's side of `bakeflow://invite?token=…` (the link `send-invite-email` builds): accept →
`setActiveOrganization` → cache eviction → welcome panel (Reanimated `ZoomIn`).
**Components.** `features/staff/components/InviteStaffSheet.tsx` (email validated by
`inviteEmailSchema`, canonical role chips with hints, branch chips for branch roles; when delivery is
`simulated` — AD-023, no email provider — it says so and offers the link via the native share sheet
instead of claiming an email went out), `features/staff/staffDisplay.ts` (`INVITABLE_ROLES`,
`ORG_WIDE_ROLES`, `inviteView` — a pending invite past `expires_at` reads Expired; 3 unit tests).
**Navigation gate.** `app/_layout.tsx` lets a signed-in user stay on `/invite` with or without an
organization, and holds a token opened while signed out in memory
(`stores/auth/pendingInvite.store.ts`, never persisted — it is a bearer secret) through sign-in.

**API created (`packages/api`).** `queries/staff.ts`: `listStaffRoles` (user_roles ⋈ profiles ⋈
roles), `listOrganizationInvites` (token_hash never projected); `mutations/invitations.ts`:
`acceptOrganizationInvite` (token format checked, only string fields read from the envelope).
**Types/validation.** `StaffRole`, `OrganizationInvite`, `PROFILE_STATUSES`, `INVITE_STATUSES`;
`staffRoleSchema`, `organizationInviteSchema`, `inviteEmailSchema`.
**Hooks created.** `useStaffRoles`, `useOrganizationInvites`, `useCreateAndSendInvite` (invalidates
on settle — the row can exist even if email fails), `useAcceptInvite`; `queryKeys.staffRoles`,
`queryKeys.invites`. Every contract read live 2026-09-13 (`create_organization_invite` owner/admin
only; `organization_invites_select` owner/admin; `user_roles_select`/`profiles_select`
owner/admin/manager or self; no UPDATE grant on invites).

**Blocker raised.** BLOCKER-031 — `accept_organization_invite()` does not bind acceptance to the
invited email, and its expiry update is rolled back by the following RAISE. Recorded with a
notification; nothing changed server-side.

**PORT-NOTEs.** On-shift status, per-person sales/orders, activity timeline and sales-by-staff have
no read endpoint (and involve money sums). Copy link / Resend / Revoke per invite have no backend
(only the token hash is stored; no UPDATE grant). Invite is shown to owner/admin only (the RPC's
gate; advisory). Branch names come from stockrooms, as elsewhere.

**Verified** (read-only; zero mutating calls, zero errors): Staff reads `user_roles` and
`organization_invites` without selecting `token_hash`; one person (the smoke owner) listed; person
sheet opens; invite sheet — send disabled when empty and for a bad email, enabled for a valid one
(never pressed), Admin hides branch chips; `/invites` empty state; `/invite` without a token shows
the no-invite state, with a token stays on the accept screen (never accepted). `tsc` ✓ `eslint` ✓
`npm test` 60/60 ✓.


### Home & shell screens ✅

**Screens.**
| Prototype | App route |
|---|---|
| home (role-adaptive) | `app/(tabs)/index.tsx` → `features/home/OwnerHome`, `ManagerHome`, `SupervisorHome`, `CrewHomes` (`CashierHome`, `BakerHome`, `DriverHome`, `AdminHome`) |
| notifications | `app/(tabs)/alerts.tsx` — a live to-do feed derived from readable rows |
| operations (supervisor) | `app/(tabs)/operations.tsx` |
| settings | `app/settings.tsx` (Appearance sheet on the persisted theme store) |
| account / profile | `app/account.tsx` |
| audit | `app/audit.tsx` |
| org | `app/select-organization.tsx` (restyled as the prototype's Bakeries screen) |
| search | `app/search.tsx` |

**Components/hooks.** `features/home/components/HomeParts.tsx` (`HomeScaffold` greeting header with
Search and Notifications; `StatTile` with the prototype's staggered reveal — Reanimated
`FadeInDown.duration(420).delay(60 + i·55)`, `ReduceMotion.System`; `TileGrid`; `QuickActions`;
`SectionHead`), `features/home/hooks/useHomeData.ts` (`useTicketCount` — row counts only —
and `useOpenTill`). Removed: `components/PortPending.tsx` (no placeholder screens remain).
**API/hooks created.** `listAuditEvents` + `useAuditEvents` + `queryKeys.auditEvents`,
`AuditEvent` type and `auditEventSchema` (`before`/`after` snapshots never selected).

**Navigation fix.** `app/_layout.tsx` no longer bounces a signed-in user with an organization off
`/select-organization`; the picker is also the switcher (More → Organisation, Settings → Switch
bakery were dead ends) and returns home itself after a choice.

**PORT-NOTEs.** Owner: profit flow and margin (AD-022), expenses/net/deltas (money arithmetic) and
insights (no source) not ported; hero is server net revenue + collected, refunds, till state.
Manager: insights and the daily financial audit have no backend. Supervisor: sales total is a sum
and the revenue RPC refuses supervisors — hero counts orders. Cashier: one-tap sale waits on
BLOCKER-030. Baker: production records are AD-022 — hero counts orders to make. Admin: branches,
records archiving, audit detail and system settings belong to the Web workspace. Alerts: no
notifications table/push, so no history or read state. Settings: notification switches, haptics,
language, pricing tiers, billing, sessions, change password have no backend and are omitted.
Account: edit name / photo upload not built. Search: no full-text endpoint — newest 200 orders,
first 200 products/customers, exact phone lookup; the screen says what it searched.
`my-activity` is covered by My sales / Tickets; `sales-monitor` needs per-staff aggregates;
`states`/`ds` are prototype-only; `admin-*` are Web workspace.

**Verified** (read-only; zero mutating calls; zero errors except one transient 401 during a sign-in
that did not reproduce): owner Home — 7 summary RPCs, 1 chart, tiles Orders 0 / Needs attention 80 /
Cash session Closed / Stock, 3 quick actions, tile → `/orders`, bell → `/alerts`; Settings groups by
role, Appearance → Dark repaints the whole screen (screenshot), back to System; Account shows
Owner · Whole bakery; Audit lists 100 events without selecting `before`/`after`, own actions as
"You"; Alerts derives "No till is open"; Operations 7 tiles; Bakeries reachable from More with the
current-bakery card and Close back to More. `tsc` ✓ `eslint` ✓ `npm test` 60/60 ✓.


---

## Phase 4 — Motion polish ✅

Checked the main-app half of the prototype's `ANIMATIONS.md` (§14–§20) against the port and
filled the gaps. Every animation is Reanimated (UI thread, `ReduceMotion.System`), timed from
`packages/ui/tokens.ts`.

| Prototype motion | Where it lives now |
|---|---|
| §14 push / pop / tab-in | native stack `ios_from_right`; tab `sceneStyleInterpolator` (Phase 2) |
| §15 sheet up/down + scrim | `Sheet` (Phase 2), swipe-to-dismiss via Gesture Handler |
| §15 toast in/out | `Toast` Keyframe (Phase 2) |
| §15 dialog `dlg-in` | not used — confirmations are sheets (PORT-NOTE in `AdvanceTicketSheet`) |
| §15 **dock `dock-in`** 340ms | **new** `packages/ui/Dock.tsx` (`SlideInDown` on the out curve) — New order, Add expense, New ticket |
| §15 **confirm ring `pop`** 460ms | **new** `packages/ui/ConfirmRing.tsx` (Keyframe .6 → 1.04 → 1) — Sale recorded, Invitation accepted |
| §16 skeleton shimmer | `Skeleton` pulse (Phase 2) |
| §17 **number counters** 620ms easeOutCubic | **new** `packages/ui/CountUp.tsx` — hero figures on the Owner, Cashier, Manager, Supervisor and Baker homes, Finance, Sales and Sale recorded. Native: frames are written into a non-editable `TextInput` through animated props (no JS-thread work); web: frames commit through state. The final frame is always the caller's exact formatted string; `to` is only a plot-style number for the in-between frames. |
| §18 **chart entrance** | `TrendChart` draws its line (Skia `end` driven by a shared value, 620ms) while the area fades up; the active dot appears at the end; redraws when data changes |
| §19 **FAB `fab-in`** 420ms | `Fab` Keyframe (12px rise + scale .9) |
| §19 press scale, swipe-to-advance | `PressableScale`, `SwipeRow` (Phase 2) |
| §19 tile reveal stagger (420ms, 55ms apart) | `StatTile` `FadeInDown.delay(60 + i·55)`; Operations cards |
| §19 route progress track | Reanimated `withTiming` width in `route.tsx` |
| §19 production card move | `ProductionCard` `LinearTransition` + `FadeIn` |
| §19 `field-shake` | not ported — named in `ANIMATIONS.md` but absent from the prototype CSS |
| §20 reduced motion | `ReduceMotion.System` everywhere; verified on web with `prefers-reduced-motion: reduce` |

**Tokens added:** `duration.countUp` 620, `chartDraw` 620, `fabIn` 420, `dockIn` 340, `confirmPop` 460;
`motion.fabInY` 12, `fabInScale` .9, `popFrom` .6, `popOvershoot` 1.04.
Part 1 of `ANIMATIONS.md` (splash, onboarding carousel, dough bloom) belongs to the get-started flow,
which is outside this port's screen list (sign-in itself was ported in Phase 2).

**Verified** (web, read-only): the owner hero settles on "₦0.00" exactly; FAB opacity 0.56 early → 1
settled with identity transform; the New-order dock is visible with no residual transform; in a
reduced-motion browser context the FAB reads opacity 1 on first check; 1 chart canvas; zero page
errors. `tsc` ✓ `eslint` ✓ `npm test` 60/60 ✓.

---

## Phase 5 — Backend wiring & data integrity ✅

**Money.** Swept every `Number(` / `parseFloat` / `toFixed` in `apps/mobile`: each one on a money
value is a chart coordinate (`TrendChart`) or a count-up animation frame (`CountUp`), both documented;
every displayed figure is `formatNaira` of the server's exact string. Quantities that need arithmetic
(trip loaded/sold/returned, stepper counts) use exact BigInt scale-4 maths in
`features/driverTrip/quantity.ts` (18 tests).

**Tenant isolation.** Every new query key is `orgScoped(tenant, …)`; switching organization evicts the
`org` prefix (`AppProviders`; the invite screen calls `clearOrganizationScopedCache`). New reads never
select secrets (`organization_invites.token_hash`) or unbounded JSON (`audit_log.before/after`).

**Cache invalidation — stale-data bugs found and fixed (`packages/hooks`).** List keys for cash
sessions, expenses and payment tickets end in a branch segment (`'all'` when unscoped), so invalidating
the unscoped key never refreshed the branch-scoped queries the ported screens use. Symptoms: after
**closing a till** the Cash screen still showed it open for up to 30s; **recording a payment** left the
order, the order lists and the day's collected figure stale; a **cash expense** left the till stale.
Added `invalidatePrefixes()` and now invalidate by prefix:

| Mutation | Now also refreshes |
|---|---|
| `useOpenCashSession`, `useCloseCashSession` | every `cash-sessions` list (all branches) |
| `useRecordPayment` | the ticket, all `tickets` lists, `payment-tickets`, `cash-sessions`, `daily-revenue-summary` |
| `useCreateExpense` | every `expenses` list; `cash-sessions` for cash expenses |
| ticket transitions (`useAdvanceTicket`, `useCancelTicket`) | + `stock-movements`, `deliveries`, `driver-trip-tickets` |
| `useCreateRoadsideTicket` | + `tickets` |
| `useCompleteDriverFieldSale` | + the ticket, `tickets`, `product-stock-levels`, `stock-movements`, `daily-revenue-summary` |
| `useRecordDriverTripPayment` | + trip tickets, the ticket, `tickets`, `daily-revenue-summary` |
| trip start / verify / depart / return / reconcile / complete | + `product-stock-levels`, `stock-movements`, `cash-sessions` |
| `useAdjustStock` | + `stock-movements` (Inventory domain) |

**Schema drift fixed.** `STOCK_REFERENCE_TYPES` gained `'driver_trip'` (live CHECK) — the first
verified trip load would otherwise have broken every ledger read (Driver-trips domain).

**Navigation integrity.** Tabs use `backBehavior="history"`; the organization picker is reachable as a
switcher; invite links survive sign-in (token held in memory only).

**Manual smoke test.** `docs/SMOKE-TEST.md` walks through every write the ported screens perform
(orders, production moves, cash, expenses, stock, deliveries, a full driver trip, invitations, role
homes, reduced motion) on a test bakery. None of these writes were executed against production
during the port.

---

## Phase 6 — Final report

### Screen status (the Phase 0 inventory)

| # | Prototype screen | App route | Status |
|---|---|---|---|
| 1 | splash | — | ⏸ get-started flow, not in this port |
| 2 | get-started | `sign-in` | ✅ Phase 2 (onboarding carousel not ported) |
| 3 | login | `sign-in` | ✅ Phase 2 |
| 4 | org | `select-organization` | ✅ |
| 5 | home (role-adaptive) | `(tabs)/index` → `features/home/*` | ✅ all seven roles |
| 6 | search | `search` | ✅ `search_workspace()` (P9.9 Q6) |
| 7 | more | `(tabs)/more` | ✅ |
| 8 | my-activity | → `my-sales`, `tickets` | ↪ covered |
| 9 | profile | `account` | ✅ |
| 10 | notifications | `(tabs)/alerts` | ✅ live to-do feed (no notification history table) |
| 11 | orders | `(tabs)/orders` | ✅ |
| 12 | order | `order/[id]` | ✅ |
| 13 | new-ticket | `driver/sell` (driver), `new-order` | ✅ |
| 14 | created | confirm panel in `driver/sell`; order detail | ✅ |
| 15 | new-sale | `new-sale` | ✅ AD-024 (counter sale, one atomic RPC) |
| 16 | new-customer-order | `new-order` | ✅ |
| 17 | record-production | — | ⏸ AD-022 (batches out of MVP) |
| 18 | tickets | `(tabs)/tickets` | ✅ |
| 19 | trip | `trip` | ✅ |
| 20 | trip-verify | `trips`, `trips/[tripId]` | ✅ |
| 21 | trip-reconcile | `trips/[tripId]` | ✅ |
| 22 | route | `(tabs)/route` | ✅ |
| 23 | sales | `(tabs)/sales` | ✅ |
| 24 | finance | `(tabs)/finance` | ✅ (profit: AD-022) |
| 25 | pnl | — | ⏸ AD-022 |
| 26 | supervisor-reports | `reports` | ✅ |
| 27 | expenses | `expenses` | ✅ |
| 28 | add-expense | `add-expense` | ✅ |
| 29 | my-sales | `(tabs)/my-sales` | ✅ |
| 30 | cash | `(tabs)/cash` | ✅ |
| 31 | my-cash | `(tabs)/my-cash` | ✅ |
| 32 | add-my-expense | `add-expense` | ✅ same screen |
| 33 | reports | `reports` | ✅ |
| 34 | report-products | `reports/products` | ✅ P9.9 Q2 (no margin — AD-022) |
| 35 | report-branches | — | ⛔ needs a report endpoint |
| 36 | products | `products` | ✅ |
| 37 | product-detail | `product/[id]` | ✅ |
| 38 | customers | `customers` | ✅ |
| 39 | customer | `customer/[id]` | ✅ |
| 40 | staff | `(tabs)/staff` | ✅ |
| 41 | invites | `invites` (+ new `invite` for the invitee) | ✅ |
| 42 | operations | `(tabs)/operations` | ✅ |
| 43 | sales-monitor | → `orders` | ⛔ needs per-staff / per-method aggregates |
| 44 | inventory-monitor | `inventory`, `inventory/[warehouseId]` | ✅ |
| 45 | production | `(tabs)/production` | ✅ as the order queue (AD-022) |
| 46 | production-monitor | `(tabs)/production` | ✅ same |
| 47 | delivery-monitor | `delivery` | ✅ |
| 48 | driver-detail | `delivery/driver/[driverId]` | ✅ |
| 49 | account | `account` | ✅ |
| 50 | settings | `settings` | ✅ |
| 51 | audit | `audit` | ✅ |
| 52 | states | — | prototype-only showcase |
| 53 | ds | — | prototype-only showcase |
| 54–57 | admin-org / admin-staff / admin-records / admin-settings | Admin home links | ⏸ Web workspace (`ROLES-AND-PERMISSIONS.md`) |

**Totals:** 45 of the 57 rows are live on mobile, one more (`my-activity`) is covered by other screens;
of the rest, 2 wait on report endpoints, 2 are out of MVP scope
(AD-022), 4 belong to the Web workspace and 3 are prototype-only (`splash`, `states`, `ds`). No
placeholder screen remains.

### PORT-NOTEs

63 `PORT-NOTE` comments across 57 files (`grep -rn PORT-NOTE apps/mobile packages`). They fall into six
kinds:
1. **Money arithmetic not done on the device** — totals, deltas, margins, per-method splits, "held by
   you": replaced by the server's figures or by row counts.
2. **Out of MVP scope (AD-022)** — profit, cost of goods, margin, production batches, ingredients,
   reorder levels.
3. **No endpoint yet** — P&L, product/branch reports, sales monitoring, notification history, full-text
   search, per-staff shift data, invite revoke/resend, profile update.
4. **Decisions left to the database** — role-gated controls are advisory and refusals are shown as
   returned; BLOCKER-030 and BLOCKER-031 raised where a decision is missing.
5. **Missing dependency or flow** — photo proof and receipt upload (camera/upload), backdrop blur
   (expo-blur), the Inter font (expo-font), the offline queue (P10).
6. **Prototype fiction replaced by the live contract** — one-party trip loading, roadside tickets without
   customers, delivery vs roadside tickets, bearer-link invites.

### Where the tokens live

`bakeflow-frontend/packages/ui/tokens.ts` is the single source: themed light/dark colours, fixed
colours, semantic ink/tint pairs, radius, layout, type scale with pixel line-heights, weights,
elevation, easing curves, durations and motion distances. `apps/mobile/tailwind.config.js` imports it
(colours as `rgb(var(--bf-*) / <alpha-value>)`), `ThemeProvider` injects the variables at runtime, and
`packages/ui/motion.ts` turns easing and duration tokens into Reanimated configs.
`docs/DESIGN-TOKENS.md` carries a supersession notice pointing here.

Correction to **D4**: charts ended up drawn directly with Skia (`TrendChart`) rather than Victory —
one chart style was all the port needed, and drawing it directly keeps the entrance animation in our
hands.

### New API, hooks and package work (all phases)

- **API** (`packages/api`): `mutations/tickets.ts` (advance, cancel, create), `listTicketItemsForTickets`,
  `listCustomersByIds`, `TicketFilters.statuses` / `createdBy`, `listStaffRoles`,
  `listOrganizationInvites`, `listAuditEvents`, `acceptOrganizationInvite`.
- **Hooks** (`packages/hooks`): tickets and customers (Sales), `useStockMovementPages`, `useStaffRoles`,
  `useOrganizationInvites`, `useCreateAndSendInvite`, `useAcceptInvite`, `useAuditEvents`, plus
  `invalidatePrefixes` and the invalidation fixes above.
- **Types / validation:** `Ticket.created_by` / `completed_at`, `StaffRole`, `OrganizationInvite`,
  `AuditEvent`, the `'driver_trip'` reference type, `inviteEmailSchema`.
- **UI kit** (`packages/ui`): the Phase 2 primitives plus `CountUp`, `Dock`, `ConfirmRing`, the `Fab`
  entrance and the `TrendChart` draw.
- **No new dependencies.**

### Known gaps

- **Decided since the report:** BLOCKER-030 resolved as AD-024 (counter sale built, backend live);
  BLOCKER-031 decided as AD-025 (invite acceptance bound to the invited email, expiry persisted) —
  applied live; extended by AD-026 (invites by role to email or phone, manager invites, SMS sign-in). Still open from
  before: BLOCKER-016 (returned deliveries restore no stock), BLOCKER-017 (production status writable
  directly).
- **Writes not executed against production:** every create, transition, payment, trip and invite path is
  typechecked against its live contract and read-verified, but has not been pressed. Run
  `docs/SMOKE-TEST.md` on a test bakery.
- **Screens verified empty only:** production queue cards, driver detail and trip detail stages (the
  smoke tenant has no queued orders, drivers or trips).
- **Native-only paths not exercised:** `CountUp`'s animated-props text path, gestures and Skia on a
  physical device — verification ran in the web export.
- **Endpoints to build:** a ranged revenue report, product and branch performance, per-staff and
  per-method sales, notification events, full-text search, invite revoke/resend, profile update, file
  upload (receipts, proof of delivery).
- **Presentation limits:** branches are named by their first stockroom (a `branches` read is allowed
  live and could replace this); lists read at most 200 rows where noted.
- **Harness noise:** a 401 console line appeared twice during automated sign-in and did not reproduce
  in two runs with request logging.

### Next steps for the web version

1. **Share the data layer as-is.** `@bakeflow/api`, `@bakeflow/types`, `@bakeflow/validation`,
   `@bakeflow/hooks` and `@bakeflow/utils` carry no React Native UI; only `@bakeflow/auth`'s session
   storage is platform-specific, and it already sits behind a storage interface
   (`createChunkedStorage`) that a web adapter can implement.
2. **Share the tokens, not the components.** `tokens.ts` is plain data: feed it to the web Tailwind
   config the same way `apps/mobile/tailwind.config.js` does, and build web components (tables, wide
   layouts, keyboard-first forms) on the same colours, type scale, radii, elevation and motion
   durations.
3. **Build the Web-workspace screens the mobile port deferred:** admin-org, admin-staff, admin-records
   (archiving), admin-settings, audit detail with safe before/after diffs, and the report screens once
   their endpoints exist (product and branch performance, sales by staff and method; P&L if AD-022 is
   lifted).
4. **Switch on Supabase phone sign-in** (an SMS provider) before relying on phone invites; the counter
   sale (AD-024) and invite binding (AD-025/026) are live.
5. **Choose the framework with the shared packages in mind** — a React-based framework keeps the hooks
   and TanStack Query cache reusable. Expo's web export already renders the mobile screens and can serve
   as a preview, but it is not a desktop-grade management UI.

---

## Addendum 2026-09-14 — counter sale (AD-024) and invite binding (AD-025)

**Counter sale — `app/new-sale.tsx`, following the prototype's `new-sale` step for step.**
- Step 1 (products): customer row (walk-in by default, sheet to pick a saved customer), search,
  category chips, two-column `SaleTile` grid (category code, "N in bag" badge that opens a quantity
  sheet, price or "Out of stock", deck where `−1` slides open to 36% on the navigation curve).
- Step 2 (payment): items with line totals and total (Edit returns to step 1), Cash / Transfer / POS
  tiles; cash with no open till shows a callout and disables Confirm.
- Step 3 (done): `ConfirmRing`, "Sale recorded", ticket number · customer, `CountUp` of the **server**
  total, recap, payment method; New sale / Today's sales / Back to home.
- Dock: Total and Continue / Confirm sale, "N items · tap to review" opening the basket sheet; leaving
  with items asks to discard.
- Data: `completeCounterSale` (`packages/api/mutations/counter-sale.ts`) → `useCompleteCounterSale`
  (invalidates tickets, payment tickets, stock levels, stock movements, daily revenue, cash sessions).
  Basket is the in-memory `stores/ui/counterSale.store.ts`, so Cashier home shows "Continue sale · N
  items". Device totals are an exact BigInt preview (`features/sales/saleMath.ts`, 3 tests).
- Errors mapped by `errorReason()`: `no_open_till`, `insufficient_stock`, role refusal, unavailable
  product.

**Verified (web export, read-only drive — Confirm never pressed, zero `complete_counter_sale` calls,
no mutating requests):** 35 tiles (3 out of stock), two adds → badge + dock total ₦1,700.00 + "2 items ·
tap to review"; payment step shows 1 line + total and 3 methods; Cash with no till → callout and
Confirm disabled; Transfer → Confirm enabled; discard sheet on close. The drive found the "N in bag"
badge text invisible (the default `text-cocoa` beat `text-apricot` on stylesheet order, same shade as
the pill) — fixed with an inline token colour. The backend path itself was exercised in rolled-back
SQL (AD-024).

**Invites (AD-025, client side):** `acceptOrganizationInvite` maps `{accepted:false, status:'expired'}`
to an `invalid_transition` error; `app/invite.tsx` explains `email_mismatch` and expired links; the
invite sheet warns the link only works for the invited email. Server migration pending application.

### Addendum 2026-09-14 (later) — invites by role, email or phone (AD-026)

- `InviteStaffSheet`: **Send to** Email | Phone number; phone field normalises Nigerian numbers and shows
  "Invite goes to +234 …"; **Role** chips start with nothing selected (Send disabled until chosen), filtered
  by inviter (`invitableRolesFor`: owner all, admin below admin, manager crew); **Works at** for branch
  roles. Phone invites skip `send-invite-email` and open the share sheet ("Send by WhatsApp or SMS").
- `(tabs)/staff` and `invites`: branch managers may invite (`canInvite`); rows show email or grouped phone
  (`inviteRecipient`); unnamed phone sign-ups show by phone.
- `sign-in`: Email | Phone number. Phone → Send code → 6-digit code → Sign in (`requestPhoneCode` /
  `verifyPhoneCode` in `@bakeflow/auth`); asks for a name when an invite link is waiting; maps Supabase's
  provider-disabled, bad-code and rate-limit errors to plain words.
- `invite`: explains `phone_mismatch`; shows the signed-in email or phone.
- `@bakeflow/validation`: `toE164Phone`, `formatPhone` (+7 tests); invite schema/type carry `phone`.

**Verified (web export, read-only — no code requested, no invite sent; zero OTP/invite calls, no
mutating requests, no page errors):** sign-in phone mode (partial number → error + Send disabled; full
number → Send enabled; password hidden); invite sheet (Send disabled at start; phone hint; no role
preselected; owner offered Cashier…Admin; choosing Cashier shows Works at and enables Send; Admin hides
Works at); Invites list loads with the new `phone` column. The drive caught the sign-in method switch
stretching to fill the screen (horizontal ScrollView in a centred column) — wrapped and re-verified.
Manager-only role list covered by unit tests (no manager account on the smoke tenant).

### Addendum 2026-09-14 (reports) — revenue over a period and product performance (P9.9 Q1/Q2)

- `(tabs)/finance`: the prototype's 7 / 30 / 90-day switch now drives the hero ("Money in · last N
  days", with range and order count), the chart, the foot stats and the Revenue tile.
- `reports`: "This month so far" hero (net revenue, orders, range) over a month chart; the daily
  statement became a period statement (Today · 7 days · This month · Last month); Product performance
  is in Available reports for owner, admin, manager and cashier.
- `reports/products` (new): Sales value | Units sold, period chips, a total card, the prototype's
  `.hbar` "Which products make the money?" (top 8) and the full list with units, orders, category and
  server-computed share; rows open the product. Margin switch, margin leaders and the sell-out insight
  are omitted (AD-022 / no data).
- `features/reports/hooks/useRevenueWeek` now wraps one `get_revenue_report()` call (it made seven
  daily calls dated by the device's calendar); every consumer kept its shape.
  `features/reports/reportDisplay.ts` (+4 tests): period labels, sparse chart labels, range labels.

**Verified (web export, read-only):** live data — Finance 7d/30d ranges (8 Sept – 14 Sept, 16 Aug – 14
Sept), Reports month hero and statement for Today and Last month (1 Aug – 31 Aug), product report
periods and ordering requested correctly (`get_revenue_report` ×6, `get_product_performance` ×4); the
smoke branch has no completed sales in 90 days, so the populated states were rendered with the two
RPCs intercepted in the browser and sample payloads of the same shape (bars, list, shares, 90-day chart
labels, units ordering). No mutating requests, no page errors.

### Addendum 2026-09-17 — search, invite actions, account editing (P9.9 Q6/Q7/Q8) with screenshot parity

Compared at 390 × 844 against the prototype served locally (`#owner/search`, `nav('search',{q})`,
`#owner/account`, `nav('invites')` + tapping a pending invite). Captures: `parity/p-*.png` vs `a-*.png`
(scratch, not committed).

**search** — now `search_workspace()`: groups Customers / Orders / Products with IconTile rows (user,
bag, box), six per group, the prototype's copy ("Search customers, orders, products.", "No matches / Try
a different name, reference or phone number."), 180 ms debounce, no placeholder, magnifier after the
input. Remaining differences, with reasons:
- Deliveries and Production groups are not searched (production is the order queue — AD-022; deliveries
  have their own board); owner hint therefore omits "deliveries".
- Product sub-line is "from ₦X · N sizes" instead of "₦X · N left" (stock is per stockroom).
- The prototype keeps the tab bar under Search and its title sits 9 px lower; the app opens Search as a
  stack screen without the tab bar (shell-wide, pre-existing).

**invites** — tapping an invite opens the prototype's action sheet: title with ×, "role · sent · status",
a Resend invite row, a tinted Revoke invite button, Close. Differences: no "Copy invite link" row (only a
hash is stored; Resend shows a new link); Revoke asks for confirmation (audited, irreversible); revoked
invites stay listed as Revoked; no scrim blur (no expo-blur).

**account** — prototype layout: card with avatar, name and Edit; Details: Branch, Role, Bakery.
Differences: an extra Contact phone row (the number the team calls from Staff); no "+" photo button (Q9);
Edit is the standard 46 px button rather than the prototype's `-sm` 44 px; Edit opens a sheet for name and
contact phone (the prototype only toasts).

**Kit corrections found by the comparison (affect every screen, all toward the prototype CSS):**
`Button` `secondary` = cream-deep fill, no border (`.btn.-secondary`); `danger` = error tint with error ink
(`.btn.-danger`); `Sheet` shows the prototype's × close whenever it has a title (`sheet()` header);
`SearchBar` darkens to a 1.5 px cocoa border on focus (`:focus-within`), hides the web focus outline, and
takes `iconPosition="end"` for the prototype's global search and counter-sale bars.

Behaviour verified read-only (`verify_q678.py`): live search requests for "pie", "zzzz", "TKT" (product
row, No matches, 6 orders); account rows and Edit validation (bad phone disables Save; `+234 803 123 4567`
hint); invites with sample rows intercepted in the browser — pending sheet (Resend + Revoke), revoke
confirmation, expired sheet offers Resend, accepted sheet offers nothing. Zero revoke/resend/profile
calls, no mutating requests, no page errors.

