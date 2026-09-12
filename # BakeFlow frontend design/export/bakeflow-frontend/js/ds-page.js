/* ==========================================================================
   BAKEFLOW — Design system page
   Renders the reference document from the SAME tokens, icons, charts and
   component markup the prototype uses. Nothing here is a mock-up of the design
   system: if a token changes, this page changes with it.
   ========================================================================== */

const el = id => document.getElementById(id);
const set = (id, html) => { const n = el(id); if (n) n.innerHTML = html; };

/* Read a live custom property straight off :root, so the documented hex is
   always the shipping hex rather than a number retyped into prose. */
const cssVar = name =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* -------------------------------------------------------------- BRAND --- */
set('ds-logo', wordmarkTagline(300));
set('brand-lock', wordmark(30));
set('brand-tile', brandMark(84, 'ink'));
set('brand-motif', flowMotif(180, 76, .9));
set('brand-flowbar', flowBar([
  { k: 'Ingredients', v: 1920000, c: 'var(--cocoa)' },
  { k: 'Running costs', v: 1020000, c: 'var(--apricot)' },
  { k: 'Profit', v: 1880000, c: 'var(--success)' },
]));

/* ------------------------------------------------------------- COLOUR --- */
function swatch(name, varName, use, bordered) {
  return `<div class="ds-swatch">
    <div class="sw-chip ${bordered ? '-bordered' : ''}" style="background:var(${varName})"></div>
    <div class="sw-meta">
      <div class="sw-name">${name}</div>
      <div class="sw-hex">${cssVar(varName).toUpperCase()}</div>
      <div class="sw-use">${use}</div>
    </div>
  </div>`;
}

set('pal-brand', [
  swatch('Deep Cocoa', '--cocoa', 'Primary text, primary actions, the hero panel. The product\u2019s spine.'),
  swatch('Warm Cream', '--cream', 'The application background. Never white \u2014 warmth is the point.'),
  swatch('Pure White', '--white', 'Cards, sheets and inputs lifting off the cream.', true),
  swatch('Warm Gray', '--warm-gray', 'Secondary text and metadata. Legible, never faint.'),
  swatch('Cream Deep', '--cream-deep', 'Recessed wells, chip rests, unfilled bars.', true),
  swatch('Warm Gray Soft', '--warm-gray-soft', 'Tertiary text, placeholders, axis labels.'),
  swatch('Soft Border', '--border', 'Hairlines only, used sparingly \u2014 space separates first.', true),
  swatch('Cocoa Soft', '--cocoa-soft', 'Pressed and hovered states on cocoa surfaces.'),
].join(''));

set('pal-semantic', [
  swatch('Baked Apricot', '--apricot', 'The one accent: selection, focus, the revenue curve.'),
  swatch('Success', '--success', 'Paid, completed, reconciled, in profit.'),
  swatch('Warning', '--warning', 'Pending, low stock, awaiting attention.'),
  swatch('Error', '--error', 'Failed, cancelled, unpaid, negative variance.'),
  swatch('Info', '--info', 'Neutral system notes with no value judgement.'),
].join(''));

const dd = items => items.map(([kind, text]) =>
  `<div class="dd -${kind}"><i aria-hidden="true">${kind === 'do' ? '\u2713' : '\u2715'}</i><span>${text}</span></div>`
).join('');

set('colour-rules', dd([
  ['do', '<b>Apricot is rationed.</b> One accent moment per view. It marks the thing that matters, so it cannot be everywhere.'],
  ['do', '<b>Semantic colour states a fact</b> \u2014 paid, pending, short. It is never chosen because a card looked plain.'],
  ['do', '<b>Colour is always doubled up</b> with a glyph or a word, so meaning survives colour-blindness and direct sunlight.'],
  ['no', '<b>No corporate blue,</b> no neon, no saturated dashboard palette. This is a warm workshop, not a control room.'],
  ['no', '<b>No brown bakery clich\u00e9s</b> \u2014 no wheat, no cupcake pink, no kraft-paper textures. Cocoa is a serious neutral here.'],
  ['no', '<b>No gradient-heavy surfaces.</b> The only gradients in the product are the two-stop washes behind the hero panel.'],
]));

/* --------------------------------------------------------------- TYPE --- */
const TYPE_ROWS = [
  ['Display', '--t-display', 660, '-.036em', 'Hero financial figure', '\u20a6428,500'],
  ['Title 1', '--t-title-1', 660, '-.03em', 'Screen titles, sheet figures', 'Finance'],
  ['Title 2', '--t-title-2', 640, '-.024em', 'Section figures, card totals', '\u20a61,880,000'],
  ['Title 3', '--t-title-3', 620, '-.022em', 'Section headings, list leads', 'Today\u2019s orders'],
  ['Body', '--t-body', 400, '-.011em', 'Reading text, field values', 'Chocolate Cake \u00d7 2'],
  ['Callout', '--t-callout', 400, '-.008em', 'Card copy, secondary values', 'Delivered to Lekki at 2:40 PM'],
  ['Footnote', '--t-foot', 400, '0', 'Metadata, row detail', 'TK-318 \u00b7 Transfer \u00b7 Amara'],
  ['Caption', '--t-caption', 600, '.1em', 'Eyebrows and labels (uppercase)', 'REVENUE'],
];
set('type-scale', TYPE_ROWS.map(([n, v, w, ls, use, sample]) => `
  <div class="ds-type-row">
    <div class="tr-spec"><b style="color:var(--cocoa)">${n}</b><br>${cssVar(v)} \u00b7 ${w}<br>${use}</div>
    <div class="tr-demo" style="font-size:${cssVar(v)};font-weight:${w};letter-spacing:${ls};
      ${n === 'Caption' ? 'text-transform:uppercase;color:var(--warm-gray-soft)' : ''}">${sample}</div>
  </div>`).join(''));

set('type-figures', `
  <div>
    <div class="hero-figure num">${money(428500)}</div>
    <div class="label" style="margin-top:6px">Revenue today</div>
  </div>
  <div>
    <div class="mid-figure num">${money(332500)}</div>
    <div class="label" style="margin-top:5px">Net profit</div>
  </div>
  <div>
    <div class="num" style="font-size:var(--t-title-3);font-weight:620">42</div>
    <div class="label" style="margin-top:4px">Orders</div>
  </div>`);

/* -------------------------------------------------------------- SPACE --- */
const SPACES = [
  ['--s-1', 'hairline nudges'], ['--s-2', 'inside small controls'],
  ['--s-3', 'related items'], ['--s-4', 'card padding'],
  ['--s-5', 'screen gutter'], ['--s-6', 'between ideas'],
  ['--s-8', 'between sections'], ['--s-10', 'breathing room'],
  ['--s-12', 'empty-state air'],
];
set('space-scale', SPACES.map(([v, use]) => {
  const px = cssVar(v);
  return `<div class="ds-space-row">
    <span class="sp-lab">${v.replace('--s-', 'space ')} \u00b7 ${px}</span>
    <i class="sp-bar" style="width:${px}"></i>
    <span class="sp-lab" style="flex:1;text-align:left">${use}</span>
  </div>`;
}).join(''));

/* ------------------------------------------------------------- RADIUS --- */
set('radius-scale', [
  ['--r-xs', 'Tiny chips'], ['--r-sm', 'Buttons, inputs'], ['--r-md', 'Cards'],
  ['--r-lg', 'Floating surfaces'], ['--r-xl', 'Bottom sheets'],
].map(([v, use]) => `<div class="ds-radius">
    <div class="rd-box" style="border-radius:${cssVar(v)}"></div>
    <div class="rd-lab"><b style="color:var(--cocoa)">${cssVar(v)}</b><br>${use}</div>
  </div>`).join(''));

/* ---------------------------------------------------------- ELEVATION --- */
set('elev-scale', [
  ['--e-0', 'Flat on cream'], ['--e-1', 'Barely lifted'], ['--e-2', 'Cards'],
  ['--e-3', 'Menus, toasts'], ['--e-4', 'Bottom sheets'],
].map(([v, use]) => `<div>
    <div class="ds-elev" style="box-shadow:${cssVar(v)}">${v.replace('--e-', 'e')}</div>
    <div class="rd-lab" style="margin-top:9px;font-size:var(--t-caption);color:var(--warm-gray)">${use}</div>
  </div>`).join(''));

/* ------------------------------------------------------------ MOTION --- */
set('motion-table', `
  <thead><tr><th>Moment</th><th>Movement</th><th>Duration</th><th>Curve</th></tr></thead>
  <tbody>
    ${[
      ['Push forward', 'New screen slides in from the right; the old one eases back', 'd-base 240ms', 'ease-nav'],
      ['Pop back', 'Reverse of the push \u2014 the trail is retraced, never re-invented', 'd-base 240ms', 'ease-nav'],
      ['Tab change', 'Cross-fade with a 6px rise. No lateral slide between peers', 'd-fast 140ms', 'ease-out'],
      ['Bottom sheet', 'Rises from the bottom edge, scrim deepens with it', 'd-slow 400ms', 'ease-out'],
      ['Number change', 'Counts from the previous value so change is felt', '620ms', 'ease-out (cubic)'],
      ['Card appearance', 'Fades up 10px, staggered ~40ms down the list', 'd-base 240ms', 'ease-out'],
      ['Status change', 'Badge cross-fades; the row settles into its new group', 'd-fast 140ms', 'ease-out'],
      ['Bar / chart draw', 'Bars grow from the baseline; the curve draws once', '520\u2013560ms', 'ease-out'],
      ['Success', 'A single check that scales in and holds. No confetti', '320ms', 'ease-out'],
      ['Press', 'Every tappable surface scales to ~0.97 under the finger', '140ms', 'ease-out'],
    ].map(r => `<tr>${r.map((c, i) =>
      `<td>${i > 1 ? `<code>${c}</code>` : c}</td>`).join('')}</tr>`).join('')}
  </tbody>`);

set('motion-demos', [
  ['--ease-out', 'Entrances, expansions, everything the user asked for'],
  ['--ease-inout', 'Continuous, looping and ambient movement'],
  ['--ease-nav', 'Screen-to-screen navigation only'],
].map(([v, use]) => `<div class="ds-panel">
    <div class="ds-eyebrow" style="margin-bottom:10px">${v.replace('--ease-', 'ease ')}</div>
    <div class="ds-motion-bar -run" style="--ease-demo:${cssVar(v)}">
      <i style="animation-timing-function:${cssVar(v)}"></i></div>
    <p class="rd-lab" style="margin-top:11px;font-size:var(--t-caption);color:var(--warm-gray);line-height:1.5">${use}</p>
    <code class="ds-code" style="display:inline-block;margin-top:9px;font-size:11px">${cssVar(v)}</code>
  </div>`).join(''));

/* ----------------------------------------------------------- BUTTONS --- */
set('btn-row-1', `
  <button class="btn -primary">Create order</button>
  <button class="btn -accent">${icon('plus', 16)} Record sale</button>
  <button class="btn -secondary">Assign driver</button>
  <button class="btn -tertiary">Skip</button>
  <button class="btn -danger">Cancel order</button>`);

set('btn-row-2', `
  <button class="btn -primary -sm">Small</button>
  <button class="btn -secondary -sm">Small</button>
  <span class="fab" style="position:relative;inset:auto">${icon('plus', 22)}</span>
  <button class="iconbtn -tinted">${icon('filter', 19)}</button>
  <button class="iconbtn">${icon('search', 19)}</button>`);

set('btn-row-3', `
  <button class="btn -primary -block -lg">Create order \u00b7 ${money(37000)}</button>
  <button class="btn -secondary -block">Save as draft</button>`);

/* ------------------------------------------------------------ INPUTS --- */
set('input-col-1', `
  <div class="searchbar">${icon('search', 17)}<input></div>
  <label class="field"><span class="f-label">Customer name</span>
    <input class="f-ctl" value="Emeka Obi"></label>
  <label class="field"><span class="f-label">Note <span class="f-opt">optional</span></span>
    <input class="f-ctl"></label>
  <div class="chips">
    <button class="chip" aria-pressed="true">All</button>
    <button class="chip">Pending</button>
    <button class="chip">Ready</button>
  </div>`);

set('input-col-2', `
  <div class="amount-input"><span class="ai-cur">\u20a6</span><input class="ai-in" value="96,000" inputmode="decimal"></div>
  <div class="segmented" role="tablist">
    <i class="seg-thumb"></i>
    <button aria-pressed="true">7 days</button><button>30 days</button><button>90 days</button>
  </div>
  <div class="ds-row" style="justify-content:space-between">
    <span style="font-size:var(--t-callout)">Low stock alerts</span>
    <span class="switch" role="switch" aria-checked="true"><i></i></span>
  </div>
  <div class="ds-row" style="justify-content:space-between">
    <span style="font-size:var(--t-callout)">Chocolate Cake</span>
    <span class="stepper"><button>${icon('minus', 14)}</button><span class="qty">2</span><button>${icon('plus', 14)}</button></span>
  </div>`);

/* ------------------------------------------------------------- CARDS --- */
set('card-demos', `
  <section class="hero-panel">
    <div class="hp-top">
      <div style="flex:1">
        <div class="hp-label">Revenue today</div>
        <div class="hero-figure num">${money(428500)}</div>
        <div class="hp-sub">42 orders \u00b7 ${money(10202)} average</div>
      </div>
      <span class="delta -on-dark">${icon('trendUp', 11, { stroke: 2.2 })}+12.4%</span>
    </div>
    <div class="hp-chart">
      ${lineChart({ series: DB.week.map(d => ({ v: d.v })), labels: DB.week.map(d => d.d),
        onDark: true, activeIndex: 4, h: 104, w: 420, aria: 'Revenue across the week' })}
    </div>
    <div class="hp-foot">
      <div><div class="v num">${moneyShort(96000)}</div><div class="k">Expenses</div></div>
      <div class="hp-divider"></div>
      <div><div class="v num">${moneyShort(332500)}</div><div class="k">Net</div></div>
      <div class="hp-divider"></div>
      <div><div class="v num">7</div><div class="k">Pending</div></div>
    </div>
  </section>
  <p class="rd-lab" style="font-size:var(--t-caption);color:var(--warm-gray);margin:-4px 0 var(--s-3)">
    <b style="color:var(--cocoa)">Hero panel</b> \u2014 one per screen, for the single number that screen exists to answer.</p>

  <div class="ds-grid -c2">
    <div class="card">
      <div class="eyebrow">Gross margin</div>
      <div class="mid-figure num" style="margin-top:6px">60.2%</div>
      <div class="mini-bar" style="margin-top:var(--s-3)"><i style="width:60%"></i></div>
      <p class="meta" style="margin-top:9px">Healthy for cakes and pastry.</p>
    </div>
    <div class="card">
      <div class="eyebrow">Cash position</div>
      <div class="mid-figure num" style="margin-top:6px">${money(340000)}</div>
      <p class="meta" style="margin-top:9px">Counted at 6:00 PM \u00b7
        <span class="neg">${money(-2500)} short</span></p>
    </div>
  </div>

  <div class="insight">
    <span class="itile -sm">${icon('spark', 15)}</span>
    <div style="flex:1">
      <b style="font-size:var(--t-callout);font-weight:600">Meat Pie is carrying Ikeja</b>
      <p class="meta" style="margin-top:4px;line-height:1.5">214 sold today \u2014 ${money(256800)}, your highest-volume line. Stock is down to 96.</p>
    </div>
  </div>
  <p class="rd-lab" style="font-size:var(--t-caption);color:var(--warm-gray);margin:-4px 0 0">
    <b style="color:var(--cocoa)">Insight card</b> \u2014 an observation drawn from the numbers on screen. Never a fake
    &ldquo;AI&rdquo; claim, never advice the data cannot support.</p>

  <div class="list">
    <button class="txn">
      <span class="avatar -sm -a">EO</span>
      <span class="t-main"><b>Emeka Obi</b>
        <span>2:40 PM<i class="sep-dot"></i>TK-318<i class="sep-dot"></i>Transfer</span></span>
      <span class="t-amt num">${money(24500)}<small>Amara</small></span>
    </button>
    <button class="txn">
      <span class="avatar -sm -c">${icon('bag', 14)}</span>
      <span class="t-main"><b>Walk-in</b>
        <span>1:12 PM<i class="sep-dot"></i>TK-317<i class="sep-dot"></i>Cash</span></span>
      <span class="t-amt num">${money(8600)}<small>Tunde</small></span>
    </button>
  </div>`);

/* ------------------------------------------------------------ STATUS --- */
set('status-badges', Object.keys(STATUS).map(k => {
  const s = STATUS[k];
  return `<span class="badge ${s.cls}">${icon(s.icon, 11, { stroke: 2.2 })}${s.label}</span>`;
}).join('') + Object.keys(PAYSTATE).map(k => {
  const s = PAYSTATE[k];
  return `<span class="badge ${s.cls}">${icon(s.icon, 11, { stroke: 2.2 })}${s.label}</span>`;
}).join(''));

set('status-sync', `
  <div class="ds-eyebrow" style="margin:0">Connection chip</div>
  <div class="ds-row">
    <span class="sync -synced">${icon('check', 12, { stroke: 2.2 })} Synced</span>
    <span class="sync -syncing">${icon('refresh', 12, { stroke: 2.2 })} Syncing\u2026</span>
  </div>
  <div class="ds-row">
    <span class="sync -offline">${icon('wifiOff', 12, { stroke: 2.2 })} 3 waiting</span>
    <span class="sync -attention">${icon('alert', 12, { stroke: 2.2 })} Needs attention</span>
  </div>
  <p class="meta" style="line-height:1.55;margin-top:4px">
    Offline is a normal way to work, not a failure. Changes are kept on the
    phone and sent when the network returns.</p>`);

set('status-recover', `
  <div class="ds-eyebrow" style="margin:0">Offline notice</div>
  <div class="offline-note">
    <span class="itile -sm">${icon('wifiOff', 16)}</span>
    <span class="on-txt"><b>Working offline</b><span>3 changes saved on this phone</span></span>
    <button class="btn -sm -secondary">Review</button>
  </div>
  <div class="ds-eyebrow" style="margin:var(--s-2) 0 0">Empty state</div>
  <div class="empty" style="padding:var(--s-5) 0">
    <div class="e-art">${flowMotif(120, 50, .75)}</div>
    <h4>No orders yet today</h4>
    <p>New orders will appear here as they come in.</p>
  </div>`);

set('status-language', dd([
  ['do', '&ldquo;Couldn\u2019t sync this change yet&rdquo; with a <b>Retry</b> \u2014 says what happened and what to do next.'],
  ['do', '&ldquo;We couldn\u2019t confirm this payment.&rdquo; Where money is involved, never leave the user in doubt.'],
  ['do', '&ldquo;This order was changed by Amara.&rdquo; Name the human, show both versions, let the user decide.'],
  ['no', '&ldquo;RPC failed&rdquo;, &ldquo;500 Internal Server Error&rdquo;, &ldquo;constraint violation&rdquo;. Never expose the plumbing.'],
  ['no', 'Full-bleed red error banners. Volume is not the same thing as clarity.'],
  ['no', 'Blaming the user, or hiding a failure behind a spinner that never resolves.'],
]));

/* ------------------------------------------------------------ CHARTS --- */
set('chart-demos', `
  <div class="ds-bed -white">
    <div class="ds-eyebrow">Revenue trend \u2014 the flow curve</div>
    <div class="cc-plot" id="dsc1">
      ${lineChart({ series: DB.week.map(d => ({ v: d.v })), labels: DB.week.map(d => d.d),
        ghost: DB.weekPrev.map(d => ({ v: d.v })), activeIndex: 5, h: 128, w: 420,
        aria: 'Revenue this week against last week' })}
    </div>
    ${xAxis(DB.week.map(d => d.d), 5)}
    <p class="meta" style="margin-top:9px">Dashed ghost = the previous period. No gridlines, no legend.</p>
  </div>
  <div class="ds-bed -white">
    <div class="ds-eyebrow">Revenue against expenses</div>
    <div class="cc-plot" id="dsc2">
      ${pairedBars({ series: DB.finance.monthSeries.slice(-6), h: 128, w: 420,
        aria: 'Revenue against expenses by month' })}
    </div>
    <p class="meta" style="margin-top:9px">Cocoa is revenue, apricot is expense. Answers one question: is the gap widening?</p>
  </div>
  <div class="ds-bed -white">
    <div class="ds-eyebrow">Where the money went</div>
    <div style="margin-top:var(--s-4)">${flowBar([
      { k: 'Ingredients', v: 1920000, c: 'var(--cocoa)' },
      { k: 'Running costs', v: 1020000, c: 'var(--apricot)' },
      { k: 'Profit', v: 1880000, c: 'var(--success)' },
    ])}</div>
    <p class="meta" style="margin-top:var(--s-3)">The flow bar \u2014 one band splitting into its parts. Revenue in, profit out.</p>
  </div>
  <div class="ds-bed -white" style="display:grid;place-items:center">
    <div class="ds-eyebrow" style="justify-self:start">Expense composition</div>
    ${donut(DB.expenseCats.slice(0, 5).map((c, i) => ({
      v: c.v || (5 - i) * 40000,
      c: ['var(--cocoa)', 'var(--apricot)', 'var(--warning)', 'var(--success)', 'var(--cream-deep)'][i],
    })), { size: 128 })}
    <p class="meta" style="margin-top:var(--s-3);text-align:center">Used once, for composition only \u2014 never for comparison.</p>
  </div>`);

/* ------------------------------------------------------------- ICONS --- */
const ICON_SHOWCASE = [
  'home', 'orders', 'sales', 'finance', 'grid', 'plus', 'check', 'checkCircle',
  'close', 'chevRight', 'trendUp', 'trendDown', 'search', 'filter', 'refresh',
  'bell', 'settings', 'user', 'users', 'store', 'bag', 'box', 'ticket',
  'receipt', 'cash', 'card', 'bank', 'wallet', 'chart', 'pie', 'doc', 'clock',
  'calendar', 'pin', 'truck', 'spark', 'flame', 'layers', 'wifiOff', 'cloudSync',
  'alert', 'info', 'lock', 'edit', 'trash', 'tag', 'bolt', 'shield', 'scale', 'bread',
];
set('icon-grid', ICON_SHOWCASE
  .filter(n => ICON_PATHS[n])
  .map(n => `<div class="ds-icon-cell">${icon(n, 21)}<span>${n}</span></div>`).join(''));

/* -------------------------------------------------------- NAVIGATION --- */
set('nav-table', `
  <thead><tr><th>Role</th><th>Opens into</th><th>Tab bar</th><th>Why</th></tr></thead>
  <tbody>
    ${[
      ['Owner', 'Profit and trend', 'Home \u00b7 Orders \u00b7 Sales \u00b7 Finance \u00b7 More',
       'Owners ask &ldquo;did we make money?&rdquo; before anything else.'],
      ['Manager', 'Today\u2019s operations', 'Home \u00b7 Orders \u00b7 Sales \u00b7 Cash \u00b7 More',
       'Runs the floor and the drawer; profit is the owner\u2019s question, not theirs.'],
      ['Staff', 'The next task', 'Home \u00b7 Orders \u00b7 Sales \u00b7 More',
       'Needs to take an order and record a sale in as few taps as possible.'],
      ['Driver', 'Their run', 'Home \u00b7 Route \u00b7 Tickets \u00b7 More',
       'One question only: what am I delivering, and where next?'],
    ].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td><code>${r[2]}</code></td><td>${r[3]}</td></tr>`).join('')}
  </tbody>`);

/* ------------------------------------------------------ ARCHITECTURE --- */
set('arch-table', `
  <thead><tr><th>Component</th><th>Responsibility</th></tr></thead>
  <tbody>
    ${[
      ['FinancialMetric', 'A figure with its label, delta and optional sparkline. Animates between values.'],
      ['HeroPanel', 'The dark once-per-screen panel carrying the screen\u2019s primary number.'],
      ['OrderCard / TicketCard', 'An order at a glance: customer, items, total, status, time.'],
      ['StatusBadge', 'Glyph plus word for order and payment state. Never colour alone.'],
      ['ProductRow / CustomerRow', 'A list identity with trailing value and optional stepper.'],
      ['TransactionRow', 'Avatar, reference, method, amount and who took it.'],
      ['InsightCard', 'An observation derived from visible data.'],
      ['ChartCard', 'Titled plot with touch tooltips and an optional comparison series.'],
      ['BottomSheet', 'Modal surface for selection and detail. Drag-to-dismiss.'],
      ['QuickAction', 'One-tap entry into the flows a role uses hourly.'],
      ['EmptyState', 'Flow motif, plain-spoken heading, and a way forward.'],
      ['SyncIndicator', 'The four connection states, and the queue behind them.'],
      ['OrganizationSwitcher', 'Business and branch context, with the figures that change on switch.'],
      ['Stepper / AmountInput', 'Quantity and money entry, sized for thumbs at a counter.'],
    ].map(r => `<tr><td><code>${r[0]}</code></td><td>${r[1]}</td></tr>`).join('')}
  </tbody>`);

/* -------------------------------------------------------- PRINCIPLES --- */
set('principle-list', dd([
  ['no', '<b>Not an accounting package.</b> A baker should never meet the words debit, credit or ledger entry.'],
  ['no', '<b>Not a dense table.</b> If a screen needs a spreadsheet, the screen is wrong.'],
  ['no', '<b>Not a desktop layout squeezed onto a phone.</b> Thumb-first, one-handed, at a flour-dusted counter.'],
  ['no', '<b>No fake intelligence.</b> Insights restate what the numbers already say. Nothing is predicted that cannot be.'],
  ['no', '<b>No glassmorphism, no heavy shadows, no neon, no stock photography.</b>'],
  ['do', '<b>Simplify relentlessly.</b> Simple on the surface, powerful underneath \u2014 depth is revealed on demand, never dumped.'],
  ['do', '<b>Money is the loudest thing on screen.</b> Always \u20a6428,500 \u2014 never 428500 NGN.'],
  ['do', '<b>Offline is a first-class state,</b> because Lagos networks are. Work never blocks on a spinner.'],
]));

/* Charts get their tooltips, exactly as in the app. */
wireChart(el('dsc1'), ({ v, l }) => `<b>${money(v)}</b><em>${l}</em>`);
wireChart(el('dsc2'), ({ v, v2, l }) =>
  `<b>${money(v)}</b><em>${l} \u00b7 spent ${money(v2)}</em>`);
