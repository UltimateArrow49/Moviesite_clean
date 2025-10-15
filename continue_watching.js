const STORAGE_KEY = "tbb:continue:v1";
const MAX_ENTRIES = 25;

function safeParse(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Unable to parse continue watching payload", error);
    return [];
  }
}

function safeRead() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to read continue watching data", error);
    return null;
  }
}

function safeWrite(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch (error) {
    console.warn("Unable to persist continue watching data", error);
  }
}

function normalizeEntry(entry = {}) {
  if (!entry || typeof entry !== "object") return null;
  const id = typeof entry.id === "string" && entry.id.trim();
  const tmdb = entry.tmdb != null ? String(entry.tmdb) : null;
  const mode = entry.mode === "tv" ? "tv" : entry.mode === "movie" ? "movie" : null;
  if (!id || !mode || !tmdb) return null;
  const normalized = {
    id,
    mode,
    tmdb,
    title: typeof entry.title === "string" ? entry.title : "",
    season:
      mode === "tv" && Number.isFinite(Number(entry.season))
        ? Number(entry.season)
        : mode === "tv"
        ? 1
        : null,
    episode:
      mode === "tv" && Number.isFinite(Number(entry.episode))
        ? Number(entry.episode)
        : mode === "tv"
        ? 1
        : null,
    poster: typeof entry.poster === "string" ? entry.poster : null,
    backdrop: typeof entry.backdrop === "string" ? entry.backdrop : null,
    href: typeof entry.href === "string" ? entry.href : null,
    updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : Date.now(),
    progress: Number.isFinite(Number(entry.progress)) ? Math.max(0, Math.floor(Number(entry.progress))) : 0,
    runtime: Number.isFinite(Number(entry.runtime)) ? Math.max(0, Math.floor(Number(entry.runtime))) : null,
  };
  if (normalized.runtime && normalized.progress >= normalized.runtime - 15) {
    normalized.progress = 0;
  }
  return normalized;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function loadEntries() {
  return safeParse(safeRead());
}

function writeEntries(entries, { silent = false } = {}) {
  safeWrite(JSON.stringify(entries));
  if (!silent) {
    window.dispatchEvent(new CustomEvent("continuewatchingchange"));
  }
}

export function historyId(mode, tmdb, season = null, episode = null) {
  if (!mode || !tmdb) return null;
  const normalizedMode = mode === "tv" ? "tv" : "movie";
  if (normalizedMode === "tv") {
    const s = Number.isFinite(Number(season)) ? Number(season) : 1;
    const e = Number.isFinite(Number(episode)) ? Number(episode) : 1;
    return `${normalizedMode}:${tmdb}:${s}:${e}`;
  }
  return `${normalizedMode}:${tmdb}`;
}

export function readHistory() {
  return sortEntries(loadEntries());
}

export function getEntriesByMode(mode) {
  const normalized = mode === "tv" ? "tv" : "movie";
  return readHistory().filter((entry) => entry.mode === normalized);
}

export function getEntryById(id) {
  if (!id) return null;
  const entries = loadEntries();
  return entries.find((entry) => entry && entry.id === id) || null;
}

export function upsertEntry(entry, { silent = false } = {}) {
  const normalized = normalizeEntry(entry);
  if (!normalized) return;
  const entries = loadEntries();
  const existingIndex = entries.findIndex((item) => item && item.id === normalized.id);

  if (normalized.progress < 30) {
    if (existingIndex >= 0) {
      entries.splice(existingIndex, 1);
      writeEntries(entries, { silent });
    }
    return;
  }
  if (existingIndex >= 0) {
    const existing = entries[existingIndex] || {};
    const merged = { ...existing, ...normalized, updatedAt: normalized.updatedAt };
    entries.splice(existingIndex, 1, merged);
  } else {
    entries.unshift(normalized);
  }
  while (entries.length > MAX_ENTRIES) {
    entries.pop();
  }
  writeEntries(entries, { silent });
}

export function removeEntry(id, { silent = false } = {}) {
  if (!id) return;
  const entries = loadEntries();
  const next = entries.filter((entry) => entry && entry.id !== id);
  if (next.length === entries.length) return;
  writeEntries(next, { silent });
}

export function clearEntries({ silent = false } = {}) {
  safeWrite(JSON.stringify([]));
  if (!silent) {
    window.dispatchEvent(new CustomEvent("continuewatchingchange"));
  }
}

export function onHistoryChange(callback) {
  if (typeof callback !== "function") return () => {};
  const handler = () => {
    try {
      callback(readHistory());
    } catch (error) {
      console.warn("Error handling continue watching update", error);
    }
  };
  window.addEventListener("continuewatchingchange", handler);
  const storageHandler = (event) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    handler();
  };
  window.addEventListener("storage", storageHandler);
  handler();
  return () => {
    window.removeEventListener("continuewatchingchange", handler);
    window.removeEventListener("storage", storageHandler);
  };
}

export { STORAGE_KEY };
