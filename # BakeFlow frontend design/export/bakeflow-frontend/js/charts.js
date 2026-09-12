/* ==========================================================================
   BAKEFLOW — Chart engine (hand-rolled SVG)
   Thin lines, soft fills, no gridline noise, touch tooltips.
   Every chart answers one question.
   ========================================================================== */

let _cid = 0;
const uid = p => `${p}${++_cid}`;

/** Catmull-Rom → cubic bezier: the "flow" curve used throughout BakeFlow. */
function flowPath(pts, tension = 0.42) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6 * tension * 2.2;
    const c1y = p1.y + (p2.y - p0.y) / 6 * tension * 2.2;
    const c2x = p2.x - (p3.x - p1.x) / 6 * tension * 2.2;
    const c2y = p2.y - (p3.y - p1.y) / 6 * tension * 2.2;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/**
 * Flowing area/line chart.
 * @param {object} o
 *  series: [{v}]  values
 *  labels: [str]
 *  ghost:  [{v}]  optional comparison series (dashed, muted)
 *  w,h, pad, stroke, fill, onDark, activeIndex, id
 */
function lineChart(o) {
  const w = o.w || 360, h = o.h || 132;
  const padX = o.padX ?? 20, padT = o.padT ?? 14, padB = o.padB ?? 10;
  const vals = o.series.map(s => s.v);
  const all = o.ghost ? vals.concat(o.ghost.map(s => s.v)) : vals;
  const max = Math.max(...all) * 1.1, min = Math.min(...all) * 0.72;
  const span = (max - min) || 1;
  const X = i => padX + (w - padX * 2) * (i / (o.series.length - 1));
  const Y = v => padT + (h - padT - padB) * (1 - (v - min) / span);

  const pts = o.series.map((s, i) => ({ x: X(i), y: Y(s.v), v: s.v, l: o.labels?.[i] }));
  const line = flowPath(pts);
  const area = `${line} L${pts[pts.length - 1].x},${h - padB + 6} L${pts[0].x},${h - padB + 6} Z`;

  const gid = uid('g'), cid = uid('c');
  const stroke = o.stroke || 'var(--apricot)';
  const fillTop = o.onDark ? 'rgba(229,138,91,.34)' : 'rgba(229,138,91,.22)';
  const fillBot = o.onDark ? 'rgba(229,138,91,0)' : 'rgba(229,138,91,0)';
  const ai = o.activeIndex ?? pts.length - 1;

  let ghost = '';
  if (o.ghost) {
    const gp = o.ghost.map((s, i) => ({ x: X(i), y: Y(s.v) }));
    ghost = `<path d="${flowPath(gp)}" fill="none"
      stroke="${o.onDark ? 'rgba(255,255,255,.22)' : 'var(--border)'}"
      stroke-width="1.8" stroke-dasharray="3 4" stroke-linecap="round"/>`;
  }

  const dots = pts.map((p, i) => i === ai
    ? `<g><circle cx="${p.x}" cy="${p.y}" r="7.5" fill="${stroke}" opacity=".2"/>
         <circle cx="${p.x}" cy="${p.y}" r="4" fill="${o.onDark ? '#241C17' : '#fff'}" stroke="${stroke}" stroke-width="2.4"/></g>`
    : '').join('');

  const hit = pts.map((p, i) =>
    `<rect class="ch-hit" data-i="${i}" data-v="${p.v}" data-l="${p.l || ''}" data-x="${p.x}"
       x="${p.x - (w / pts.length) / 2}" y="0" width="${w / pts.length}" height="${h}"
       fill="transparent" style="cursor:pointer"/>`).join('');

  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
      style="height:${h}px" role="img" aria-label="${o.aria || 'Trend chart'}">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${fillTop}"/><stop offset="100%" stop-color="${fillBot}"/>
      </linearGradient>
      <clipPath id="${cid}"><rect x="0" y="0" width="${w}" height="${h + 8}"/></clipPath>
    </defs>
    <g clip-path="url(#${cid})">
      <path d="${area}" fill="url(#${gid})"/>
      ${ghost}
      <path class="ch-line" d="${line}" fill="none" stroke="${stroke}" stroke-width="2.6"
        stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    ${dots}${hit}
  </svg>`;
}

/**
 * Bar chart — comparison across a small set of days/weeks.
 * series: [{v, d}], accent index highlighted.
 */
function barChart(o) {
  const w = o.w || 360, h = o.h || 128;
  const padX = o.padX ?? 16, padT = 12, padB = 6;
  const n = o.series.length;
  const gap = o.gap ?? 9;
  const bw = (w - padX * 2 - gap * (n - 1)) / n;
  const max = Math.max(...o.series.map(s => s.v)) * 1.08;
  const ai = o.activeIndex ?? -1;

  const bars = o.series.map((s, i) => {
    const bh = Math.max(4, (h - padT - padB) * (s.v / max));
    const x = padX + i * (bw + gap), y = h - padB - bh;
    const on = i === ai;
    const fill = on ? (o.accent || 'var(--apricot)') : (o.base || 'var(--cream-deep)');
    return `<g class="ch-hit" data-i="${i}" data-v="${s.v}" data-l="${s.d}" data-x="${x + bw / 2}" style="cursor:pointer">
      <rect x="${x}" y="${padT}" width="${bw}" height="${h - padT - padB}" fill="transparent"/>
      <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${Math.min(6, bw / 2.6)}" fill="${fill}">
        <animate attributeName="height" from="0" to="${bh}" dur="520ms" fill="freeze"
          calcMode="spline" keySplines=".22 1 .36 1" keyTimes="0;1"/>
        <animate attributeName="y" from="${h - padB}" to="${y}" dur="520ms" fill="freeze"
          calcMode="spline" keySplines=".22 1 .36 1" keyTimes="0;1"/>
      </rect>
    </g>`;
  }).join('');

  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
    style="height:${h}px" role="img" aria-label="${o.aria || 'Comparison chart'}">${bars}</svg>`;
}

/**
 * Paired bars: revenue vs expenses per period. Answers "is the gap widening?"
 */
function pairedBars(o) {
  const w = o.w || 360, h = o.h || 140, padX = 18, padT = 14, padB = 8;
  const n = o.series.length, group = (w - padX * 2) / n;
  const bw = Math.min(20, group * 0.3), inner = 5;
  const max = Math.max(...o.series.flatMap(s => [s.rev, s.exp])) * 1.1;
  const bars = o.series.map((s, i) => {
    const cx = padX + group * i + group / 2;
    const rh = (h - padT - padB) * (s.rev / max), eh = (h - padT - padB) * (s.exp / max);
    return `<g class="ch-hit" data-i="${i}" data-l="${s.d}" data-v="${s.rev}" data-v2="${s.exp}" data-x="${cx}" style="cursor:pointer">
      <rect x="${cx - group / 2}" y="0" width="${group}" height="${h}" fill="transparent"/>
      <rect x="${cx - bw - inner / 2}" y="${h - padB - rh}" width="${bw}" height="${rh}" rx="5" fill="var(--cocoa)">
        <animate attributeName="height" from="0" to="${rh}" dur="560ms" fill="freeze" calcMode="spline" keySplines=".22 1 .36 1" keyTimes="0;1"/>
        <animate attributeName="y" from="${h - padB}" to="${h - padB - rh}" dur="560ms" fill="freeze" calcMode="spline" keySplines=".22 1 .36 1" keyTimes="0;1"/>
      </rect>
      <rect x="${cx + inner / 2}" y="${h - padB - eh}" width="${bw}" height="${eh}" rx="5" fill="var(--apricot)" opacity=".85">
        <animate attributeName="height" from="0" to="${eh}" dur="560ms" begin="60ms" fill="freeze" calcMode="spline" keySplines=".22 1 .36 1" keyTimes="0;1"/>
        <animate attributeName="y" from="${h - padB}" to="${h - padB - eh}" dur="560ms" begin="60ms" fill="freeze" calcMode="spline" keySplines=".22 1 .36 1" keyTimes="0;1"/>
      </rect>
    </g>`;
  }).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px"
    role="img" aria-label="${o.aria || 'Revenue against expenses'}">${bars}</svg>`;
}

/**
 * Flow bar — the signature BakeFlow visual for "revenue → costs → profit".
 * A single horizontal band that splits into its parts.
 */
function flowBar(parts, opt = {}) {
  const total = parts.reduce((s, p) => s + p.v, 0);
  const segs = parts.map(p => {
    const w = (p.v / total * 100).toFixed(2);
    return `<i style="width:${w}%;background:${p.c}" title="${p.k}"></i>`;
  }).join('');
  const keys = parts.map(p =>
    `<span><i style="background:${p.c}"></i>${p.k} <b class="strong" style="margin-left:3px">${moneyShort(p.v)}</b></span>`
  ).join('');
  return `<div class="flowbar-wrap">
    <div class="flowbar">${segs}</div>
    <div class="flowbar-keys">${keys}</div>
  </div>`;
}

/**
 * Donut — used once, for expense composition only.
 */
function donut(parts, o = {}) {
  const size = o.size || 132, sw = o.sw || 15, r = (size - sw) / 2, c = size / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  const total = parts.reduce((s, p) => s + p.v, 0);
  const arcs = parts.map((p, i) => {
    const frac = p.v / total, len = circ * frac;
    const dash = `${Math.max(0, len - 2.5)} ${circ - Math.max(0, len - 2.5)}`;
    const off = -circ * acc;
    acc += frac;
    return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${p.c}" stroke-width="${sw}"
      stroke-dasharray="${dash}" stroke-dashoffset="${off}" stroke-linecap="round"
      transform="rotate(-90 ${c} ${c})">
      <animate attributeName="stroke-dasharray" from="0 ${circ}" to="${dash}" dur="${620 + i * 60}ms"
        fill="freeze" calcMode="spline" keySplines=".22 1 .36 1" keyTimes="0;1"/>
    </circle>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img"
    aria-label="${o.aria || 'Composition'}">${arcs}</svg>`;
}

/** Sparkline for compact rows. */
function spark(values, o = {}) {
  const w = o.w || 62, h = o.h || 22;
  const max = Math.max(...values), min = Math.min(...values), span = (max - min) || 1;
  const pts = values.map((v, i) => ({ x: (w / (values.length - 1)) * i, y: h - 2 - (h - 4) * ((v - min) / span) }));
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" aria-hidden="true">
    <path d="${flowPath(pts)}" stroke="${o.color || 'var(--apricot)'}" stroke-width="1.9"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* ------------------------------------------------- tooltip interaction --- */
/**
 * Wire a chart plot container for touch/hover tooltips.
 * @param {HTMLElement} plot  .cc-plot wrapper (position:relative)
 * @param {function} fmt      ({v,v2,l}) => html
 */
function wireChart(plot, fmt) {
  if (!plot) return;
  const svg = plot.querySelector('svg');
  if (!svg) return;
  let tip;
  const show = (g) => {
    const v = +g.dataset.v, v2 = g.dataset.v2 ? +g.dataset.v2 : null, l = g.dataset.l;
    const box = svg.getBoundingClientRect(), pbox = plot.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const px = (+g.dataset.x / vb.width) * box.width + (box.left - pbox.left);
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; plot.appendChild(tip); }
    tip.innerHTML = fmt({ v, v2, l });
    tip.style.left = `${Math.max(46, Math.min(pbox.width - 46, px))}px`;
    tip.style.top = `${Math.max(30, box.top - pbox.top + 26)}px`;
  };
  const hide = () => { if (tip) { tip.remove(); tip = null; } };

  plot.querySelectorAll('.ch-hit').forEach(g => {
    g.addEventListener('pointerenter', () => show(g));
    g.addEventListener('pointerdown', (e) => { e.preventDefault(); show(g); });
  });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('pointerup', () => setTimeout(hide, 1400));
}

/** X axis labels row. */
function xAxis(labels, activeIndex = -1) {
  return `<div class="chart-xaxis">${labels.map((l, i) =>
    `<span class="${i === activeIndex ? '-on' : ''}">${l}</span>`).join('')}</div>`;
}
