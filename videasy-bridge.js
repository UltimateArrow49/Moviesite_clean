/* videasy-bridge.js — watch-progress bridge for the Videasy embed.
   -----------------------------------------------------------------
   theblackbox was built around the VidKing embed, which we proxied under our
   OWN origin (/embed/...) — so VidKing's `localStorage.watch_progress` writes
   landed on theblackbox.run and everything (continue watching, the red episode
   bars on the detail page, resume, next episode) read straight out of it.

   VidKing's source backend is dead, so the primary source is now videasy's own
   player (player.videasy.to), embedded DIRECTLY — a cross-origin iframe. Its
   localStorage is videasy's, invisible to us, so all of those features silently
   stopped working. Videasy instead posts its whole progress store to the parent
   window:

     event.origin = "https://player.videasy.to"
     event.data   = '{"type":"MEDIA_DATA","data":"<json string>"}'
     data (parsed) = {
       "tv-1399": {                      // key is `${mediaType}-${tmdbId}`
         poster, background, id: 1399, mediaType: "tv", title,
         progress: { watched, duration },          // seconds (movies)
         last_season_watched: 1, last_episode_watched: 1,
         show_progress: { "s1e1": { season:"1", episode:"1",
                                    last_updated: <ms>,
                                    progress: { watched, duration } } }
       }
     }

   This module turns that stream back into the site's own state:
     1. mirrors it into `localStorage.watch_progress` (under BOTH videasy's
        `tv-1399` key and the bare `1399` key the detail page used to read),
     2. writes the continue-watching + recently-watched stores through the
        site's OWN bundle module, so the home rails and the backend /api/sync
        save fire exactly as they did with VidKing,
     3. tracks episode changes that happen INSIDE the videasy player
        (its next-episode button / autoplay-next / episode selector) so the
        page URL, the resume point and the skip button follow along.

   It also owns videasy URL building (feature params + resume position), used by
   player-fullscreen.js. Loaded before player-fullscreen.js on player.html. */
(function () {
  "use strict";
  if (window.tbbVideasy) return;

  var BASE = "https://player.videasy.to";
  // Accept both hosts: videasy.net 301s to videasy.to, but the player has been
  // served from either at times and the message origin follows the frame URL.
  var ORIGINS = ["https://player.videasy.to", "https://player.videasy.net"];
  // The bundle chunk that owns the continue-watching + recently-watched stores
  // (device namespace, entry normalisation, the `continuewatchingchange` event
  // that progress_sync listens for). Importing the real module keeps our writes
  // byte-identical to the bundle's own and reuses its storage namespace.
  var HISTORY_MODULE = "/assets/recently_watched-Yl_0sTPT.js";
  var WP_KEY = "watch_progress";
  var CONTINUE_PREFIX = "tbb:continue:v1";
  var SAVE_EVERY_MS = 5000;   // throttle localStorage/sync writes
  var DONE_FRACTION = 0.97;   // treat as finished (don't resume, drop from rail)
  var MIN_RESUME_SEC = 15;

  // ---------------------------------------------------------------- storage
  function readWatchProgress() {
    try { return JSON.parse(localStorage.getItem(WP_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function writeWatchProgress(obj) {
    try { localStorage.setItem(WP_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function titleEntry(mode, tmdb) {
    var wp = readWatchProgress();
    return wp[mode + "-" + tmdb] || wp[String(tmdb)] || null;
  }
  function epKey(season, episode) { return "s" + Number(season) + "e" + Number(episode); }

  // Seconds to resume from, or 0 to start at the beginning.
  function resumePosition(o) {
    var entry = titleEntry(o.mode, o.tmdb);
    var p = null;
    if (entry) {
      if (o.mode === "tv") {
        var sp = entry.show_progress && entry.show_progress[epKey(o.season, o.episode)];
        p = sp && sp.progress;
      } else {
        p = entry.progress;
      }
    }
    var watched = 0, duration = 0, done = false;
    if (p) {
      watched = Number(p.watched) || 0;
      duration = Number(p.duration) || 0;
      done = !!p.completed;
    }
    if (!watched) {
      // watch_progress is only what the videasy embed told THIS browser. The
      // continue-watching list is the site's own history and is restored from
      // /api/sync, so a title started on the phone resumes on the laptop.
      var hist = historyEntry(historyId(o.mode, o.tmdb, o.season, o.episode));
      if (hist) { watched = hist.progress || 0; duration = hist.runtime || 0; done = !!hist.completed; }
    }
    if (done) return 0;
    if (duration > 0 && watched >= duration * DONE_FRACTION) return 0; // finished → restart
    return watched >= MIN_RESUME_SEC ? Math.floor(watched) : 0;
  }

  // Newest matching entry across the two history stores (see detail.js, which
  // reads them the same way for its progress bars).
  function historyEntry(slug) {
    var best = null, finished = null;
    function scan(list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (e) {
        if (!e || (e.id || e.slug) !== slug) return;
        var when = Number(e.updatedAt || e.lastPlayedAt) || 0;
        var item = { progress: Number(e.progress) || 0, runtime: Number(e.runtime) || 0, completed: !!e.completed, _when: when };
        // Prefer an entry with a real position over a bare "completed" record
        // (a theatre viewing records completed-at-0:00 for the room).
        if (item.progress > 0) { if (!best || when >= best._when) best = item; }
        else if (item.completed && (!finished || when >= finished._when)) finished = item;
      });
    }
    try {
      scan(JSON.parse(localStorage.getItem("recently") || "[]"));
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CONTINUE_PREFIX + ":") === 0 && k !== CONTINUE_PREFIX + ":device-id") {
          scan(JSON.parse(localStorage.getItem(k) || "[]"));
        }
      }
    } catch (e) {}
    return best || finished;
  }

  // Videasy opens every title reporting `{watched:0,duration:0}` until playback
  // actually starts. Taking that at face value would erase whatever we already
  // knew about the title (previous session, or history pulled down by /api/sync)
  // and blank the detail-page progress bars, so a zero never overwrites a real
  // position — only a real position does.
  function betterProgress(current, incoming) {
    if (!incoming || typeof incoming !== "object") return current;
    var iw = Number(incoming.watched) || 0;
    var cw = current && Number(current.watched) || 0;
    if (iw <= 0 && cw > 0) return current;
    return incoming;
  }

  // Merge videasy's snapshot into ours. It only knows what THIS session played,
  // so a plain overwrite would wipe progress for other episodes/devices — merge
  // per title and per episode instead.
  function mergeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    var wp = readWatchProgress();
    var touched = false;
    Object.keys(snapshot).forEach(function (key) {
      var incoming = snapshot[key];
      if (!incoming || typeof incoming !== "object") return;
      var current = wp[key] || (incoming.id != null ? wp[String(incoming.id)] : null) || {};
      var merged = {};
      Object.keys(current).forEach(function (k) { merged[k] = current[k]; });
      Object.keys(incoming).forEach(function (k) { merged[k] = incoming[k]; });
      merged.progress = betterProgress(current.progress, incoming.progress) || merged.progress;
      var shows = {};
      if (current.show_progress) Object.keys(current.show_progress).forEach(function (k) { shows[k] = current.show_progress[k]; });
      if (incoming.show_progress) Object.keys(incoming.show_progress).forEach(function (k) {
        var was = shows[k], now = incoming.show_progress[k];
        if (was && now && was.progress) {
          var keep = betterProgress(was.progress, now.progress);
          if (keep === was.progress) { shows[k] = was; return; }
        }
        shows[k] = now;
      });
      if (Object.keys(shows).length) merged.show_progress = shows;
      wp[key] = merged;
      if (incoming.id != null) wp[String(incoming.id)] = merged; // legacy VidKing-style key
      touched = true;
    });
    if (touched) writeWatchProgress(wp);
  }

  // ------------------------------------------------- continue-watching store
  var historyModule = null, historyModulePending = null;
  function loadHistoryModule() {
    if (historyModule) return Promise.resolve(historyModule);
    if (historyModulePending) return historyModulePending;
    historyModulePending = import(HISTORY_MODULE).then(function (mod) {
      // exports: m = mergeHistoryEntries, c = mergeRecentlyWatched, j = readHistory
      if (mod && typeof mod.m === "function") { historyModule = mod; return mod; }
      return null;
    }).catch(function () { return null; });
    return historyModulePending;
  }

  // Fallback writer, used only if the bundle chunk is ever renamed/missing.
  function continueStorageKey() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CONTINUE_PREFIX + ":") === 0 && k !== CONTINUE_PREFIX + ":device-id") return k;
      }
      var info = window.__DEVICE__ || {};
      var base = [info.os, info.device].filter(Boolean).join("-") || "device";
      var id = localStorage.getItem(CONTINUE_PREFIX + ":device-id");
      if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem(CONTINUE_PREFIX + ":device-id", id); }
      return CONTINUE_PREFIX + ":" + base + "-" + id;
    } catch (e) { return CONTINUE_PREFIX + ":guest"; }
  }
  function fallbackMergeHistory(entry) {
    try {
      var key = continueStorageKey();
      var list = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (e) { return e && e.id !== entry.id; });
      if (entry.progress >= 30) list.unshift(entry);
      localStorage.setItem(key, JSON.stringify(list.slice(0, 25)));
      window.dispatchEvent(new CustomEvent("continuewatchingchange"));
    } catch (e) {}
  }

  function historyId(mode, tmdb, season, episode) {
    return mode === "tv"
      ? "tv:" + tmdb + ":" + (Number(season) || 1) + ":" + (Number(episode) || 1)
      : "movie:" + tmdb;
  }

  // ------------------------------------------------------------------ state
  var state = {
    mode: "movie", tmdb: "", season: 1, episode: 1,
    title: "", poster: "", backdrop: "", runtime: 0,
    watched: 0, duration: 0,
    lastSave: 0, onEpisodeChange: null, started: false
  };

  function currentProgress(entry) {
    if (!entry) return null;
    if (state.mode === "tv") {
      var sp = entry.show_progress && entry.show_progress[epKey(state.season, state.episode)];
      return sp ? sp.progress : null;
    }
    return entry.progress || null;
  }

  function playerHref() {
    try {
      var u = new URL(window.location.href);
      if (state.mode === "tv") {
        u.searchParams.set("season", String(state.season));
        u.searchParams.set("episode", String(state.episode));
      }
      if (state.watched > 0) u.searchParams.set("progress", String(Math.floor(state.watched)));
      else u.searchParams.delete("progress");
      return u.pathname + u.search;
    } catch (e) { return window.location.pathname + window.location.search; }
  }

  function persist(force) {
    var now = Date.now();
    if (!force && now - state.lastSave < SAVE_EVERY_MS) return;
    if (!state.tmdb || !(state.watched > 0)) return;
    state.lastSave = now;
    var completed = state.duration > 0 && state.watched >= state.duration * DONE_FRACTION;
    var href = playerHref();
    var entry = {
      id: historyId(state.mode, state.tmdb, state.season, state.episode),
      mode: state.mode, tmdb: String(state.tmdb),
      title: state.title || "",
      season: state.mode === "tv" ? Number(state.season) : null,
      episode: state.mode === "tv" ? Number(state.episode) : null,
      poster: state.poster || null, backdrop: state.backdrop || null,
      href: href,
      updatedAt: now,
      progress: completed ? 0 : Math.floor(state.watched),
      runtime: Math.floor(state.duration || state.runtime || 0) || null
    };
    var recent = {
      mode: state.mode, tmdb: String(state.tmdb), title: state.title || "",
      season: entry.season, episode: entry.episode,
      poster: entry.poster, backdrop: entry.backdrop, href: href,
      progress: entry.progress, completed: completed,
      runtime: entry.runtime, lastPlayedAt: now
    };
    loadHistoryModule().then(function (mod) {
      if (mod) {
        try { mod.m([entry]); } catch (e) { fallbackMergeHistory(entry); }
        if (typeof mod.c === "function") { try { mod.c([recent]); } catch (e) {} }
      } else {
        fallbackMergeHistory(entry);
      }
    });
    // Keep the address bar in step so a refresh (or a shared link) resumes.
    try { window.history.replaceState({}, "", href); } catch (e) {}
  }

  // --------------------------------------------------------------- messages
  // Only messages from the videasy player are trusted; everything below the
  // origin check is exposed as `tbbVideasy.ingest()` so a snapshot can be
  // replayed by hand when debugging (see MAINTENANCE.md §5).
  function handleMessage(event) {
    if (ORIGINS.indexOf(event.origin) < 0) return;
    var raw = event.data, payload;
    try { payload = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return; }
    if (!payload || typeof payload !== "object") return;
    if (payload.type && payload.type !== "MEDIA_DATA") return;
    var snapshot = payload.data != null ? payload.data : payload;
    if (typeof snapshot === "string") {
      try { snapshot = JSON.parse(snapshot); } catch (e) { return; }
    }
    ingest(snapshot);
  }

  function ingest(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;

    mergeSnapshot(snapshot);

    var entry = snapshot[state.mode + "-" + state.tmdb] || snapshot[String(state.tmdb)];
    if (!entry) {
      // videasy keys by its own media type; fall back to the first entry that
      // matches our tmdb id whatever the key looks like.
      Object.keys(snapshot).some(function (k) {
        var v = snapshot[k];
        if (v && String(v.id) === String(state.tmdb)) { entry = v; return true; }
        return false;
      });
    }
    if (!entry) return;

    if (!state.title && entry.title) state.title = entry.title;
    if (!state.poster && entry.poster) state.poster = entry.poster;
    if (!state.backdrop && entry.background) state.backdrop = entry.background;

    // Episode changes made INSIDE the videasy player (next-episode button,
    // autoplay-next, episode selector) arrive here as new last_*_watched values.
    if (state.mode === "tv") {
      var s = Number(entry.last_season_watched), e = Number(entry.last_episode_watched);
      if (Number.isFinite(s) && Number.isFinite(e) && s > 0 && e > 0 &&
          (s !== Number(state.season) || e !== Number(state.episode))) {
        persist(true);                 // flush the episode we just left
        state.season = s; state.episode = e;
        state.watched = 0; state.duration = 0;
        try { window.history.replaceState({}, "", playerHref()); } catch (_e) {}
        if (typeof state.onEpisodeChange === "function") {
          try { state.onEpisodeChange(s, e); } catch (_e2) {}
        }
      }
    }

    var p = currentProgress(entry);
    if (!p) return;
    var watched = Number(p.watched) || 0;
    var duration = Number(p.duration) || 0;
    if (duration > 0) state.duration = duration;
    if (watched > 0) state.watched = watched;
    if (theater.on) {
      // In a room the bundle owns history (a theatre viewing deliberately does
      // not resume from your solo progress) — we only translate the position.
      theaterOnProgress(watched);
      return;
    }
    persist(false);
  }

  // ------------------------------------------------------------ public API
  function buildUrl(o) {
    var path = o.mode === "tv"
      ? "/tv/" + encodeURIComponent(o.tmdb) + "/" + encodeURIComponent(o.season || 1) + "/" + encodeURIComponent(o.episode || 1)
      : "/movie/" + encodeURIComponent(o.tmdb);
    var qs = [];
    var color = (o.color || "").replace(/^#/, "");
    if (/^[0-9a-f]{3,8}$/i.test(color)) qs.push("color=" + color);
    var progress = Number(o.progress);
    if (!Number.isFinite(progress) || progress <= 0) progress = resumePosition(o);
    if (progress > 0) qs.push("progress=" + Math.floor(progress));
    if (o.mode === "tv") {
      // Videasy's own episode features — these are what put a "Next episode"
      // control at the end of an episode and roll on to the next one.
      qs.push("nextEpisode=true");
      qs.push("episodeSelector=true");
      qs.push("autoplayNextEpisode=true");
    }
    return BASE + path + (qs.length ? "?" + qs.join("&") : "");
  }

  function start(o) {
    state.mode = o.mode === "tv" ? "tv" : "movie";
    state.tmdb = String(o.tmdb || "");
    state.season = Number(o.season) || 1;
    state.episode = Number(o.episode) || 1;
    state.title = o.title || state.title;
    state.poster = o.poster || "";
    state.backdrop = o.backdrop || "";
    state.runtime = Number(o.runtime) || 0;
    state.onEpisodeChange = o.onEpisodeChange || null;
    if (state.started) return;
    state.started = true;
    window.addEventListener("message", handleMessage);
    // A tab close mid-episode would otherwise lose up to SAVE_EVERY_MS of it.
    window.addEventListener("pagehide", function () { persist(true); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") persist(true);
    });
    loadHistoryModule();
  }

  // ==========================================================================
  // Theater (watch-together)
  // ==========================================================================
  // Theater rooms keep running the compiled bundle player, because the whole
  // sync engine lives there (barrier commands, ready-acks, host publishing).
  // What died with VidKing is only the VIDEO: the bundle points #embedFrame at
  // the VidKing embed, which resolves nothing now.
  //
  // So we leave the bundle in charge and swap the video layer underneath it:
  //   • whatever URL the bundle puts on #embedFrame (it encodes tmdb / season /
  //     episode / progress) is mirrored onto a videasy iframe stacked on top,
  //     and the bundle's own frame is blanked so VidKing never loads;
  //   • the bundle talks to its embed with `PLAYER_COMMAND` postMessages — the
  //     blanked frame is same-origin (about:blank), so we replace its
  //     postMessage and translate those commands for videasy;
  //   • videasy's MEDIA_DATA stream is converted back into the `PLAYER_EVENT`
  //     messages the bundle expects, so the host still publishes its position
  //     and guests still acknowledge each command.
  //
  // Videasy has no play/pause/seek API for the parent page, so a command is
  // applied the only way a cross-origin player allows: seek/play remount the
  // iframe at the host's position, pause tears it down (that is what actually
  // stops the audio) behind a "paused by the host" card.
  var theater = {
    on: false, frame: null, layer: null, card: null,
    season: 1, episode: 1, lastSrc: "", paused: false,
    lastWatched: -1, lastChangeAt: 0, playing: false
  };

  function parseEmbedSrc(src) {
    // "/embed/tv/1399/1/1?progress=640" or "https://www.vidking.net/embed/movie/27205?..."
    var m = /\/embed\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/.exec(src || "");
    if (!m) return null;
    var qs = {};
    var q = src.indexOf("?");
    if (q >= 0) {
      new URLSearchParams(src.slice(q + 1)).forEach(function (v, k) { qs[k] = v; });
    }
    return {
      mode: m[1], tmdb: m[2],
      season: m[3] ? Number(m[3]) : 1,
      episode: m[4] ? Number(m[4]) : 1,
      progress: Number(qs.progress) || 0
    };
  }

  function theaterLayerHost() {
    return document.getElementById("embedWrap") || document.body;
  }

  function mountTheaterVideo(info) {
    var host = theaterLayerHost();
    hideTheaterCard();
    var url = BASE + (info.mode === "tv"
      ? "/tv/" + info.tmdb + "/" + info.season + "/" + info.episode
      : "/movie/" + info.tmdb);
    var qs = ["color=14ff9f"];
    if (info.progress > 0) qs.push("progress=" + Math.floor(info.progress));
    // No nextEpisode/autoplayNextEpisode here: in a room the host decides what
    // plays next, and a player that rolled on by itself would desync everyone.
    url += "?" + qs.join("&");
    if (!theater.layer || !theater.layer.parentNode) {
      var orphan = document.getElementById("tbbTheaterVideo"); // e.g. left by a re-mount
      while (orphan) { orphan.parentNode.removeChild(orphan); orphan = document.getElementById("tbbTheaterVideo"); }
      var f = document.createElement("iframe");
      f.id = "tbbTheaterVideo";
      f.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
      f.setAttribute("allowfullscreen", "true");
      f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;z-index:2";
      host.appendChild(f);
      theater.layer = f;
    }
    if (theater.layer.src !== url) theater.layer.src = url;
    theater.paused = false;
    theater.season = info.season; theater.episode = info.episode;
    // keep the shared state in step so currentProgress() reads the right episode
    state.season = info.season; state.episode = info.episode;
  }

  function unmountTheaterVideo(message) {
    if (theater.layer && theater.layer.parentNode) {
      theater.layer.parentNode.removeChild(theater.layer); // the only way to stop the audio
    }
    theater.layer = null;
    theater.paused = true;
    showTheaterCard(message || "Paused by the host");
  }

  function showTheaterCard(text) {
    var host = theaterLayerHost();
    if (!theater.card) {
      var d = document.createElement("div");
      d.id = "tbbTheaterCard";
      d.style.cssText = "position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;" +
        "background:#05080f;color:#e4ebff;font:600 1rem/1.4 system-ui,sans-serif;text-align:center;padding:24px";
      host.appendChild(d);
      theater.card = d;
    }
    theater.card.textContent = text;
    theater.card.style.display = "flex";
  }
  function hideTheaterCard() { if (theater.card) theater.card.style.display = "none"; }

  // The bundle's PLAYER_COMMANDs, translated for a cross-origin player.
  function applyTheaterCommand(msg) {
    var command = String(msg.command || "").toLowerCase();
    var at = msg.value != null ? msg.value : (msg.position != null ? msg.position : msg.seconds);
    var seconds = Number(at);
    var info = parseEmbedSrc(theater.lastSrc) || {
      mode: state.mode, tmdb: state.tmdb, season: theater.season, episode: theater.episode, progress: 0
    };
    if (Number.isFinite(seconds) && seconds >= 0) info.progress = seconds;
    if (command === "pause") { unmountTheaterVideo("Paused by the host"); return; }
    if (command === "play" || command === "resume" || command === "seek") {
      // A seek is a reload for us. mountTheaterVideo reuses the existing iframe
      // (assigning .src reloads it) and no-ops when the URL is unchanged, so a
      // repeated command doesn't restart buffering.
      mountTheaterVideo(info);
    }
  }

  function patchCommandChannel(frame) {
    try {
      var win = frame.contentWindow;
      if (!win || win.__tbbPatched) return;
      var original = win.postMessage.bind(win);
      win.postMessage = function (data) {
        try {
          var msg = typeof data === "string" ? JSON.parse(data) : data;
          if (msg && msg.type === "PLAYER_COMMAND") { applyTheaterCommand(msg); return; }
        } catch (e) {}
        return original.apply(null, arguments);
      };
      win.__tbbPatched = true;
    } catch (e) {}
  }

  // Rebuild the PLAYER_EVENT messages the bundle used to get from the VidKing
  // embed, so the room keeps working: the host publishes its position, guests
  // report ready against the current command.
  function emitPlayerEvent(eventName, seconds) {
    var payload = {
      type: "PLAYER_EVENT",
      data: {
        event: eventName,
        currentTime: Math.max(0, Math.floor(seconds || 0)),
        id: Number(state.tmdb) || state.tmdb,
        mediaType: state.mode,
        season: state.mode === "tv" ? Number(theater.season) : undefined,
        episode: state.mode === "tv" ? Number(theater.episode) : undefined
      }
    };
    try { window.postMessage(JSON.stringify(payload), window.location.origin); } catch (e) {}
  }

  function theaterOnProgress(watched) {
    var now = Date.now();
    if (watched !== theater.lastWatched) {
      var wasPlaying = theater.playing;
      theater.lastWatched = watched;
      theater.lastChangeAt = now;
      theater.playing = true;
      emitPlayerEvent(wasPlaying ? "timeupdate" : "play", watched);
    } else if (theater.playing && now - theater.lastChangeAt > 6000) {
      // videasy keeps re-sending the same position while paused — that stall is
      // the only pause signal a cross-origin player gives us.
      theater.playing = false;
      emitPlayerEvent("pause", watched);
    }
  }

  // Host or guest for this room, from the session the lobby stored.
  function theaterRole(inviteOrRoom) {
    try {
      var all = JSON.parse(localStorage.getItem("tbb:theater:v2") || "{}");
      var session = all[inviteOrRoom];
      if (!session) {
        session = Object.keys(all).map(function (k) { return all[k]; }).filter(function (s) {
          return s && (s.roomId === inviteOrRoom || s.inviteKey === inviteOrRoom || s.inviteToken === inviteOrRoom);
        })[0];
      }
      return (session && session.role) || "";
    } catch (e) { return ""; }
  }

  function startTheater(o) {
    if (theater.on) return;
    theater.on = true;
    state.mode = o.mode === "tv" ? "tv" : "movie";
    state.tmdb = String(o.tmdb || "");
    theater.season = Number(o.season) || 1;
    theater.episode = Number(o.episode) || 1;
    window.addEventListener("message", handleMessage);

    // The host is the one who starts the screening, so they need a player on
    // screen straight away — the room stays in `pendingStart` until playback
    // actually begins, and with VidKing dead nothing ever started it. Guests
    // wait for the host's first command instead of racing ahead.
    if (theaterRole(o.invite || o.roomId || "") === "host" && state.tmdb) {
      mountTheaterVideo({
        mode: state.mode, tmdb: state.tmdb,
        season: theater.season, episode: theater.episode,
        progress: Number(o.progress) || 0
      });
    }

    var poll = setInterval(function () {
      var frame = document.getElementById("embedFrame");
      if (!frame) return;
      theater.frame = frame;
      var src = frame.getAttribute("src") || "";
      if (src && src !== theater.lastSrc) {
        var info = parseEmbedSrc(src);
        theater.lastSrc = src;
        if (info) {
          state.mode = info.mode; state.tmdb = info.tmdb;
          mountTheaterVideo(info);
          frame.removeAttribute("src");   // keep VidKing from ever loading
        }
      }
      patchCommandChannel(frame);
      if (theater.playing) theaterOnProgress(theater.lastWatched);
    }, 700);
    theater.poll = poll;
    if (!theater.layer) showTheaterCard("Waiting for the host to start the theatre…");
  }

  window.tbbVideasy = {
    buildUrl: buildUrl,
    start: start,
    startTheater: startTheater,
    ingest: ingest,
    flush: function () { persist(true); },
    resumePosition: resumePosition,
    readWatchProgress: readWatchProgress,
    current: function () { return { season: state.season, episode: state.episode, watched: state.watched, duration: state.duration }; },
    ORIGINS: ORIGINS
  };
})();
