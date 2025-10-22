const STORAGE_KEY = "recently";
const MAX_RECENT = 60;
const EVENT_NAME = "recentlychange";

function safeParse(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Unable to parse recently watched payload", error);
    return [];
  }
}

function safeRead() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to read recently watched data", error);
    return null;
  }
}

function safeWrite(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch (error) {
    console.warn("Unable to write recently watched data", error);
  }
}

function dispatchChange() {
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch (error) {
    console.warn("Unable to dispatch recently watched event", error);
  }
}

function readEntries() {
  return safeParse(safeRead());
}

function writeEntries(entries) {
  safeWrite(JSON.stringify(entries));
  dispatchChange();
}

function buildSlug({ mode, tmdb, season, episode, slug }) {
  if (typeof slug === "string" && slug.trim()) {
    return slug.trim();
  }
  if (!tmdb) return null;
  const normalizedMode = mode === "tv" ? "tv" : "movie";
  if (normalizedMode === "movie") {
    return `movie:${tmdb}`;
  }
  const seasonPart = Number.isFinite(Number(season)) ? Number(season) : 1;
  const episodePart = Number.isFinite(Number(episode)) ? Number(episode) : 1;
  return `tv:${tmdb}:${seasonPart}:${episodePart}`;
}

function normalizeEntry(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  const tmdb = raw.tmdb != null ? String(raw.tmdb) : null;
  const mode = raw.mode === "tv" ? "tv" : raw.mode === "movie" ? "movie" : null;
  const slug = buildSlug({ mode, tmdb, season: raw.season, episode: raw.episode, slug: raw.slug });
  if (!slug || !mode || !tmdb) return null;
  const normalized = {
    slug,
    mode,
    tmdb,
    season: mode === "tv" && Number.isFinite(Number(raw.season)) ? Number(raw.season) : null,
    episode: mode === "tv" && Number.isFinite(Number(raw.episode)) ? Number(raw.episode) : null,
    title: typeof raw.title === "string" ? raw.title : "",
    poster: typeof raw.poster === "string" && raw.poster ? raw.poster : null,
    backdrop: typeof raw.backdrop === "string" && raw.backdrop ? raw.backdrop : null,
    href: typeof raw.href === "string" && raw.href ? raw.href : null,
    progress: Number.isFinite(Number(raw.progress)) ? Math.max(0, Math.floor(Number(raw.progress))) : 0,
    runtime: Number.isFinite(Number(raw.runtime)) ? Math.max(0, Math.floor(Number(raw.runtime))) : null,
    lastPlayedAt: Number.isFinite(Number(raw.lastPlayedAt)) ? Number(raw.lastPlayedAt) : Date.now(),
  };
  return normalized;
}

export function recordRecentlyWatched(raw) {
  const normalized = normalizeEntry(raw);
  if (!normalized) return;
  const entries = readEntries();
  const existingIndex = entries.findIndex((item) => item && item.slug === normalized.slug);
  if (existingIndex >= 0) {
    const existing = entries[existingIndex] || {};
    const merged = {
      ...existing,
      ...normalized,
      poster: normalized.poster || existing.poster || null,
      backdrop: normalized.backdrop || existing.backdrop || null,
      href: normalized.href || existing.href || null,
    };
    entries.splice(existingIndex, 1);
    entries.unshift(merged);
  } else {
    entries.unshift(normalized);
  }
  entries.sort((a, b) => (Number(b?.lastPlayedAt) || 0) - (Number(a?.lastPlayedAt) || 0));
  while (entries.length > MAX_RECENT) {
    entries.pop();
  }
  writeEntries(entries);
}

export function getRecentlyWatched() {
  const entries = readEntries();
  return entries
    .filter((entry) => entry && entry.slug)
    .sort((a, b) => (Number(b?.lastPlayedAt) || 0) - (Number(a?.lastPlayedAt) || 0));
}

export function getRecentlyWatchedByMode(mode, limit = Infinity) {
  const normalizedMode = mode === "tv" ? "tv" : "movie";
  const prefix = `${normalizedMode}:`;
  const entries = getRecentlyWatched().filter((entry) =>
    typeof entry?.slug === "string" && entry.slug.startsWith(prefix)
  );
  if (!Number.isFinite(limit) || limit <= 0) {
    return entries;
  }
  return entries.slice(0, Math.max(0, Math.floor(limit)));
}

export function clearRecentlyWatched() {
  safeWrite(JSON.stringify([]));
  dispatchChange();
}

export function onRecentlyChange(callback) {
  if (typeof callback !== "function") return () => {};
  const handler = () => {
    try {
      callback(getRecentlyWatched());
    } catch (error) {
      console.warn("Error handling recently watched update", error);
    }
  };
  window.addEventListener(EVENT_NAME, handler);
  const storageHandler = (event) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    handler();
  };
  window.addEventListener("storage", storageHandler);
  handler();
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", storageHandler);
  };
}

export function formatRelativeTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return "";
  const now = Date.now();
  let diff = now - value;
  if (!Number.isFinite(diff)) diff = 0;
  if (diff <= 45000) return "Just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
