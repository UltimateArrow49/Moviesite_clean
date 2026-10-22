/* player-fullscreen.js — immersive full-bleed player for theblackbox.
   Since titles already have a detail/overview screen before playback, the
   player page drops all marketing/info text and lets the video fill the whole
   page. Icon-only floating controls (back + skip-episode) replace the text UI;
   skip-episode is wired to the bundle's now-hidden #nextEpisodeButton.
   Scoped to body.player-direct so theater mode is untouched. */
(function () {
  "use strict";
  if (window.__tbbPlayerFs) return;
  window.__tbbPlayerFs = true;

  // Declared up here (not mid-file) because the provider-embed path runs
  // synchronously when document.body already exists — if these were `var`s
  // further down, mountProvider would read them before assignment (undefined)
  // and the fullscreen button would render the literal text "undefined".
  var FS_ICON_ENTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  var FS_ICON_EXIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 1-2 2v3"/></svg>';
  // Same reason: mountProvider can run before mid-file `var`s are assigned, so
  // the next-episode state lives up here where nothing can reset it afterwards.
  var _nextEpisode = null, _skipBtn = null;

  injectStyles();

  var PROVIDERS = window.tbbSources.providers;
  var _params = new URLSearchParams(location.search);
  var _prov = _params.get("provider");
  // Theater (watch-together) rooms run the bundle's own sync player — never
  // hijack those; they are identified by the roomId the lobby hands over.
  var _isTheater = !!(_params.get("roomId") || _params.get("invite"));
  if (!_isTheater && _prov !== "vidking") _prov = window.tbbSources.selected(_prov);
  if (_prov && PROVIDERS[_prov] && !_isTheater) {
    whenBody(function () { mountProvider(_prov); });
    return;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else { boot(); }

  function whenBody(cb) {
    if (document.body) cb();
    else document.addEventListener("DOMContentLoaded", cb, { once: true });
  }

  function mountProvider(key) {
    var cfg = PROVIDERS[key]; if (!cfg) return;
    var tmdb = _params.get("tmdb"), mode = _params.get("mode"),
        s = _params.get("season") || 1, e = _params.get("episode") || 1;
    var src;
    if (key === "videasy" && !cfg.external && window.tbbVideasy) {
      // videasy-bridge owns the videasy URL: it adds the resume position and
      // the episode features (next-episode button / autoplay next / selector),
      // then listens for the player's progress messages so continue watching,
      // the detail-page episode bars and /api/sync keep working.
      src = window.tbbVideasy.buildUrl({
        mode: mode, tmdb: tmdb, season: s, episode: e,
        color: _params.get("color") || "14ff9f",
        progress: Number(_params.get("progress")) || 0
      });
      window.tbbVideasy.start({
        mode: mode, tmdb: tmdb, season: s, episode: e,
        title: _params.get("showTitle") || _params.get("title") || "",
        poster: _params.get("poster") || "", backdrop: _params.get("backdrop") || "",
        runtime: Number(_params.get("runtime")) || 0,
        onEpisodeChange: function (season, episode) {
          // The videasy player moved on by itself — keep our own skip control
          // pointing at the episode AFTER the one now playing.
          refreshNextEpisode(tmdb, season, episode);
        }
      });
    } else {
      src = window.tbbSources.buildUrl(key, mode, tmdb, s, e);
    }
    if (!src) {
      location.replace("/movies.html");
      return;
    }
    // player.html no longer loads the bundle for provider embeds (it used to
    // wipe the continue-watching entry from behind us), so the page title is
    // ours to set. Kept blankBundleEmbed for anyone still on a cached page.
    var pageTitle = _params.get("title") || _params.get("showTitle");
    if (pageTitle) document.title = pageTitle + " · theblackbox";
    blankBundleEmbed();
    var st = document.createElement("style");
    st.textContent = "#app-root{display:none !important}.tbb-vs{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;border:0;background:#000;z-index:1}";
    document.head.appendChild(st);
    var f = null;
    if (cfg.external) {
      var panel = document.createElement("section");
      panel.className = "tbb-external-player";
      var heading = document.createElement("h1");
      var name = cfg.label.split(" · ")[0];
      heading.textContent = "Watch with " + name;
      var description = document.createElement("p");
      description.textContent = "This player opens in a separate tab. Your movie or episode selection is preserved.";
      var open = document.createElement("a");
      open.className = "tbb-external-open";
      open.textContent = "Open " + name;
      open.href = src;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      var fallback = document.createElement("a");
      var fallbackUrl = new URL(location.href);
      fallbackUrl.searchParams.set("provider", "cinesrc");
      fallback.href = fallbackUrl.pathname + fallbackUrl.search;
      fallback.className = "tbb-external-fallback";
      fallback.textContent = "Watch here with CineSrc";
      var note = document.createElement("p");
      note.className = "tbb-external-note";
      note.textContent = "If the provider does not load, return here and choose another source. Progress in the external player is not synced to this site.";
      panel.appendChild(heading);
      panel.appendChild(description);
      panel.appendChild(open);
      panel.appendChild(fallback);
      panel.appendChild(note);
      document.body.appendChild(panel);
    } else {
    f = document.createElement("iframe");
    f.className = "tbb-vs";
    f.src = src;
    f.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
    f.setAttribute("allowfullscreen", "true");
    if (!cfg.proxied && cfg.sandbox !== false) {
      // Direct (un-proxied) SPA embeds: a popup-blocking sandbox (no
      // allow-popups / allow-top-navigation) kills the popunder ads while the
      // video still plays inline; nested ad frames inherit the sandbox too.
      // Proxied embeds SKIP this — the server already strips ad scripts; and
      // providers with sandbox:false (e.g. videasy) SKIP it too because it would
      // break their resolution and they're clean anyway.
      f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-forms allow-pointer-lock");
    }
    f.referrerPolicy = "origin";
    document.body.appendChild(f);
    }
    // A source can fail inside a cross-origin frame without notifying this page.
    // Keep a source switcher available rather than guessing playback success.
    var sourceSelect = document.createElement("select");
    sourceSelect.className = "tbb-source-picker";
    window.tbbSources.fill(sourceSelect, key);
    sourceSelect.addEventListener("change", function () {
      var target = new URL(location.href);
      target.searchParams.set("provider", sourceSelect.value);
      location.replace(target.pathname + target.search + target.hash);
    });
    document.body.appendChild(sourceSelect);

    var back = makeBtn("tbb-pf tbb-pf--back",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
      "Back", goBack);
    document.body.appendChild(back);
    // Same always-clickable fullscreen button the bundle player gets — the
    // provider's own control lives inside a (sometimes sandboxed) iframe.
    var fs = makeBtn("tbb-pf tbb-pf--fs", FS_ICON_ENTER, "Fullscreen", toggleFullscreen);
    document.body.appendChild(fs);
    // Skip-episode. The bundle's own #nextEpisodeButton belongs to the bundle
    // player (hidden behind us) and only ever knew about VidKing, so provider
    // embeds get their own: it resolves the next episode from TMDB and just
    // navigates. Shown only when a next episode actually exists.
    var skip = null;
    if (mode === "tv" && tmdb) {
      skip = makeBtn("tbb-pf tbb-pf--skip tbb-pf-hidden",
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5l9 7-9 7V5zm10 0h2v14h-2z"/></svg>',
        "Next episode", function () { if (_nextEpisode) location.href = _nextEpisode.href; });
      document.body.appendChild(skip);
      _skipBtn = skip;
      refreshNextEpisode(tmdb, s, e);
    }
    var syncFs = function () { updateFsIcon(fs); };
    document.addEventListener("fullscreenchange", syncFs);
    document.addEventListener("webkitfullscreenchange", syncFs);
    // Providers may not postMessage play/pause, so the 4s idle timer in
    // setupDimming is what fades the buttons; hover restores them.
    setupDimming(skip ? [back, fs, skip] : [back, fs]);
  }

  // The bundle player still boots underneath a provider embed and points its
  // #embedFrame at the VidKing proxy. VidKing resolves no sources any more, so
  // that is only wasted bandwidth (and a stream of dead-server retries) — clear
  // it, and keep clearing it if the bundle re-assigns.
  function blankBundleEmbed() {
    function clear() {
      var f = document.getElementById("embedFrame");
      if (f && f.getAttribute("src")) f.removeAttribute("src");
    }
    clear();
    var host = document.getElementById("app-root") || document.body;
    try {
      new MutationObserver(clear).observe(host, { subtree: true, attributes: true, attributeFilter: ["src"], childList: true });
    } catch (e) {}
    var tries = 0;
    var iv = setInterval(function () { clear(); if (++tries > 40) clearInterval(iv); }, 500);
  }

  // ---- next episode (provider embeds) -------------------------------------
  function playerUrlFor(season, episode, episodeTitle, runtimeMinutes) {
    var p = new URLSearchParams(location.search);
    p.set("season", String(season));
    p.set("episode", String(episode));
    p.delete("progress");
    var showTitle = p.get("showTitle") || "";
    if (showTitle) p.set("title", showTitle + (episodeTitle ? " - " + episodeTitle : ""));
    if (runtimeMinutes) p.set("runtime", String(Math.floor(runtimeMinutes * 60)));
    return location.pathname + "?" + p.toString();
  }

  function tmdbJson(path) {
    return fetch("/api/tmdb/" + path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("tmdb " + r.status);
      return r.json();
    });
  }

  // Next episode = the following episode in this season, else episode 1 of the
  // next season that actually has episodes.
  function refreshNextEpisode(tmdb, season, episode) {
    _nextEpisode = null;
    if (_skipBtn) _skipBtn.classList.add("tbb-pf-hidden");
    var sn = Number(season) || 1, ep = Number(episode) || 1;
    tmdbJson("tv/" + tmdb + "/season/" + sn).then(function (data) {
      var eps = (data && data.episodes) || [];
      var next = null;
      for (var i = 0; i < eps.length; i++) {
        if (Number(eps[i].episode_number) === ep + 1) { next = { season: sn, ep: eps[i] }; break; }
      }
      if (next) return next;
      return tmdbJson("tv/" + tmdb).then(function (show) {
        var seasons = ((show && show.seasons) || []).filter(function (x) {
          return Number(x.season_number) === sn + 1 && Number(x.episode_count) > 0;
        });
        if (!seasons.length) return null;
        return tmdbJson("tv/" + tmdb + "/season/" + (sn + 1)).then(function (nextSeason) {
          var list = (nextSeason && nextSeason.episodes) || [];
          return list.length ? { season: sn + 1, ep: list[0] } : null;
        });
      });
    }).then(function (next) {
      if (!next) return;
      _nextEpisode = {
        season: next.season, episode: next.ep.episode_number,
        href: playerUrlFor(next.season, next.ep.episode_number, next.ep.name || "", next.ep.runtime || 0)
      };
      if (_skipBtn) {
        _skipBtn.classList.remove("tbb-pf-hidden");
        _skipBtn.title = _skipBtn.getAttribute("aria-label") ||
          ("Next: S" + next.season + "E" + next.ep.episode_number);
      }
    }).catch(function () {});
  }

  function injectStyles() {
    var css = '' +
      'html,body{background:#000 !important}' +
      'body.player-direct{overflow:hidden !important}' +
      /* hide every bit of page chrome / text */
      'body.player-direct .topbar,' +
      'body.player-direct .page-toolbar,' +
      'body.player-direct .hero,' +
      'body.player-direct .info-guides{display:none !important}' +
      'body.player-direct main.player-layout{display:block !important;max-width:none !important;width:auto !important;margin:0 !important;padding:0 !important}' +
      'body.player-direct main.player-layout > *:not(#embedWrap){display:none !important}' +
      /* the video fills the whole page */
      'body.player-direct #embedWrap{position:fixed !important;inset:0 !important;width:100% !important;height:100% !important;height:100dvh !important;max-width:none !important;margin:0 !important;padding:0 !important;border:0 !important;border-radius:0 !important;background:#000 !important;z-index:1 !important}' +
      'body.player-direct #embedFrame{position:absolute !important;inset:0 !important;width:100% !important;height:100% !important;margin:0 auto !important;border:0 !important;border-radius:0 !important;display:block !important}' +

      /* icon-only floating controls */
      '.tbb-pf{position:fixed;z-index:2147483000;display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(8,12,22,.55);color:#fff;cursor:pointer;padding:0;opacity:.85;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:opacity .35s ease,background .2s,transform .18s;box-shadow:0 6px 20px rgba(0,0,0,.4)}' +
      '.tbb-pf:hover{background:rgba(20,30,50,.85);transform:scale(1.06);opacity:1}' +
      '.tbb-pf svg{width:22px;height:22px}' +
      '.tbb-pf--back{top:max(16px,env(safe-area-inset-top));left:max(16px,env(safe-area-inset-left))}' +
      '.tbb-pf--fs{top:max(16px,env(safe-area-inset-top));right:max(16px,env(safe-area-inset-right))}' +
      '.tbb-pf--skip{top:max(16px,env(safe-area-inset-top));right:calc(max(16px,env(safe-area-inset-right)) + 56px)}' +
      /* dim (not vanish) while playing so they stay discoverable but unobtrusive */
      '.tbb-pf-dim{opacity:.18 !important}' +
      '.tbb-pf-dim:hover{opacity:1 !important}' +
      '.tbb-pf-hidden{opacity:0 !important;pointer-events:none !important}' +
      '.tbb-source-picker{position:fixed;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:10020;max-width:calc(100vw - 260px);padding:10px 12px;border:1px solid #34403e;border-radius:12px;background:#101916;color:#e7fff5;font:14px system-ui}' +
      '.tbb-external-player{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:110px 24px 32px;text-align:center;color:#e7fff5;font:16px system-ui;background:radial-gradient(ellipse at top,#142923,#060a08 65%);box-sizing:border-box;overflow:auto}' +
      '.tbb-external-player h1{font-size:clamp(24px,5vw,40px);margin:0 0 16px}.tbb-external-player p{max-width:480px;line-height:1.6;color:#a9bbb4}' +
      '.tbb-external-open{display:inline-block;background:#a9efd3;color:#06130e;font-weight:650;padding:14px 28px;border-radius:12px;text-decoration:none;margin:12px 0 20px}.tbb-external-fallback{color:#bcefd9;text-underline-offset:4px}.tbb-external-note{font-size:13px}' +
      '@media(max-width:560px){.tbb-pf{width:42px;height:42px}.tbb-pf svg{width:20px;height:20px}.tbb-source-picker{top:calc(max(16px,env(safe-area-inset-top)) + 54px);max-width:calc(100vw - 32px)}}';
    var s = document.createElement("style");
    s.id = "tbbPlayerFsStyles";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function boot() {
    if (!document.body || !document.body.classList.contains("player-direct")) {
      // not a direct player (e.g. theater) — leave it alone
      var s = document.getElementById("tbbPlayerFsStyles");
      if (s) s.remove();
      return;
    }
    var back = makeBtn("tbb-pf tbb-pf--back",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
      "Back", goBack);
    var skip = makeBtn("tbb-pf tbb-pf--skip tbb-pf-hidden",
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5l9 7-9 7V5zm10 0h2v14h-2z"/></svg>',
      "Next episode", skipEpisode);
    // Our own fullscreen button. The embed's native fullscreen control is unusable
    // for theater GUESTS (their controls are locked / pointer-events disabled), and
    // it lives inside a sandboxed iframe — so we add an always-clickable button that
    // fullscreens the whole player page (keeping our overlay controls visible).
    var fs = makeBtn("tbb-pf tbb-pf--fs",
      FS_ICON_ENTER, "Fullscreen", toggleFullscreen);
    document.body.appendChild(back);
    document.body.appendChild(skip);
    document.body.appendChild(fs);

    var syncFs = function () { updateFsIcon(fs); };
    document.addEventListener("fullscreenchange", syncFs);
    document.addEventListener("webkitfullscreenchange", syncFs);

    setupDimming([back, skip, fs]);
    watchSkipAvailability(skip);

    // Theater rooms keep the bundle's sync engine but its video (VidKing) is
    // dead — videasy-bridge swaps a videasy layer in underneath it.
    if (_isTheater && window.tbbVideasy && window.tbbVideasy.startTheater) {
      window.tbbVideasy.startTheater({
        mode: _params.get("mode"), tmdb: _params.get("tmdb"),
        season: _params.get("season"), episode: _params.get("episode"),
        progress: Number(_params.get("progress")) || 0,
        invite: _params.get("invite") || "", roomId: _params.get("roomId") || ""
      });
    }
  }

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function toggleFullscreen() {
    try {
      if (fsElement()) {
        (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
      } else {
        // Fullscreen the whole page (not just #embedWrap) so our overlay buttons
        // stay visible and the video — which is fixed:inset:0 — fills the screen.
        var t = document.documentElement;
        (t.requestFullscreen || t.webkitRequestFullscreen || function () {}).call(t);
      }
    } catch (e) {}
  }
  function updateFsIcon(btn) {
    if (btn) btn.innerHTML = fsElement() ? FS_ICON_EXIT : FS_ICON_ENTER;
  }

  function makeBtn(cls, svg, label, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = svg;
    b.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
    return b;
  }

  function goBack() {
    var nativeBack = document.getElementById("backButton");
    if (nativeBack) { nativeBack.click(); return; }
    if (history.length > 1) history.back(); else location.href = "/movies.html";
  }

  function skipEpisode() {
    var btn = document.getElementById("nextEpisodeButton");
    if (btn) btn.click(); // works even though the native button is display:none
  }

  // Show the floating skip control only when the bundle says a next episode
  // exists (mode=tv and #nextEpisodeButton present & not .hidden).
  function watchSkipAvailability(skipBtn) {
    var isTv = (new URLSearchParams(location.search).get("mode") === "tv");
    function refresh() {
      // Our CSS forces the native button to display:none, so availability is
      // read from its .hidden property (toggled by the bundle), not its layout.
      var native = document.getElementById("nextEpisodeButton");
      var available = !!(isTv && native && !native.hidden);
      skipBtn.classList.toggle("tbb-pf-hidden", !available);
    }
    refresh();
    var native = document.getElementById("nextEpisodeButton");
    if (native) {
      new MutationObserver(refresh).observe(native, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
    } else {
      // button not in DOM yet — poll briefly until it appears
      var tries = 0;
      var iv = setInterval(function () {
        var n = document.getElementById("nextEpisodeButton");
        if (n) { clearInterval(iv); new MutationObserver(refresh).observe(n, { attributes: true, attributeFilter: ["hidden", "class", "style"] }); refresh(); }
        else if (++tries > 60) clearInterval(iv);
      }, 500);
    }
    window.addEventListener("message", function () { setTimeout(refresh, 0); });
  }

  // Dim the controls while the video is playing, restore them when paused/ended.
  // (The cross-origin iframe swallows mouse events, so we can't use mouse
  // inactivity — we key off the player's own play/pause messages instead.)
  function setupDimming(btns) {
    function setDim(on) { btns.forEach(function (b) { b.classList.toggle("tbb-pf-dim", on); }); }
    var idle = setTimeout(function () { setDim(true); }, 4000); // dim shortly after load if playback starts
    window.addEventListener("message", function (ev) {
      var data = ev.data;
      try { if (typeof data === "string") data = JSON.parse(data); } catch (_e) { return; }
      if (!data || typeof data !== "object") return;
      var evt = data.event;
      if (evt === "play" || evt === "timeupdate") { clearTimeout(idle); setDim(true); }
      else if (evt === "pause" || evt === "ended" || evt === "ready") { clearTimeout(idle); setDim(false); }
    });
    // brighten momentarily whenever the pointer is over our own buttons
    btns.forEach(function (b) { b.addEventListener("pointerenter", function () { b.classList.remove("tbb-pf-dim"); }); });
  }
})();
