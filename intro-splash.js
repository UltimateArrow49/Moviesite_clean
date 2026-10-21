/* intro-splash.js — animated brand splash shown when the site is first opened.
   Self-contained (no build step): injects a full-screen overlay with the
   theblackbox logo (glowing box + equalizer bars), the wordmark and tagline,
   plays a short reveal, then fades out and removes itself. Plays ONCE per
   browser session (sessionStorage) so it shows on open but not on every
   internal navigation. Skippable on click; honors prefers-reduced-motion.
   Mounted in <head> on the landing page so it covers the bundle load. */
(function () {
  "use strict";
  if (window.__tbbSplash) return;
  window.__tbbSplash = true;

  // Once per session: opening the site shows it; navigating around does not.
  try {
    if (sessionStorage.getItem("tbb:splash") === "1") return;
    sessionStorage.setItem("tbb:splash", "1");
  } catch (e) { /* private mode — just play it */ }

  var reduce = false;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var css =
    /* Lock the root dark from the very first paint so the home page can never
       flash behind/before the overlay mounts. Removed when the splash leaves. */
    'html.tbb-splash-lock{background:#050a08 !important}' +
    'html.tbb-splash-lock body{visibility:hidden}' +
    '.tbb-splash{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;' +
      'visibility:visible;' +
      'background:radial-gradient(120% 120% at 50% 38%,#0a1410 0%,#060b09 55%,#03060500 100%),#040807;' +
      'opacity:1;will-change:opacity,transform;-webkit-font-smoothing:antialiased}' +
    '.tbb-splash.is-out{opacity:0;transform:scale(1.045);transition:opacity .55s ease,transform .55s ease;pointer-events:none}' +
    '.tbb-splash__stage{display:flex;flex-direction:column;align-items:center;gap:26px;padding:24px;' +
      'transform:translateY(-2%)}' +
    '.tbb-splash__glow{position:absolute;width:min(70vw,560px);height:min(70vw,560px);border-radius:50%;' +
      'background:radial-gradient(circle,rgba(20,255,159,.20) 0%,rgba(20,255,159,0) 68%);' +
      'filter:blur(6px);animation:tbbHalo 1.8s ease-in-out infinite}' +
    '.tbb-splash__icon{position:relative;width:clamp(96px,18vw,140px);height:clamp(96px,18vw,140px);' +
      'animation:tbbBoxIn .72s cubic-bezier(.2,.8,.2,1) both}' +
    '.tbb-splash__icon svg{width:100%;height:100%;display:block;animation:tbbGlow 1.8s ease-in-out infinite}' +
    '.tbb-splash .bars .bar{transform-box:fill-box;transform-origin:50% 100%;' +
      'animation:tbbEq .8s ease-in-out infinite alternate}' +
    '.tbb-splash .bars .bar:nth-child(1){animation-duration:.62s;animation-delay:-.20s}' +
    '.tbb-splash .bars .bar:nth-child(2){animation-duration:.84s;animation-delay:-.52s}' +
    '.tbb-splash .bars .bar:nth-child(3){animation-duration:.50s;animation-delay:-.10s}' +
    '.tbb-splash .bars .bar:nth-child(4){animation-duration:.74s;animation-delay:-.36s}' +
    '.tbb-splash .bars .bar:nth-child(5){animation-duration:.66s;animation-delay:-.16s}' +
    '.tbb-splash__word{font:800 clamp(2.1rem,7vw,3.4rem)/1 "Inter","Segoe UI",system-ui,sans-serif;' +
      'letter-spacing:-.02em;' +
      'background:linear-gradient(90deg,#f7fff9 0%,#8efed9 52%,#12ffb0 100%);' +
      '-webkit-background-clip:text;background-clip:text;color:transparent;' +
      'animation:tbbWordIn .8s cubic-bezier(.2,.8,.2,1) .42s both}' +
    '.tbb-splash__tag{font:600 clamp(.6rem,1.5vw,.78rem)/1 "Inter","Segoe UI",system-ui,sans-serif;' +
      'text-transform:uppercase;color:#bff4e2;opacity:.62;margin-top:-12px;' +
      'animation:tbbTagIn .9s ease .82s both}' +
    '@keyframes tbbBoxIn{0%{opacity:0;transform:scale(.82)}100%{opacity:1;transform:scale(1)}}' +
    '@keyframes tbbGlow{0%,100%{filter:drop-shadow(0 0 9px rgba(20,255,159,.42))}50%{filter:drop-shadow(0 0 26px rgba(20,255,159,.85))}}' +
    '@keyframes tbbHalo{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1.04)}}' +
    '@keyframes tbbEq{from{transform:scaleY(.26)}to{transform:scaleY(1)}}' +
    '@keyframes tbbWordIn{0%{opacity:0;transform:translateY(12px);clip-path:inset(0 100% 0 0)}' +
      '100%{opacity:1;transform:none;clip-path:inset(0 0 0 0)}}' +
    '@keyframes tbbTagIn{0%{opacity:0;letter-spacing:.10em}100%{opacity:.62;letter-spacing:.42em}}' +
    '@media (prefers-reduced-motion: reduce){' +
      '.tbb-splash__glow,.tbb-splash__icon svg,.tbb-splash .bars .bar{animation:none}' +
      '.tbb-splash__icon{animation:tbbBoxIn .4s ease both}' +
      '.tbb-splash__word{animation:tbbWordIn .4s ease .1s both;clip-path:none}' +
      '.tbb-splash__tag{animation:tbbTagIn .4s ease .2s both}}';

  var style = document.createElement("style");
  style.id = "tbbSplashStyle";
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  // Hide the page immediately (this runs as a render-blocking <head> script,
  // before <body> parses) so the home never flashes before/under the splash.
  document.documentElement.classList.add("tbb-splash-lock");

  // 5 equalizer bars (full-height rects, scaled via scaleY) inside a glowing box.
  var bars = "";
  var xs = [20, 33, 46, 59, 72];
  for (var i = 0; i < xs.length; i++) {
    bars += '<rect class="bar" x="' + xs[i] + '" y="26" width="8" height="48" rx="3" fill="#19ffae"/>';
  }
  var icon =
    '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<rect class="box" x="8" y="8" width="84" height="84" rx="22" fill="#070d0a" ' +
        'stroke="#14ff9f" stroke-opacity=".75" stroke-width="3"/>' +
      '<g class="bars">' + bars + '</g>' +
    '</svg>';

  var overlay = document.createElement("div");
  overlay.className = "tbb-splash";
  overlay.setAttribute("role", "presentation");
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML =
    '<div class="tbb-splash__glow"></div>' +
    '<div class="tbb-splash__stage">' +
      '<div class="tbb-splash__icon">' + icon + '</div>' +
      '<div class="tbb-splash__word">theblackbox</div>' +
      '<div class="tbb-splash__tag">Shadow Signal</div>' +
    '</div>';

  // Mount NOW, synchronously, onto <html> (which always exists here) so the
  // overlay is present before the first paint — no DOMContentLoaded wait.
  document.documentElement.appendChild(overlay);

  var done = false;
  function dismiss() {
    if (done) return;
    done = true;
    // Reveal the (already-rendered) home page FIRST, then fade the overlay out
    // on top of it — so the splash crossfades into the home instead of hard-cutting.
    document.documentElement.classList.remove("tbb-splash-lock");
    overlay.classList.add("is-out");
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (style.parentNode) style.parentNode.removeChild(style);
    }, 620);
  }

  overlay.addEventListener("click", dismiss);            // tap/click to skip
  setTimeout(dismiss, reduce ? 1100 : 2500);             // auto-dismiss after the reveal
})();
