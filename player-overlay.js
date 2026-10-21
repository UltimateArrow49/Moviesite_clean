/**
 * player-overlay.js  — next-episode overlay patch
 * Loaded before the main player bundle so the message-event intercept is in place.
 */
(function () {
  "use strict";

  /* ── 1. Strip nextEpisode auto-advance signals before the bundle sees them ── */
  var _origAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === "message" && this === window && typeof fn === "function") {
      var wrapped = function (ev) {
        var data = ev.data;
        try {
          if (typeof data === "string") {
            var parsed = JSON.parse(data);
            if (parsed && parsed.nextEpisode) {
              var patched = Object.assign({}, parsed, { nextEpisode: false });
              var newEv = new MessageEvent("message", {
                data: JSON.stringify(patched),
                origin: ev.origin,
                source: ev.source,
                lastEventId: ev.lastEventId,
              });
              return fn.call(this, newEv);
            }
          } else if (data && typeof data === "object" && data.nextEpisode) {
            var patchedObj = Object.assign({}, data, { nextEpisode: false });
            var newEvObj = new MessageEvent("message", {
              data: patchedObj,
              origin: ev.origin,
              source: ev.source,
              lastEventId: ev.lastEventId,
            });
            return fn.call(this, newEvObj);
          }
        } catch (_e) {}
        return fn.call(this, ev);
      };
      wrapped.__tbbOriginal = fn;
      return _origAEL.call(this, type, wrapped, opts);
    }
    return _origAEL.call(this, type, fn, opts);
  };

  /* ── 2. Overlay + button logic (runs after DOM is ready) ── */
  var NEXT_EP_WINDOW_SEC = 90;
  var NEXT_EP_MIN_PERCENT = 0.82;

  var currentTime = 0;
  var runtimeSeconds = null;
  var overlayDismissed = false;

  function getMode() {
    try { return new URLSearchParams(window.location.search).get("mode"); } catch (_e) { return null; }
  }

  function getRuntimeFromUrl() {
    try {
      var rt = new URLSearchParams(window.location.search).get("runtime");
      return rt ? Number(rt) : null;
    } catch (_e) { return null; }
  }

  // Watch for runtime updates written to the URL by syncPlayerUrl
  var _origReplaceState = history.replaceState;
  history.replaceState = function (state, title, url) {
    _origReplaceState.apply(history, arguments);
    try {
      var rt = new URL(url, location.origin).searchParams.get("runtime");
      if (rt) runtimeSeconds = Number(rt);
    } catch (_e) {}
  };

  function createOverlay() {
    var wrap = document.getElementById("embedWrap");
    if (!wrap || document.getElementById("nextEpisodeOverlay")) return;

    var el = document.createElement("div");
    el.className = "next-episode-overlay";
    el.id = "nextEpisodeOverlay";
    el.setAttribute("hidden", "");
    el.setAttribute("aria-live", "polite");
    el.innerHTML =
      '<div class="next-episode-card">' +
      '<button class="next-episode-close" id="nextEpisodeOverlayDismiss" type="button" aria-label="Dismiss">\xd7</button>' +
      '<p class="next-episode-kicker">Up Next</p>' +
      '<p class="next-episode-ep" id="nextEpisodeOverlayEp"></p>' +
      '<p class="next-episode-name" id="nextEpisodeOverlayName"></p>' +
      '<button class="btn btn--primary next-episode-play" id="nextEpisodeOverlayPlay" type="button">Play Next Episode</button>' +
      "</div>";
    wrap.appendChild(el);

    document.getElementById("nextEpisodeOverlayDismiss").addEventListener("click", function () {
      overlayDismissed = true;
      document.getElementById("nextEpisodeOverlay").hidden = true;
    });

    document.getElementById("nextEpisodeOverlayPlay").addEventListener("click", function () {
      var skipBtn = document.getElementById("nextEpisodeButton");
      if (skipBtn) skipBtn.click();
      var ov = document.getElementById("nextEpisodeOverlay");
      if (ov) ov.hidden = true;
    });
  }

  function styleSkipButton() {
    var btn = document.getElementById("nextEpisodeButton");
    if (btn && btn.className.indexOf("btn--skip-episode") === -1) {
      btn.className = "btn btn--skip-episode";
    }
  }

  function updateOverlay(force) {
    var ov = document.getElementById("nextEpisodeOverlay");
    if (!ov || overlayDismissed) return;

    var skipBtn = document.getElementById("nextEpisodeButton");
    var mode = getMode();
    if (mode !== "tv" || !skipBtn || skipBtn.hidden) {
      ov.hidden = true;
      return;
    }

    var rt = runtimeSeconds;
    var ct = currentTime;
    if (!rt || !ct) { if (!force) return; }

    var remaining = rt ? rt - ct : Infinity;
    var pct = rt && ct ? ct / rt : 0;
    var shouldShow = force || (remaining <= NEXT_EP_WINDOW_SEC && pct >= NEXT_EP_MIN_PERCENT);

    if (shouldShow && !ov.hidden) return; // already visible
    ov.hidden = !shouldShow;

    if (shouldShow) {
      // Populate episode info from the skip button text if overlay fields are empty
      var epEl = document.getElementById("nextEpisodeOverlayEp");
      var nameEl = document.getElementById("nextEpisodeOverlayName");
      if (epEl && !epEl.textContent) {
        var label = skipBtn.textContent || "";
        var match = label.match(/S\d+E\d+/);
        if (match) epEl.textContent = match[0];
      }
      if (nameEl && !nameEl.textContent) {
        var titleText = document.getElementById("title");
        if (titleText) {
          var parts = (titleText.textContent || "").split(" - ");
          if (parts.length > 1) nameEl.textContent = parts.slice(1).join(" - ");
        }
      }
    }
  }

  // Listen for player events to track time
  window.addEventListener("message", function (ev) {
    try {
      var data = ev.data;
      if (typeof data === "string") data = JSON.parse(data);
      if (!data || typeof data !== "object") return;

      var evt = data.event;
      if (evt === "timeupdate" || evt === "play" || evt === "seeked" || evt === "pause") {
        if (data.currentTime != null) currentTime = Number(data.currentTime);
        styleSkipButton();
        updateOverlay(false);
      }
      if (evt === "ended") {
        var mode = getMode();
        var skipBtn = document.getElementById("nextEpisodeButton");
        if (mode === "tv" && skipBtn && !skipBtn.hidden) {
          updateOverlay(true);
        }
      }
      if (evt === "ready") {
        // New episode loaded — reset overlay
        overlayDismissed = false;
        var ov = document.getElementById("nextEpisodeOverlay");
        if (ov) ov.hidden = true;
        styleSkipButton();
      }
    } catch (_e) {}
  });

  function init() {
    runtimeSeconds = getRuntimeFromUrl();
    createOverlay();
    styleSkipButton();
  }

  // The React app renders asynchronously; poll until embedWrap exists
  var attempts = 0;
  function waitForDom() {
    if (document.getElementById("embedWrap")) {
      init();
    } else if (attempts++ < 40) {
      setTimeout(waitForDom, 250);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForDom);
  } else {
    waitForDom();
  }
})();
