/* home-hero.js — auto-cycling "Featured today" hero pinned to the top of the
   movies AND shows pages. Original component. Single atomic render() + 2-layer
   crossfade so backdrop, text and dots can never desync. Page-aware: uses
   trending movies on the movies page and trending TV on the shows page. */
(function () {
  "use strict";
  if (window.__tbbHeroInit) return;
  window.__tbbHeroInit = true;

  var IMG = "https://image.tmdb.org/t/p/";
  var ROTATE_MS = 7000;
  var IS_TV = document.body.classList.contains("page-series");
  var DETAIL_MODE = IS_TV ? "tv" : "movie";
  var TREND_PATH = IS_TV ? "trending/tv/week?page=1" : "trending/movie/week?page=1";
  var GENRE_PATH = IS_TV ? "genre/tv/list" : "genre/movie/list";
  var slides = [], genres = {};

  injectStyles();
  loadGenres().then(boot);

  function injectStyles() {
    var css = '' +
      '.feature-hero{display:none !important}' +
      '#tbbHero{position:relative;width:100%;height:clamp(420px,64vh,640px);border-radius:22px;overflow:hidden;margin:0 0 26px;isolation:isolate;background:#05060f}' +
      '#tbbHero .th-bg{position:absolute;inset:0;opacity:0;transition:opacity .8s ease;background-size:cover;background-position:center 16%}' +
      '#tbbHero .th-bg.on{opacity:1}' +
      '#tbbHero .th-scrim{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(5,6,15,.15) 0%,rgba(5,6,15,.55) 55%,rgba(5,6,15,.96) 100%),linear-gradient(90deg,rgba(5,6,15,.9) 0%,rgba(5,6,15,.45) 45%,rgba(5,6,15,0) 80%)}' +
      '#tbbHero .th-body{position:absolute;z-index:2;left:clamp(22px,4vw,56px);right:clamp(22px,4vw,56px);bottom:clamp(26px,5vh,52px);max-width:680px}' +
      '#tbbHero .th-kicker{display:inline-flex;align-items:center;gap:8px;font-size:.74rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:12px}' +
      '#tbbHero .th-kicker::before{content:"";width:18px;height:2px;border-radius:2px;background:var(--accent)}' +
      '#tbbHero .th-title{font-size:clamp(2rem,4.6vw,3.6rem);font-weight:800;letter-spacing:-.02em;line-height:1.02;margin:0 0 12px;text-shadow:0 4px 30px rgba(0,0,0,.5)}' +
      '#tbbHero .th-meta{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-bottom:14px}' +
      '#tbbHero .th-chip{padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:600;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12)}' +
      '#tbbHero .th-chip.rate{color:#ffd24a;border-color:rgba(255,210,74,.3)}' +
      '#tbbHero .th-overview{color:rgba(228,235,255,.86);line-height:1.55;font-size:clamp(.9rem,1.05vw,1.02rem);margin:0 0 20px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}' +
      '#tbbHero .th-actions{display:flex;gap:12px;flex-wrap:wrap}' +
      '#tbbHero .th-play{display:inline-flex;align-items:center;gap:9px;padding:.78rem 1.6rem;border-radius:999px;background:linear-gradient(135deg,var(--accent),var(--accent-strong));color:#04150e;font-weight:700;text-decoration:none;box-shadow:0 12px 30px rgba(var(--accent-rgb),.4);transition:transform .18s,filter .2s}' +
      '#tbbHero .th-play:hover{transform:translateY(-2px);filter:brightness(1.05)}' +
      '#tbbHero .th-info{display:inline-flex;align-items:center;gap:8px;padding:.78rem 1.3rem;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.16);color:var(--ink);font-weight:600;text-decoration:none;backdrop-filter:blur(10px);transition:background .2s,transform .18s}' +
      '#tbbHero .th-info:hover{background:rgba(255,255,255,.2);transform:translateY(-2px)}' +
      '#tbbHero .th-dots{position:absolute;z-index:3;right:clamp(22px,4vw,56px);bottom:clamp(26px,5vh,52px);display:flex;gap:8px}' +
      '#tbbHero .th-dot{width:9px;height:9px;border-radius:999px;border:none;cursor:pointer;background:rgba(255,255,255,.3);transition:width .25s,background .25s;padding:0}' +
      '#tbbHero .th-dot.on{width:26px;background:var(--accent)}' +
      '@media(max-width:720px){#tbbHero .th-dots{display:none}}';
    var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }

  function api(p) { return fetch("/api/tmdb/" + p, { cache: "no-store" }).then(function (r) { return r.json(); }); }
  function loadGenres() { return api(GENRE_PATH).then(function (d) { (d.genres || []).forEach(function (g) { genres[g.id] = g.name; }); }).catch(function () {}); }
  function boot() {
    api(TREND_PATH).then(function (d) {
      slides = (d.results || []).filter(function (m) { return m.backdrop_path && m.overview; }).slice(0, 7);
      if (slides.length) waitForContent(mount);
    }).catch(function () {});
  }
  function waitForContent(cb) {
    var t = 0;
    (function c() {
      var el = document.querySelector(".content") || document.querySelector("main");
      if (el) return cb(el);
      if (++t > 60) return;
      setTimeout(c, 150);
    })();
  }
  function chip(text, cls) { var s = document.createElement("span"); s.className = "th-chip" + (cls ? " " + cls : ""); s.textContent = text; return s; }

  function mount(content) {
    if (window.__tbbHeroMounted || document.getElementById("tbbHero")) return;
    window.__tbbHeroMounted = true;

    var hero = document.createElement("section");
    hero.id = "tbbHero"; hero.setAttribute("aria-label", "Featured today");
    var bgA = document.createElement("div"); bgA.className = "th-bg";
    var bgB = document.createElement("div"); bgB.className = "th-bg";
    var scrim = document.createElement("div"); scrim.className = "th-scrim";
    hero.appendChild(bgA); hero.appendChild(bgB); hero.appendChild(scrim);

    var body = document.createElement("div"); body.className = "th-body";
    var kicker = document.createElement("p"); kicker.className = "th-kicker"; kicker.textContent = "Featured today";
    var title = document.createElement("h2"); title.className = "th-title";
    var meta = document.createElement("div"); meta.className = "th-meta";
    var ov = document.createElement("p"); ov.className = "th-overview";
    var actions = document.createElement("div"); actions.className = "th-actions";
    var play = document.createElement("a"); play.className = "th-play";
    play.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5z"/></svg>Play';
    var info = document.createElement("a"); info.className = "th-info";
    info.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>More info';
    actions.appendChild(play); actions.appendChild(info);
    body.appendChild(kicker); body.appendChild(title); body.appendChild(meta); body.appendChild(ov); body.appendChild(actions);
    hero.appendChild(body);

    var dots = document.createElement("div"); dots.className = "th-dots";
    slides.forEach(function (m, k) {
      var b = document.createElement("button"); b.className = "th-dot";
      b.setAttribute("aria-label", "Slide " + (k + 1));
      b.addEventListener("click", function () { render(k); restart(); });
      dots.appendChild(b);
    });
    hero.appendChild(dots);
    content.insertBefore(hero, content.firstChild);

    var i = 0, front = bgA, back = bgB;

    function render(n) {
      i = ((n % slides.length) + slides.length) % slides.length;
      var m = slides[i];
      var href = "/detail.html?mode=" + DETAIL_MODE + "&tmdb=" + m.id;
      // backdrop crossfade (atomic: paint the back layer, then swap)
      back.style.backgroundImage = "url('" + IMG + "w1280" + m.backdrop_path + "')";
      back.classList.add("on"); front.classList.remove("on");
      var tmp = front; front = back; back = tmp;
      // text
      title.textContent = m.title || m.name || "";
      play.href = href; info.href = href;
      meta.innerHTML = "";
      var yr = (m.release_date || m.first_air_date || "").slice(0, 4);
      if (yr) meta.appendChild(chip(yr));
      if (m.vote_average) meta.appendChild(chip("★ " + m.vote_average.toFixed(1), "rate"));
      (m.genre_ids || []).slice(0, 3).forEach(function (g) { if (genres[g]) meta.appendChild(chip(genres[g])); });
      ov.textContent = m.overview || "";
      // dots
      [].forEach.call(dots.children, function (el, k) { el.classList.toggle("on", k === i); });
      window.__tbbRC = (window.__tbbRC || 0) + 1;
      hero.setAttribute("data-i", i);
      hero.setAttribute("data-rc", window.__tbbRC);
    }
    function start() { stop(); if (slides.length > 1) window.__tbbHeroTimer = setInterval(function () { render(i + 1); }, ROTATE_MS); }
    function stop() { if (window.__tbbHeroTimer) { clearInterval(window.__tbbHeroTimer); window.__tbbHeroTimer = null; } }
    function restart() { start(); }

    [body, dots].forEach(function (el) {
      el.addEventListener("mouseenter", stop);
      el.addEventListener("mouseleave", start);
    });
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });

    render(0);
    start();
  }
})();
