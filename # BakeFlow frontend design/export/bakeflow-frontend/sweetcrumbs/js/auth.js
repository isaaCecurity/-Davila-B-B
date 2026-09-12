/* ==========================================================================
   auth.js — sign-in screen behaviour
   - replays the staged entrance every time the screen is pushed in
   - password visibility toggle with a little crossfade
   - gentle validation + success feedback (no real backend yet)
   ========================================================================== */
(function () {
  'use strict';

  var signin = document.getElementById('signin');
  var form = document.getElementById('si-form');
  var identity = document.getElementById('si-identity');
  var password = document.getElementById('si-password');
  var eyeBtn = document.getElementById('eye-btn');
  var submit = document.getElementById('si-submit');
  var submitLabel = document.getElementById('si-submit-label');
  var forgot = document.getElementById('si-forgot');
  var status = document.getElementById('si-status');
  var confirmation = document.getElementById('si-confirmation');
  var continueBtn = document.getElementById('si-continue');
  var google = document.getElementById('si-google');
  var phone = document.getElementById('phone');

  /* ------------------------------------- entrance replay on push / reset
     onboarding.js fires these custom events from push() / pop(). */
  window.addEventListener('sc:signin-show', function () {
    signin.classList.remove('is-entering');
    void signin.offsetWidth;               // force reflow so animations restart
    signin.classList.add('is-entering');
  });
  window.addEventListener('sc:signin-hide', function () {
    signin.classList.remove('is-entering');
    form.reset();
    clearInvalid();
    setPasswordVisible(false);
    hideConfirmation();
    hideReset();
    resetSubmit();
    status.textContent = '';
    forgot.textContent = 'Forgot password?';
  });

  /* -------------------------------------------------- password visibility */
  function setPasswordVisible(on) {
    password.type = on ? 'text' : 'password';
    eyeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    eyeBtn.setAttribute('aria-label', on ? 'Hide password' : 'Show password');
  }
  eyeBtn.addEventListener('click', function () {
    var on = password.type === 'password';
    setPasswordVisible(on);
    window.SC.buzz(6);
  });

  /* ------------------------------------------------------------ validation */
  function fieldOf(input) { return input.closest('.field'); }
  function markInvalid(input) {
    var f = fieldOf(input);
    f.classList.remove('is-invalid');
    void f.offsetWidth;
    f.classList.add('is-invalid');
    window.SC.buzz(18);
  }
  function clearInvalid() {
    form.querySelectorAll('.is-invalid').forEach(function (f) {
      f.classList.remove('is-invalid');
    });
  }
  [identity, password].forEach(function (input) {
    input.addEventListener('input', function () {
      fieldOf(input).classList.remove('is-invalid');
    });
  });

  /* --------------------------------------------------------------- submit */
  var busy = false;
  function resetSubmit() {
    busy = false;
    submit.disabled = false;
    submit.classList.remove('is-loading', 'is-success');
    submitLabel.textContent = 'Sign in';
  }

  function showConfirmation() {
    form.classList.add('is-complete');
    confirmation.classList.add('is-visible');
    confirmation.setAttribute('aria-hidden', 'false');
    window.setTimeout(function () { confirmation.focus(); }, 40);
  }

  function hideConfirmation() {
    form.classList.remove('is-complete');
    confirmation.classList.remove('is-visible');
    confirmation.setAttribute('aria-hidden', 'true');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;

    var ok = true;
    if (!identity.value.trim()) { markInvalid(identity); ok = false; }
    if (password.value.length < 1) { markInvalid(password); ok = false; }
    if (!ok) return;

    busy = true;
    submit.disabled = true;
    submit.classList.add('is-loading');
    submitLabel.textContent = 'Signing in…';
    window.SC.buzz(10);

    // no backend yet — simulate a round trip, then celebrate
    setTimeout(function () {
      submit.classList.add('is-success');
      submitLabel.textContent = 'Welcome back!';
      window.SC.buzz(24);
      var r = submit.getBoundingClientRect();
      window.SC.crumbBurst(r.left + r.width / 2, r.top + r.height / 2, 18, phone);
      setTimeout(function () {
        resetSubmit();
        showConfirmation();
      }, 620);
    }, 900);
  });
  /* ------------------------------------------------- reset password screen */
  var reset = document.getElementById('reset');
  var resetForm = document.getElementById('reset-form');
  var resetEmail = document.getElementById('reset-email');
  var resetSend = document.getElementById('reset-submit');
  var resetSendLabel = document.getElementById('reset-submit-label');
  var resetConfirmation = document.getElementById('reset-confirmation');
  var resetBackBtn = document.getElementById('reset-back-btn');
  var resetBackLink = document.getElementById('reset-back-link');
  var resetContinue = document.getElementById('reset-continue');

  function showReset() {
    window.SC.buzz(6);
    reset.classList.add('is-visible');
    reset.setAttribute('aria-hidden', 'false');
    if (identity.value.trim()) resetEmail.value = identity.value.trim();
    window.setTimeout(function () { resetEmail.focus(); }, 60);
  }

  function hideReset() {
    reset.classList.remove('is-visible');
    reset.setAttribute('aria-hidden', 'true');
    resetForm.reset();
    resetForm.classList.remove('is-complete');
    resetBackLink.classList.remove('is-complete');
    resetConfirmation.classList.remove('is-visible');
    resetConfirmation.setAttribute('aria-hidden', 'true');
    resetSend.classList.remove('is-loading', 'is-success');
    resetSend.disabled = false;
    resetSendLabel.textContent = 'Send reset link';
    resetBusy = false;
  }

  function showResetConfirmation() {
    resetForm.classList.add('is-complete');
    resetBackLink.classList.add('is-complete');
    resetConfirmation.classList.add('is-visible');
    resetConfirmation.setAttribute('aria-hidden', 'false');
    window.setTimeout(function () { resetConfirmation.focus(); }, 40);
  }

  var resetBusy = false;
  resetForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (resetBusy) return;
    if (!resetEmail.value.trim()) {
      markInvalid(resetEmail);
      resetEmail.focus();
      return;
    }
    resetBusy = true;
    resetSend.disabled = true;
    resetSend.classList.add('is-loading');
    resetSendLabel.textContent = 'Sending…';
    window.SC.buzz(10);

    window.setTimeout(function () {
      resetSend.classList.add('is-success');
      resetSendLabel.textContent = 'Sent!';
      window.SC.buzz(24);
      var r = resetSend.getBoundingClientRect();
      window.SC.crumbBurst(r.left + r.width / 2, r.top + r.height / 2, 14, phone);
      window.setTimeout(function () {
        resetBusy = false;
        resetSend.classList.remove('is-loading', 'is-success');
        resetSend.disabled = false;
        resetSendLabel.textContent = 'Send reset link';
        showResetConfirmation();
      }, 620);
    }, 900);
  });

  forgot.addEventListener('click', function (e) {
    e.preventDefault();
    showReset();
  });
  resetBackBtn.addEventListener('click', function () { hideReset(); identity.focus(); });
  resetBackLink.addEventListener('click', function () { hideReset(); identity.focus(); });
  resetContinue.addEventListener('click', function () {
    window.SC.buzz(8);
    hideReset();
    identity.focus();
  });

  /* ------------------------------------------------- secondary actions */
  continueBtn.addEventListener('click', function () {
    window.SC.buzz(8);
    continueBtn.classList.add('is-pressed');
    setTimeout(function () { continueBtn.classList.remove('is-pressed'); }, 260);
    try { window.parent.postMessage('bakeflow:signed-in', window.location.origin); } catch (e) {}
  });
  google.addEventListener('click', function () {
    window.SC.buzz(8);
    var r = google.getBoundingClientRect();
    window.SC.crumbBurst(r.left + r.width / 2, r.top + r.height / 2, 10, phone);
  });
})();
