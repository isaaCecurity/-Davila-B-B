/* ==========================================================================
   onboarding.js
   1. splash → onboarding as a shared-element hand-off (the logo flies into
      the header instead of the screen just cutting)
   2. parallax carousel: art and text move at different rates while dragging
   3. "Get started" performs a native-style push, draggable back from the edge
   ========================================================================== */
(function () {
  'use strict';


  /* =================================================== 1. SPLASH HAND-OFF */
  var WORD = 'BakeFlow';
  var wordmark = document.getElementById('wordmark');
  for (var i = 0; i < WORD.length; i++) {
    var ch = document.createElement('span');
    ch.textContent = WORD[i];
    ch.style.animationDelay = (0.74 + i * 0.045) + 's';
    wordmark.appendChild(ch);
  }

  var splash = document.getElementById('splash');
  var splashMark = document.getElementById('splash-mark');
  var brand = document.getElementById('ob-brand');
  var brandMark = document.getElementById('brand-mark');
  var onboarding = document.getElementById('onboarding');

  var SPLASH_MS = window.SC.reduced ? 200 : 2600;

  function handOff() {
    // Measure both logos and fly the big one onto the small one. Because the
    // onboarding screen is already laid out underneath, the target rect is real.
    var from = splashMark.getBoundingClientRect();
    var to = brandMark.getBoundingClientRect();

    splashMark.classList.remove('is-idle');   // stop the breathing loop first

    var scale = to.width / from.width;
    var dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    var dy = (to.top + to.height / 2) - (from.top + from.height / 2);

    // reveal the chrome (header/dots/CTA) now, but hold the slide's own
    // illustration entrance until the splash has actually cleared — firing
    // both at once made it look like the animation started twice
    onboarding.classList.add('is-ready');

    if (window.SC.reduced) {
      start(0);
      splash.remove();
      brand.classList.add('is-landed');
      return;
    }

    splashMark.style.transition =
      'transform .72s cubic-bezier(.62,-0.02,.28,1)';
    splashMark.style.transform =
      'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + scale + ')';

    // crumbs trail off the logo as it lifts into the header
    window.SC.crumbBurst(from.left + from.width / 2, from.top + from.height / 2, 14,
      document.getElementById('phone'));

    splash.classList.add('is-handing-off');

    // hand the visual over to the real header logo right as it arrives
    setTimeout(function () { brand.classList.add('is-landed'); }, 640);
    setTimeout(function () { splash.remove(); start(0); }, 820);
  }

  setTimeout(handOff, SPLASH_MS);

  /* ====================================================== 2. THE CAROUSEL */
  var track = document.getElementById('track');
  var pager = document.getElementById('pager');
  var slides = Array.prototype.slice.call(track.children);
  var dotsWrap = document.getElementById('dots');
  var ctaBtn = document.getElementById('cta-btn');
  var ctaLabel = document.getElementById('cta-label');
  var skipBtn = document.getElementById('skip-btn');

  var SLIDE_MS = 5500;
  var index = 0;
  var timer = null;
  var paused = false;

  // cache the parallax layers of every slide
  var layers = slides.map(function (sl) {
    return { art: sl.querySelector('.art'), copy: sl.querySelector('.copy') };
  });

  slides.forEach(function (_, n) {
    var d = document.createElement('button');
    d.type = 'button';
    d.className = 'dot';
    d.setAttribute('role', 'tab');
    d.setAttribute('aria-label', 'Slide ' + (n + 1));
    d.style.setProperty('--slide-dur', SLIDE_MS + 'ms');
    d.addEventListener('click', function () { window.SC.buzz(6); goTo(n, true); });
    dotsWrap.appendChild(d);
  });
  var dots = Array.prototype.slice.call(dotsWrap.children);

  /* ---- parallax: offset is the track position in "slides" (e.g. 1.35) ---- */
  function applyParallax(offset) {
    layers.forEach(function (l, n) {
      var d = n - offset;                 // -1 = left, 0 = centred, 1 = right
      var abs = Math.abs(d);
      if (abs > 1.15) {                   // off-screen, don't waste work
        l.art.style.transform = '';
        l.copy.style.transform = '';
        return;
      }
      // art drifts further, tilts and scales down as it leaves — depth cue
      l.art.style.transform =
        'translate3d(' + (d * 26) + '%,0,0) scale(' + (1 - abs * 0.12) + ')' +
        ' rotate(' + (d * -3.5) + 'deg)';
      l.art.style.opacity = String(1 - abs * 0.55);
      // text trails behind the art
      l.copy.style.transform = 'translate3d(' + (d * 12) + '%,0,0)';
      l.copy.style.opacity = String(1 - abs * 0.9);
    });
  }

  function clearParallax() {
    layers.forEach(function (l) {
      l.art.style.transform = '';
      l.art.style.opacity = '';
      l.copy.style.transform = '';
      l.copy.style.opacity = '';
    });
  }

  var settleCancel = null;

  function settleTo(target, fromOffset) {
    if (settleCancel) settleCancel();
    if (window.SC.reduced) {
      track.style.transform = 'translate3d(' + (-target * 100) + '%,0,0)';
      clearParallax();
      return;
    }
    settleCancel = window.SC.tween({
      from: fromOffset,
      to: target,
      duration: 620,
      easing: function (k) {                     // easeOutBack-ish settle
        var c = 1.24;
        return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
      },
      onUpdate: function (v) {
        track.style.transform = 'translate3d(' + (-v * 100) + '%,0,0)';
        applyParallax(v);
      },
      onDone: function () {
        track.style.transform = 'translate3d(' + (-target * 100) + '%,0,0)';
        clearParallax();
        retireOthers();
        settleCancel = null;
      }
    });
  }

  /* ---- activation ------------------------------------------------------
     A slide's illustration only animates while it has .is-active, so an
     incoming slide must be activated BEFORE it scrolls into view — otherwise
     you swipe onto an empty panel. `prepare` starts a neighbour's entrance as
     it slides in; `activate` restarts it only if it wasn't already prepared,
     so a prepared animation is never cut off half-way. */
  function prepare(n) {
    var sl = slides[n];
    if (!sl || sl.classList.contains('is-active')) return;
    sl.classList.add('is-swift');      // compressed stagger while travelling
    sl.classList.add('is-active');
    window.SC.runCounters(sl, 260);
  }

  function activate(n) {
    var sl = slides[n];
    if (!sl.classList.contains('is-active')) {
      sl.classList.remove('is-swift');
      window.SC.restart(sl);
      window.SC.runCounters(sl, 820);
    }
  }

  // Retire off-screen slides only once movement has stopped, so the outgoing
  // illustration doesn't vanish while it is still partly visible.
  function retireOthers() {
    slides.forEach(function (sl, n) {
      if (n !== index) sl.classList.remove('is-active', 'is-swift');
    });
    slides[index].classList.remove('is-swift');
  }

  function paintChrome() {
    slides.forEach(function (sl, n) {
      sl.setAttribute('aria-hidden', n === index ? 'false' : 'true');
    });
    activate(index);

    dots.forEach(function (d, n) {
      d.classList.toggle('is-active', n === index);
      d.setAttribute('aria-selected', n === index ? 'true' : 'false');
      if (n === index) {
        var fill = d.querySelector('i') || d.appendChild(document.createElement('i'));
        fill.style.animation = 'none';
        void fill.offsetWidth;
        fill.style.animation = '';
      }
    });

    var last = index === slides.length - 1;
    ctaLabel.textContent = last ? 'Get started' : 'Next';
    skipBtn.style.opacity = last ? '0' : '1';
    skipBtn.style.pointerEvents = last ? 'none' : 'auto';
  }

  function goTo(n, userDriven, fromOffset) {
    var prev = index;
    index = (n + slides.length) % slides.length;
    // start the destination's entrance as it travels in, not after it lands
    prepare(index);
    settleTo(index, typeof fromOffset === 'number' ? fromOffset : prev);
    paintChrome();
    schedule();
  }

  function schedule() {
    stop();
    if (window.SC.reduced) return;
    timer = setTimeout(function () { if (!paused) goTo(index + 1); }, SLIDE_MS);
  }
  function stop() { if (timer) { clearTimeout(timer); timer = null; } }

  function start(n) {
    index = n;
    track.style.transform = 'translate3d(' + (-n * 100) + '%,0,0)';
    retireOthers();
    paintChrome();
    schedule();
  }

  /* ------------------------------- swipe with live parallax + rubber band */
  var dragging = false, startX = 0, startY = 0, dx = 0, locked = null, w = 1;
  var lastX = 0, lastT = 0, vel = 0;

  pager.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true; locked = null; dx = 0; vel = 0;
    startX = lastX = e.clientX; startY = e.clientY;
    lastT = performance.now();
    w = pager.clientWidth || 1;
    paused = true; stop();
    if (settleCancel) { settleCancel(); settleCancel = null; }
    dots[index].classList.add('is-paused');
  });

  pager.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var mx = e.clientX - startX;
    var my = e.clientY - startY;
    if (locked === null) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    }
    if (locked !== 'x') return;

    var now = performance.now();
    if (now > lastT) vel = (e.clientX - lastX) / (now - lastT);
    lastX = e.clientX; lastT = now;

    dx = mx;
    var atEdge = (index === 0 && dx > 0) || (index === slides.length - 1 && dx < 0);
    var eff = atEdge ? dx * 0.34 : dx;
    var offset = index - eff / w;
    // wake the neighbour being dragged towards so it isn't blank on arrival
    prepare(dx < 0 ? index + 1 : index - 1);
    track.style.transform = 'translate3d(' + (-offset * 100) + '%,0,0)';
    applyParallax(offset);
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    paused = false;
    dots[index].classList.remove('is-paused');

    var offset = index - dx / w;
    var flick = Math.abs(vel) > 0.45;
    var threshold = Math.min(70, w * 0.2);

    if (locked === 'x' && (Math.abs(dx) > threshold || flick)) {
      var dir = (flick ? (vel < 0 ? 1 : -1) : (dx < 0 ? 1 : -1));
      var target = index + dir;
      if (target < 0 || target > slides.length - 1) {
        settleTo(index, offset);          // bounce back at the ends
        schedule();
      } else {
        window.SC.buzz(6);
        goTo(target, true, offset);
      }
    } else {
      settleTo(index, offset);
      schedule();
    }
    dx = 0; locked = null; vel = 0;
  }

  pager.addEventListener('pointerup', endDrag);
  pager.addEventListener('pointercancel', endDrag);
  pager.addEventListener('pointerleave', endDrag);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else schedule();
  });

  /* ============================================ 3. NATIVE-STYLE PUSH NAV */
  var stack = document.getElementById('stack');
  var nextScreen = document.getElementById('next-screen');
  var backBtn = document.getElementById('back-btn');
  var pushed = false;

  function push() {
    if (pushed) return;
    pushed = true;
    stop();
    window.SC.buzz(12);
    var phone = document.getElementById('phone');
    var ctaR = ctaBtn.getBoundingClientRect();

    // dough bloom: a warm circle grows out of the button, covers the phone,
    // then melts away to reveal the sign-in screen
    if (!window.SC.reduced) {
      var phR = phone.getBoundingClientRect();
      var cx = ctaR.left + ctaR.width / 2 - phR.left;
      var cy = ctaR.top + ctaR.height / 2 - phR.top;
      var radius = Math.max(
        Math.hypot(cx, cy), Math.hypot(phR.width - cx, cy),
        Math.hypot(cx, phR.height - cy), Math.hypot(phR.width - cx, phR.height - cy)
      );
      var bloom = document.createElement('div');
      bloom.className = 'dough-bloom';
      bloom.style.width = bloom.style.height = (radius * 2) + 'px';
      bloom.style.left = cx + 'px';
      bloom.style.top = cy + 'px';
      phone.appendChild(bloom);
      setTimeout(function () { bloom.remove(); }, 1150);
      // a few crumbs kick off the bloom
      window.SC.crumbBurst(ctaR.left + ctaR.width / 2, ctaR.top + ctaR.height / 2, 10, phone);
    }

    stack.classList.remove('is-tracking');
    stack.classList.add('stack--bloom');
    stack.classList.add('is-pushed');
    nextScreen.setAttribute('aria-hidden', 'false');
    // start the sign-in screen's staged entrance just as the dough clears
    setTimeout(function () {
      window.dispatchEvent(new CustomEvent('sc:signin-show'));
    }, window.SC.reduced ? 0 : 480);
    // move focus so keyboard/screen-reader users follow the push
    setTimeout(function () { backBtn.focus({ preventScroll: true }); }, 900);
  }

  function pop() {
    if (!pushed) return;
    pushed = false;
    window.SC.buzz(8);
    stack.classList.remove('is-tracking');
    stack.classList.remove('stack--bloom'); // back gesture keeps the classic slide
    stack.classList.remove('is-pushed');
    nextScreen.setAttribute('aria-hidden', 'true');
    window.dispatchEvent(new CustomEvent('sc:signin-hide'));
    schedule();
    setTimeout(function () { ctaBtn.focus({ preventScroll: true }); }, 500);
  }

  ctaBtn.addEventListener('click', function () {
    if (index === slides.length - 1) push();
    else { window.SC.buzz(6); goTo(index + 1, true); }
  });

  skipBtn.addEventListener('click', function () { push(); });
  backBtn.addEventListener('click', pop);

  document.addEventListener('keydown', function (e) {
    if (pushed) {
      if (e.key === 'Escape') pop();
      return;
    }
    if (e.key === 'ArrowRight') goTo(index + 1, true);
    if (e.key === 'ArrowLeft') goTo(index - 1, true);
  });

  /* -------- interactive edge-swipe back, tracking the finger 1:1 -------- */
  var backDrag = false, bStartX = 0, bStartY = 0, bLocked = null, bW = 1, bDx = 0;

  nextScreen.addEventListener('pointerdown', function (e) {
    if (!pushed || window.SC.reduced) return;
    // only from the left ~40px, like iOS
    var r = nextScreen.getBoundingClientRect();
    if (e.clientX - r.left > 40) return;
    backDrag = true; bLocked = null; bDx = 0;
    bStartX = e.clientX; bStartY = e.clientY;
    bW = r.width || 1;
    stack.classList.add('is-tracking');
  });

  nextScreen.addEventListener('pointermove', function (e) {
    if (!backDrag) return;
    var mx = e.clientX - bStartX;
    var my = e.clientY - bStartY;
    if (bLocked === null) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      bLocked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (bLocked !== 'x') { backDrag = false; stack.classList.remove('is-tracking'); return; }
    }
    bDx = Math.max(0, mx);
    var p = Math.min(1, bDx / bW);                 // 0 = pushed, 1 = popped
    nextScreen.style.transform = 'translate3d(' + (p * 100) + '%,0,0)';
    var ob = document.querySelector('.screen--onboarding');
    ob.style.transform = 'translate3d(' + (-24 + 24 * p) + '%,0,0) scale(' + (0.93 + 0.07 * p) + ')';
    ob.style.opacity = String(0.42 + 0.58 * p);
  });

  function endBackDrag() {
    if (!backDrag) return;
    backDrag = false;
    stack.classList.remove('is-tracking');
    var ob = document.querySelector('.screen--onboarding');
    // hand control back to the CSS transitions
    nextScreen.style.transform = '';
    ob.style.transform = '';
    ob.style.opacity = '';
    if (bDx / bW > 0.32) pop();
    bDx = 0; bLocked = null;
  }

  nextScreen.addEventListener('pointerup', endBackDrag);
  nextScreen.addEventListener('pointercancel', endBackDrag);
})();
