# BakeFlow mobile — manual smoke test

A walk-through of every write the ported screens perform. During the port each screen was
checked against live data **read-only** (no write was ever sent to production), so this list is
the part nobody has pressed yet. Run it before relying on the new screens.

## Before you start

- **Use a test bakery, never a real one.** Every step below writes real rows: orders, payments,
  stock movements, cash sessions, invites. Nothing here can be undone from the app.
- You need one account per role you want to test (owner, branch manager, cashier, baker,
  driver, supervisor). Invite them from **More → Staff & activity → +** (see §8).
- Run the app with `npx expo start` from `bakeflow-frontend/apps/mobile`, on a phone (Expo Go /
  dev build) and, if you like, in the web preview. Test at least once on a real phone — the
  count-up figures and gestures use a native path that the web preview does not.
- Keep **More → Settings → Audit log** open on the owner's phone: most steps should add an entry.

Each step says what to do, then what you should see. Tick it or note what happened instead.

---

## 1. Sign in and bakery switching (any role)

1. Sign in. → You land on **Home**, greeted by time of day, with your bakery's name underneath.
2. More → **Organisation**. → The Bakeries screen shows your current bakery with a tick.
3. If the account belongs to two bakeries, tap the other. → "Now in …" toast, back on Home, and
   every figure now belongs to that bakery (nothing from the first one shows, even briefly).
4. Settings → **Appearance** → Dark, then System. → The whole app repaints each time.

## 2. Orders (owner, manager, cashier)

1. Orders → **New order** → Walk-in → add 2 products → Continue → Create order.
   → Order detail opens as **Draft** with a server-calculated total.
2. On the order, advance it step by step: **Submit → Confirm → Schedule**.
   → Each step asks first, then updates the badge. Confirm issues the invoice.
3. As a **cashier**, try **Start preparing**. → Refused with a plain message (bakers and managers
   do that step).
4. Record a payment of part of the total (Cash, with a till open — see §4).
   → The order shows **Part paid** immediately (no pull-to-refresh needed), Sales "Collected"
   rises, the till's expected cash rises.
5. Cancel a different draft with a reason (manager). → **Cancelled**, reason shown.
6. Orders list: swipe an order left (owner/manager, Today filter). → It moves to its next step.

## 3. Production queue (baker, manager)

1. With a **Scheduled** order from §2, open **Production** as the baker.
   → It sits under *To start*.
2. Tap **Start preparing**. → The card jumps to *Preparing* at once, then a toast confirms.
3. Tap **Mark ready**. → Moves to *Ready*.
4. Turn off Wi-Fi and tap a move. → The card jumps, then returns with an error toast.

## 4. Cash and expenses (manager, cashier)

1. **Cash** (manager tab) / **My cash** (cashier) → **Open session** with a float, e.g. `20000`.
   → Session ledger appears; an "Open" badge sits in the header.
2. **Add expense** → `2500`, Ingredients, paid with Cash → Save.
   → Appears under *Today* in Expenses; the till ledger reflects it.
3. Add expense with **Transfer** while no till is open. → Allowed; cash is refused with a warning.
4. Close the session with a counted amount that differs from expected.
   → The Cash screen shows it closed **immediately**, with *Short by / Over by* and the note.
5. Finance tab → the Cash session tile reads *Closed* with the last variance.

### 4b. Counter sale (cashier, manager)

1. Cashier Home → **Record sale**. Leave *Walk-in customer*. Tap **Tap to Add** on a product twice,
   and once on another. → Badge "2 in bag" on the first; dock total = the sum of the prices; "3 items ·
   tap to review".
2. Tap **−1** on the first tile. → Badge "1 in bag", total drops by one price. Tap the badge → set
   `4` → total updates.
3. Close (×) with items in the bag. → "Discard this sale?" — cancel it. Go Home. → **Continue sale ·
   N items** is shown; tap it to come back to the same bag.
4. **Continue** → Items list with line totals and the total. Choose **Cash** with *no* till open.
   → Callout says a till must be open; **Confirm sale** is disabled.
5. Open a till (§4.1), come back, choose Cash → **Confirm sale**.
   → Ring, "Sale recorded", ticket number, total counts up to the same figure, recap lines.
6. **Today's sales** → the ticket is *Completed* and *Paid*. Stock for those products dropped by the
   quantities sold. The till ledger shows the cash payment.
7. **New sale** → pick a saved customer, **Transfer** → Confirm. → Completed and paid; no till needed.
8. Try to sell more than is in stock (use the badge to set a large number). → "There is not enough stock for one
   of these products", and nothing is recorded (no new ticket, stock unchanged).
9. As a **baker** or **driver**, check that Record sale is not offered.

## 5. Stock (owner, manager, baker)

1. More → **Stock** → tap a product → set the count to a new number → *Correction* → Save count.
   → "Stock updated", the row shows the new count, and *Recent stock movements* shows the signed
   change (e.g. `+3`).
2. Save the same count again. → "No change" toast; no new movement.
3. As a **baker**, try *Correction*. → Refused. Try *Waste* with a lower count. → Accepted.
4. Try `-2` or `3.12345`. → Save stays disabled with a hint.

## 6. Delivery (manager, driver)

Needs an order with delivery fulfilment and a driver account.

1. More → **Deliveries** → the delivery under *Needs a driver* → **Assign a driver** → pick the
   driver. → Moves under that driver on the board.
2. As the **driver**, open **Routes**. → The stop shows with Call, Directions and **Start**.
3. Start. → *On the road*; the stop card gets an apricot edge; the order must be **Ready** first —
   if it is not, the refusal says so.
4. **Report a problem** → *Wrong address*. → *Problem*; the reason shows on the board.
5. **Return** → confirms and closes the delivery. (Known gap: stock is not restored — BLOCKER-016.)
6. On another stop: **Delivered** → recipient name. → *Delivered*; the order can now be completed.

## 7. Driver trip, end to end (driver + manager + baker/supervisor)

1. Driver: More → **My trip** → pick the vehicle → **Start trip**. → *Waiting for loading*.
2. Manager/baker/supervisor: More → **Driver trips** → the trip under *Needs you* → count stock
   onto the vehicle (steppers step by 10, or type) → **Confirm loading**.
   → Branch stockroom levels drop, the vehicle's rise (check Stock → vehicle stockroom).
3. Driver: pull to refresh → *Loaded and verified* with the loaded list → **Confirm departure**.
4. Driver: **Create ticket** → pick products from the vehicle → Continue → **Create ticket**.
   → The server total appears on the payment step.
5. Lower the amount below the total → Cash → **Record payment**. → "Sale recorded" with the tick
   popping in; the order shows *Part paid*; *Stock with you* dropped by what was sold.
6. Repeat once with **Customer pays later**. → Completed with nothing collected.
7. Driver: **Start return to bakery** → counts start at what the vehicle holds → adjust one →
   **Submit return**. → *Reconciling*.
8. Manager: Driver trips → the trip → check *Inventory* (loaded / sold / returned per product,
   *still on vehicle* where the count was lowered) and *Sales on this trip* → enter counted cash
   that does **not** match → **Reconcile trip**. → Refused asking for a note; add a note → accepted.
9. Manager: with a till open at the branch → **Settle & complete trip**.
   → *Trip completed*; the till's expected amount reflects the trip's cash.
10. Turn off Wi-Fi during step 4 **after** the ticket is created but before it completes (hard to
    time; optional). → "Ticket saved, sale not completed" → reconnect → **Try again** completes the
    *same* ticket (check Tickets: only one new ticket).

## 8. Staff and invitations (owner, admin, branch manager)

Invites are **by role**, to an **email or a phone number**, and only the invited person can use the
link (AD-025/AD-026). Phone steps need phone sign-in switched on in Supabase (see `NOTIFICATIONS.md`).

1. Owner: More → Staff & activity → **+**. → *Send invite* is disabled; no role is selected.
2. Choose **Email**, enter an address you can open on a phone, pick role *Cashier* → a branch appears
   under *Works at* → **Send invite**.
   → While email delivery is not configured you see **"No email was sent"** with the link and a
   **Share link** button. (Once a Resend key is set, it says "Invite sent" instead.)
3. Open the link on the invitee's phone **while signed out** → sign in **with that email** → you land on
   **You have been invited** → **Accept invitation**. → "Welcome to …", then the Cashier home.
4. Owner: Invites → the invite shows **Accepted**; Staff lists the new person with their branch.
5. Open the same link again. → "already been used" message.
6. Send an invite to one email, then open its link signed in as a **different** account.
   → "This invite was sent to a different email address"; Invites still shows it **Pending**.
7. **Phone invite:** + → **Phone number** → type `0803 123 4567` → hint "Invite goes to +234 803 123 4567"
   → role *Driver* → branch → **Send invite**. → "Send the invite" with **Send by WhatsApp or SMS**.
   Invites lists it by the phone number.
8. On the invitee's phone, open that link signed out → **Phone number** → the number → the *Your name*
   field shows → **Send code** → enter the texted code → **Sign in** → **Accept invitation**.
   → Welcome, Driver home. Staff shows them by name (or by phone if no name was given).
9. Open a phone invite while signed in with a different phone or an email account.
   → "This invite was sent to a different phone number".
10. **Branch manager:** sign in as a manager → Staff → **+**. → Roles offered are only Cashier, Baker,
    Driver, Supervisor; *Works at* lists their branch. Send one. → Invites shows only their branch's
    invites.
11. As a **cashier**, check that + is not offered and Invites explains who sends invites.
12. Open a link older than 7 days. → "This invite has expired"; Invites now shows it **Expired**.

## 9. Role homes (one pass per role)

Sign in as each role and check Home makes sense for the job:

| Role | Home should lead with |
|---|---|
| Owner | Revenue today (counts up), week chart drawing in, Orders / Needs attention / Cash / Stock tiles |
| Manager | Open right now (count), pending / preparing / ready, Next up orders, Driver trips row |
| Supervisor | Today's operation (order count), Stock warnings, Kitchen, Deliveries |
| Cashier | Today's sales, New customer order, Recent sales |
| Baker | Orders to make, Open production queue |
| Driver | Trip card, Create ticket, route timeline |
| Admin | Admin console links |

Then **Alerts** (bell): it should list what currently needs someone (e.g. "No till is open"), and
each row opens the right screen.

## 10. Reduced motion

Turn on the phone's Reduce Motion (iOS: Accessibility → Motion; Android: Remove animations).
→ Screens, sheets, tiles, the FAB and figures appear without movement; everything still works.

---

**Report back:** for anything that behaved differently, note the step number, the role, what you
saw, and the time (the Audit log timestamp helps match it to the server).
