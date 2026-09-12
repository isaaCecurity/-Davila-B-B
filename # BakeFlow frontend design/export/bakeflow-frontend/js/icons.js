/* ==========================================================================
   BAKEFLOW — Iconography
   One family. Geometric, 1.65px stroke, 24px grid, round caps.
   ========================================================================== */

const ICON_PATHS = {
  /* navigation */
  home:      '<path d="M4 10.6 12 4.2l8 6.4V19a1.6 1.6 0 0 1-1.6 1.6h-3.2v-5.2a1.6 1.6 0 0 0-1.6-1.6h-3.2a1.6 1.6 0 0 0-1.6 1.6v5.2H5.6A1.6 1.6 0 0 1 4 19Z"/>',
  orders:    '<path d="M7 3.8h10a1.6 1.6 0 0 1 1.6 1.6v13.4a1.2 1.2 0 0 1-1.85 1.01L12 16.6l-4.75 3.21A1.2 1.2 0 0 1 5.4 18.8V5.4A1.6 1.6 0 0 1 7 3.8Z"/><path d="M9 8.6h6M9 12h3.5"/>',
  sales:     '<path d="M3.8 15.4 8.6 9.9l3.7 3.1 3.4-4.4 3.7 3.6"/><path d="M3.8 20.2h16.4"/><circle cx="18.6" cy="5.4" r="1.9"/>',
  finance:   '<path d="M12 3.6v16.8"/><path d="M16.4 7.2a3.2 3.2 0 0 0-3.2-2.2h-1.9a3.05 3.05 0 0 0-.4 6.07l2.9.4a3.15 3.15 0 0 1-.4 6.26h-2a3.2 3.2 0 0 1-3.2-2.2"/>',
  more:      '<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  grid:      '<rect x="3.8" y="3.8" width="7" height="7" rx="2.2"/><rect x="13.2" y="3.8" width="7" height="7" rx="2.2"/><rect x="3.8" y="13.2" width="7" height="7" rx="2.2"/><rect x="13.2" y="13.2" width="7" height="7" rx="2.2"/>',

  /* actions */
  plus:      '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  minus:     '<path d="M5.6 12h12.8"/>',
  check:     '<path d="M4.8 12.6 9.4 17.2 19.2 7"/>',
  checkCircle:'<circle cx="12" cy="12" r="8.4"/><path d="M8.4 12.2 11 14.8l4.6-5"/>',
  close:     '<path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8"/>',
  chevRight: '<path d="M9.4 5.6 15.8 12l-6.4 6.4"/>',
  chevLeft:  '<path d="M14.6 5.6 8.2 12l6.4 6.4"/>',
  chevDown:  '<path d="M5.6 9.4 12 15.8l6.4-6.4"/>',
  chevUp:    '<path d="M5.6 14.6 12 8.2l6.4 6.4"/>',
  arrowRight:'<path d="M4.4 12h15.2M13.6 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19.6 12H4.4M10.4 6l-6 6 6 6"/>',
  arrowUp:   '<path d="M12 19.4V4.6M5.8 10.8 12 4.6l6.2 6.2"/>',
  arrowDown: '<path d="M12 4.6v14.8M18.2 13.2 12 19.4l-6.2-6.2"/>',
  trendUp:   '<path d="M3.8 17.4 9.6 11l3.6 3.2 6.9-7.6"/><path d="M15.2 6.6h4.9v4.9"/>',
  trendDown: '<path d="M3.8 6.6 9.6 13l3.6-3.2 6.9 7.6"/><path d="M15.2 17.4h4.9v-4.9"/>',
  search:    '<circle cx="10.9" cy="10.9" r="6.6"/><path d="M15.8 15.8l4 4"/>',
  filter:    '<path d="M4.4 6.8h15.2M7.2 12h9.6M10 17.2h4"/>',
  sort:      '<path d="M7 4.8v14.4M7 19.2l-3-3M17 19.2V4.8M17 4.8l3 3"/>',
  refresh:   '<path d="M19.4 11a7.5 7.5 0 1 0-2.3 6.1"/><path d="M19.9 5.6v5.2h-5.2"/>',
  bell:      '<path d="M18 15.4V10.6a6 6 0 0 0-12 0v4.8l-1.4 2.2h14.8Z"/><path d="M10.2 20.2a2 2 0 0 0 3.6 0"/>',
  settings:  '<circle cx="12" cy="12" r="2.9"/><path d="M12 3.6v2.2M12 18.2v2.2M5.05 5.05l1.55 1.55M17.4 17.4l1.55 1.55M3.6 12h2.2M18.2 12h2.2M5.05 18.95 6.6 17.4M17.4 6.6l1.55-1.55"/>',
  logout:    '<path d="M14 6.4V4.8a1.6 1.6 0 0 0-1.6-1.6H5.8A1.6 1.6 0 0 0 4.2 4.8v14.4a1.6 1.6 0 0 0 1.6 1.6h6.6a1.6 1.6 0 0 0 1.6-1.6v-1.6"/><path d="M9.6 12h10.2M16.6 8.8l3.2 3.2-3.2 3.2"/>',
  eye:       '<path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="2.9"/>',
  eyeOff:    '<path d="M9.6 6.3A9.5 9.5 0 0 1 12 6c6 0 9.4 6 9.4 6a17 17 0 0 1-2.5 3.3M6.4 7.9A16.4 16.4 0 0 0 2.6 12s3.4 6 9.4 6a9.4 9.4 0 0 0 3.3-.55"/><path d="M4 4l16 16"/>',

  /* domain */
  user:      '<circle cx="12" cy="8.4" r="3.9"/><path d="M5 20.2a7.2 7.2 0 0 1 14 0"/>',
  users:     '<circle cx="9.4" cy="8.6" r="3.4"/><path d="M3.6 19.8a5.9 5.9 0 0 1 11.6 0"/><path d="M15.6 5.6a3.4 3.4 0 0 1 0 6.5M17.2 14.6a5.6 5.6 0 0 1 3.2 4.6"/>',
  store:     '<path d="M4.4 9.6V19a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6V9.6"/><path d="M3.2 9.6 5.4 4.4h13.2l2.2 5.2a3 3 0 0 1-5.4 1.6 3 3 0 0 1-5.4 0 3 3 0 0 1-5.4-1.6Z"/><path d="M9.6 20.6v-5.2h4.8v5.2"/>',
  bag:       '<path d="M5.4 7.8h13.2l1.1 11.1a1.6 1.6 0 0 1-1.6 1.7H5.9a1.6 1.6 0 0 1-1.6-1.7Z"/><path d="M8.8 10.6V7.2a3.2 3.2 0 0 1 6.4 0v3.4"/>',
  box:       '<path d="M20.2 8.2 12 3.8 3.8 8.2v7.6L12 20.2l8.2-4.4Z"/><path d="M3.8 8.2 12 12.6l8.2-4.4M12 12.6v7.6"/>',
  ticket:    '<path d="M4 8.6V6.4a1.6 1.6 0 0 1 1.6-1.6h12.8A1.6 1.6 0 0 1 20 6.4v2.2a3.4 3.4 0 0 0 0 6.8v2.2a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 17.6v-2.2a3.4 3.4 0 0 0 0-6.8Z"/><path d="M13.6 9.4v5.2"/>',
  receipt:   '<path d="M6 3.8h12v16.4l-3-1.8-3 1.8-3-1.8-3 1.8Z"/><path d="M9 8.4h6M9 12.2h6"/>',
  cash:      '<rect x="2.8" y="6.6" width="18.4" height="10.8" rx="2.4"/><circle cx="12" cy="12" r="2.5"/><path d="M6.2 12h.5M17.3 12h.5"/>',
  card:      '<rect x="2.8" y="5.6" width="18.4" height="12.8" rx="2.6"/><path d="M2.8 10h18.4"/><path d="M6.4 14.4h3.2"/>',
  bank:      '<path d="M3.6 9.8 12 4.4l8.4 5.4"/><path d="M5.6 9.8v9.4M18.4 9.8v9.4M10.4 9.8v9.4M13.6 9.8v9.4"/><path d="M3.2 20.2h17.6"/>',
  wallet:    '<rect x="3.4" y="6" width="17.2" height="13" rx="2.6"/><path d="M3.4 10.4h11a2.4 2.4 0 0 1 0 4.8h-11"/>',
  chart:     '<path d="M4.4 20.2V13M9.6 20.2V6.4M14.8 20.2v-9.6M20 20.2V9"/>',
  pie:       '<path d="M12 3.6a8.4 8.4 0 1 1-8.4 8.4"/><path d="M12 3.6v8.4h8.4A8.4 8.4 0 0 0 12 3.6Z"/>',
  doc:       '<path d="M6.4 3.8h7.2l4.4 4.4v12a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6V5.4a1.6 1.6 0 0 1 1.6-1.6Z"/><path d="M13.2 3.9V8.4h4.6"/><path d="M8.2 13h7M8.2 16.6h4.6"/>',
  clock:     '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.2 2"/>',
  calendar:  '<rect x="3.8" y="5.4" width="16.4" height="14.8" rx="2.4"/><path d="M3.8 10h16.4M8.4 3.6v3.4M15.6 3.6v3.4"/>',
  pin:       '<path d="M12 21c4-4.4 6.2-7.6 6.2-10.4A6.2 6.2 0 0 0 5.8 10.6C5.8 13.4 8 16.6 12 21Z"/><circle cx="12" cy="10.4" r="2.4"/>',
  truck:     '<path d="M2.8 6.6h9.6v10H2.8Z"/><path d="M12.4 10h4l3 3.2v3.4h-7Z"/><circle cx="6.4" cy="18.6" r="1.9"/><circle cx="16.6" cy="18.6" r="1.9"/>',
  spark:     '<path d="M12 3.4l1.8 5.1 5.1 1.8-5.1 1.8L12 17.2l-1.8-5.1-5.1-1.8 5.1-1.8Z"/><path d="M18.6 16.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7Z"/>',
  flame:     '<path d="M12 20.4c3.2 0 5.4-2.1 5.4-5 0-4-4-5.6-3.2-11.4-3 1.2-5.4 4.4-5.4 7.2 0 1 .3 1.9.8 2.6-1.6.1-2.5 1.2-2.5 2.6 0 2.2 2 4 4.9 4Z"/>',
  layers:    '<path d="M12 3.8 3.8 8.2 12 12.6l8.2-4.4Z"/><path d="M3.8 12.6 12 17l8.2-4.4"/><path d="M3.8 16.6 12 21l8.2-4.4"/>',
  wifiOff:   '<path d="M3.4 8.6a15 15 0 0 1 5-2.9M20.6 8.6a14.7 14.7 0 0 0-5.9-3.1"/><path d="M6.8 12.4a10 10 0 0 1 2.6-1.6M17.2 12.4a9.8 9.8 0 0 0-2.4-1.5"/><path d="M9.8 15.8a5.4 5.4 0 0 1 4.4 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none"/><path d="M3.6 3.6l16.8 16.8"/>',
  cloudSync: '<path d="M7.4 18.4a4.2 4.2 0 0 1-.4-8.37 5.4 5.4 0 0 1 10.3-1.2A3.9 3.9 0 0 1 17.8 18.4"/><path d="M9.8 14.2a2.4 2.4 0 0 1 4-1.1l.8.8M14.6 16.6a2.4 2.4 0 0 1-4 1.1l-.8-.8"/>',
  alert:     '<path d="M12 4.6 21 20H3Z"/><path d="M12 10.4v3.8"/><circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none"/>',
  info:      '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.2"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>',
  lock:      '<rect x="5.2" y="10.4" width="13.6" height="9.8" rx="2.4"/><path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6"/>',
  mail:      '<rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2.4"/><path d="M3.8 7.4 12 13l8.2-5.6"/>',
  phone:     '<path d="M7.4 3.8h9.2a1.8 1.8 0 0 1 1.8 1.8v12.8a1.8 1.8 0 0 1-1.8 1.8H7.4a1.8 1.8 0 0 1-1.8-1.8V5.6a1.8 1.8 0 0 1 1.8-1.8Z"/><path d="M10.6 17.2h2.8"/>',
  edit:      '<path d="M4.6 19.4h4l10.2-10.2a2.2 2.2 0 0 0-3.1-3.1L5.5 16.3Z"/><path d="M13.8 7.2l3 3"/>',
  trash:     '<path d="M4.8 7.2h14.4M9.4 7.2V5.4a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.8"/><path d="M6.6 7.2 7.6 19a1.6 1.6 0 0 0 1.6 1.5h5.6A1.6 1.6 0 0 0 16.4 19l1-11.8"/>',
  camera:    '<path d="M4.6 8.6h2.8L8.8 6h6.4l1.4 2.6h2.8a1.6 1.6 0 0 1 1.6 1.6v8a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 18.2v-8a1.6 1.6 0 0 1 1.6-1.6Z"/><circle cx="12" cy="13.8" r="3.1"/>',
  tag:       '<path d="M12.6 3.8h6a1.6 1.6 0 0 1 1.6 1.6v6a1.6 1.6 0 0 1-.47 1.13l-7.4 7.4a1.6 1.6 0 0 1-2.26 0l-6.53-6.53a1.6 1.6 0 0 1 0-2.26l7.4-7.4a1.6 1.6 0 0 1 1.13-.47Z"/><circle cx="16.2" cy="7.8" r="1.3"/>',
  drop:      '<path d="M12 3.6c3.4 4 5.4 6.8 5.4 9.4A5.4 5.4 0 0 1 6.6 13c0-2.6 2-5.4 5.4-9.4Z"/>',
  bolt:      '<path d="M13.4 3.6 6.2 13.6h4.6l-.6 6.8 7.6-10.2h-4.9Z"/>',
  shield:    '<path d="M12 3.8 5.4 6.2v5.4c0 4 2.7 7.4 6.6 8.6 3.9-1.2 6.6-4.6 6.6-8.6V6.2Z"/><path d="M9.2 12.2 11.4 14.4l3.6-4"/>',
  target:    '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/>',
  scale:     '<path d="M12 4.4v15.2"/><path d="M7.4 6.4h9.2"/><path d="M4.4 13.6 7.4 6.8 10.4 13.6a3 3 0 0 1-6 0Z"/><path d="M13.6 13.6 16.6 6.8 19.6 13.6a3 3 0 0 1-6 0Z"/><path d="M8.6 19.6h6.8"/>',
  swap:      '<path d="M4.6 8.6h13.2M14.6 5.4l3.2 3.2-3.2 3.2"/><path d="M19.4 15.4H6.2M9.4 12.2 6.2 15.4l3.2 3.2"/>',
  history:   '<path d="M4.6 12a7.6 7.6 0 1 0 2.3-5.4L4.2 9"/><path d="M3.8 4.6v4.6h4.6"/><path d="M12 8.6V12l2.8 1.8"/>',
  download:  '<path d="M12 4.4v10.4M8 11.2l4 4 4-4"/><path d="M4.8 19.6h14.4"/>',
  share:     '<path d="M12 3.8v10.6M8.4 7.2 12 3.6l3.6 3.6"/><path d="M5.4 13.4v5.2a1.6 1.6 0 0 0 1.6 1.6h10a1.6 1.6 0 0 0 1.6-1.6v-5.2"/>',
  play:      '<path d="M8.4 5.6 18 12l-9.6 6.4Z"/>',
  pause:     '<path d="M9.2 5.6v12.8M14.8 5.6v12.8"/>',
  bread:     '<path d="M4.4 11.4a3.6 3.6 0 0 1 3.6-3.6h8a3.6 3.6 0 0 1 0 7.2H8a3.6 3.6 0 0 1-3.6-3.6Z"/><path d="M8.8 8v6.8M12.4 8v6.8"/>',
};

/**
 * Render an icon as an inline SVG string.
 * @param {string} name  key of ICON_PATHS
 * @param {number} size  px
 * @param {object} opt   { cls, stroke }
 */
function icon(name, size = 20, opt = {}) {
  const d = ICON_PATHS[name];
  if (!d) return '';
  const cls = opt.cls ? ` class="${opt.cls}"` : '';
  const sw = opt.stroke || 1.65;
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">${d}</svg>`;
}

/* --------------------------------------------------------------------------
   BRAND ASSETS
   The supplied BakeFlow artwork (images/bakeflow-logo.png) is a presentation
   sheet holding several lockups. Rather than redraw it, we crop the exact
   regions we need with background-size / background-position.

   Regions (in the 1536 × 1269 source):
     MARK   — icon only, cream panel      x  95  y 130  w 245  h 245
     LOCK   — icon + "BakeFlow"           x   0  y1024  w 855  h 245
     TAG    — lockup + tagline            x  95  y 130  w 855  h 245
     TILE   — dark rounded app icon       x1193  y 352  w 100  h 105

   The cream-panel crops are composited with mix-blend-mode: multiply, so the
   artwork's own cream background drops away on cream and white surfaces.
   The TILE crop already carries its own dark ground, so it never blends.
   LOCK is a synthesized region: the TAG art re-pasted with its tagline row
   painted over in the sheet's cream, so the icon+wordmark lockup has no
   separate source art of its own.
   -------------------------------------------------------------------------- */
const LOGO_SRC = 'images/bakeflow-logo.png';
const LOGO_SHEET = { w: 1536, h: 1269 };
const LOGO_REGION = {
  mark: { x: 95, y: 130, w: 245, h: 245 },
  lock: { x: 0, y: 1024, w: 855, h: 245 },
  tag:  { x: 95, y: 130, w: 855, h: 245 },
  tile: { x: 1193, y: 352, w: 100, h: 105 },
};

/**
 * Crop one region of the brand sheet to a given rendered width.
 * @param {'mark'|'lock'|'tag'|'tile'} region
 * @param {number} width   rendered CSS width in px
 * @param {object} opt     { blend, cls, label, style }
 */
function logoCrop(region, width, opt = {}) {
  const r = LOGO_REGION[region];
  const k = width / r.w;                       // scale factor
  const h = +(r.h * k).toFixed(2);
  const bw = +(LOGO_SHEET.w * k).toFixed(2);
  const bh = +(LOGO_SHEET.h * k).toFixed(2);
  const bx = +(-r.x * k).toFixed(2);
  const by = +(-r.y * k).toFixed(2);
  /* TILE carries its own dark ground; the white-panel crops multiply. */
  const blend = opt.blend ?? (region === 'tile' ? 'normal' : 'multiply');
  const label = opt.label ?? 'BakeFlow';
  /* .-tile opts out of the brightness lift: it carries its own dark ground. */
  const tone = region === 'tile' ? '-tile' : '';
  return `<span class="logo-crop ${tone} ${opt.cls || ''}" role="img" aria-label="${label}"
    style="width:${width}px;height:${h}px;
      background-image:url(${LOGO_SRC});
      background-size:${bw}px ${bh}px;
      background-position:${bx}px ${by}px;
      mix-blend-mode:${blend};${opt.style || ''}"></span>`;
}

/**
 * Square brand mark.
 * @param {number} size
 * @param {'ink'|'light'} tone  'ink' = dark rounded app tile (for dark/photo
 *                              grounds and the launch screen), 'light' = the
 *                              bare icon for cream and white surfaces.
 */
function brandMark(size = 34, tone = 'ink') {
  return tone === 'ink'
    ? logoCrop('tile', size, { label: 'BakeFlow' })
    : logoCrop('mark', size, { label: 'BakeFlow' });
}

/** Horizontal lockup: icon + "BakeFlow". `size` is the icon height. */
function wordmark(size = 30) {
  /* In the artwork the lockup is 855 wide for a 245-tall icon block. */
  return logoCrop('lock', Math.round(size * (855 / 245)), { label: 'BakeFlow' });
}

/** Full lockup with the tagline. `width` is the rendered width. */
function wordmarkTagline(width = 260) {
  return logoCrop('tag', width, {
    label: 'BakeFlow — Bake better. Manage easier. Grow together.',
  });
}

/* Flow motif used in empty states / loaders: three drifting strokes. */
function flowMotif(w = 132, h = 56, opacity = 1) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 132 56" fill="none" aria-hidden="true" style="opacity:${opacity}">
    <path class="fm-l" d="M6 44c14 0 21-9 33-9s18 9 32 9c10 0 17-4 23-12"
      stroke="var(--border)" stroke-width="4" stroke-linecap="round"/>
    <path class="fm-l" d="M6 30c14 0 21-11 33-11s18 11 32 11c10 0 17-5 23-13"
      stroke="#DED6C9" stroke-width="4" stroke-linecap="round"/>
    <path class="fm-l" d="M6 16c14 0 21-12 33-12s18 12 32 12c10 0 17-5 23-13"
      stroke="var(--apricot)" stroke-width="4" stroke-linecap="round" opacity=".55"/>
  </svg>`;
}
