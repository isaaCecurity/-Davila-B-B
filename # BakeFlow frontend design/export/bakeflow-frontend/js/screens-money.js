/* ==========================================================================
   BAKEFLOW — Sales, Finance, P&L, Expenses, Cash, Reports
   ========================================================================== */

/* ----------------------------------------------------------------- SALES --- */
const METHOD_ICON = { Cash:'cash', Transfer:'bank', POS:'card' };

SCREENS.sales = {
  tab: 'sales',
  render(p) {
    const f = p.method || 'All';
    const scoped = APP.role === 'owner' && APP.viewBranch !== 'All';
    const groups = DB.sales.groups.map(g => ({
      ...g,
      rows: g.rows.filter(r => f === 'All' || r.method === f).filter(r => !scoped || branchMatch(staffBranchByFirst(r.staff))),
    }));
    const shown = groups.flatMap(g => g.rows);
    const total = shown.reduce((s, r) => s + r.amount, 0);
    const todayTotal = scoped ? (groups.find(g => g.label === 'Today')?.rows.reduce((s, r) => s + r.amount, 0) || 0) : DB.sales.todayTotal;

    return `${appbar({ title:'Sales', back:false, sub:`${APP.role === 'owner' ? (APP.viewBranch === 'All' ? 'All branches' : APP.viewBranch) : APP.branch} · today`,
      right:`<button class="iconbtn -tinted" data-sales-filter aria-label="Filter sales">${icon('filter', 19)}</button>` })}
    <div class="body -with-tabbar -flush">
      <div class="flush-pad">
        <!-- Hero: today's take -->
        <section class="hero-panel">
          <div class="hp-top">
            <div style="flex:1">
              <div class="hp-label">Sales today</div>
              <div class="hero-figure num" data-figure="${todayTotal}" data-from="${todayTotal * .8}">${money(todayTotal)}</div>
              <div class="hp-sub">42 transactions · ${money(DB.today.avgTicket)} average</div>
            </div>
            ${deltaChip(12.4, true)}
          </div>
          <div class="hp-chart cc-plot">
            ${lineChart({ series: DB.week.map(d => ({ v:d.v })), labels: DB.week.map(d => d.d),
              onDark:true, activeIndex:4, h:104, aria:'Sales across the week' })}
          </div>
          <div style="margin:0 -20px">${xAxis(DB.week.map(d => d.d), 4)}</div>
          <div class="hp-foot">
            ${DB.sales.methods.map((m, i) => `
              ${i ? '<div class="hp-divider"></div>' : ''}
              <div><div class="v num">${moneyShort(m.v)}</div><div class="k">${m.k} · ${m.pct}%</div></div>`).join('')}
          </div>
        </section>
      </div>

      <!-- Method filter -->
      <div class="chips" data-chipgroup id="sales-chips" style="margin:var(--s-4) 0">
        ${['All','Cash','Transfer','POS'].map(m => `<button class="chip" data-val="${m}" aria-pressed="${m === f}">
          ${m === 'All' ? '' : icon(METHOD_ICON[m], 13)}${m}</button>`).join('')}
      </div>

      <div class="flush-pad">
        ${shown.length ? groups.filter(g => g.rows.length).map(g => `
          <section class="section" style="margin-top:var(--s-2)">
            <div class="group-label"><span class="eyebrow">${g.label}</span><i></i>
              <span class="strong num" style="font-size:var(--t-foot)">${money(g.rows.reduce((s, r) => s + r.amount, 0))}</span></div>
            <div class="list">
              ${g.rows.map(r => `
                <button class="txn" data-txn='${JSON.stringify(r).replace(/'/g, "&#39;")}'>
                  <span class="avatar -sm -${r.tone}">${r.cust === 'Walk-in' ? icon('bag', 14) : r.cust.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
                  <span class="t-main"><b>${r.cust}</b>
                    <span>${r.time}<i class="sep-dot"></i>${r.ref}<i class="sep-dot"></i>${r.method}</span></span>
                  <span class="t-amt num">${money(r.amount)}<small>${r.staff}</small></span>
                </button>`).join('')}
            </div>
          </section>`).join('')
        : `<div class="empty">
            <div class="e-art">${flowMotif(140, 58, .75)}</div>
            <h4>No ${f.toLowerCase()} sales yet</h4>
            <p>Sales taken by ${f.toLowerCase()} will be grouped here as the day goes on.</p>
          </div>`}

        ${shown.length ? `<p class="meta" style="margin-top:var(--s-5);text-align:center">
          ${shown.length} transactions shown · ${money(total)}</p>` : ''}
      </div>
    </div>`;
  },
  mount(el, p) {
    wireChart($('.cc-plot', el), ({ v, l }) => `<b>${money(v)}</b><em>${l}</em>`);
    $('#sales-chips', el).addEventListener('chipchange', e => nav('sales', { method: e.detail }, 'replace'));
    $('[data-sales-filter]', el).onclick = () => salesFilterSheet();
    $$('[data-txn]', el).forEach(b => b.onclick = () => txnSheet(JSON.parse(b.dataset.txn)));
  }
};

function txnSheet(r) {
  sheet({
    title: 'Transaction',
    body: `<div style="text-align:center;padding:var(--s-2) 0 var(--s-5)">
        <div class="hero-figure num">${money(r.amount)}</div>
        <div class="label" style="margin-top:6px">${r.method} · ${r.time}</div>
      </div>
      <div class="recap">
        <div class="r-line"><span>Customer</span><span class="spacer"></span><b>${r.cust}</b></div>
        <div class="r-line"><span>Reference</span><span class="spacer"></span><b>${r.ref}</b></div>
        <div class="r-line"><span>Taken by</span><span class="spacer"></span><b>${r.staff}</b></div>
        <div class="r-line"><span>Branch</span><span class="spacer"></span><b>${APP.branch}</b></div>
        ${r.note ? `<div class="r-rule"></div><div class="r-line"><span>${r.note}</span></div>` : ''}
      </div>
      <div class="grid-2" style="margin-top:var(--s-4)">
        <button class="btn -secondary" data-toast="Receipt sent" data-toast-text="${r.cust}">${icon('share', 16)} Receipt</button>
        <button class="btn -secondary" data-nav="order" data-nav-params='{"id":"o2048"}'>${icon('orders', 16)} Open order</button>
      </div>`
  });
}

function salesFilterSheet() {
  sheet({
    title: 'Filter sales',
    body: `
      <div class="group-label"><span class="eyebrow">Period</span><i></i></div>
      <div class="segmented" style="margin-bottom:var(--s-5)"><span class="seg-thumb"></span>
        <button aria-pressed="true">Today</button><button aria-pressed="false">7 days</button>
        <button aria-pressed="false">30 days</button><button aria-pressed="false">Custom</button></div>
      ${['Payment method','Staff','Branch','Customer'].map((g, gi) => `
        <div class="group-label"><span class="eyebrow">${g}</span><i></i></div>
        <div class="chips" style="flex-wrap:wrap;margin:0 0 var(--s-4);padding:0">
          ${[['All','Cash','Transfer','POS'],['Anyone','Amara','Tunde','Ifeanyi','Segun'],
             ['All', ...APP.org.branches],['All','Wholesale','Contract','Walk-in']][gi]
            .map((v, i) => `<button class="chip" aria-pressed="${i === 0}">${v}</button>`).join('')}
        </div>`).join('')}`,
    foot: `<button class="btn -primary -block -lg" data-close-sheet>Apply filters</button>`,
    onMount(s) {
      $$('.chips', s).forEach(g => $$('.chip', g).forEach(c => c.onclick = () =>
        $$('.chip', g).forEach(x => x.setAttribute('aria-pressed', String(x === c)))));
    }
  });
}

/* --------------------------------------------------------------- FINANCE --- */
const PERIOD_LABEL = { '7d':'Last 7 days', '30d':'Last 30 days', '90d':'Last 90 days' };

SCREENS.finance = {
  tab: 'finance',
  render(p) {
    const per = p.period || APP.demo.finPeriod;
    APP.demo.finPeriod = per;
    const f = DB.finance.periods[per];
    const series = DB.finance.monthSeries;

    return `${appbar({ title:'Finance', back:false, sub: APP.role === 'owner' && APP.viewBranch !== 'All' ? `${APP.viewBranch} · figures below are org-wide for now` : `${APP.org.name} · all branches`,
      right:`<button class="iconbtn -tinted" data-nav="reports" aria-label="Reports">${icon('doc', 19)}</button>` })}
    <div class="body -with-tabbar -flush">
      <div class="flush-pad">

        <div class="segmented" id="fin-period" style="margin-bottom:var(--s-4)">
          <span class="seg-thumb"></span>
          ${Object.keys(PERIOD_LABEL).map(k => `<button data-per="${k}" aria-pressed="${k === per}">
            ${k === '7d' ? '7 days' : k === '30d' ? '30 days' : '90 days'}</button>`).join('')}
        </div>

        <!-- The three numbers that matter, with profit as the hero -->
        <section class="hero-panel">
          <div class="hp-top">
            <div style="flex:1">
              <div class="hp-label">Net profit · ${PERIOD_LABEL[per].toLowerCase()}</div>
              <div class="hero-figure num" data-figure="${f.profit}" data-short="1" data-from="${f.profit * .75}">${moneyShort(f.profit)}</div>
              <div class="hp-sub">${f.margin}% margin on ${f.orders.toLocaleString()} orders</div>
            </div>
            ${deltaChip(f.dProf, true)}
          </div>
          <div class="hp-chart cc-plot" style="padding:0 var(--s-5)">
            ${pairedBars({ series, h:132, aria:'Revenue against expenses by week' })}
          </div>
          <div style="margin:0 -20px">${xAxis(series.map(s => s.d), series.length - 1)}</div>
          <div class="hp-foot">
            <div><div class="v num">${moneyShort(f.revenue)}</div><div class="k">Revenue ${pct(f.dRev)}</div></div>
            <div class="hp-divider"></div>
            <div><div class="v num" style="color:#F0B993">${moneyShort(f.expenses)}</div><div class="k">Expenses ${pct(f.dExp)}</div></div>
          </div>
        </section>

        <!-- Money flow, the signature -->
        <section class="section">
          <div class="section-head"><h3>How revenue divides</h3><div class="spacer"></div>
            <button class="link" data-nav="pnl">Full P&amp;L</button></div>
          <div class="card">
            ${flowBar([
              { k:'Cost of goods', v: Math.round(f.revenue * 0.4), c:'var(--cocoa)' },
              { k:'Running costs', v: Math.round(f.revenue * 0.212), c:'var(--apricot)' },
              { k:'Profit',        v: f.profit, c:'var(--success)' },
            ])}
          </div>
        </section>

        <!-- Drill-in tiles -->
        <section class="section">
          <div class="grid-2">
            <button class="stat" data-nav="sales" data-nav-mode="tab">
              <div class="s-top"><span class="s-ico">${icon('sales', 15)}</span><span class="k">Revenue</span></div>
              <div class="v num">${moneyShort(f.revenue)}</div>
              <div class="sub">${deltaChip(f.dRev)}</div>
            </button>
            <button class="stat" data-nav="expenses">
              <div class="s-top"><span class="s-ico">${icon('receipt', 15)}</span><span class="k">Expenses</span></div>
              <div class="v num">${moneyShort(f.expenses)}</div>
              <div class="sub">${deltaChip(-f.dExp)}</div>
            </button>
            <button class="stat" data-nav="cash">
              <div class="s-top"><span class="s-ico">${icon('cash', 15)}</span><span class="k">Cash on hand</span></div>
              <div class="v num">${moneyShort(DB.cash.actual)}</div>
              <div class="sub" style="color:var(--error)">${money(DB.cash.diff)} variance</div>
            </button>
            <button class="stat" data-nav="pnl">
              <div class="s-top"><span class="s-ico">${icon('scale', 15)}</span><span class="k">Gross margin</span></div>
              <div class="v num">60.2%</div>
              <div class="sub">Healthy for a bakery</div>
            </button>
          </div>
        </section>

        <!-- Expense composition: the one donut in the whole product -->
        <section class="section">
          <div class="section-head"><h3>Where expenses go</h3><div class="spacer"></div>
            <button class="link" data-nav="expenses">Detail</button></div>
          <div class="card">
            <div class="row" style="gap:var(--s-5)">
              <div style="flex:0 0 auto;position:relative">
                ${donut([
                  { k:'Ingredients', v:1284000, c:'var(--cocoa)' },
                  { k:'Staff',       v:486000,  c:'var(--apricot)' },
                  { k:'Packaging',   v:248000,  c:'#C7B9A6' },
                  { k:'Rent',        v:220000,  c:'var(--success)' },
                  { k:'Other',       v:702000,  c:'var(--cream-deep)' },
                ], { size:116, sw:14, aria:'Expense composition' })}
                <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center">
                  <div><div class="strong num" style="font-size:var(--t-title-3)">${moneyShort(2940000)}</div>
                  <div class="meta">total</div></div>
                </div>
              </div>
              <div style="flex:1;min-width:0">
                ${[['Ingredients',44,'var(--cocoa)'],['Staff',17,'var(--apricot)'],
                   ['Packaging',8,'#C7B9A6'],['Rent',7,'var(--success)'],['Other',24,'var(--cream-deep)']]
                  .map(([k, v, c]) => `<div class="row" style="gap:8px;padding:3.5px 0">
                    <i style="width:9px;height:9px;border-radius:3px;background:${c};flex:0 0 auto"></i>
                    <span style="font-size:var(--t-foot);flex:1">${k}</span>
                    <span class="strong num" style="font-size:var(--t-foot)">${v}%</span></div>`).join('')}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section class="section">
        <div class="section-head flush-pad"><h3>Worth knowing</h3></div>
        <div class="insight-rail">
          ${insightCard({ icon:'trendUp', tone:'-ok', t:'Profit is growing faster than revenue.',
            b:'Revenue up 8.6%, profit up 14.1% — your ingredient costs held steady this month.' })}
          ${insightCard({ icon:'alert', tone:'-warn', t:'Utilities are up 22% this month.',
            b:'Generator diesel is the main driver. Worth checking the Lekki oven schedule.', act:'See expenses' })}
        </div>
      </section>
    </div>`;
  },
  mount(el, p) {
    wireChart($('.cc-plot', el), ({ v, v2, l }) =>
      `<b>${money(v)}</b><em>revenue · ${l}</em><br><b style="color:#F0B993">${money(v2)}</b><em>expenses</em>`);
    $$('#fin-period [data-per]', el).forEach(b => b.onclick = () => {
      if (b.getAttribute('aria-pressed') === 'true') return;
      nav('finance', { period: b.dataset.per }, 'replace');
    });
  }
};

/* ------------------------------------------------------------------- P&L --- */
SCREENS.pnl = {
  render() {
    const p = DB.finance.pnl;
    const block = (key, title, sub, total, lines, op) => `
      <button class="lg-row" data-expand="${key}">
        <span class="op">${op}</span>
        <span class="k">${title}<small>${sub}</small></span>
        <span class="v num">${money(total)}</span>
        <span class="chev" style="margin-left:10px;color:var(--warm-gray-soft)" data-chev="${key}">${icon('chevDown', 16)}</span>
      </button>
      <div class="expand-wrap" data-panel="${key}" style="height:0">
        <div class="lg-detail">
          ${lines.map(l => `<div class="d-line"><span>${l.k}</span><span class="spacer"></span><b>${money(l.v)}</b></div>`).join('')}
        </div>
      </div>`;

    return `${appbar({ title:'Profit & Loss', sub:'August 2026 · all branches',
      right:`<button class="iconbtn -tinted" data-toast="Statement exported" data-toast-text="PDF saved to your phone" aria-label="Export">${icon('download', 18)}</button>` })}
    <div class="body">

      <!-- The answer first -->
      <section class="hero-panel" style="padding-bottom:var(--s-5)">
        <div class="hp-top">
          <div style="flex:1">
            <div class="hp-label">Net profit this month</div>
            <div class="hero-figure num" data-figure="${p.netProfit}" data-short="1" data-from="${p.prevNet}">${moneyShort(p.netProfit)}</div>
            <div class="hp-sub">${p.netMargin}% of revenue · ${money(p.netProfit - p.prevNet)} more than July</div>
          </div>
          ${deltaChip(14.1, true)}
        </div>
        <div style="margin-top:var(--s-5);padding-bottom:var(--s-2)">
          ${flowBar([
            { k:'Cost of goods',    v:p.cogs.total, c:'rgba(255,255,255,.34)' },
            { k:'Operating costs',  v:p.opex.total, c:'var(--apricot)' },
            { k:'Profit',           v:p.netProfit,  c:'#6FBF95' },
          ])}
        </div>
      </section>

      <p class="meta" style="margin:var(--s-4) 2px 0;line-height:1.5">
        Tap any line to see what makes it up.</p>

      <!-- Progressive ledger -->
      <section class="section" style="margin-top:var(--s-4)">
        <div class="card">
          <div class="ledger">
            ${block('rev', 'Revenue', 'All sales, all channels', p.revenue.total, p.revenue.lines, '')}
            ${block('cogs', 'Cost of goods', 'Ingredients, packaging, oven fuel', p.cogs.total, p.cogs.lines, '−')}
            <div class="lg-rule -strong"></div>
            <div class="lg-row -subtotal"><span class="op"></span>
              <span class="k">Gross profit<small>${p.grossMargin}% gross margin</small></span>
              <span class="v num">${money(p.grossProfit)}</span><span style="width:26px"></span></div>
            ${block('opex', 'Operating expenses', 'Wages, rent, utilities, transport', p.opex.total, p.opex.lines, '−')}
            <div class="lg-rule -strong"></div>
            <div class="lg-row -total"><span class="op"></span>
              <span class="k">Net profit</span>
              <span class="v num" style="color:var(--success)">${money(p.netProfit)}</span><span style="width:26px"></span></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Against last month</h3></div>
        <div class="card">
          ${[['Revenue', 4820000, 4438000],['Cost of goods', 1920000, 1812000],
             ['Gross profit', 2900000, 2626000],['Operating expenses', 1020000, 978000],
             ['Net profit', 1880000, 1648000]].map(([k, now, then], i) => {
            const d = (now - then) / then * 100;
            return `<div class="row" style="padding:10px 0;${i ? 'border-top:1px solid var(--border)' : ''}">
              <span style="flex:1;font-size:var(--t-foot);font-weight:${i === 4 ? 620 : 500}">${k}</span>
              <span class="strong num" style="font-size:var(--t-foot);width:78px;text-align:right">${moneyShort(now)}</span>
              <span style="width:64px;text-align:right">${deltaChip(k === 'Cost of goods' || k === 'Operating expenses' ? -d : d)}</span>
            </div>`;
          }).join('')}
        </div>
      </section>

      <section class="section">
        <div class="insight">
          <span class="in-ico itile -ok">${icon('spark', 16)}</span>
          <div class="in-body"><b>Your margin is holding while you grow.</b>
            <p>Revenue rose 8.6% and cost of goods only 6.0%. If that holds, September lands near ₦2.05M net.</p></div>
        </div>
      </section>
    </div>`;
  },
  mount(el) {
    $$('[data-expand]', el).forEach(b => b.onclick = () => {
      const key = b.dataset.expand;
      const panel = $(`[data-panel="${key}"]`, el), chev = $(`[data-chev="${key}"]`, el);
      const open = panel.style.height !== '0px';
      const inner = panel.firstElementChild;
      panel.style.height = open ? '0px' : `${inner.offsetHeight}px`;
      chev.style.transform = open ? '' : 'rotate(180deg)';
      chev.style.transition = 'transform var(--d-base) var(--ease-out)';
    });
  }
};

/* --------------------------------------------------------------- REPORTS --- */
/* Trimmed for Supervisor: reports.view is granted, but P&L/expense detail
   sits behind financial roles this role doesn't hold — sales & staff only. */
SCREENS['supervisor-reports'] = {
  render() {
    const salesTotal = DB.mySales.reduce((s, x) => s + x.total, 0);
    return `${appbar({ title:'Reports', sub:'Today' })}
    <div class="body">
      <section class="card -ink">
        <div class="row -top">
          <div style="flex:1">
            <div class="eyebrow" style="color:rgba(255,255,255,.5)">Sales today</div>
            <div class="hero-figure num" style="margin-top:6px">${money(salesTotal)}</div>
            <div class="label" style="margin-top:4px">${DB.mySales.length} transactions</div>
          </div>
        </div>
        <div style="margin-top:var(--s-4)">
          ${barChart({ series: DB.week.map(d => ({ v:d.v, d:d.d })), h:74, activeIndex:5,
            base:'rgba(255,255,255,.16)', accent:'var(--apricot)', aria:'Revenue by day' })}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>By payment method</h3></div>
        <div class="grid-3">
          ${['Cash', 'Transfer', 'POS'].map(m => `<div class="stat"><div class="s-top"><span class="k">${m}</span></div>
            <div class="v num">${moneyShort(DB.mySales.filter(s => s.method === m).reduce((s, x) => s + x.total, 0))}</div></div>`).join('')}
        </div>
      </section>

      <div class="group-label"><span class="eyebrow">Available reports</span><i></i></div>
      <div class="menu">
        ${menuItem({ icon:'sales', title:'Sales report', sub:'Revenue by day and salesperson', nav:'sales-monitor' })}
        ${menuItem({ icon:'history', title:'Staff activity', sub:'Shifts, sales and orders', nav:'staff', mode:'tab' })}
      </div>
      <p class="meta" style="margin-top:var(--s-4);line-height:1.55">
        Profit & loss and expense detail aren't part of the Supervisor role today.</p>
    </div>`;
  }
};

/* -------------------------------------------------------------- EXPENSES --- */
SCREENS.expenses = {
  render(p) {
    const cat = p.cat || 'All';
    const rows = cat === 'All' ? DB.expenses.rows : DB.expenses.rows.filter(r => r.cat === cat);
    const groups = [
      { label:'Today',     rows: rows.filter(r => r.time.startsWith('Today')) },
      { label:'Yesterday', rows: rows.filter(r => r.time.startsWith('Yesterday')) },
    ].filter(g => g.rows.length);

    return `${appbar({ title:'Expenses', sub:`${money(DB.expenses.monthTotal)} this month`,
      right:`<button class="iconbtn -tinted" data-nav="add-expense" aria-label="Add expense">${icon('plus', 20)}</button>` })}
    <div class="body -flush">
      <div class="flush-pad">
        <section class="card">
          <div class="row -top">
            <div style="flex:1">
              <div class="label">Spent today</div>
              <div class="big-figure num" style="margin-top:4px" data-figure="${DB.expenses.todayTotal}">${money(DB.expenses.todayTotal)}</div>
            </div>
            ${deltaChip(-8.2)}
          </div>
          <div style="margin-top:var(--s-5)">
            ${flowBar(DB.expenses.breakdown.slice(0, 4).map((b, i) => ({
              k:b.k, v:b.v, c:['var(--cocoa)','var(--apricot)','#C7B9A6','var(--success)'][i]
            })))}
          </div>
        </section>
      </div>

      <div class="chips" data-chipgroup id="exp-chips" style="margin:var(--s-4) 0">
        ${['All', ...DB.expenseCats.map(c => c.k)].map(k => `<button class="chip" data-val="${k}" aria-pressed="${k === cat}">${k}</button>`).join('')}
      </div>

      <div class="flush-pad">
        ${groups.length ? groups.map(g => `
          <section class="section" style="margin-top:var(--s-2)">
            <div class="group-label"><span class="eyebrow">${g.label}</span><i></i>
              <span class="strong num" style="font-size:var(--t-foot)">${money(g.rows.reduce((s, r) => s + r.amount, 0))}</span></div>
            <div class="list">
              ${g.rows.map(r => `<button class="txn" data-exp='${JSON.stringify(r).replace(/'/g, "&#39;")}'>
                <span class="itile -sm">${icon(r.icon, 16)}</span>
                <span class="t-main"><b>${r.desc}</b>
                  <span>${r.cat}<i class="sep-dot"></i>${r.method}<i class="sep-dot"></i>${r.by}
                    ${r.receipt ? `<i class="sep-dot"></i>${icon('camera', 11)}` : ''}</span></span>
                <span class="t-amt num">${money(r.amount)}</span>
              </button>`).join('')}
            </div>
          </section>`).join('')
        : `<div class="empty">
            <div class="e-art">${flowMotif(140, 58, .75)}</div>
            <h4>No ${cat.toLowerCase()} expenses</h4>
            <p>Recording an expense takes about ten seconds. Everything you spend shapes your profit.</p>
            <div class="e-act"><button class="btn -primary" data-nav="add-expense">${icon('plus', 17)} Add expense</button></div>
          </div>`}
      </div>
    </div>
    <button class="fab" data-nav="add-expense">${icon('plus', 18)} Add expense</button>`;
  },
  mount(el) {
    $('#exp-chips', el).addEventListener('chipchange', e => nav('expenses', { cat: e.detail }, 'replace'));
    $$('[data-exp]', el).forEach(b => b.onclick = () => {
      const r = JSON.parse(b.dataset.exp);
      sheet({
        title:'Expense',
        body: `<div style="text-align:center;padding:var(--s-2) 0 var(--s-5)">
            <span class="itile" style="width:44px;height:44px;border-radius:14px;margin:0 auto var(--s-3)">${icon(r.icon, 21)}</span>
            <div class="hero-figure num">${money(r.amount)}</div>
            <div class="label" style="margin-top:6px">${r.desc}</div></div>
          <div class="recap">
            <div class="r-line"><span>Category</span><span class="spacer"></span><b>${r.cat}</b></div>
            <div class="r-line"><span>Paid with</span><span class="spacer"></span><b>${r.method}</b></div>
            <div class="r-line"><span>Recorded by</span><span class="spacer"></span><b>${r.by}</b></div>
            <div class="r-line"><span>When</span><span class="spacer"></span><b>${r.time}</b></div>
            <div class="r-line"><span>Receipt</span><span class="spacer"></span><b>${r.receipt ? 'Attached' : 'None'}</b></div>
          </div>
          <div class="grid-2" style="margin-top:var(--s-4)">
            <button class="btn -secondary" data-toast="Edit expense">${icon('edit', 16)} Edit</button>
            <button class="btn -danger" data-del-exp>${icon('trash', 16)} Delete</button>
          </div>`,
        onMount(s) {
          $('[data-del-exp]', s).onclick = () => {
            closeSheet();
            setTimeout(() => undoToast({
              title: 'Expense deleted',
              text: `${money(r.amount)} \u00b7 ${r.desc}`,
              onUndo() { toast({ title:'Expense restored', text:r.desc }); }
            }), 240);
          };
        }
      });
    });
  }
};

/* ---------------------------------------------------------- ADD EXPENSE --- */
SCREENS['add-expense'] = {
  chrome: false,
  render() {
    return `${appbar({ title:'Add expense', back:false,
      right:`<button class="iconbtn" data-back aria-label="Close">${icon('close', 20)}</button>` })}
    <div class="body -with-dock">
      ${APP.role === 'owner' ? `<section class="section" style="margin-top:var(--s-2)">
        <div class="section-head"><h3>Branch</h3></div>
        <button class="picker -filled" data-ae-branch>
          <span class="p-ico">${icon('store', 18)}</span>
          <span class="p-txt"><b id="ae-branch-label">${APP.viewBranch === 'All' ? APP.org.branches[0] : APP.viewBranch}</b><span>Which branch is this expense for</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>
      </section>` : ''}
      <div class="amount-input" style="margin-top:${APP.role === 'owner' ? 'var(--s-3)' : 'var(--s-2)'}">
        <span class="cur">₦</span>
        <input id="ae-amt" type="text" inputmode="numeric" autocomplete="off">
      </div>

      <section class="section" style="margin-top:var(--s-5)">
        <div class="section-head"><h3>Category</h3></div>
        <div class="grid-2" style="gap:var(--s-2)" id="ae-cats">
          ${DB.expenseCats.map((c, i) => `
            <button class="qa" data-cat="${c.k}" aria-pressed="${i === 0}" style="flex-direction:row;align-items:center;gap:10px">
              <span class="qa-ico ${i === 0 ? '-ink' : ''}">${icon(c.icon, 16)}</span><b>${c.k}</b></button>`).join('')}
        </div>
      </section>

      <section class="section">
        <label class="field">
          <span class="f-label">What was it for?</span>
          <input class="f-ctl" id="ae-desc" autocomplete="off">
        </label>
      </section>

      <section class="section">
        <div class="section-head"><h3>Paid with</h3></div>
        <div class="grid-3" id="ae-methods">
          ${[['Cash','cash'],['Transfer','bank'],['POS','card']].map(([k, ic], i) => {
            const blocked = APP.role === 'supervisor' && k === 'Cash';
            const first = !blocked && (i === 0 || (APP.role === 'supervisor' && i === 1));
            return `<button class="qa" data-method="${k}" aria-pressed="${first}" ${blocked ? 'disabled' : ''} style="align-items:center">
              <span class="qa-ico ${first ? '-ink' : ''}">${icon(ic, 17)}</span><b>${k}</b></button>`;
          }).join('')}
        </div>
        ${APP.role === 'supervisor' ? `<p class="meta" style="margin-top:var(--s-3);line-height:1.5">You can't open a till, so cash-method expenses aren't available to you — use transfer or POS.</p>` : ''}
      </section>

      ${APP.role === 'owner' ? `<section class="section">
        <button class="picker -filled" data-ae-branch>
          <span class="p-ico">${icon('store', 18)}</span>
          <span class="p-txt"><b id="ae-branch-label">${APP.viewBranch === 'All' ? APP.org.branches[0] : APP.viewBranch}</b><span>Which branch is this expense for</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>
      </section>` : ''}

      <section class="section">
        <button class="picker -filled" data-ae-date>
          <span class="p-ico">${icon('calendar', 18)}</span>
          <span class="p-txt"><b id="ae-date">Today, 11 August</b><span>Tap to change the date</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>
      </section>

      <section class="section">
        <button class="picker -empty" data-toast="Camera opened" data-toast-text="Attach a photo of the receipt">
          <span class="p-ico">${icon('camera', 18)}</span>
          <span class="p-txt"><b>Attach receipt</b><span>Optional</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>
        <p class="meta" style="margin-top:var(--s-3);line-height:1.5">
          ${APP.role === 'owner' ? 'Who recorded it and the time — BakeFlow fills in for you.' : 'Everything else — branch, who recorded it, the time — BakeFlow fills in for you.'}</p>
      </section>
    </div>

    <div class="dock">
      <div class="d-row">
        <div class="d-total"><div class="k">Expense</div><div class="v num" id="ae-echo">₦0</div></div>
        <button class="btn -primary" id="ae-save" disabled>Save expense</button>
      </div>
    </div>`;
  },
  mount(el) {
    const amt = $('#ae-amt', el), echo = $('#ae-echo', el), save = $('#ae-save', el);
    setTimeout(() => amt.focus(), 300);
    amt.oninput = () => {
      const n = +amt.value.replace(/[^\d]/g, '') || 0;
      amt.value = n ? n.toLocaleString() : '';
      echo.textContent = money(n);
      save.disabled = n <= 0;
    };
    const pickGroup = (sel, attr) => $$(sel + ' [' + attr + ']', el).forEach(b => b.onclick = () => {
      $$(sel + ' [' + attr + ']', el).forEach(x => {
        x.setAttribute('aria-pressed', String(x === b));
        $('.qa-ico', x).classList.toggle('-ink', x === b);
      });
    });
    pickGroup('#ae-cats', 'data-cat');
    $('[data-ae-branch]', el)?.addEventListener('click', () => {
      sheet({
        title: 'Which branch?',
        body: `<div class="list">${APP.org.branches.map(b => `<button class="li" data-set-ae-branch="${b}" style="width:100%;text-align:left">
            <span class="itile -sm">${icon('store', 16)}</span><span class="li-main"><b>${b}</b></span>
          </button>`).join('')}</div>`,
        onMount(s) {
          $$('[data-set-ae-branch]', s).forEach(b => b.onclick = () => {
            $('#ae-branch-label', el).textContent = b.dataset.setAeBranch;
            closeSheet();
          });
        }
      });
    });
    pickGroup('#ae-methods', 'data-method');

    $('[data-ae-date]', el).onclick = () => sheet({
      title:'Date',
      body: `<div class="list">${['Today, 11 August','Yesterday, 10 August','Saturday, 9 August','Pick another date…']
        .map((d, i) => `<button class="li" data-d="${d}"><span class="itile -sm">${icon('calendar', 16)}</span>
          <span class="li-main"><b>${d}</b></span>${i === 0 ? `<span class="o-check">${icon('check', 12, { stroke:2.6 })}</span>` : ''}</button>`).join('')}</div>`,
      onMount(s) { $$('[data-d]', s).forEach(b => b.onclick = () => {
        $('#ae-date', el).textContent = b.dataset.d; closeSheet();
      }); }
    });

    save.onclick = () => {
      const n = +amt.value.replace(/[^\d]/g, '') || 0;
      const cat = $('#ae-cats [aria-pressed="true"]', el).dataset.cat;
      const method = $('#ae-methods [aria-pressed="true"]', el).dataset.method;
      const desc = $('#ae-desc', el).value.trim() || cat;
      const c = DB.expenseCats.find(x => x.k === cat);
      DB.expenses.rows.unshift({ id:'e' + Date.now(), cat, desc, amount:n,
        time:'Today, just now', method, by:user().first, icon:c.icon, receipt:false });
      DB.expenses.todayTotal += n;
      back();
      setTimeout(() => toast({ title:`${money(n)} recorded`, text:`${cat} · ${desc}` }), 320);
    };
  }
};

/* --------------------------------------------------- SALESPERSON: SALES --- */
SCREENS['my-sales'] = {
  tab: 'mysales',
  render(p) {
    const q = (p?.q || '').trim();
    const method = p?.method || 'All';
    let rows = DB.mySales;
    if (method !== 'All') rows = rows.filter(s => s.method === method);
    if (q) rows = rows.filter(s => s.ref.toLowerCase().includes(q.toLowerCase()) || s.cust.toLowerCase().includes(q.toLowerCase()));
    const total = DB.mySales.reduce((s, x) => s + x.total, 0);

    return `${appbar({ title:"Today's sales", back:false, sub:`${DB.mySales.length} sales · ${money(total)}`, right: syncChip() })}
    <div class="body -with-tabbar -flush">
      <div class="flush-pad">
        <div class="searchbar"><input id="ms-q" value="${esc(q)}">${icon('search', 17)}</div>
        <div class="chips" data-chipgroup id="ms-methods" style="margin:var(--s-3) 0 var(--s-4)">
          ${['All','Cash','Transfer','POS'].map(m => `<button class="chip" data-val="${m}" aria-pressed="${m === method}">${m}</button>`).join('')}
        </div>
      </div>
      <div class="flush-pad">
        ${rows.length ? `<div class="list">
          ${rows.map(s => `<button class="li" data-sale-detail="${s.id}">
            <span class="itile -sm">${icon('receipt', 16)}</span>
            <span class="li-main"><b>${s.ref}</b><span>${s.cust} · ${s.time}</span></span>
            <span class="li-end"><b>${money(s.total)}</b><span>${s.method}</span></span>
          </button>`).join('')}
        </div>` : `<div class="empty"><div class="e-art">${icon('receipt', 30, { stroke:1.4 })}</div><h4>No sales match</h4></div>`}
      </div>
    </div>`;
  },
  mount(el, p) {
    $('#ms-q', el).oninput = () => nav('my-sales', { method: p?.method, q: $('#ms-q', el).value }, 'replace');
    $('#ms-methods', el).addEventListener('chipchange', e => nav('my-sales', { method: e.detail, q: p?.q }, 'replace'));
    $$('[data-sale-detail]', el).forEach(b => b.onclick = () => {
      const s = DB.mySales.find(x => x.id === b.dataset.saleDetail);
      sheet({
        title: s.ref,
        body: `<p class="meta" style="margin-bottom:var(--s-3)">${s.cust} · ${s.time}</p>
          <div class="card">
            ${s.items.map(i => { const p = P(i.p); return `<div class="cart-line"><span class="avatar -sm -e">${i.q}×</span>
              <span class="cl-main"><b>${p.name}</b><span>${money(p.price)} per ${p.unit}</span></span>
              <span class="strong num">${money(p.price * i.q)}</span></div>`; }).join('')}
            <div class="recap" style="margin-top:var(--s-4)">
              <div class="r-line"><span>Payment method</span><span class="spacer"></span><b>${s.method}</b></div>
              <div class="r-line -total"><span>Total</span><span class="spacer"></span><b>${money(s.total)}</b></div>
            </div>
          </div>`
      });
    });
  }
};


SCREENS.cash = {
  tab: ['manager', 'staff'].includes(APP.role) ? 'cash' : 'finance',
  render() {
    const c = DB.cash;
    if (APP.role === 'owner' && !branchMatch(c.branch)) {
      return `${appbar({ title:'Cash session', sub:`${APP.viewBranch}` })}
      <div class="body"><div class="empty" style="margin-top:var(--s-6)"><div class="e-art">${icon('cash', 28, { stroke:1.4 })}</div>
        <h4>No open session at ${APP.viewBranch}</h4><p>This branch has no cash session tracked in this build yet.</p></div></div>`;
    }
    const actual = APP.cashCounted ?? c.actual;
    const diff = actual - c.expected;
    const diffTone = diff === 0 ? 'ok' : Math.abs(diff) < 5000 ? 'warn' : 'bad';
    // Cashier can only close a session they opened themselves; a manager can close any.
    const canClose = APP.role === 'manager' || APP.role === 'owner' || (APP.role === 'staff' && c.openedBy === user().name);

    return `${appbar({ title:'Cash session', back: !['manager', 'staff'].includes(APP.role),
      sub:`${c.branch} · opened ${c.openedAt} by ${c.openedBy.split(' ')[0]}`,
      right:`<span class="badge -live">${icon('clock', 11)}Open</span>` })}
    <div class="body -with-tabbar">

      <section class="card">
        <div class="ledger">
          <div class="lg-row"><span class="op"></span>
            <span class="k">Opening balance<small>${c.openedAt} · ${c.openedBy}</small></span>
            <span class="v num">${money(c.open)}</span></div>
          <div class="lg-row"><span class="op">+</span>
            <span class="k">Cash handed over<small>${c.closedDrawers.length} staff drawer${c.closedDrawers.length === 1 ? '' : 's'} closed</small></span>
            <span class="v num" style="color:var(--success)">${money(c.sales)}</span></div>
          <div class="lg-row"><span class="op">−</span>
            <span class="k">Cash out<small>${c.movements.filter(m => m.v < 0).length} payments from the drawer</small></span>
            <span class="v num">${money(c.movements.reduce((s, m) => s + (m.v < 0 ? -m.v : 0), 0))}</span></div>
          <div class="lg-rule -strong"></div>
          <div class="lg-row -subtotal"><span class="op"></span>
            <span class="k">Expected in the drawer</span>
            <span class="v num">${money(c.expected)}</span></div>
          <div class="lg-row -subtotal"><span class="op"></span>
            <span class="k">Counted<small>${APP.cashCounted !== null ? 'Just now' : '2:10 PM by Amara'}</small></span>
            <span class="v num" id="cash-actual">${money(actual)}</span></div>
          <div class="lg-rule -strong"></div>
          <div class="lg-row -total"><span class="op"></span>
            <span class="k">${diff === 0 ? 'Balanced' : diff < 0 ? 'Short by' : 'Over by'}</span>
            <span class="v num" style="color:var(--${diffTone === 'ok' ? 'success' : diffTone === 'warn' ? 'warning' : 'error'})">
              ${diff === 0 ? money(0) : money(Math.abs(diff))}</span></div>
        </div>

        ${diff !== 0 ? `<div class="card -recessed" style="margin-top:var(--s-3)">
          <div class="row -top">
            <span class="itile -sm ${diffTone === 'bad' ? '-bad' : '-warn'}">${icon('info', 15)}</span>
            <div style="flex:1"><b style="font-size:var(--t-foot);font-weight:600">
              A ${money(Math.abs(diff))} gap on ${money(c.expected)} is ${(Math.abs(diff) / c.expected * 100).toFixed(1)}% of the drawer.</b>
              <p class="meta" style="margin-top:4px;line-height:1.5">Most gaps this size are change given at the counter. Add a note so the record is clear.</p></div>
          </div>
        </div>` : ''}

        <div class="grid-2" style="margin-top:var(--s-4)">
          <button class="btn -secondary" data-recount>${icon('cash', 16)} Recount</button>
          <button class="btn -primary" data-close-session ${canClose ? '' : 'disabled'}>Close session</button>
        </div>
        ${!canClose ? `<p class="f-hint" style="margin-top:8px">Opened by ${c.openedBy} — only they or a manager can close this session.</p>` : ''}
      </section>

      ${c.openDrawers.length ? `<section class="section">
        <div class="section-head"><h3>Open staff drawers</h3></div>
        <div class="list">
          ${c.openDrawers.map(d => `<div class="li"><span class="itile -sm -warn">${icon('clock', 16)}</span>
            <span class="li-main"><b>${d.name}</b><span>Opened ${d.openedAt} \u2014 cash not yet handed over</span></span></div>`).join('')}
        </div>
      </section>` : ''}

      ${['manager', 'owner'].includes(APP.role) && DB.driverTrip.status === 'reconciled' ? `<section class="section">
        <div class="section-head"><h3>Trips awaiting reconciliation</h3></div>
        <button class="li" data-nav="trip-reconcile">
          <span class="itile -sm -warn">${icon('truck', 16)}</span>
          <span class="li-main"><b>Ifeanyi Eze's trip</b><span>Stock returned · cash not yet in the till</span></span>
          <span class="chev">${icon('chevRight', 17)}</span>
        </button>
      </section>` : ''}

      <section class="section">
        <div class="section-head"><h3>Movements</h3></div>
        <div class="list">
          ${c.movements.map(m => `<div class="txn">
            <span class="itile -sm ${m.kind === 'in' ? '-ok' : m.kind === 'out' ? '-warn' : ''}">
              ${icon(m.kind === 'in' ? 'arrowDown' : m.kind === 'out' ? 'arrowUp' : 'play', 15)}</span>
            <span class="t-main"><b>${m.k}</b><span>${m.t}</span></span>
            <span class="t-amt num ${m.v < 0 ? '' : 'pos'}">${money(m.v, { plus:true })}</span>
          </div>`).join('')}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h3>Recent sessions</h3></div>
        <div class="list">
          ${c.history.map(h => `<div class="li">
            <span class="itile -sm ${h.diff === 0 ? '-ok' : '-warn'}">${icon(h.diff === 0 ? 'check' : 'alert', 15)}</span>
            <span class="li-main"><b>${h.d}</b><span>Expected ${money(h.expected)}</span></span>
            <span class="li-end"><b class="${h.diff === 0 ? 'pos' : 'neg'}">${h.diff === 0 ? 'Balanced' : money(h.diff)}</b>
              <span>counted ${moneyShort(h.actual)}</span></span>
          </div>`).join('')}
        </div>
      </section>
    </div>`;
  },
  mount(el) {
    $('[data-recount]', el).onclick = () => sheet({
      title:'Count the drawer',
      body: `<p class="label" style="margin-bottom:var(--s-4);line-height:1.5">
          Count what is physically in the drawer. BakeFlow compares it with ${money(DB.cash.expected)} expected.</p>
        <div class="amount-input"><span class="cur">₦</span>
          <input id="cc-amt" type="text" inputmode="numeric" value="${(APP.cashCounted ?? DB.cash.actual).toLocaleString()}"></div>
        <div class="recap" style="margin-top:var(--s-4)">
          <div class="r-line"><span>Expected</span><span class="spacer"></span><b>${money(DB.cash.expected)}</b></div>
          <div class="r-rule"></div>
          <div class="r-line -total"><span>Difference</span><span class="spacer"></span><b id="cc-diff">${money(DB.cash.diff)}</b></div>
        </div>
        <label class="field" style="margin-top:var(--s-4)">
          <span class="f-label">Note (optional)</span>
          <input class="f-ctl"></label>`,
      foot: `<button class="btn -primary -block -lg" data-save-count>Save count</button>`,
      onMount(s) {
        const a = $('#cc-amt', s), d = $('#cc-diff', s);
        a.oninput = () => {
          const n = +a.value.replace(/[^\d]/g, '') || 0;
          a.value = n ? n.toLocaleString() : '';
          const diff = n - DB.cash.expected;
          d.textContent = diff === 0 ? 'Balanced' : money(diff);
          d.style.color = diff === 0 ? 'var(--success)' : diff < 0 ? 'var(--error)' : 'var(--warning)';
        };
        $('[data-save-count]', s).onclick = () => {
          APP.cashCounted = +a.value.replace(/[^\d]/g, '') || 0;
          closeSheet();
          setTimeout(() => {
            refresh();
            const diff = APP.cashCounted - DB.cash.expected;
            toast({ title: diff === 0 ? 'Drawer balanced' : `${money(Math.abs(diff))} ${diff < 0 ? 'short' : 'over'}`,
              text:'Count saved to today\'s session', kind: diff === 0 ? 'ok' : 'warn' });
          }, 240);
        };
      }
    });

    $('[data-close-session]', el).onclick = () => {
      if (!canClose) return apiError('insufficient_role');
      const actual = APP.cashCounted ?? DB.cash.actual;
      const diff = actual - DB.cash.expected;
      dialog({
        body: `<div style="text-align:center">
          <span class="itile ${diff === 0 ? '-ok' : '-warn'}" style="width:44px;height:44px;border-radius:14px;margin:0 auto var(--s-4)">
            ${icon(diff === 0 ? 'check' : 'alert', 21)}</span>
          <h3 style="font-size:var(--t-title-3);font-weight:640">Close today's session?</h3>
          <p class="label" style="margin-top:8px;line-height:1.5">
            ${diff === 0 ? 'The drawer balances exactly.' : `A ${money(Math.abs(diff))} ${diff < 0 ? 'shortage' : 'surplus'} will be recorded against this session.`}
            You can't reopen a closed session.</p>
          <div class="recap" style="margin-top:var(--s-4);text-align:left">
            <div class="r-line"><span>Expected</span><span class="spacer"></span><b>${money(DB.cash.expected)}</b></div>
            <div class="r-line"><span>Counted</span><span class="spacer"></span><b>${money(actual)}</b></div>
          </div>
          ${diff !== 0 ? `<label class="field" style="text-align:left;margin-top:var(--s-4)"><span class="f-label">Variance note</span>
            <textarea class="f-ctl" id="variance-note"></textarea></label>` : ''}
          <div class="grid-2" style="margin-top:var(--s-5)">
            <button class="btn -secondary" data-close>Not yet</button>
            <button class="btn -primary" data-do-close ${diff !== 0 ? 'disabled' : ''}>Close session</button></div></div>`,
        onMount(d) {
          if (diff !== 0) {
            const note = $('#variance-note', d), btn = $('[data-do-close]', d);
            note.oninput = () => { btn.disabled = !note.value.trim(); };
          }
          $('[data-do-close]', d).onclick = () => {
            if (diff !== 0 && !$('#variance-note', d)?.value.trim()) return apiError('variance_note_required');
            if (diff !== 0) logAudit('Closed cash session with variance', `${money(Math.abs(diff))} ${diff < 0 ? 'short' : 'over'} · "${$('#variance-note', d).value.trim()}"`, 'cash');
            closeSheet();
            setTimeout(() => toast({ title:'Session closed', text:`${money(actual)} handed over · ${APP.branch}` }), 260);
          };
        }
      });
    };
  }
};

/* --------------------------------------------------- SALESPERSON: CASH --- */
/* Deliberately minimal — status + two totals. The full ledger, drawer count
   and close confirmation live in the "Closing Cash Session" sheet so this
   screen isn't the wall of numbers the manager's Cash screen is. */
function myCashLedger() {
  const c = DB.myCashSession;
  const cashSales = DB.mySales.filter(s => s.method === 'Cash').reduce((s, x) => s + x.total, 0);
  const expensesTotal = DB.myExpenses.reduce((s, x) => s + x.amount, 0);
  return { c, cashSales, expensesTotal, expected: c.openingFloat + cashSales - expensesTotal };
}
SCREENS['my-cash'] = {
  tab: 'mycash',
  render() {
    const { c, cashSales, expensesTotal } = myCashLedger();
    return `${appbar({ title:'My cash session', back:false,
      sub: c.open ? `Opened ${c.openedAt}` : 'Closed',
      right:`<span class="badge ${c.open ? '-live' : '-neutral'}">${icon('clock', 11)}${c.open ? 'Open' : 'Closed'}</span>` })}
    <div class="body -with-tabbar">
      <section class="card">
        <div class="grid-2">
          <div class="stat"><div class="s-top"><span class="k">Cash sales today</span></div>
            <div class="v num" style="color:var(--success)">${money(cashSales)}</div></div>
          <div class="stat"><div class="s-top"><span class="k">Expenses today</span></div>
            <div class="v num" style="color:${expensesTotal ? 'var(--error)' : 'inherit'}">${money(expensesTotal)}</div></div>
        </div>
        ${c.open ? `<div class="grid-2" style="margin-top:var(--s-4)">
          <button class="btn -secondary" data-nav="add-my-expense">${icon('plus', 16)} Add expense</button>
          <button class="btn -primary" data-close-session>${icon('cash', 16)} Closing cash session</button>
        </div>` : ''}
      </section>

      <section class="section">
        <div class="section-head"><h3>Today's sales</h3><div class="spacer"></div>
          <button class="link" data-nav="my-sales" data-nav-mode="tab">All</button></div>
        <div class="list">
          ${DB.mySales.slice(0, 4).map(s => `<div class="li">
            <span class="itile -sm">${icon('receipt', 16)}</span>
            <span class="li-main"><b>${s.ref}</b><span>${s.cust} · ${s.time}</span></span>
            <span class="li-end"><b>${money(s.total)}</b><span>${s.method}</span></span>
          </div>`).join('')}
        </div>
      </section>
    </div>`;
  },
  mount(el) {
    $('[data-close-session]', el)?.addEventListener('click', openCloseSessionSheet);
  }
};

/* Step 1: review the full ledger. */
function openCloseSessionSheet() {
  const { c, cashSales, expensesTotal, expected } = myCashLedger();
  sheet({
    title:'Closing cash session',
    body: `<div class="ledger">
      <div class="lg-row"><span class="op"></span><span class="k">Opening float</span><span class="v num">${money(c.openingFloat)}</span></div>
      <div class="lg-row"><span class="op">+</span><span class="k">Cash sales<small>${DB.mySales.filter(s => s.method === 'Cash').length} sales</small></span>
        <span class="v num" style="color:var(--success)">${money(cashSales)}</span></div>
      ${expensesTotal ? `<div class="lg-row"><span class="op">−</span><span class="k">Expenses<small>${DB.myExpenses.length} recorded</small></span>
        <span class="v num" style="color:var(--error)">${money(expensesTotal)}</span></div>` : ''}
      <div class="lg-rule -strong"></div>
      <div class="lg-row -total"><span class="op"></span><span class="k">Expected in the drawer</span><span class="v num">${money(expected)}</span></div>
    </div>`,
    foot: `<button class="btn -primary -block -lg" data-continue-close>Continue ${icon('arrowRight', 16)}</button>`,
    onMount(s) { $('[data-continue-close]', s).onclick = () => { closeSheet(); setTimeout(openCountDrawerSheet, 220); }; }
  });
}

/* Step 2: count the drawer, resolve variance, close. */
function openCountDrawerSheet() {
  const { expected } = myCashLedger();
  sheet({
    title:'Count the drawer',
    body: `<p class="label" style="margin-bottom:var(--s-4);line-height:1.5">Count what is physically in the drawer. Expected: ${money(expected)}.</p>
      <div class="amount-input"><span class="cur">₦</span>
        <input id="mc-amt" type="text" inputmode="numeric" value="${expected.toLocaleString()}"></div>
      <div class="recap" id="mc-recap" style="margin-top:var(--s-4)"></div>
      <label class="field" id="mc-note-wrap" style="text-align:left;margin-top:var(--s-4);display:none">
        <span class="f-label">Variance note</span>
        <textarea class="f-ctl" id="mc-variance-note"></textarea></label>`,
    foot: `<button class="btn -primary -block -lg" data-do-close-my disabled>Close session</button>`,
    onMount(s) {
      const a = $('#mc-amt', s), recap = $('#mc-recap', s), noteWrap = $('#mc-note-wrap', s), btn = $('[data-do-close-my]', s);
      const update = () => {
        const counted = +a.value.replace(/[^\d]/g, '') || 0;
        const diff = counted - expected;
        recap.innerHTML = `<div class="r-line"><span>${diff === 0 ? 'Balanced' : diff < 0 ? 'Short by' : 'Over by'}</span><span class="spacer"></span>
          <b style="color:var(--${diff === 0 ? 'success' : Math.abs(diff) < 2000 ? 'warning' : 'error'})">${money(Math.abs(diff))}</b></div>`;
        noteWrap.style.display = diff !== 0 ? 'block' : 'none';
        btn.disabled = diff !== 0 && !$('#mc-variance-note', s).value.trim();
        btn.dataset.counted = counted; btn.dataset.diff = diff;
      };
      a.oninput = () => { const n = +a.value.replace(/[^\d]/g, '') || 0; a.value = n ? n.toLocaleString() : ''; update(); };
      $('#mc-variance-note', s).addEventListener('input', update);
      update();
      btn.onclick = () => {
        const counted = +btn.dataset.counted, diff = +btn.dataset.diff;
        if (diff !== 0 && !$('#mc-variance-note', s).value.trim()) return apiError('variance_note_required');
        if (diff !== 0) logAudit('Closed cash session with variance', `${money(Math.abs(diff))} ${diff < 0 ? 'short' : 'over'} · "${$('#mc-variance-note', s).value.trim()}"`, 'cash');
        DB.myCashSession.open = false;
        closeSheet();
        setTimeout(() => { refresh(); toast({ title:'Session closed', text:`${money(counted)} handed over` }); }, 260);
      };
    }
  });
}

/* --------------------------------------------------- SALESPERSON: ADD EXPENSE --- */
/* Simpler than Manager's Add Expense — no method picker (always the cash
   drawer), no receipt, just what it was for. Feeds My Cash Session's ledger. */
SCREENS['add-my-expense'] = {
  chrome: false,
  render() {
    return `${appbar({ title:'Add expense', back:false,
      right:`<button class="iconbtn" data-back aria-label="Close">${icon('close', 20)}</button>` })}
    <div class="body -with-dock">
      <section class="section" style="margin-top:var(--s-2)">
        <div class="section-head"><h3>Amount</h3></div>
        <div class="amount-input"><span class="cur">₦</span><input id="me-amt" type="text" inputmode="numeric" autofocus></div>
      </section>
      <section class="section">
        <div class="section-head"><h3>Reason</h3></div>
        <div class="field"><input class="f-ctl" id="me-desc"></div>
      </section>
    </div>
    <div class="dock">
      <div class="d-row">
        <div class="d-total"><div class="k">Deducted from drawer</div><div class="v num" id="me-echo">₦0</div></div>
        <button class="btn -primary" id="me-save" disabled>Save expense</button>
      </div>
    </div>`;
  },
  mount(el) {
    const amt = $('#me-amt', el), save = $('#me-save', el), echo = $('#me-echo', el);
    amt.addEventListener('input', () => {
      const n = +amt.value.replace(/[^\d]/g, '') || 0;
      amt.value = n ? n.toLocaleString() : '';
      echo.textContent = money(n);
      save.disabled = n <= 0;
    });
    save.addEventListener('click', () => {
      const n = +amt.value.replace(/[^\d]/g, '') || 0;
      if (!n) return;
      const desc = $('#me-desc', el).value.trim() || 'Expense';
      DB.myExpenses.unshift({ id:'me' + Date.now(), time:'Just now', cat:'Other', desc, amount:n });
      back();
      setTimeout(() => toast({ title:`${money(n)} recorded`, text:desc }), 320);
    });
  }
};

/* --------------------------------------------------------------- REPORTS --- */
SCREENS.reports = {
  render() {
    return `${appbar({ title:'Reports', sub:'August 2026',
      right:`<button class="iconbtn -tinted" data-toast="Report scheduled" data-toast-text="Emailed every Monday 7 AM" aria-label="Schedule">${icon('calendar', 18)}</button>` })}
    <div class="body">
      <section class="card -ink">
        <div class="row -top">
          <div style="flex:1">
            <div class="eyebrow" style="color:rgba(255,255,255,.5)">This month so far</div>
            <div class="hero-figure num" style="margin-top:6px">${moneyShort(4820000)}</div>
            <div class="label" style="margin-top:4px">revenue · ${moneyShort(1880000)} net profit</div>
          </div>
          ${deltaChip(8.6, true)}
        </div>
        <div style="margin-top:var(--s-4)">
          ${barChart({ series: DB.week.map(d => ({ v:d.v, d:d.d })), h:74, activeIndex:5,
            base:'rgba(255,255,255,.16)', accent:'var(--apricot)', aria:'Revenue by day' })}
        </div>
      </section>

      <div class="group-label"><span class="eyebrow">Available reports</span><i></i></div>
      <div class="menu">
        ${DB.reports.map(r => menuItem({ icon:r.icon, title:r.k, sub:r.s, tone:r.tone,
          nav: r.to || undefined, toast: r.to ? undefined : `${r.k} generated` })).join('')}
      </div>

      <div class="group-label"><span class="eyebrow">Export</span><i></i></div>
      <div class="grid-2">
        <button class="btn -onwhite" data-toast="Exported" data-toast-text="PDF saved to your phone">${icon('download', 17)} PDF</button>
        <button class="btn -onwhite" data-toast="Exported" data-toast-text="Spreadsheet saved">${icon('doc', 17)} Spreadsheet</button>
      </div>
      <p class="meta" style="margin-top:var(--s-4);line-height:1.55">
        Reports use your live figures for ${APP.org.name}, across all ${APP.org.branches.length} branches.</p>
    </div>`;
  }
};

/* Product performance report */
SCREENS['report-products'] = {
  render() {
    const top = DB.products.slice().sort((a, b) => b.revenue - a.revenue);
    const max = top[0].revenue;
    return `${appbar({ title:'Product performance', sub:'By revenue · this month' })}
    <div class="body">
      <div class="segmented" style="margin-bottom:var(--s-4)"><span class="seg-thumb"></span>
        <button aria-pressed="true">Revenue</button><button aria-pressed="false">Units</button>
        <button aria-pressed="false">Margin</button></div>

      <section class="card">
        <div class="section-head" style="margin-bottom:var(--s-2)"><h3 style="font-size:var(--t-callout)">Which products make the money?</h3></div>
        ${top.slice(0, 8).map((p, i) => `<div class="hbar">
          <span class="hb-k">${p.name}</span>
          <span class="hb-track"><i style="width:${p.revenue / max * 100}%;background:${i === 0 ? 'var(--apricot)' : 'var(--cocoa)'}"></i></span>
          <span class="hb-v">${moneyShort(p.revenue)}</span>
        </div>`).join('')}
      </section>

      <section class="section">
        <div class="section-head"><h3>Margin leaders</h3></div>
        <div class="list">
          ${top.slice().sort((a, b) => (1 - b.cost / b.price) - (1 - a.cost / a.price)).slice(0, 5).map(p => {
            const m = (1 - p.cost / p.price) * 100;
            return `<button class="li" data-nav="product-detail" data-nav-params='{"id":"${p.id}"}'>
              <span class="avatar -sm -e">${p.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
              <span class="li-main"><b>${p.name}</b><span>${money(p.price)} · costs ${money(p.cost)}</span></span>
              <span class="li-end"><b class="pos">${m.toFixed(0)}%</b><span>${p.sold} sold</span></span>
            </button>`;
          }).join('')}
        </div>
      </section>

      <section class="section">
        <div class="insight">
          <span class="in-ico itile -warn">${icon('info', 16)}</span>
          <div class="in-body"><b>Cinnamon Roll sells out every day by 1 PM.</b>
            <p>64 sold this month at 59% margin, and you have run out on 11 of 11 days. A larger batch is very likely profitable.</p></div>
        </div>
      </section>
    </div>`;
  }
};

/* Branch performance report */
SCREENS['report-branches'] = {
  render() {
    const max = Math.max(...DB.branches.map(b => b.rev));
    return `${appbar({ title:'Branch performance', sub:'Today · all branches' })}
    <div class="body">
      <section class="hero-panel" style="padding-bottom:var(--s-5)">
        <div class="hp-top"><div style="flex:1">
          <div class="hp-label">Revenue today</div>
          <div class="hero-figure num" style="margin-top:6px">${money(DB.branches.reduce((s, b) => s + b.rev, 0))}</div>
          <div class="hp-sub">Across ${DB.branches.length} branches · 42 orders</div>
        </div>${deltaChip(12.4, true)}</div>
      </section>

      <section class="section">
        <div class="stack-3">
          ${DB.branches.map(b => `
            <div class="card ${b.k === APP.branch ? '' : ''}" style="${b.k === APP.branch ? 'box-shadow:var(--e-2),inset 0 0 0 1.5px var(--apricot)' : ''}">
              <div class="row -top">
                <span class="itile ${b.k === APP.branch ? '-accent' : ''}">${icon('store', 18)}</span>
                <div style="flex:1;min-width:0">
                  <b style="display:block;font-size:var(--t-callout);font-weight:620">${b.k}${b.k === APP.branch ? ' · you are here' : ''}</b>
                  <span class="label">${b.orders} orders · ${b.staff} staff</span></div>
                ${deltaChip(b.delta)}
              </div>
              <div class="row" style="margin-top:var(--s-4)">
                <div style="flex:1">
                  <div class="mid-figure num">${money(b.rev)}</div>
                  <div class="meta" style="margin-top:2px">${b.pct}% of today's revenue</div>
                </div>
                <div style="width:80px">${spark(DB.week.map(d => d.v * (b.pct / 100)), { w:80, h:28, color: b.delta < 0 ? 'var(--error)' : 'var(--success)' })}</div>
              </div>
              <div class="mini-bar" style="margin-top:var(--s-3)">
                <i style="width:${b.rev / max * 100}%;background:${b.delta < 0 ? 'var(--warning)' : 'var(--cocoa)'}"></i></div>
            </div>`).join('')}
        </div>
      </section>

      <section class="section">
        <div class="insight">
          <span class="in-ico itile -warn">${icon('trendDown', 16)}</span>
          <div class="in-body"><b>Yaba is the only branch down this week.</b>
            <p>Revenue fell 3.4% while Ikeja grew 14.2%. Yaba runs with 3 staff against Ikeja's 6.</p>
            <span class="in-act">Compare staffing ${icon('arrowRight', 12)}</span></div>
        </div>
      </section>
    </div>`;
  }
};
