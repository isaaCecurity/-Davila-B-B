/* ==========================================================================
   BAKEFLOW — Orders, order detail, tickets, ticket creation flow, route
   ========================================================================== */

/* ---------------------------------------------------------------- ORDERS --- */
const ORDER_FILTERS = [
  { k:'today',     l:'Today' },
  { k:'pending',   l:'Pending' },
  { k:'ready',     l:'Ready' },
  { k:'upcoming',  l:'Upcoming' },
  { k:'completed', l:'Completed' },
  { k:'cancelled', l:'Cancelled' },
];

function filterOrders(k, q = '') {
  let rows = DB.orders.slice();
  if (APP.role === 'staff') rows = rows.filter(o => o.staff === user().id);
  if (APP.role === 'owner') rows = rows.filter(o => branchMatch(o.branch));
  if (k === 'today')     rows = rows.filter(o => o.when === 'today');
  if (k === 'upcoming')  rows = rows.filter(o => o.when === 'upcoming');
  if (k === 'pending')   rows = rows.filter(o => ['pending','preparing'].includes(orderStatus(o)));
  if (k === 'ready')     rows = rows.filter(o => ['ready','delivering'].includes(orderStatus(o)));
  if (k === 'completed') rows = rows.filter(o => orderStatus(o) === 'completed');
  if (k === 'cancelled') rows = rows.filter(o => orderStatus(o) === 'cancelled');
  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter(o => C(o.cust).name.toLowerCase().includes(s) ||
      o.ref.toLowerCase().includes(s) || itemLine(o.items).toLowerCase().includes(s));
  }
  return rows;
}

SCREENS.orders = {
  tab: 'orders',
  render(p) {
    const active = p.filter || 'today';
    const q = p.q || '';
    const rows = filterOrders(active, q);
    const counts = {};
    ORDER_FILTERS.forEach(f => counts[f.k] = filterOrders(f.k).length);

    return `${appbar({ title:'Orders', back: !ROLE_TABS[APP.role].includes('orders'),
      sub: APP.role === 'owner' ? `<span data-open-branch-picker style="cursor:pointer">${APP.viewBranch === 'All' ? 'All branches' : APP.viewBranch}</span> · ${DB.orders.filter(o=>o.when==='today').length} today` : `${APP.branch} · ${DB.orders.filter(o=>o.when==='today').length} today`,
      right:`<button class="iconbtn -tinted" data-order-search aria-label="Search orders">${icon('search', 19)}</button>
             <button class="iconbtn -tinted" data-order-filter aria-label="More filters" style="margin-left:8px">${icon('filter', 19)}</button>` })}
    <div class="body -with-tabbar -flush">
      ${q ? `<div class="flush-pad" style="padding-bottom:var(--s-3)">
        <div class="searchbar">${icon('search', 17)}
          <input id="ord-q" value="${esc(q)}">
          <button class="clear" data-clear-q aria-label="Clear search">${icon('close', 16)}</button></div>
      </div>` : ''}

      <div class="chips" data-chipgroup id="ord-chips" role="tablist" style="margin-bottom:var(--s-4)">
        ${ORDER_FILTERS.map(f => `<button class="chip" data-val="${f.k}" aria-pressed="${f.k === active}">
          ${f.l}${counts[f.k] ? `<span class="c-count">${counts[f.k]}</span>` : ''}</button>`).join('')}
      </div>

      <div class="flush-pad">
        ${rows.length ? `
          ${active === 'today' && ['owner','manager'].includes(APP.role) ? `<div class="hintline" style="margin-bottom:var(--s-3)">
            ${icon('info', 13)} Swipe an order left to advance or cancel it.</div>` : ''}
          <div class="stack-3" id="ord-list">
            ${rows.map(o => swipeRow(o, active === 'today' && ['owner','manager'].includes(APP.role))).join('')}
          </div>
          <p class="meta" style="margin-top:var(--s-5);text-align:center">
            ${rows.length} order${rows.length === 1 ? '' : 's'} · ${money(rows.reduce((s, o) => s + o.total, 0))}</p>`
        : emptyOrders(active, q)}
      </div>
    </div>
    <button class="fab" data-nav="${APP.role === 'staff' ? 'new-customer-order' : 'new-ticket'}">${icon('plus', 18)} New order</button>`;
  },
  mount(el, p) {
    const active = p.filter || 'today';
    $('#ord-chips', el)?.addEventListener('chipchange', e =>
      nav('orders', { filter: e.detail, q: p.q }, 'replace'));

    $('[data-order-search]', el).onclick = () => {
      nav('orders', { filter: active, q: p.q || ' ' }, 'replace');
      setTimeout(() => $('#ord-q')?.focus(), 60);
    };
    const qi = $('#ord-q', el);
    if (qi) {
      qi.value = (p.q || '').trim();
      let t;
      qi.oninput = () => { clearTimeout(t); t = setTimeout(() => {
        const cur = APP.stack.at(-1); cur.params = { filter: active, q: qi.value || ' ' };
        const rows = filterOrders(active, qi.value.trim());
        const list = $('#ord-list', el);
        if (list) list.innerHTML = rows.map(o => swipeRow(o, active === 'today' && ['owner','manager'].includes(APP.role))).join('');
        else refresh();
        wireCommon(el); wireSwipes(el);
      }, 130); };
      $('[data-clear-q]', el).onclick = () => nav('orders', { filter: active }, 'replace');
    }
    $('[data-order-filter]', el).onclick = () => orderFilterSheet(active);
    wireSwipes(el);
  }
};

function swipeRow(o, swipeable) {
  if (!swipeable || ['completed','cancelled'].includes(orderStatus(o))) return orderCard(o);
  return `<div class="swipe" data-swipe data-id="${o.id}">
    <div class="sw-actions">
      <button class="-advance" data-advance="${o.id}">${icon('check', 18, { stroke:2.2 })}<span>Advance</span></button>
    </div>
    <div class="sw-surface">${orderCard(o)}</div>
  </div>`;
}

const NEXT_STATE = { pending:'preparing', preparing:'ready', ready:'delivering', delivering:'completed' };

function wireSwipes(root) {
  $$('[data-swipe]', root).forEach(w => {
    if (w._w) return; w._w = 1;
    const surf = $('.sw-surface', w);
    let x0 = null, dx = 0;
    surf.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; surf.style.transition = 'none'; });
    surf.addEventListener('pointermove', e => {
      if (x0 === null) return;
      dx = e.clientX - x0;
      if (dx < 0) surf.style.transform = `translateX(${Math.max(-96, dx)}px)`;
    });
    const end = () => {
      if (x0 === null) return; x0 = null;
      surf.style.transition = ''; surf.style.transform = '';
      w.classList.toggle('-open', dx < -44);
    };
    surf.addEventListener('pointerup', end);
    surf.addEventListener('pointercancel', end);
    surf.addEventListener('pointerleave', end);
    $('[data-advance]', w)?.addEventListener('click', () => {
      const o = ORD(w.dataset.id), from = orderStatus(o), to = NEXT_STATE[from];
      APP.orderStates[o.id] = to;
      w.classList.remove('-open');
      undoToast({
        title: `${o.ref} → ${STATUS[to].label}`,
        text: `${C(o.cust).name} · ${money(o.total)}`,
        onUndo: () => {
          if (from === orderStatus(o)) return;
          APP.orderStates[o.id] = from;
          refresh();
          toast({ title:`${o.ref} put back to ${STATUS[from].label}` });
        }
      });
      setTimeout(refresh, 260);
    });
  });
}

function emptyOrders(filter, q) {
  if (q && q.trim()) return `<div class="empty">
    <div class="e-art">${icon('search', 34, { stroke:1.4 })}</div>
    <h4>Nothing matches “${esc(q.trim())}”</h4>
    <p>Try a customer name, an order number like BF-2048, or a product.</p>
  </div>`;
  const copy = {
    today:     ['No orders yet today', 'Your first order of the day will appear here.'],
    pending:   ['Nothing pending', 'Every order has been prepared. Good shift.'],
    ready:     ['Nothing waiting for pick-up', 'Orders appear here once the kitchen marks them ready.'],
    upcoming:  ['No upcoming orders', 'Orders scheduled for later days will show here.'],
    completed: ['No completed orders yet', 'Completed orders build up through the day.'],
    cancelled: ['No cancellations', 'Cancelled orders are kept here for the record.'],
  }[filter];
  return `<div class="empty">
    <div class="e-art">${flowMotif(140, 58, .75)}</div>
    <h4>${copy[0]}</h4><p>${copy[1]}</p>
    <div class="e-act"><button class="btn -primary" data-nav="new-ticket">${icon('plus', 17)} Create order</button></div>
  </div>`;
}

function orderFilterSheet(active) {
  sheet({
    title: 'Filter orders',
    body: `
      <div class="group-label"><span class="eyebrow">Period</span><i></i></div>
      <div class="segmented" style="margin-bottom:var(--s-5)">
        <span class="seg-thumb"></span>
        <button aria-pressed="true">Today</button><button aria-pressed="false">7 days</button>
        <button aria-pressed="false">30 days</button><button aria-pressed="false">Custom</button>
      </div>
      <div class="group-label"><span class="eyebrow">Status</span><i></i></div>
      <div class="chips" style="flex-wrap:wrap;margin:0 0 var(--s-5);padding:0">
        ${ORDER_FILTERS.map(f => `<button class="chip" data-val="${f.k}" aria-pressed="${f.k === active}">${f.l}</button>`).join('')}
      </div>
      <div class="group-label"><span class="eyebrow">Branch</span><i></i></div>
      <div class="chips" style="flex-wrap:wrap;margin:0 0 var(--s-5);padding:0">
        ${['All', ...APP.org.branches].map((b, i) => `<button class="chip" aria-pressed="${i === 0}">${b}</button>`).join('')}
      </div>
      <div class="group-label"><span class="eyebrow">Assigned to</span><i></i></div>
      <div class="chips" style="flex-wrap:wrap;margin:0;padding:0">
        ${['Anyone','Amara','Tunde','Ifeanyi'].map((s, i) => `<button class="chip" aria-pressed="${i === 0}">${s}</button>`).join('')}
      </div>`,
    foot: `<button class="btn -primary -block -lg" data-apply>Show orders</button>`,
    onMount(s) {
      $$('.chip', s).forEach(c => c.onclick = () => {
        const grp = c.parentElement;
        $$('.chip', grp).forEach(x => x.setAttribute('aria-pressed', String(x === c)));
      });
      $('[data-apply]', s).onclick = () => {
        const chosen = $$('.chip[aria-pressed="true"]', s)[0]?.dataset.val || 'today';
        closeSheet();
        setTimeout(() => nav('orders', { filter: chosen }, 'replace'), 200);
      };
    }
  });
}

/* ---------------------------------------------------------- ORDER DETAIL --- */
const TL_STEPS = [
  { k:'created',    l:'Order created',  s:o => `${o.time} · by ${U(o.staff)?.name.split(' ')[0] || 'staff'} · ${o.channel}` },
  { k:'confirmed',  l:'Confirmed',      s:() => 'Customer confirmed items and price' },
  { k:'preparing',  l:'In the kitchen', s:() => 'Assigned to Chioma' },
  { k:'ready',      l:'Ready',          s:() => 'Waiting at the counter' },
  { k:'delivering', l:'Out for delivery',s:o => `Driver ${U('u4').name.split(' ')[0]}` },
  { k:'completed',  l:'Handed over',    s:() => 'Signed for by the customer' },
];
const STATE_ORDER = ['pending','confirmed','preparing','ready','delivering','completed'];

function tlProgress(status) {
  if (status === 'cancelled') return 1;
  const map = { pending:1, confirmed:2, preparing:3, ready:4, delivering:5, completed:6 };
  return map[status] || 1;
}

SCREENS.order = {
  render({ id }) {
    const o = ORD(id), c = C(o.cust), st = orderStatus(o);
    const prog = tlProgress(st);
    const sub = itemsTotal(o.items);
    const disc = sub - o.total;
    const canManage = ['owner', 'manager'].includes(APP.role);
    const itemsLocked = ['ready', 'delivering', 'completed', 'cancelled'].includes(st);

    return `${appbar({ title:o.ref, sub:`${c.name} · ${o.time}`,
      right:`<button class="iconbtn -tinted" data-share aria-label="Share">${icon('share', 18)}</button>
             <button class="iconbtn -tinted" data-order-more aria-label="More" style="margin-left:8px">${icon('more', 18)}</button>` })}
    <div class="body -with-dock">

      <!-- Money + state header -->
      <section class="hero-panel" style="padding-bottom:var(--s-5)">
        <div class="hp-top">
          <div style="flex:1">
            <div class="hp-label">Order total</div>
            <div class="hero-figure num" style="margin-top:6px">${money(o.total)}</div>
          </div>
        </div>
        <div class="row" style="margin-top:var(--s-4);gap:var(--s-2)">
          ${statusBadge(st)}${payBadge(o.paid)}
          ${o.when === 'upcoming' ? `<span class="badge -info">${icon('calendar', 11)}Scheduled</span>` : ''}
        </div>
      </section>

      <!-- Customer -->
      <section class="section">
        <div class="card">
          <div class="row">
            <span class="avatar -lg -${c.tone}">${c.init}</span>
            <div style="flex:1;min-width:0">
              <b style="display:block;font-size:var(--t-callout);font-weight:620">${c.name}</b>
              <span class="label">${c.type} · ${c.area}</span>
            </div>
            <button class="iconbtn -tinted" data-toast="Calling ${c.name}" data-toast-text="${c.phone}" aria-label="Call customer">${icon('phone', 18)}</button>
            <button class="iconbtn -tinted" data-nav="customer" data-nav-params='{"id":"${c.id}"}' aria-label="Customer profile">${icon('chevRight', 18)}</button>
          </div>
        </div>
      </section>

      <!-- Items -->
      <section class="section">
        <div class="section-head"><h3>Items</h3><div class="spacer"></div>
          <span class="meta">${o.items.reduce((s, i) => s + i.q, 0)} units</span></div>
        <div class="card">
          ${o.items.map(i => { const p = P(i.p); return `
            <div class="cart-line">
              <span class="avatar -sm -e">${i.q}×</span>
              <span class="cl-main"><b>${p.name}</b><span>${money(p.price)} per ${p.unit}</span></span>
              <span class="strong num">${money(p.price * i.q)}</span>
            </div>`; }).join('')}
          <div class="recap" style="margin-top:var(--s-4)">
            <div class="r-line"><span>Subtotal</span><span class="spacer"></span><b>${money(sub)}</b></div>
            ${disc ? `<div class="r-line"><span>Customer discount</span><span class="spacer"></span><b>${money(-disc)}</b></div>` : ''}
            <div class="r-rule"></div>
            <div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(o.total)}</b></div>
          </div>
        </div>
      </section>

      <!-- Payment -->
      <section class="section">
        <div class="section-head"><h3>Payment</h3></div>
        <div class="card">
          ${o.paid === 'paid' ? `
            <div class="row">
              <span class="itile -ok">${icon('check', 18)}</span>
              <div style="flex:1"><b style="font-size:var(--t-callout);font-weight:590">Paid in full</b>
                <div class="label">Transfer · ${o.time}</div></div>
              <span class="strong num">${money(o.total)}</span>
            </div>`
          : o.paid === 'partial' ? `
            <div class="row">
              <span class="itile -warn">${icon('alert', 18)}</span>
              <div style="flex:1"><b style="font-size:var(--t-callout);font-weight:590">Part paid</b>
                <div class="label">₦120,000 received by transfer at 1:05 PM</div></div>
            </div>
            <div class="track -accent" style="margin-top:var(--s-4)"><i style="width:${120000 / o.total * 100}%"></i></div>
            <div class="row" style="margin-top:10px">
              <span class="label">Paid ${money(120000)}</span><span class="spacer"></span>
              <span class="strong num" style="color:var(--warning)">${money(o.total - 120000)} outstanding</span>
            </div>
            <button class="btn -secondary -block" style="margin-top:var(--s-4)" data-record-pay>Record payment</button>`
          : `
            <div class="row">
              <span class="itile -bad">${icon('clock', 18)}</span>
              <div style="flex:1"><b style="font-size:var(--t-callout);font-weight:590">Not paid yet</b>
                <div class="label">${money(o.total)} due on collection</div></div>
            </div>
            <button class="btn -primary -block" style="margin-top:var(--s-4)" data-record-pay>Record payment</button>`}
        </div>
      </section>

      <!-- Timeline -->
      <section class="section">
        <div class="section-head"><h3>Timeline</h3></div>
        <div class="card">
          ${st === 'cancelled' ? `
            <div class="row -top" style="margin-bottom:var(--s-4)">
              <span class="itile -sm -bad">${icon('close', 15)}</span>
              <div><b style="font-size:var(--t-foot);font-weight:600">Cancelled at ${o.time}</b>
                <p class="meta" style="margin-top:3px;line-height:1.5">${o.note || 'No reason recorded.'}</p></div>
            </div>` : ''}
          <div class="timeline">
            ${TL_STEPS.map((s, i) => {
              const cls = i + 1 < prog ? '-done' : i + 1 === prog ? '-current' : '-todo';
              return `<div class="tl-item ${cls}">
                <span class="tl-node">${cls === '-done' ? icon('check', 11, { stroke:2.6 }) : '<i></i>'}</span>
                <b>${s.l}</b><span>${cls === '-todo' ? 'Not yet' : s.s(o)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </section>

      ${o.note ? `<section class="section">
        <div class="section-head"><h3>Note</h3></div>
        <div class="card -recessed"><p style="font-size:var(--t-callout);line-height:1.55">${o.note}</p></div>
      </section>` : ''}

      <!-- Assignment -->
      <section class="section">
        <div class="section-head"><h3>Handled by</h3></div>
        <div class="list">
          <div class="li"><span class="avatar -sm -${U(o.staff)?.tone || 'e'}">${U(o.staff)?.init || '—'}</span>
            <span class="li-main"><b>${U(o.staff)?.name || 'Unassigned'}</b><span>Took the order · ${o.branch} branch</span></span></div>
          ${st === 'delivering' ? `<div class="li"><span class="avatar -sm -d">IE</span>
            <span class="li-main"><b>Ifeanyi Eze</b><span>Delivering now · Ogba</span></span>
            <span class="badge -info">${icon('truck', 11)}On route</span></div>` : ''}
        </div>
      </section>

      ${canManage && !['completed','cancelled'].includes(st) ? `<section class="section">
        <button class="btn -danger -block" data-cancel-order>Cancel this order</button>
      </section>` : ''}
    </div>

    ${!['completed','cancelled'].includes(st) && ['owner','manager'].includes(APP.role) ? `
    <div class="dock">
      <div class="d-row">
        <div class="d-total"><div class="k">Next step</div><div class="v" style="font-size:var(--t-title-3)">${STATUS[NEXT_STATE[st] || 'completed'].label}</div></div>
        <button class="btn -primary" data-advance-order>Mark ${STATUS[NEXT_STATE[st] || 'completed'].label.toLowerCase()} ${icon('arrowRight', 16)}</button>
      </div>
    </div>` : ''}`;
  },
  mount(el, { id }) {
    const o = ORD(id), st = orderStatus(o);
    const canManage = ['owner', 'manager'].includes(APP.role);
    const itemsLocked = ['ready', 'delivering', 'completed', 'cancelled'].includes(st);
    $('[data-advance-order]', el)?.addEventListener('click', () => {
      const to = NEXT_STATE[st] || 'completed';
      APP.orderStates[o.id] = to;
      undoToast({
        title: `${o.ref} is now ${STATUS[to].label}`,
        text: `${C(o.cust).name} · ${money(o.total)}`,
        onUndo: () => { APP.orderStates[o.id] = st; refresh(); toast({ title:`${o.ref} put back to ${STATUS[st].label}` }); }
      });
      refresh();
    });
    $('[data-record-pay]', el)?.addEventListener('click', () => paymentSheet(o));
    $('[data-share]', el)?.addEventListener('click', () =>
      toast({ title:'Receipt link copied', text:`${o.ref} · ${money(o.total)}` }));
    $('[data-order-more]', el)?.addEventListener('click', () => sheet({
      title: o.ref,
      body: `<div class="menu">
        ${!itemsLocked && APP.role !== 'driver' ? menuItem({ icon:'edit',   title:'Edit items',       sub:'Change quantities or products' }) : ''}
        ${canManage ? menuItem({ icon:'user',   title:'Reassign',         sub:'Give this order to someone else' }) : ''}
        ${canManage ? menuItem({ icon:'truck',  title:'Assign a driver',  sub:'For delivery orders' }) : ''}
        ${menuItem({ icon:'receipt',title:'Print receipt',    sub:'Counter printer' })}
        ${menuItem({ icon:'history',title:'Activity history', sub:'Every change on this order' })}
        ${canManage && st !== 'cancelled' ? menuItem({ icon:'doc', title:'Create correction', sub:'New order referencing this one' }) : ''}
      </div>`,
      onMount(s) {
        $$('.menu-item', s).forEach(m => {
          if (m.querySelector('b')?.textContent === 'Create correction') {
            m.onclick = () => {
              closeSheet();
              setTimeout(() => {
                APP.draft = { cust: o.cust, lines: o.items.map(i => ({ p: i.p, q: i.q })), note: `Correction of ${o.ref}`, method: 'Cash', step: 3, correctionOf: o.ref };
                nav('new-ticket');
                toast({ title:'Correction started', text:`References ${o.ref} · original is unchanged` });
              }, 200);
            };
          } else {
            m.onclick = () => { closeSheet(); setTimeout(() => toast({ title:'Prototype', text:'This action is illustrative' }), 220); };
          }
        });
      }
    }));
    $('[data-cancel-order]', el)?.addEventListener('click', () => {
      if (o.paid !== 'unpaid') return apiError('refund_required');
      dialog({
      body: `<div style="text-align:center">
        <span class="itile -bad" style="width:44px;height:44px;border-radius:14px;margin:0 auto var(--s-4)">${icon('alert', 21)}</span>
        <h3 style="font-size:var(--t-title-3);font-weight:640">Cancel ${o.ref}?</h3>
        <p class="label" style="margin-top:8px;line-height:1.5">${C(o.cust).name}'s order for ${money(o.total)} will be marked cancelled. The record is kept.</p>
        <label class="field" style="text-align:left;margin-top:var(--s-4)"><span class="f-label">Reason</span>
          <textarea class="f-ctl" id="cancel-reason"></textarea></label>
        <div class="grid-2" style="margin-top:var(--s-5)">
          <button class="btn -secondary" data-close>Keep it</button>
          <button class="btn -danger" data-do-cancel disabled>Cancel order</button>
        </div></div>`,
      onMount(d) {
        const reason = $('#cancel-reason', d), btn = $('[data-do-cancel]', d);
        reason.oninput = () => { btn.disabled = !reason.value.trim(); };
        btn.onclick = () => {
          if (!reason.value.trim()) return;
          APP.orderStates[o.id] = 'cancelled';
          o.note = reason.value.trim();
          logAudit('Cancelled order', `${o.ref} · ${C(o.cust).name} · "${o.note}"`, 'order');
          closeSheet();
          setTimeout(() => { refresh(); toast({ title:`${o.ref} cancelled`, text:'Customer has not been charged', kind:'warn' }); }, 240);
        };
      }
    });
    });
  }
};

function paymentSheet(o) {
  const outstanding = o.paid === 'partial' ? o.total - 120000 : o.total;
  sheet({
    title: 'Record payment',
    body: `
      <div class="amount-input" style="margin-bottom:var(--s-5)">
        <span class="cur">₦</span><input id="pay-amt" type="text" inputmode="numeric" value="${outstanding.toLocaleString()}">
      </div>
      <div class="group-label"><span class="eyebrow">Method</span><i></i></div>
      <div class="grid-3" style="margin-bottom:var(--s-5)">
        ${[['Cash','cash'],['Transfer','bank'],['POS','card']].map(([k, ic], i) => `
          <button class="qa" data-method="${k}" aria-pressed="${i === 0}" style="align-items:center">
            <span class="qa-ico ${i === 0 ? '-ink' : ''}">${icon(ic, 17)}</span><b>${k}</b></button>`).join('')}
      </div>
      <div class="recap">
        <div class="r-line"><span>Order total</span><span class="spacer"></span><b>${money(o.total)}</b></div>
        ${o.paid === 'partial' ? `<div class="r-line"><span>Already paid</span><span class="spacer"></span><b>${money(120000)}</b></div>` : ''}
        <div class="r-rule"></div>
        <div class="r-line -total"><span>Receiving now</span><span class="spacer"></span><b id="pay-echo">${money(outstanding)}</b></div>
      </div>`,
    foot: `<button class="btn -primary -block -lg" data-confirm-pay>Confirm payment</button>`,
    onMount(s) {
      const amt = $('#pay-amt', s), echo = $('#pay-echo', s);
      amt.oninput = () => {
        const n = +amt.value.replace(/[^\d]/g, '') || 0;
        amt.value = n ? n.toLocaleString() : '';
        echo.textContent = money(n);
      };
      $$('[data-method]', s).forEach(b => b.onclick = () => {
        $$('[data-method]', s).forEach(x => {
          x.setAttribute('aria-pressed', String(x === b));
          $('.qa-ico', x).classList.toggle('-ink', x === b);
        });
      });
      $('[data-confirm-pay]', s).onclick = () => {
        const n = +amt.value.replace(/[^\d]/g, '') || 0;
        const method = $('[data-method][aria-pressed="true"]', s).dataset.method;
        closeSheet();
        setTimeout(() => {
          o.paid = n >= outstanding ? 'paid' : 'partial';
          refresh();
          toast({ title:`${money(n)} received`, text:`${method} · ${o.ref}` });
        }, 240);
      };
    }
  });
}

/* ------------------------------------------------------- TICKET CREATION --- */
/* Optimised for the driver: customer → products → review. Sticky total,
   one obvious primary action, never a form wall.                            */

function newDraft() {
  return { cust: null, lines: [], note: '', method: 'Cash', received: null, step: 1, branch: APP.role === 'owner' ? (APP.viewBranch === 'All' ? APP.org.branches[0] : APP.viewBranch) : APP.branch };
}
const draftTotal = d => d.lines.reduce((s, l) => s + P(l.p).price * l.q, 0);

SCREENS['new-ticket'] = {
  chrome: false,
  render() {
    APP.draft = APP.draft || newDraft();
    const d = APP.draft;
    const label = APP.role === 'driver' ? 'ticket' : 'order';
    return `${appbar({ title:`New ${label}`, sub: d.cust ? C(d.cust).name : 'Step 1 of 3',
      right:`<button class="iconbtn" data-cancel-draft aria-label="Discard">${icon('close', 20)}</button>`, back:false })}
    <div class="flush-pad" style="padding:0 var(--gutter) var(--s-3)">
      <div class="steps">
        <i class="${d.step >= 1 ? (d.step === 1 ? '-cur' : '-on') : ''}"></i>
        <i class="${d.step >= 2 ? (d.step === 2 ? '-cur' : '-on') : ''}"></i>
        <i class="${d.step >= 3 ? '-cur' : ''}"></i>
      </div>
    </div>
    <div class="body -with-dock" id="draft-body">${draftStep(d)}</div>
    <div class="dock">
      <div class="d-row">
        <div class="d-total">
          <div class="k">Total</div>
          <div class="v num" id="draft-total">${money(draftTotal(d))}</div>
        </div>
        <button class="btn -primary" id="draft-next" ${!d.cust && d.step === 1 ? 'disabled' : ''}>
          ${d.step === 3 ? `Create ${label}` : 'Continue'} ${icon('arrowRight', 16)}</button>
      </div>
      ${d.lines.length ? `<div class="hintline" style="margin-top:9px">${icon('info', 13)}
        ${d.lines.reduce((s, l) => s + l.q, 0)} items · ${d.lines.length} product${d.lines.length === 1 ? '' : 's'}</div>` : ''}
    </div>`;
  },
  mount(el) {
    const d = APP.draft;
    $('[data-cancel-draft]', el).onclick = () => {
      if (!d.cust && !d.lines.length) { APP.draft = null; back(); return; }
      dialog({
        body: `<div style="text-align:center">
          <h3 style="font-size:var(--t-title-3);font-weight:640">Discard this ${APP.role === 'driver' ? 'ticket' : 'order'}?</h3>
          <p class="label" style="margin-top:8px">Nothing has been saved yet.</p>
          <div class="grid-2" style="margin-top:var(--s-5)">
            <button class="btn -secondary" data-close>Keep editing</button>
            <button class="btn -danger" data-discard>Discard</button></div></div>`,
        onMount(dg) { $('[data-discard]', dg).onclick = () => { APP.draft = null; closeSheet(); setTimeout(back, 220); }; }
      });
    };

    /* step-specific wiring */
    if (d.step === 1) {
      $('[data-pick-draft-branch]', el)?.addEventListener('click', () => {
        sheet({
          title: 'Which branch?',
          body: `<div class="list">${APP.org.branches.map(b => `<button class="li" data-set-draft-branch="${b}" style="width:100%;text-align:left">
              <span class="itile -sm ${b === d.branch ? '-accent' : ''}">${icon('store', 16)}</span>
              <span class="li-main"><b>${b}</b></span>
              ${b === d.branch ? `<span class="chev">${icon('check', 16)}</span>` : ''}
            </button>`).join('')}</div>`,
          onMount(s) {
            $$('[data-set-draft-branch]', s).forEach(b => b.onclick = () => {
              d.branch = b.dataset.setDraftBranch;
              closeSheet();
              setTimeout(refresh, 220);
            });
          }
        });
      });
      $('[data-pick-customer]', el)?.addEventListener('click', () => customerSheet(c => { d.cust = c; d.step = 2; refresh(); }));
      $$('[data-quick-cust]', el).forEach(b => b.onclick = () => { d.cust = b.dataset.quickCust; d.step = 2; refresh(); });
      $('[data-walkin-customer]', el)?.addEventListener('click', () => { d.cust = 'walkin'; d.step = 2; refresh(); });
    }
    if (d.step === 2) {
      $('[data-add-product]', el)?.addEventListener('click', () => productSheet());
      wireDraftLines(el);
    }
    if (d.step === 3) {
      $('[data-edit-items]', el)?.addEventListener('click', () => { d.step = 2; refresh(); });
      $('[data-edit-cust]', el)?.addEventListener('click', () => customerSheet(c => { d.cust = c; refresh(); }));
      $('#draft-note', el)?.addEventListener('input', e => d.note = e.target.value);
      $$('[data-draft-method]', el).forEach(b => b.onclick = () => {
        d.method = b.dataset.draftMethod;
        $$('[data-draft-method]', el).forEach(x => {
          x.setAttribute('aria-pressed', String(x === b));
          $('.qa-ico', x).classList.toggle('-ink', x === b);
        });
      });
      const receivedInput = $('#draft-received', el);
      receivedInput?.addEventListener('input', () => {
        const n = +receivedInput.value.replace(/[^\d]/g, '') || 0;
        receivedInput.value = n.toLocaleString();
        d.received = n;
        const total = draftTotal(d), credit = Math.max(total - n, 0);
        $('#draft-received-echo').textContent = money(n);
        const creditEl = $('#draft-credit-echo');
        creditEl.textContent = money(credit);
        creditEl.previousElementSibling.textContent = credit > 0 ? 'Customer credit' : 'Balance';
        creditEl.style.color = credit > 0 ? 'var(--warning)' : '';
      });
    }

    $('#draft-next', el).onclick = () => {
      if (d.step === 1) { if (!d.cust) return; d.step = 2; refresh(); return; }
      if (d.step === 2) {
        if (!d.lines.length) { toast({ title:'Add at least one product', kind:'warn' }); return; }
        d.step = 3; refresh(); return;
      }
      const btn = $('#draft-next', el);
      btn.disabled = true; btn.textContent = 'Saving…';
      submitDraft();
    };
  }
};

function draftStep(d) {
  if (d.step === 1) return draftStepCustomer(d);
  if (d.step === 2) return draftStepProducts(d);
  return draftStepReview(d);
}

function draftStepCustomer(d) {
  const recent = ['c5','c2','c7','c1'].map(C);
  return `
    ${APP.role === 'owner' ? `<div class="section" style="margin-top:var(--s-2)">
      <div class="section-head"><h3>Branch</h3></div>
      <button class="picker -filled" data-pick-draft-branch>
        <span class="p-ico">${icon('store', 18)}</span>
        <span class="p-txt"><b>${d.branch}</b><span>Which branch is this order for</span></span>
        <span class="chev">${icon('chevRight', 17)}</span>
      </button>
    </div>` : ''}
    <div class="section" style="margin-top:${APP.role === 'owner' ? '0' : 'var(--s-2)'}">
      <div class="section-head"><h3>Who is this for?</h3></div>
      <button class="picker ${d.cust ? '-filled' : '-empty'}" data-pick-customer>
        <span class="p-ico">${icon('user', 18)}</span>
        <span class="p-txt">${d.cust
          ? `<b>${C(d.cust).name}</b><span>${C(d.cust).type} · ${C(d.cust).area}</span>`
          : `<b>Search customers</b><span>Or pick a recent one below</span>`}</span>
        <span class="chev">${icon('chevRight', 17)}</span>
      </button>
    </div>
    <div class="section">
      <div class="section-head"><h3>Recent</h3><div class="spacer"></div><span class="meta">Tap to continue</span></div>
      <div class="stack-2">
        ${recent.map(c => `<button class="card -tap" data-quick-cust="${c.id}"
            style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px var(--s-4)">
          <span class="avatar -${c.tone}">${c.init}</span>
          <span style="flex:1;min-width:0">
            <b style="display:block;font-size:var(--t-callout);font-weight:580">${c.name}</b>
            <span class="meta">${c.type} · ${c.area} · last ${c.last.toLowerCase()}</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>`).join('')}
      </div>
    </div>
    <div class="section">
      <button class="btn -secondary -block" data-walkin-customer>
        ${icon('bag', 17)} Walk-in — no customer details</button>
    </div>`;
}

function draftStepProducts(d) {
  const recent = ['p9','p5','p11','p7','p1'].map(P);
  return `
    <div class="section" style="margin-top:var(--s-2)">
      <div class="section-head"><h3>What are they buying?</h3><div class="spacer"></div>
        <button class="link" data-add-product>Browse all</button></div>
      <div class="searchbar" data-add-product style="pointer-events:auto">
        ${icon('search', 17)}<input readonly>
      </div>
    </div>

    ${d.lines.length ? `
      <div class="section">
        <div class="section-head"><h3>In this ${APP.role === 'driver' ? 'ticket' : 'order'}</h3><div class="spacer"></div>
          <span class="meta">${d.lines.reduce((s, l) => s + l.q, 0)} units</span></div>
        <div class="card" id="draft-lines">
          ${d.lines.map(l => { const p = P(l.p); return `
            <div class="cart-line" data-line="${l.p}">
              <span class="cl-main"><b>${p.name}</b><span>${money(p.price)} per ${p.unit} · <b class="num" data-line-total="${l.p}">${money(p.price * l.q)}</b></span></span>
              <span class="stepper">
                <button data-dec="${l.p}" aria-label="Fewer">${icon(l.q === 1 ? 'trash' : 'minus', 14)}</button>
                <span class="qty" data-qty="${l.p}" data-edit-qty="${l.p}" role="button" aria-label="Enter quantity">${l.q}</span>
                <button data-inc="${l.p}" aria-label="More">${icon('plus', 14)}</button>
              </span>
            </div>`; }).join('')}
        </div>
      </div>` : ''}

    <div class="section">
      <div class="section-head"><h3>${d.lines.length ? 'Add more' : 'Frequently sold'}</h3></div>
      <div class="list">
        ${recent.map(p => `
          <button class="prow" data-quick-prod="${p.id}">
            <span class="p-thumb"><span class="p-mono">${p.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span></span>
            <span class="p-main"><b>${p.name}</b><span>${p.cat} · ${p.stock ? `${p.stock} in stock` : 'Out of stock'}</span></span>
            <span class="p-price num">${money(p.price)}</span>
            <span class="itile -sm" style="margin-left:8px">${icon('plus', 15)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function draftStepReview(d) {
  const c = C(d.cust), total = draftTotal(d);
  return `
    <div class="section" style="margin-top:var(--s-2)">
      <div class="section-head"><h3>Review</h3></div>
      <div class="card">
        <button class="row" data-edit-cust style="width:100%;text-align:left">
          <span class="avatar -${c.tone}">${c.init}</span>
          <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:600">${c.name}</b>
            <span class="meta">${c.type} · ${c.phone}</span></span>
          <span class="link" style="font-size:var(--t-foot)">Change</span>
        </button>
      </div>
    </div>

    ${APP.role === 'driver' ? `<div class="section">
      <div class="section-head"><h3>Delivery address</h3></div>
      <div class="card">
        <p style="font-size:var(--t-callout);font-weight:560">${c.address || c.area}</p>
        ${c.instructions ? `<p class="meta" style="margin-top:6px">${esc(c.instructions)}</p>` : ''}
      </div>
    </div>` : ''}

    <div class="section">
      <div class="section-head"><h3>Items</h3><div class="spacer"></div>
        <button class="link" data-edit-items>Edit</button></div>
      <div class="card">
        ${d.lines.map(l => { const p = P(l.p); return `
          <div class="cart-line">
            <span class="avatar -sm -e">${l.q}×</span>
            <span class="cl-main"><b>${p.name}</b><span>${money(p.price)} per ${p.unit}</span></span>
            <span class="strong num">${money(p.price * l.q)}</span>
          </div>`; }).join('')}
        <div class="recap" style="margin-top:var(--s-4)">
          <div class="r-line"><span>${d.lines.reduce((s, l) => s + l.q, 0)} items</span><span class="spacer"></span><b>${money(total)}</b></div>
          <div class="r-rule"></div>
          <div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(total)}</b></div>
        </div>
      </div>
    </div>

    ${APP.role === 'owner' ? `<div class="section">
      <div class="section-head"><h3>Branch</h3></div>
      <button class="li" style="width:100%;text-align:left;cursor:default">
        <span class="itile -sm">${icon('store', 16)}</span>
        <span class="li-main"><b>${d.branch}</b></span>
      </button>
    </div>` : ''}

    <div class="section">
      <div class="section-head"><h3>Payment</h3></div>
      <div class="grid-3">
        ${[['Cash','cash'],['Transfer','bank'],['POS','card']].map(([k, ic]) => `
          <button class="qa" data-draft-method="${k}" aria-pressed="${d.method === k}" style="align-items:center">
            <span class="qa-ico ${d.method === k ? '-ink' : ''}">${icon(ic, 17)}</span><b>${k}</b></button>`).join('')}
      </div>
    </div>

    ${APP.role === 'driver' ? (() => {
      const received = d.received ?? total;
      const credit = Math.max(total - received, 0);
      return `<div class="section">
      <div class="section-head"><h3>Amount received</h3></div>
      <div class="amount-input"><span class="cur">₦</span>
        <input id="draft-received" type="text" inputmode="numeric" value="${received.toLocaleString()}"></div>
      <div class="card" style="margin-top:var(--s-3)"><div class="recap">
        <div class="r-line"><span>Total sale</span><span class="spacer"></span><b>${money(total)}</b></div>
        <div class="r-line"><span>Received now</span><span class="spacer"></span><b id="draft-received-echo">${money(received)}</b></div>
        <div class="r-rule"></div>
        <div class="r-line -total"><span>${credit > 0 ? 'Customer credit' : 'Balance'}</span><span class="spacer"></span>
          <b id="draft-credit-echo" style="${credit > 0 ? 'color:var(--warning)' : ''}">${money(credit)}</b></div>
      </div></div>
      <p class="f-hint" style="margin-top:8px">The system calculates credit automatically — you never need to work it out.</p>
    </div>`; })() : ''}

    <div class="section">
      <div class="section-head"><h3>Note <span class="meta" style="font-weight:400">(optional)</span></h3></div>
      <label class="field"><textarea class="f-ctl" id="draft-note">${esc(d.note)}</textarea></label>
    </div>

    ${APP.sync === 'offline' ? `<div class="offline-note">
      <span class="itile -sm">${icon('wifiOff', 16)}</span>
      <span class="on-txt"><b>You are offline</b><span>This will be saved here and sent automatically</span></span>
    </div>` : ''}`;
}

function wireDraftLines(el) {
  const d = APP.draft;
  const sync = () => {
    $('#draft-total').textContent = money(draftTotal(d));
    refresh();
  };
  $$('[data-inc]', el).forEach(b => b.onclick = () => {
    const l = d.lines.find(x => x.p === b.dataset.inc); l.q++;
    const p = P(l.p);
    $(`[data-qty="${l.p}"]`, el).textContent = l.q;
    $(`[data-line-total="${l.p}"]`, el).textContent = money(p.price * l.q);
    $('#draft-total').textContent = money(draftTotal(d));
  });
  $$('[data-dec]', el).forEach(b => b.onclick = () => {
    const i = d.lines.findIndex(x => x.p === b.dataset.dec), l = d.lines[i];
    if (l.q === 1) { d.lines.splice(i, 1); sync(); return; }
    l.q--;
    const p = P(l.p);
    $(`[data-qty="${l.p}"]`, el).textContent = l.q;
    $(`[data-line-total="${l.p}"]`, el).textContent = money(p.price * l.q);
    $('#draft-total').textContent = money(draftTotal(d));
  });
  $$('[data-quick-prod]', el).forEach(b => b.onclick = () => {
    addToDraft(b.dataset.quickProd);
    refresh();
  });
  $$('[data-edit-qty]', el).forEach(span => span.onclick = () => {
    const l = d.lines.find(x => x.p === span.dataset.editQty);
    sheet({
      title: P(l.p).name,
      body: `<label class="field"><span class="f-label">Quantity</span>
        <input class="f-ctl" id="qty-direct" type="number" inputmode="numeric" min="1" value="${l.q}" autofocus></label>`,
      foot: `<button class="btn -primary -block -lg" data-save-qty>Save</button>`,
      onMount(s) {
        const inp = $('#qty-direct', s);
        $('[data-save-qty]', s).onclick = () => {
          const n = Math.max(1, parseInt(inp.value, 10) || 1);
          const i = d.lines.findIndex(x => x.p === l.p);
          d.lines[i].q = n;
          closeSheet();
          setTimeout(sync, 220);
        };
      }
    });
  });
}

function addToDraft(pid, q = 1) {
  const d = APP.draft;
  const line = d.lines.find(l => l.p === pid);
  if (line) line.q += q; else d.lines.push({ p: pid, q });
}

/* ------------------------------------------------------- CUSTOMER SHEET --- */
function customerSheet(onPick) {
  const render = (q = '') => {
    const rows = DB.customers.filter(c =>
      !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q) || c.area.toLowerCase().includes(q.toLowerCase()));
    if (!rows.length) return `<div class="empty" style="padding:var(--s-8) 0">
      <div class="e-art">${icon('user', 30, { stroke:1.4 })}</div>
      <h4>No customer found</h4><p>Add “${esc(q)}” as a new customer to continue.</p>
      <div class="e-act"><button class="btn -primary -sm" data-new-cust>${icon('plus', 15)} Add customer</button></div></div>`;
    return rows.map(c => `<button class="li" data-cust="${c.id}">
      <span class="avatar -${c.tone}">${c.init}</span>
      <span class="li-main"><b>${c.name}</b><span>${c.type} · ${c.area} · ${c.orders} orders</span></span>
      <span class="chev">${icon('chevRight', 17)}</span></button>`).join('');
  };

  sheet({
    title: 'Select customer', tall: true,
    body: `<div class="searchbar" style="margin-bottom:var(--s-3)">
        ${icon('search', 17)}<input id="cs-q" autocomplete="off"></div>
      <div class="list" id="cs-list">${render()}</div>
      <button class="btn -tertiary -block" style="margin-top:var(--s-3)" data-new-cust>
        ${icon('plus', 17)} New customer</button>`,
    onMount(s) {
      const list = $('#cs-list', s), q = $('#cs-q', s);
      const bind = () => {
        $$('[data-cust]', list).forEach(b => b.onclick = () => {
          closeSheet();
          setTimeout(() => onPick(b.dataset.cust), 180);
        });
        $$('[data-new-cust]', s).forEach(b => b.onclick = () => {
          closeSheet();
          setTimeout(() => newCustomerSheet(onPick), 200);
        });
      };
      q.oninput = () => { list.innerHTML = render(q.value.trim()); bind(); };
      bind();
      setTimeout(() => q.focus(), 220);
    }
  });
}

/* -------------------------------------------------------- PRODUCT SHEET --- */
function newCustomerSheet(onPick) {
  sheet({
    title: 'Add customer',
    body: `<label class="field" style="margin-bottom:var(--s-4)"><span class="f-label">Name</span>
        <input class="f-ctl" id="nc-name" placeholder="Full name" autofocus></label>
      <label class="field" style="margin-bottom:var(--s-4)"><span class="f-label">Phone</span>
        <input class="f-ctl" id="nc-phone" type="tel" inputmode="tel" placeholder="0803 000 0000"></label>
      <label class="field" style="margin-bottom:var(--s-4)"><span class="f-label">Address <span class="meta">(optional)</span></span>
        <input class="f-ctl" id="nc-address" placeholder="Delivery address"></label>
      <label class="field"><span class="f-label">Notes <span class="meta">(optional)</span></span>
        <textarea class="f-ctl" id="nc-notes"></textarea></label>`,
    foot: `<button class="btn -primary -block -lg" data-save-cust disabled>Add customer</button>`,
    onMount(s) {
      const name = $('#nc-name', s), phone = $('#nc-phone', s), btn = $('[data-save-cust]', s);
      const validPhone = () => phone.value.replace(/\D/g, '').length >= 10;
      const check = () => { btn.disabled = !(name.value.trim() && validPhone()); };
      name.oninput = check; phone.oninput = check;
      btn.onclick = () => {
        if (!(name.value.trim() && validPhone())) return;
        const id = 'c' + Date.now();
        DB.customers.push({
          id, name: name.value.trim(), init: name.value.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(),
          tone: 'a', phone: phone.value.trim(), type: 'Regular', orders: 0, spent: 0, last: '—',
          area: $('#nc-address', s).value.trim() || '—', address: $('#nc-address', s).value.trim() || '—',
          notes: $('#nc-notes', s).value.trim(),
        });
        closeSheet();
        setTimeout(() => { toast({ title: 'Customer added', text: name.value.trim() }); onPick(id); }, 200);
      };
    }
  });
}

function productSheet() {
  let cat = 'All', q = '';
  const rows = () => DB.products.filter(p =>
    (cat === 'All' || p.cat === cat) &&
    (!q || p.name.toLowerCase().includes(q.toLowerCase())));

  const renderRows = () => {
    const r = rows();
    if (!r.length) return `<div class="empty" style="padding:var(--s-8) 0">
      <div class="e-art">${icon('box', 30, { stroke:1.4 })}</div>
      <h4>No product matches</h4><p>Try a different name or category.</p></div>`;
    return r.map(p => {
      const line = APP.draft.lines.find(l => l.p === p.id);
      return `<div class="prow" aria-selected="${!!line}">
        <span class="p-thumb">${p.stock === 0
          ? `<span class="p-mono" style="color:var(--error)">—</span>`
          : `<span class="p-mono">${p.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>`}</span>
        <span class="p-main"><b>${p.name}</b>
          <span>${p.cat} · ${p.stock === 0 ? 'Out of stock' : `${p.stock} ${p.unit}s left`}</span></span>
        ${line ? `<span class="stepper">
            <button data-ps-dec="${p.id}" aria-label="Fewer">${icon(line.q === 1 ? 'trash' : 'minus', 14)}</button>
            <span class="qty">${line.q}</span>
            <button data-ps-inc="${p.id}" aria-label="More" ${p.stock === 0 ? 'disabled' : ''}>${icon('plus', 14)}</button>
          </span>`
        : `<span class="p-price num">${money(p.price)}</span>
           <button class="itile -sm" data-ps-add="${p.id}" ${p.stock === 0 ? 'disabled style="opacity:.35"' : ''}
             style="margin-left:10px" aria-label="Add ${p.name}">${icon('plus', 15)}</button>`}
      </div>`;
    }).join('');
  };

  const s = sheet({
    title: 'Add products', tall: true,
    body: `<div class="searchbar" style="margin-bottom:var(--s-3)">
        ${icon('search', 17)}<input id="ps-q" autocomplete="off"></div>
      <div class="chips" data-chipgroup id="ps-cats" style="margin:0 0 var(--s-3);padding:0">
        ${DB.productCats.map((c, i) => `<button class="chip" data-val="${c}" aria-pressed="${i === 0}">${c}</button>`).join('')}
      </div>
      <div class="list" id="ps-list">${renderRows()}</div>`,
    foot: `<div class="d-row" style="display:flex;align-items:center;gap:var(--s-4)">
        <div class="d-total" style="flex:1">
          <div class="k" style="font-size:var(--t-caption);font-weight:620;letter-spacing:.09em;text-transform:uppercase;color:var(--warm-gray-soft)">Total</div>
          <div class="v num" id="ps-total" style="font-size:var(--t-title-2);font-weight:660">${money(draftTotal(APP.draft))}</div>
        </div>
        <button class="btn -primary" data-ps-done>Done</button></div>`,
    onMount(sh) {
      const list = $('#ps-list', sh);
      const redraw = () => {
        list.innerHTML = renderRows();
        $('#ps-total', sh).textContent = money(draftTotal(APP.draft));
        bind();
      };
      const bind = () => {
        $$('[data-ps-add]', list).forEach(b => b.onclick = () => { addToDraft(b.dataset.psAdd); redraw(); });
        $$('[data-ps-inc]', list).forEach(b => b.onclick = () => { addToDraft(b.dataset.psInc); redraw(); });
        $$('[data-ps-dec]', list).forEach(b => b.onclick = () => {
          const i = APP.draft.lines.findIndex(l => l.p === b.dataset.psDec);
          if (APP.draft.lines[i].q === 1) APP.draft.lines.splice(i, 1); else APP.draft.lines[i].q--;
          redraw();
        });
      };
      bind();
      $('#ps-q', sh).oninput = e => { q = e.target.value.trim(); redraw(); };
      $('#ps-cats', sh).addEventListener('chipchange', e => { cat = e.detail; redraw(); });
      $('[data-ps-done]', sh).onclick = () => { closeSheet(); setTimeout(refresh, 200); };
    },
    onClose() { refresh(); }
  });
  return s;
}

/* -------------------------------------------------------- SUBMIT + DONE --- */
function submitDraft() {
  const d = APP.draft, total = draftTotal(d);
  const isTicket = APP.role === 'driver';
  const ref = isTicket ? `TK-${314 + DB.tickets.length - 3}` : `BF-${2054}`;
  const offline = APP.sync === 'offline';
  const received = isTicket ? (d.received ?? total) : total;
  const credit = isTicket ? Math.max(total - received, 0) : 0;

  /* optimistic: show the confirmation immediately, sync in the background */
  APP.draft = null;
  if (isTicket) {
    DB.tickets.push({ id:'t' + Date.now(), ref, cust:d.cust, total, status:'pending',
      time:'Just now', by:'u4', items:d.lines, sync: offline ? 'pending' : 'synced', area:C(d.cust).area,
      method:d.method, received, credit, paid: credit === 0 ? 'paid' : received > 0 ? 'partial' : 'unpaid' });
    if (credit > 0) {
      const c = C(d.cust);
      c.credit = (c.credit || 0) + credit;
      c.ledger = c.ledger || [];
      c.ledger.unshift({ id:'lg' + Date.now(), time:'Just now', ref, sale:total, paid:received, credit, method:d.method });
      logAudit('Created customer credit', `${c.name} · ${ref} · ${money(credit)} outstanding`, 'credit');
    }
  }
  else DB.orders.unshift({ id:'o' + Date.now(), ref, cust:d.cust, total, status:'pending', time:'Just now',
    when:'today', paid: d.method ? 'unpaid' : 'unpaid', channel:'Walk-in', staff:user().id, branch:APP.branch,
    items:d.lines, note:d.note });

  nav('created', { ref, total, cust:d.cust, lines:d.lines, isTicket, offline, method:d.method, received, credit }, 'fade');
}

SCREENS.created = {
  chrome: false,
  render({ ref, total, cust, lines, isTicket, offline, method, received, credit }) {
    const c = C(cust);
    return `<div class="body" style="padding-top:96px;display:flex;flex-direction:column">
      <div class="confirm-panel">
        <div class="cp-ring">${icon('check', 28, { stroke:2.4 })}</div>
        <h3>${isTicket ? 'Sale' : 'Order'} recorded</h3>
        <div class="cp-meta">${ref} · ${c.name}</div>
        <div class="hero-figure num" style="margin-top:var(--s-4)">${money(total)}</div>

        ${offline ? `<div class="offline-note" style="margin-top:var(--s-5);text-align:left">
            <span class="itile -sm">${icon('wifiOff', 16)}</span>
            <span class="on-txt"><b>Saved on this phone</b><span>Waiting for connection — nothing is lost</span></span>
          </div>`
        : `<div class="row" style="justify-content:center;margin-top:var(--s-4)">
            <span class="sync -synced">${icon('check', 12, { stroke:2.2 })} Saved</span></div>`}

        <div class="cp-recap">
          <div class="recap">
            ${lines.map(l => `<div class="r-line"><span>${l.q} × ${P(l.p).name}</span>
              <span class="spacer"></span><b>${money(P(l.p).price * l.q)}</b></div>`).join('')}
            <div class="r-rule"></div>
            <div class="r-line"><span>Payment</span><span class="spacer"></span><b>${method || 'Cash'}</b></div>
            ${isTicket ? `<div class="r-line"><span>Received</span><span class="spacer"></span><b>${money(received)}</b></div>
            ${credit > 0 ? `<div class="r-line"><span>Customer credit</span><span class="spacer"></span><b style="color:var(--warning)">${money(credit)}</b></div>` : ''}` : ''}
            <div class="r-rule"></div>
            <div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(total)}</b></div>
          </div>
        </div>
      </div>
      <div class="spacer" style="flex:1"></div>
      <div class="stack-3" style="padding-bottom:var(--s-6)">
        <button class="btn -primary -block -lg" data-another>${icon('plus', 18)} Create another</button>
        <button class="btn -secondary -block" data-nav="${isTicket ? 'tickets' : 'orders'}" data-nav-mode="tab">
          ${isTicket ? 'View tickets' : 'View orders'}</button>
        <button class="btn -tertiary -block" data-nav="home" data-nav-mode="tab">Back to home</button>
      </div>
    </div>`;
  },
  mount(el) {
    $('[data-another]', el).onclick = () => { APP.draft = newDraft(); nav('new-ticket', {}, 'fade'); };
  }
};

/* ================================================= SALESPERSON: NEW SALE === */
/* A distinct, faster path than the order/ticket flow above: walk-in is the
   default (no customer step), products are large tap-to-add tiles, and the
   sale is a separate lightweight log — not the Orders pipeline. */
function newSale() { return { lines: [], step: 1, method: 'Cash', received: null, custId: null, q: '', cat: 'All' }; }
const saleTotal = s => s.lines.reduce((sum, l) => sum + P(l.p).price * l.q, 0);

function saleCustomerSheet(s) {
  sheet({
    title: 'Customer',
    body: `<div class="menu">
      <button class="menu-item" data-walkin>
        <span class="itile -sm">${icon('user', 16)}</span>
        <span class="m-txt"><b>Walk-in customer</b><span>No record needed</span></span></button>
      <button class="menu-item" data-search-cust>
        <span class="itile -sm">${icon('search', 16)}</span>
        <span class="m-txt"><b>Search customer</b><span>Existing customers</span></span></button>
    </div>`,
    onMount(sh) {
      $('[data-walkin]', sh).onclick = () => { s.custId = null; closeSheet(); setTimeout(refresh, 200); };
      $('[data-search-cust]', sh).onclick = () => { closeSheet(); setTimeout(() => customerSheet(c => { s.custId = c; refresh(); }), 200); };
    }
  });
}

function saleCartSheet(s) {
  const render = () => s.lines.map(l => { const p = P(l.p); return `
    <div class="cart-line" data-line="${l.p}">
      <span class="cl-main"><b>${p.name}</b><span>${money(p.price)} per ${p.unit} · <b class="num" data-sc-total="${l.p}">${money(p.price * l.q)}</b></span></span>
      <span class="stepper">
        <button data-sc-dec="${l.p}" aria-label="Fewer">${icon(l.q === 1 ? 'trash' : 'minus', 14)}</button>
        <span class="qty" data-sc-qty="${l.p}">${l.q}</span>
        <button data-sc-inc="${l.p}" aria-label="More">${icon('plus', 14)}</button>
      </span>
    </div>`; }).join('');
  sheet({
    title: 'This sale', tall: true,
    body: `<div class="card" id="sc-lines">${render()}</div>`,
    foot: `<div class="d-row" style="display:flex;align-items:center;gap:var(--s-4)">
        <div class="d-total" style="flex:1"><div class="k" style="font-size:var(--t-caption);font-weight:620;letter-spacing:.09em;text-transform:uppercase;color:var(--warm-gray-soft)">Total</div>
          <div class="v num" id="sc-total" style="font-size:var(--t-title-2);font-weight:660">${money(saleTotal(s))}</div></div>
        <button class="btn -primary" data-sc-done>Done</button></div>`,
    onMount(sh) {
      const redraw = () => { $('#sc-lines', sh).innerHTML = render(); $('#sc-total', sh).textContent = money(saleTotal(s)); bind(); refresh(); };
      const bind = () => {
        $$('[data-sc-inc]', sh).forEach(b => b.onclick = () => { s.lines.find(l => l.p === b.dataset.scInc).q++; redraw(); });
        $$('[data-sc-dec]', sh).forEach(b => b.onclick = () => {
          const i = s.lines.findIndex(l => l.p === b.dataset.scDec);
          if (s.lines[i].q === 1) s.lines.splice(i, 1); else s.lines[i].q--;
          redraw();
          if (!s.lines.length) closeSheet();
        });
      };
      bind();
      $('[data-sc-done]', sh).onclick = () => closeSheet();
    },
    onClose() { refresh(); }
  });
}

function saleStepProducts(s) {
  let rows = DB.products.filter(p => s.cat === 'All' || p.cat === s.cat);
  if (s.q) rows = rows.filter(p => p.name.toLowerCase().includes(s.q.toLowerCase()));
  return `
    <div class="flush-pad" style="padding-top:var(--s-3)">
      <button class="picker -filled" data-sale-cust style="margin-bottom:var(--s-3)">
        <span class="p-ico">${icon('user', 16)}</span>
        <span class="p-txt"><b>${s.custId ? C(s.custId).name : 'Walk-in customer'}</b><span>Tap to change</span></span>
        <span class="chev">${icon('chevRight', 15)}</span>
      </button>
      <div class="searchbar"><input id="sale-q" value="${esc(s.q)}">${icon('search', 17)}</div>
      <div class="chips" data-chipgroup id="sale-cats" style="margin:var(--s-3) 0">
        ${DB.productCats.map(c => `<button class="chip" data-val="${c}" aria-pressed="${c === s.cat}">${c}</button>`).join('')}
      </div>
    </div>
    <div class="flush-pad">
      ${rows.length ? `<div class="sale-grid">
        ${rows.map(p => { const line = s.lines.find(l => l.p === p.id), qty = line ? line.q : 0; return `
          <div class="sale-tile ${qty ? '-in-cart' : ''} ${p.stock === 0 ? '-disabled' : ''}" data-tile="${p.id}">
            <div class="tile-body">
              <div class="tile-top">
                <span class="tile-code">${p.cat}</span>
                ${qty ? `<button class="tile-badge" data-edit-sale-qty="${p.id}">${qty} in bag</button>` : ''}
              </div>
              <b>${p.name}</b>
              <span class="num">${p.stock === 0 ? 'Out of stock' : money(p.price)}</span>
            </div>
            <div class="tile-deck">
              <button class="deck-btn -minus" data-remove-tile="${p.id}" aria-label="Remove one">${icon('minus', 13)}<span>-1</span></button>
              <button class="deck-btn -add" data-add-tile="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>${icon('plus', 13)}<span>${qty ? 'Add' : 'Tap to Add'}</span></button>
            </div>
          </div>`; }).join('')}
      </div>` : `<div class="empty"><div class="e-art">${icon('box', 30, { stroke:1.4 })}</div><h4>No product matches</h4></div>`}
    </div>`;
}

function saleStepPayment(s) {
  const total = saleTotal(s);
  return `
    <div class="section" style="margin-top:var(--s-2)">
      <div class="section-head"><h3>Items</h3><div class="spacer"></div><button class="link" data-edit-sale-items>Edit</button></div>
      <div class="card">
        ${s.lines.map(l => { const p = P(l.p); return `
          <div class="cart-line"><span class="avatar -sm -e">${l.q}×</span>
            <span class="cl-main"><b>${p.name}</b><span>${money(p.price)} per ${p.unit}</span></span>
            <span class="strong num">${money(p.price * l.q)}</span></div>`; }).join('')}
        <div class="recap" style="margin-top:var(--s-4)">
          <div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(total)}</b></div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h3>Payment method</h3></div>
      <div class="grid-3">
        ${[['Cash','cash'],['Transfer','bank'],['POS','card']].map(([k, ic]) => `
          <button class="qa" data-sale-method="${k}" aria-pressed="${s.method === k}" style="align-items:center">
            <span class="qa-ico ${s.method === k ? '-ink' : ''}">${icon(ic, 17)}</span><b>${k}</b></button>`).join('')}
      </div>
    </div>`;
}

function saleStepDone(s) {
  const c = s.custId ? C(s.custId) : null;
  return `<div class="body" style="padding-top:96px;display:flex;flex-direction:column">
    <div class="confirm-panel">
      <div class="cp-ring">${icon('check', 28, { stroke:2.4 })}</div>
      <h3>Sale recorded</h3>
      <div class="cp-meta">${s.doneRef} · ${c ? c.name : 'Walk-in customer'}</div>
      <div class="hero-figure num" style="margin-top:var(--s-4)">${money(s.doneTotal)}</div>
      <div class="cp-recap">
        <div class="recap">
          ${s.lines.map(l => `<div class="r-line"><span>${l.q} × ${P(l.p).name}</span><span class="spacer"></span><b>${money(P(l.p).price * l.q)}</b></div>`).join('')}
          <div class="r-rule"></div>
          <div class="r-line"><span>Payment method</span><span class="spacer"></span><b>${s.method}</b></div>
          <div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(s.doneTotal)}</b></div>
        </div>
      </div>
    </div>
    <div class="spacer" style="flex:1"></div>
    <div class="stack-3" style="padding-bottom:var(--s-6)">
      <button class="btn -primary -block -lg" data-another-sale>${icon('plus', 18)} New sale</button>
      <button class="btn -secondary -block" data-nav="my-sales" data-nav-mode="tab" data-finish-sale>Today's sales</button>
      <button class="btn -tertiary -block" data-nav="home" data-nav-mode="tab" data-finish-sale>Back to home</button>
    </div>
  </div>`;
}

function completeSale(s) {
  const total = saleTotal(s);
  const ref = 'SL-' + (1000 + DB.mySales.length + 1);
  DB.mySales.unshift({ id:'sl' + Date.now(), ref, time:'Just now', cust: s.custId ? C(s.custId).name : 'Walk-in',
    items: s.lines.map(l => ({ p:l.p, q:l.q })), total, method:s.method, received:total });
  s.lines.forEach(l => { const p = P(l.p); p.stock = Math.max(0, p.stock - l.q); });
  s.step = 3; s.doneRef = ref; s.doneTotal = total; s.doneReceived = total;
  refresh();
  toast({ title:'Sale recorded', text:`${ref} · ${money(total)}` });
}

SCREENS['new-sale'] = {
  chrome: false,
  render() {
    APP.sale = APP.sale || newSale();
    const s = APP.sale;
    const total = saleTotal(s);
    return `${appbar({ title: s.step === 3 ? 'Sale complete' : 'New sale', back:false,
      right: s.step !== 3 ? `<button class="iconbtn" data-cancel-sale aria-label="Discard">${icon('close', 20)}</button>` : '' })}
    ${s.step !== 3 ? `<div class="flush-pad" style="padding:0 var(--gutter) var(--s-3)">
      <div class="steps"><i class="${s.step >= 1 ? '-cur' : ''}"></i><i class="${s.step >= 2 ? '-cur' : ''}"></i><i></i></div>
    </div>
    <div class="body -with-dock" id="sale-body">${s.step === 1 ? saleStepProducts(s) : saleStepPayment(s)}</div>
    <div class="dock">
      <div class="d-row">
        <div class="d-total"><div class="k">Total</div><div class="v num">${money(total)}</div></div>
        <button class="btn -primary" id="sale-next" ${s.step === 1 && !s.lines.length ? 'disabled' : ''}>
          ${s.step === 2 ? `Confirm sale` : 'Continue'} ${icon('arrowRight', 16)}</button>
      </div>
      ${s.lines.length ? `<button class="hintline" style="margin-top:9px;background:none;border:0;padding:0;width:100%;text-align:left" data-view-cart>
        ${icon('bag', 13)} ${s.lines.reduce((sum, l) => sum + l.q, 0)} items · tap to review</button>` : ''}
    </div>` : saleStepDone(s)}`;
  },
  mount(el) {
    const s = APP.sale;
    $('[data-cancel-sale]', el)?.addEventListener('click', () => {
      if (!s.lines.length) { APP.sale = null; back(); return; }
      dialog({
        body: `<div style="text-align:center">
          <h3 style="font-size:var(--t-title-3);font-weight:640">Discard this sale?</h3>
          <p class="label" style="margin-top:8px">Nothing has been recorded yet.</p>
          <div class="grid-2" style="margin-top:var(--s-5)">
            <button class="btn -secondary" data-close>Keep editing</button>
            <button class="btn -danger" data-discard>Discard</button></div></div>`,
        onMount(dg) { $('[data-discard]', dg).onclick = () => { APP.sale = null; closeSheet(); setTimeout(back, 220); }; }
      });
    });
    if (s.step === 1) {
      $('[data-sale-cust]', el)?.addEventListener('click', () => saleCustomerSheet(s));
      $('[data-view-cart]', el)?.addEventListener('click', () => saleCartSheet(s));
      $$('[data-tile]', el).forEach(t => t.addEventListener('click', e => {
        if (e.target.closest('[data-add-tile], [data-remove-tile]')) return;
      }));
      $$('[data-add-tile]', el).forEach(b => b.addEventListener('click', () => {
        const pid = b.dataset.addTile, line = s.lines.find(l => l.p === pid);
        if (line) line.q++; else s.lines.push({ p:pid, q:1 });
        refresh();
      }));
      $$('[data-remove-tile]', el).forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const pid = b.dataset.removeTile, i = s.lines.findIndex(l => l.p === pid);
        if (i === -1) return;
        if (s.lines[i].q <= 1) s.lines.splice(i, 1); else s.lines[i].q--;
        refresh();
      }));
      $$('[data-edit-sale-qty]', el).forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const pid = b.dataset.editSaleQty, line = s.lines.find(l => l.p === pid);
        sheet({
          title: P(pid).name,
          body: `<label class="field"><span class="f-label">Quantity</span>
            <input class="f-ctl" id="qty-direct" type="number" inputmode="numeric" min="1" value="${line.q}" autofocus></label>`,
          foot: `<button class="btn -primary -block -lg" data-save-qty>Save</button>`,
          onMount(sh) {
            const inp = $('#qty-direct', sh);
            $('[data-save-qty]', sh).onclick = () => {
              const n = Math.max(1, parseInt(inp.value, 10) || 1);
              const i = s.lines.findIndex(l => l.p === pid);
              s.lines[i].q = n;
              closeSheet();
            };
          },
          onClose() { refresh(); }
        });
      }));
      $('#sale-q', el)?.addEventListener('input', e => { s.q = e.target.value; refresh(); });
      $('#sale-cats', el)?.addEventListener('chipchange', e => { s.cat = e.detail; refresh(); });
    }
    if (s.step === 2) {
      $('[data-edit-sale-items]', el)?.addEventListener('click', () => { s.step = 1; refresh(); });
      $$('[data-sale-method]', el).forEach(b => b.addEventListener('click', () => {
        s.method = b.dataset.saleMethod;
        $$('[data-sale-method]', el).forEach(x => { x.setAttribute('aria-pressed', String(x === b)); $('.qa-ico', x).classList.toggle('-ink', x === b); });
        refresh();
      }));
    }
    $('#sale-next', el)?.addEventListener('click', () => {
      if (s.step === 1) { if (!s.lines.length) return; s.step = 2; refresh(); return; }
      completeSale(s);
    });
    $('[data-another-sale]', el)?.addEventListener('click', () => { APP.sale = newSale(); refresh(); });
    $$('[data-finish-sale]', el).forEach(b => b.addEventListener('click', () => { APP.sale = null; }));
  }
};

/* ============================================ SALESPERSON: CUSTOMER ORDER === */
/* Distinct from Record Sale: always has a customer, captures fulfilment
   date/time and notes, and submits into the shared Orders pipeline so
   Manager/Owner see it like any other order. No price overrides. */
function newCustomerOrder() { return { custId: null, lines: [], step: 1, date: 'today', customDate: '', time: '', notes: '', q: '', cat: 'All' }; }
const coTotal = s => s.lines.reduce((sum, l) => sum + P(l.p).price * l.q, 0);
function nextOrderRef() {
  const nums = DB.orders.map(o => parseInt(o.ref.replace('BF-', ''), 10)).filter(n => !isNaN(n));
  return 'BF-' + (Math.max(...nums) + 1);
}
function coFulfilLabel(s) {
  if (s.date === 'today') return `Today${s.time ? ' · ' + s.time : ''}`;
  if (s.date === 'tomorrow') return `Tomorrow${s.time ? ' · ' + s.time : ''}`;
  return `${s.customDate || 'Date not set'}${s.time ? ' · ' + s.time : ''}`;
}

function coStepOne(s) {
  let rows = DB.products.filter(p => s.cat === 'All' || p.cat === s.cat);
  if (s.q) rows = rows.filter(p => p.name.toLowerCase().includes(s.q.toLowerCase()));
  const cust = s.custId ? C(s.custId) : null;
  return `
    <div class="flush-pad" style="padding-top:var(--s-3)">
      <button class="picker -filled" data-co-cust style="margin-bottom:var(--s-3)">
        <span class="p-ico">${icon('user', 16)}</span>
        <span class="p-txt"><b>${cust ? cust.name : 'Select a customer'}</b><span>${cust ? cust.phone : 'Required for a customer order'}</span></span>
        <span class="chev">${icon('chevRight', 15)}</span>
      </button>
      <div class="searchbar"><input id="co-q" value="${esc(s.q)}">${icon('search', 17)}</div>
      <div class="chips" data-chipgroup id="co-cats" style="margin:var(--s-3) 0">
        ${DB.productCats.map(c => `<button class="chip" data-val="${c}" aria-pressed="${c === s.cat}">${c}</button>`).join('')}
      </div>
    </div>
    <div class="flush-pad">
      ${rows.length ? `<div class="sale-grid">
        ${rows.map(p => { const line = s.lines.find(l => l.p === p.id), qty = line ? line.q : 0; return `
          <button class="sale-tile ${qty ? '-in-cart' : ''}" data-co-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
            ${qty ? `<span class="tile-qty">${qty}</span>` : ''}
            <span class="p-thumb" style="width:100%;height:52px;border-radius:10px">
              <span class="p-mono">${p.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span></span>
            <b>${p.name}</b>
            <span class="num">${p.stock === 0 ? 'Out of stock' : money(p.price)}</span>
          </button>`; }).join('')}
      </div>` : `<div class="empty"><div class="e-art">${icon('box', 30, { stroke:1.4 })}</div><h4>No product matches</h4></div>`}
    </div>`;
}

function coStepTwo(s) {
  return `
    <div class="section" style="margin-top:var(--s-2)">
      <div class="section-head"><h3>Items</h3><div class="spacer"></div><button class="link" data-co-edit-items>Edit</button></div>
      <div class="card">
        ${s.lines.map(l => { const p = P(l.p); return `
          <div class="cart-line"><span class="avatar -sm -e">${l.q}×</span>
            <span class="cl-main"><b>${p.name}</b><span>${money(p.price)} per ${p.unit}</span></span>
            <span class="strong num">${money(p.price * l.q)}</span></div>`; }).join('')}
        <div class="recap" style="margin-top:var(--s-4)"><div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(coTotal(s))}</b></div></div>
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h3>Fulfilment date</h3></div>
      <div class="grid-3">
        ${[['today','Today'],['tomorrow','Tomorrow'],['custom','Pick a date']].map(([k, l]) => `
          <button class="qa" data-co-date="${k}" aria-pressed="${s.date === k}" style="align-items:center"><b>${l}</b></button>`).join('')}
      </div>
      ${s.date === 'custom' ? `<div class="field" style="margin-top:var(--s-3)">
        <span class="f-label">Date</span>
        <input class="f-ctl" id="co-custom-date" value="${esc(s.customDate)}"></div>` : ''}
      <div class="field" style="margin-top:var(--s-3)">
        <span class="f-label">Time (optional)</span>
        <input class="f-ctl" id="co-time" value="${esc(s.time)}"></div>
    </div>
    <div class="section">
      <div class="section-head"><h3>Notes</h3></div>
      <textarea class="f-ctl" id="co-notes" style="min-height:88px">${esc(s.notes)}</textarea>
    </div>`;
}

function coStepReview(s) {
  const cust = C(s.custId);
  return `
    <div class="section" style="margin-top:var(--s-2)">
      <div class="section-head"><h3>Customer</h3></div>
      <div class="card"><div class="row"><span class="avatar -${cust.tone}">${cust.init}</span>
        <span class="li-main"><b>${cust.name}</b><span>${cust.phone}</span></span></div></div>
    </div>
    <div class="section">
      <div class="section-head"><h3>Order</h3></div>
      <div class="card">
        ${s.lines.map(l => { const p = P(l.p); return `<div class="r-line"><span>${l.q} × ${p.name}</span><span class="spacer"></span><b>${money(p.price * l.q)}</b></div>`; }).join('')}
        <div class="r-rule"></div>
        <div class="r-line"><span>Fulfilment</span><span class="spacer"></span><b>${coFulfilLabel(s)}</b></div>
        ${s.notes ? `<div class="r-line"><span>Notes</span><span class="spacer"></span><b style="text-align:right;max-width:200px">${esc(s.notes)}</b></div>` : ''}
        <div class="r-rule"></div>
        <div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(coTotal(s))}</b></div>
      </div>
    </div>`;
}

function coStepDone(s) {
  const cust = C(s.custId);
  return `<div class="body" style="padding-top:96px;display:flex;flex-direction:column">
    <div class="confirm-panel">
      <div class="cp-ring">${icon('check', 28, { stroke:2.4 })}</div>
      <h3>Order created</h3>
      <div class="cp-meta">${s.doneRef} · ${cust.name}</div>
      <div class="hero-figure num" style="margin-top:var(--s-4)">${money(s.doneTotal)}</div>
      <div class="cp-recap"><div class="recap">
        <div class="r-line"><span>Fulfilment</span><span class="spacer"></span><b>${coFulfilLabel(s)}</b></div>
        <div class="r-line"><span>Status</span><span class="spacer"></span><b>Pending</b></div>
      </div></div>
    </div>
    <div class="spacer" style="flex:1"></div>
    <div class="stack-3" style="padding-bottom:var(--s-6)">
      <button class="btn -primary -block -lg" data-view-co-order>${icon('bag', 18)} View order</button>
      <button class="btn -secondary -block" data-another-co>New customer order</button>
      <button class="btn -tertiary -block" data-nav="home" data-nav-mode="tab">Back to home</button>
    </div>
  </div>`;
}

function completeCustomerOrder(s) {
  const total = coTotal(s);
  const ref = nextOrderRef();
  const id = 'o' + ref.replace('BF-', '');
  DB.orders.unshift({ id, ref, cust: s.custId, total, status:'pending', time:'Just now', when: s.date === 'today' ? 'today' : 'upcoming',
    paid:'unpaid', channel:'Counter', staff: user().id, branch: APP.branch, items: s.lines.map(l => ({ p:l.p, q:l.q })), note: s.notes });
  s.step = 4; s.doneRef = ref; s.doneTotal = total; s.doneId = id;
  refresh();
  toast({ title:'Order created', text:`${ref} · ${money(total)}` });
}

SCREENS['new-customer-order'] = {
  chrome: false,
  render() {
    APP.custOrder = APP.custOrder || newCustomerOrder();
    const s = APP.custOrder;
    const total = coTotal(s);
    return `${appbar({ title: s.step === 4 ? 'Order created' : 'New customer order', back:false,
      right: s.step !== 4 ? `<button class="iconbtn" data-cancel-co aria-label="Discard">${icon('close', 20)}</button>` : '' })}
    ${s.step !== 4 ? `<div class="flush-pad" style="padding:0 var(--gutter) var(--s-3)">
      <div class="steps"><i class="${s.step >= 1 ? '-cur' : ''}"></i><i class="${s.step >= 2 ? '-cur' : ''}"></i><i class="${s.step >= 3 ? '-cur' : ''}"></i></div>
    </div>
    <div class="body -with-dock" id="co-body">${s.step === 1 ? coStepOne(s) : s.step === 2 ? coStepTwo(s) : coStepReview(s)}</div>
    <div class="dock">
      <div class="d-row">
        <div class="d-total"><div class="k">Total</div><div class="v num">${money(total)}</div></div>
        <button class="btn -primary" id="co-next" ${s.step === 1 && !(s.lines.length && s.custId) ? 'disabled' : ''}
          ${s.step === 2 && s.date === 'custom' && !s.customDate ? 'disabled' : ''}>
          ${s.step === 3 ? 'Submit order' : 'Continue'} ${icon('arrowRight', 16)}</button>
      </div>
      ${s.lines.length ? `<button class="hintline" style="margin-top:9px;background:none;border:0;padding:0;width:100%;text-align:left" data-co-cart-hint>
        ${icon('bag', 13)} ${s.lines.reduce((sum, l) => sum + l.q, 0)} items</button>` : ''}
    </div>` : coStepDone(s)}`;
  },
  mount(el) {
    const s = APP.custOrder;
    $('[data-cancel-co]', el)?.addEventListener('click', () => {
      if (!s.lines.length && !s.custId) { APP.custOrder = null; back(); return; }
      dialog({
        body: `<div style="text-align:center">
          <h3 style="font-size:var(--t-title-3);font-weight:640">Discard this order?</h3>
          <p class="label" style="margin-top:8px">Nothing has been submitted yet.</p>
          <div class="grid-2" style="margin-top:var(--s-5)">
            <button class="btn -secondary" data-close>Keep editing</button>
            <button class="btn -danger" data-discard>Discard</button></div></div>`,
        onMount(dg) { $('[data-discard]', dg).onclick = () => { APP.custOrder = null; closeSheet(); setTimeout(back, 220); }; }
      });
    });
    if (s.step === 1) {
      $('[data-co-cust]', el)?.addEventListener('click', () => customerSheet(id => { s.custId = id; refresh(); }));
      $$('[data-co-add]', el).forEach(b => b.addEventListener('click', () => {
        const pid = b.dataset.coAdd, line = s.lines.find(l => l.p === pid);
        if (line) line.q++; else s.lines.push({ p:pid, q:1 });
        refresh();
      }));
      $('#co-q', el)?.addEventListener('input', e => { s.q = e.target.value; refresh(); });
      $('#co-cats', el)?.addEventListener('chipchange', e => { s.cat = e.detail; refresh(); });
    }
    if (s.step === 2) {
      $('[data-co-edit-items]', el)?.addEventListener('click', () => { s.step = 1; refresh(); });
      $$('[data-co-date]', el).forEach(b => b.addEventListener('click', () => { s.date = b.dataset.coDate; refresh(); }));
      $('#co-custom-date', el)?.addEventListener('input', e => { s.customDate = e.target.value; $('#co-next').disabled = !e.target.value; });
      $('#co-time', el)?.addEventListener('input', e => { s.time = e.target.value; });
      $('#co-notes', el)?.addEventListener('input', e => { s.notes = e.target.value; });
    }
    $('#co-next', el)?.addEventListener('click', () => {
      if (s.step === 1) { if (!(s.lines.length && s.custId)) return; s.step = 2; refresh(); return; }
      if (s.step === 2) { if (s.date === 'custom' && !s.customDate) return; s.step = 3; refresh(); return; }
      completeCustomerOrder(s);
    });
    $('[data-another-co]', el)?.addEventListener('click', () => { APP.custOrder = newCustomerOrder(); refresh(); });
    $('[data-view-co-order]', el)?.addEventListener('click', () => { const id = s.doneId; APP.custOrder = null; nav('order', { id }); });
  }
};

/* ================================================== BAKER: RECORD PRODUCTION === */
/* Adapts to context: tapping a specific batch on Home/Production jumps
   straight to quantity entry (step 3). Starting fresh walks product -> batch -> qty. */
function bakerProducts() { return [...new Set(DB.productionBatches.map(b => b.product))]; }
function pendingBatchFor(product) { return DB.productionBatches.find(b => b.product === product && ['scheduled','in_progress'].includes(b.status)); }
function unitFor(productName) { const p = DB.products.find(x => x.name === productName); return p ? p.unit : 'unit'; }
function pluralUnit(unit, qty) { if (qty === 1) return unit; if (unit === 'loaf') return 'loaves'; if (unit === 'each') return 'each'; return unit + 's'; }

function rpStepProduct(s) {
  return `<div class="flush-pad" style="padding-top:var(--s-3)">
    <p class="label" style="margin-bottom:var(--s-3)">What did you produce?</p>
    <div class="stack-3">
      ${bakerProducts().map(name => { const pending = pendingBatchFor(name); return `
        <button class="card -tap" data-rp-product="${esc(name)}" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;padding:var(--s-4)">
          <span class="itile ${pending ? '-accent' : ''}">${icon('flame', 19)}</span>
          <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">${name}</b>
            <span class="label">${pending ? `Batch ready · ${pending.status === 'in_progress' ? 'In progress' : 'Not started'}` : 'Start a new batch'}</span></span>
          <span class="chev">${icon('chevRight', 18)}</span>
        </button>`; }).join('')}
    </div>
  </div>`;
}

function rpStepBatch(s) {
  const pending = pendingBatchFor(s.product);
  return `<div class="flush-pad" style="padding-top:var(--s-3)">
    ${pending ? `
      <p class="label" style="margin-bottom:var(--s-3)">Today's batch</p>
      <div class="card">
        <div class="row"><span class="itile -accent">${icon('flame', 19)}</span>
          <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">${pending.id.replace('pb', 'Batch ')}</b>
            <span class="label">${s.product} · ${pending.started ? `Started ${pending.started}` : 'Not started'}</span></span>
          <span class="badge ${pending.status === 'in_progress' ? '-accent' : ''}">${pending.status === 'in_progress' ? 'In progress' : 'Not started'}</span></div>
      </div>
      <button class="btn -primary -block -lg" style="margin-top:var(--s-4)" data-rp-use-batch="${pending.id}">Record output</button>
    ` : `
      <p class="label" style="margin-bottom:var(--s-3)">No batch is queued for ${s.product} yet.</p>
      <button class="btn -primary -block -lg" data-rp-new-batch>${icon('plus', 17)} Start new batch</button>
    `}
  </div>`;
}

function rpStepQty(s) {
  const unit = unitFor(s.product);
  return `<div class="flush-pad" style="padding-top:var(--s-4);text-align:center">
    <p class="label">How many were produced?</p>
    <div class="row" style="justify-content:center;align-items:center;gap:var(--s-5);margin:var(--s-5) 0">
      <button class="itile" style="width:52px;height:52px;border-radius:16px" id="rp-dec" aria-label="Fewer">${icon('minus', 22)}</button>
      <div><div class="hero-figure num" id="rp-qty-display" style="font-size:56px">${s.qty}</div>
        <div class="label">${pluralUnit(unit, s.qty)}</div></div>
      <button class="itile -accent" style="width:52px;height:52px;border-radius:16px" id="rp-inc" aria-label="More">${icon('plus', 22)}</button>
    </div>
    <input id="rp-qty-input" type="text" inputmode="numeric" class="f-ctl" style="text-align:center;font-size:var(--t-title-3);max-width:220px;margin:0 auto">
    <div class="chips" style="justify-content:center;margin-top:var(--s-4)">
      ${[50, 100, 250, 500].map(n => `<button class="chip" data-rp-quick="${n}">+${n}</button>`).join('')}
    </div>
    <div class="field" style="text-align:left;margin-top:var(--s-6)">
      ${s.showNote ? `<span class="f-label">Note (optional)</span>
        <textarea class="f-ctl" id="rp-note" style="min-height:72px">${esc(s.note)}</textarea>`
      : `<button class="link" id="rp-add-note">${icon('plus', 13)} Add note</button>`}
    </div>
  </div>`;
}

function rpStepDone(s) {
  return `<div class="body" style="padding-top:96px;display:flex;flex-direction:column">
    <div class="confirm-panel">
      <div class="cp-ring">${icon('check', 28, { stroke:2.4 })}</div>
      <h3>Production recorded</h3>
      <div class="hero-figure num" style="margin-top:var(--s-4)">${s.qty} ${pluralUnit(unitFor(s.product), s.qty)}</div>
      <div class="cp-meta">${s.product} · ${s.doneBatchLabel}</div>
      <div class="cp-meta">Recorded at ${s.doneTime}</div>
    </div>
    <div class="spacer" style="flex:1"></div>
    <div class="stack-3" style="padding-bottom:var(--s-6)">
      <button class="btn -primary -block -lg" data-rp-another>${icon('plus', 18)} Record another batch</button>
      <button class="btn -tertiary -block" data-nav="home" data-nav-mode="tab">Done</button>
    </div>
  </div>`;
}

function completeProduction(s) {
  let batch;
  if (s.batchId === 'new') {
    batch = { id:'pb' + Date.now(), product:s.product, qty:s.qty, status:'completed', baker:user().name, started:'Just now', producedQty:s.qty };
    DB.productionBatches.unshift(batch);
  } else {
    batch = DB.productionBatches.find(b => b.id === s.batchId);
    batch.status = 'completed'; batch.producedQty = s.qty; batch.qty = s.qty;
  }
  const unit = unitFor(s.product);
  const record = { id:'pr' + Date.now(), time:'Just now', product:s.product, qty:s.qty, unit, batchId:batch.id, note:s.note, correction:null };
  DB.myProduction.unshift(record);
  const prod = DB.products.find(p => p.name === s.product);
  if (prod) prod.stock += s.qty;
  DB.stockMovements.unshift({ id:'sm' + Date.now(), item:s.product, kind:'production_output', qty:s.qty, time:'Just now', by:user().name });
  logAudit('Recorded production', `${s.product} · ${s.qty} ${pluralUnit(unit, s.qty)} · ${batch.id.replace('pb','Batch ')}`, 'production');
  s.step = 4; s.doneBatchLabel = batch.id.replace('pb', 'Batch '); s.doneTime = 'Just now';
  refresh();
  toast({ title:'Production recorded', text:`${s.qty} ${pluralUnit(unit, s.qty)} · ${s.product}` });
}

SCREENS['record-production'] = {
  chrome: false,
  render() {
    APP.production = APP.production || { step:1, product:null, batchId:null, qty:0, note:'', showNote:false };
    const s = APP.production;
    return `${appbar({ title: s.step === 4 ? 'Production recorded' : 'Record production', back:false,
      right: s.step !== 4 ? `<button class="iconbtn" data-cancel-rp aria-label="Cancel">${icon('close', 20)}</button>` : '' })}
    ${s.step !== 4 ? `
    <div class="body -with-dock">${s.step === 1 ? rpStepProduct(s) : s.step === 2 ? rpStepBatch(s) : rpStepQty(s)}</div>
    ${s.step === 3 ? `<div class="dock">
      <button class="btn -primary -block -lg" id="rp-submit" ${s.qty <= 0 ? 'disabled' : ''}>Record production ${icon('arrowRight', 16)}</button>
    </div>` : ''}
    ` : rpStepDone(s)}`;
  },
  mount(el) {
    const s = APP.production;
    $('[data-cancel-rp]', el)?.addEventListener('click', () => { APP.production = null; back(); });
    if (s.step === 1) {
      $$('[data-rp-product]', el).forEach(b => b.addEventListener('click', () => { s.product = b.dataset.rpProduct; s.step = 2; refresh(); }));
    }
    if (s.step === 2) {
      $('[data-rp-use-batch]', el)?.addEventListener('click', () => { s.batchId = $('[data-rp-use-batch]', el).dataset.rpUseBatch; s.step = 3; refresh(); });
      $('[data-rp-new-batch]', el)?.addEventListener('click', () => { s.batchId = 'new'; s.step = 3; refresh(); });
    }
    if (s.step === 3) {
      const display = $('#rp-qty-display', el), input = $('#rp-qty-input', el), submit = () => { $('#rp-submit').disabled = s.qty <= 0; };
      const setQty = n => { s.qty = Math.max(0, n); display.textContent = s.qty; input.value = ''; submit(); };
      $('#rp-dec', el).onclick = () => setQty(s.qty - 1);
      $('#rp-inc', el).onclick = () => setQty(s.qty + 1);
      $$('[data-rp-quick]', el).forEach(b => b.onclick = () => setQty(s.qty + (+b.dataset.rpQuick)));
      input.oninput = () => { const n = +input.value.replace(/[^\d]/g, ''); input.value = n || ''; s.qty = n; display.textContent = n; submit(); };
      $('#rp-add-note', el)?.addEventListener('click', () => { s.showNote = true; refresh(); });
      $('#rp-note', el)?.addEventListener('input', e => { s.note = e.target.value; });
      $('#rp-submit', el)?.addEventListener('click', () => { if (s.qty > 0) completeProduction(s); });
    }
    $('[data-rp-another]', el)?.addEventListener('click', () => { APP.production = { step:1, product:null, batchId:null, qty:0, note:'', showNote:false }; refresh(); });
  }
};

/* --------------------------------------------------------------- TICKETS --- */
const TICKET_FILTERS = [['today','Today'],['pending','Pending'],['in_transit','Out for delivery'],['delivered','Completed'],['failed','Failed']];
function ticketRouteFor(t) { return DB.driverRoute.find(r => r.cust === C(t.cust).name); }
function filterTickets(k, q = '') {
  let rows = DB.tickets.slice().reverse();
  if (k === 'today') { /* all seeded tickets are today's */ }
  else if (k === 'pending') rows = rows.filter(t => t.status === 'pending');
  else if (k === 'in_transit') rows = rows.filter(t => ticketRouteFor(t)?.status === 'in_transit');
  else if (k === 'delivered') rows = rows.filter(t => t.status === 'completed');
  else if (k === 'failed') rows = rows.filter(t => ticketRouteFor(t)?.status === 'failed');
  if (q) rows = rows.filter(t => t.ref.toLowerCase().includes(q.toLowerCase()) || C(t.cust).name.toLowerCase().includes(q.toLowerCase())
    || C(t.cust).phone.includes(q) || (C(t.cust).address || '').toLowerCase().includes(q.toLowerCase()));
  return rows;
}
SCREENS.tickets = {
  get tab() { return APP.role === 'driver' ? 'tickets' : 'more'; },
  render(p) {
    const active = p?.f || 'today', q = p?.q || '';
    const t = filterTickets(active, q);
    return `${appbar({ title:'Tickets', back: APP.role !== 'driver',
      sub:`${DB.tickets.length} today · ${money(DB.tickets.reduce((s, x) => s + x.total, 0))}`, right: syncChip() })}
    <div class="body -with-tabbar">
      <div class="searchbar" style="margin-bottom:var(--s-3)"><input id="tk-q" value="${esc(q)}">${icon('search', 17)}</div>
      <div class="chips" data-chipgroup id="tk-filters" style="margin-bottom:var(--s-4);flex-wrap:wrap">
        ${TICKET_FILTERS.map(([k, l]) => `<button class="chip" data-val="${k}" aria-pressed="${k === active}">${l}</button>`).join('')}
      </div>
      ${APP.sync === 'offline' ? `<div class="offline-note" style="margin-bottom:var(--s-4)">
        <span class="itile -sm">${icon('wifiOff', 16)}</span>
        <span class="on-txt"><b>Working offline</b><span>Tickets are saved here and sent when you reconnect</span></span>
        <button class="btn -sm -secondary" data-open-sync>Review</button></div>` : ''}

      <div class="stack-3" id="tk-list">${t.length ? t.map(ticketCard).join('') : `<div class="empty"><div class="e-art">${icon('ticket', 30, { stroke:1.4 })}</div><h4>No tickets match</h4></div>`}</div>
    </div>
    <button class="fab" data-nav="new-ticket">${icon('plus', 18)} New ticket</button>`;
  },
  mount(el, p) {
    $('#tk-q', el).oninput = () => nav('tickets', { f: p?.f, q: $('#tk-q', el).value }, 'replace');
    $('#tk-filters', el).addEventListener('chipchange', e => nav('tickets', { f: e.detail, q: p?.q }, 'replace'));
  }
};
function ticketCard(x) {
  const c = C(x.cust);
  return `<button class="order-card ${x.sync === 'pending' ? '-urgent' : ''}" data-nav="order" data-nav-params='{"id":"${x.id}"}'>
    <div class="oc-head">
      <span class="avatar -${c.tone}">${c.init}</span>
      <div style="flex:1;min-width:0">
        <div class="oc-id">${x.ref} · ${x.area}</div>
        <div class="oc-name">${c.name}</div></div>
      ${statusBadge(x.status)}
    </div>
    <div class="oc-items">${itemLine(x.items)}</div>
    <div class="oc-foot">
      <span class="oc-amt num">${money(x.total)}</span>
      <span class="spacer"></span>
      ${x.sync === 'pending'
        ? `<span class="sync -offline">${icon('wifiOff', 12)} Waiting</span>`
        : `<span class="oc-time">${icon('clock', 12)} ${x.time}</span>`}
    </div>
  </button>`;
}

/* ============================================================ DRIVER TRIP === */
/* ADR-001: the driver has custody of loaded bakery inventory for the day —
   not a courier fulfilling pre-made deliveries. Loading is verified, sales
   happen on the road (via New Ticket, which now also collects payment and
   calculates any customer credit automatically), and the trip ends with a
   physical stock return and a reconciliation against what was loaded/sold. */
const TRIP_STAGE = {
  created:         { label:'Not started' },
  loading:         { label:'Loading stock' },
  ready_to_depart: { label:'Ready to depart' },
  in_transit:      { label:'On the road' },
  returning:       { label:'Returning stock' },
  reconciled:      { label:'Reconciled' },
  completed:       { label:'Trip completed' },
};
const TRIP_PRODUCTS = ['p9', 'p10', 'p11', 'p7', 'p5'];
function tripSoldQty(pid) {
  return DB.tickets.reduce((s, t) => s + (t.items || []).filter(l => l.p === pid).reduce((x, l) => x + l.q, 0), 0);
}
function tripMoneyTotals() {
  const totals = { Cash:0, Transfer:0, POS:0 };
  let credit = 0;
  DB.tickets.forEach(t => { const m = t.method || 'Cash'; totals[m] = (totals[m] || 0) + (t.received ?? t.total); credit += t.credit || 0; });
  return { totals, credit };
}

SCREENS.trip = {
  render() {
    const trip = DB.driverTrip;
    const stage = trip.status;
    return `${appbar({ title:'Trip', sub: TRIP_STAGE[stage].label, right: syncChip() })}
    <div class="body -with-dock">
      ${stage === 'created' || stage === 'loading' ? tripLoadingStep(trip) : ''}
      ${stage === 'ready_to_depart' ? tripDepartStep(trip) : ''}
      ${stage === 'in_transit' ? tripOnRoadStep(trip) : ''}
      ${stage === 'returning' ? tripReturnStep(trip) : ''}
      ${stage === 'reconciled' ? tripReconcileStep(trip) : ''}
      ${stage === 'completed' ? tripDoneStep(trip) : ''}
    </div>`;
  },
  mount(el) {
    const trip = DB.driverTrip;
    const stage = trip.status;
    if (stage === 'created' || stage === 'loading') wireTripLoading(el, trip);
    if (stage === 'ready_to_depart') {
      $('[data-confirm-depart]', el)?.addEventListener('click', () => {
        trip.status = 'in_transit'; trip.departedAt = 'Just now';
        logAudit('Confirmed trip departure', `${trip.loaded.length} products loaded · verified by ${trip.verifiedBy}`, 'trip');
        refresh();
        toast({ title:'Trip started', text:'Loaded stock is now with you on the road' });
      });
    }
    if (stage === 'in_transit') {
      $('[data-start-return]', el)?.addEventListener('click', () => { trip.status = 'returning'; refresh(); });
    }
    if (stage === 'returning') wireTripReturn(el, trip);
  }
};

function tripLoadingStep(trip) {
  const draft = APP.tripDraft || (APP.tripDraft = { lines: (trip.loaded || []).map(l => ({ ...l })), verifier: trip.verifiedBy || null });
  const verifiers = DB.staffList.filter(s => ['Supervisor', 'Branch Manager'].includes(s.role)).concat([{ name:'David Balogun', role:'Baker' }]);
  const canConfirm = draft.lines.some(l => l.qty > 0) && draft.verifier;
  return `
    <section class="section" style="margin-top:var(--s-2)">
      <div class="section-head"><h3>Load stock for today</h3></div>
      <div class="list">
        ${TRIP_PRODUCTS.map(P).map(p => {
          const line = draft.lines.find(l => l.p === p.id), qty = line ? line.qty : 0;
          return `<div class="li">
            <span class="itile -sm">${icon('box', 16)}</span>
            <span class="li-main"><b>${p.name}</b><span>${p.stock} in bakery stock</span></span>
            <span class="stepper">
              <button data-load-dec="${p.id}" aria-label="Fewer">${icon('minus', 14)}</button>
              <span class="qty" data-load-qty="${p.id}">${qty}</span>
              <button data-load-inc="${p.id}" aria-label="More">${icon('plus', 14)}</button>
            </span>
          </div>`;
        }).join('')}
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h3>Verified by</h3></div>
      <p class="meta" style="margin-bottom:var(--s-3)">A supervisor, manager or baker confirms the loaded quantity.</p>
      <div class="chips" data-chipgroup id="trip-verifier" style="flex-wrap:wrap">
        ${verifiers.map(v => `<button class="chip" data-val="${v.name}" aria-pressed="${draft.verifier === v.name}">${v.name}</button>`).join('')}
      </div>
    </section>
    <button class="btn -primary -block -lg" id="trip-confirm-load" ${canConfirm ? '' : 'disabled'}>Confirm loading ${icon('arrowRight', 16)}</button>`;
}
function wireTripLoading(el, trip) {
  const draft = APP.tripDraft;
  const refreshBtn = () => { $('#trip-confirm-load', el).disabled = !(draft.lines.some(l => l.qty > 0) && draft.verifier); };
  const setQty = (pid, n) => {
    n = Math.max(0, n);
    let line = draft.lines.find(l => l.p === pid);
    if (!line) { line = { p:pid, qty:0 }; draft.lines.push(line); }
    line.qty = n;
    $(`[data-load-qty="${pid}"]`, el).textContent = n;
    refreshBtn();
  };
  $$('[data-load-inc]', el).forEach(b => b.onclick = () => setQty(b.dataset.loadInc, (draft.lines.find(l => l.p === b.dataset.loadInc)?.qty || 0) + 10));
  $$('[data-load-dec]', el).forEach(b => b.onclick = () => setQty(b.dataset.loadDec, (draft.lines.find(l => l.p === b.dataset.loadDec)?.qty || 0) - 10));
  $('#trip-verifier', el).addEventListener('chipchange', e => { draft.verifier = e.detail; refreshBtn(); });
  $('#trip-confirm-load', el).addEventListener('click', () => {
    trip.status = 'ready_to_depart';
    trip.loaded = draft.lines.filter(l => l.qty > 0);
    trip.verifiedBy = draft.verifier;
    trip.loadedAt = 'Just now';
    APP.tripDraft = null;
    trip.loaded.forEach(l => { const prod = P(l.p); if (prod) prod.stock = Math.max(0, prod.stock - l.qty); });
    DB.stockMovements.unshift({ id:'sm' + Date.now(), item:trip.loaded.map(l => P(l.p).name).join(', '), kind:'trip_load', qty: trip.loaded.reduce((a, l) => a + l.qty, 0), time:'Just now', by:user().name });
    logAudit('Loaded trip stock', `${trip.loaded.map(l => `${l.qty} × ${P(l.p).name}`).join(', ')} · verified by ${trip.verifiedBy}`, 'trip');
    refresh();
    toast({ title:'Stock loaded', text:`Verified by ${trip.verifiedBy}` });
  });
}

function tripDepartStep(trip) {
  return `
    <section class="card -ink" style="margin-top:var(--s-2)">
      <div class="eyebrow" style="color:rgba(255,255,255,.5)">Ready to depart</div>
      <div class="label" style="margin-top:6px;color:rgba(255,255,255,.7)">Loaded ${trip.loadedAt} · verified by ${trip.verifiedBy}</div>
    </section>
    <section class="section">
      <div class="section-head"><h3>Loaded stock</h3></div>
      <div class="list">
        ${trip.loaded.map(l => `<div class="li"><span class="itile -sm">${icon('box', 16)}</span>
          <span class="li-main"><b>${P(l.p).name}</b></span><span class="li-end"><b>${l.qty}</b></span></div>`).join('')}
      </div>
    </section>
    <button class="btn -primary -block -lg" data-confirm-depart>Confirm departure ${icon('arrowRight', 16)}</button>`;
}

function tripOnRoadStep(trip) {
  const sold = trip.loaded.map(l => ({ p:l.p, loaded:l.qty, sold:tripSoldQty(l.p) }));
  return `
    <section class="card -ink" style="margin-top:var(--s-2)">
      <div class="row -top">
        <div style="flex:1">
          <div class="eyebrow" style="color:rgba(255,255,255,.5)">On the road since</div>
          <div class="hero-figure num" style="margin-top:6px;font-size:var(--t-title-1)">${trip.departedAt}</div>
        </div>
        <span class="itile" style="background:rgba(255,255,255,.12);color:#fff;width:44px;height:44px;border-radius:14px">${icon('truck', 21)}</span>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h3>Stock with you</h3></div>
      <div class="list">
        ${sold.map(s => `<div class="li"><span class="itile -sm">${icon('box', 16)}</span>
          <span class="li-main"><b>${P(s.p).name}</b><span>${s.sold} sold today</span></span>
          <span class="li-end"><b>${Math.max(0, s.loaded - s.sold)}</b><span>left</span></span></div>`).join('')}
      </div>
    </section>
    <button class="btn -secondary -block -lg" data-start-return>${icon('refresh', 17)} Start return to bakery</button>`;
}

function tripReturnStep(trip) {
  const draft = APP.tripReturnDraft || (APP.tripReturnDraft = { lines: trip.loaded.map(l => ({ p:l.p, qty: Math.max(0, l.qty - tripSoldQty(l.p)) })) });
  return `
    <section class="section" style="margin-top:var(--s-2)">
      <div class="section-head"><h3>Count what's left</h3></div>
      <p class="meta" style="margin-bottom:var(--s-3)">Enter the physical stock still in the vehicle for each product.</p>
      <div class="list">
        ${trip.loaded.map(l => {
          const expected = Math.max(0, l.qty - tripSoldQty(l.p));
          const line = draft.lines.find(x => x.p === l.p);
          return `<div class="li">
            <span class="itile -sm">${icon('box', 16)}</span>
            <span class="li-main"><b>${P(l.p).name}</b><span>Expected ${expected} · loaded ${l.qty}, sold ${tripSoldQty(l.p)}</span></span>
            <span class="stepper">
              <button data-ret-dec="${l.p}" aria-label="Fewer">${icon('minus', 14)}</button>
              <span class="qty" data-ret-qty="${l.p}">${line.qty}</span>
              <button data-ret-inc="${l.p}" aria-label="More">${icon('plus', 14)}</button>
            </span>
          </div>`;
        }).join('')}
      </div>
    </section>
    <button class="btn -primary -block -lg" id="trip-confirm-return">Submit return ${icon('arrowRight', 16)}</button>`;
}
function wireTripReturn(el, trip) {
  const draft = APP.tripReturnDraft;
  const setQty = (pid, n) => {
    n = Math.max(0, n);
    draft.lines.find(l => l.p === pid).qty = n;
    $(`[data-ret-qty="${pid}"]`, el).textContent = n;
  };
  $$('[data-ret-inc]', el).forEach(b => b.onclick = () => setQty(b.dataset.retInc, draft.lines.find(l => l.p === b.dataset.retInc).qty + 1));
  $$('[data-ret-dec]', el).forEach(b => b.onclick = () => setQty(b.dataset.retDec, draft.lines.find(l => l.p === b.dataset.retDec).qty - 1));
  $('#trip-confirm-return', el).addEventListener('click', () => {
    trip.returned = draft.lines.map(l => ({ ...l }));
    trip.returned.forEach(l => {
      const expected = Math.max(0, trip.loaded.find(x => x.p === l.p).qty - tripSoldQty(l.p));
      const prod = P(l.p);
      prod.stock += l.qty;
      DB.stockMovements.unshift({ id:'sm' + Date.now() + l.p, item:prod.name, kind:'trip_return', qty:l.qty, time:'Just now', by:user().name });
      if (l.qty !== expected) logAudit('Trip return discrepancy', `${prod.name} · expected ${expected}, returned ${l.qty}`, 'trip');
    });
    trip.status = 'reconciled';
    APP.tripReturnDraft = null;
    logAudit('Recorded trip stock return', `${trip.returned.length} products returned to bakery stock`, 'trip');
    refresh();
    toast({ title:'Stock returned', text:'Ready for reconciliation' });
  });
}

function tripReconcileStep(trip) {
  if (APP.role !== 'driver') return '';
  return `
    <section class="card -recessed" style="margin-top:var(--s-2);text-align:center;padding:var(--s-6) var(--s-4)">
      <span class="itile -accent" style="width:44px;height:44px;border-radius:14px;margin:0 auto var(--s-4)">${icon('clock', 21)}</span>
      <h4 style="font-size:var(--t-title-3);font-weight:640">Reconciling</h4>
      <p class="label" style="margin-top:8px;line-height:1.5">A manager still needs to close this trip out and settle your cash into the till.</p>
    </section>`;
}

function tripDoneStep(trip) {
  return `<div class="confirm-panel" style="margin-top:var(--s-6)">
    <div class="cp-ring">${icon('check', 28, { stroke:2.4 })}</div>
    <h3>Trip completed</h3>
    <div class="cp-meta">Loaded ${trip.loadedAt} · returned stock reconciled</div>
  </div>`;
}

/* --------------------------------------------------- RECONCILE TRIP --- */
/* Supervisor, Manager or Owner can settle a trip — first to act closes it
   (trip.reconciledBy records who). Once completed, whoever DIDN'T do it sees
   a read-only review instead of the input form; Manager/Owner reviewing a
   Supervisor's reconciliation can flag it for correction, which reopens the
   trip for the Supervisor to redo. The till entry from the original settle
   is left as-is on reopen — cash gets fixed manually if it's actually wrong. */
const CORRECTION_REASONS = ['Cash mismatch', 'Stock miscount', 'Missing/incorrect variance note', 'Other'];
function tripReconcileRows(trip) {
  return trip.loaded.map(l => {
    const sold = tripSoldQty(l.p);
    const expected = Math.max(0, l.qty - sold);
    const actual = trip.returned.find(r => r.p === l.p)?.qty ?? 0;
    return { name:P(l.p).name, loaded:l.qty, sold, expected, actual, diff: actual - expected };
  });
}
SCREENS['trip-reconcile'] = {
  render() {
    if (!['manager', 'owner', 'supervisor'].includes(APP.role)) return `${appbar({ title:'Reconcile trip' })}<div class="errstate"><div class="er-ico">${icon('shield', 21)}</div><h4>Manager only</h4></div>`;
    const trip = DB.driverTrip;
    if (trip.status === 'completed') return tripReconcileReview(trip);
    if (trip.status !== 'reconciled') return `${appbar({ title:'Reconcile trip' })}<div class="errstate"><div class="er-ico">${icon('truck', 21)}</div><h4>No trip awaiting reconciliation</h4></div>`;
    const { totals, credit } = tripMoneyTotals();
    const heldByYou = Object.values(totals).reduce((s, v) => s + v, 0);
    const rows = tripReconcileRows(trip);
    const hasDiscrepancy = rows.some(r => r.diff !== 0);
    return `${appbar({ title:'Reconcile trip', sub:'Ifeanyi Eze · returned to bakery' })}
    <div class="body -with-dock">
      ${trip.correctionReason ? `<section class="card" style="margin-top:var(--s-2);border:1px solid var(--warning)">
        <div class="row"><span class="itile -sm -warn">${icon('alert', 16)}</span>
          <span class="li-main"><b>Sent back for correction</b><span>${esc(trip.correctionReason)}</span></span></div>
      </section>` : ''}
      <section class="section" style="margin-top:var(--s-2)">
        <div class="section-head"><h3>Inventory</h3></div>
        <div class="card">
          ${rows.map(r => `<div class="ledger"><div class="lg-row"><span class="op"></span>
            <span class="k">${r.name}<small>Loaded ${r.loaded} · sold ${r.sold}</small></span>
            <span class="v num" style="color:${r.diff === 0 ? 'inherit' : 'var(--error)'}">${r.actual} / ${r.expected}${r.diff !== 0 ? ` (${r.diff > 0 ? '+' : ''}${r.diff})` : ''}</span></div></div>`).join('')}
        </div>
      </section>
      <section class="section">
        <div class="section-head"><h3>Cash to settle into the till</h3></div>
        <div class="grid-3">
          ${['Cash', 'Transfer', 'POS'].map(m => `<div class="stat"><div class="s-top"><span class="k">${m}</span></div><div class="v num">${moneyShort(totals[m] || 0)}</div></div>`).join('')}
        </div>
        <div class="recap" style="margin-top:var(--s-3)"><div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(heldByYou)}</b></div></div>
        ${credit > 0 ? `<div class="card" style="margin-top:var(--s-3)"><div class="row"><span class="itile -sm -warn">${icon('cash', 16)}</span>
          <span class="li-main"><b>Customer credit created</b><span>Outstanding across today's sales</span></span>
          <b class="num" style="color:var(--warning)">${money(credit)}</b></div></div>` : ''}
      </section>
      ${hasDiscrepancy ? `<section class="section">
        <div class="section-head"><h3>Variance note</h3></div>
        <p class="label" style="margin-bottom:var(--s-3);line-height:1.5">Required — returned stock doesn't match what's expected.</p>
        <div class="field"><textarea class="f-ctl" id="tr-variance-note"></textarea></div>
      </section>` : ''}
    </div>
    <div class="dock">
      <button class="btn -primary -block -lg" id="tr-settle" ${hasDiscrepancy ? 'disabled' : ''}>Settle & complete trip ${icon('arrowRight', 16)}</button>
    </div>`;
  },
  mount(el) {
    const trip = DB.driverTrip;
    if (trip.status === 'completed') return mountTripReconcileReview(el, trip);
    if (trip.status !== 'reconciled' || !['manager', 'owner', 'supervisor'].includes(APP.role)) return;
    const note = $('#tr-variance-note', el);
    const btn = $('#tr-settle', el);
    note?.addEventListener('input', () => { btn.disabled = !note.value.trim(); });
    btn.addEventListener('click', () => {
      const { totals, credit } = tripMoneyTotals();
      const heldByYou = Object.values(totals).reduce((s, v) => s + v, 0);
      if (note && !note.value.trim()) return apiError('variance_note_required');
      const reopened = !!trip.correctionReason;
      if (!reopened) { DB.cash.tripCash.push({ k:'Trip cash settled', v:heldByYou, t:'Just now', kind:'in' }); }
      trip.status = 'completed';
      trip.reconciledBy = APP.role;
      trip.correctionReason = null;
      logAudit(reopened ? 'Re-reconciled driver trip after correction' : 'Reconciled & completed driver trip',
        `${money(heldByYou)} ${reopened ? 'reviewed, till entry unchanged' : 'settled into till'}${note?.value.trim() ? ` · "${note.value.trim()}"` : ''}${credit > 0 ? ` · ${money(credit)} credit created` : ''}`, 'trip');
      if (APP.role === 'supervisor') nav('operations', {}, 'tab'); else nav('cash', {}, 'tab');
      setTimeout(() => toast({ title:'Trip completed', text:`${money(heldByYou)} settled into the till` }), 260);
    });
  }
};

function tripReconcileReview(trip) {
  const { totals, credit } = tripMoneyTotals();
  const heldByYou = Object.values(totals).reduce((s, v) => s + v, 0);
  const rows = tripReconcileRows(trip);
  const canFlag = ['manager', 'owner'].includes(APP.role) && trip.reconciledBy !== APP.role;
  return `${appbar({ title:'Trip reconciliation', sub:`Reconciled by ${trip.reconciledBy === 'supervisor' ? 'Supervisor' : trip.reconciledBy === 'manager' ? 'Manager' : 'Owner'}` })}
  <div class="body ${canFlag ? '-with-dock' : ''}">
    <section class="card" style="margin-top:var(--s-2)">
      <div class="row"><span class="itile -sm -ok">${icon('checkCircle', 16)}</span>
        <span class="li-main"><b>Trip completed</b><span>${money(heldByYou)} settled into the till</span></span></div>
    </section>
    <section class="section">
      <div class="section-head"><h3>Inventory</h3></div>
      <div class="card">
        ${rows.map(r => `<div class="ledger"><div class="lg-row"><span class="op"></span>
          <span class="k">${r.name}<small>Loaded ${r.loaded} · sold ${r.sold}</small></span>
          <span class="v num" style="color:${r.diff === 0 ? 'inherit' : 'var(--error)'}">${r.actual} / ${r.expected}${r.diff !== 0 ? ` (${r.diff > 0 ? '+' : ''}${r.diff})` : ''}</span></div></div>`).join('')}
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h3>Cash settled</h3></div>
      <div class="grid-3">
        ${['Cash', 'Transfer', 'POS'].map(m => `<div class="stat"><div class="s-top"><span class="k">${m}</span></div><div class="v num">${moneyShort(totals[m] || 0)}</div></div>`).join('')}
      </div>
      <div class="recap" style="margin-top:var(--s-3)"><div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(heldByYou)}</b></div></div>
      ${credit > 0 ? `<div class="card" style="margin-top:var(--s-3)"><div class="row"><span class="itile -sm -warn">${icon('cash', 16)}</span>
        <span class="li-main"><b>Customer credit created</b><span>Outstanding across today's sales</span></span>
        <b class="num" style="color:var(--warning)">${money(credit)}</b></div></div>` : ''}
    </section>
  </div>
  ${canFlag ? `<div class="dock"><button class="btn -secondary -block -lg" id="tr-flag">${icon('alert', 17)} Flag for correction</button></div>` : ''}`;
}
function mountTripReconcileReview(el, trip) {
  $('#tr-flag', el)?.addEventListener('click', () => {
    sheet({
      title: 'Flag for correction',
      body: `<label class="field" style="margin-bottom:var(--s-4)"><span class="f-label">Reason</span>
          <select class="f-ctl" id="fc-reason">${CORRECTION_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}</select></label>
        <label class="field"><span class="f-label">Note <span class="meta">(optional)</span></span>
          <textarea class="f-ctl" id="fc-note"></textarea></label>`,
      foot: `<button class="btn -danger -block -lg" data-confirm-flag>Reopen for Supervisor</button>`,
      onMount(s) {
        $('[data-confirm-flag]', s).onclick = () => {
          const reason = $('#fc-reason', s).value, note = $('#fc-note', s).value.trim();
          trip.correctionReason = note ? `${reason} — "${note}"` : reason;
          trip.status = 'reconciled';
          trip.reconciledBy = null;
          logAudit('Flagged trip reconciliation for correction', trip.correctionReason, 'trip');
          closeSheet();
          setTimeout(() => { refresh(); toast({ title:'Sent back for correction', kind:'warn' }); }, 240);
        };
      }
    });
  });
}

/* ---------------------------------------------- SUPERVISOR: TRIP VERIFY --- */
/* verify_trip_loading() and reconcile_driver_trip() both name supervisor
   (SUPERVISOR-APP-SPEC.md §1, §4) — real authority with no screen until now. */
SCREENS['trip-verify'] = {
  render() {
    const trip = DB.driverTrip;
    const stage = trip.status;
    return `${appbar({ title:'Driver trip', sub: TRIP_STAGE[stage].label })}
    <div class="body">
      ${stage === 'created' || stage === 'loading' ? `
        <div class="empty" style="margin-top:var(--s-4)">
          <h4>Waiting for the driver</h4>
          <p>Ifeanyi hasn't logged today's load yet. Once they do, verify the quantities here before the trip departs.</p>
        </div>` : ''}
      ${stage === 'ready_to_depart' || stage === 'in_transit' ? `
        <section class="section" style="margin-top:var(--s-2)">
          <div class="section-head"><h3>Load verified</h3></div>
          <div class="list">
            ${(trip.loaded || []).map(l => `<div class="li"><span class="itile -sm -ok">${icon('checkCircle', 16)}</span>
              <span class="li-main"><b>${P(l.p).name}</b><span>${l.qty} units</span></span></div>`).join('')}
          </div>
          <p class="meta" style="margin-top:var(--s-3)">Verified by ${trip.verifiedBy} · loaded ${trip.loadedAt}</p>
        </section>` : ''}
      ${stage === 'returning' ? `
        <div class="empty" style="margin-top:var(--s-4)">
          <h4>Trip is on its way back</h4>
          <p>Ifeanyi is logging what's being returned to stock. Reconciliation opens once that's done.</p>
        </div>` : ''}
      ${stage === 'reconciled' ? `
        <section class="section" style="margin-top:var(--s-2)">
          <div class="section-head"><h3>Ready to reconcile</h3></div>
          <p class="label" style="margin-bottom:var(--s-3);line-height:1.5">Stock is back. Review what was sold against what returned, then settle the trip's cash.</p>
          <button class="btn -primary -block -lg" data-nav="trip-reconcile">Reconcile trip ${icon('arrowRight', 16)}</button>
        </section>` : ''}
      ${stage === 'completed' ? `
        <div class="empty" style="margin-top:var(--s-4)">
          <h4>Trip completed</h4>
          <p>Today's trip has been reconciled and settled.</p>
        </div>` : ''}
    </div>`;
  }
};
/* Delivery state machine (driver-relevant hops only):
     assigned --[start delivery]--> in_transit
     in_transit --[mark delivered, needs recipient/proof]--> delivered   [terminal]
     in_transit --[report failure, needs reason]--> failed
     failed --[return to bakery]--> returned                            [terminal]
   pending->assigned never appears here — a driver cannot self-assign a stop;
   dispatch is an owner/manager action, so every stop already arrives assigned. */
const STOP_META = {
  assigned:   { label:'Assigned',   badge:'-neutral', icon:'pin' },
  in_transit: { label:'In transit', badge:'-live',    icon:'truck' },
  delivered:  { label:'Delivered',  badge:'-ok',      icon:'check' },
  failed:     { label:'Failed',     badge:'-bad',     icon:'alert' },
  returned:   { label:'Returned',   badge:'-neutral', icon:'refresh' },
};

function startDelivery(r, btn) {
  if (r.status !== 'assigned') return apiError('invalid_transition');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  r.status = 'in_transit'; refresh();
  toast({ title:'Delivery started', text:`${r.cust} · ${r.area}` });
}
function returnToBakery(r, btn) {
  if (r.status !== 'failed') return apiError('invalid_transition');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  r.status = 'returned'; refresh();
  toast({ title:'Marked returned', text:`${r.cust} · goods back at the bakery` });
}
const FAIL_REASONS = ['Customer unavailable', 'Wrong address', 'Customer refused delivery', 'Unable to reach customer', 'Payment issue', 'Other'];
function deliverSheet(r) {
  if (r.status !== 'in_transit') return apiError('invalid_transition');
  const needsPayment = r.paid !== 'paid';
  const due = r.paid === 'partial' ? r.amount - r.amountPaid : r.amount;
  sheet({
    title: 'Confirm delivery',
    body: `<p class="meta" style="margin-bottom:var(--s-4)">${r.cust} · ${r.area} · ${money(r.amount)}</p>
      <label class="field"><span class="f-label">Recipient name</span>
        <input class="f-ctl" id="dlv-recipient" autocomplete="off"></label>
      <p class="f-hint">Required to confirm delivery — or attach a photo instead.</p>
      ${needsPayment ? `<div class="section" style="margin-top:var(--s-4);padding:0">
        <div class="section-head" style="padding:0"><h3>Payment to collect</h3></div>
        <div class="recap">
          <div class="r-line"><span>${r.paid === 'partial' ? 'Balance due' : 'Amount due'}</span><span class="spacer"></span><b>${money(due)}</b></div>
        </div>
        <div class="grid-3" style="margin-top:var(--s-3)">
          ${[['Cash','cash'],['Transfer','bank'],['POS','card']].map(([k, ic]) => `
            <button class="qa" data-dlv-method="${k}" aria-pressed="${r.method === k}" style="align-items:center">
              <span class="qa-ico ${r.method === k ? '-ink' : ''}">${icon(ic, 17)}</span><b>${k}</b></button>`).join('')}
        </div>
        <div id="dlv-cash-fields" style="margin-top:var(--s-3)"></div>
      </div>` : ''}`,
    foot: `<button class="btn -primary -block -lg" id="dlv-confirm" disabled>Confirm delivered</button>`,
    onMount(s) {
      const input = $('#dlv-recipient', s), btn = $('#dlv-confirm', s);
      let method = r.method, received = null;
      const cashFields = $('#dlv-cash-fields', s);
      const renderCash = () => {
        if (!cashFields) return;
        cashFields.innerHTML = method === 'Cash' ? `
          <div class="amount-input"><span class="cur">₦</span><input id="dlv-received" type="text" inputmode="numeric"></div>
          <p class="f-hint" id="dlv-change"></p>` : '';
        if (method === 'Cash') {
          const ri = $('#dlv-received', s);
          ri.oninput = () => {
            const n = +ri.value.replace(/[^\d]/g, '') || 0;
            ri.value = n ? n.toLocaleString() : '';
            received = n;
            $('#dlv-change', s).textContent = n >= due ? `Change: ${money(n - due)}` : `Still short by ${money(due - n)}`;
            checkValid();
          };
        }
      };
      const checkValid = () => {
        const okRecipient = input.value.trim();
        const okPayment = !needsPayment || (method && (method !== 'Cash' || received >= due));
        btn.disabled = !(okRecipient && okPayment);
      };
      input.oninput = checkValid;
      $$('[data-dlv-method]', s).forEach(b => b.onclick = () => {
        method = b.dataset.dlvMethod;
        $$('[data-dlv-method]', s).forEach(x => { x.setAttribute('aria-pressed', String(x === b)); $('.qa-ico', x).classList.toggle('-ink', x === b); });
        renderCash(); checkValid();
      });
      renderCash(); checkValid();
      btn.onclick = () => {
        if (btn.disabled) return;
        btn.disabled = true; btn.textContent = 'Saving…';
        r.recipient = input.value.trim(); r.status = 'delivered';
        if (needsPayment) { r.method = method; r.amountPaid = r.paid === 'partial' ? r.amountPaid + (received ?? due) : (received ?? due); r.paid = 'paid'; }
        closeSheet();
        setTimeout(() => { refresh(); toast({ title:'Marked delivered', text:`${r.cust} · ${money(r.amount)}` }); }, 240);
      };
    }
  });
}
function failSheet(r) {
  if (r.status !== 'in_transit') return apiError('invalid_transition');
  let reason = '';
  sheet({
    title: 'Report a problem',
    body: `<p class="meta" style="margin-bottom:var(--s-4)">${r.cust} · ${r.area} · ${money(r.amount)}</p>
      <div class="chips" id="dlv-reasons" style="flex-wrap:wrap">
        ${FAIL_REASONS.map(x => `<button class="chip" data-val="${x}">${x}</button>`).join('')}
      </div>
      <label class="field" id="dlv-note-wrap" style="margin-top:var(--s-4);display:none"><span class="f-label">Note</span>
        <textarea class="f-ctl" id="dlv-reason"></textarea></label>`,
    foot: `<button class="btn -danger -block -lg" id="dlv-fail-confirm" disabled>Report failure</button>`,
    onMount(s) {
      const btn = $('#dlv-fail-confirm', s), noteWrap = $('#dlv-note-wrap', s), note = $('#dlv-reason', s);
      $$('#dlv-reasons button', s).forEach(b => b.onclick = () => {
        reason = b.dataset.val;
        $$('#dlv-reasons button', s).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        noteWrap.style.display = reason === 'Other' ? 'block' : 'none';
        btn.disabled = reason === 'Other' ? !note.value.trim() : false;
      });
      note.oninput = () => { btn.disabled = !note.value.trim(); };
      btn.onclick = () => {
        if (btn.disabled) return;
        btn.disabled = true; btn.textContent = 'Saving…';
        r.failureReason = reason === 'Other' ? note.value.trim() : reason; r.status = 'failed';
        logAudit('Delivery marked failed', `${r.cust} · ${r.area} · "${r.failureReason}"`, 'delivery');
        closeSheet();
        setTimeout(() => { refresh(); toast({ title:'Delivery marked failed', text:r.cust, kind:'warn' }); }, 240);
      };
    }
  });
}

SCREENS.route = {
  tab: 'route',
  render() {
    const mine = DB.driverRoute.filter(r => r.driver === user().id);
    const done = mine.filter(r => r.status === 'delivered' || r.status === 'returned').length;
    const heldByYou = Object.values(tripMoneyTotals().totals).reduce((s, v) => s + v, 0);
    return `${appbar({ title:'Your route', back:false, sub:`${done} of ${mine.length} stops done`, right: syncChip() })}
    <div class="body -with-tabbar">
      <button class="card -tap" data-nav="trip" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:var(--s-4);margin-bottom:var(--s-4)">
        <span class="itile -accent">${icon('truck', 18)}</span>
        <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">Trip · ${TRIP_STAGE[DB.driverTrip.status].label}</b>
          <span class="label">Loading, departure, return and reconciliation</span></span>
        <span class="chev">${icon('chevRight', 17)}</span>
      </button>
      <section class="card -ink">
        <div class="row -top">
          <div style="flex:1">
            <div class="eyebrow" style="color:rgba(255,255,255,.5)">Held by you</div>
            <div class="hero-figure num" style="margin-top:6px">${money(heldByYou)}</div>
            <div class="label" style="margin-top:4px">Not in the till yet · settled when your trip is reconciled</div>
          </div>
          <span class="itile" style="background:rgba(255,255,255,.12);color:#fff;width:44px;height:44px;border-radius:14px">${icon('truck', 21)}</span>
        </div>
        <div class="track -accent" style="margin-top:var(--s-5);background:rgba(255,255,255,.14)">
          <i style="width:${mine.length ? done / mine.length * 100 : 0}%"></i></div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Stops</h3></div>
        <div class="stack-3">
          ${mine.map(r => { const m = STOP_META[r.status], terminal = r.status === 'delivered' || r.status === 'returned'; return `
            <div class="card" data-stop="${r.id}" style="${terminal ? 'opacity:.6' : r.status === 'in_transit' ? 'box-shadow:var(--e-2),inset 0 0 0 1.5px var(--apricot)' : ''}">
              <div class="row -top">
                <span class="itile ${m.badge === '-ok' ? '-ok' : m.badge === '-bad' ? '-bad' : m.badge === '-live' ? '-accent' : ''}">${icon(m.icon, 18)}</span>
                <div style="flex:1;min-width:0">
                  <div class="row" style="gap:8px"><b style="font-size:var(--t-callout);font-weight:600">${r.cust}</b>
                    <span class="badge ${m.badge}">${m.label}</span></div>
                  <span class="label">${r.address || r.area}</span>
                  ${r.instructions ? `<p class="meta" style="margin-top:5px">${esc(r.instructions)}</p>` : ''}
                  <p class="meta" style="margin-top:5px">${r.items}</p>
                  <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
                    <span class="badge -neutral">${r.createdBy === 'you' ? 'Created by you' : `Assigned by ${r.managerName || 'manager'}`}</span>
                    ${!terminal ? `<span class="badge ${r.paid === 'paid' ? '-ok' : '-warn'}">${r.paid === 'paid' ? 'Paid' : r.paid === 'partial' ? `Balance ${money(r.amount - r.amountPaid)}` : 'Collect on delivery'}</span>` : ''}
                  </div>
                  ${r.status === 'delivered' && r.recipient ? `<p class="meta" style="margin-top:5px">Received by ${esc(r.recipient)}</p>` : ''}
                  ${(r.status === 'failed' || r.status === 'returned') && r.failureReason ? `<p class="meta" style="margin-top:5px;color:var(--error)">${esc(r.failureReason)}</p>` : ''}
                </div>
                <span class="strong num" style="font-size:var(--t-callout)">${money(r.amount)}</span>
              </div>
              ${!terminal ? `<div class="grid-3" style="margin-top:var(--s-4)">
                <a class="btn -secondary -sm" href="tel:${r.phone.replace(/\s/g, '')}">${icon('phone', 15)} Call</a>
                ${r.status !== 'failed' ? `<button class="btn -secondary -sm" data-toast="Opening maps" data-toast-text="${r.address || r.area}">${icon('pin', 15)} Directions</button>` : '<span></span>'}
                ${r.status === 'assigned' ? `<button class="btn -primary -sm" data-start-delivery>${icon('truck', 15)} Start</button>` : ''}
                ${r.status === 'in_transit' ? `<button class="btn -primary -sm" data-mark-delivered>${icon('check', 15)} Delivered</button>` : ''}
                ${r.status === 'failed' ? `<button class="btn -primary -sm -block" data-return-bakery>${icon('refresh', 15)} Return to bakery</button>` : ''}
              </div>${r.status === 'in_transit' ? `<button class="btn -tertiary -block -sm" style="margin-top:var(--s-2);color:var(--error)" data-report-failure>${icon('alert', 15)} Report a problem</button>` : ''}` : ''}
            </div>`; }).join('')}
        </div>
      </section>
    </div>
    <button class="fab" data-nav="new-ticket">${icon('plus', 18)} New ticket</button>`;
  },
  mount(el) {
    $$('[data-stop]', el).forEach(card => {
      const r = DB.driverRoute.find(x => x.id === card.dataset.stop);
      $('[data-start-delivery]', card)?.addEventListener('click', e => startDelivery(r, e.currentTarget));
      $('[data-mark-delivered]', card)?.addEventListener('click', () => deliverSheet(r));
      $('[data-report-failure]', card)?.addEventListener('click', () => failSheet(r));
      $('[data-return-bakery]', card)?.addEventListener('click', e => returnToBakery(r, e.currentTarget));
    });
  }
};
