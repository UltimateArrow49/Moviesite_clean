const STORAGE_KEY = "tbb:theater-history:v1";
const EVENT_NAME = "theaterhistorychange";
const MAX_ENTRIES = 60;

function safeParse(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Unable to parse theater history", error);
    return [];
  }
}

function readEntries() {
  try {
    return safeParse(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    console.warn("Unable to read theater history", error);
    return [];
  }
}

function writeEntries(entries) {
  const prepared = (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .sort((left, right) => Number(right?.lastPlayedAt || 0) - Number(left?.lastPlayedAt || 0))
    .slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prepared));
  } catch (error) {
    console.warn("Unable to persist theater history", error);
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
  return prepared;
}

function normalizeEntry(raw = {}) {
  if (!raw?.tmdb) return null;
  const mode = raw.mode === "tv" ? "tv" : raw.mode === "movie" ? "movie" : null;
  if (!mode) return null;
  const slug = mode === "tv"
    ? `tv:${raw.tmdb}:${Number(raw.season) || 1}:${Number(raw.episode) || 1}`
    : `movie:${raw.tmdb}`;
  return {
    slug,
    mode,
    tmdb: String(raw.tmdb),
    season: mode === "tv" ? Number(raw.season) || 1 : null,
    episode: mode === "tv" ? Number(raw.episode) || 1 : null,
    title: typeof raw.title === "string" ? raw.title : "",
    poster: typeof raw.poster === "string" ? raw.poster : null,
    backdrop: typeof raw.backdrop === "string" ? raw.backdrop : null,
    href: typeof raw.href === "string" ? raw.href : null,
    lastPlayedAt: Number.isFinite(Number(raw.lastPlayedAt)) ? Number(raw.lastPlayedAt) : Date.now(),
    progress: Number.isFinite(Number(raw.progress)) ? Math.max(0, Math.floor(Number(raw.progress))) : 0,
    completed: Boolean(raw.completed),
  };
}

export function recordTheaterWatch(raw) {
  const normalized = normalizeEntry(raw);
  if (!normalized) return;
  const entries = readEntries().filter((entry) => entry?.slug !== normalized.slug);
  entries.unshift(normalized);
  writeEntries(entries);
}

export function getTheaterHistory() {
  return readEntries();
}

export function getTheaterHistoryByMode(mode, limit = Infinity) {
  const normalizedMode = mode === "tv" ? "tv" : "movie";
  const entries = getTheaterHistory().filter((entry) => entry?.mode === normalizedMode);
  if (!Number.isFinite(limit) || limit <= 0) return entries;
  return entries.slice(0, Math.max(0, Math.floor(limit)));
}

export function onTheaterHistoryChange(callback) {
  if (typeof callback !== "function") return () => {};
  const handler = () => {
    try {
      callback(getTheaterHistory());
    } catch (error) {
      console.warn("Error handling theater history update", error);
    }
  };
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", handler);
  handler();
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", handler);
  };
}
