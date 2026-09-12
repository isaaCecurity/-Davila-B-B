/* ==========================================================================
   BAKEFLOW — Studio chrome
   The presentation layer *around* the prototype: the companion panel wordmark,
   the simulated iOS status-bar glyphs, and the "open as <role>" switcher.
   Nothing in here is part of the product itself — on a real device the phone
   frame and this panel simply do not exist (see the ≤560px breakpoint).
   ========================================================================== */

/* --------------------------------------------------- companion wordmark --- */
(function mountStudioWordmark() {
  const host = document.getElementById('studio-wordmark');
  if (host) host.innerHTML = wordmark(26);
})();

/* ------------------------------------------------------ status-bar glyphs --- */
/* Signal · Wi-Fi · battery, drawn to match the icon family's weight. */
(function mountStatusGlyphs() {
  const host = document.getElementById('sb-right');
  if (!host) return;
  host.innerHTML = `
    <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden="true">
      <rect x="0"  y="7.5" width="3" height="3.5" rx="1"></rect>
      <rect x="4.6" y="5.4" width="3" height="5.6" rx="1"></rect>
      <rect x="9.2" y="3"   width="3" height="8"   rx="1"></rect>
      <rect x="13.8" y="0.4" width="3" height="10.6" rx="1"></rect>
    </svg>
    <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="currentColor"
         stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <path d="M1 3.6a9.4 9.4 0 0 1 13 0"></path>
      <path d="M3.6 6.2a5.9 5.9 0 0 1 7.8 0"></path>
      <path d="M6.1 8.7a2.5 2.5 0 0 1 2.8 0"></path>
    </svg>
    <svg width="25" height="12" viewBox="0 0 25 12" fill="none" aria-hidden="true">
      <rect x="0.6" y="0.6" width="20" height="10.8" rx="3" stroke="currentColor"
            stroke-opacity=".38" stroke-width="1.1"></rect>
      <rect x="2.2" y="2.2" width="14.4" height="7.6" rx="1.9" fill="currentColor"></rect>
      <path d="M22.4 4.2v3.6a2 2 0 0 0 0-3.6z" fill="currentColor" fill-opacity=".38"></path>
    </svg>`;
})();

/* ----------------------------------------------------------- role switch --- */
/* Switching role does not hide buttons — it rebuilds the whole information
   hierarchy: a different tab set (ROLE_TABS) and a different home screen. */
(function mountRoleSwitch() {
  const host = document.getElementById('studio-roles');
  if (!host) return;

  const buttons = Array.from(host.querySelectorAll('[data-studio-role]'));

  const paint = () => buttons.forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.studioRole === APP.role)));

  buttons.forEach(btn => btn.addEventListener('click', () => {
    const role = btn.dataset.studioRole;
    if (role === APP.role && APP.stack.at(-1)?.name === 'home') return;

    APP.role = role;
    APP.tab = ROLE_TABS[role][0];
    APP.draft = null;
    paint();

    const u = DB.users[role];
    nav('home', {}, 'fade');
    toast({
      title: `Signed in as ${u.name}`,
      text: `${u.title} · ${APP.org.name}`,
      kind: 'info',
    });
  }));

  /* Keep the panel truthful when the role changes from inside the prototype
     (login screen role cards, sign-out, etc.) without patching the router. */
  const screens = document.getElementById('screens');
  if (screens && 'MutationObserver' in window) {
    new MutationObserver(paint).observe(screens, { childList: true });
  }
  paint();
})();
