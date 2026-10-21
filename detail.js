/* detail.js — cinematic movie/TV detail page for theblackbox.
   Original implementation using the site's existing TMDB proxy + player. */
(function () {
  "use strict";

  var IMG = "https://image.tmdb.org/t/p/";
  var params = new URLSearchParams(location.search);
  var mode = params.get("mode") === "tv" ? "tv" : "movie";
  var tmdb = params.get("tmdb") || params.get("id");

  if (!tmdb) { location.replace("/movies.html"); return; }

  var provider = window.tbbSources.selected(params.get("provider"));

  var $ = function (id) { return document.getElementById(id); };

  function img(path, size) {
    return path ? IMG + size + path : "";
  }

  // ---- crossfading backdrop (two stacked layers) ----
  var showBackdrop = "";
  var bdLayers = null, bdFront = null, bdSeq = 0;
  function ensureLayers() {
    if (bdLayers) return;
    var bd = $("dBackdrop");
    var a = document.createElement("div"); a.className = "d-bd-layer";
    var b = document.createElement("div"); b.className = "d-bd-layer";
    bd.insertBefore(a, bd.firstChild); bd.insertBefore(b, bd.firstChild);
    bdLayers = [a, b]; bdFront = a;
  }
  function setBackdrop(url) {
    if (!url) return;
    ensureLayers();
    var my = ++bdSeq;
    var pre = new Image();
    pre.onload = function () {
      if (my !== bdSeq) return;                 // a newer change superseded this one
      var back = bdFront === bdLayers[0] ? bdLayers[1] : bdLayers[0];
      back.style.backgroundImage = "url('" + url + "')";
      void back.offsetWidth;                     // reflow so the opacity transition fires
      back.classList.add("on");
      bdFront.classList.remove("on");
      bdFront = back;
    };
    pre.onerror = function () { if (my === bdSeq && showBackdrop && url !== showBackdrop) setBackdrop(showBackdrop); };
    pre.src = url;
  }

  // Watched fraction for one entry id/slug ("tv:1399:1:1" / "movie:27205") read
  // from the site's own stores: the continue-watching list (device-namespaced
  // key, holds unfinished items) and "recently" (keeps finished ones, with a
  // completed flag). Both are written by videasy-bridge.js during playback and
  // by /api/sync when history comes down from another device.
  function historyState(slug) {
    var best = null, finished = null;
    function scan(list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (e) {
        if (!e || (e.id || e.slug) !== slug) return;
        var when = Number(e.updatedAt || e.lastPlayedAt) || 0;
        var item = { progress: Number(e.progress) || 0, runtime: Number(e.runtime) || 0, completed: !!e.completed, when: when };
        // An entry that carries a real position beats a bare "completed" record:
        // a theatre viewing writes completed-at-0:00 for the room, and that was
        // masking the position you had built up watching it solo.
        if (item.progress > 0) { if (!best || when >= best.when) best = item; }
        else if (item.completed && (!finished || when >= finished.when)) finished = item;
      });
    }
    try {
      scan(JSON.parse(localStorage.getItem("recently") || "[]"));
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("tbb:continue:v1:") === 0 && k !== "tbb:continue:v1:device-id") {
          scan(JSON.parse(localStorage.getItem(k) || "[]"));
        }
      }
    } catch (e) {}
    return best || finished;
  }

  function historyPercent(slug) {
    var h = historyState(slug);
    if (!h) return 0;
    if (h.completed) return 100;
    if (h.progress && h.runtime) return Math.min(100, (h.progress / h.runtime) * 100);
    return 0;
  }

  function api(path) {
    return fetch("/api/tmdb/" + path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("tmdb " + r.status);
      return r.json();
    });
  }

  function chip(text, cls) {
    var s = document.createElement("span");
    s.className = "d-chip" + (cls ? " " + cls : "");
    s.textContent = text;
    return s;
  }

  function fmtRuntime(min) {
    if (!min) return "";
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + "h " : "") + (m ? m + "m" : "");
  }

  function buildPlayerUrl(d, extra) {
    var title = d.title || d.name || "theblackbox";
    var p = new URLSearchParams({
      mode: mode, tmdb: String(tmdb), title: title,
      autoplay: "true", color: "14ff9f"
    });
    var poster = d.poster_path ? img(d.poster_path, "w500") : "";
    var backdrop = d.backdrop_path ? img(d.backdrop_path, "w780") : "";
    if (poster) p.set("poster", poster);
    if (backdrop) p.set("backdrop", backdrop);
    var rel = d.release_date || d.first_air_date || "";
    if (rel) p.set("release", rel);
    var rt = (d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0) * 60;
    if (extra && extra.runtime) rt = extra.runtime * 60;
    if (rt) p.set("runtime", String(rt));
    if (mode === "tv" && extra) {
      if (extra.season) p.set("season", String(extra.season));
      if (extra.episode) p.set("episode", String(extra.episode));
      p.set("title", title + (extra.episodeTitle ? " - " + extra.episodeTitle : ""));
      if (extra.showTitle) p.set("showTitle", extra.showTitle);
    }
    if (provider) p.set("provider", provider);
    return "/player.html?" + p.toString();
  }

  function renderCast(credits) {
    var cast = (credits && credits.cast) || [];
    if (!cast.length) return;
    var wrap = $("dCast");
    cast.slice(0, 14).forEach(function (c) {
      var card = document.createElement("div");
      card.className = "d-cast-card";
      var ph;
      if (c.profile_path) {
        ph = document.createElement("img");
        ph.src = img(c.profile_path, "w185");
        ph.loading = "lazy";
        ph.alt = c.name || "";
      } else {
        ph = document.createElement("div");
        ph.className = "d-cast-ph";
      }
      var name = document.createElement("div");
      name.className = "d-cast-name"; name.textContent = c.name || "";
      var role = document.createElement("div");
      role.className = "d-cast-role"; role.textContent = c.character || "";
      card.appendChild(ph); card.appendChild(name); card.appendChild(role);
      wrap.appendChild(card);
    });
    $("dCastSection").hidden = false;
  }

  function renderReco(reco) {
    var items = (reco && reco.results) || [];
    items = items.filter(function (m) { return m.poster_path; });
    if (!items.length) return;
    var wrap = $("dReco");
    items.slice(0, 12).forEach(function (m) {
      var a = document.createElement("a");
      a.href = "/detail.html?mode=" + mode + "&tmdb=" + m.id;
      var im = document.createElement("img");
      im.src = img(m.poster_path, "w342"); im.loading = "lazy"; im.alt = "";
      var t = document.createElement("div");
      t.className = "d-reco-title"; t.textContent = m.title || m.name || "";
      a.appendChild(im); a.appendChild(t);
      wrap.appendChild(a);
    });
    $("dRecoSection").hidden = false;
  }

  function setupTvEpisodes(d) {
    var seasons = (d.seasons || []).filter(function (s) { return s.season_number > 0 && s.episode_count > 0; });
    if (!seasons.length) { wirePlay(d, { season: 1, episode: 1, showTitle: d.name }); return; }
    var box = $("dEps");
    box.hidden = false;
    box.classList.add("d-eps--list");

    var seasonSel = document.createElement("select");
    seasons.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.season_number;
      o.textContent = s.name || ("Season " + s.season_number);
      seasonSel.appendChild(o);
    });
    var epList = document.createElement("div");
    epList.className = "d-ep-list";
    box.appendChild(seasonSel);
    box.appendChild(epList);

    // Per-episode watched fraction from the local watch_progress store
    // (shape: watch_progress[key].show_progress["s{S}e{E}"].progress).
    // The key is "tv-{tmdb}" for videasy (the current source, mirrored in by
    // videasy-bridge.js) and a bare "{tmdb}" for the old proxied VidKing embed,
    // so check both — old history stays visible.
    function epPercent(season, episode) {
      var pct = 0;
      try {
        var wp = JSON.parse(localStorage.getItem("watch_progress") || "{}");
        var entry = wp["tv-" + tmdb] || wp[String(tmdb)];
        var sp = entry && entry.show_progress && entry.show_progress["s" + season + "e" + episode];
        var p = (sp && sp.progress) || null;
        if (p) {
          if (p.completed) return 100;
          if (p.watched && p.duration) pct = Math.max(0, Math.min(100, (p.watched / p.duration) * 100));
        }
      } catch (e) {}
      // Fall back to the site's own history stores. They survive a finished
      // episode (watch_progress is per-source and only reflects what the
      // videasy embed reported on THIS device), and they are what /api/sync
      // restores on another device — so bars follow the account, not the tab.
      return Math.max(pct, historyPercent("tv:" + tmdb + ":" + season + ":" + episode));
    }

    function playEpisode(ep) {
      window.location.href = buildPlayerUrl(d, {
        season: seasonSel.value, episode: ep.episode_number,
        episodeTitle: ep.name || "", runtime: ep.runtime || 0, showTitle: d.name
      });
    }

    function loadEpisodes(sn) {
      epList.innerHTML = '<div class="d-ep-loading">Loading episodes…</div>';
      api("tv/" + tmdb + "/season/" + sn).then(function (s) {
        epList.innerHTML = "";
        var eps = s.episodes || [];
        if (!eps.length) { epList.innerHTML = '<div class="d-ep-loading">No episodes found.</div>'; return; }
        // Main Play button = first not-yet-finished episode (resume), else E1.
        var resumeEp = eps[0];
        for (var i = 0; i < eps.length; i++) { if (epPercent(sn, eps[i].episode_number) < 95) { resumeEp = eps[i]; break; } }
        wirePlay(d, { season: sn, episode: resumeEp.episode_number, episodeTitle: resumeEp.name || "", runtime: resumeEp.runtime || 0, showTitle: d.name });
        if (resumeEp.still_path) setBackdrop(img(resumeEp.still_path, "w1280"));

        eps.forEach(function (e) {
          var pct = epPercent(sn, e.episode_number);
          var row = document.createElement("button");
          row.type = "button";
          row.className = "d-ep-row" + (pct >= 95 ? " is-watched" : "");
          row.innerHTML =
            (e.still_path
              ? '<img class="d-ep-thumb" loading="lazy" src="' + img(e.still_path, "w300") + '" alt="">'
              : '<div class="d-ep-thumb d-ep-thumb--ph"></div>') +
            '<div class="d-ep-info">' +
              '<div class="d-ep-head"><span class="d-ep-num">E' + e.episode_number + '</span>' +
              '<span class="d-ep-name">' + escapeHtml(e.name || ("Episode " + e.episode_number)) + '</span>' +
              (e.runtime ? '<span class="d-ep-rt">' + e.runtime + 'm</span>' : '') + '</div>' +
              (e.overview ? '<p class="d-ep-ov">' + escapeHtml(e.overview) + '</p>' : '') +
              '<div class="d-ep-bar"><span class="d-ep-bar-fill" style="width:' + pct + '%"></span></div>' +
            '</div>' +
            '<svg class="d-ep-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5z"/></svg>';
          row.addEventListener("click", function () { playEpisode(e); });
          row.addEventListener("mouseenter", function () { if (e.still_path) setBackdrop(img(e.still_path, "w1280")); });
          epList.appendChild(row);
        });
      }).catch(function () { epList.innerHTML = '<div class="d-ep-loading">Couldn\'t load episodes.</div>'; });
    }

    seasonSel.addEventListener("change", function () { loadEpisodes(seasonSel.value); });
    loadEpisodes(seasonSel.value);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  function wirePlay(d, extra) {
    $("dPlay").setAttribute("href", buildPlayerUrl(d, extra));
    labelPlay(extra);
  }

  // "Play" → "Resume 21:14" once there is a stored position, and a thin red bar
  // under the button showing how far in you are (movies have no episode list to
  // carry that, so the button is where it belongs).
  function labelPlay(extra) {
    var play = $("dPlay");
    if (!play) return;
    var seconds = 0, percent = 0;
    try {
      var wp = JSON.parse(localStorage.getItem("watch_progress") || "{}");
      var entry = wp[mode + "-" + tmdb] || wp[String(tmdb)];
      var p = null;
      if (mode === "tv" && entry && entry.show_progress && extra) {
        var sp = entry.show_progress["s" + extra.season + "e" + extra.episode];
        p = sp && sp.progress;
      } else if (mode === "movie" && entry) {
        p = entry.progress;
      }
      if (p && !p.completed && p.watched > 0) {
        seconds = Math.floor(p.watched);
        if (p.duration > 0) percent = Math.min(100, (p.watched / p.duration) * 100);
      }
    } catch (e) {}
    if (!seconds || !percent) {
      var hist = historyState(mode === "tv" && extra
        ? "tv:" + tmdb + ":" + extra.season + ":" + extra.episode
        : "movie:" + tmdb);
      if (hist && !hist.completed) {
        if (!seconds) seconds = hist.progress || 0;
        if (!percent && hist.progress && hist.runtime) percent = Math.min(100, (hist.progress / hist.runtime) * 100);
      }
    }
    if (seconds < 15) seconds = 0; // too early in to be worth a "Resume"
    // The label is the button's text node (the icon <svg> and the progress bar
    // are elements) — find it rather than assuming a position, since appending
    // the bar would otherwise make it the last child.
    for (var i = 0; i < play.childNodes.length; i++) {
      var node = play.childNodes[i];
      if (node.nodeType === 3 && node.nodeValue.trim()) {
        node.nodeValue = seconds > 0 ? " Resume " + fmtClock(seconds) : " Play";
        break;
      }
    }
    var bar = play.querySelector(".d-play-bar");
    if (percent > 0) {
      if (!bar) {
        bar = document.createElement("span");
        bar.className = "d-play-bar";
        bar.innerHTML = '<span class="d-play-bar-fill"></span>';
        play.appendChild(bar);
      }
      bar.firstChild.style.width = Math.max(3, Math.min(100, percent)) + "%";
    } else if (bar) {
      bar.remove();
    }
  }

  function fmtClock(seconds) {
    var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
    var mm = (h && m < 10 ? "0" : "") + m, ss = (s < 10 ? "0" : "") + s;
    return (h ? h + ":" : "") + mm + ":" + ss;
  }

  function render(d) {
    document.title = (d.title || d.name || "theblackbox") + " · theblackbox";
    showBackdrop = d.backdrop_path ? img(d.backdrop_path, "original") : (d.poster_path ? img(d.poster_path, "w780") : "");
    if (showBackdrop) setBackdrop(showBackdrop);
    // No poster on TV detail (episode thumbnails carry the art — the poster just
    // crowds the episode list); collapse the hero to a single column. Also
    // collapse when a movie genuinely has no poster, so there's no empty column.
    if (mode !== "tv" && d.poster_path) {
      $("dPoster").src = img(d.poster_path, "w500");
    } else {
      $("dPoster").style.display = "none";
      var heroEl = document.querySelector(".d-hero");
      if (heroEl) heroEl.classList.add("d-hero--nopost");
    }
    $("dTitle").textContent = d.title || d.name || "Untitled";

    var facts = $("dFacts");
    var year = (d.release_date || d.first_air_date || "").slice(0, 4);
    if (year) facts.appendChild(chip(year));
    var rt = fmtRuntime(d.runtime || (d.episode_run_time && d.episode_run_time[0]));
    if (rt) facts.appendChild(chip(rt));
    if (d.vote_average && d.vote_count) facts.appendChild(chip("★ " + d.vote_average.toFixed(1), "d-chip--rating"));
    (d.genres || []).slice(0, 3).forEach(function (g) { facts.appendChild(chip(g.name)); });
    if (mode === "tv" && d.number_of_seasons) facts.appendChild(chip(d.number_of_seasons + " season" + (d.number_of_seasons > 1 ? "s" : "")));

    $("dOverview").textContent = d.overview || "";

    if (mode === "tv") { setupTvEpisodes(d); } else { wirePlay(d, null); }

    // Shared source choices also appear on the playback screen.
    (function () {
      var sel = document.createElement("select");
      sel.className = "d-provider";
      window.tbbSources.fill(sel, provider);
      sel.addEventListener("change", function () { provider = sel.value; });
      var dp = $("dPlay");
      // TV: place the picker in the episode header (next to the season select) so
      // it's visible WITH the episodes — episodes are played by clicking a row,
      // and the Play button sits below the whole list, off-screen. Movie: keep it
      // next to the Play button.
      if (mode === "tv") {
        var box = $("dEps");
        var seasonSel = box.querySelector("select");
        var head = document.createElement("div");
        head.className = "d-eps-head";
        box.insertBefore(head, box.firstChild);
        if (seasonSel) head.appendChild(seasonSel);
        head.appendChild(sel);
      } else {
        dp.parentElement.appendChild(sel);
      }
      // The Play <a> href is built once; reflect the current provider on click.
      dp.addEventListener("click", function () {
        var u = new URL(dp.href, location.origin);
        u.searchParams.set("provider", provider);
        dp.setAttribute("href", u.pathname + u.search);
      }, true);
    })();

    renderCast(d.credits);
    renderReco(d.recommendations);

    $("dLoading").hidden = true;
    $("dWrap").hidden = false;
  }

  var append = mode === "tv"
    ? "tv/" + tmdb + "?append_to_response=credits,recommendations"
    : "movie/" + tmdb + "?append_to_response=credits,recommendations";

  api(append).then(render).catch(function (e) {
    console.error("detail load failed", e);
    location.replace("/player.html?mode=" + mode + "&tmdb=" + tmdb + "&autoplay=true&color=14ff9f");
  });
})();
