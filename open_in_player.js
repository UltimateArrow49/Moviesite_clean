/* open_in_player.js — per-movie resume + dedicated player navigation */
(function () {
  // -------- storage helpers (namespaced, robust parsing) ----------
  const LS_KEY = 'movie_progress_v3';
  const load = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); } catch { return {}; } };
  const save = (obj) => localStorage.setItem(LS_KEY, JSON.stringify(obj));

  // Build a unique key from the absolute pathname, e.g. /media/Foo.mp4
  function keyFor(src) {
    try { return 'movie:' + new URL(src, location.origin).pathname; }
    catch { return 'movie:' + String(src || '').replace(/^https?:\/\/[^/]+/,''); }
  }

  // Round duration to reduce flapping from metadata
  const durBucket = (d) => (isFinite(d) && d > 0) ? Math.round(d) : null;

  function maybeResume(video, src) {
    const map = load();
    const k = keyFor(src || video.currentSrc || video.src);
    const rec = map[k];
    const dur = durBucket(video.duration);
    if (!rec || !dur) return;

    // Only resume if duration matches (or is very close) and time is sensible
    const sameDur = Math.abs((rec.dur || 0) - dur) <= 2;
    const t = Number(rec.t || 0);
    const maxSeek = Math.max(0, (video.duration || 0) - 15);

    if (sameDur && t >= 15 && t < maxSeek) {
      try { video.currentTime = t; } catch {}
    }
  }

  function wireSaving(video, src) {
    const map = load();
    const k = keyFor(src || video.currentSrc || video.src);
    let lastWrite = 0;

    function write(force=false) {
      const now = Date.now();
      if (!force && now - lastWrite < 5000) return; // throttle to 5s
      lastWrite = now;

      const dur = durBucket(video.duration);
      const t = Math.floor(video.currentTime || 0);
      if (!dur || !isFinite(t)) return;

      // Don’t save if at/near the end
      if (video.duration && t >= video.duration - 10) {
        delete map[k];
        save(map);
        return;
      }

      map[k] = { t, dur, at: now };
      save(map);
    }

    video.addEventListener('timeupdate', () => write(false));
    video.addEventListener('seeked',     () => write(true));
    video.addEventListener('pause',      () => write(true));
    video.addEventListener('ended',      () => { delete map[k]; save(map); });
    window.addEventListener('beforeunload', () => write(true));
  }

  // -------- dedicated player page support (/player?src=...) ----------
  function getQS(name) { return new URLSearchParams(location.search).get(name); }
  function initPlayerFromQuery() {
    const v = document.getElementById('player') || document.querySelector('video');
    const src = getQS('src');
    const title = getQS('title') || '';

    if (!v || !src) return;

    // make it robust for landscape & controls
    v.setAttribute('playsinline', '');
    v.style.objectFit = 'contain';

    // Set source then resume when metadata is ready
    v.src = src;
    v.addEventListener('loadedmetadata', () => {
      maybeResume(v, src);
    }, { once: true });

    wireSaving(v, src);

    // Optional: try to lock landscape on mobile after play
    v.addEventListener('play', async () => {
      try {
        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock('landscape');
        }
      } catch {}
    });
    document.title = title ? `${title} — Player` : 'Player';
  }

  // -------- listing page: open tiles in new /player tab ----------
  function findGrid(){ return document.getElementById('grid') || document.querySelector('.grid,.movies,.list'); }
  function extractSrcFrom(card) {
    if (!card) return null;
    if (card.dataset && (card.dataset.src || card.dataset.path || card.dataset.file)) {
      return card.dataset.src || card.dataset.path || card.dataset.file;
    }
    const a = card.querySelector('a[href*="/media/"]');
    return a ? a.getAttribute('href') : null;
  }
  function extractTitleFrom(card) {
    return (card.getAttribute && card.getAttribute('data-title')) ||
           (card.querySelector && (card.querySelector('[data-title]')?.dataset.title ||
                                   card.querySelector('.title, h3, h4')?.textContent?.trim())) ||
           '';
  }
  function wireListingOpener() {
    const grid = findGrid();
    if (!grid) return;
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-src],[data-path],[data-file],a[href*="/media/"],.card,.tile,.movie');
      if (!card) return;
      const src = extractSrcFrom(card);
      if (!src) return;
      const title = encodeURIComponent(extractTitleFrom(card));
      e.preventDefault?.();
      window.open(`/player?src=${encodeURIComponent(src)}&title=${title}`, '_blank', 'noopener,noreferrer');
    }, { passive: false });
  }

  // Expose init for the player page and set up listing handler by default
  window.Player = { initFromQuery: initPlayerFromQuery };
  wireListingOpener();
})();
