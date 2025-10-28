const VIDKING_ORIGIN = "https://www.vidking.net";
const VIDKING_API_ORIGIN = "https://api.videasy.net";
const VIDKING_WASM_URL = `${VIDKING_ORIGIN}/assets/wasm/module1.wasm`;
const VIDKING_METADATA_ORIGIN = "https://jumpfreedom.com/3";
const CRYPTO_JS_URL = "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js";
const HASHIDS_URL = "https://cdnjs.cloudflare.com/ajax/libs/hashids/2.2.10/hashids.min.js";
const HASHIDS_MASK = "8c465aa8af6cbfd4c1f91bf0c8d678ba";
const KEY_SUFFIX = "d486ae1ce6fdbe63b60bd1704541fcf0";

const SERVER_DEFINITIONS = [
  { name: "Oxygen", endpoint: "myflixerzupcloud/sources-with-title", isActive: true },
  { name: "Hydrogen", endpoint: "cdn/sources-with-title", isActive: true },
  { name: "Lithium", endpoint: "moviebox/sources-with-title", isActive: true },
  { name: "Helium", endpoint: "1movies/sources-with-title", isActive: true },
];

const SERVER_ORDER = SERVER_DEFINITIONS.map((definition) => definition.name);

const scriptPromises = new Map();
const metadataCache = new Map();
const downloadCache = new Map();
let wasmRuntimePromise = null;

function coerceBoolean(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    return undefined;
  }
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

function applyOptions(url, options = {}) {
  const params = url.searchParams;
  const color = options.color ?? options.colour;
  if (color) params.set("color", String(color).replace(/^#/, ""));

  const setFlag = (names, value) => {
    for (const name of names) {
      params.set(name, value);
    }
  };

  const autoplayOption = coerceBoolean(options.autoplay ?? options.autoPlay);
  if (autoplayOption !== undefined) {
    const flag = autoplayOption ? "true" : "false";
    setFlag(["autoplay", "autoPlay"], flag);
  }

  const controlsOption = coerceBoolean(options.controls ?? options.showControls);
  if (controlsOption !== undefined) {
    const flag = controlsOption ? "true" : "false";
    setFlag(["controls", "showControls", "showcontrols"], flag);
  }

  const mutedOption = coerceBoolean(options.muted ?? options.mute);
  if (mutedOption !== undefined) {
    const flag = mutedOption ? "true" : "false";
    setFlag(["muted", "mute"], flag);
  }

  if (coerceBoolean(options.nextEpisode ?? options.nextepisode)) {
    setFlag(["nextepisode", "nextEpisode"], "true");
  }

  if (coerceBoolean(options.episodeSelector ?? options.episodeselector)) {
    setFlag(["episodeselector", "episodeSelector"], "true");
  }

  const idleCheck = options.idleCheck ?? options.idlecheck;
  if (idleCheck !== undefined && idleCheck !== null) {
    const numeric = Number(idleCheck);
    if (Number.isFinite(numeric) && numeric >= 0) {
      const clamped = Math.max(0, Math.floor(numeric));
      setFlag(["idlecheck", "idleCheck"], String(clamped));
    }
  }

  if (typeof options.progress === "number" && Number.isFinite(options.progress)) {
    const clamped = Math.max(0, Math.floor(options.progress));
    if (clamped > 0) params.set("progress", String(clamped));
  }

  return url.toString();
}

export function movieEmbed(tmdbId, options = {}) {
  if (!tmdbId) return "";
  const base = `${VIDKING_ORIGIN}/embed/movie/${encodeURIComponent(tmdbId)}`;
  const url = new URL(base);
  return applyOptions(url, options);
}

export function tvEmbed(tmdbId, season, episode, options = {}) {
  if (!tmdbId) return "";
  const seasonSegment = season == null ? "1" : String(season);
  const episodeSegment = episode == null ? "1" : String(episode);
  const base = `${VIDKING_ORIGIN}/embed/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(
    seasonSegment,
  )}/${encodeURIComponent(episodeSegment)}`;
  const url = new URL(base);
  return applyOptions(url, options);
}

async function loadScriptOnce(url) {
  if (!scriptPromises.has(url)) {
    const promise = new Promise((resolve, reject) => {
      if (typeof document === "undefined") {
        reject(new Error(`Cannot load script outside the browser context: ${url}`));
        return;
      }

      const existing = Array.from(document.querySelectorAll("script")).find(
        (script) => script.src === url,
      );
      if (existing) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
      document.head.appendChild(script);
    });
    scriptPromises.set(url, promise);
  }
  return scriptPromises.get(url);
}

async function ensureCryptoLibraries() {
  if (typeof window === "undefined") {
    throw new Error("Crypto libraries can only be loaded in the browser");
  }
  await loadScriptOnce(CRYPTO_JS_URL);
  await loadScriptOnce(HASHIDS_URL);
  const { CryptoJS, Hashids } = window;
  if (!CryptoJS || !Hashids) {
    throw new Error("Unable to initialise CryptoJS or Hashids");
  }
  return { CryptoJS, Hashids };
}

async function waitForHash() {
  if (typeof window === "undefined") return;
  if (window.hash) return;
  await new Promise((resolve) => {
    const poll = () => {
      if (window.hash) {
        resolve();
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function compileWasmModule() {
  const fetchOptions = { cache: "no-store" };
  if (WebAssembly.compileStreaming) {
    const response = await fetch(VIDKING_WASM_URL, fetchOptions);
    if (!response.ok) {
      throw new Error(`Failed to fetch Vidking WASM module: ${response.status}`);
    }
    return WebAssembly.compileStreaming(response);
  }
  const response = await fetch(VIDKING_WASM_URL, fetchOptions);
  if (!response.ok) {
    throw new Error(`Failed to fetch Vidking WASM module: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return WebAssembly.compile(buffer);
}

async function instantiateWasmRuntime() {
  const compiled = await compileWasmModule();
  const globalScope =
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {};
  const envBase = Object.assign(Object.create(globalScope), {
    seed() {
      return Date.now() * Math.random();
    },
    abort(messagePtr, filePtr, line, column) {
      const message = decodeString(messagePtr >>> 0);
      const file = decodeString(filePtr >>> 0);
      throw new Error(`${message} in ${file}:${line >>> 0}:${column >>> 0}`);
    },
  });

  let memory;
  let exports;

  function decodeString(ptr) {
    if (!ptr) return null;
    const memoryView32 = new Uint32Array(memory.buffer);
    const byteLength = memoryView32[(ptr - 4) >>> 2];
    const start = ptr >>> 1;
    const end = (ptr + byteLength) >>> 1;
    const memoryView16 = new Uint16Array(memory.buffer);
    let result = "";
    for (let offset = start; offset < end; offset += 1024) {
      const slice = memoryView16.subarray(offset, Math.min(end, offset + 1024));
      result += String.fromCharCode(...slice);
    }
    return result;
  }

  function encodeString(value) {
    if (value == null) return 0;
    const str = String(value);
    const length = str.length;
    const ptr = exports.__new((length << 1) >>> 0, 2) >>> 0;
    const memoryView16 = new Uint16Array(memory.buffer);
    let offset = ptr >>> 1;
    for (let index = 0; index < length; index += 1) {
      memoryView16[offset + index] = str.charCodeAt(index);
    }
    return ptr;
  }

  function toPointer(value) {
    if (value == null) return 0;
    return encodeString(value);
  }

  const { instance } = await WebAssembly.instantiate(compiled, { env: envBase });
  exports = instance.exports;
  memory = exports.memory || envBase.memory;

  return {
    serve() {
      return decodeString(exports.serve() >>> 0) || "";
    },
    verify(value) {
      return exports.verify(toPointer(value)) !== 0;
    },
    decrypt(value, key) {
      return decodeString(exports.decrypt(toPointer(value), key) >>> 0) || "";
    },
  };
}

async function ensureWasmRuntime() {
  if (!wasmRuntimePromise) {
    wasmRuntimePromise = (async () => {
      const runtime = await instantiateWasmRuntime();
      const bootstrapScript = runtime.serve();
      if (bootstrapScript) {
        // eslint-disable-next-line no-new-func
        new Function(bootstrapScript)();
        await waitForHash();
        if (typeof window !== "undefined") {
          runtime.verify(window.hash);
        }
      }
      return runtime;
    })().catch((error) => {
      wasmRuntimePromise = null;
      throw error;
    });
  }
  return wasmRuntimePromise;
}

async function generateKey(tmdbId) {
  const numericId = Number.parseInt(tmdbId, 10);
  if (!Number.isFinite(numericId)) {
    throw new Error(`Invalid TMDB id: ${tmdbId}`);
  }
  const seed = `${numericId}${KEY_SUFFIX}`;
  const { Hashids } = await ensureCryptoLibraries();
  const toCodes = (value) => Array.from(value).map((char) => char.charCodeAt(0));
  const maskCodes = toCodes(HASHIDS_MASK);
  const xorValues = Array.from(seed)
    .map((char) => toCodes(char))
    .map((codes) => codes.map((code, index) => code ^ maskCodes[index % maskCodes.length]))
    .flat()
    .map((code) => `0${Number(code).toString(16)}`.slice(-2))
    .join("");
  const hashids = new Hashids();
  if (typeof hashids.encodeHex === "function") {
    return hashids.encodeHex(xorValues);
  }
  return hashids.encode(xorValues);
}

function parseYear(value) {
  if (!value) return "";
  const year = Number.parseInt(String(value).slice(0, 4), 10);
  return Number.isFinite(year) ? String(year) : "";
}

async function fetchMetadata(mediaType, tmdbId) {
  const cacheKey = `${mediaType}:${tmdbId}`;
  if (!metadataCache.has(cacheKey)) {
    const promise = (async () => {
      const url = `${VIDKING_METADATA_ORIGIN}/${mediaType}/${tmdbId}?append_to_response=external_ids`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`TMDB metadata request failed: ${response.status}`);
      }
      const data = await response.json();
      let title = "";
      let year = "";
      if (mediaType === "movie") {
        title = data.title || data.original_title || "";
        year = parseYear(data.release_date);
      } else {
        title = data.name || data.original_name || "";
        year = parseYear(data.first_air_date);
      }
      const imdbId = data.external_ids?.imdb_id || "";
      return { title, year, imdbId };
    })().catch((error) => {
      metadataCache.delete(cacheKey);
      throw error;
    });
    metadataCache.set(cacheKey, promise);
  }
  return metadataCache.get(cacheKey);
}

function resolveServerDefinition(name) {
  return SERVER_DEFINITIONS.find((definition) => definition.name.toLowerCase() === name.toLowerCase());
}

async function fetchEncryptedSources(serverName, params) {
  const definition = resolveServerDefinition(serverName);
  if (!definition || definition.isActive === false) {
    throw new Error(`Vidking server "${serverName}" is not available`);
  }
  const url = new URL(`${VIDKING_API_ORIGIN}/${definition.endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url.toString(), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Encrypted source request failed (${serverName}): ${response.status}`);
  }
  return response.text();
}

async function decryptSourcesPayload(encryptedPayload, tmdbId) {
  if (!encryptedPayload) return null;
  const runtime = await ensureWasmRuntime();
  const numericId = Number.parseInt(tmdbId, 10);
  if (!Number.isFinite(numericId)) {
    throw new Error(`Invalid TMDB id: ${tmdbId}`);
  }
  const decrypted = runtime.decrypt(encryptedPayload, numericId);
  if (!decrypted) return null;
  const { CryptoJS } = await ensureCryptoLibraries();
  const key = await generateKey(numericId);
  const json = CryptoJS.AES.decrypt(decrypted, key).toString(CryptoJS.enc.Utf8);
  if (!json) return null;
  return JSON.parse(json);
}

function qualityScore(quality) {
  const match = /([0-9]{3,4})p/i.exec(String(quality || ""));
  return match ? Number.parseInt(match[1], 10) : 0;
}

function isDirectMp4(url) {
  if (!url) return false;
  const normalized = String(url).toLowerCase();
  if (normalized.includes(".mp4") || normalized.includes("video/mp4")) {
    return true;
  }
  const indicators = ["/mp4/", "mp4download", "mp4direct", "directmp4", "mp4stream", "mp4video", "mp4link"];
  return indicators.some((indicator) => normalized.includes(indicator));
}

function selectBestSource(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return null;
  }
  const normalized = sources.filter((source) => source && typeof source.url === "string");
  if (!normalized.length) return null;
  const directOnly = normalized.filter((source) => isDirectMp4(source.url));
  const pool = directOnly.length ? directOnly : normalized;
  const sorted = pool.slice().sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality));
  return sorted[0] || null;
}

async function fetchDownloadFromServer({
  serverName,
  mediaType,
  tmdbId,
  season,
  episode,
  metadata,
  timestamp,
}) {
  const encrypted = await fetchEncryptedSources(serverName, {
    mediaType,
    tmdbId,
    seasonId: mediaType === "tv" ? season ?? 1 : 1,
    episodeId: mediaType === "tv" ? episode ?? 1 : 1,
    title: metadata.title || "",
    year: metadata.year || "",
    imdbId: metadata.imdbId || "",
    _t: timestamp,
  });
  const payload = await decryptSourcesPayload(encrypted, tmdbId);
  if (!payload || !Array.isArray(payload.sources) || payload.sources.length === 0) {
    return null;
  }
  return payload.sources;
}

async function resolveDirectDownloadLink({ mediaType, tmdbId, season, episode }) {
  const metadata = await fetchMetadata(mediaType, tmdbId);
  const timestamp = Date.now().toString();
  for (const serverName of SERVER_ORDER) {
    try {
      const sources = await fetchDownloadFromServer({
        serverName,
        mediaType,
        tmdbId,
        season,
        episode,
        metadata,
        timestamp,
      });
      const chosen = selectBestSource(sources);
      if (chosen?.url) {
        return chosen.url;
      }
    } catch (error) {
      console.warn(`[vidking] Unable to fetch download from ${serverName}:`, error);
    }
  }
  return "";
}

function buildDownloadCacheKey(mediaType, tmdbId, season, episode) {
  const parts = [mediaType, tmdbId];
  if (mediaType === "tv") {
    parts.push(season ?? "1", episode ?? "1");
  }
  return parts.join(":");
}

async function resolveDownloadLink({ mediaType, tmdbId, season, episode }) {
  const cacheKey = buildDownloadCacheKey(mediaType, tmdbId, season, episode);
  if (!downloadCache.has(cacheKey)) {
    const promise = (async () => {
      const direct = await resolveDirectDownloadLink({ mediaType, tmdbId, season, episode });
      return direct || "";
    })().catch((error) => {
      console.error(`[vidking] Failed to resolve download link for ${cacheKey}:`, error);
      return "";
    });
    downloadCache.set(cacheKey, promise);
  }
  return downloadCache.get(cacheKey);
}

export async function movieDownload(tmdbId) {
  if (!tmdbId) return "";
  return resolveDownloadLink({ mediaType: "movie", tmdbId });
}

export async function tvDownload(tmdbId, season, episode) {
  if (!tmdbId) return "";
  return resolveDownloadLink({ mediaType: "tv", tmdbId, season, episode });
}
