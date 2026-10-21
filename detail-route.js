/* detail-route.js — on catalog pages, send "play this title" clicks to the
   cinematic detail page first (instead of straight into the player).
   Added only to catalog pages; the detail page's own Play button is untouched. */
(function () {
  "use strict";
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let new-tab clicks pass
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var raw = a.getAttribute("href") || "";
    if (raw.indexOf("player.html") < 0) return;
    var u;
    try { u = new URL(a.href, location.origin); } catch (_) { return; }
    if (!u.searchParams.has("tmdb")) return;
    // Continue-watching / watch-again tiles are a resume action, not a browse
    // action: they carry the saved position, and sending them to the detail page
    // threw it away ("Resume from 12:34" quietly restarted the title). Let those
    // through to the player untouched.
    if (u.searchParams.has("progress") ||
        (a.className && String(a.className).indexOf("card--continue") >= 0)) return;
    var p = new URLSearchParams();
    ["mode", "tmdb", "season", "episode"].forEach(function (k) {
      if (u.searchParams.get(k)) p.set(k, u.searchParams.get(k));
    });
    e.preventDefault();
    e.stopPropagation();
    location.href = "/detail.html?" + p.toString();
  }, true);
})();
