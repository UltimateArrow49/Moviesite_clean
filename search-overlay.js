/* search-overlay.js — Cineby-style search experience for theblackbox.
   Replaces the in-body floating search box with a search icon in the top nav
   that opens a centered modal overlay with live results-as-you-type, a media
   filter, a clear button, and rich result rows (thumb + title + type/year/rating/genres).
   Original implementation; layered on top of the compiled bundle. */
(function () {
  "use strict";
  if (window.__tbbSearchOverlay) return;
  window.__tbbSearchOverlay = true;

  var IMG = "https://image.tmdb.org/t/p/w154";
  var genres = {};
  var els = {};
  var timer = null, seq = 0, mode = "all", genreFilter = "";

  injectStyles();
  loadGenres();
  buildOverlay();                 // build the modal up front so it works even if the nav icon can't mount (e.g. mobile)
  window.tbbOpenSearch = open;    // public hook so the mobile bottom-bar (and anything else) can open search
  whenTopbar(mountTrigger);
  document.addEventListener("keydown", onGlobalKey, true);

  /* ---------------- styles ---------------- */
  function injectStyles() {
    var css = '' +
      /* hide the old in-body floating search box */
      '.page-toolbar{display:none !important}' +
      /* hide empty "Continue watching / Watched in the theater / Watch again" rails */
      '.continue--empty{display:none !important}' +

      /* nav search icon button */
      '.tbb-search-btn{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:999px;border:1px solid var(--tm-line,rgba(255,255,255,.08));background:var(--tm-glass,rgba(255,255,255,.05));color:var(--ink,#e4ebff);cursor:pointer;padding:0;transition:background .2s,border-color .2s,transform .18s}' +
      '.tbb-search-btn:hover{background:var(--tm-glass-hover,rgba(255,255,255,.09));border-color:rgba(var(--accent-rgb,20,255,159),.4);transform:translateY(-1px)}' +
      '.tbb-search-btn svg{width:18px;height:18px}' +

      /* overlay */
      '.tbb-so{position:fixed;inset:0;z-index:9999;display:none;justify-content:center;align-items:flex-start;padding:max(8vh,60px) 16px 16px}' +
      '.tbb-so.open{display:flex}' +
      '.tbb-so__scrim{position:absolute;inset:0;background:rgba(2,4,12,.72);backdrop-filter:blur(8px) saturate(140%);-webkit-backdrop-filter:blur(8px) saturate(140%)}' +
      '.tbb-so__panel{position:relative;z-index:1;width:min(720px,100%);background:linear-gradient(180deg,rgba(16,24,42,.98),rgba(9,14,28,.98));border:1px solid var(--tm-line,rgba(255,255,255,.08));border-radius:20px;box-shadow:0 40px 120px rgba(0,0,0,.6);overflow:hidden;animation:tbbSoIn .22s cubic-bezier(.2,.7,.3,1)}' +
      '@keyframes tbbSoIn{from{opacity:0;transform:translateY(-12px) scale(.98)}to{opacity:1;transform:none}}' +

      '.tbb-so__head{display:flex;align-items:center;gap:12px;padding:18px 20px 0}' +
      '.tbb-so__title{font-size:1.15rem;font-weight:800;letter-spacing:-.01em;margin:0;flex:0 0 auto}' +
      '.tbb-so__filter{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--tm-glass,rgba(255,255,255,.05));border:1px solid var(--tm-line,rgba(255,255,255,.08));color:var(--ink,#e4ebff);font-size:.82rem;font-weight:600;cursor:pointer;position:relative}' +
      '.tbb-so__filter:hover{background:var(--tm-glass-hover,rgba(255,255,255,.09))}' +
      '.tbb-so__filter svg{width:14px;height:14px;opacity:.7}' +
      '.tbb-so__genre{flex:0 0 auto;font:inherit;font-size:.82rem;font-weight:600;color:var(--ink,#e4ebff);background:var(--tm-glass,rgba(255,255,255,.05));border:1px solid var(--tm-line,rgba(255,255,255,.08));border-radius:999px;padding:7px 12px;cursor:pointer;-webkit-appearance:none;appearance:none;max-width:140px}' +
      '.tbb-so__genre option{background:#0b1324;color:#e4ebff}' +
      '.tbb-so__menu{position:absolute;top:calc(100% + 6px);right:0;min-width:160px;background:rgba(14,22,38,.99);border:1px solid var(--tm-line,rgba(255,255,255,.1));border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.55);padding:6px;display:none;z-index:3}' +
      '.tbb-so__menu.open{display:block}' +
      '.tbb-so__opt{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:8px;font-size:.86rem;color:var(--ink,#e4ebff);cursor:pointer}' +
      '.tbb-so__opt:hover{background:var(--tm-glass,rgba(255,255,255,.06))}' +
      '.tbb-so__opt[aria-selected="true"]{color:var(--accent,#14ff9f);font-weight:700}' +
      '.tbb-so__close{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:999px;border:1px solid var(--tm-line,rgba(255,255,255,.08));background:var(--tm-glass,rgba(255,255,255,.05));color:var(--ink,#e4ebff);cursor:pointer;padding:0}' +
      '.tbb-so__close:hover{background:var(--tm-glass-hover,rgba(255,255,255,.09))}' +
      '.tbb-so__close svg{width:16px;height:16px}' +

      '.tbb-so__field{position:relative;display:flex;align-items:center;margin:14px 20px 6px}' +
      '.tbb-so__field>svg.lead{position:absolute;left:16px;width:20px;height:20px;color:var(--muted,#94a3c7);pointer-events:none}' +
      '.tbb-so__input{width:100%;font:inherit;font-size:1.05rem;color:var(--ink,#e4ebff);padding:.85rem 2.8rem .85rem 3rem;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid var(--tm-line,rgba(255,255,255,.1));outline:none;transition:border-color .2s,box-shadow .2s,background .2s}' +
      '.tbb-so__input::placeholder{color:var(--muted,#94a3c7)}' +
      '.tbb-so__input::-webkit-search-cancel-button,.tbb-so__input::-webkit-search-decoration{-webkit-appearance:none;appearance:none;display:none}' +
      '.tbb-so__input:focus{background:rgba(255,255,255,.08);border-color:rgba(var(--accent-rgb,20,255,159),.55);box-shadow:0 0 0 4px rgba(var(--accent-rgb,20,255,159),.12)}' +
      '.tbb-so__clear{position:absolute;right:12px;display:none;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;border:none;background:rgba(255,255,255,.08);color:var(--muted,#94a3c7);cursor:pointer;padding:0}' +
      '.tbb-so__clear.show{display:inline-flex}' +
      '.tbb-so__clear:hover{background:rgba(255,255,255,.16);color:var(--ink,#e4ebff)}' +
      '.tbb-so__clear svg{width:13px;height:13px}' +

      '.tbb-so__results{max-height:min(56vh,520px);overflow-y:auto;padding:6px 10px 12px;scrollbar-width:thin}' +
      '.tbb-so__results::-webkit-scrollbar{width:8px}' +
      '.tbb-so__results::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:8px}' +
      '.tbb-so__row{display:flex;align-items:center;gap:14px;padding:9px 12px;border-radius:12px;text-decoration:none;color:var(--ink,#e4ebff);transition:background .15s}' +
      '.tbb-so__row:hover,.tbb-so__row.active{background:var(--tm-glass-hover,rgba(255,255,255,.08))}' +
      '.tbb-so__thumb{flex:0 0 auto;width:46px;height:69px;border-radius:8px;object-fit:cover;background:rgba(255,255,255,.05);border:1px solid var(--tm-line-soft,rgba(255,255,255,.05))}' +
      '.tbb-so__thumb-ph{display:flex;align-items:center;justify-content:center;font-size:.6rem;color:var(--muted,#94a3c7);text-align:center;padding:4px}' +
      '.tbb-so__info{min-width:0;flex:1}' +
      '.tbb-so__name{font-size:.98rem;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.tbb-so__meta{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:.78rem;color:var(--muted,#94a3c7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.tbb-so__sep{opacity:.45}' +
      '.tbb-so__type{color:var(--accent,#14ff9f);font-weight:700}' +
      '.tbb-so__rate{color:#ffd24a}' +
      '.tbb-so__hint,.tbb-so__status{padding:22px 26px;color:var(--muted,#94a3c7);font-size:.9rem;text-align:center}' +
      '@media(max-width:560px){.tbb-so__title{font-size:1rem}.tbb-so{padding-top:max(5vh,40px)}}';
    var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }

  /* ---------------- data ---------------- */
  function api(p) { return fetch("/api/tmdb/" + p, { cache: "no-store" }).then(function (r) { return r.json(); }); }
  function loadGenres() {
    Promise.all(["genre/movie/list", "genre/tv/list"].map(function (p) {
      return api(p).then(function (d) { (d.genres || []).forEach(function (g) { if (!genres[g.id]) genres[g.id] = g.name; }); }).catch(function () {});
    })).then(populateGenreSelect);
  }
  function populateGenreSelect() {
    if (!els.genre) return;
    var names = {};
    Object.keys(genres).forEach(function (id) { names[genres[id]] = id; }); // de-dupe by name (movie+tv share names)
    var sorted = Object.keys(names).sort();
    els.genre.innerHTML = '<option value="">All genres</option>' +
      sorted.map(function (n) { return '<option value="' + names[n] + '">' + n + "</option>"; }).join("");
    els.genre.value = genreFilter;
  }

  /* ---------------- nav trigger ---------------- */
  function whenTopbar(cb) {
    // Only target the actions cluster — never .topbar nav, because on mobile that
    // nav gets relocated to the bottom tab bar (the icon would ride along).
    var actions = document.querySelector(".topbar__actions");
    if (actions) return cb(actions);
    var obs = new MutationObserver(function () {
      var a = document.querySelector(".topbar__actions");
      if (a) { obs.disconnect(); cb(a); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 15000);
  }

  function mountTrigger(actions) {
    if (document.querySelector(".tbb-search-btn")) return;
    var btn = document.createElement("button");
    btn.className = "tbb-search-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Search");
    btn.title = "Search (/)";
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
    btn.addEventListener("click", open);
    // place the icon at the start of the actions cluster (left of "Sync")
    actions.insertBefore(btn, actions.firstChild);
    buildOverlay();
  }

  /* ---------------- overlay ---------------- */
  function buildOverlay() {
    if (els.root) return;
    var root = document.createElement("div");
    root.className = "tbb-so"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Search");
    root.innerHTML =
      '<div class="tbb-so__scrim" data-close></div>' +
      '<div class="tbb-so__panel">' +
        '<div class="tbb-so__head">' +
          '<h2 class="tbb-so__title">Search</h2>' +
          '<div class="tbb-so__filter" data-filter>' +
            '<span class="tbb-so__filter-label">Movies &amp; TV Shows</span>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
            '<div class="tbb-so__menu">' +
              '<div class="tbb-so__opt" data-mode="all" aria-selected="true">Movies &amp; TV Shows</div>' +
              '<div class="tbb-so__opt" data-mode="movie" aria-selected="false">Movies</div>' +
              '<div class="tbb-so__opt" data-mode="tv" aria-selected="false">TV Shows</div>' +
            '</div>' +
          '</div>' +
          '<select class="tbb-so__genre" aria-label="Filter by genre"><option value="">All genres</option></select>' +
          '<button class="tbb-so__close" data-close type="button" aria-label="Close">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="tbb-so__field">' +
          '<svg class="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input class="tbb-so__input" type="search" placeholder="Search movies & shows…" autocomplete="off" spellcheck="false" />' +
          '<button class="tbb-so__clear" type="button" aria-label="Clear"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<div class="tbb-so__results"><div class="tbb-so__hint">Start typing to search movies and shows.</div></div>' +
      '</div>';
    document.body.appendChild(root);

    els.root = root;
    els.input = root.querySelector(".tbb-so__input");
    els.clear = root.querySelector(".tbb-so__clear");
    els.results = root.querySelector(".tbb-so__results");
    els.filter = root.querySelector("[data-filter]");
    els.menu = root.querySelector(".tbb-so__menu");
    els.filterLabel = root.querySelector(".tbb-so__filter-label");
    els.genre = root.querySelector(".tbb-so__genre");
    populateGenreSelect();
    els.genre.addEventListener("change", function () { genreFilter = els.genre.value; run(els.input.value); els.input.focus(); });

    root.addEventListener("mousedown", function (e) { if (e.target.hasAttribute("data-close")) close(); });
    els.input.addEventListener("input", onInput);
    els.input.addEventListener("keydown", onInputKey);
    els.clear.addEventListener("click", function () { els.input.value = ""; els.clear.classList.remove("show"); run(""); els.input.focus(); });

    els.filter.addEventListener("click", function (e) {
      if (e.target.closest(".tbb-so__opt")) return;
      els.menu.classList.toggle("open");
    });
    root.querySelectorAll(".tbb-so__opt").forEach(function (opt) {
      opt.addEventListener("click", function () {
        mode = opt.getAttribute("data-mode");
        els.filterLabel.textContent = opt.textContent;
        root.querySelectorAll(".tbb-so__opt").forEach(function (o) { o.setAttribute("aria-selected", o === opt ? "true" : "false"); });
        els.menu.classList.remove("open");
        run(els.input.value);
        els.input.focus();
      });
    });
  }

  function open() {
    buildOverlay();
    els.root.classList.add("open");
    document.documentElement.style.overflow = "hidden";
    els.input.focus(); // focus synchronously so the first keystrokes are never dropped
    setTimeout(function () { els.input.focus(); els.input.select(); }, 30);
  }
  function close() {
    if (!els.root) return;
    els.root.classList.remove("open");
    els.menu && els.menu.classList.remove("open");
    document.documentElement.style.overflow = "";
  }
  function isOpen() { return els.root && els.root.classList.contains("open"); }

  function onGlobalKey(e) {
    if (e.key === "/" && !isOpen()) {
      var t = e.target, tag = (t && t.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      e.preventDefault(); open();
    } else if (e.key === "Escape" && isOpen()) {
      if (els.menu && els.menu.classList.contains("open")) { els.menu.classList.remove("open"); return; }
      close();
    }
  }

  function onInput() {
    var v = els.input.value;
    els.clear.classList.toggle("show", !!v);
    window.clearTimeout(timer);
    timer = window.setTimeout(function () { run(v); }, 240);
  }
  function onInputKey(e) {
    if (e.key === "Enter") {
      var first = els.results.querySelector(".tbb-so__row");
      if (first) { window.location.href = first.getAttribute("href"); }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); moveActive(e.key === "ArrowDown" ? 1 : -1);
    }
  }
  function moveActive(dir) {
    var rows = [].slice.call(els.results.querySelectorAll(".tbb-so__row"));
    if (!rows.length) return;
    var i = rows.findIndex(function (r) { return r.classList.contains("active"); });
    if (i >= 0) rows[i].classList.remove("active");
    i = (i + dir + rows.length) % rows.length;
    rows[i].classList.add("active");
    rows[i].scrollIntoView({ block: "nearest" });
  }

  /* ---------------- search ---------------- */
  function search(path, forceType, params) {
    return fetch("/api/tmdb/" + path + "?" + params + "&include_adult=false&page=1", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        return (d.results || []).map(function (m) {
          if (forceType) m.media_type = forceType;
          return m;
        }).filter(function (m) { return m.media_type === "movie" || m.media_type === "tv"; });
      })
      .catch(function () { return []; });
  }

  function run(query) {
    var my = ++seq;
    query = (query || "").trim();
    var g = genreFilter;
    if (!query && !g) { render(null, ""); return; }
    setHint("Searching…");
    var jobs;
    if (!query && g) {
      // No text, just a genre → browse popular titles in that genre (TMDB discover).
      var dp = "with_genres=" + g + "&sort_by=popularity.desc";
      jobs = mode === "movie" ? [search("discover/movie", "movie", dp)]
           : mode === "tv" ? [search("discover/tv", "tv", dp)]
           : [search("discover/movie", "movie", dp), search("discover/tv", "tv", dp)];
    } else {
      // For "All" we query movie + tv endpoints directly and merge (search/multi drops TV).
      var qp = "query=" + encodeURIComponent(query);
      jobs = mode === "movie" ? [search("search/movie", "movie", qp)]
           : mode === "tv" ? [search("search/tv", "tv", qp)]
           : [search("search/movie", "movie", qp), search("search/tv", "tv", qp)];
    }
    Promise.all(jobs).then(function (lists) {
      if (my !== seq) return;
      var seen = {}, items = [];
      lists.forEach(function (list) {
        list.forEach(function (m) {
          var key = m.media_type + ":" + m.id;
          if (seen[key]) return;
          seen[key] = 1; items.push(m);
        });
      });
      if (g) items = items.filter(function (m) { return (m.genre_ids || []).map(String).indexOf(String(g)) >= 0; });
      items.sort(function (a, b) { return (b.poster_path ? 1 : 0) - (a.poster_path ? 1 : 0) || (b.popularity || 0) - (a.popularity || 0); });
      render(items, query || "");
    });
  }

  function setHint(t) { els.results.innerHTML = '<div class="tbb-so__hint">' + t + "</div>"; }

  function render(items, query) {
    if (items === null) { setHint("Start typing to search movies and shows."); return; }
    if (!items.length) { setHint('No results for "' + escapeHtml(query) + '".'); return; }
    var frag = document.createDocumentFragment();
    items.slice(0, 30).forEach(function (it) { frag.appendChild(row(it)); });
    els.results.innerHTML = "";
    els.results.appendChild(frag);
    els.results.scrollTop = 0;
  }

  function row(item) {
    var isTv = item.media_type === "tv";
    var a = document.createElement("a");
    a.className = "tbb-so__row";
    a.href = "/detail.html?mode=" + (isTv ? "tv" : "movie") + "&tmdb=" + item.id;
    var thumb;
    if (item.poster_path) {
      thumb = document.createElement("img");
      thumb.className = "tbb-so__thumb"; thumb.loading = "lazy"; thumb.alt = "";
      thumb.src = IMG + item.poster_path;
    } else {
      thumb = document.createElement("div");
      thumb.className = "tbb-so__thumb tbb-so__thumb-ph";
      thumb.textContent = (item.title || item.name || "").slice(0, 18);
    }
    var info = document.createElement("div"); info.className = "tbb-so__info";
    var name = document.createElement("div"); name.className = "tbb-so__name";
    name.textContent = item.title || item.name || "Untitled";
    var meta = document.createElement("div"); meta.className = "tbb-so__meta";
    var parts = [];
    parts.push('<span class="tbb-so__type">' + (isTv ? "TV Show" : "Movie") + "</span>");
    var yr = (item.release_date || item.first_air_date || "").slice(0, 4);
    if (yr) parts.push("<span>" + yr + "</span>");
    if (item.vote_average) parts.push('<span class="tbb-so__rate">★ ' + item.vote_average.toFixed(1) + "</span>");
    var gn = (item.genre_ids || []).map(function (g) { return genres[g]; }).filter(Boolean).slice(0, 2);
    if (gn.length) parts.push("<span>" + gn.join(", ") + "</span>");
    meta.innerHTML = parts.join('<span class="tbb-so__sep">•</span>');
    info.appendChild(name); info.appendChild(meta);
    a.appendChild(thumb); a.appendChild(info);
    return a;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
})();
