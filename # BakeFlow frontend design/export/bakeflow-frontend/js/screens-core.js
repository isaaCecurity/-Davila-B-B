/* ==========================================================================
   BAKEFLOW — Core screens: splash, login, home (role-adaptive), org, sync, more
   ========================================================================== */

/* ---------------------------------------------------------------- SPLASH --- */
SCREENS.splash = {
  chrome: false,
  render() {
    return `<div class="splash">
      <div class="sp-placeholder">${brandMark(64, 'ink')}</div>
    </div>`;
  },
  mount(el, params = {}) {
    if (params.hold) return;
    setTimeout(() => nav('get-started', {}, 'fade'), 900);
  }
};

/* ------------------------------------------------------------ GET STARTED --- */
/* The real, pixel-exact onboarding + sign-in flow (splash hand-off, parallax
   carousel, dough-bloom transition, sign-in) lives in sweetcrumbs/ and is
   embedded verbatim so none of its bespoke animation is reinterpreted. */
SCREENS['get-started'] = {
  chrome: false,
  render() {
    return `<iframe src="sweetcrumbs/" title="Get started"
      style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="vibrate"></iframe>`;
  },
  mount(el) {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data === 'bakeflow:signed-in') {
        window.removeEventListener('message', onMsg);
        APP.role = 'owner';
        APP.tab = ROLE_TABS.owner[0];
        nav('home', {}, 'fade');
        setTimeout(() => toast({ title: `Signed in as ${DB.users.owner.first}`, text: DB.users.owner.title }), 500);
      }
    };
    window.addEventListener('message', onMsg);
  }
};

/* ----------------------------------------------------------------- LOGIN --- */
SCREENS.login = {
  chrome: false,
  render() {
    return `<div class="body" style="display:flex;flex-direction:column;justify-content:center;gap:var(--s-8)">
      <div class="login-head">
        ${brandMark(64, 'light')}
        <div>
          <h1>Run your bakery<br>with clarity.</h1>
          <p style="margin-top:8px">Orders, sales, cash and profit — one place.</p>
        </div>
      </div>

      <form id="login-form" class="stack-3" novalidate>
        <label class="field" id="lg-id-field">
          <span class="f-label">Email or phone</span>
          <div class="f-wrap">
            <span class="f-lead">${icon('mail', 18)}</span>
            <input class="f-ctl -lead" id="lg-id" type="text" value="david@bakeflow.ng" autocomplete="username">
          </div>
        </label>
        <label class="field" id="lg-pass-field">
          <span class="f-label">Password</span>
          <div class="f-wrap">
            <span class="f-lead">${icon('lock', 18)}</span>
            <input class="f-ctl -lead" id="lg-pass" type="password" value="bakeflow" autocomplete="current-password" style="padding-right:42px">
            <button type="button" class="iconbtn f-trail" id="lg-peek" aria-label="Show password" style="color:var(--warm-gray)">${icon('eye', 18)}</button>
          </div>
        </label>
        <button class="btn -primary -block -lg" id="lg-go" type="submit" style="margin-top:var(--s-2)">Sign in</button>
        <button class="link-under" type="button" style="justify-self:center;margin-top:var(--s-1)"
          data-toast="Reset link sent" data-toast-text="Check david@bakeflow.ng">Forgot password?</button>
      </form>

      <div>
        <div class="group-label" style="margin-top:0"><i></i><span class="meta">Or</span><i></i></div>
        <button class="btn -onwhite -block -lg" id="lg-google" type="button" style="gap:10px">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.55-1.84.87-3.06.87-2.36 0-4.36-1.6-5.08-3.74H.9v2.33A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.92 10.69A5.4 5.4 0 0 1 3.64 9c0-.59.1-1.16.28-1.69V4.98H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.02z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.34l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.98l3.02 2.33C4.64 5.17 6.64 3.58 9 3.58z"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    </div>`;
  },
  mount(el) {
    const go = (role) => {
      APP.role = role;
      APP.tab = ROLE_TABS[role][0];
      nav('home', {}, 'fade');
      setTimeout(() => toast({ title:`Signed in as ${DB.users[role].first}`, text: DB.users[role].title }), 500);
    };
    $('#login-form', el).onsubmit = e => {
      e.preventDefault();
      const idF = $('#lg-id-field', el), id = $('#lg-id', el);
      if (!id.value.trim()) { idF.classList.add('-invalid'); id.focus(); return; }
      idF.classList.remove('-invalid');
      go('owner');
    };
    $('#lg-google', el).onclick = () => go('owner');
    const pass = $('#lg-pass', el), peek = $('#lg-peek', el);
    peek.onclick = () => {
      const show = pass.type === 'password';
      pass.type = show ? 'text' : 'password';
      peek.innerHTML = icon(show ? 'eyeOff' : 'eye', 18);
    };
  }
};

/* ------------------------------------------------------------------ HOME --- */
SCREENS.home = {
  tab: 'home',
  get chrome() { return APP.role === 'admin' ? false : undefined; },
  render() { return HOME[APP.role](); },
  mount(el) {
    if (APP.role === 'baker') { wireProductionRows(el); return; }
    $('[data-review-audit]', el)?.addEventListener('click', (e) => auditSummarySheet(e.currentTarget.dataset.reviewAudit));
    const plot = $('.cc-plot', el);
    wireChart(plot, ({ v, l }) => `<b>${money(v)}</b><em>${l}</em>`);
    /* stat tiles reveal in sequence */
    $$('[data-reveal]', el).forEach((n, i) => {
      n.style.animation = `tab-in 420ms var(--ease-out) ${60 + i * 55}ms both`;
    });
  }
};

function homeHead(subline) {
  const u = user();
  return `<header class="greet">
    <div class="g-top">
      <span class="ctx-pill" ${APP.role === 'owner' ? 'data-open-branch-picker' : 'style="cursor:default"'}>
        <span class="cp-mono">${APP.org.init}</span>
        <span class="cp-txt">${APP.org.name.split(' ')[0]} <em>· ${APP.role === 'owner' ? (APP.viewBranch === 'All' ? 'All branches' : APP.viewBranch) : APP.branch}</em></span>
      </span>
      <div class="spacer"></div>
      ${syncChip()}
      <button class="iconbtn" data-nav="search" aria-label="Search">${icon('search', 19)}</button>
      <button class="iconbtn -tinted" data-nav="notifications" aria-label="Notifications${APP.unreadIds.size ? `, ${APP.unreadIds.size} unread` : ''}" style="position:relative">
        ${icon('bell', 19)}${APP.unreadIds.size ? `<i class="dot -live" style="position:absolute;top:8px;right:9px"></i>` : ''}
      </button>
    </div>
  </header>`;
}

/* ------------------------------------------------------------- SEARCH --- */
/* One search across every entity the app has, scoped to what each role can
   already see (own orders for a Salesperson, own records for a Baker, etc). */
const SEARCH_CATEGORIES = {
  customers: { label:'Customers', roles:['owner','manager','staff','driver'],
    rows: () => DB.customers,
    match: (c, q) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q),
    render: c => ({ icon:'user', title:c.name, sub:c.phone, nav:'customer', params:{ id:c.id } }) },
  orders: { label:'Orders', roles:['owner','manager','staff'],
    rows: () => APP.role === 'staff' ? DB.orders.filter(o => o.staff === user().id) : DB.orders,
    match: (o, q) => o.ref.toLowerCase().includes(q) || C(o.cust).name.toLowerCase().includes(q),
    render: o => ({ icon:'bag', title:o.ref, sub:`${C(o.cust).name} · ${money(o.total)}`, nav:'order', params:{ id:o.id } }) },
  products: { label:'Products', roles:['owner','manager','staff'],
    rows: () => DB.products,
    match: (p, q) => p.name.toLowerCase().includes(q),
    render: p => ({ icon:'box', title:p.name, sub:`${money(p.price)} · ${p.stock} ${p.unit}${p.stock === 1 ? '' : 's'} left`, nav:'product-detail', params:{ id:p.id } }) },
  tickets: { label:'Tickets', roles:['driver'],
    rows: () => DB.tickets,
    match: (t, q) => t.ref.toLowerCase().includes(q) || C(t.cust).name.toLowerCase().includes(q),
    render: t => ({ icon:'ticket', title:t.ref, sub:C(t.cust).name, nav:'tickets', params:{ q:t.ref }, tab:true }) },
  deliveries: { label:'Deliveries', roles:['owner','manager','supervisor','driver'],
    rows: () => DB.driverRoute,
    match: (r, q) => r.cust.toLowerCase().includes(q) || r.area.toLowerCase().includes(q) || (r.phone || '').includes(q),
    render: r => ({ icon:'truck', title:r.cust, sub:`${r.area} · ${money(r.amount)}`, nav: APP.role === 'driver' ? 'route' : 'delivery-monitor', params:{}, tab:true }) },
  production: { label:'Production', roles:['baker','supervisor'],
    rows: () => APP.role === 'baker' ? DB.myProduction : DB.productionBatches,
    match: (r, q) => (r.product || '').toLowerCase().includes(q),
    render: r => APP.role === 'baker'
      ? { icon:'flame', title:r.product, sub:`${r.qty} ${pluralUnit(r.unit, r.qty)} · ${r.time}`, action:'record', id:r.id }
      : { icon:'flame', title:r.product, sub:`${r.qty} units · ${r.status.replace('_',' ')}`, nav:'production-monitor', params:{}, tab:true } },
};
SCREENS.search = {
  render(p) {
    const raw = p?.q || '';
    const q = raw.trim().toLowerCase();
    const cats = Object.values(SEARCH_CATEGORIES).filter(c => c.roles.includes(APP.role));
    const groups = q ? cats.map(cat => ({ label:cat.label, hits:cat.rows().filter(r => cat.match(r, q)).slice(0, 6).map(cat.render) })).filter(g => g.hits.length) : [];
    return `${appbar({ title:'Search' })}
    <div class="body">
      <div class="searchbar" style="margin-top:var(--s-2)"><input id="gs-q" value="${esc(raw)}" autofocus>${icon('search', 17)}</div>
      ${!q ? `<p class="meta" style="margin-top:var(--s-4)">Search ${cats.map(c => c.label.toLowerCase()).join(', ')}.</p>`
        : groups.length ? groups.map(g => `
          <div class="group-label"><span class="eyebrow">${g.label}</span><i></i></div>
          <div class="list">${g.hits.map(h => `<button class="li" data-res data-nav="${h.nav || ''}" data-tab="${h.tab ? '1' : ''}" data-params='${esc(JSON.stringify(h.params || {}))}' data-action="${h.action || ''}" data-action-id="${h.id || ''}">
            <span class="itile -sm">${icon(h.icon, 16)}</span>
            <span class="li-main"><b>${esc(h.title)}</b><span>${esc(h.sub || '')}</span></span>
            <span class="chev">${icon('chevRight', 17)}</span>
          </button>`).join('')}</div>`).join('')
        : `<div class="empty"><div class="e-art">${icon('search', 30, { stroke:1.4 })}</div><h4>No matches</h4><p>Try a different name, reference or phone number.</p></div>`}
    </div>`;
  },
  mount(el) {
    const input = $('#gs-q', el);
    let t;
    input.oninput = () => { clearTimeout(t); t = setTimeout(() => nav('search', { q: input.value }, 'replace'), 180); };
    $$('[data-res]', el).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.action === 'record') { openRecordDetail(b.dataset.actionId); return; }
      if (!b.dataset.nav) return;
      nav(b.dataset.nav, JSON.parse(b.dataset.params || '{}'), b.dataset.tab ? 'tab' : 'push');
    }));
  }
};

const HOME = {};

/* ---- OWNER: finance-led. The business, not the shift. ------------------- */
HOME.owner = () => {
  const t = DB.today, w = DB.week, ai = 4;
  const vb = APP.viewBranch;
  const branchData = vb !== 'All' ? DB.branches.find(b => b.k === vb) : null;
  if (branchData) return ownerHomeBranch(branchData);
  return `${homeHead(`${APP.org.name} · Friday, 11 August`)}
  <div class="body -with-tabbar -flush">
    <div class="flush-pad">

      <!-- HERO: revenue with the flow curve -->
      <section class="hero-panel" aria-label="Today's revenue">
        <div class="hp-top">
          <div style="flex:1">
            <div class="hp-label">Revenue today</div>
            <div class="hero-figure num" data-figure="${t.revenue}" data-from="${t.revenue * .82}">${money(t.revenue)}</div>
            <div class="hp-sub">Against ₦381,200 yesterday</div>
          </div>
          ${deltaChip(12.4, true)}
        </div>
        <div class="hp-chart cc-plot">
          ${lineChart({ series: w.map(d => ({ v:d.v })), labels: w.map(d => d.d), ghost: DB.weekPrev,
                        onDark:true, activeIndex: ai, h:118, aria:'Revenue across the last seven days' })}
        </div>
        <div style="margin:0 -20px">${xAxis(w.map(d => d.d), ai)}</div>
        <div class="hp-foot">
          <div><div class="v num">${money(t.expenses)}</div><div class="k">Expenses</div></div>
          <div class="hp-divider"></div>
          <div><div class="v num" style="color:#8FD8B4">${money(t.net)}</div><div class="k">Net today</div></div>
          <div class="hp-divider"></div>
          <div><div class="v num">${money(t.cashPosition)}</div><div class="k">Cash on hand</div></div>
        </div>
      </section>

      <!-- OPERATIONAL METRICS -->
      <section class="section">
        <div class="section-head"><h3>Your bakery today</h3><div class="spacer"></div>
          <button class="link" data-nav="orders" data-nav-mode="tab">Orders</button></div>
        <div class="grid-2">
          <button class="stat" data-reveal data-nav="orders" data-nav-mode="tab">
            <div class="s-top"><span class="s-ico">${icon('orders', 15)}</span><span class="k">Orders</span></div>
            <div class="v num" data-figure="${t.orders}" data-plain="1">${t.orders}</div>
            <div class="sub">${t.completed} completed</div>
            <div class="mini-bar"><i style="width:${t.completed / t.orders * 100}%;background:var(--success)"></i></div>
          </button>
          <button class="stat -attention" data-reveal data-nav="orders" data-nav-params='{"filter":"pending"}'>
            <div class="s-top"><span class="s-ico">${icon('clock', 15)}</span><span class="k">Needs attention</span></div>
            <div class="v num" data-figure="${t.pending}" data-plain="1">${t.pending}</div>
            <div class="sub">2 past promised time</div>
            <div class="mini-bar"><i style="width:${t.pending / t.orders * 100}%;background:var(--warning)"></i></div>
          </button>
        </div>
      </section>

      <!-- PROFIT FLOW: the signature -->
      <section class="section">
        <div class="section-head"><h3>Where today's money went</h3><div class="spacer"></div>
          <button class="link" data-nav="pnl">Full P&amp;L</button></div>
        <div class="card">
          ${flowBar([
            { k:'Cost of goods',  v:171000, c:'var(--cocoa)' },
            { k:'Running costs',  v:96000,  c:'var(--apricot)' },
            { k:'Profit',         v:161500, c:'var(--success)' },
          ])}
          <div class="row" style="margin-top:var(--s-4);padding-top:var(--s-4);border-top:1px solid var(--border)">
            <div style="flex:1">
              <div class="label">Margin today</div>
              <div class="mid-figure num" style="margin-top:2px">37.7%</div>
            </div>
            <div style="text-align:right">
              <div class="label">30-day average</div>
              <div class="mid-figure num" style="margin-top:2px;color:var(--warm-gray)">39.0%</div>
            </div>
          </div>
        </div>
      </section>

    </div>

    <!-- INSIGHTS -->
    <section class="section">
      <div class="section-head flush-pad"><h3>Worth knowing</h3></div>
      <div class="insight-rail">${DB.insights.owner.map(insightCard).join('')}</div>
    </section>

    <div class="flush-pad">
      <!-- BRANCHES -->
      <section class="section">
        <div class="section-head"><h3>Branches</h3><div class="spacer"></div>
          <button class="link" data-nav="report-branches">Compare</button></div>
        <div class="card stack-2">
          ${DB.branches.map(b => `<div class="hbar">
            <span class="hb-k">${b.k}</span>
            <span class="hb-track"><i style="width:${b.pct}%;background:${b.k === APP.branch ? 'var(--apricot)' : 'var(--cocoa)'}"></i></span>
            <span class="hb-v">${moneyShort(b.rev)}</span>
          </div>`).join('')}
        </div>
      </section>

      ${quickActions([
        { k:'New order', icon:'plus',    tone:'-ink',    nav:'new-ticket' },
        { k:'Add expense', icon:'receipt', tone:'-accent', sheet:'expense' },
        { k:'Reports',   icon:'chart',   tone:'',        nav:'reports' },
      ])}
    </div>
  </div>`;
};

/* Owner viewing one specific branch: a smaller, ops-flavored slice of the
   same branch scoped by APP.viewBranch — not the full org rollup. */
function ownerHomeBranch(b) {
  return `${homeHead(`${APP.org.name} · ${b.k}`)}
  <div class="body -with-tabbar -flush">
    <div class="flush-pad">
      <section class="hero-panel" aria-label="${b.k} revenue today">
        <div class="hp-top">
          <div style="flex:1">
            <div class="hp-label">Revenue today · ${b.k}</div>
            <div class="hero-figure num">${money(b.rev)}</div>
            <div class="hp-sub">${b.orders} orders · ${b.staff} staff on shift</div>
          </div>
          ${deltaChip(b.delta, true)}
        </div>
        <div class="hp-foot">
          <div><div class="v num">${b.orders}</div><div class="k">Orders today</div></div>
          <div class="hp-divider"></div>
          <div><div class="v num">${b.staff}</div><div class="k">Staff on shift</div></div>
          <div class="hp-divider"></div>
          <div><div class="v num">${moneyShort(b.rev / Math.max(b.orders, 1))}</div><div class="k">Avg. order</div></div>
        </div>
      </section>

      ${quickActions([
        { k:'New order', icon:'plus',    tone:'-ink',    nav:'new-ticket' },
        { k:'Add expense', icon:'receipt', tone:'-accent', sheet:'expense' },
        { k:'Compare',   icon:'chart',   tone:'',        nav:'report-branches' },
      ])}
    </div>
  </div>`;
}

/* ---- MANAGER: operations-led. "What is happening right now?" ------------ */
HOME.manager = () => {
  const open = DB.orders.filter(o => o.when === 'today' && ['pending','preparing','ready','delivering'].includes(orderStatus(o)));
  return `${homeHead(`${APP.branch} branch · shift since 7:12 AM`)}
  <div class="body -with-tabbar -flush">
    <section class="section">
      <div class="section-head flush-pad"><h3>Needs a decision</h3></div>
      <div class="insight-rail">${DB.insights.manager.map(insightCard).join('')}</div>
    </section>
    <div class="flush-pad">

      <section class="card -ink" aria-label="Open work right now">
        <div class="row -top">
          <div style="flex:1">
            <div class="eyebrow" style="color:rgba(255,255,255,.5)">Open right now</div>
            <div class="hero-figure num" style="margin-top:6px">${open.length}</div>
            <div class="label" style="margin-top:4px">orders across ${APP.branch}</div>
          </div>
          <div style="text-align:right">
            <div class="row" style="justify-content:flex-end;gap:7px">
              <span class="dot -pending"></span><span style="font-size:var(--t-foot)">${DB.orders.filter(o=>o.when==='today'&&orderStatus(o)==='pending').length} pending</span>
            </div>
            <div class="row" style="justify-content:flex-end;gap:7px;margin-top:6px">
              <span class="dot -live"></span><span style="font-size:var(--t-foot)">${DB.orders.filter(o=>o.when==='today'&&orderStatus(o)==='ready').length} ready</span>
            </div>
            <div class="row" style="justify-content:flex-end;gap:7px;margin-top:6px">
              <span class="dot -ok"></span><span style="font-size:var(--t-foot)">${DB.orders.filter(o=>o.when==='today'&&orderStatus(o)==='delivering').length} out</span>
            </div>
          </div>
        </div>
        <button class="btn -accent -block" data-nav="orders" data-nav-mode="tab" style="margin-top:var(--s-4)">
          Work the queue ${icon('arrowRight', 16)}</button>
      </section>

      <section class="section">
        <div class="section-head"><h3>Next up</h3><div class="spacer"></div>
          <button class="link" data-nav="orders" data-nav-mode="tab">All orders</button></div>
        <div class="stack-3">${open.slice(0, 3).map(o => orderCard(o)).join('')}</div>
      </section>

      ${quickActions([
        { k:'New order',    icon:'plus',    tone:'-ink',    nav:'new-ticket' },
        { k:'Add expense',  icon:'receipt', tone:'-accent', sheet:'expense' },
        { k:'Cash session', icon:'cash',    tone:'-ok',     nav:'cash', mode:'tab' },
      ])}

      <section class="section">
        <div class="section-head"><h3>Daily financial audit</h3></div>
        ${(() => { const a = DB.dailyFinancialAudit;
          const hasSupervisor = DB.staffList.some(s => s.role === 'Supervisor');
          if (a.status === 'confirmed') return `<div class="li" style="background:var(--card);border-radius:var(--r-3);padding:var(--s-4)">
            <span class="itile -sm -ok">${icon('checkCircle', 16)}</span>
            <span class="li-main"><b>Confirmed</b><span>${a.submittedAt} · confirmed by ${a.confirmedBy}</span></span></div>`;
          if (a.status === 'submitted') return `<div class="card" style="padding:var(--s-4);display:flex;align-items:center;gap:13px">
            <span class="itile -sm -warn">${icon('clock', 16)}</span>
            <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">${a.submittedBy} submitted today's audit</b>
              <span class="label">Review and confirm it</span></span>
            <button class="btn -sm -primary" data-review-audit="confirm">Review</button>
          </div>`;
          return `<div class="card" style="padding:var(--s-4);display:flex;align-items:center;gap:13px">
            <span class="itile -sm">${icon('doc', 16)}</span>
            <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">Not submitted yet</b>
              <span class="label">${hasSupervisor ? "Waiting on the supervisor" : "No supervisor on shift \u2014 you'll submit and confirm it"}</span></span>
            ${hasSupervisor ? '' : `<button class="btn -sm -primary" data-review-audit="self">Review</button>`}
          </div>`;
        })()}
      </section>

      <section class="section">
        <div class="grid-2">
          <button class="stat" data-nav="sales" data-nav-mode="tab">
            <div class="s-top"><span class="s-ico">${icon('sales', 15)}</span><span class="k">Sales today</span></div>
            <div class="v num" data-figure="${DB.today.revenue}" data-short="1">${moneyShort(DB.today.revenue)}</div>
            <div class="sub">${DB.today.orders} transactions</div>
          </button>
          <button class="stat ${DB.cash.diff !== 0 ? '-attention' : ''}" data-nav="cash" data-nav-mode="tab">
            <div class="s-top"><span class="s-ico">${icon('cash', 15)}</span><span class="k">Cash drawer</span></div>
            <div class="v num">${moneyShort(DB.cash.actual)}</div>
            <div class="sub" ${DB.cash.diff !== 0 ? 'style="color:var(--error)"' : ''}>${DB.cash.diff !== 0 ? `${money(DB.cash.diff)} against expected` : 'Balances'}</div>
          </button>
        </div>
      </section>
    </div>

    <section class="section">
      <div class="section-head flush-pad"><h3>Driver trip</h3></div>
      <div class="flush-pad">
        <button class="li" data-nav="trip-verify" style="width:100%;text-align:left">
          <span class="itile -sm ${DB.driverTrip.status === 'reconciled' ? '-warn' : ''}">${icon('truck', 16)}</span>
          <span class="li-main"><b>${TRIP_STAGE[DB.driverTrip.status].label}</b><span>${DB.driverTrip.status === 'reconciled' ? 'Waiting on you to settle the trip' : 'Verify loading and reconcile the trip'}</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>
      </div>
    </section>

    <div class="flush-pad">
      <section class="section">
        <div class="section-head"><h3>Low stock</h3><div class="spacer"></div>
          <button class="link" data-nav="products">Products</button></div>
        <div class="list">${DB.products.filter(p => p.stock <= 9).slice(0, 4).map(p => `
          <button class="li" data-nav="product-detail" data-nav-params='{"id":"${p.id}"}'>
            <span class="itile -sm ${p.stock === 0 ? '-bad' : '-warn'}">${icon(p.stock === 0 ? 'alert' : 'box', 16)}</span>
            <span class="li-main"><b>${p.name}</b><span>${p.cat} · sold ${p.sold} this month</span></span>
            <span class="li-end"><b class="${p.stock === 0 ? 'neg' : ''}">${p.stock === 0 ? 'Out' : p.stock + ' left'}</b>
              <span>${money(p.price)}</span></span>
          </button>`).join('')}
        </div>
      </section>
    </div>
  </div>`;
};

/* ---- SUPERVISOR: operations-led. "Is today running normally?" --------- */
HOME.supervisor = () => {
  const lowStock = DB.products.filter(p => p.stock <= 9);
  const activeBatches = DB.productionBatches.filter(b => b.status === 'in_progress');
  const batchIssues = DB.productionBatches.filter(b => b.status === 'failed');
  const activeDeliveries = DB.driverRoute.filter(r => r.status === 'in_transit' || r.status === 'assigned');
  const deliveryIssues = DB.driverRoute.filter(r => r.status === 'failed');
  const staffAttention = DB.staffList.filter(s => s.status === 'Off shift' && s.role !== 'Branch Manager');
  const salesTotal = DB.mySales.reduce((s, x) => s + x.total, 0);
  const alerts = [
    ...lowStock.map(p => ({ i:'box', tone:'-warn', t:`${p.name} is low`, s:`${p.stock} ${p.unit}s left`, nav:'product-detail', id:p.id })),
    ...batchIssues.map(b => ({ i:'flame', tone:'-bad', t:`${b.product} batch failed`, s: b.reason, nav:'production-monitor' })),
    ...deliveryIssues.map(r => ({ i:'truck', tone:'-bad', t:`Delivery to ${r.cust} failed`, s: r.failureReason || 'Needs follow-up', nav:'delivery-monitor' })),
  ];

  return `${homeHead(`${APP.org.name} · Ikeja branch`)}
  <div class="body -with-tabbar -flush">
    <div class="flush-pad">
      <section class="card -ink">
        <div class="row -top">
          <div style="flex:1">
            <div class="eyebrow" style="color:rgba(255,255,255,.5)">Today's operation</div>
            <div class="hero-figure num" style="margin-top:6px">${money(salesTotal)}</div>
            <div class="label" style="margin-top:4px">${DB.mySales.length} sales · ${activeBatches.length} batches running · ${activeDeliveries.length} deliveries out</div>
          </div>
          <span class="itile" style="background:rgba(255,255,255,.12);color:#fff;width:44px;height:44px;border-radius:14px">${icon('layers', 21)}</span>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Operations</h3></div>
        <div class="grid-2">
          <div class="stat" data-nav="sales-monitor" style="cursor:pointer">
            <div class="s-top"><span class="s-ico">${icon('sales', 15)}</span><span class="k">Sales today</span></div>
            <div class="v num">${money(salesTotal)}</div><div class="sub">${DB.mySales.length} transactions</div>
          </div>
          <div class="stat ${lowStock.length ? '-attention' : ''}" data-nav="inventory-monitor" style="cursor:pointer">
            <div class="s-top"><span class="s-ico">${icon('box', 15)}</span><span class="k">Inventory warnings</span></div>
            <div class="v num">${lowStock.length}</div><div class="sub">Products low or out</div>
          </div>
          <div class="stat" data-nav="production-monitor" style="cursor:pointer">
            <div class="s-top"><span class="s-ico">${icon('flame', 15)}</span><span class="k">Production</span></div>
            <div class="v num">${activeBatches.length}</div><div class="sub">Batches in progress</div>
          </div>
          <div class="stat" data-nav="delivery-monitor" style="cursor:pointer">
            <div class="s-top"><span class="s-ico">${icon('truck', 15)}</span><span class="k">Deliveries</span></div>
            <div class="v num">${activeDeliveries.length}</div><div class="sub">Active right now</div>
          </div>
        </div>
      </section>

      ${alerts.length ? `<section class="section">
        <div class="section-head"><h3>Needs attention</h3></div>
        <div class="list">
          ${alerts.slice(0, 4).map(a => `<button class="li" ${a.id ? `data-nav="${a.nav}" data-nav-params='{"id":"${a.id}"}'` : `data-nav="${a.nav}"`}>
            <span class="itile -sm ${a.tone}">${icon(a.i, 16)}</span>
            <span class="li-main"><b>${a.t}</b><span>${a.s}</span></span>
            <span class="chev">${icon('chevRight', 17)}</span>
          </button>`).join('')}
        </div>
      </section>` : ''}

      <section class="section">
        <div class="section-head"><h3>Daily financial audit</h3></div>
        ${(() => { const a = DB.dailyFinancialAudit;
          if (a.status === 'confirmed') return `<div class="li" style="background:var(--card);border-radius:var(--r-3);padding:var(--s-4)">
            <span class="itile -sm -ok">${icon('checkCircle', 16)}</span>
            <span class="li-main"><b>Confirmed</b><span>Submitted ${a.submittedAt} · confirmed by a manager</span></span></div>`;
          if (a.status === 'submitted') return `<div class="li" style="background:var(--card);border-radius:var(--r-3);padding:var(--s-4)">
            <span class="itile -sm -warn">${icon('clock', 16)}</span>
            <span class="li-main"><b>Submitted, awaiting confirmation</b><span>Submitted ${a.submittedAt} by ${a.submittedBy}</span></span></div>`;
          return `<div class="card" style="padding:var(--s-4);display:flex;align-items:center;gap:13px">
            <span class="itile -sm">${icon('doc', 16)}</span>
            <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">Not submitted yet</b>
              <span class="label">Today's cash, sales and expenses need a submitted audit</span></span>
            <button class="btn -sm -primary" data-review-audit="submit">Review</button>
          </div>`;
        })()}
      </section>
    </div>
  </div>`;
};

/* ---- STAFF: task-led. No financial complexity they don't need. --------- */
HOME.staff = () => {
  const sales = DB.mySales;
  const total = sales.reduce((s, x) => s + x.total, 0);
  const myOrders = DB.orders.filter(o => o.staff === user().id);
  const activeOrders = myOrders.filter(o => ['pending','preparing','ready','delivering'].includes(orderStatus(o)));
  const continuing = APP.sale && APP.sale.lines.length;
  return `${homeHead()}
  <div class="body -with-tabbar -flush">
    <div class="flush-pad">
      <div class="grid-2">
        <div class="stat" style="background:var(--cocoa);color:#fff;box-shadow:none;grid-column:1 / -1">
          <div class="s-top"><span class="k" style="color:rgba(255,255,255,.6)">Today's sales</span></div>
          <div class="v num" style="color:#fff">${money(total)}</div>
          <div class="sub" style="color:rgba(255,255,255,.55)">${sales.length} transaction${sales.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <section class="section">
        ${continuing ? `<button class="btn -secondary -block" style="margin-bottom:var(--s-3)" data-nav="new-sale">${icon('bag', 17)} Continue sale · ${APP.sale.lines.length} item${APP.sale.lines.length === 1 ? '' : 's'}</button>` : ''}
        <button class="btn -primary -block -lg" data-nav="new-sale">${icon('plus', 18)} Record sale</button>
        <button class="btn -secondary -block -lg" style="margin-top:var(--s-3)" data-nav="new-customer-order">${icon('user', 18)} New customer order</button>
      </section>

      <section class="section">
        <div class="section-head"><h3>Recent sales</h3><div class="spacer"></div>
          <button class="link" data-nav="my-sales" data-nav-mode="tab">All</button></div>
        <div class="list">
          ${sales.slice(0, 5).map(s => `<div class="li">
            <span class="itile -sm">${icon('receipt', 16)}</span>
            <span class="li-main"><b>${s.ref}</b><span>${s.cust} · ${s.time}</span></span>
            <span class="li-end"><b>${money(s.total)}</b><span>${s.method}</span></span>
          </div>`).join('')}
        </div>
      </section>
    </div>

  </div>`;
};

/* ---- BAKER: production-led. Open, see today, record, done. ------------ */
HOME.baker = () => {
  const batches = DB.productionBatches;
  const records = DB.myProduction;
  const total = records.reduce((s, r) => s + r.qty, 0);
  const recordedCount = batches.filter(b => b.status === 'completed').length;
  return `${homeHead()}
  <div class="body -with-tabbar -flush">
    <div class="flush-pad">
      <div class="stat" style="background:var(--cocoa);color:#fff;box-shadow:none">
        <div class="s-top"><span class="k" style="color:rgba(255,255,255,.6)">Today's production</span></div>
        <div class="v num" style="color:#fff;font-size:var(--t-title-1)">${total.toLocaleString()}</div>
        <div class="sub" style="color:rgba(255,255,255,.55)">units recorded · ${recordedCount} batch${recordedCount === 1 ? '' : 'es'}</div>
      </div>

      <section class="section">
        <button class="btn -primary -block -lg" data-nav="record-production">${icon('plus', 18)} Record production</button>
      </section>
    </div>
  </div>`;
};
function batchCard(b) {
  const statusLabel = { scheduled:'Not recorded', in_progress:'In progress', completed:'Recorded', failed:'Failed' }[b.status];
  const tone = { scheduled:'', in_progress:'-accent', completed:'-ok', failed:'-bad' }[b.status];
  return `<div class="card" style="padding:14px var(--s-4)">
    <div class="row">
      <span class="itile -sm ${tone}">${icon('flame', 16)}</span>
      <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">${b.product}</b>
        <span class="label">${b.id.replace('pb', 'Batch ')} · ${statusLabel}${b.status === 'completed' ? ` · ${b.producedQty} units` : ''}</span></span>
      ${b.status === 'failed' ? `<span class="badge -bad">${icon('alert', 11)}Failed</span>`
        : b.status === 'completed' ? '' : `<button class="btn -sm -secondary" data-record-batch="${b.id}">Record output</button>`}
    </div>
    ${b.reason ? `<p class="meta" style="margin-top:8px">${b.reason}</p>` : ''}
  </div>`;
}
function productionRecordRow(r) {
  return `<button class="li" data-record-detail="${r.id}">
    <span class="itile -sm">${icon('flame', 16)}</span>
    <span class="li-main"><b>${r.product}</b><span>${r.batchId.replace('pb', 'Batch ')} · ${r.time}</span></span>
    <span class="li-end"><b>${r.qty} ${pluralUnit(r.unit, r.qty)}</b>${r.correction ? `<span>Corrected</span>` : ''}</span>
  </button>`;
}

/* ---- ADMIN: administration console, not another operations dashboard.
   Org settings, staff CRUD, and the two permissions nobody else holds
   (ticket archiving here; permanent delete skipped \u2014 too destructive to
   fake convincingly in a prototype). No tab bar \u2014 a hub screen instead. */
HOME.admin = () => {
  const pendingArchive = DB.orders.filter(o => o.status === 'cancelled' && !o.archived).length;
  const sections = [
    { icon:'store', title:'Organization & branches', sub:`${APP.org.name} \u00b7 ${APP.org.branches.length} branches`, nav:'admin-org' },
    { icon:'users', title:'Staff & access', sub:`${DB.staffList.length} people \u00b7 create, edit or remove`, nav:'admin-staff' },
    { icon:'box', title:'Records', sub: pendingArchive ? `${pendingArchive} cancelled ticket${pendingArchive === 1 ? '' : 's'} to archive` : 'Nothing pending', nav:'admin-records' },
    { icon:'history', title:'Audit log', sub:`${DB.auditLog.length} recorded actions`, nav:'audit' },
    { icon:'settings', title:'System settings', sub:'Supervisor role, org-level switches', nav:'admin-settings' },
  ];
  return `${appbar({ title:'Admin console', back:false, sub:APP.org.name, right: syncChip() })}
  <div class="body">
    <section class="section" style="margin-top:var(--s-2)">
      <p class="meta" style="margin-bottom:var(--s-3);line-height:1.5">Organization-wide administration \u2014 every branch, no operational dashboard. Day-to-day monitoring lives with Owner and Manager.</p>
      <div class="list">
        ${sections.map(s => `<button class="li" data-nav="${s.nav}" style="width:100%;text-align:left">
          <span class="itile -sm">${icon(s.icon, 16)}</span>
          <span class="li-main"><b>${s.title}</b><span>${s.sub}</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>`).join('')}
      </div>
    </section>
  </div>`;
};

/* ---- DRIVER: ticket-led. One thumb, minimum taps. --------------------- */
HOME.driver = () => {
  const t = DB.tickets;
  const route = DB.driverRoute.filter(r => r.driver === user().id);
  const trip = DB.driverTrip;
  const heldByYou = tripMoneyTotals().totals ? Object.values(tripMoneyTotals().totals).reduce((s, v) => s + v, 0) : 0;
  const pending = route.filter(r => r.status === 'assigned' || r.status === 'in_transit').length;
  const completed = route.filter(r => r.status === 'delivered').length;
  const toCollect = route.filter(r => r.paid !== 'paid' && r.status !== 'returned').reduce((s, r) => s + (r.amount - r.amountPaid), 0);
  const stageDone = ['reconciled', 'completed'].includes(trip.status);
  const stageNeedsAction = ['created', 'loading', 'ready_to_depart', 'returning', 'reconciled'].includes(trip.status);
  return `${homeHead('Lekki route · 3 stops today')}
  <div class="body -with-tabbar -flush">
    <div class="flush-pad">

      <button class="card -tap" data-nav="trip" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:var(--s-4);${stageNeedsAction ? 'box-shadow:var(--e-2), inset 0 0 0 1.5px var(--apricot)' : ''}">
        <span class="itile ${stageDone ? '-ok' : '-accent'}">${icon(stageDone ? 'check' : 'truck', 19)}</span>
        <span style="flex:1;min-width:0"><b style="display:block;font-size:var(--t-callout);font-weight:610">Trip · ${TRIP_STAGE[trip.status].label}</b>
          <span class="label">${stageNeedsAction ? 'Tap to continue' : trip.status === 'in_transit' ? `On the road since ${trip.departedAt}` : 'Trip closed'}${trip.status === 'in_transit' && heldByYou ? ` · ${money(heldByYou)} held by you` : ''}</span></span>
        <span class="chev">${icon('chevRight', 18)}</span>
      </button>

      <!-- One enormous primary action. This is the driver's whole job. -->
      <button class="drive-cta" data-nav="new-ticket" style="margin-top:var(--s-3)">
        <span class="dc-ico">${icon('plus', 26, { stroke: 2 })}</span>
        <span class="dc-txt"><b>Create ticket</b><span>Customer, products, payment</span></span>
        ${icon('arrowRight', 20)}
      </button>

      ${APP.sync === 'offline' ? `<div class="offline-note" style="margin-top:var(--s-3)">
        <span class="itile -sm">${icon('wifiOff', 16)}</span>
        <span class="on-txt"><b>Working offline</b><span>${APP.queued} ticket${APP.queued === 1 ? '' : 's'} saved on this phone</span></span>
        <button class="btn -sm -secondary" data-open-sync>Review</button>
      </div>` : ''}

      <section class="section">
        <div class="section-head"><h3>Your route</h3><div class="spacer"></div>
          <button class="link" data-nav="route" data-nav-mode="tab">Map view</button></div>
        <div class="card">
          <div class="timeline">
            ${route.map(r => `
              <div class="tl-item ${r.status === 'delivered' || r.status === 'returned' ? '-done' : r.status === 'in_transit' ? '-current' : '-todo'}">
                <span class="tl-node">${r.status === 'delivered' || r.status === 'returned' ? icon('check', 11, { stroke:2.6 }) : r.status === 'failed' ? icon('alert', 11, { stroke:2.6 }) : '<i></i>'}</span>
                <b>${r.cust}</b>
                <span>${r.address || r.area} · ${r.items}</span>
                <div class="row" style="margin-top:7px">
                  <span class="strong num" style="font-size:var(--t-callout)">${money(r.amount)}</span>
                  <span class="badge ${STOP_META[r.status].badge}">${STOP_META[r.status].label}</span>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Tickets today</h3><div class="spacer"></div>
          <button class="link" data-nav="tickets" data-nav-mode="tab">All</button></div>
        <div class="stat">
          <div class="s-top"><span class="s-ico">${icon('ticket', 15)}</span><span class="k">Created</span></div>
          <div class="v num">${t.length}</div><div class="sub">${t.filter(x => x.sync === 'pending').length} waiting to sync</div>
        </div>
      </section>
    </div>
  </div>`;
};

/* ------------------------------------------------------ shared partials --- */
function insightCard(i) {
  return `<article class="insight">
    <span class="in-ico ${i.tone ? 'itile ' + i.tone : 'itile'}">${icon(i.icon, 16)}</span>
    <div class="in-body">
      <b>${i.t}</b><p>${i.b}</p>
      ${i.act ? `<span class="in-act">${i.act} ${icon('arrowRight', 12)}</span>` : ''}
    </div>
  </article>`;
}

function quickActions(list) {
  return `<section class="section">
    <div class="section-head"><h3>Quick actions</h3></div>
    <div class="qa-strip">${list.map(a => `
      <button class="qa" ${a.nav ? `data-nav="${a.nav}"${a.mode ? ` data-nav-mode="${a.mode}"` : ''}` : `data-qa-sheet="${a.sheet}"`}>
        <span class="qa-ico ${a.tone}">${icon(a.icon, 17)}</span><b>${a.k}</b>
      </button>`).join('')}
    </div>
  </section>`;
}

function orderCard(o) {
  const c = C(o.cust), st = orderStatus(o);
  const urgent = st === 'pending' && o.when === 'today';
  return `<button class="order-card ${urgent ? '-urgent' : st === 'ready' ? '-flag-live' : ''}"
      data-nav="order" data-nav-params='{"id":"${o.id}"}'>
    <div class="oc-head">
      <span class="avatar -${c.tone}">${c.init}</span>
      <div style="flex:1;min-width:0">
        <div class="oc-id">${o.ref}${o.channel ? ` · ${o.channel}` : ''}</div>
        <div class="oc-name">${c.name}</div>
      </div>
      ${statusBadge(st)}
    </div>
    <div class="oc-items">${itemLine(o.items)}</div>
    <div class="oc-foot">
      <span class="oc-amt num">${money(o.total)}</span>
      ${o.paid !== 'paid' ? payBadge(o.paid) : ''}
      <span class="spacer"></span>
      <span class="oc-time">${icon('clock', 12)} ${o.time}</span>
    </div>
  </button>`;
}

/* --------------------------------------------------------- ORG SWITCHER --- */
SCREENS.org = {
  chrome: false,
  render() {
    return `${appbar({ title:'Bakeries', right:`<button class="iconbtn" data-back aria-label="Close">${icon('close', 20)}</button>`, back:false })}
    <div class="body">
      <div class="card" style="padding:var(--s-5)">
        <div class="eyebrow">Current bakery</div>
        <div class="row" style="margin-top:var(--s-3)">
          <span class="avatar -lg -ink">${APP.org.init}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:var(--t-title-3);font-weight:640;letter-spacing:-.018em">${APP.org.name}</div>
            <div class="label">${APP.org.city} · ${APP.org.role}</div>
          </div>
        </div>
        <div class="row" style="margin-top:var(--s-4);gap:var(--s-2)">
          ${APP.org.branches.map(b => `<button class="chip" data-branch="${b}" aria-pressed="${b === APP.branch}">
            ${icon('store', 13)}${b}</button>`).join('')}
        </div>
      </div>

      <div class="group-label"><span class="eyebrow">Switch bakery</span><i></i></div>
      <div class="card">
        ${DB.orgs.map(o => `
          <button class="org-row" data-org="${o.id}">
            <span class="avatar -${o.id === APP.org.id ? 'ink' : 'e'}">${o.init}</span>
            <span class="o-main"><b>${o.name}</b>
              <span>${o.city} · ${o.branches.length} branch${o.branches.length > 1 ? 'es' : ''} · ${o.role}</span></span>
            ${o.id === APP.org.id
              ? `<span class="o-check">${icon('check', 12, { stroke:2.6 })}</span>`
              : `<span class="num strong" style="font-size:var(--t-foot);color:var(--warm-gray)">${moneyShort(o.today)}</span>`}
          </button>`).join('')}
      </div>
      <p class="meta" style="margin-top:var(--s-3);padding:0 2px;line-height:1.55">
        Switching bakery changes your context only. Nothing is signed out, and unsynced work stays safely on this phone.</p>

      <div class="group-label"><span class="eyebrow">Account</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'user', title:user().name, sub:`${user().title} · ${APP.org.name}`, nav:'settings' })}
        ${menuItem({ icon:'plus', title:'Join another bakery', sub:'With an invite code', toast:'Invite code' })}
        ${menuItem({ icon:'logout', title:'Sign out', sub:'', nav:'login', mode:'fade' })}
      </div>
    </div>`;
  },
  mount(el) {
    $$('[data-org]', el).forEach(b => b.onclick = () => {
      const o = DB.orgs.find(x => x.id === b.dataset.org);
      if (o.id === APP.org.id) { back(); return; }
      APP.org = o; APP.branch = o.branches[0];
      DB.today.revenue = o.today;
      nav('home', {}, 'fade');
      setTimeout(() => toast({ title:`Now in ${o.name}`, text:`${o.branches[0]} branch · ${o.role}` }), 420);
    });
    $$('[data-branch]', el).forEach(b => b.onclick = () => {
      APP.branch = b.dataset.branch;
      $$('[data-branch]', el).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      toast({ title:`${APP.branch} branch`, text:'Figures now show this branch only' });
    });
  }
};

function menuItem({ icon: ic, title, sub, nav: to, mode, tone = '', badge = '', toast: tt, sheet: sh }) {
  const attr = to ? `data-nav="${to}"${mode ? ` data-nav-mode="${mode}"` : ''}`
             : tt ? `data-toast="${tt}"` : sh ? `data-qa-sheet="${sh}"` : '';
  return `<button class="menu-item" ${attr}>
    <span class="itile -sm ${tone}">${icon(ic, 16)}</span>
    <span class="m-txt"><b>${title}</b></span>
    ${badge ? `<span class="m-badge">${badge}</span>` : ''}
    <span class="chev">${icon('chevRight', 17)}</span>
  </button>`;
}

/* ------------------------------------------------------------------ MORE --- */
SCREENS.more = {
  tab: 'more',
  render() {
    const isOwner = APP.role === 'owner';
    const isManager = APP.role === 'manager';
    const canManageStaff = isOwner || isManager;       // staff.view/staff.manage
    const canFinance = isOwner || isManager;           // financial.expense.*, full P&L
    const canViewCashAndReports = canFinance || APP.role === 'staff'; // cashier: financial.view + reports.view + own cash session
    return `${appbar({ title:'More', back:false, right: syncChip() })}
    <div class="body -with-tabbar">
      <button class="card -tap" data-nav="settings" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;padding:var(--s-4)">
        <span class="avatar -lg -${user().tone}">${user().init}</span>
        <span style="flex:1;min-width:0">
          <b style="display:block;font-size:var(--t-title-3);font-weight:640;letter-spacing:-.018em">${user().name}</b>
          <span class="label">${user().title} · ${APP.org.name}</span></span>
        <span class="chev">${icon('chevRight', 18)}</span>
      </button>

      <div class="group-label"><span class="eyebrow">Operations</span><i></i></div>
      <div class="menu">
        ${APP.role !== 'driver' ? menuItem({ icon:'box',   title:'Products',  sub:`${DB.products.length} items · 2 low on stock`, nav:'products', tone:'-accent' }) : ''}
        ${menuItem({ icon:'users', title:'Customers', sub:`${DB.customers.length} customers`, nav:'customers' })}
        ${canManageStaff ? menuItem({ icon:'user', title:'Staff & activity', sub:'5 people · 3 on shift', nav:'staff' }) : ''}
      </div>

      ${APP.role === 'driver' ? `
      <div class="group-label"><span class="eyebrow">You</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'bell',    title:'Notifications', nav:'notifications' })}
        ${menuItem({ icon:'history', title:'My activity',   nav:'my-activity' })}
        ${menuItem({ icon:'user',    title:'Profile',       nav:'profile' })}
      </div>` : ''}

      ${canViewCashAndReports ? `
      <div class="group-label"><span class="eyebrow">Money</span><i></i></div>
      <div class="menu">
        ${canViewCashAndReports ? menuItem({ icon:'cash',    title:'Cash sessions', sub:'Open · ₦340,000 counted', nav:'cash', tone:'-warn' }) : ''}
        ${canFinance ? menuItem({ icon:'receipt', title:'Expenses',      sub:'₦96,000 today', nav:'expenses' }) : ''}
        ${isOwner ? menuItem({ icon:'scale', title:'Profit & Loss', sub:'This month · ₦1.88M net', nav:'pnl', tone:'-ok' }) : ''}
        ${menuItem({ icon:'chart',   title:'Reports',       sub:'7 reports available', nav:'reports' })}
      </div>` : ''}

      <div class="group-label"><span class="eyebrow">Bakery</span><i></i></div>
      <div class="menu">
        ${APP.role !== 'driver' ? menuItem({ icon:'store', title:'Organisation', sub:`${APP.org.name} · ${APP.org.branches.length} branches`, nav:'org', mode:'fade' }) : ''}
        ${menuItem({ icon:'settings', title:'Settings',     sub:'Pricing, sync, notifications', nav:'settings' })}
        ${menuItem({ icon:'cloudSync',title:'Sync & offline',sub: APP.sync === 'synced' ? 'Everything is up to date' : 'Changes waiting', sheet:'sync' })}
      </div>

      <div class="group-label"><span class="eyebrow">Prototype</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'layers', title:'Design system', sub:'Colour, type, components', nav:'ds' })}
        ${menuItem({ icon:'alert',  title:'States gallery', sub:'Loading, empty, error, offline', nav:'states' })}
      </div>
      <p class="meta" style="margin:var(--s-4) 2px 0;line-height:1.55">BakeFlow prototype · v0.9 · Built for Sweet Crumbs Bakery, Lagos.</p>
    </div>`;
  }
};

function auditSummarySheet(mode = 'submit') {
  const isConfirm = mode === 'confirm';
  const isSelf = mode === 'self';
  const salesTotal = branchSalesToday();
  const byMethod = branchSalesByMethod;
  const methodSum = byMethod('Cash') + byMethod('Transfer') + byMethod('POS');
  const methodsMismatch = methodSum !== salesTotal;
  const todaysExp = DB.expenses.rows.filter(r => r.time.startsWith('Today'));
  const expTotal = todaysExp.reduce((s, x) => s + x.amount, 0);
  const cash = DB.cash;
  const cashOk = cash.diff === 0;
  const yesterday = DB.cash.history[0]?.actual || 0;
  const salesDelta = yesterday ? Math.round(((salesTotal - yesterday) / yesterday) * 100) : null;
  const openDrawers = cash.openDrawers;
  const blocking = openDrawers.length > 0;
  const flagged = !cashOk || methodsMismatch;
  const now = new Date();
  const stamp = now.toLocaleTimeString('en-NG', { hour:'numeric', minute:'2-digit' });

  sheet({
    title: isConfirm ? 'Confirm today\'s audit' : 'Review today\'s audit',
    tall: true,
    body: `<p class="meta" style="margin-bottom:2px">${APP.branch} · Today, ${stamp}</p>
      <p class="meta" style="margin-bottom:var(--s-4)">${isConfirm ? `Submitted by ${DB.dailyFinancialAudit.submittedBy}. ` : ''}Check every figure against what actually happened today${isConfirm ? '' : ' — a manager confirms this next and any mistake becomes their problem too'}.</p>

      ${blocking ? `<div class="li" style="background:var(--error-tint);border-radius:var(--r-3);margin-bottom:var(--s-4)">
        <span class="itile -sm -bad">${icon('alert', 16)}</span>
        <span class="li-main"><b>Can't ${isConfirm ? 'confirm' : 'submit'} yet</b><span>${openDrawers.map(d => d.name).join(' and ')} still ${openDrawers.length > 1 ? 'have' : 'has'} an open drawer — that cash hasn't reached the till</span></span>
      </div>` : flagged ? `<div class="li" style="background:var(--error-tint);border-radius:var(--r-3);margin-bottom:var(--s-4)">
        <span class="itile -sm -bad">${icon('alert', 16)}</span>
        <span class="li-main"><b>Needs attention before you ${isConfirm ? 'confirm' : 'submit'}</b><span>${!cashOk ? `Till variance of ${money(Math.abs(cash.diff))}` : ''}${!cashOk && methodsMismatch ? ' · ' : ''}${methodsMismatch ? 'Payment methods don\u2019t add up to total sales' : ''}</span></span>
      </div>` : `<div class="li" style="background:var(--success-tint);border-radius:var(--r-3);margin-bottom:var(--s-4)">
        <span class="itile -sm -ok">${icon('checkCircle', 16)}</span>
        <span class="li-main"><b>Everything balances</b><span>Cash till and payment totals check out</span></span>
      </div>`}

      <div class="section-head" style="padding:0 0 var(--s-2)"><h3 style="font-size:var(--t-footnote);text-transform:uppercase;letter-spacing:.02em;color:var(--ink-3)">Sales</h3></div>
      <div class="list" style="margin-bottom:var(--s-4)">
        <div class="li"><span class="li-main"><b>Total sales</b><span>${DB.cash.closedDrawers.length + DB.cash.openDrawers.length} staff tills${salesDelta !== null ? ` · ${salesDelta >= 0 ? '+' : ''}${salesDelta}% vs yesterday` : ''}</span></span><span class="num" style="font-weight:610">${money(salesTotal)}</span></div>
        <div class="li"><span class="li-main"><b>Cash</b></span><span class="num">${money(byMethod('Cash'))}</span></div>
        <div class="li"><span class="li-main"><b>Transfer</b></span><span class="num">${money(byMethod('Transfer'))}</span></div>
        <div class="li"><span class="li-main"><b>POS</b></span><span class="num">${money(byMethod('POS'))}</span></div>
        ${methodsMismatch ? `<div class="li"><span class="itile -sm -bad">${icon('alert', 16)}</span><span class="li-main"><b>Methods don't match total</b><span>${money(methodSum)} across methods vs ${money(salesTotal)} total</span></span></div>` : ''}
      </div>

      <div class="section-head" style="padding:0 0 var(--s-2)"><h3 style="font-size:var(--t-footnote);text-transform:uppercase;letter-spacing:.02em;color:var(--ink-3)">Cash till</h3></div>
      <div class="list" style="margin-bottom:var(--s-4)">
        <div class="li"><span class="li-main"><b>Opening balance</b><span>${cash.openedBy} · ${cash.openedAt}</span></span><span class="num">${money(cash.open)}</span></div>
        <div class="li"><span class="li-main"><b>+ Cash sales</b></span><span class="num">${money(cash.sales, { plus: true })}</span></div>
        <div class="li"><span class="li-main"><b>− Cash expenses</b></span><span class="num">${money(-cash.expenses)}</span></div>
        <div class="li"><span class="li-main"><b>Expected in till</b></span><span class="num" style="font-weight:610">${money(cash.expected)}</span></div>
        <div class="li"><span class="li-main"><b>Actually counted</b></span><span class="num" style="font-weight:610">${money(cash.actual)}</span></div>
        <div class="li"><span class="itile -sm ${cashOk ? '-ok' : '-bad'}">${icon(cashOk ? 'checkCircle' : 'alert', 16)}</span>
          <span class="li-main"><b>${cashOk ? 'Till balances' : 'Variance'}</b>${cashOk ? '' : `<span>Counted doesn't match expected</span>`}</span>
          <span class="num" style="font-weight:610;color:${cashOk ? 'var(--success)' : 'var(--error)'}">${money(cash.diff, { plus: true })}</span></div>
      </div>
      ${!cashOk ? `<label class="field" style="margin-bottom:var(--s-4)"><span class="f-label">Note on the variance</span>
        <textarea id="audit-variance-note" class="f-ctl" rows="2" placeholder="e.g. counted twice, still ₦2,500 short"></textarea></label>` : ''}

      <div class="section-head" style="padding:0 0 var(--s-2)"><h3 style="font-size:var(--t-footnote);text-transform:uppercase;letter-spacing:.02em;color:var(--ink-3)">Expenses today</h3></div>
      <div class="list" style="margin-bottom:var(--s-4)">
        ${todaysExp.map(x => `<div class="li"><span class="itile -sm">${icon(x.icon, 15)}</span>
          <span class="li-main"><b>${x.desc}</b><span>${x.cat} · ${x.method} · ${x.by}</span></span>
          <span class="num">${money(-x.amount)}</span></div>`).join('') || `<p class="meta" style="padding:var(--s-3) var(--s-4)">None recorded today.</p>`}
        <div class="li"><span class="li-main"><b>Total</b></span><span class="num" style="font-weight:610">${money(expTotal)}</span></div>
      </div>

      ${blocking ? '' : `<label class="li" style="cursor:pointer">
        <input type="checkbox" id="audit-confirm-check" style="width:20px;height:20px;flex:0 0 auto">
        <span class="li-main"><b>I've verified these figures are accurate</b></span>
      </label>`}`,
    foot: `<button class="btn -secondary -block" data-close>Back</button>
      <button class="btn -primary -block" data-confirm-submit-audit disabled>${isConfirm ? 'Confirm audit' : 'Submit audit'}</button>`,
    onMount(s) {
      const check = $('#audit-confirm-check', s), submitBtn = $('[data-confirm-submit-audit]', s);
      if (blocking) { submitBtn.disabled = true; return; }
      check.onchange = () => { submitBtn.disabled = !check.checked; };
      submitBtn.onclick = () => {
        if (submitBtn.disabled) return;
        const note = $('#audit-variance-note', s)?.value.trim();
        const varianceTxt = !cashOk ? ` · till ${money(Math.abs(cash.diff))} ${cash.diff < 0 ? 'short' : 'over'}${note ? ` — "${note}"` : ''}` : '';
        if (isConfirm) {
          DB.dailyFinancialAudit.status = 'confirmed';
          DB.dailyFinancialAudit.confirmedAt = 'Just now';
          DB.dailyFinancialAudit.confirmedBy = user().name;
          logAudit('Confirmed daily financial audit', `${APP.branch} · submitted by ${DB.dailyFinancialAudit.submittedBy}${varianceTxt}`, 'audit');
        } else {
          DB.dailyFinancialAudit.status = isSelf ? 'confirmed' : 'submitted';
          DB.dailyFinancialAudit.submittedAt = 'Just now';
          DB.dailyFinancialAudit.submittedBy = user().name;
          if (isSelf) { DB.dailyFinancialAudit.confirmedAt = 'Just now'; DB.dailyFinancialAudit.confirmedBy = user().name; }
          logAudit(isSelf ? 'Submitted and confirmed daily financial audit' : 'Submitted daily financial audit',
            `${APP.branch}${isSelf ? ' · no supervisor on shift' : ' · awaiting manager confirmation'}${varianceTxt}`, 'audit');
        }
        closeSheet();
        setTimeout(() => { refresh(); toast({ title: isConfirm ? 'Audit confirmed' : 'Audit submitted', text: isConfirm ? 'Recorded for today' : (isSelf ? 'Recorded for today' : 'A manager will confirm it') }); }, 240);
      };
    }
  });
}

function syncSheet() {
  const pendingTickets = DB.tickets.filter(t => t.sync === 'pending');
  const stateCopy = {
    synced:    { t:'Everything is up to date',   s:'Last synced just now.' },
    syncing:   { t:'Sending your changes',        s:'This usually takes a few seconds.' },
    offline:   { t:'Working offline',             s:'Your work is saved on this phone and will send itself when you are back online.' },
    attention: { t:"One change couldn't be sent", s:'Nothing was lost. You can try again now.' },
  }[APP.sync];

  sheet({
    title: 'Sync',
    body: `
      <div class="row" style="margin-bottom:var(--s-4)">
        <span class="itile ${APP.sync === 'synced' ? '-ok' : APP.sync === 'attention' ? '-bad' : APP.sync === 'syncing' ? '-accent' : ''}"
          style="width:44px;height:44px;border-radius:14px">
          ${icon(APP.sync === 'synced' ? 'check' : APP.sync === 'offline' ? 'wifiOff' : APP.sync === 'attention' ? 'alert' : 'cloudSync', 21)}</span>
        <div style="flex:1;min-width:0">
          <b style="display:block;font-size:var(--t-callout);font-weight:620">${stateCopy.t}</b>
          <span class="label">${stateCopy.s}</span>
        </div>
      </div>

      ${APP.sync === 'attention' ? `
        <div class="card -recessed" style="margin-bottom:var(--s-4)">
          <div class="row -top">
            <span class="itile -sm -bad">${icon('alert', 16)}</span>
            <div style="flex:1">
              <b style="font-size:var(--t-foot);font-weight:600">Couldn't sync this change yet</b>
              <p class="meta" style="margin-top:3px;line-height:1.5">Ticket TK-313 · ${money(24500)} — saved here, not yet on the server.</p>
            </div>
          </div>
          <div class="row" style="margin-top:var(--s-3);gap:var(--s-2)">
            <button class="btn -sm -primary" data-retry>Retry now</button>
            <button class="btn -sm -tertiary" data-close-sheet>Later</button>
          </div>
        </div>` : ''}

      ${pendingTickets.length && APP.sync !== 'synced' ? `
        <div class="group-label"><span class="eyebrow">Waiting to send</span><i></i></div>
        <div class="list">${pendingTickets.map(t => `
          <div class="li">
            <span class="itile -sm">${icon('ticket', 16)}</span>
            <span class="li-main"><b>${t.ref} · ${C(t.cust).name}</b><span>Created ${t.time} · saved on this phone</span></span>
            <span class="li-end"><b class="num">${money(t.total)}</b></span>
          </div>`).join('')}
        </div>` : ''}

      <div class="group-label"><span class="eyebrow">Try the states</span><i></i></div>
      <div class="grid-2" style="gap:var(--s-2)">
        ${[['synced','Synced'],['syncing','Syncing'],['offline','Offline'],['attention','Needs attention']]
          .map(([k, l]) => `<button class="btn -secondary -sm" data-set-sync="${k}"
            style="justify-content:flex-start">${l}</button>`).join('')}
      </div>
      <p class="meta" style="margin-top:var(--s-3);line-height:1.5">
        BakeFlow never blocks you when the network drops. Offline is a normal way to work, not an error.</p>`,
    onMount(s) {
      $$('[data-set-sync]', s).forEach(b => b.onclick = () => {
        const k = b.dataset.setSync;
        closeSheet();
        setTimeout(() => {
          APP.sync = k;
          APP.queued = k === 'offline' ? 3 : k === 'attention' ? 1 : 0;
          refresh();
          if (k === 'syncing') setTimeout(() => { APP.sync = 'synced'; APP.queued = 0; refresh(); toast({ title:'All changes sent', text:'3 tickets · 2 expenses' }); }, 2100);
          else toast({ title: k === 'offline' ? 'Offline mode on' : k === 'attention' ? 'One change needs attention' : 'Synced' , kind: k === 'attention' ? 'warn' : 'ok' });
        }, 220);
      });
      $('[data-retry]', s)?.addEventListener('click', () => {
        closeSheet();
        APP.sync = 'syncing'; refresh();
        setTimeout(() => { APP.sync = 'synced'; APP.queued = 0; DB.tickets.forEach(t => t.sync = 'synced'); refresh(); toast({ title:'Ticket TK-313 sent', text:'Everything is up to date' }); }, 1500);
      });
    }
  });
}

/* quick-action sheets dispatch */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-qa-sheet]');
  if (!b) return;
  const k = b.dataset.qaSheet;
  if (k === 'sync') syncSheet();
  if (k === 'expense') nav('add-expense');
});

/* ------------------------------------------- STAFF: SMALLER NOTIFICATIONS --- */
/* Only what a salesperson needs: their own orders, payments and sales —
   never P&L, staff, inventory-config or organization events. */
const STATUS_ITILE_TONE = { pending:'-warn', preparing:'-accent', ready:'-ok', delivering:'-info', completed:'-ok', cancelled:'' };
function toneStrip(tone) {
  return ({ '-bad':'var(--error)', '-warn':'var(--warning)', '-accent':'var(--info)', '-info':'var(--info)', '-ok':'var(--success)' })[tone] || 'var(--border)';
}
function renderStaffNotifications() {
  const mine = DB.orders.filter(o => o.staff === user().id);
  const groups = [
    { label:'Orders', items: mine.slice(0, 5).map(o => ({ nid:`no-${o.id}`, i: STATUS[orderStatus(o)].icon, tone: STATUS_ITILE_TONE[orderStatus(o)],
      t:`Order ${o.ref} is ${STATUS[orderStatus(o)].label.toLowerCase()}`, s:`${C(o.cust).name} · ${o.time}`, nav:'order', id:o.id })) },
    { label:'Payments', items: mine.filter(o => o.paid !== 'paid').map(o => ({ nid:`np-${o.id}`, i:'cash', tone:'-warn',
      t:`Order ${o.ref} has an outstanding balance`, s:`${C(o.cust).name} · ${money(o.total)} due`, nav:'order', id:o.id })) },
    { label:'Sales', items: DB.mySales.slice(0, 4).map(s => ({ nid:`ns-${s.id}`, i:'cash', tone:'-ok',
      t:`Payment received · ${s.ref}`, s:`${money(s.total)} · ${s.method} · ${s.time}` })) },
  ].filter(g => g.items.length);
  const unreadCount = [...APP.unreadIds].filter(id => id.startsWith('n')).length;

  return `${appbar({ title:'Notifications', back: !ROLE_TABS[APP.role].includes('notifications'),
    right:`<button class="iconbtn" data-mark-all-read aria-label="Mark all as read">${icon('check', 19)}</button>` })}
  <div class="body">
    <p class="meta" data-unread-count style="padding:0 var(--s-4) var(--s-2)">${unreadCount ? `${unreadCount} unread` : ''}</p>
    ${groups.length ? groups.map(g => `
      <div class="group-label"><span class="eyebrow">${g.label}</span><i></i></div>
      <div class="list">${g.items.map(n => `
        <button class="li" style="box-shadow:inset 3px 0 0 ${toneStrip(n.tone)}" data-notif-id="${n.nid}" ${n.nav ? `data-nav="${n.nav}"${n.id ? ` data-nav-params='{"id":"${n.id}"}'` : ''}` : 'data-toast="Nothing to open"'}>
          <span class="itile -sm ${n.tone}">${icon(n.i, 16)}</span>
          <span class="li-main"><b style="white-space:normal">${n.t}</b><span>${n.s}</span></span>
          ${APP.unreadIds.has(n.nid) ? '<i class="dot -live" data-unread-dot></i>' : ''}
          ${n.nav ? `<span class="chev">${icon('chevRight', 17)}</span>` : ''}
        </button>`).join('')}
      </div>`).join('')
    : `<div class="empty"><div class="e-art">${icon('bell', 30, { stroke:1.4 })}</div><h4>You're all caught up</h4><p>No new notifications.</p></div>`}
  </div>`;
}
function mountStaffNotifications(el) {
  const countEl = $('[data-unread-count]', el);
  const syncCount = () => { if (countEl) countEl.textContent = [...APP.unreadIds].filter(id => id.startsWith('n')).length ? `${[...APP.unreadIds].filter(id => id.startsWith('n')).length} unread` : ''; };
  $$('.li[data-notif-id]', el).forEach(b => b.addEventListener('click', () => {
    APP.unreadIds.delete(b.dataset.notifId);
    $('[data-unread-dot]', b)?.remove();
    syncCount();
  }));
  $('[data-mark-all-read]', el)?.addEventListener('click', () => {
    [...APP.unreadIds].filter(id => id.startsWith('n')).forEach(id => APP.unreadIds.delete(id));
    toast({ title:'All marked read' });
    refresh();
  });
}

/* ------------------------------------------- BAKER: PRODUCTION NOTIFICATIONS --- */
function renderBakerNotifications() {
  const failed = DB.productionBatches.filter(b => b.status === 'failed');
  const pending = DB.productionBatches.filter(b => ['scheduled','in_progress'].includes(b.status));
  const groups = [
    { label:'Batches', items: pending.map(b => ({ nid:`nb-${b.id}`, i:'flame', tone: b.status === 'in_progress' ? '-accent' : '',
      t:`${b.id.replace('pb', 'Batch ')} is ${b.status === 'in_progress' ? 'in progress' : 'scheduled today'}`, s:b.product })) },
    { label:'Issues', items: failed.map(b => ({ nid:`nf-${b.id}`, i:'alert', tone:'-bad',
      t:`${b.id.replace('pb', 'Batch ')} failed`, s: b.reason })) },
  ].filter(g => g.items.length);
  const unreadCount = [...APP.unreadIds].filter(id => id.startsWith('n')).length;
  return `${appbar({ title:'Notifications', back: !ROLE_TABS[APP.role].includes('notifications'),
    right:`<button class="iconbtn" data-mark-all-read aria-label="Mark all as read">${icon('check', 19)}</button>` })}
  <div class="body">
    <p class="meta" data-unread-count style="padding:0 var(--s-4) var(--s-2)">${unreadCount ? `${unreadCount} unread` : ''}</p>
    ${groups.length ? groups.map(g => `
      <div class="group-label"><span class="eyebrow">${g.label}</span><i></i></div>
      <div class="list">${g.items.map(n => `
        <div class="li" style="box-shadow:inset 3px 0 0 ${toneStrip(n.tone)}" data-notif-id="${n.nid}">
          <span class="itile -sm ${n.tone}">${icon(n.i, 16)}</span>
          <span class="li-main"><b style="white-space:normal">${n.t}</b><span>${n.s}</span></span>
          ${APP.unreadIds.has(n.nid) ? '<i class="dot -live" data-unread-dot></i>' : ''}
        </div>`).join('')}
      </div>`).join('')
    : `<div class="empty"><div class="e-art">${icon('bell', 30, { stroke:1.4 })}</div><h4>You're all caught up</h4><p>No new notifications.</p></div>`}
  </div>`;
}

/* -------------------------------------------------------- MY ACTIVITY --- */
/* A salesperson's own action log — not the org-wide audit trail. */
SCREENS['my-activity'] = {
  render() {
    if (APP.role === 'driver') return renderDriverActivity();
    const mine = DB.orders.filter(o => o.staff === user().id);
    const items = [
      ...DB.mySales.map(s => ({ t: s.time, i:'cash', txt:`Sale ${s.ref} recorded`, sub:`${money(s.total)} · ${s.method} · ${s.cust}` })),
      ...mine.map(o => ({ t: o.time, i:'bag', txt:`Order ${o.ref} created`, sub:`${C(o.cust).name} · ${money(o.total)}` })),
    ];
    return `${appbar({ title:'My activity', back: !ROLE_TABS[APP.role].includes('my-activity'), sub:`${items.length} actions today` })}
    <div class="body">
      ${items.length ? `<div class="group-label"><span class="eyebrow">Today</span><i></i></div>
      <div class="list">
        ${items.map(x => `<div class="li">
          <span class="itile -sm">${icon(x.i, 16)}</span>
          <span class="li-main"><b>${x.txt}</b><span>${x.sub}</span></span>
          <span class="li-end"><span>${x.t}</span></span>
        </div>`).join('')}
      </div>` : `<div class="empty"><div class="e-art">${icon('history', 30, { stroke:1.4 })}</div><h4>No activity yet</h4><p>Your sales and orders will appear here.</p></div>`}
    </div>`;
  }
};

/* ------------------------------------------- DRIVER: DELIVERY NOTIFICATIONS --- */
/* Only ticket/delivery-relevant events — never sales, profit or staff alerts. */
function renderDriverNotifications() {
  const assigned = DB.driverRoute.filter(r => r.createdBy === 'manager' && r.status === 'assigned');
  const pendingSync = DB.tickets.filter(t => t.sync === 'pending');
  const failed = DB.driverRoute.filter(r => r.status === 'failed');
  const groups = [
    { label:'Assignments', items: assigned.map(r => ({ nid:`nda-${r.id}`, i:'truck', tone:'-accent',
      t:`New delivery assigned`, s:`${r.cust} · ${r.address || r.area} · Assigned by ${r.managerName || 'manager'}`, nav:'route', mode:'tab' })) },
    { label:'Problems', items: failed.map(r => ({ nid:`ndf-${r.id}`, i:'alert', tone:'-bad',
      t:`Delivery to ${r.cust} failed`, s: r.failureReason, nav:'route', mode:'tab' })) },
    { label:'Sync', items: pendingSync.map(t => ({ nid:`nds-${t.id}`, i:'wifiOff', tone:'-warn',
      t:`Ticket ${t.ref} waiting to sync`, s:'Will send automatically when back online', nav:'tickets', mode:'tab' })) },
  ].filter(g => g.items.length);
  const unreadCount = [...APP.unreadIds].filter(id => id.startsWith('n')).length;
  return `${appbar({ title:'Notifications', back: !ROLE_TABS[APP.role].includes('notifications'),
    right:`<button class="iconbtn" data-mark-all-read aria-label="Mark all as read">${icon('check', 19)}</button>` })}
  <div class="body">
    <p class="meta" data-unread-count style="padding:0 var(--s-4) var(--s-2)">${unreadCount ? `${unreadCount} unread` : ''}</p>
    ${groups.length ? groups.map(g => `
      <div class="group-label"><span class="eyebrow">${g.label}</span><i></i></div>
      <div class="list">${g.items.map(n => `
        <button class="li" style="box-shadow:inset 3px 0 0 ${toneStrip(n.tone)}" data-notif-id="${n.nid}" data-nav="${n.nav}" data-nav-mode="${n.mode}">
          <span class="itile -sm ${n.tone}">${icon(n.i, 16)}</span>
          <span class="li-main"><b style="white-space:normal">${n.t}</b><span>${n.s}</span></span>
          ${APP.unreadIds.has(n.nid) ? '<i class="dot -live" data-unread-dot></i>' : ''}
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>`).join('')}
      </div>`).join('')
    : `<div class="empty"><div class="e-art">${icon('bell', 30, { stroke:1.4 })}</div><h4>You're all caught up</h4><p>No new notifications.</p></div>`}
  </div>`;
}

/* ------------------------------------------------ DRIVER: MY ACTIVITY --- */
function renderDriverActivity() {
  const items = [
    ...DB.driverRoute.filter(r => r.status !== 'assigned').map(r => ({ t: r.status === 'delivered' ? 'Delivered' : r.status === 'failed' ? 'Reported failed' : 'Started', i: r.status === 'delivered' ? 'check' : r.status === 'failed' ? 'alert' : 'truck',
      txt:`${r.cust}`, sub: r.status === 'delivered' ? `Delivered · ${money(r.amount)}` : r.status === 'failed' ? r.failureReason : `${r.area} · ${money(r.amount)}` })),
    ...DB.tickets.slice().reverse().map(t => ({ t:t.time, i:'ticket', txt:`Ticket ${t.ref} created`, sub:`${C(t.cust).name} · ${money(t.total)}` })),
  ];
  return `${appbar({ title:'My activity', back: !ROLE_TABS[APP.role].includes('my-activity'), sub:`${items.length} actions today` })}
  <div class="body">
    ${items.length ? `<div class="group-label"><span class="eyebrow">Today</span><i></i></div>
    <div class="list">
      ${items.map(x => `<div class="li">
        <span class="itile -sm">${icon(x.i, 16)}</span>
        <span class="li-main"><b>${x.txt}</b><span>${x.sub}</span></span>
        <span class="li-end"><span>${x.t}</span></span>
      </div>`).join('')}
    </div>` : `<div class="empty"><div class="e-art">${icon('history', 30, { stroke:1.4 })}</div><h4>No activity yet</h4><p>Your tickets and deliveries will appear here.</p></div>`}
  </div>`;
}

/* ------------------------------------------------------------ PRODUCTION --- */SCREENS.production = {
  tab: 'production',
  render() {
    if (APP.role === 'owner' && !branchMatch('Ikeja')) {
      return `${appbar({ title:'Production', back: !ROLE_TABS[APP.role].includes('production'), sub:`${APP.viewBranch} · no production floor here` })}
      <div class="body"><div class="empty" style="margin-top:var(--s-6)"><div class="e-art">${icon('flame', 28, { stroke:1.4 })}</div>
        <h4>No production data for ${APP.viewBranch}</h4><p>This branch's batches aren't tracked in this build yet.</p></div></div>`;
    }
    const batches = DB.productionBatches;
    const records = DB.myProduction;
    const total = records.reduce((s, r) => s + r.qty, 0);
    return `${appbar({ title:'Production', back: !ROLE_TABS[APP.role].includes('production'), sub:`${total.toLocaleString()} units today` })}
    <div class="body -with-tabbar">
      <button class="btn -primary -block -lg" data-nav="record-production">${icon('plus', 18)} Record production</button>

      <section class="section">
        <div class="section-head"><h3>Today's batches</h3></div>
        <div class="stack-3">${batches.map(b => batchCard(b)).join('')}</div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Today's records</h3></div>
        ${records.length ? `<div class="list">${records.map(r => productionRecordRow(r)).join('')}</div>`
          : `<div class="empty" style="padding:var(--s-6) 0"><div class="e-art">${icon('history', 28, { stroke:1.4 })}</div><h4>No records yet</h4></div>`}
      </section>
    </div>`;
  },
  mount(el) { wireProductionRows(el); }
};
function wireProductionRows(el) {
  $$('[data-record-batch]', el).forEach(b => b.addEventListener('click', () => startRecordForBatch(b.dataset.recordBatch)));
  $$('[data-record-detail]', el).forEach(b => b.addEventListener('click', () => openRecordDetail(b.dataset.recordDetail)));
}
function startRecordForBatch(batchId) {
  const batch = DB.productionBatches.find(b => b.id === batchId);
  APP.production = { step:3, product: batch.product, batchId, qty:0, note:'', showNote:false };
  nav('record-production');
}
function openRecordDetail(recordId) {
  const r = DB.myProduction.find(x => x.id === recordId);
  sheet({
    title: r.product,
    body: `<p class="meta" style="margin-bottom:var(--s-3)">${r.batchId.replace('pb', 'Batch ')} · ${r.time}</p>
      <div class="recap">
        ${r.correction ? `<div class="r-line"><span>Originally recorded</span><span class="spacer"></span><b style="text-decoration:line-through;color:var(--warm-gray)">${r.correction.originalQty} ${pluralUnit(r.unit, r.correction.originalQty)}</b></div>
        <div class="r-line"><span>Reason</span><span class="spacer"></span><b>${esc(r.correction.reason)}</b></div>
        <div class="r-rule"></div>` : ''}
        <div class="r-line -total"><span>${r.correction ? 'Corrected to' : 'Recorded'}</span><span class="spacer"></span><b>${r.qty} ${pluralUnit(r.unit, r.qty)}</b></div>
      </div>
      ${r.note ? `<p class="meta" style="margin-top:var(--s-3)">${esc(r.note)}</p>` : ''}`,
    foot: `<button class="btn -secondary -block" data-correct-entry>Correct entry</button>`,
    onMount(s) { $('[data-correct-entry]', s).onclick = () => { closeSheet(); setTimeout(() => correctionSheet(r), 200); }; }
  });
}
function correctionSheet(r) {
  sheet({
    title:'Correct entry',
    body: `<div class="field"><span class="f-label">Correct quantity</span>
        <input class="f-ctl" id="cq-qty" type="text" inputmode="numeric" value="${r.qty}"></div>
      <div class="field" style="margin-top:var(--s-3)"><span class="f-label">Reason</span>
        <textarea class="f-ctl" id="cq-reason" style="min-height:72px"></textarea></div>`,
    foot: `<button class="btn -primary -block -lg" id="cq-save" disabled>Save correction</button>`,
    onMount(s) {
      const qtyEl = $('#cq-qty', s), reasonEl = $('#cq-reason', s), saveBtn = $('#cq-save', s);
      const check = () => { saveBtn.disabled = !reasonEl.value.trim() || !qtyEl.value || +qtyEl.value === r.qty; };
      qtyEl.oninput = () => { qtyEl.value = qtyEl.value.replace(/[^\d]/g, ''); check(); };
      reasonEl.oninput = check;
      saveBtn.onclick = () => {
        applyCorrection(r, +qtyEl.value, reasonEl.value.trim());
        closeSheet();
        setTimeout(() => { refresh(); toast({ title:'Entry corrected', text:`${r.product} · ${r.qty} ${pluralUnit(r.unit, r.qty)}` }); }, 220);
      };
    }
  });
}
function applyCorrection(r, newQty, reason) {
  const diff = newQty - r.qty;
  const batch = DB.productionBatches.find(b => b.id === r.batchId);
  if (batch) { batch.producedQty = newQty; batch.qty = newQty; }
  const prod = DB.products.find(p => p.name === r.product);
  if (prod) prod.stock = Math.max(0, prod.stock + diff);
  DB.stockMovements.unshift({ id:'sm' + Date.now(), item:r.product, kind:'correction', qty:diff, time:'Just now', by:user().name });
  const originalQty = r.correction ? r.correction.originalQty : r.qty;
  if (!r.correction) r.correction = { originalQty: r.qty, reason, at:'Just now' };
  else r.correction.reason = reason;
  logAudit('Corrected production entry', `${r.product} · ${originalQty} → ${newQty} ${pluralUnit(r.unit, newQty)} · "${reason}"`, 'production');
  r.qty = newQty;
}

/* ------------------------------------------------------------- PROFILE --- */
SCREENS.profile = {
  tab: 'profile',
  render() {
    const u = user();
    return `${appbar({ title:'Profile', back: !ROLE_TABS[APP.role].includes('profile') })}
    <div class="body">
      <section class="card" style="text-align:center;padding:var(--s-6) var(--s-4)">
        <span class="avatar -lg -${u.tone}" style="margin:0 auto var(--s-3)">${u.init}</span>
        <div style="font-size:var(--t-title-2);font-weight:650;letter-spacing:-.02em">${u.name}</div>
        <div class="label" style="margin-top:2px">${u.title}</div>
      </section>
      <div class="group-label"><span class="eyebrow">Account</span><i></i></div>
      <div class="menu">
        <div class="menu-item"><span class="itile -sm">${icon('store', 16)}</span>
          <span class="m-txt"><b>Organization</b><span>${APP.org.name}</span></span></div>
        <div class="menu-item"><span class="itile -sm">${icon('pin', 16)}</span>
          <span class="m-txt"><b>Branch</b><span>${APP.branch}</span></span></div>
      </div>
      <div class="menu">
      ${menuItem({ icon:'settings', title:'Settings', nav:'settings' })}
      </div>
      <button class="btn -danger -block" style="margin-top:var(--s-5)" data-nav="login" data-nav-mode="fade">Sign out</button>
    </div>`;
  }
};


SCREENS.notifications = {
  render() {
    if (APP.role === 'staff') return renderStaffNotifications();
    if (APP.role === 'baker') return renderBakerNotifications();
    if (APP.role === 'driver') return renderDriverNotifications();
    const t = DB.today, fin = DB.finance.periods['30d'];
    const groups = [
      { label:'Orders & production', items:[
        { nid:'n1', i:'bag',         tone:'-accent', t:'New order from Blessing Ogun',       s:`Just now · BF-2053 · ${money(64000)}`,            nav:'order', id:'o2053' },
        { nid:'n2', i:'user',        tone:'',        t:'Order BF-2052 assigned to you',      s:'5m ago · Royal Suites Hotel',                     nav:'order', id:'o2052' },
        { nid:'n3', i:'checkCircle', tone:'-ok',     t:'Order BF-2045 confirmed',            s:'20m ago · Ready for processing',                  nav:'order', id:'o2045' },
        { nid:'n4', i:'refresh',     tone:'-accent', t:'Order BF-2045 now in production',    s:'12m ago · Kitchen has started on this order',     nav:'order', id:'o2045' },
        { nid:'n5', i:'box',         tone:'-ok',     t:'Order BF-2045 ready',                s:'3m ago · Ready for pickup or delivery',           nav:'order', id:'o2045' },
        { nid:'n6', i:'checkCircle', tone:'-info',   t:'Order BF-2044 completed',            s:`1h ago · ${money(64800)} · Emeka Obi`,            nav:'order', id:'o2044' },
        { nid:'n7', i:'close',       tone:'-bad',    t:'Order BF-2041 cancelled',            s:'8:10 AM · Kunle Bakare — will reorder Friday',    nav:'order', id:'o2041' },
        { nid:'n8', i:'alert',       tone:'-warn',   t:'Order BF-2046 needs attention',      s:'Past its expected completion time',               nav:'order', id:'o2046' },
      ]},
      { label:'Payments & invoices', items:[
        { nid:'n9',  i:'cash',        tone:'-ok',   t:'Grace Mart paid ₦120,000',       s:'1:05 PM · Part payment on BF-2047',        nav:'order', id:'o2047' },
        { nid:'n10', i:'clock',       tone:'-warn', t:'Payment pending on BF-2053',     s:'20m ago · Blessing Ogun',                  nav:'order', id:'o2053' },
        { nid:'n11', i:'alert',       tone:'-bad',  t:'Payment overdue on BF-2046',     s:`35m ago · ${money(24500)} · Chidi Nwankwo`,nav:'order', id:'o2046' },
        { nid:'n12', i:'doc',         tone:'',      t:'Invoice created for BF-2052',    s:'40m ago · Royal Suites Hotel',             nav:'order', id:'o2052' },
        { nid:'n13', i:'mail',        tone:'',      t:'Invoice sent to Royal Suites Hotel', s:'1h ago · BF-2043',                    nav:'order', id:'o2043' },
        { nid:'n14', i:'checkCircle', tone:'-ok',   t:'Invoice for BF-2039 fully paid', s:'2h ago · Emeka Obi',                      nav:'order', id:'o2039' },
      ]},
      { label:'Inventory & expenses', items:[
        { nid:'n15', i:'box', tone:'-warn', t:'Wheat Bread is running low',      s:'Current stock: 9 loaves', nav:'product-detail', id:'p10' },
        { nid:'n16', i:'box', tone:'-bad',  t:'Cinnamon Roll is out of stock',   s:'Sold out today',          nav:'product-detail', id:'p12' },
      ]},
      { label:'Business insights', items:[
        { nid:'n17', i:'chart', tone:'-ok',     t:`Today's sales: ${money(t.revenue)}`, s:`${t.orders} orders across all branches`, nav:'sales' },
        { nid:'n18', i:'pie',   tone:'-accent', t:'Daily summary ready',                s:`Revenue ${money(t.revenue)} · Expenses ${money(t.expenses)} · Net ${money(t.net)}`, nav:'finance' },
        { nid:'n19', i:'chart', tone:'-ok',     t:`Profit margin at ${fin.margin}%`,    s:'View your Profit & Loss report', nav:'pnl' },
        { nid:'n20', i:'doc',   tone:'',        t:'Monthly report ready',              s:'Your report for this period is ready to view', nav:'reports' },
      ]},
      { label:'Team & account', items:[
        { nid:'n21', i:'user',   tone:'-info', t:'Chioma Adeleke joined as Baker', s:'Added to the Ikeja team',                    nav:'staff' },
        { nid:'n22', i:'users',  tone:'-bad',  t:'Team member removed',            s:'Access to this bakery has been revoked',     nav:'staff' },
        { nid:'n23', i:'shield', tone:'-info', t:'New sign-in to your account',    s:'From a new device · review in Settings',    nav:'settings' },
        { nid:'n24', i:'lock',   tone:'-ok',   t:'Password changed',               s:'Your BakeFlow password was updated',        nav:'settings' },
      ]},
    ];
    const unreadCount = APP.unreadIds.size;
    return `${appbar({ title:'Notifications', right:`<button class="iconbtn" data-mark-all-read aria-label="Mark all as read">${icon('check', 19)}</button>` })}
    <div class="body">
      <p class="meta" data-unread-count style="padding:0 var(--s-4) var(--s-2)">${unreadCount ? `${unreadCount} unread` : ''}</p>
      ${groups.map(g => `
        <div class="group-label"><span class="eyebrow">${g.label}</span><i></i></div>
        <div class="list">${g.items.map(n => `
          <button class="li" style="box-shadow:inset 3px 0 0 ${toneStrip(n.tone)}" data-notif-id="${n.nid}" ${n.nav ? `data-nav="${n.nav}"${n.id ? ` data-nav-params='{"id":"${n.id}"}'` : ''}` : 'data-toast="Nothing to open"'}>
            <span class="itile -sm ${n.tone}">${icon(n.i, 16)}</span>
            <span class="li-main"><b style="white-space:normal">${n.t}</b><span>${n.s}</span></span>
            ${APP.unreadIds.has(n.nid) ? '<i class="dot -live" data-unread-dot></i>' : ''}
            ${n.nav ? `<span class="chev">${icon('chevRight', 17)}</span>` : ''}
          </button>`).join('')}
        </div>`).join('')}
    </div>`;
  },
  mount(el) {
    if (APP.role === 'staff') return mountStaffNotifications(el);
    if (APP.role === 'baker') return mountStaffNotifications(el);
    if (APP.role === 'driver') return mountStaffNotifications(el);
    const countEl = $('[data-unread-count]', el);
    const syncCount = () => { if (countEl) countEl.textContent = APP.unreadIds.size ? `${APP.unreadIds.size} unread` : ''; };
    $$('.li[data-notif-id]', el).forEach(b => {
      b.addEventListener('click', () => {
        APP.unreadIds.delete(b.dataset.notifId);
        $('[data-unread-dot]', b)?.remove();
        syncCount();
      });
    });
    $('[data-mark-all-read]', el)?.addEventListener('click', () => {
      APP.unreadIds.clear();
      toast({ title:'All marked read' });
      nav('notifications', {}, 'tab');
    });
  }
};
