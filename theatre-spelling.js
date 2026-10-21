/* theatre-spelling.js — British spelling for the watch-together feature.
   The UI text ("Theater", "Create a theater...", etc.) lives in the compiled
   bundle, so we can't edit the source. This script rewrites the VISIBLE text
   "theater" -> "theatre" in the DOM (and keeps doing so as React re-renders),
   without touching routes/code (which never appear in text nodes).
   Scope: on the theatre page (body.page-theater) it fixes all text; on other
   pages it only fixes the top-bar nav label, so it never rewrites movie
   titles/overviews that happen to contain the word. */
(function () {
  "use strict";
  if (window.__tbbTheatre) return;
  window.__tbbTheatre = true;

  function brit(s) {
    return s
      .replace(/Theaters\b/g, "Theatres")
      .replace(/theaters\b/g, "theatres")
      .replace(/Theater\b/g, "Theatre")
      .replace(/theater\b/g, "theatre");
  }

  function walkText(root) {
    if (!root) return;
    var walker;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    } catch (e) { return; }
    var node;
    while ((node = walker.nextNode())) {
      var v = node.nodeValue;
      if (v && v.indexOf("heater") > -1) {
        var nv = brit(v);
        if (nv !== v) node.nodeValue = nv;
      }
    }
  }

  function onTheatrePage() {
    return !!(document.body && document.body.classList.contains("page-theater"));
  }

  function roots() {
    if (onTheatrePage()) return [document.body];
    // Other pages: only the nav/top bar, to avoid rewriting catalog content.
    return Array.prototype.slice.call(
      document.querySelectorAll(".topbar, .tbb-bottomnav")
    );
  }

  function run() {
    roots().forEach(walkText);
    if (document.title.indexOf("heater") > -1) document.title = brit(document.title);
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // setTimeout (not requestAnimationFrame): rAF doesn't fire in hidden /
    // background tabs, which would leave text unrewritten until refocus.
    setTimeout(function () {
      scheduled = false;
      run();
    }, 0);
  }

  function start() {
    run();
    try {
      new MutationObserver(schedule).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    } catch (e) {}
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
