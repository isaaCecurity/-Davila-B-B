/* ==========================================================================
   BAKEFLOW — Demo data
   Internally consistent. Sweet Crumbs Bakery, Lagos. Nigerian Naira.
   ========================================================================== */

const DB = {

  /* ---------------------------------------------------------- people --- */
  users: {
    owner:   { id:'u1', name:'David Okonkwo',  first:'David',  role:'owner',   title:'Owner',           init:'DO', tone:'a' },
    manager: { id:'u2', name:'Amara Nwosu',    first:'Amara',  role:'manager', title:'Branch Manager',  init:'AN', tone:'b' },
    staff:   { id:'u3', name:'Tunde Bakare',   first:'Tunde',  role:'staff',   title:'Salesperson',   init:'TB', tone:'c' },
    driver:  { id:'u4', name:'Ifeanyi Eze',    first:'Ifeanyi',role:'driver',  title:'Delivery / Field',init:'IE', tone:'d' },
    supervisor: { id:'u7', name:'Ngozi Achebe', first:'Ngozi', role:'supervisor', title:'Supervisor', init:'NA', tone:'e' },
    baker: { id:'u5', name:'David Balogun', first:'David', role:'baker', title:'Baker', init:'DB', tone:'a' },
    admin: { id:'u8', name:'Chika Eze', first:'Chika', role:'admin', title:'Admin', init:'CE', tone:'b' },
  },

  invites: [
    { id:'iv1', email:'chidi.okeke@example.com', role:'Counter Staff', status:'pending', sentAt:'2 days ago' },
    { id:'iv2', email:'blessing.udo@example.com', role:'Baker', status:'accepted', sentAt:'1 week ago' },
    { id:'iv3', email:'tunde.balogun@example.com', role:'Delivery', status:'expired', sentAt:'3 weeks ago' },
  ],

  staffList: [
    { id:'u2', name:'Amara Nwosu',  role:'Branch Manager', branch:'Ikeja',  init:'AN', tone:'b', today:{ orders:14, sales:186500 }, status:'On shift', since:'7:12 AM' },
    { id:'u7', name:'Ngozi Achebe', role:'Supervisor',     branch:'Ikeja',  init:'NA', tone:'e', today:{ orders:0,  sales:0       }, status:'On shift', since:'7:00 AM' },
    { id:'u3', name:'Tunde Bakare', role:'Salesperson',  branch:'Ikeja',  init:'TB', tone:'c', today:{ orders:19, sales:142000 }, status:'On shift', since:'6:58 AM' },
    { id:'u4', name:'Ifeanyi Eze',  role:'Delivery',       branch:'Lekki',  init:'IE', tone:'d', today:{ orders:9,  sales:64500  }, status:'On route', since:'8:04 AM' },
    { id:'u5', name:'David Balogun', role:'Baker',         branch:'Ikeja',  init:'DB', tone:'a', today:{ orders:0,  sales:0      }, status:'On shift', since:'4:30 AM' },
    { id:'u6', name:'Segun Ayoola', role:'Counter Staff',  branch:'Yaba',   init:'SA', tone:'e', today:{ orders:7,  sales:35500  }, status:'Off shift', since:'Ended 1:00 PM' },
  ],

  /* --------------------------------------------------- organisations --- */
  orgs: [
    { id:'o1', name:'Sweet Crumbs Bakery', init:'SC', city:'Lagos',  branches:['Ikeja','Lekki','Yaba'], staff:14, role:'Owner',   today:428500, active:true, supervisorEnabled:true },
    { id:'o2', name:'Golden Oven Bakery',  init:'GO', city:'Ibadan', branches:['Bodija','Ring Road'],    staff:6,  role:'Owner',   today:186400, active:false },
    { id:'o3', name:"Mama's Cakes",        init:'MC', city:'Abuja',  branches:['Wuse'],                  staff:3,  role:'Manager', today:74200,  active:false },
  ],

  /* -------------------------------------------------------- products --- */
  products: [
    { id:'p1', name:'Chocolate Cake',    cat:'Cakes',   price:18000, cost:9200,  stock:11, unit:'each',  sold:24, revenue:432000, img:'chocolate-cake' },
    { id:'p2', name:'Vanilla Cake',      cat:'Cakes',   price:15500, cost:7800,  stock:8,  unit:'each',  sold:16, revenue:248000, img:'vanilla-cake' },
    { id:'p3', name:'Red Velvet Cake',   cat:'Cakes',   price:22000, cost:11500, stock:4,  unit:'each',  sold:9,  revenue:198000, img:'red-velvet' },
    { id:'p4', name:'Celebration Cake',  cat:'Cakes',   price:32000, cost:15800, stock:3,  unit:'each',  sold:6,  revenue:192000, img:'celebration' },
    { id:'p5', name:'Meat Pie',          cat:'Savoury', price:1200,  cost:520,   stock:96, unit:'piece', sold:214,revenue:256800, img:'meat-pie' },
    { id:'p6', name:'Chicken Pie',       cat:'Savoury', price:1400,  cost:610,   stock:64, unit:'piece', sold:132,revenue:184800, img:'chicken-pie' },
    { id:'p7', name:'Sausage Roll',      cat:'Savoury', price:900,   cost:390,   stock:120,unit:'piece', sold:188,revenue:169200, img:'sausage-roll' },
    { id:'p8', name:'Small Chops (Pack)',cat:'Savoury', price:6500,  cost:2900,  stock:18, unit:'pack',  sold:31, revenue:201500, img:'small-chops' },
    { id:'p9', name:'Agege Bread',       cat:'Bread',   price:1500,  cost:640,   stock:52, unit:'loaf',  sold:176,revenue:264000, img:'bread' },
    { id:'p10',name:'Wheat Bread',       cat:'Bread',   price:2200,  cost:980,   stock:9,  unit:'loaf',  sold:88, revenue:193600, img:'wheat-bread' },
    { id:'p11',name:'Doughnut',          cat:'Pastry',  price:700,   cost:280,   stock:140,unit:'piece', sold:246,revenue:172200, img:'doughnut' },
    { id:'p12',name:'Cinnamon Roll',     cat:'Pastry',  price:1100,  cost:450,   stock:0,  unit:'piece', sold:64, revenue:70400,  img:'cinnamon' },
  ],
  productCats: ['All','Cakes','Savoury','Bread','Pastry'],

  /* ------------------------------------------------------- customers --- */
  customers: [
    { id:'walkin', name:'Walk-in customer', init:'WI', tone:'e', phone:'', type:'Walk-in', orders:0, spent:0, last:'—', area:'—', address:'—' },
    { id:'c1', name:'Sarah Ade',            init:'SA', tone:'a', phone:'0803 412 7788', type:'Regular',   orders:23, spent:842000, last:'Today',      area:'Ikeja GRA',        address:'14 Oduduwa Way, Ikeja GRA',        instructions:'Call when outside — gate has no bell.' },
    { id:'c2', name:'Emeka Obi',            init:'EO', tone:'b', phone:'0810 992 3140', type:'Wholesale', orders:41, spent:1960000,last:'Today',      area:'Ogba',             address:'22 Ogunnusi Road, Ogba',           instructions:'Deliver to the back loading bay.' },
    { id:'c3', name:'Blessing Ogun',        init:'BO', tone:'c', phone:'0705 338 2019', type:'Regular',   orders:12, spent:318000, last:'Yesterday',  area:'Lekki Ph 1',       address:'9 Admiralty Way, Lekki Phase 1',   instructions:'' },
    { id:'c4', name:'Kunle Bakare',         init:'KB', tone:'d', phone:'0813 774 5502', type:'Regular',   orders:8,  spent:154000, last:'2 days ago', area:'Yaba',             address:'3 Herbert Macaulay Way, Yaba',     instructions:'' },
    { id:'c5', name:'Grace Mart Ltd',       init:'GM', tone:'e', phone:'0701 226 8890', type:'Wholesale', orders:64, spent:3480000,last:'Today',      area:'Ikeja',            address:'Shop 4, Allen Avenue Market, Ikeja', instructions:'Ask for the store manager on arrival.' },
    { id:'c6', name:'Fatima Bello',         init:'FB', tone:'a', phone:'0902 551 7734', type:'Regular',   orders:5,  spent:96500,  last:'4 days ago', area:'Maryland',         address:'11 Ikorodu Road, Maryland',        instructions:'' },
    { id:'c7', name:'Chidi Nwankwo',        init:'CN', tone:'b', phone:'0806 118 4423', type:'Regular',   orders:17, spent:412000, last:'Today',      area:'Surulere',         address:'27 Bode Thomas Street, Surulere',  instructions:'Second gate on the left.' },
    { id:'c8', name:'Royal Suites Hotel',   init:'RS', tone:'c', phone:'0812 447 9001', type:'Contract',  orders:28, spent:2140000,last:'Yesterday',  area:'Victoria Island',  address:'5 Ozumba Mbadiwe Ave, Victoria Island', instructions:'Deliveries go through the service entrance.' },
  ],

  /* ---------------------------------------------------------- orders --- */
  /* status: pending | preparing | ready | delivering | completed | cancelled */
  orders: [
    { id:'o2048', ref:'BF-2048', cust:'c1', total:78000, status:'ready',      time:'2:30 PM', when:'today', paid:'paid',    channel:'Walk-in',  staff:'u3', branch:'Ikeja',
      items:[{p:'p4',q:2},{p:'p8',q:1},{p:'p9',q:5}], note:'Pick-up at 3 PM. Write "Happy 30th, Sarah" on the larger cake.' },
    { id:'o2047', ref:'BF-2047', cust:'c5', total:186000,status:'delivering', time:'1:05 PM', when:'today', paid:'partial', channel:'Wholesale',staff:'u4', branch:'Ikeja',
      items:[{p:'p9',q:60},{p:'p5',q:45},{p:'p11',q:60}], note:'Standard Tuesday supply run. Driver: Ifeanyi.' },
    { id:'o2046', ref:'BF-2046', cust:'c7', total:24500, status:'pending',    time:'12:40 PM',when:'today', paid:'unpaid',  channel:'Phone',    staff:'u2', branch:'Ikeja',
      items:[{p:'p1',q:1},{p:'p8',q:1}], note:'' },
    { id:'o2045', ref:'BF-2045', cust:'c3', total:47000, status:'preparing',  time:'11:20 AM',when:'today', paid:'paid',    channel:'WhatsApp', staff:'u2', branch:'Lekki',
      items:[{p:'p3',q:2},{p:'p6',q:1},{p:'p7',q:1},{p:'p11',q:1}], note:'No nuts — allergy.' },
    { id:'o2044', ref:'BF-2044', cust:'c2', total:64800, status:'completed',  time:'10:15 AM',when:'today', paid:'paid',    channel:'Wholesale',staff:'u3', branch:'Ikeja',
      items:[{p:'p5',q:24},{p:'p7',q:20},{p:'p9',q:12}], note:'' },
    { id:'o2043', ref:'BF-2043', cust:'c8', total:112000,status:'completed',  time:'9:02 AM', when:'today', paid:'paid',    channel:'Contract', staff:'u2', branch:'Lekki',
      items:[{p:'p10',q:25},{p:'p11',q:60},{p:'p9',q:10}], note:'Daily hotel breakfast order.' },
    { id:'o2042', ref:'BF-2042', cust:'c6', total:19700, status:'pending',    time:'8:44 AM', when:'today', paid:'unpaid',  channel:'Walk-in',  staff:'u3', branch:'Ikeja',
      items:[{p:'p2',q:1},{p:'p5',q:2},{p:'p7',q:2}], note:'Customer will confirm flavour by 4 PM.' },
    { id:'o2041', ref:'BF-2041', cust:'c4', total:8600,  status:'cancelled',  time:'8:10 AM', when:'today', paid:'unpaid',  channel:'Phone',    staff:'u3', branch:'Yaba',
      items:[{p:'p9',q:2},{p:'p11',q:8}], note:'Customer cancelled — will reorder Friday.' },
    { id:'o2040', ref:'BF-2040', cust:'c1', total:32000, status:'completed',  time:'4:52 PM', when:'yesterday', paid:'paid', channel:'Walk-in', staff:'u3', branch:'Ikeja',
      items:[{p:'p4',q:1}], note:'' },
    { id:'o2039', ref:'BF-2039', cust:'c2', total:58200, status:'completed',  time:'2:18 PM', when:'yesterday', paid:'paid', channel:'Wholesale',staff:'u2',branch:'Ikeja',
      items:[{p:'p5',q:30},{p:'p9',q:12},{p:'p11',q:6}], note:'' },
    { id:'o2052', ref:'BF-2052', cust:'c8', total:96000, status:'pending',    time:'Tomorrow 7:00 AM', when:'upcoming', paid:'unpaid', channel:'Contract', staff:'u2', branch:'Lekki',
      items:[{p:'p10',q:20},{p:'p11',q:40},{p:'p5',q:20}], note:'Recurring daily order.' },
    { id:'o2053', ref:'BF-2053', cust:'c3', total:64000, status:'pending',    time:'Thu 11:00 AM', when:'upcoming', paid:'partial', channel:'WhatsApp', staff:'u2', branch:'Lekki',
      items:[{p:'p4',q:2}], note:'Wedding anniversary — two-tier, ivory finish.' },
  ],

  /* ---------------------------------------------------------- tickets --- */
  tickets: [
    { id:'t311', ref:'TK-311', cust:'c5', total:42500, status:'completed', time:'11:48 AM', by:'u4', items:[{p:'p9',q:20},{p:'p8',q:1},{p:'p5',q:5}], sync:'synced',  area:'Ogba' },
    { id:'t312', ref:'TK-312', cust:'c7', total:18300, status:'completed', time:'12:22 PM', by:'u4', items:[{p:'p11',q:12},{p:'p7',q:11}], sync:'synced',  area:'Surulere' },
    { id:'t313', ref:'TK-313', cust:'c2', total:24500, status:'pending',   time:'1:34 PM',  by:'u4', items:[{p:'p11',q:5},{p:'p5',q:10},{p:'p9',q:6}], sync:'pending', area:'Ogba' },
  ],

  /* ------------------------------------------------------------ sales --- */
  sales: {
    todayTotal: 428500,
    yesterdayTotal: 381200,
    /* Each group's rows sum exactly to its stated total, and the method split
       sums to todayTotal. The two "Counter sales" rows are aggregates of the
       many small walk-in purchases, which is what makes 10 visible rows add up
       to a 42-transaction day. Cash here (₦284,500) is also what the Ikeja
       drawer is reconciling on the cash-session screen. */
    groups: [
      { label:'Today', total:428500, rows:[
        { id:'s1', time:'2:34 PM', cust:'Sarah Ade',      ref:'BF-2048', method:'Transfer', amount:78000,  staff:'Tunde',  tone:'a' },
        { id:'s2', time:'1:58 PM', cust:'Counter sales',  ref:'12 items',method:'Cash',     amount:3400,   staff:'Tunde',  tone:'e' },
        { id:'s3', time:'1:34 PM', cust:'Emeka Obi',      ref:'TK-313',  method:'POS',      amount:24500,  staff:'Ifeanyi',tone:'b' },
        { id:'s4', time:'1:05 PM', cust:'Grace Mart Ltd', ref:'BF-2047', method:'Cash',     amount:120000, staff:'Amara',  tone:'e', note:'Part payment of ₦186,000' },
        { id:'s5', time:'12:22 PM',cust:'Chidi Nwankwo',  ref:'TK-312',  method:'POS',      amount:18300,  staff:'Ifeanyi',tone:'b' },
        { id:'s6', time:'11:48 AM',cust:'Grace Mart Ltd', ref:'TK-311',  method:'Cash',     amount:42500,  staff:'Ifeanyi',tone:'e' },
        { id:'s7', time:'11:20 AM',cust:'Blessing Ogun',  ref:'BF-2045', method:'Cash',     amount:47000,  staff:'Amara',  tone:'c' },
        { id:'s8', time:'10:15 AM',cust:'Emeka Obi',      ref:'BF-2044', method:'Cash',     amount:64800,  staff:'Tunde',  tone:'b' },
        { id:'s9', time:'9:30 AM', cust:'Counter sales',  ref:'31 items',method:'POS',      amount:23200,  staff:'Segun',  tone:'e' },
        { id:'s10',time:'8:40 AM', cust:'Walk-in',        ref:'BF-2051', method:'Cash',     amount:6800,   staff:'Tunde',  tone:'e' },
      ]},
      { label:'Yesterday', total:381200, rows:[
        { id:'s11',time:'4:52 PM', cust:'Sarah Ade',      ref:'BF-2040', method:'Cash',     amount:32000,  staff:'Tunde',  tone:'a' },
        { id:'s12',time:'3:35 PM', cust:'Grace Mart Ltd', ref:'BF-2036', method:'Transfer', amount:96000,  staff:'Amara',  tone:'e' },
        { id:'s13',time:'2:18 PM', cust:'Emeka Obi',      ref:'BF-2039', method:'Transfer', amount:58200,  staff:'Amara',  tone:'b' },
        { id:'s14',time:'1:10 PM', cust:'Blessing Ogun',  ref:'BF-2035', method:'POS',      amount:38500,  staff:'Amara',  tone:'c' },
        { id:'s15',time:'11:40 AM',cust:'Royal Suites',   ref:'BF-2038', method:'Transfer', amount:104000, staff:'Amara',  tone:'c' },
        { id:'s16',time:'10:05 AM',cust:'Walk-in',        ref:'BF-2037', method:'Cash',     amount:14200,  staff:'Segun',  tone:'e' },
        { id:'s17',time:'9:15 AM', cust:'Counter sales',  ref:'44 items',method:'Cash',     amount:38300,  staff:'Segun',  tone:'e' },
      ]},
    ],
    /* Percentages use the largest-remainder method so they total exactly 100. */
    methods: [
      { k:'Cash',     v:284500, pct:66, icon:'cash' },
      { k:'Transfer', v:78000,  pct:18, icon:'bank' },
      { k:'POS',      v:66000,  pct:16, icon:'card' },
    ],
  },

  /* ----------------------------------------------------------- weekly --- */
  week: [
    { d:'Mon', v:280000 }, { d:'Tue', v:310000 }, { d:'Wed', v:365000 },
    { d:'Thu', v:342000 }, { d:'Fri', v:428500 }, { d:'Sat', v:512000 }, { d:'Sun', v:390000 },
  ],
  weekPrev: [
    { d:'Mon', v:245000 }, { d:'Tue', v:262000 }, { d:'Wed', v:301000 },
    { d:'Thu', v:318000 }, { d:'Fri', v:372000 }, { d:'Sat', v:465000 }, { d:'Sun', v:352000 },
  ],
  today: { revenue:428500, orders:42, pending:7, completed:35, expenses:96000, net:332500, cashPosition:342500, avgTicket:10202 },

  /* ---------------------------------------------------------- finance --- */
  finance: {
    periods: {
      '7d':  { revenue:2627500, expenses:1612000, profit:1015500, dRev:12.4,  dExp:6.1,  dProf:19.8, orders:284, margin:38.7 },
      '30d': { revenue:4820000, expenses:2940000, profit:1880000, dRev:8.6,   dExp:4.2,  dProf:14.1, orders:1128,margin:39.0 },
      '90d': { revenue:13640000,expenses:8710000, profit:4930000, dRev:5.2,   dExp:7.4,  dProf:1.9,  orders:3216,margin:36.1 },
    },
    monthSeries: [
      { d:'W1', rev:1080000, exp:690000 }, { d:'W2', rev:1164000, exp:712000 },
      { d:'W3', rev:1268000, exp:748000 }, { d:'W4', rev:1308000, exp:790000 },
    ],
    pnl: {
      revenue: { total:4820000, lines:[
        { k:'Cake sales',      v:1620000 }, { k:'Savoury & pies',  v:1284000 },
        { k:'Bread',           v:1046000 }, { k:'Pastry',          v:612000 },
        { k:'Wholesale & contract', v:258000 },
      ]},
      cogs: { total:1920000, lines:[
        { k:'Flour & grains',  v:642000 }, { k:'Dairy & eggs',    v:498000 },
        { k:'Sugar & fillings',v:386000 }, { k:'Packaging',       v:248000 },
        { k:'Fuel for ovens',  v:146000 },
      ]},
      opex: { total:1020000, lines:[
        { k:'Staff wages',     v:486000 }, { k:'Rent',            v:220000 },
        { k:'Utilities',       v:148000 }, { k:'Transport',       v:104000 },
        { k:'Maintenance',     v:62000 },
      ]},
      grossProfit:2900000, netProfit:1880000, grossMargin:60.2, netMargin:39.0,
      prevNet:1648000,
    },
  },

  /* --------------------------------------------------------- expenses --- */
  expenseCats: [
    { k:'Ingredients', icon:'scale',    tone:'-accent' },
    { k:'Transport',   icon:'truck',    tone:'' },
    { k:'Utilities',   icon:'bolt',     tone:'-warn' },
    { k:'Staff',       icon:'users',    tone:'' },
    { k:'Rent',        icon:'store',    tone:'' },
    { k:'Packaging',   icon:'box',      tone:'' },
    { k:'Equipment',   icon:'settings', tone:'' },
    { k:'Other',       icon:'tag',      tone:'' },
  ],
  expenses: {
    todayTotal:96000, monthTotal:2940000,
    breakdown:[
      { k:'Ingredients', v:1284000, pct:44 }, { k:'Staff',     v:486000, pct:17 },
      { k:'Rent',        v:220000,  pct:7  }, { k:'Utilities', v:148000, pct:5  },
      { k:'Packaging',   v:248000,  pct:8  }, { k:'Transport', v:104000, pct:4  },
      { k:'Other',       v:450000,  pct:15 },
    ],
    rows:[
      { id:'e1', cat:'Ingredients', desc:'Flour — 12 bags',        amount:54000, time:'Today, 6:40 AM',  method:'Cash',     by:'Chioma', icon:'scale',  receipt:true },
      { id:'e2', cat:'Transport',   desc:'Fuel — delivery van',    amount:18000, time:'Today, 8:15 AM',  method:'Cash',     by:'Ifeanyi',icon:'truck',  receipt:true },
      { id:'e3', cat:'Utilities',   desc:'Diesel for generator',   amount:15000, time:'Today, 9:30 AM',  method:'Cash',     by:'Amara',  icon:'bolt',   receipt:false },
      { id:'e4', cat:'Packaging',   desc:'Cake boxes — 100 units', amount:9000,  time:'Today, 11:02 AM', method:'Transfer', by:'Amara',  icon:'box',    receipt:true },
      { id:'e5', cat:'Ingredients', desc:'Butter & eggs',          amount:38500, time:'Yesterday, 7:20 AM',method:'Cash',   by:'Chioma', icon:'scale',  receipt:true },
      { id:'e6', cat:'Staff',       desc:'Weekend overtime — 3 staff',amount:24000,time:'Yesterday, 6:00 PM',method:'Transfer',by:'David',icon:'users', receipt:false },
    ],
  },

  /* ------------------------------------------------------------- cash --- */
  /* The branch till is derived, not hardcoded: opening float + cash handed
     over by closed staff drawers (see staffDrawers) − today's cash expenses
     (DB.expenses.rows where method === 'Cash') + any settled trip cash.
     `actual` is the one manually-entered figure — what got physically
     counted — everything else is computed via getters below. */
  cash: {
    open:100000, actual:41700, openedBy:'Amara Nwosu', openedAt:'6:45 AM', branch:'Ikeja',
    tripCash:[], // { k, v, t, kind } pushed when a driver trip settles cash into this till
    get openDrawers() { return drawerSummaries().filter(d => d.open); },
    get closedDrawers() { return drawerSummaries().filter(d => !d.open); },
    get handoverTotal() { return this.closedDrawers.reduce((s, d) => s + d.cashSales - d.cashExpenses, 0); },
    get tripCashTotal() { return this.tripCash.reduce((s, m) => s + m.v, 0); },
    get sales() { return this.handoverTotal; },
    get expenses() { return branchCashExpensesToday(); },
    get expected() { return this.open + this.handoverTotal - branchCashExpensesToday() + this.tripCashTotal; },
    get diff() { return this.actual - this.expected; },
    get movements() {
      const cashExp = DB.expenses.rows.filter(r => r.method === 'Cash' && r.time.startsWith('Today'));
      return [
        { k:'Opening balance', v:this.open, t:this.openedAt, kind:'open' },
        ...this.closedDrawers.map(d => ({ k:`Cash handover — ${d.name}`, v:d.cashSales - d.cashExpenses, t:d.closedAt || 'today', kind:'in' })),
        ...cashExp.map(r => ({ k:r.desc, v:-r.amount, t:r.time.replace('Today, ', ''), kind:'out' })),
        ...this.tripCash,
      ];
    },
    history:[
      { d:'Yesterday', expected:318400, actual:318400, diff:0 },
      { d:'Sun 9 Aug', expected:402100, actual:401000, diff:-1100 },
      { d:'Sat 8 Aug', expected:486300, actual:486300, diff:0 },
    ],
  },

  /* ------------------------------------------------------- staff drawers --- */
  /* Every salesperson counts their own drawer through the shift and hands
     the cash over when they close it — that handover, not a live feed, is
     what reaches the branch till (cash doesn't move until it's physically
     handed over). Tunde's figures are live off DB.mySales/myExpenses/
     myCashSession (see drawerSummaries()); Segun's shift already ended, so
     his is a settled summary. */
  staffDrawers: [
    { staffId:'u3', name:'Tunde Bakare' },
    { staffId:'u6', name:'Segun Ayoola', open:false, openingFloat:15000, openedAt:'7:00 AM', closedAt:'1:00 PM',
      cashSales:20000, transferSales:10500, posSales:5000, cashExpenses:0 },
  ],

  /* --------------------------------------------------------- branches --- */
  branches: [
    { k:'Ikeja', rev:214300, orders:22, pct:50, delta:14.2, staff:6 },
    { k:'Lekki', rev:142800, orders:13, pct:33, delta:8.1,  staff:5 },
    { k:'Yaba',  rev:71400,  orders:7,  pct:17, delta:-3.4, staff:3 },
  ],

  /* --------------------------------------------------------- insights --- */
  insights: {
    owner: [
      { icon:'trendUp', tone:'-ok',     t:'Sales are up 18% on last Tuesday.',        b:'Cakes drove most of the lift — 24 sold against 17 last week.' },
      { icon:'spark',   tone:'-accent', t:'Chocolate Cake earned the most today.',    b:'₦432,000 this month at a 49% margin — your strongest product.' },
      { icon:'alert',   tone:'-warn',   t:'₦42,000 in payments needs attention.',     b:'Grace Mart Ltd part-paid order BF-2047 this afternoon.', act:'View order' },
      { icon:'clock',   tone:'',        t:'Afternoons out-earn mornings by 34%.',     b:'Consider moving the second bake to 11 AM.' },
    ],
    manager: [
      { icon:'alert',   tone:'-warn',   t:'7 orders still open this afternoon.',      b:'2 are past their promised time. Ikeja has the backlog.', act:'Open orders' },
      { icon:'box',     tone:'',        t:'Red Velvet is down to 4 cakes.',           b:'Yesterday you sold 9. Worth a second batch today.' },
      { icon:'cash',    tone:'-bad',    t:'Cash drawer is ₦2,500 short.',             b:'Expected ₦342,500, counted ₦340,000.', act:'Review session' },
    ],
    staff: [
      { icon:'ticket',  tone:'-accent', t:'3 orders are waiting at the counter.',     b:'BF-2048 is due for pick-up at 3:00 PM.' },
    ],
    driver: [
      { icon:'truck',   tone:'-accent', t:'2 stops left on your route.',              b:'Ogba, then Surulere. About 40 minutes of driving.' },
    ],
  },

  /* ------------------------------------------------------------ tasks --- */
  /* Delivery status is a real state machine, not a free label:
     assigned -> in_transit -> delivered [terminal]
                            -> failed -> returned [terminal]
                            -> returned [terminal]
     A driver can never self-assign (pending->assigned is owner/manager only) —
     every stop here already arrives pre-assigned to this driver. */
  /* -------------------------------------------------- salesperson till --- */
  /* Lightweight, separate from the Orders/tickets ledger — a salesperson's
     own counter sales, not the org-wide order pipeline. */
  mySales: [
    { id:'sl5', ref:'SL-1005', time:'2:20 PM', cust:'Walk-in',   items:[{ p:'p11', q:6 }],           total:4200,  method:'Cash',     received:5000 },
    { id:'sl4', ref:'SL-1004', time:'1:48 PM', cust:'Walk-in',   items:[{ p:'p5', q:4 },{ p:'p9', q:2 }], total:7800, method:'Transfer', received:7800 },
    { id:'sl3', ref:'SL-1003', time:'12:55 PM',cust:'Fatima Bello', items:[{ p:'p1', q:1 }],          total:18000, method:'POS',      received:18000 },
    { id:'sl2', ref:'SL-1002', time:'11:30 AM',cust:'Walk-in',   items:[{ p:'p7', q:3 },{ p:'p11', q:4 }], total:5500, method:'Cash', received:6000 },
    { id:'sl1', ref:'SL-1001', time:'9:05 AM', cust:'Walk-in',   items:[{ p:'p9', q:2 }],             total:3000,  method:'Cash',     received:3000 },
  ],
  myCashSession: { open:false, openingFloat:20000, openedAt:'6:58 AM', openedBy:'Tunde Bakare', closedAt:'1:15 PM' },

  /* A salesperson's own till expenses — cash paid out of the drawer during
     the shift (e.g. a delivery bike top-up), reconciled at session close. */
  myExpenses: [
    { id:'me1', time:'11:15 AM', cat:'Transport', desc:'Bike fuel for delivery run', amount:1500 },
  ],

  /* ------------------------------------------------- production batches --- */
  /* Monitoring only here — Supervisor sees status, never edits directly.
     scheduled -> in_progress -> completed [terminal] / failed [terminal] */
  productionBatches: [
    { id:'pb1', product:'Agege Bread',     qty:80, status:'in_progress', baker:'David Balogun', started:'5:10 AM', producedQty:null },
    { id:'pb2', product:'Doughnut',        qty:200,status:'in_progress', baker:'David Balogun', started:'6:40 AM', producedQty:null },
    { id:'pb3', product:'Chocolate Cake',  qty:6,  status:'scheduled',   baker:'David Balogun', started:null, producedQty:null },
    { id:'pb4', product:'Meat Pie',        qty:150,status:'completed',   baker:'David Balogun', started:'4:00 AM', producedQty:150 },
    { id:'pb5', product:'Sausage Roll',    qty:120,status:'failed',      baker:'David Balogun', started:'4:20 AM', reason:'Oven fault — batch scrapped', producedQty:null },
  ],

  /* ---------------------------------------------- baker's own records --- */
  myProduction: [
    { id:'pr1', time:'10:15 AM', product:'Meat Pie', qty:150, unit:'piece', batchId:'pb4', note:'', correction:null },
  ],

  /* -------------------------------------------------- stock movements --- */
  /* Read-only ledger view for Supervisor — quantities are never hand-edited,
     only ever the result of a movement like this. */
  stockMovements: [
    { id:'sm1', item:'Agege Bread',   kind:'production_output', qty:80,  time:'6:10 AM', by:'David Balogun' },
    { id:'sm2', item:'Flour',         kind:'production_consume',qty:-32, time:'6:10 AM', by:'David Balogun' },
    { id:'sm3', item:'Cinnamon Roll', kind:'sale',               qty:-6,  time:'11:20 AM',by:'Tunde Bakare' },
    { id:'sm4', item:'Wheat Bread',   kind:'sale',               qty:-4,  time:'1:05 PM', by:'Segun Ayoola' },
    { id:'sm5', item:'Sausage Roll',  kind:'waste',              qty:-14, time:'4:25 AM', by:'David Balogun' },
  ],


  salesBySalesperson: [
    { staff:'Tunde Bakare',  count:5, total:74500 },
    { staff:'Segun Ayoola',  count:8, total:38300 },
  ],

  /* -------------------------------------------------------- driver trip --- */
  /* ADR-001: the driver leaves the bakery with custody of loaded inventory,
     sells against it on the road, then returns and reconciles — not a
     delivery-courier model. `returned` stays null until the return step. */
  /* financial.audit.submit / financial.audit.confirm — segregation of duties:
     supervisor/cashier submit, manager/owner confirm. */
  dailyFinancialAudit: { status:'not_submitted', submittedAt:null, submittedBy:null, confirmedAt:null, confirmedBy:null },

  driverTrip: {
    status: 'in_transit', // created -> loading -> ready_to_depart -> in_transit -> returning -> reconciled -> completed
    loadedAt: '6:40 AM',
    departedAt: '6:55 AM',
    loadedBy: 'Ifeanyi Eze',
    verifiedBy: 'David Balogun',
    loaded: [ { p:'p9', qty:80 }, { p:'p11', qty:60 }, { p:'p7', qty:40 } ],
    returned: null,
    reconciledBy: null, // 'supervisor' | 'manager' | 'owner' — whoever settled it first
    correctionReason: null, // set when a completed trip is flagged and reopened
  },

  driverRoute: [
    { id:'r1', cust:'Grace Mart Ltd', phone:'0701 226 8890', area:'Ogba', address:'Shop 4, Allen Avenue Market, Ikeja', instructions:'Ask for the store manager on arrival.',
      items:'60 bread · 40 meat pie', amount:186000, status:'in_transit', recipient:null, failureReason:null,
      createdBy:'you', paid:'cod', method:null, amountPaid:0, driver:'u4' },
    { id:'r2', cust:'Chidi Nwankwo',  phone:'0806 118 4423', area:'Surulere', address:'27 Bode Thomas Street, Surulere', instructions:'Second gate on the left.',
      items:'15 doughnut · 9 rolls',  amount:18300,  status:'assigned',   recipient:null, failureReason:null,
      createdBy:'manager', managerName:'Amara Nwosu', paid:'partial', method:'Transfer', amountPaid:10000, driver:'u4' },
    { id:'r3', cust:'Royal Suites',   phone:'0812 447 9001', area:'V. Island', address:'5 Ozumba Mbadiwe Ave, Victoria Island', instructions:'Deliveries go through the service entrance.',
      items:'20 wheat · 60 doughnut', amount:112000, status:'delivered',  recipient:'Front desk — Adaeze', failureReason:null,
      createdBy:'you', paid:'paid', method:'Transfer', amountPaid:112000, driver:'u4' },
    { id:'r4', cust:'Fatima Bello',   phone:'0902 551 7734', area:'Maryland', address:'11 Ikorodu Road, Maryland', instructions:'',
      items:'2 celebration cake',     amount:32000,  status:'failed',     recipient:null, failureReason:'Customer not available at address',
      createdBy:'manager', managerName:'Amara Nwosu', paid:'cod', method:null, amountPaid:0 },
  ],

  reports: [
    { k:'Sales report',       s:'Revenue by day, staff and channel', icon:'sales',  tone:'' },
    { k:'Profit & Loss',      s:'This month · ₦1.88M net',           icon:'scale',  tone:'-ok', to:'pnl' },
    { k:'Expense report',     s:'Where the money went',              icon:'receipt',tone:'-warn' },
    { k:'Product performance',s:'Best and worst sellers',            icon:'box',    tone:'-accent', to:'report-products' },
    { k:'Customer sales',     s:'Who buys the most',                 icon:'users',  tone:'' },
    { k:'Branch performance', s:'Ikeja · Lekki · Yaba',              icon:'store',  tone:'', to:'report-branches' },
    { k:'Staff activity',     s:'Shifts, sales and orders',          icon:'history',tone:'', to:'staff' },
  ],

  activity: [
    { t:'2:34 PM', who:'Tunde',  init:'TB', tone:'c', what:'marked order BF-2048 as Ready',    kind:'ok' },
    { t:'1:34 PM', who:'Ifeanyi',init:'IE', tone:'d', what:'created ticket TK-313 (offline)',  kind:'pending' },
    { t:'1:05 PM', who:'Amara',  init:'AN', tone:'b', what:'recorded ₦120,000 part payment',   kind:'ok' },
    { t:'11:02 AM',who:'Amara',  init:'AN', tone:'b', what:'added expense ₦9,000 · Packaging', kind:'neutral' },
    { t:'9:30 AM', who:'Amara',  init:'AN', tone:'b', what:'added expense ₦15,000 · Utilities',kind:'neutral' },
    { t:'6:45 AM', who:'Amara',  init:'AN', tone:'b', what:'opened cash session · ₦100,000',   kind:'ok' },
  ],

  /* -------------------------------------------------------- audit log --- */
  /* Owner-only record of accountability-sensitive actions across roles —
     corrections, cancellations, and organization-level toggles. */
  auditLog: [
    { id:'al1', time:'10:15 AM', actor:'David Balogun', role:'Baker',   action:'Corrected production entry', detail:'Meat Pie · 150 → 165 loaves · "Recount after tray mix-up"', entity:'production' },
    { id:'al2', time:'9:40 AM',  actor:'Amara Nwosu',   role:'Manager', action:'Closed cash session with variance', detail:'₦2,500 short · "Till was ₦2,500 under at count"', entity:'cash' },
    { id:'al3', time:'Yesterday',actor:'Amara Nwosu',   role:'Manager', action:'Cancelled order', detail:'BF-2031 · Fatima Bello · "Customer changed their mind"', entity:'order' },
    { id:'al4', time:'Yesterday',actor:'Amara Nwosu',   role:'Manager', action:'Turned off Supervisor role', detail:'Existing assignments were not changed', entity:'org' },
  ],
};

/* ------------------------------------------------------------- helpers --- */
/* Cash-till helpers: a staff drawer's cash only reaches the branch till once
   it's handed over (drawer closed) \u2014 see `staffDrawers` and DB.cash's getters. */
function drawerSummaries() {
  return DB.staffDrawers.map(d => {
    if (d.staffId === 'u3') {
      const byMethod = m => DB.mySales.filter(s => s.method === m).reduce((s, x) => s + x.total, 0);
      return { ...d, open: DB.myCashSession.open, openingFloat: DB.myCashSession.openingFloat,
        openedAt: DB.myCashSession.openedAt, closedAt: DB.myCashSession.closedAt,
        cashSales: byMethod('Cash'), transferSales: byMethod('Transfer'), posSales: byMethod('POS'),
        cashExpenses: DB.myExpenses.reduce((s, x) => s + x.amount, 0) };
    }
    return d;
  });
}
function branchCashExpensesToday() {
  return DB.expenses.rows.filter(r => r.method === 'Cash' && r.time.startsWith('Today')).reduce((s, x) => s + x.amount, 0);
}
/** All of today's sales across every salesperson's drawer, open or closed \u2014 revenue that happened, regardless of whether the cash has reached the till yet. */
function branchSalesToday() {
  return drawerSummaries().reduce((s, d) => s + d.cashSales + d.transferSales + d.posSales, 0);
}
function branchSalesByMethod(method) {
  return drawerSummaries().reduce((s, d) => s + (method === 'Cash' ? d.cashSales : method === 'Transfer' ? d.transferSales : d.posSales), 0);
}
function branchSalesCount() {
  return DB.mySales.length + (DB.staffDrawers.some(d => d.staffId === 'u6') ? 1 : 0); // Segun's shift is one settled summary, not itemized here
}

/* ------------------------------------------------------------- helpers --- */
/* Record lookups. Each falls back to the first record rather than returning
   undefined: a subject screen opened without an id (a deep link, a stale back
   stack) then shows a real example instead of throwing mid-render and leaving
   a blank screen behind. A prototype should always have something to show. */
const P  = id => DB.products.find(p => p.id === id)  || DB.products[0];
const C  = id => DB.customers.find(c => c.id === id) || DB.customers[0];
const U  = id => Object.values(DB.users).find(u => u.id === id) ||
                 DB.staffList.find(s => s.id === id) || DB.users.owner;
const ORD = id => DB.orders.find(o => o.id === id) ||
                  DB.tickets.find(t => t.id === id) || DB.orders[0];

/** ₦1,284,500 */
function money(n, opt = {}) {
  const sign = n < 0 ? '−' : (opt.plus && n > 0 ? '+' : '');
  const v = Math.abs(Math.round(n));
  return `${sign}₦${v.toLocaleString('en-NG')}`;
}
/** ₦4.82M — for tight spaces */
function moneyShort(n) {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}₦${(a / 1e6).toFixed(2).replace(/\.00$/, '')}M`;
  if (a >= 1e3) return `${sign}₦${Math.round(a / 1e3)}k`;
  return `${sign}₦${a}`;
}
function pct(n) { return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`; }

function itemLine(items) {
  return items.map(i => `${i.q} × ${P(i.p).name}`).join(' · ');
}
function itemsTotal(items) {
  return items.reduce((s, i) => s + P(i.p).price * i.q, 0);
}

const STATUS = {
  pending:    { label:'Pending',    cls:'-pending', icon:'clock' },
  preparing:  { label:'Preparing',  cls:'-info',    icon:'flame' },
  ready:      { label:'Ready',      cls:'-live',    icon:'checkCircle' },
  delivering: { label:'On the way', cls:'-info',    icon:'truck' },
  completed:  { label:'Completed',  cls:'-ok',      icon:'check' },
  cancelled:  { label:'Cancelled',  cls:'-neutral', icon:'close' },
};
const PAYSTATE = {
  paid:    { label:'Paid',      cls:'-ok',      icon:'check' },
  partial: { label:'Part paid', cls:'-pending', icon:'alert' },
  unpaid:  { label:'Unpaid',    cls:'-bad',     icon:'clock' },
};
