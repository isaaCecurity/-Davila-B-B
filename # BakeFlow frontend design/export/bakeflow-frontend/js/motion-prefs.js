/* ==========================================================================
   BAKEFLOW — motion-prefs.js
   Single source of truth for the OS-level "Reduce Motion" accessibility
   setting. Loaded before every other script so any module can ask at any
   time, regardless of load order.

   MOTION.reduced is a live getter — it re-reads the media query on every
   access, so a user toggling the OS setting mid-session is honoured without
   a reload. Use MOTION.onChange() only when something must actively re-render.
   ========================================================================== */
(function () {
  'use strict';

  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  var listeners = [];

  function broadcast(e) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](e.matches); } catch (err) { /* a bad listener must not stop the rest */ }
    }
  }

  if (mq.addEventListener) mq.addEventListener('change', broadcast);
  else if (mq.addListener) mq.addListener(broadcast); /* Safari < 14 */

  window.MOTION = {
    get reduced() { return mq.matches; },

    /** Subscribe to OS-level changes. Returns an unsubscribe function. */
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
      };
    }
  };
})();
