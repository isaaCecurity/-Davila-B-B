/* ==========================================================================
   BAKEFLOW — Products, customers, staff, settings, design system, states
   ========================================================================== */

/* -------------------------------------------------------------- PRODUCTS --- */
SCREENS.products = {
  render(p) {
    const cat = p.cat || 'All';
    const q = (p.q || '').trim();
    let rows = DB.products.filter(x => cat === 'All' || x.cat === cat);
    if (q) rows = rows.filter(x => x.name.toLowerCase().includes(q.toLowerCase()));
    const low = DB.products.filter(x => x.stock <= 9).length;

    return `${appbar({ title:'Products', sub:`${DB.products.length} items · ${low} need restocking`,
      right:`<button class="iconbtn -tinted" data-toast="New product" data-toast-text="Name, price and category" aria-label="Add product">${icon('plus', 20)}</button>` })}
    <div class="body -flush">
      <div class="flush-pad">
        <div class="searchbar"><input id="pr-q" value="${esc(q)}">
          ${icon('search', 17)}</div>
      </div>
      <div class="chips" data-chipgroup id="pr-chips" style="margin:var(--s-3) 0 var(--s-4)">
        ${DB.productCats.map(c => `<button class="chip" data-val="${c}" aria-pressed="${c === cat}">${c}</button>`).join('')}
      </div>
      <div class="flush-pad">
        ${rows.length ? `<div class="list">
          ${rows.map(x => `<button class="prow" data-nav="product-detail" data-nav-params='{"id":"${x.id}"}'>
            <span class="p-thumb"><span class="p-mono">${x.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
              ${x.stock === 0 ? `<i style="position:absolute;inset:0;background:rgba(201,92,84,.14);border-radius:inherit"></i>` : ''}</span>
            <span class="p-main"><b>${x.name}</b>
              <span>${x.cat} · ${x.stock === 0 ? 'Out of stock' : `${x.stock} ${x.unit}${x.stock === 1 ? '' : 's'} left`}
                · ${(100 - x.cost / x.price * 100).toFixed(0)}% margin</span></span>
            <span class="p-price num">${money(x.price)}</span>
            ${x.stock === 0 ? `<span class="badge -bad" style="margin-left:8px">${icon('alert', 11)}Out</span>`
              : x.stock <= 9 ? `<span class="badge -pending" style="margin-left:8px">${icon('alert', 11)}Low</span>`
              : `<span class="chev" style="margin-left:8px">${icon('chevRight', 17)}</span>`}
          </button>`).join('')}
        </div>` : `<div class="empty">
          <div class="e-art">${icon('box', 34, { stroke:1.4 })}</div>
          <h4>No product matches</h4><p>Try another name, or clear the category filter.</p>
        </div>`}
      </div>
    </div>`;
  },
  mount(el, p) {
    $('#pr-chips', el).addEventListener('chipchange', e => nav('products', { cat: e.detail, q: p.q }, 'replace'));
    const q = $('#pr-q', el);
    let t;
    q.oninput = () => { clearTimeout(t); t = setTimeout(() =>
      nav('products', { cat: p.cat, q: q.value }, 'replace'), 220); };
  }
};

SCREENS['product-detail'] = {
  render({ id }) {
    const p = P(id), margin = (1 - p.cost / p.price) * 100;
    const profit = p.price - p.cost;
    return `${appbar({ title:p.name, sub:`${p.cat} · per ${p.unit}`,
      right:`<button class="iconbtn -tinted" data-toast="Edit product" aria-label="Edit">${icon('edit', 18)}</button>` })}
    <div class="body">
      <section class="hero-panel" style="padding-bottom:var(--s-5)">
        <div class="hp-top"><div style="flex:1">
          <div class="hp-label">Selling price</div>
          <div class="hero-figure num" style="margin-top:6px">${money(p.price)}</div>
          <div class="hp-sub">Costs you ${money(p.cost)} to make</div>
        </div>
        <span class="delta -on-dark">${margin.toFixed(0)}% margin</span></div>
        <div class="hp-foot">
          <div><div class="v num">${money(profit)}</div><div class="k">Profit per ${p.unit}</div></div>
          <div class="hp-divider"></div>
          <div><div class="v num">${p.sold}</div><div class="k">Sold this month</div></div>
          <div class="hp-divider"></div>
          <div><div class="v num">${moneyShort(p.revenue)}</div><div class="k">Revenue</div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Stock</h3></div>
        <div class="card">
          <div class="row">
            <span class="itile ${p.stock === 0 ? '-bad' : p.stock <= 9 ? '-warn' : '-ok'}">
              ${icon(p.stock === 0 ? 'alert' : 'box', 18)}</span>
            <div style="flex:1">
              <div class="mid-figure num">${p.stock} ${p.unit}${p.stock === 1 ? '' : 's'}</div>
              <div class="label">${p.stock === 0 ? 'Out of stock — sold out today' : p.stock <= 9 ? 'Below your reorder level' : 'Comfortable'}</div>
            </div>
            <button class="btn -sm -secondary" data-toast="Stock updated">Adjust</button>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Bakery pricing</h3></div>
        <div class="card">
          <div class="ledger">
            <div class="lg-row"><span class="op"></span><span class="k">Standard price</span><span class="v num">${money(p.price)}</span></div>
            <div class="lg-row"><span class="op"></span><span class="k">Wholesale<small>10+ units</small></span><span class="v num">${money(Math.round(p.price * 0.88 / 50) * 50)}</span></div>
            <div class="lg-row"><span class="op"></span><span class="k">Contract<small>Hotels and offices</small></span><span class="v num">${money(Math.round(p.price * 0.82 / 50) * 50)}</span></div>
            <div class="lg-rule"></div>
            <div class="lg-row"><span class="op"></span><span class="k">Cost to make</span><span class="v num" style="color:var(--warm-gray)">${money(p.cost)}</span></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Last 7 days</h3></div>
        <div class="chartcard">
          <div class="cc-plot">
            ${barChart({ series: DB.week.map((d, i) => ({ v: Math.round(p.sold / 7 * (0.75 + (i % 3) * 0.22)), d:d.d })),
              h:104, activeIndex:5, aria:`Units of ${p.name} sold per day` })}
          </div>
          ${xAxis(DB.week.map(d => d.d), 5)}
        </div>
      </section>

      <section class="section">
        <div class="grid-2">
          <button class="btn -onwhite" data-nav="new-ticket">${icon('plus', 17)} Sell now</button>
          <button class="btn -onwhite" data-toast="Marked unavailable">${icon('close', 17)} Unavailable</button>
        </div>
      </section>
    </div>`;
  }
};

/* ------------------------------------------------------------- CUSTOMERS --- */
SCREENS.customers = {
  render(p) {
    const q = (p.q || '').trim();
    let rows = DB.customers.slice().sort((a, b) => b.spent - a.spent);
    if (q) rows = rows.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));
    return `${appbar({ title:'Customers', sub:`${DB.customers.length} customers · ${moneyShort(DB.customers.reduce((s, c) => s + c.spent, 0))} lifetime`,
      right:`<button class="iconbtn -tinted" data-toast="New customer" aria-label="Add customer">${icon('plus', 20)}</button>` })}
    <div class="body">
      <div class="searchbar" style="margin-bottom:var(--s-4)">${icon('search', 17)}
        <input id="cu-q" value="${esc(q)}"></div>
      ${rows.length ? `<div class="list">
        ${rows.map(c => `<button class="li" data-nav="customer" data-nav-params='{"id":"${c.id}"}'>
          <span class="avatar -${c.tone}">${c.init}</span>
          <span class="li-main"><b>${c.name}</b><span>${c.type} · ${c.orders} orders · last ${c.last.toLowerCase()}</span></span>
          <span class="li-end"><b class="num">${moneyShort(c.spent)}</b><span>lifetime</span></span>
        </button>`).join('')}
      </div>` : `<div class="empty">
        <div class="e-art">${icon('users', 34, { stroke:1.4 })}</div>
        <h4>No customer found</h4><p>Try a different name, or add “${esc(q)}” as a new customer.</p>
        <div class="e-act"><button class="btn -primary" data-toast="New customer">${icon('plus', 17)} Add customer</button></div>
      </div>`}
    </div>`;
  },
  mount(el) {
    const q = $('#cu-q', el); let t;
    q.oninput = () => { clearTimeout(t); t = setTimeout(() => nav('customers', { q: q.value }, 'replace'), 200); };
  }
};

SCREENS.customer = {
  render({ id }) {
    const c = C(id);
    const theirs = DB.orders.filter(o => o.cust === id);
    return `${appbar({ title:c.name, sub:`${c.type} · ${c.area}`,
      right:`<button class="iconbtn -tinted" data-toast="Calling ${c.name}" data-toast-text="${c.phone}" aria-label="Call">${icon('phone', 18)}</button>` })}
    <div class="body">
      <section class="card">
        <div class="row">
          <span class="avatar -lg -${c.tone}">${c.init}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:var(--t-title-3);font-weight:640;letter-spacing:-.018em">${c.name}</div>
            <div class="label">${c.phone}</div>
          </div>
        </div>
        <div class="row" style="margin-top:var(--s-5);padding-top:var(--s-4);border-top:1px solid var(--border)">
          <div style="flex:1"><div class="mid-figure num">${moneyShort(c.spent)}</div><div class="label">Lifetime spend</div></div>
          <div style="flex:1"><div class="mid-figure num">${c.orders}</div><div class="label">Orders</div></div>
          <div style="flex:1"><div class="mid-figure num">${moneyShort(Math.round(c.spent / c.orders))}</div><div class="label">Average</div></div>
        </div>
      </section>

      ${c.credit ? `<section class="card -ink" style="margin-top:var(--s-4)">
        <div class="row -top">
          <div style="flex:1">
            <div class="eyebrow" style="color:rgba(255,255,255,.5)">Outstanding credit</div>
            <div class="hero-figure num" style="margin-top:6px">${money(c.credit)}</div>
          </div>
          <span class="itile" style="background:rgba(255,255,255,.12);color:#fff;width:44px;height:44px;border-radius:14px">${icon('cash', 21)}</span>
        </div>
      </section>` : ''}

      <section class="section">
        <div class="grid-2">
          <button class="btn -primary" data-nav="new-ticket">${icon('plus', 17)} New order</button>
          <button class="btn -onwhite" data-toast="Statement sent" data-toast-text="${c.phone}">${icon('share', 17)} Statement</button>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Orders</h3><div class="spacer"></div><span class="meta">${theirs.length} shown</span></div>
        ${theirs.length ? `<div class="stack-3">${theirs.map(o => orderCard(o)).join('')}</div>`
        : `<div class="card -recessed" style="text-align:center;padding:var(--s-6)">
            <p class="label">No orders in this period.</p></div>`}
      </section>

      ${c.ledger && c.ledger.length ? `<section class="section">
        <div class="section-head"><h3>Credit ledger</h3></div>
        <div class="list">
          ${c.ledger.map(l => `<div class="li">
            <span class="itile -sm ${l.credit > 0 ? '-warn' : '-ok'}">${icon('cash', 16)}</span>
            <span class="li-main"><b>${l.ref}</b><span>${l.method} · ${money(l.paid)} of ${money(l.sale)} · ${l.time}</span></span>
            <span class="li-end"><b style="color:${l.credit > 0 ? 'var(--warning)' : 'var(--success)'}">${l.credit > 0 ? money(l.credit) : 'Settled'}</b></span>
          </div>`).join('')}
        </div>
      </section>` : ''}

      <section class="section">
        <div class="section-head"><h3>What they buy</h3></div>
        <div class="card">
          ${['p9','p5','p11'].map((pid, i) => { const p = P(pid);
            return `<div class="hbar"><span class="hb-k">${p.name}</span>
              <span class="hb-track"><i style="width:${[88, 62, 34][i]}%;background:${i === 0 ? 'var(--apricot)' : 'var(--cocoa)'}"></i></span>
              <span class="hb-v">${moneyShort(p.price * [46, 28, 22][i])}</span></div>`;
          }).join('')}
        </div>
      </section>
    </div>`;
  }
};

/* ------------------------------------------------------------ STAFF/ACTIVITY --- */
SCREENS.staff = {
  tab: 'staffmon',
  render() {
    const staffRows = APP.role === 'owner' ? DB.staffList.filter(s => branchMatch(s.branch)) : DB.staffList;
    const onShift = staffRows.filter(s => s.status !== 'Off shift');
    const canInvite = ['owner', 'manager'].includes(APP.role);
    return `${appbar({ title:'Staff & activity', back: !ROLE_TABS[APP.role].includes('staffmon'), sub:`${onShift.length} of ${staffRows.length} on shift`,
      right: canInvite ? `<button class="iconbtn -tinted" data-invite-staff aria-label="Invite staff">${icon('plus', 20)}</button>` : '' })}
    <div class="body">
      <section class="section" style="margin-top:var(--s-2)">
        <div class="section-head"><h3>On shift now</h3></div>
        <div class="searchbar" style="margin-bottom:var(--s-3)"><input id="staff-q" placeholder="Find staff">${icon('search', 17)}</div>
        <div class="list" id="staff-list">
          ${staffRows.map(s => `<button class="li" data-staff="${s.id}" data-q="${s.name.toLowerCase()} ${s.role.toLowerCase()}">
            <span class="avatar -${s.tone}" style="position:relative">${s.init}
              ${s.status !== 'Off shift' ? `<i class="dot -ok" style="position:absolute;right:-1px;bottom:-1px;box-shadow:0 0 0 2px #fff"></i>` : ''}</span>
            <span class="li-main"><b>${s.name}</b><span>${s.role} · ${s.branch} · ${s.status.toLowerCase()} ${s.since.toLowerCase()}</span></span>
            ${s.role === 'Supervisor' && !APP.org.supervisorEnabled ? `<span class="badge -bad" style="margin-right:8px">${icon('alert', 11)}Needs reassignment</span>` : ''}
            <span class="li-end"><b class="num">${s.today.sales ? moneyShort(s.today.sales) : '—'}</b>
              <span>${s.today.orders} orders</span></span>
          </button>`).join('')}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Today's activity</h3><div class="spacer"></div><span class="meta">Newest first</span></div>
        <div class="card">
          <div class="timeline">
            ${DB.activity.map(a => `<div class="tl-item ${a.kind === 'ok' ? '-done' : a.kind === 'pending' ? '-current' : ''}">
              <span class="tl-node">${a.kind === 'ok' ? icon('check', 11, { stroke:2.6 }) : '<i></i>'}</span>
              <b>${a.who} ${a.what}</b><span>${a.t}${a.kind === 'pending' ? ' · waiting to sync' : ''}</span>
            </div>`).join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Sales by staff · today</h3></div>
        <div class="card">
          ${staffRows.filter(s => s.today.sales).sort((a, b) => b.today.sales - a.today.sales).map((s, i) => `
            <div class="hbar"><span class="hb-k">${s.name.split(' ')[0]}</span>
              <span class="hb-track"><i style="width:${s.today.sales / 186500 * 100}%;background:${i === 0 ? 'var(--apricot)' : 'var(--cocoa)'}"></i></span>
              <span class="hb-v">${moneyShort(s.today.sales)}</span></div>`).join('')}
        </div>
      </section>

      ${canInvite ? `<section class="section">
        <button class="li" data-nav="invites" style="width:100%;text-align:left">
          <span class="itile -sm">${icon('mail', 16)}</span>
          <span class="li-main"><b>Invites</b><span>${DB.invites.filter(iv => iv.status === 'pending').length} pending</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>
      </section>` : ''}
    </div>`;
  },
  mount(el) {
    $('[data-invite-staff]', el)?.addEventListener('click', () => inviteStaffSheet());
    $('#staff-q', el).oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$('#staff-list [data-staff]', el).forEach(row => row.style.display = row.dataset.q.includes(q) ? '' : 'none');
    };
    $$('[data-staff]', el).forEach(b => b.onclick = () => {
      const s = DB.staffList.find(x => x.id === b.dataset.staff);
      sheet({
        title: s.name,
        body: `<div class="row" style="margin-bottom:var(--s-5)">
            <span class="avatar -lg -${s.tone}">${s.init}</span>
            <div style="flex:1"><b style="display:block;font-size:var(--t-callout);font-weight:620">${s.role}</b>
              <span class="label">${s.branch} branch · ${s.status} ${s.since.toLowerCase()}</span></div></div>
          <div class="grid-2">
            <div class="stat"><div class="s-top"><span class="k">Sales today</span></div>
              <div class="v num">${s.today.sales ? moneyShort(s.today.sales) : '—'}</div></div>
            <div class="stat"><div class="s-top"><span class="k">Orders</span></div>
              <div class="v num">${s.today.orders}</div></div>
          </div>
          ${APP.role !== 'supervisor' ? `<div class="group-label"><span class="eyebrow">Permissions</span><i>Set by role</i></div>
          <div class="list">
            ${[['Take orders', true], ['Record sales', true], ['Add expenses', s.role !== 'Counter Staff'],
               ['See revenue and profit', s.role === 'Branch Manager'], ['Manage staff', false]]
              .map(([k, on]) => `<div class="li"><span class="li-main"><b>${k}</b></span>
                <span class="switch -readonly" aria-checked="${on}" aria-disabled="true" aria-label="${k}, ${on ? 'on' : 'off'}, set by role"><i></i></span></div>`).join('')}
          </div>
          <p class="meta" style="margin-top:8px;line-height:1.5">Per-person overrides aren't supported yet — permissions follow ${s.name.split(' ')[0]}'s role.</p>` : ''}`,
        foot: `<button class="btn -primary -block" data-close-sheet>Done</button>`
      });
    });
  }
};

/* --------------------------------------------------------------- INVITES --- */
SCREENS.invites = {
  render() {
    return `${appbar({ title:'Invites', sub:`${DB.invites.length} total`,
      right:`<button class="iconbtn -tinted" data-invite-staff aria-label="Invite staff">${icon('plus', 20)}</button>` })}
    <div class="body">
      <section class="section" style="margin-top:var(--s-2)">
        <div class="list">
          ${DB.invites.length ? DB.invites.map(iv => `<div class="li" data-invite="${iv.id}">
            <span class="itile -sm ${iv.status === 'accepted' ? '-ok' : iv.status === 'expired' ? '-bad' : '-warn'}">${icon(iv.status === 'accepted' ? 'checkCircle' : iv.status === 'expired' ? 'alert' : 'clock', 16)}</span>
            <span class="li-main"><b>${iv.email}</b><span>${iv.role} · sent ${iv.sentAt}</span></span>
            <span class="badge ${iv.status === 'accepted' ? '-ok' : iv.status === 'expired' ? '-bad' : '-warn'}">${iv.status}</span>
          </div>`).join('') : `<div class="empty" style="margin-top:var(--s-4)"><h4>No invites sent yet</h4><p>Tap the + button to invite someone to join the branch.</p></div>`}
        </div>
      </section>
    </div>`;
  },
  mount(el) {
    $('[data-invite-staff]', el)?.addEventListener('click', () => inviteStaffSheet());
    $$('[data-invite]', el).forEach(row => row.onclick = () => {
      const iv = DB.invites.find(x => x.id === row.dataset.invite);
      inviteActionsSheet(iv);
    });
  }
};

function inviteStaffSheet() {
  const ROLES = ['Counter Staff', 'Baker', 'Delivery', 'Supervisor', 'Branch Manager'];
  sheet({
    title: 'Invite staff',
    body: `<label class="field" style="margin-bottom:var(--s-4)"><span class="f-label">Email</span>
        <input class="f-ctl" id="iv-email" type="email" placeholder="name@example.com"></label>
      <label class="field"><span class="f-label">Role</span>
        <select class="f-ctl" id="iv-role">${ROLES.map(r => `<option value="${r}">${r}</option>`).join('')}</select></label>`,
    foot: `<button class="btn -primary -block -lg" data-send-invite disabled>Send invite</button>`,
    onMount(s) {
      const email = $('#iv-email', s), btn = $('[data-send-invite]', s);
      const valid = () => /\S+@\S+\.\S+/.test(email.value.trim());
      email.oninput = () => { btn.disabled = !valid(); };
      btn.onclick = () => {
        if (!valid()) return;
        DB.invites.unshift({ id:'iv' + Date.now(), email: email.value.trim(), role: $('#iv-role', s).value, status:'pending', sentAt:'Just now' });
        closeSheet();
        setTimeout(() => { refresh(); toast({ title:'Invite sent', text: email.value.trim() }); }, 240);
      };
    }
  });
}

function inviteActionsSheet(iv) {
  sheet({
    title: iv.email,
    body: `<p class="meta" style="margin-bottom:var(--s-4)">${iv.role} · sent ${iv.sentAt} · <b>${iv.status}</b></p>
      <div class="menu">
        ${iv.status !== 'accepted' ? menuItem({ icon:'doc', title:'Copy invite link', sub:'Share it directly' }) : ''}
        ${iv.status === 'pending' ? menuItem({ icon:'history', title:'Resend invite', sub:'Refresh the expiry' }) : ''}
        ${iv.status === 'expired' ? menuItem({ icon:'history', title:'Resend invite', sub:'Send a new link' }) : ''}
      </div>
      ${iv.status !== 'accepted' ? `<button class="btn -danger -block" style="margin-top:var(--s-4)" data-revoke-invite>Revoke invite</button>` : ''}`,
    foot: `<button class="btn -secondary -block" data-close>Close</button>`,
    onMount(s) {
      $$('.menu-item', s).forEach(item => item.onclick = () => {
        const label = item.querySelector('b')?.textContent || '';
        if (label.includes('Copy')) { closeSheet(); setTimeout(() => toast({ title:'Link copied' }), 240); }
        if (label.includes('Resend')) { iv.status = 'pending'; iv.sentAt = 'Just now'; closeSheet(); setTimeout(() => { refresh(); toast({ title:'Invite resent' }); }, 240); }
      });
      $('[data-revoke-invite]', s)?.addEventListener('click', () => {
        DB.invites = DB.invites.filter(x => x.id !== iv.id);
        closeSheet();
        setTimeout(() => { refresh(); toast({ title:'Invite revoked', kind:'warn' }); }, 240);
      });
    }
  });
}

/* ============================================== SUPERVISOR: OPERATIONS === */
/* Monitoring, not managing — no edit affordances live here. Each hub tile
   opens a read-mostly view; the only writes are things Supervisor is
   explicitly allowed (none, in this build). */
SCREENS.operations = {
  tab: 'operations',
  render() {
    const salesTotal = DB.mySales.reduce((s, x) => s + x.total, 0);
    const lowStock = DB.products.filter(p => p.stock <= 9);
    const activeBatches = DB.productionBatches.filter(b => b.status === 'in_progress');
    const activeDeliveries = DB.driverRoute.filter(r => r.status === 'in_transit' || r.status === 'assigned');
    const tripLabel = TRIP_STAGE[DB.driverTrip.status].label;
    const tiles = [
      { nav:'sales-monitor',      icon:'sales', tone:'-ok',     t:'Sales',      s:`${money(salesTotal)} · ${DB.mySales.length} sales` },
      { nav:'inventory-monitor',  icon:'box',   tone: lowStock.length ? '-warn' : '',     t:'Inventory',  s:`${lowStock.length} product${lowStock.length === 1 ? '' : 's'} low or out` },
      { nav:'production-monitor',icon:'flame', tone:'-accent', t:'Production', s:`${activeBatches.length} batch${activeBatches.length === 1 ? '' : 'es'} running` },
      { nav:'delivery-monitor',  icon:'truck', tone:'-info',   t:'Delivery',   s:`${activeDeliveries.length} active` },
      { nav:'expenses',          icon:'receipt', tone:'',      t:'Expenses',   s:'Record a non-cash expense' },
      { nav:'supervisor-reports',icon:'doc',   tone:'',        t:'Reports',    s:'Sales, payments and staff' },
      { nav:'trip-verify',       icon:'truck', tone:'',        t:'Driver trip', s:tripLabel },
    ];
    return `${appbar({ title:'Operations', back:false, sub:APP.org.name })}
    <div class="body -with-tabbar">
      <div class="stack-3">
        ${tiles.map(x => `<button class="card -tap" data-nav="${x.nav}" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;padding:var(--s-4)">
          <span class="itile ${x.tone}">${icon(x.icon, 19)}</span>
          <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">${x.t}</b>
            <span class="label">${x.s}</span></span>
          <span class="chev">${icon('chevRight', 18)}</span>
        </button>`).join('')}
      </div>
    </div>`;
  }
};

/* --------------------------------------------------- SALES MONITORING --- */
SCREENS['sales-monitor'] = {
  render(p) {
    const method = p?.method || 'All';
    let rows = DB.mySales;
    if (method !== 'All') rows = rows.filter(s => s.method === method);
    const total = DB.mySales.reduce((s, x) => s + x.total, 0);
    const byMethod = ['Cash', 'Transfer', 'POS'].map(m => ({ m, total: DB.mySales.filter(s => s.method === m).reduce((s, x) => s + x.total, 0) }));

    return `${appbar({ title:'Sales monitoring', sub:`Today · ${money(total)} · ${DB.mySales.length} sales` })}
    <div class="body">
      <section class="section" style="margin-top:var(--s-2)">
        <div class="section-head"><h3>By salesperson</h3></div>
        <div class="card">
          ${DB.salesBySalesperson.map((s, i) => `
            <div class="hbar"><span class="hb-k">${s.staff.split(' ')[0]}</span>
              <span class="hb-track"><i style="width:${s.total / total * 100}%;background:${i === 0 ? 'var(--apricot)' : 'var(--cocoa)'}"></i></span>
              <span class="hb-v">${moneyShort(s.total)}</span></div>`).join('')}
        </div>
      </section>
      <section class="section">
        <div class="section-head"><h3>By payment method</h3></div>
        <div class="grid-3">
          ${byMethod.map(x => `<div class="stat"><div class="s-top"><span class="k">${x.m}</span></div>
            <div class="v num">${moneyShort(x.total)}</div></div>`).join('')}
        </div>
      </section>
      <section class="section">
        <div class="section-head"><h3>Recent transactions</h3></div>
        <div class="chips" data-chipgroup id="sm-methods" style="margin-bottom:var(--s-3)">
          ${['All', 'Cash', 'Transfer', 'POS'].map(m => `<button class="chip" data-val="${m}" aria-pressed="${m === method}">${m}</button>`).join('')}
        </div>
        <div class="list">
          ${rows.map(s => `<div class="li"><span class="itile -sm">${icon('receipt', 16)}</span>
            <span class="li-main"><b>${s.ref}</b><span>${s.cust} · ${s.time}</span></span>
            <span class="li-end"><b>${money(s.total)}</b><span>${s.method}</span></span></div>`).join('')}
        </div>
      </section>
    </div>`;
  },
  mount(el, p) {
    $('#sm-methods', el).addEventListener('chipchange', e => nav('sales-monitor', { method: e.detail }, 'replace'));
  }
};

/* ----------------------------------------------- INVENTORY MONITORING --- */
SCREENS['inventory-monitor'] = {
  render() {
    const low = DB.products.filter(p => p.stock > 0 && p.stock <= 9);
    const out = DB.products.filter(p => p.stock === 0);
    return `${appbar({ title:'Inventory monitoring', sub:`${DB.products.length} products · ${out.length} out of stock` })}
    <div class="body">
      ${out.length ? `<section class="section" style="margin-top:var(--s-2)">
        <div class="section-head"><h3>Out of stock</h3></div>
        <div class="list">
          ${out.map(p => `<div class="li"><span class="itile -sm -bad">${icon('box', 16)}</span>
            <span class="li-main"><b>${p.name}</b><span>${p.cat}</span></span>
            <span class="badge -bad">${icon('alert', 11)}Out</span></div>`).join('')}
        </div>
      </section>` : ''}
      <section class="section">
        <div class="section-head"><h3>Running low</h3></div>
        <div class="list">
          ${low.map(p => `<div class="li"><span class="itile -sm -warn">${icon('box', 16)}</span>
            <span class="li-main"><b>${p.name}</b><span>${p.cat} · ${p.stock} ${p.unit}${p.stock === 1 ? '' : 's'} left</span></span>
            <span class="badge -pending">${icon('alert', 11)}Low</span></div>`).join('')}
        </div>
      </section>
      <section class="section">
        <div class="section-head"><h3>Recent stock movements</h3></div>
        <div class="list">
          ${DB.stockMovements.filter(m => DB.products.some(p => p.name === m.item)).map(m => `<div class="li">
            <span class="itile -sm ${m.qty > 0 ? '-ok' : ''}">${icon(m.qty > 0 ? 'arrowDown' : 'arrowUp', 15)}</span>
            <span class="li-main"><b>${m.item}</b><span>${m.kind.replace('_', ' ')} · ${m.by} · ${m.time}</span></span>
            <span class="li-end"><b class="${m.qty > 0 ? 'pos' : 'neg'}">${m.qty > 0 ? '+' : ''}${m.qty}</b></span>
          </div>`).join('')}
        </div>
        <p class="meta" style="margin-top:var(--s-3);line-height:1.5">Stock changes only through sales, production or an adjustment — never edited directly.</p>
      </section>
    </div>`;
  }
};

/* ---------------------------------------------- PRODUCTION MONITORING --- */
SCREENS['production-monitor'] = {
  render() {
    const groups = [
      { k:'in_progress', label:'In progress', tone:'-accent' },
      { k:'scheduled',   label:'Scheduled',    tone:'' },
      { k:'completed',   label:'Completed',    tone:'-ok' },
      { k:'failed',      label:'Failed',       tone:'-bad' },
    ];
    return `${appbar({ title:'Production monitoring', sub:`${DB.productionBatches.length} batches today` })}
    <div class="body">
      ${groups.map(g => { const rows = DB.productionBatches.filter(b => b.status === g.k); if (!rows.length) return ''; return `
        <section class="section" style="margin-top:var(--s-2)">
          <div class="section-head"><h3>${g.label}</h3></div>
          <div class="list">
            ${rows.map(b => `<div class="li"><span class="itile -sm ${g.tone}">${icon('flame', 16)}</span>
              <span class="li-main"><b>${b.product}</b><span>${b.qty} units · ${b.baker}${b.started ? ' · started ' + b.started : ''}</span></span>
              ${b.reason ? `<span class="badge -bad">${icon('alert', 11)}Issue</span>` : ''}
            </div>${b.reason ? `<p class="meta" style="padding:0 var(--s-4) var(--s-3)">${b.reason}</p>` : ''}`).join('')}
          </div>
        </section>`; }).join('')}
    </div>`;
  }
};

/* ------------------------------------------------- DELIVERY MONITORING --- */
SCREENS['delivery-monitor'] = {
  render() {
    const driverIds = DB.staffList.filter(s => s.role === 'Delivery').map(s => s.id);
    const drivers = driverIds.map(id => {
      const u = U(id);
      const stops = DB.driverRoute.filter(r => r.driver === id);
      const active = stops.filter(r => r.status === 'in_transit' || r.status === 'assigned').length;
      const failed = stops.filter(r => r.status === 'failed').length;
      return { u, stops, active, failed };
    });
    return `${appbar({ title:'Delivery', sub:`${DB.driverRoute.length} stops today` })}
    <div class="body">
      <section class="section" style="margin-top:var(--s-2)">
        <div class="section-head"><h3>Drivers</h3></div>
        <div class="list">
          ${drivers.map(d => `<div class="li" data-nav="driver-detail" data-nav-params='{"id":"${d.u.id}"}' style="cursor:pointer">
            <span class="avatar -${d.u.tone}">${d.u.init}</span>
            <span class="li-main"><b>${d.u.name}</b><span>${d.stops.length} stop${d.stops.length === 1 ? '' : 's'} today${d.failed ? ` · ${d.failed} problem${d.failed === 1 ? '' : 's'}` : ''}</span></span>
            ${d.active ? `<span class="badge -accent">${d.active} active</span>` : ''}
            <span class="chev">${icon('chevRight', 17)}</span>
          </div>`).join('')}
        </div>
      </section>
    </div>`;
  }
};

/* --------------------------------------------------------- DRIVER DETAIL --- */
SCREENS['driver-detail'] = {
  render(p) {
    const u = U(p?.id);
    const groups = [
      { k:'in_transit', label:'Active',     tone:'-accent' },
      { k:'assigned',   label:'Pending',    tone:'' },
      { k:'delivered',  label:'Completed',  tone:'-ok' },
      { k:'failed',     label:'Problems',   tone:'-bad' },
      { k:'returned',   label:'Returned',   tone:'' },
    ];
    const stops = DB.driverRoute.filter(r => r.driver === u.id);
    return `${appbar({ title: u.name, sub:`${stops.length} stops today` })}
    <div class="body">
      <section class="card" style="display:flex;align-items:center;gap:13px">
        <span class="avatar -lg -${u.tone}">${u.init}</span>
        <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">${u.name}</b>
          <span class="label">${u.title || 'Delivery / Field'}</span></span>
      </section>
      ${groups.map(g => { const rows = stops.filter(r => r.status === g.k); if (!rows.length) return ''; return `
        <section class="section" style="margin-top:var(--s-2)">
          <div class="section-head"><h3>${g.label}</h3></div>
          <div class="list">
            ${rows.map(r => `<div class="li"><span class="itile -sm ${g.tone}">${icon('truck', 16)}</span>
              <span class="li-main"><b>${r.cust}</b><span>${r.area} · ${r.items} · ${money(r.amount)}</span></span>
            </div>${r.failureReason ? `<p class="meta" style="padding:0 var(--s-4) var(--s-3)">${r.failureReason}</p>` : ''}`).join('')}
          </div>
        </section>`; }).join('')}
    </div>`;
  }
};

/* ------------------------------------------------------------- ACCOUNT --- */
SCREENS.account = {
  render() {
    return `${appbar({ title:'Account' })}
    <div class="body">
      <section class="card">
        <div class="row" style="margin-bottom:var(--s-2)">
          <span class="avatar -lg -${user().tone}" style="position:relative">${user().init}
            <button class="iconbtn -sm -tinted" data-toast="Upload photo" style="position:absolute;bottom:-4px;left:-4px;width:22px;height:22px;border-radius:50%;box-shadow:0 0 0 2px var(--white)" aria-label="Upload photo">${icon('plus', 13)}</button>
          </span>
          <div style="flex:1"><b style="display:block;font-size:var(--t-title-3);font-weight:640;letter-spacing:-.018em">${user().name}</b></div>
          <button class="btn -sm -secondary" data-toast="Edit name">Edit</button>
        </div>
      </section>
      <div class="group-label"><span class="eyebrow">Details</span><i></i></div>
      <div class="menu">
        <div class="menu-item"><span class="itile -sm">${icon('store', 16)}</span>
          <span class="m-txt"><b>Branch</b><span>${APP.branch}</span></span></div>
        <div class="menu-item"><span class="itile -sm">${icon('user', 16)}</span>
          <span class="m-txt"><b>Role</b><span>${user().title}</span></span></div>
        <div class="menu-item"><span class="itile -sm">${icon('doc', 16)}</span>
          <span class="m-txt"><b>Bakery</b><span>${APP.org.name}</span></span></div>
      </div>
    </div>`;
  }
};

/* ------------------------------------------------------------- SETTINGS --- */
/* One screen, sections vary by role — each role gets a different hierarchy,
   not just a shorter version of the same list. */
SCREENS.settings = {
  tab: 'settings',
  render() {
    const role = APP.role;
    const isOwner = role === 'owner', isManager = role === 'manager';
    const orgAdmin = isOwner || isManager;

    return `${appbar({ title:'Settings', back: !ROLE_TABS[role].includes('settings') })}
    <div class="body">
      <section class="card">
        <button class="row" data-open-account style="width:100%;text-align:left;background:none;border:none;cursor:pointer;padding:0">
          <span class="avatar -lg -${user().tone}">${user().init}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:var(--t-title-3);font-weight:640;letter-spacing:-.018em">${user().name}</div>
            <div class="label">${APP.org.name}</div>
          </div>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>
      </section>

      ${orgAdmin ? `
      <div class="group-label"><span class="eyebrow">Organization</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'store', title:'Bakery details', sub:`${APP.org.name} · Lagos` })}
        ${menuItem({ icon:'pin',   title:'Branches',       sub:APP.org.branches.join(' · '), badge:String(APP.org.branches.length) })}
        ${isOwner ? menuItem({ icon:'users', title:'Organization members', sub:'Owners and admins' }) : ''}
      </div>

      <div class="group-label"><span class="eyebrow">Staff & Roles</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'users', title:'Staff & roles', sub:'5 people', nav:'staff' })}
        ${menuItem({ icon:'plus',  title:'Invite staff',  sub:'Send an invite link', nav:'staff' })}
        <div class="menu-item">
          <span class="itile -sm">${icon('user', 16)}</span>
          <span class="m-txt"><b>Use Supervisor role</b><span>Enable the Supervisor role for this bakery</span></span>
          <span class="switch" data-supervisor-toggle aria-checked="${APP.org.supervisorEnabled}" role="switch" aria-label="Use Supervisor role"><i></i></span>
        </div>
      </div>

      <div class="group-label"><span class="eyebrow">Products & Catalog</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'box', title:'Products',      sub:`${DB.products.length} items`, nav:'products' })}
        ${menuItem({ icon:'tag', title:'Pricing tiers',  sub:'Standard, wholesale, contract' })}
      </div>

      <div class="group-label"><span class="eyebrow">Inventory & Production</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'store', title:'Warehouses',        sub:APP.org.branches.join(' · ') })}
        ${menuItem({ icon:'sort',  title:'Stock adjustment rules', sub:'Reasons, thresholds' })}
        ${menuItem({ icon:'flame', title:'Production settings',   sub:'Batches, recipes' })}
      </div>

      <div class="group-label"><span class="eyebrow">Sales & Delivery</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'cash',  title:'Payment methods', sub:'Cash, transfer, POS, credit' })}
        ${menuItem({ icon:'truck', title:'Delivery settings', sub:'Zones, driver assignment' })}
      </div>` : ''}

      ${!orgAdmin ? `
      <div class="group-label"><span class="eyebrow">Work</span><i></i></div>
      <div class="menu">
        ${role === 'staff' ? menuItem({ icon:'bag', title:'Orders', nav:'orders' }) : ''}
        ${role === 'staff' ? menuItem({ icon:'users', title:'Customers', nav:'customers' }) : ''}
        ${role === 'staff' ? menuItem({ icon:'history', title:'My activity', nav:'my-activity' }) : ''}
        ${role === 'staff' ? menuItem({ icon:'cash', title:'Cash session preferences', sub:'Default opening float' }) : ''}
        ${role === 'driver' ? menuItem({ icon:'truck', title:'Vehicle & delivery info', sub:'Bike · plate ABC-123' }) : ''}
        ${role === 'supervisor' ? menuItem({ icon:'calendar', title:'Shift preferences', sub:'Working hours, handover notes' }) : ''}
      </div>` : ''}

      <div class="group-label"><span class="eyebrow">Notifications</span><i></i></div>
      <div class="menu">
        ${(orgAdmin
          ? [['New orders','Every order, all branches',true],['Low stock','When a product drops below its level',true],
             ['Cash differences','When a drawer does not balance',true],['Daily summary','7 PM each day',false]]
          : role === 'staff'
          ? [['My sales','Every sale you record',true],['Cash session reminders','When to count and close',true]]
          : role === 'supervisor'
          ? [['Low stock','When a product drops below its level',true],['Production problems','Failed or delayed batches',true],
             ['Delivery problems','Failed or returned deliveries',true],['Sales exceptions','Unusual transactions',false],['Staff issues','Coverage or task alerts',true]]
          : role === 'baker'
          ? [['Production assignments','When a batch is assigned to you',true],['Production reminders','Scheduled batches today',true]]
          : [['New deliveries','When a stop is assigned to you',true],['Route changes','If a stop is added or removed',true]])
          .map(([t, s, on]) => `<div class="menu-item">
            <span class="itile -sm">${icon('bell', 16)}</span>
            <span class="m-txt"><b>${t}</b><span>${s}</span></span>
            <span class="switch" aria-checked="${on}" role="switch" aria-label="${t}"><i></i></span>
          </div>`).join('')}
      </div>

      <div class="group-label"><span class="eyebrow">App</span><i></i></div>
      <div class="menu">
        <div class="menu-item"><span class="itile -sm">${icon('bell', 16)}</span>
          <span class="m-txt"><b>Sound & haptics</b><span>On new sale / order events</span></span>
          <span class="switch" aria-checked="true" role="switch" aria-label="Sound and haptics"><i></i></span></div>
        <button class="menu-item" data-open-theme>
          <span class="itile -sm">${icon('settings', 16)}</span>
          <span class="m-txt"><b>Appearance</b><span>${{ system:'System default', light:'Light', dark:'Dark' }[APP.theme]}</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>
        ${menuItem({ icon:'info', title:'Language', sub:'English' })}
      </div>
      ${orgAdmin ? `
      <div class="group-label"><span class="eyebrow">Security</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'shield', title:'Staff access',    sub:'Sign-in requirements' })}
        ${menuItem({ icon:'cloudSync', title:'Sessions & devices', sub:'Where your account is signed in' })}
        ${isOwner ? menuItem({ icon:'history', title:'Audit log', sub:`${DB.auditLog.length} recent actions`, nav:'audit' }) : ''}
      </div>` : `
      <div class="group-label"><span class="eyebrow">Security</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'cloudSync', title:'Active sessions', sub:'This device only' })}
        ${menuItem({ icon:'logout',    title:'Sign out of other sessions', sub:'' })}
      </div>`}

      ${isOwner ? `
      <div class="group-label"><span class="eyebrow">Subscription & Billing</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'scale',   title:'Current plan', sub:'Growth · ₦45,000/mo' })}
        ${menuItem({ icon:'receipt',title:'Billing & invoices', sub:'Next charge 1 September' })}
      </div>` : ''}

      <div class="group-label"><span class="eyebrow">Account</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'lock',   title:'Change password', sub:'' })}
        ${menuItem({ icon:'shield', title:'Privacy',         sub:'How your bakery data is kept' })}
        ${menuItem({ icon:'info',   title:'About BakeFlow',  sub:'Version 0.9 prototype' })}
      </div>

      <button class="btn -danger -block" style="margin-top:var(--s-5)" data-nav="login" data-nav-mode="fade">Sign out</button>
      <p class="meta" style="margin-top:var(--s-4);text-align:center">BakeFlow · Sweet Crumbs Bakery, Lagos</p>
    </div>`;
  },
  mount(el) {
    $('[data-open-account]', el)?.addEventListener('click', () => nav('account'));
    const sw = $('[data-supervisor-toggle]', el);
    $('[data-open-theme]', el)?.addEventListener('click', () => {
      sheet({
        title:'Appearance',
        body: `<div class="menu">
          ${[['system','System default'],['light','Light'],['dark','Dark']].map(([k, label]) => `
            <button class="menu-item" data-theme-opt="${k}">
              <span class="m-txt"><b>${label}</b></span>
              ${APP.theme === k ? `<span class="chev" style="color:var(--cocoa)">${icon('check', 17, { stroke:2.4 })}</span>` : ''}
            </button>`).join('')}
        </div>`,
        onMount(s) {
          $$('[data-theme-opt]', s).forEach(b => b.onclick = () => {
            applyTheme(b.dataset.themeOpt);
            closeSheet();
            setTimeout(refresh, 220);
          });
        }
      });
    });
    if (!sw) return;
    sw._w = true;
    sw.onclick = () => {
      const enabling = sw.getAttribute('aria-checked') !== 'true';
      const assigned = DB.staffList.filter(s => s.role === 'Supervisor');
      if (!enabling && assigned.length) {
        dialog({
          body: `<div style="text-align:center">
            <span class="itile -warn" style="width:44px;height:44px;border-radius:14px;margin:0 auto var(--s-4)">${icon('alert', 21)}</span>
            <h3 style="font-size:var(--t-title-3);font-weight:640">Turn off Supervisor role?</h3>
            <p class="label" style="margin-top:8px;line-height:1.5">${assigned.map(s => s.name).join(', ')} ${assigned.length === 1 ? 'is' : 'are'} currently assigned as Supervisor. Turning this off does not change their role automatically — you'll need to reassign them.</p>
            <div class="grid-2" style="margin-top:var(--s-5)">
              <button class="btn -secondary" data-close>Cancel</button>
              <button class="btn -danger" data-confirm-off>Turn off anyway</button></div></div>`,
          onMount(d) {
            $('[data-confirm-off]', d).onclick = () => {
              APP.org.supervisorEnabled = false;
              logAudit('Turned off Supervisor role', `${assigned.map(s => s.name).join(', ')} still assigned; not auto-reassigned`, 'org');
              closeSheet();
              setTimeout(() => { refresh(); toast({ title:'Supervisor role turned off', text:'Existing assignments were not changed', kind:'warn' }); }, 240);
            };
          }
        });
        return;
      }
      APP.org.supervisorEnabled = enabling;
      logAudit(enabling ? 'Enabled Supervisor role' : 'Turned off Supervisor role', enabling ? 'No staff currently assigned' : '', 'org');
      refresh();
      toast({ title: enabling ? 'Supervisor role enabled' : 'Supervisor role turned off' });
    };
  }
};

/* ------------------------------------------------------------- AUDIT LOG --- */
/* Owner-only accountability record — corrections, cancellations, and
   organization-level toggles other roles performed. Read-only. */
SCREENS.audit = {
  render() {
    if (!['owner', 'admin'].includes(APP.role)) return `${appbar({ title:'Audit log' })}<div class="errstate"><div class="er-ico">${icon('shield', 21)}</div><h4>Owner only</h4><p>This record is only visible to the bakery owner.</p></div>`;
    return `${appbar({ title:'Audit log', sub:`${DB.auditLog.length} recorded actions`, back: APP.role === 'admin' })}
    <div class="body">
      <div class="list" style="margin-top:var(--s-2)">
        ${DB.auditLog.map(a => `<div class="li" style="align-items:flex-start">
          <span class="itile -sm">${icon('history', 16)}</span>
          <span class="li-main"><b>${a.action}</b><span style="display:block;margin-top:2px;line-height:1.4">${esc(a.detail)}</span>
            <span style="display:block;margin-top:3px">${a.actor} · ${a.role} · ${a.time}</span></span>
        </div>`).join('')}
      </div>
      <p class="meta" style="margin-top:var(--s-4);text-align:center">Corrections, cancellations and organization changes across every role.</p>
    </div>`;
  }
};

/* ------------------------------------------------------- STATES GALLERY --- */
SCREENS.states = {
  render(p) {
    const which = p.which || 'loading';
    const views = {
      loading: `
        <section class="hero-panel" style="padding-bottom:var(--s-5)">
          <div class="sk" style="width:110px;height:11px;background:rgba(255,255,255,.14);animation:none"></div>
          <div class="sk" style="width:66%;height:32px;margin-top:12px;border-radius:9px;background:rgba(255,255,255,.14);animation:none"></div>
          <div class="sk" style="width:44%;height:11px;margin-top:12px;background:rgba(255,255,255,.1);animation:none"></div>
          <div style="height:74px"></div>
        </section>
        <div class="grid-2" style="margin-top:var(--s-4)">
          ${[0, 1].map(() => `<div class="card">
            <div class="sk -on-white" style="width:52px;height:10px"></div>
            <div class="sk -on-white" style="width:74%;height:22px;margin-top:11px;border-radius:8px"></div>
            <div class="sk -on-white" style="width:46%;height:9px;margin-top:9px"></div>
          </div>`).join('')}
        </div>
        <div class="section">
          <div class="sk" style="width:130px;height:14px;margin-bottom:var(--s-3)"></div>
          <div class="stack-3">
            ${[0, 1, 2].map(() => `<div class="card">
              <div class="row"><div class="sk -on-white sk-circle" style="width:40px;height:40px"></div>
                <div style="flex:1"><div class="sk -on-white" style="width:44%;height:10px"></div>
                  <div class="sk -on-white" style="width:66%;height:13px;margin-top:8px"></div></div>
                <div class="sk -on-white" style="width:58px;height:22px;border-radius:9px"></div></div>
              <div class="sk -on-white" style="width:82%;height:10px;margin-top:13px"></div>
              <div class="sk -on-white" style="width:38%;height:17px;margin-top:14px;border-radius:7px"></div>
            </div>`).join('')}
          </div>
        </div>
        <p class="meta" style="margin-top:var(--s-5);text-align:center;line-height:1.5">
          Skeletons mirror the shape of the content that is coming, so nothing jumps when it lands.</p>`,

      empty: `
        <div class="empty" style="padding-top:var(--s-10)">
          <div class="e-art">${flowMotif(150, 62, .8)}</div>
          <h4>No orders yet</h4>
          <p>Your first order of the day will appear here. Most bakeries take their first before 8 AM.</p>
          <div class="e-act"><button class="btn -primary" data-nav="new-ticket">${icon('plus', 17)} Create order</button></div>
        </div>
        <div class="group-label"><span class="eyebrow">Other empty states</span><i></i></div>
        <div class="stack-3">
          ${[['No expenses recorded today','Recording one takes about ten seconds.','receipt'],
             ['No customers yet','Add a customer once and every future order gets faster.','users'],
             ['Nothing to sync','Every change is safely on the server.','cloudSync']]
            .map(([t, s, ic]) => `<div class="card" style="text-align:center;padding:var(--s-6) var(--s-4)">
              <span class="itile" style="margin:0 auto var(--s-3)">${icon(ic, 18)}</span>
              <b style="display:block;font-size:var(--t-callout);font-weight:600">${t}</b>
              <p class="label" style="margin-top:5px">${s}</p></div>`).join('')}
        </div>`,

      error: `
        <div class="errstate" style="padding-top:var(--s-10)">
          <span class="er-ico">${icon('alert', 22)}</span>
          <h4>Something went wrong while loading your sales</h4>
          <p>Your data is safe. This was a problem reaching the server, not with your bakery's records.</p>
          <div class="row" style="margin-top:var(--s-5);gap:var(--s-2)">
            <button class="btn -primary" data-toast="Trying again" data-toast-kind="ok">${icon('refresh', 17)} Try again</button>
            <button class="btn -tertiary" data-toast="Showing your last saved figures">Use saved data</button>
          </div>
        </div>
        <div class="group-label"><span class="eyebrow">How BakeFlow words problems</span><i></i></div>
        <div class="stack-3">
          ${[['Couldn\'t sync this change yet','Never “RPC failed”. The user hears what happened and what to do.','cloudSync','-warn'],
             ['We couldn\'t confirm this payment','For money, we always say whether it saved. Never leave a doubt.','cash','-bad'],
             ['This order was changed by Amara','Two people edited at once. Show both, let the user choose.','users','']]
            .map(([t, s, ic, tone]) => `<div class="card">
              <div class="row -top"><span class="itile -sm ${tone}">${icon(ic, 15)}</span>
                <div style="flex:1"><b style="font-size:var(--t-callout);font-weight:600">${t}</b>
                  <p class="meta" style="margin-top:4px;line-height:1.5">${s}</p></div></div></div>`).join('')}
        </div>`,

      offline: `
        <div class="offline-note" style="margin-bottom:var(--s-4)">
          <span class="itile -sm">${icon('wifiOff', 16)}</span>
          <span class="on-txt"><b>Working offline</b><span>3 changes saved on this phone</span></span>
          <button class="btn -sm -secondary" data-open-sync>Review</button>
        </div>
        <div class="card">
          <div class="eyebrow">Sync states</div>
          <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:var(--s-3)">
            <span class="sync -synced">${icon('check', 12, { stroke:2.2 })} Synced</span>
            <span class="sync -syncing">${icon('refresh', 12, { stroke:2.2 })} Syncing…</span>
            <span class="sync -offline">${icon('wifiOff', 12, { stroke:2.2 })} 3 waiting</span>
            <span class="sync -attention">${icon('alert', 12, { stroke:2.2 })} Needs attention</span>
          </div>
          <p class="meta" style="margin-top:var(--s-4);line-height:1.55">
            Offline is a normal way to work in Lagos, not an error. BakeFlow never shows a red wall — it shows what is waiting and sends it when it can.</p>
        </div>
        <div class="section">
          <div class="section-head"><h3>Saved on this phone</h3></div>
          <div class="list">
            ${[['TK-313 · Emeka Obi', money(24500), 'Created 1:34 PM'],
               ['Expense · Diesel', money(15000), 'Recorded 9:30 AM'],
               ['BF-2046 marked Ready', '—', 'Changed 12:52 PM']].map(([a, b, c]) => `
              <div class="li"><span class="itile -sm">${icon('cloudSync', 15)}</span>
                <span class="li-main"><b>${a}</b><span>${c}</span></span>
                <span class="li-end"><b class="num">${b}</b><span>waiting</span></span></div>`).join('')}
          </div>
          <button class="btn -primary -block" style="margin-top:var(--s-4)" data-try-sync>${icon('refresh', 17)} Send now</button>
        </div>`,
    };

    return `${appbar({ title:'States', sub:'Loading, empty, error, offline' })}
    <div class="body -flush">
      <div class="chips" data-chipgroup id="st-chips" style="margin-bottom:var(--s-4)">
        ${[['loading','Loading'],['empty','Empty'],['error','Error'],['offline','Offline']]
          .map(([k, l]) => `<button class="chip" data-val="${k}" aria-pressed="${k === which}">${l}</button>`).join('')}
      </div>
      <div class="flush-pad">${views[which]}</div>
    </div>`;
  },
  mount(el) {
    $('#st-chips', el).addEventListener('chipchange', e => nav('states', { which: e.detail }, 'replace'));
    $('[data-try-sync]', el)?.addEventListener('click', () => {
      APP.sync = 'syncing'; refresh();
      setTimeout(() => { APP.sync = 'synced'; APP.queued = 0; refresh();
        toast({ title:'All changes sent', text:'3 items · nothing lost' }); }, 1600);
    });
  }
};

/* ------------------------------------------------- DESIGN SYSTEM (in-app) --- */
SCREENS.ds = {
  render() {
    const swatch = (name, hex, note) => `<div class="row" style="padding:9px 0">
      <span style="width:36px;height:36px;border-radius:11px;background:${hex};box-shadow:inset 0 0 0 1px rgba(42,33,28,.08);flex:0 0 auto"></span>
      <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-foot);font-weight:590">${name}</b>
        <span class="meta">${note}</span></span>
      <span class="meta num">${hex}</span></div>`;

    return `${appbar({ title:'Design system', sub:'The BakeFlow visual language' })}
    <div class="body">
      <section class="card">
        <div class="row" style="gap:12px">${brandMark(46)}
          <div><b style="display:block;font-size:var(--t-title-3);font-weight:660;letter-spacing:-.02em">BakeFlow</b>
            <span class="label">Three strokes lifting to the right: orders → production → cash.</span></div></div>
      </section>

      <div class="group-label"><span class="eyebrow">Colour</span><i></i></div>
      <div class="card">
        ${swatch('Deep Cocoa', '#2A211C', 'Text, primary actions, brand')}
        ${swatch('Warm Cream', '#F7F3EC', 'App background')}
        ${swatch('Pure White', '#FFFFFF', 'Cards, sheets, inputs')}
        ${swatch('Warm Gray', '#8D857D', 'Secondary text')}
        ${swatch('Soft Border', '#E7E1D8', 'Used sparingly')}
        ${swatch('Baked Apricot', '#E58A5B', 'Accent, selection, charts')}
        ${swatch('Success', '#3E8F68', 'Completed, positive')}
        ${swatch('Warning', '#D49A3A', 'Pending, low stock')}
        ${swatch('Error', '#C95C54', 'Failures, destructive')}
      </div>

      <div class="group-label"><span class="eyebrow">Type</span><i></i></div>
      <div class="card stack-3">
        <div><div class="hero-figure num">₦428,500</div><span class="meta">Display · 34 / 660 · the hero figure</span></div>
        <div><div class="big-figure num">₦1.88M</div><span class="meta">Title 1 · 27 / 650</span></div>
        <div><div class="mid-figure">Your bakery today</div><span class="meta">Title 2 · 21 / 640</span></div>
        <div><b style="font-size:var(--t-title-3);font-weight:630">Section heading</b><br><span class="meta">Title 3 · 17 / 630</span></div>
        <div><span style="font-size:var(--t-body)">Body copy sits at fifteen pixels.</span><br><span class="meta">Body · 15 / 400</span></div>
        <div><span class="label">Secondary label</span><br><span class="meta">Footnote · 13 · warm gray</span></div>
      </div>

      <div class="group-label"><span class="eyebrow">Buttons</span><i></i></div>
      <div class="card stack-3">
        <button class="btn -primary -block">Primary action</button>
        <button class="btn -accent -block">Accent action</button>
        <button class="btn -secondary -block">Secondary</button>
        <button class="btn -danger -block">Destructive</button>
        <button class="btn -tertiary -block">Tertiary</button>
      </div>

      <div class="group-label"><span class="eyebrow">Status</span><i></i></div>
      <div class="card">
        <div class="row" style="flex-wrap:wrap;gap:7px">
          ${Object.keys(STATUS).map(k => statusBadge(k)).join('')}
        </div>
        <p class="meta" style="margin-top:var(--s-3);line-height:1.5">Every status carries a glyph and a word, never colour alone.</p>
      </div>

      <div class="group-label"><span class="eyebrow">Controls</span><i></i></div>
      <div class="card stack-4">
        <div class="segmented"><span class="seg-thumb"></span>
          <button aria-pressed="true">Today</button><button aria-pressed="false">7 days</button><button aria-pressed="false">30 days</button></div>
        <div class="row" style="gap:7px">
          <button class="chip" aria-pressed="true">Selected</button>
          <button class="chip" aria-pressed="false">Chip</button>
          <button class="chip" aria-pressed="false">Chip <span class="c-count">7</span></button>
        </div>
        <div class="searchbar">${icon('search', 17)}<input></div>
        <label class="field"><span class="f-label">Input</span><input class="f-ctl"></label>
        <div class="row"><span style="flex:1;font-size:var(--t-callout)">Toggle</span>
          <span class="switch" aria-checked="true" role="switch" aria-label="Demo"><i></i></span></div>
        <div class="row"><span style="flex:1;font-size:var(--t-callout)">Stepper</span>
          <span class="stepper"><button>${icon('minus', 14)}</button><span class="qty">3</span><button>${icon('plus', 14)}</button></span></div>
      </div>

      <div class="group-label"><span class="eyebrow">Motion</span><i></i></div>
      <div class="card">
        ${[['Push / pop', '360ms · cubic-bezier(.32,.72,0,1)'],['Sheet up', '400ms · same curve'],
           ['Figure count', '620ms · ease-out cubic'],['Press feedback','140ms scale to .975'],
           ['Chart draw','520–620ms · staggered 60ms']].map(([k, v]) => `
          <div class="row" style="padding:7px 0"><span style="flex:1;font-size:var(--t-foot);font-weight:540">${k}</span>
            <span class="meta">${v}</span></div>`).join('')}
      </div>

      <a class="btn -onwhite -block" href="design-system.html" style="margin-top:var(--s-5)">
        ${icon('layers', 17)} Open the full reference</a>
    </div>`;
  }
};

/* ===================================================== ADMIN CONSOLE ===== */
/* Org & branches \u2014 mock edits, toast-confirmed, no real persistence beyond
   this session's APP.org/DB.branches. */
SCREENS['admin-org'] = {
  render() {
    if (APP.role !== 'admin') return `${appbar({ title:'Organization' })}<div class="errstate"><div class="er-ico">${icon('shield', 21)}</div><h4>Admin only</h4></div>`;
    return `${appbar({ title:'Organization & branches', back:true })}
    <div class="body">
      <section class="section" style="margin-top:var(--s-2)">
        <div class="section-head"><h3>Bakery details</h3></div>
        <div class="menu">
          ${menuItem({ icon:'store', title:APP.org.name, sub:'Business name', sheet:'edit-org-name' })}
        </div>
      </section>
      <section class="section">
        <div class="section-head"><h3>Branches</h3><div class="spacer"></div><button class="link" data-add-branch>Add</button></div>
        <div class="list">
          ${DB.branches.map(b => `<div class="li"><span class="itile -sm">${icon('pin', 16)}</span>
            <span class="li-main"><b>${b.k}</b><span>${b.staff} staff \u00b7 ${b.orders} orders today</span></span>
            <button class="link" data-rename-branch="${b.k}">Rename</button></div>`).join('')}
        </div>
      </section>
    </div>`;
  },
  mount(el) {
    $$('[data-qa-sheet="edit-org-name"]', el).forEach(b => b.onclick = () => {
      sheet({ title:'Bakery name', body:`<label class="field"><span class="f-label">Name</span><input class="f-ctl" id="org-name-in" value="${esc(APP.org.name)}"></label>`,
        foot:`<button class="btn -primary -block -lg" data-save-org-name>Save</button>`,
        onMount(s) { $('[data-save-org-name]', s).onclick = () => {
          const v = $('#org-name-in', s).value.trim(); if (!v) return;
          APP.org.name = v; closeSheet(); setTimeout(() => { refresh(); toast({ title:'Bakery name updated' }); }, 220);
        }; } });
    });
    $('[data-add-branch]', el)?.addEventListener('click', () => {
      sheet({ title:'Add branch', body:`<label class="field"><span class="f-label">Branch name</span><input class="f-ctl" id="branch-name-in" placeholder="e.g. Surulere"></label>`,
        foot:`<button class="btn -primary -block -lg" data-save-branch disabled>Add branch</button>`,
        onMount(s) { const inp = $('#branch-name-in', s), btn = $('[data-save-branch]', s);
          inp.oninput = () => { btn.disabled = !inp.value.trim(); };
          btn.onclick = () => { const v = inp.value.trim(); if (!v) return;
            APP.org.branches.push(v); DB.branches.push({ k:v, rev:0, orders:0, pct:0, delta:0, staff:0 });
            closeSheet(); setTimeout(() => { refresh(); toast({ title:'Branch added', text:v }); }, 220);
          }; } });
    });
    $$('[data-rename-branch]', el).forEach(b => b.onclick = () => {
      const old = b.dataset.renameBranch;
      sheet({ title:'Rename branch', body:`<label class="field"><span class="f-label">Branch name</span><input class="f-ctl" id="branch-rename-in" value="${esc(old)}"></label>`,
        foot:`<button class="btn -primary -block -lg" data-save-rename>Save</button>`,
        onMount(s) { $('[data-save-rename]', s).onclick = () => {
          const v = $('#branch-rename-in', s).value.trim(); if (!v) return;
          const i = APP.org.branches.indexOf(old); if (i > -1) APP.org.branches[i] = v;
          const br = DB.branches.find(x => x.k === old); if (br) br.k = v;
          closeSheet(); setTimeout(() => { refresh(); toast({ title:'Branch renamed' }); }, 220);
        }; } });
    });
  }
};

/* Staff & access \u2014 the one place admin's full staff.manage grant (vs.
   Manager's invite-only reality) actually shows up as a real difference. */
const ADMIN_STAFF_ROLES = ['Counter Staff', 'Baker', 'Delivery', 'Supervisor', 'Branch Manager'];
SCREENS['admin-staff'] = {
  render() {
    if (APP.role !== 'admin') return `${appbar({ title:'Staff & access' })}<div class="errstate"><div class="er-ico">${icon('shield', 21)}</div><h4>Admin only</h4></div>`;
    return `${appbar({ title:'Staff & access', back:true, sub:`${DB.staffList.length} people, every branch`,
      right:`<button class="iconbtn -tinted" data-add-staff aria-label="Add staff">${icon('plus', 20)}</button>` })}
    <div class="body">
      <div class="list" style="margin-top:var(--s-2)">
        ${DB.staffList.map(s => `<button class="li" data-staff="${s.id}" style="width:100%;text-align:left">
          <span class="avatar -sm -${s.tone}">${s.init}</span>
          <span class="li-main"><b>${s.name}</b><span>${s.role} \u00b7 ${s.branch}</span></span>
          <span class="badge ${s.status === 'On shift' ? '-ok' : s.status === 'On route' ? '-live' : '-neutral'}">${s.status}</span>
        </button>`).join('')}
      </div>
    </div>`;
  },
  mount(el) {
    $('[data-add-staff]', el)?.addEventListener('click', () => adminStaffSheet(null));
    $$('[data-staff]', el).forEach(b => b.onclick = () => adminStaffSheet(DB.staffList.find(s => s.id === b.dataset.staff)));
  }
};
function adminStaffSheet(s) {
  const isNew = !s;
  sheet({
    title: isNew ? 'Add staff' : s.name,
    body: `<label class="field" style="margin-bottom:var(--s-4)"><span class="f-label">Name</span>
        <input class="f-ctl" id="as-name" value="${isNew ? '' : esc(s.name)}" ${isNew ? 'placeholder="Full name"' : ''}></label>
      <label class="field" style="margin-bottom:var(--s-4)"><span class="f-label">Role</span>
        <select class="f-ctl" id="as-role">${ADMIN_STAFF_ROLES.map(r => `<option value="${r}" ${!isNew && s.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label class="field"><span class="f-label">Branch</span>
        <select class="f-ctl" id="as-branch">${APP.org.branches.map(b => `<option value="${b}" ${!isNew && s.branch === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>`,
    foot: isNew
      ? `<button class="btn -primary -block -lg" data-save-staff disabled>Add staff</button>`
      : `<button class="btn -danger -block" data-remove-staff>Remove from organization</button>
         <button class="btn -primary -block -lg" data-save-staff>Save changes</button>`,
    onMount(sh) {
      const name = $('#as-name', sh), saveBtn = $('[data-save-staff]', sh);
      if (isNew) { name.oninput = () => { saveBtn.disabled = !name.value.trim(); }; }
      saveBtn.onclick = () => {
        const nm = name.value.trim(); if (!nm) return;
        const role = $('#as-role', sh).value, branch = $('#as-branch', sh).value;
        if (isNew) {
          DB.staffList.unshift({ id:'u' + Date.now(), name:nm, role, branch,
            init: nm.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(), tone:'b',
            today:{ orders:0, sales:0 }, status:'Off shift', since:'\u2014' });
          logAudit('Added staff member', `${nm} \u00b7 ${role} \u00b7 ${branch}`, 'staff');
        } else {
          s.name = nm; s.role = role; s.branch = branch;
          logAudit('Edited staff member', `${nm} \u00b7 ${role} \u00b7 ${branch}`, 'staff');
        }
        closeSheet();
        setTimeout(() => { refresh(); toast({ title: isNew ? 'Staff added' : 'Changes saved', text: nm }); }, 220);
      };
      /* Audit-logged and affects someone's access, so no undo — the name must
         be typed out before the button unlocks. */
      $('[data-remove-staff]', sh)?.addEventListener('click', () => {
        confirmSheet({
          title: `Remove ${s.name}?`,
          body: `They lose access to this organization immediately, and the removal is written to the audit log. There is no undo for this.`,
          confirmLabel: 'Remove from organization',
          tone: '-danger',
          typeToConfirm: s.name,
          onConfirm() {
            DB.staffList = DB.staffList.filter(x => x.id !== s.id);
            logAudit('Removed staff member', `${s.name} \u00b7 was ${s.role} \u00b7 ${s.branch}`, 'staff');
            setTimeout(() => { closeSheet(); refresh(); toast({ title:'Staff removed', text:s.name, kind:'warn' }); }, 240);
          }
        });
      });
    }
  });
}

/* Records \u2014 ticket archiving only (\u00a76 decision: permanent delete skipped,
   too destructive to fake convincingly here). Cancelled orders are the
   archivable population; archiving just hides them from the active list. */
SCREENS['admin-records'] = {
  render() {
    if (APP.role !== 'admin') return `${appbar({ title:'Records' })}<div class="errstate"><div class="er-ico">${icon('shield', 21)}</div><h4>Admin only</h4></div>`;
    const pending = DB.orders.filter(o => o.status === 'cancelled' && !o.archived);
    const archived = DB.orders.filter(o => o.archived);
    return `${appbar({ title:'Records', back:true, sub:'Ticket archiving' })}
    <div class="body">
      <section class="section" style="margin-top:var(--s-2)">
        <div class="section-head"><h3>Cancelled \u2014 eligible to archive</h3></div>
        ${pending.length ? `<div class="list">
          ${pending.map(o => `<div class="li"><span class="itile -sm -neutral">${icon('close', 16)}</span>
            <span class="li-main"><b>${o.ref}</b><span>${C(o.cust).name} \u00b7 ${money(o.total)}</span></span>
            <button class="btn -sm -secondary" data-archive="${o.id}">Archive</button></div>`).join('')}
        </div>` : `<p class="meta" style="padding:var(--s-3) 0">Nothing pending.</p>`}
      </section>
      ${archived.length ? `<section class="section">
        <div class="section-head"><h3>Archived</h3></div>
        <div class="list">
          ${archived.map(o => `<div class="li"><span class="itile -sm">${icon('box', 16)}</span>
            <span class="li-main"><b>${o.ref}</b><span>${C(o.cust).name} \u00b7 ${money(o.total)}</span></span></div>`).join('')}
        </div>
      </section>` : ''}
    </div>`;
  },
  mount(el) {
    $$('[data-archive]', el).forEach(b => b.onclick = () => {
      const o = DB.orders.find(x => x.id === b.dataset.archive);
      o.archived = true;
      logAudit('Archived ticket', `${o.ref} \u00b7 ${C(o.cust).name}`, 'order');
      refresh();
      undoToast({
        title: 'Ticket archived',
        text: `${o.ref} \u00b7 ${C(o.cust).name}`,
        onUndo() { o.archived = false; refresh(); toast({ title:'Archive undone', text:o.ref }); }
      });
    });
  }
};

/* System settings \u2014 org-level switches, currently only reachable through
   Owner's Settings; Admin needs its own entry since Admin has no tab bar. */
SCREENS['admin-settings'] = {
  render() {
    if (APP.role !== 'admin') return `${appbar({ title:'System settings' })}<div class="errstate"><div class="er-ico">${icon('shield', 21)}</div><h4>Admin only</h4></div>`;
    return `${appbar({ title:'System settings', back:true })}
    <div class="body">
      <section class="section" style="margin-top:var(--s-2)">
        <div class="menu">
          <div class="menu-item">
            <span class="itile -sm">${icon('user', 16)}</span>
            <span class="m-txt"><b>Use Supervisor role</b><span>Enable the Supervisor role for this bakery</span></span>
            <span class="switch" data-supervisor-toggle aria-checked="${APP.org.supervisorEnabled}" role="switch" aria-label="Use Supervisor role"><i></i></span>
          </div>
        </div>
      </section>
    </div>`;
  },
  mount(el) {
    const sw = $('[data-supervisor-toggle]', el);
    if (!sw) return;
    sw._w = true; // claim before wireCommon's generic .switch handler runs, or it overwrites this
    sw.onclick = () => {
      const enabling = sw.getAttribute('aria-checked') !== 'true';
      const assigned = DB.staffList.filter(s => s.role === 'Supervisor');
      if (!enabling && assigned.length) {
        dialog({
          body: `<div style="text-align:center">
            <span class="itile -warn" style="width:44px;height:44px;border-radius:14px;margin:0 auto var(--s-4)">${icon('alert', 21)}</span>
            <h3 style="font-size:var(--t-title-3);font-weight:640">Turn off Supervisor role?</h3>
            <p class="label" style="margin-top:8px;line-height:1.5">${assigned.map(s => s.name).join(', ')} ${assigned.length === 1 ? 'is' : 'are'} currently assigned as Supervisor. Turning this off does not change their role automatically \u2014 you'll need to reassign them.</p>
            <div class="grid-2" style="margin-top:var(--s-5)">
              <button class="btn -secondary" data-close>Cancel</button>
              <button class="btn -danger" data-confirm-off>Turn off anyway</button></div></div>`,
          onMount(d) {
            $('[data-confirm-off]', d).onclick = () => {
              APP.org.supervisorEnabled = false;
              logAudit('Turned off Supervisor role', `${assigned.map(s => s.name).join(', ')} still assigned; not auto-reassigned`, 'org');
              closeSheet();
              setTimeout(() => { refresh(); toast({ title:'Supervisor role turned off', text:'Existing assignments were not changed', kind:'warn' }); }, 240);
            };
          }
        });
        return;
      }
      APP.org.supervisorEnabled = enabling;
      logAudit(enabling ? 'Enabled Supervisor role' : 'Turned off Supervisor role', enabling ? 'No staff currently assigned' : '', 'org');
      refresh();
      toast({ title: enabling ? 'Supervisor role enabled' : 'Supervisor role turned off' });
    };
  }
};
