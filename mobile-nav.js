/* mobile-nav.js — turns the top section-nav into a bottom tab bar on phones.
   The bundle has almost no mobile layout, so on narrow screens the top bar
   (brand + 4 links + search + sync) is cramped. On mobile we relocate the
   nav (Movies/Shows/Theater/Live) to a fixed bottom tab bar, leaving a clean
   top bar of brand + search + sync — the styling lives in theme-modern.css
   (.tbb-bottomnav). Reparenting to <body> is required because .topbar has a
   backdrop-filter, which would otherwise trap position:fixed inside it.
   Skipped on the full-bleed player. */
(function () {
  "use strict";
  if (window.__tbbMobileNav) return;
  window.__tbbMobileNav = true;
  if (document.body && document.body.classList.contains("player-direct")) return;

  var mq = window.matchMedia("(max-width:768px)");
  var home = null, anchor = null;

  injectSearchStyle();
  function injectSearchStyle() {
    var css =
      ".tbb-bn-search{flex:1 1 0;display:flex;align-items:center;justify-content:center;padding:.5rem .25rem;border:1px solid transparent;border-radius:12px;background:transparent;color:var(--muted,#94a3c7);cursor:pointer}" +
      ".tbb-bn-search:hover,.tbb-bn-search:focus{color:var(--ink,#e4ebff)}" +
      ".tbb-bn-search svg{width:23px;height:23px}";
    var s = document.createElement("style"); s.id = "tbbMobileNavStyle"; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function openSearch() {
    if (typeof window.tbbOpenSearch === "function") return window.tbbOpenSearch();
    var nativeIcon = document.querySelector(".tbb-search-btn");
    if (nativeIcon) return nativeIcon.click();
    window.location.href = "/search.html";
  }
  function addSearchTab(nav) {
    if (nav.querySelector(".tbb-bn-search")) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "tbb-bn-search"; b.setAttribute("aria-label", "Search");
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
    b.addEventListener("click", openSearch);
    nav.appendChild(b);
  }
  function removeSearchTab(nav) {
    var b = nav.querySelector(".tbb-bn-search");
    if (b) b.remove();
  }

  function getNav() {
    return document.querySelector(".topbar > nav") || document.querySelector("body > nav.tbb-bottomnav");
  }
  function toBottom(nav) {
    if (nav.classList.contains("tbb-bottomnav") && nav.parentElement === document.body) return;
    var existing = document.querySelector("body > nav.tbb-bottomnav");
    if (existing && existing !== nav) existing.remove(); // guard against React re-renders
    home = nav.parentElement; anchor = nav.nextSibling;
    document.body.appendChild(nav);
    nav.classList.add("tbb-bottomnav");
    document.body.classList.add("tbb-has-bottomnav");
    addSearchTab(nav);
  }
  function toTop(nav) {
    if (!nav.classList.contains("tbb-bottomnav")) return;
    removeSearchTab(nav);
    nav.classList.remove("tbb-bottomnav");
    document.body.classList.remove("tbb-has-bottomnav");
    // Re-resolve the destination: React may have re-rendered the topbar since we
    // captured `home`, leaving it detached — inserting there would lose the nav.
    var target = home && home.isConnected ? home : document.querySelector(".topbar");
    if (!target) { nav.remove(); return; }
    if (anchor && anchor.parentElement === target) target.insertBefore(nav, anchor);
    else target.appendChild(nav);
  }
  function apply() {
    var nav = getNav();
    if (!nav) return;
    if (mq.matches) { toBottom(nav); return; }
    toTop(nav);
    // If React re-rendered its own nav in the topbar while we were in mobile
    // mode, getNav() returned that one and our old bottom bar is an orphan on
    // <body> — remove it so desktop never shows a stray bottom tab bar.
    var orphan = document.querySelector("body > nav.tbb-bottomnav");
    if (orphan) { orphan.remove(); document.body.classList.remove("tbb-has-bottomnav"); }
  }

  function start() {
    apply();
    var tb = document.querySelector(".topbar");
    if (tb) new MutationObserver(function () { setTimeout(apply, 0); }).observe(tb, { childList: true });
  }

  var tries = 0;
  (function waitForNav() {
    if (document.querySelector(".topbar > nav")) start();
    else if (tries++ < 60) setTimeout(waitForNav, 200);
  })();

  if (mq.addEventListener) mq.addEventListener("change", apply);
  else if (mq.addListener) mq.addListener(apply);
  window.addEventListener("resize", function () {
    clearTimeout(window.__tbbNavRz);
    window.__tbbNavRz = setTimeout(apply, 200);
  });
})();
