/* ==========================================================================
   motion.js — small shared motion helpers
   ========================================================================== */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- ripple */
  function attachRipples(root) {
    (root || document).addEventListener('pointerdown', function (e) {
      var btn = e.target.closest ? e.target.closest('.btn') : null;
      if (!btn || btn.disabled || reduced) return;
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height) * 2.2;
      var span = document.createElement('span');
      span.className = 'ripple';
      span.style.width = span.style.height = size + 'px';
      span.style.left = (e.clientX - r.left) + 'px';
      span.style.top = (e.clientY - r.top) + 'px';
      btn.appendChild(span);
      setTimeout(function () { span.remove(); }, 640);
    });
  }

  /* ---------------------------------------------- press / release feedback
     Adds .is-pressed while a finger is down so the target can squash, then
     releases with a spring. This is what makes a tap feel physical. */
  function attachPress() {
    var current = null;
    function down(e) {
      var el = e.target.closest ? e.target.closest('[data-press]') : null;
      if (!el || el.disabled) return;
      current = el;
      el.classList.add('is-pressed');
    }
    function up() {
      if (!current) return;
      current.classList.remove('is-pressed');
      current = null;
    }
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    document.addEventListener('pointerleave', up);
  }

  /* ------------------------------------------------------- number counters */
  function countUp(el, duration) {
    var to = parseFloat(el.getAttribute('data-count-to'));
    var prefix = el.getAttribute('data-count-prefix') || '';
    var suffix = el.getAttribute('data-count-suffix') || '';
    var dur = duration || 1100;
    var start = null;

    if (reduced) { el.textContent = prefix + to + suffix; return; }

    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);           // easeOutCubic
      el.textContent = prefix + Math.round(to * eased).toLocaleString('en-US') + suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function runCounters(scope, delay) {
    var nodes = scope.querySelectorAll('[data-count-to]');
    Array.prototype.forEach.call(nodes, function (el) {
      el.textContent = (el.getAttribute('data-count-prefix') || '') + '0' +
        (el.getAttribute('data-count-suffix') || '');
      setTimeout(function () { countUp(el); }, delay || 0);
    });
  }

  /* ------------------------------------------- restart CSS keyframe entrance */
  function restart(el) {
    el.classList.remove('is-active');
    void el.offsetWidth;                            // force reflow
    el.classList.add('is-active');
  }

  /* ------------------------------------------------------------ rAF tween */
  function tween(opts) {
    var from = opts.from, to = opts.to, dur = opts.duration || 600;
    var ease = opts.easing || function (k) { return 1 - Math.pow(1 - k, 4); };
    var t0 = null, id = 0;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var k = dur <= 0 ? 1 : Math.min(1, (ts - t0) / dur);
      opts.onUpdate(from + (to - from) * ease(k));
      if (k < 1) id = requestAnimationFrame(frame);
      else if (opts.onDone) opts.onDone();
    }
    id = requestAnimationFrame(frame);
    return function cancel() { cancelAnimationFrame(id); };
  }

  /* ------------------------------------------------------------- haptics
     Only fires after a real user gesture — browsers block (and log) vibrate
     calls made before the page has been tapped. */
  var tapped = false;
  ['pointerdown', 'keydown'].forEach(function (evt) {
    document.addEventListener(evt, function () { tapped = true; }, { once: true, capture: true });
  });
  function buzz(ms) {
    if (!tapped || reduced || !navigator.vibrate) return;
    try { navigator.vibrate(ms || 8); } catch (e) {}
  }

  /* --------------------------------------------------------- crumb burst
     Sprays little bakery crumbs out of a point (x, y in viewport coords),
     each with its own arc, spin and size. Pure delight, no layout cost. */
  var CRUMB_COLORS = ['#e0762e', '#f0a35f', '#c9a27a', '#3b302a'];
  function crumbBurst(x, y, count, container) {
    if (reduced) return;
    var host = container || document.body;
    var hostRect = host.getBoundingClientRect();
    for (var i = 0; i < (count || 12); i++) {
      var c = document.createElement('span');
      c.className = 'crumb';
      var size = 4 + Math.random() * 7;
      var angle = Math.random() * Math.PI * 2;
      var dist = 46 + Math.random() * 78;
      c.style.width = c.style.height = size + 'px';
      c.style.background = CRUMB_COLORS[i % CRUMB_COLORS.length];
      c.style.left = (x - hostRect.left) + 'px';
      c.style.top = (y - hostRect.top) + 'px';
      c.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      c.style.setProperty('--dy', Math.sin(angle) * dist - 18 + 'px');
      c.style.setProperty('--rot', (Math.random() * 260 - 130) + 'deg');
      c.style.animationDelay = (Math.random() * 0.08) + 's';
      host.appendChild(c);
      (function (el) { setTimeout(function () { el.remove(); }, 1100); })(c);
    }
  }

  window.SC = {
    reduced: reduced,
    attachRipples: attachRipples,
    runCounters: runCounters,
    restart: restart,
    tween: tween,
    buzz: buzz,
    crumbBurst: crumbBurst
  };

  attachRipples(document);
  attachPress();
})();
