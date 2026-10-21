import detection from "./device.js";

const STORAGE_ROOT_KEY = "tbb:continue:v1";
const MAX_ENTRIES = 25;
const LEGACY_NAMESPACES = ["guest", "device"];
const DEVICE_ID_STORAGE_KEY = `${STORAGE_ROOT_KEY}:device-id`;

function resolveDeviceNamespace() {
  const fallback = LEGACY_NAMESPACES[0];
  try {
    const fingerprint = [];
    const info = detection || window.__DEVICE__ || {};
    if (info.os) fingerprint.push(String(info.os));
    if (info.device) fingerprint.push(String(info.device));
    const base = fingerprint.length ? fingerprint.join("-") : "device";
    const storedId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    let identifier = typeof storedId === "string" && storedId.trim() ? storedId.trim() : "";
    if (!identifier) {
      identifier = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, identifier);
    }
    return `${base}-${identifier}`;
  } catch (error) {
    console.warn("Unable to resolve device namespace", error);
    return fallback;
  }
}

let activeNamespace = resolveDeviceNamespace();

function buildStorageKey(namespace = activeNamespace) {
  return `${STORAGE_ROOT_KEY}:${namespace}`;
}

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

function safeReadRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn("Unable to read continue watching data", error);
    return null;
  }
}

function safeWriteRaw(key, payload) {
  try {
    localStorage.setItem(key, payload);
  } catch (error) {
    console.warn("Unable to persist continue watching data", error);
  }
}

function safeRead() {
  const key = buildStorageKey();
  let payload = safeReadRaw(key);
  if (payload == null) {
    for (const legacy of LEGACY_NAMESPACES) {
      if (!legacy) continue;
      const legacyKey = buildStorageKey(legacy);
      if (legacyKey === key) continue;
      const legacyPayload = safeReadRaw(legacyKey);
      if (legacyPayload != null) {
        safeWriteRaw(key, legacyPayload);
        payload = legacyPayload;
        break;
      }
    }
  }
  if (payload == null && key !== STORAGE_ROOT_KEY) {
    const legacy = safeReadRaw(STORAGE_ROOT_KEY);
    if (legacy != null) {
      safeWriteRaw(key, legacy);
      try {
        localStorage.removeItem(STORAGE_ROOT_KEY);
      } catch (error) {
        console.warn("Unable to remove legacy continue watching data", error);
      }
      payload = legacy;
    }
  }
  return payload;
}

function safeWrite(payload) {
  safeWriteRaw(buildStorageKey(), payload);
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
  if (normalized.progress < 30) {
    return null;
  }
  return normalized;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function prepareEntries(entries = []) {
  const deduped = new Map();
  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    const normalized = normalizeEntry(rawEntry);
    if (!normalized) continue;
    const existing = deduped.get(normalized.id);
    if (!existing || normalized.updatedAt >= existing.updatedAt) {
      deduped.set(normalized.id, normalized);
    }
  }
  return sortEntries([...deduped.values()]).slice(0, MAX_ENTRIES);
}

function loadEntries() {
  return prepareEntries(safeParse(safeRead()));
}

function writeEntries(entries, { silent = false } = {}) {
  const prepared = prepareEntries(entries);
  safeWrite(JSON.stringify(prepared));
  if (!silent) {
    window.dispatchEvent(new CustomEvent("continuewatchingchange"));
  }
  return prepared;
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

export function readStoredHistory() {
  return loadEntries();
}

export function readHistory() {
  return readStoredHistory();
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

export function replaceHistoryEntries(entries, { silent = false } = {}) {
  return writeEntries(entries, { silent });
}

export function mergeHistoryEntries(entries, { silent = false } = {}) {
  const currentEntries = loadEntries();
  return writeEntries([...currentEntries, ...(Array.isArray(entries) ? entries : [])], { silent });
}

export function upsertEntry(entry, { silent = false } = {}) {
  const normalized = normalizeEntry(entry);
  const entries = loadEntries();
  const entryId = normalized?.id || historyId(entry?.mode, entry?.tmdb, entry?.season, entry?.episode);
  const existingIndex = entryId
    ? entries.findIndex((item) => item && item.id === entryId)
    : -1;

  if (!normalized) {
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
  writeEntries([], { silent });
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
    if (event.key && !event.key.startsWith(STORAGE_ROOT_KEY)) return;
    handler();
  };
  window.addEventListener("storage", storageHandler);
  handler();
  return () => {
    window.removeEventListener("continuewatchingchange", handler);
    window.removeEventListener("storage", storageHandler);
  };
}

export const STORAGE_KEY = STORAGE_ROOT_KEY;
