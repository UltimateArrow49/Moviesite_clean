/* search-live.js — instant results-as-you-type search for theblackbox.
   Original implementation using the site's TMDB proxy. */
(function () {
  "use strict";
  var IMG = "https://image.tmdb.org/t/p/w342";
  var input = document.getElementById("sInput");
  var grid = document.getElementById("sGrid");
  var status = document.getElementById("sStatus");
  var empty = document.getElementById("sEmpty");
  var timer = null, seq = 0;

  var q0 = new URLSearchParams(location.search).get("q") || "";
  if (q0) input.value = q0;

  function setStatus(t) { status.textContent = t || ""; }

  function card(item) {
    var mode = item.media_type === "tv" ? "tv" : "movie";
    var a = document.createElement("a");
    a.className = "s-card";
    a.href = "/detail.html?mode=" + mode + "&tmdb=" + item.id;
    var im;
    if (item.poster_path) {
      im = document.createElement("img");
      im.className = "s-poster"; im.loading = "lazy"; im.alt = "";
      im.src = IMG + item.poster_path;
    } else {
      im = document.createElement("div");
      im.className = "s-poster-ph";
      im.textContent = item.title || item.name || "";
    }
    var name = document.createElement("div");
    name.className = "s-name"; name.textContent = item.title || item.name || "Untitled";
    var sub = document.createElement("div");
    sub.className = "s-sub";
    var badge = document.createElement("span");
    badge.className = "s-badge"; badge.textContent = mode === "tv" ? "Show" : "Movie";
    sub.appendChild(badge);
    var year = (item.release_date || item.first_air_date || "").slice(0, 4);
    if (year) { var y = document.createElement("span"); y.textContent = year; sub.appendChild(y); }
    if (item.vote_average) { var r = document.createElement("span"); r.textContent = "★ " + item.vote_average.toFixed(1); sub.appendChild(r); }
    a.appendChild(im); a.appendChild(name); a.appendChild(sub);
    return a;
  }

  function run(query) {
    var my = ++seq;
    query = query.trim();
    if (!query) { grid.innerHTML = ""; empty.hidden = true; setStatus("Start typing to search."); return; }
    setStatus("Searching…");
    fetch("/api/tmdb/search/multi?query=" + encodeURIComponent(query) + "&include_adult=false&page=1", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (my !== seq) return; // stale response
        var items = (d.results || []).filter(function (m) {
          return (m.media_type === "movie" || m.media_type === "tv");
        });
        // posters first, then keep the rest
        items.sort(function (a, b) { return (b.poster_path ? 1 : 0) - (a.poster_path ? 1 : 0) || (b.popularity || 0) - (a.popularity || 0); });
        grid.innerHTML = "";
        if (!items.length) {
          empty.hidden = false; empty.textContent = 'No results for "' + query + '".';
          setStatus(""); return;
        }
        empty.hidden = true;
        var frag = document.createDocumentFragment();
        items.forEach(function (it) { frag.appendChild(card(it)); });
        grid.appendChild(frag);
        setStatus(items.length + " result" + (items.length > 1 ? "s" : ""));
      })
      .catch(function () {
        if (my !== seq) return;
        setStatus("Search failed — try again.");
      });
  }

  input.addEventListener("input", function () {
    var v = input.value;
    var u = new URL(location.href);
    if (v) u.searchParams.set("q", v); else u.searchParams.delete("q");
    history.replaceState(null, "", u);
    window.clearTimeout(timer);
    timer = window.setTimeout(function () { run(v); }, 250);
  });

  input.focus();
  run(q0);
})();
