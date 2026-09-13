# Prototype → React Native port

Living record of porting the design prototype into `apps/mobile`. Phase reports,
decisions, PORT-NOTEs and the final status table all land here.

- **Visual/UX spec (read-only):** `# BakeFlow frontend design/export/bakeflow-frontend/`
- **Write target:** `bakeflow-frontend/apps/mobile` + `bakeflow-frontend/packages/*`
- **Rule:** the prototype is a reference. Nothing is transliterated — every screen is
  rebuilt with RN primitives, NativeWind, Reanimated and the existing hooks.

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
| new-sale | — | ⛔ BLOCKER-030 |
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
