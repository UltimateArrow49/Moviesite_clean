const VIDKING_ORIGIN = "https://www.vidking.net";
const BASE_ALLOW = "autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write";
const DEFAULT_SANDBOX_TOKENS = Object.freeze([
  "allow-scripts",
  "allow-same-origin",
  "allow-forms",
  "allow-pointer-lock",
  "allow-orientation-lock",
  "allow-top-navigation-by-user-activation",
]);
const VIDKING_POLICIES = Object.freeze({
  allow: BASE_ALLOW,
  referrerPolicy: "no-referrer",
  sandbox: DEFAULT_SANDBOX_TOKENS,
});
const THEATER_CAPABLE = Object.freeze({
  theaterEligible: true,
  theaterControl: "controlled",
});
const THEATER_INELIGIBLE = Object.freeze({
  theaterEligible: false,
  theaterControl: "unsupported",
});

const VIDKING_LOCATION = Object.freeze({
  region: "NA",
  country: "US",
  city: "Dallas",
  latitude: 32.7767,
  longitude: -96.797,
});

function coerceBoolean(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return undefined;
  }
  return undefined;
}

function normalizeHexColor(value) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{3,8}$/i.test(cleaned) ? cleaned : "";
}

function coercePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const clamped = Math.floor(number);
  return clamped >= 0 ? clamped : null;
}

function applyVidkingOptions(url, options = {}) {
  const params = url.searchParams;
  const color = normalizeHexColor(options.color ?? options.colour);
  if (color) {
    params.set("color", color);
  }
  const autoplay = coerceBoolean(options.autoplay ?? options.autoPlay);
  if (autoplay !== undefined) {
    const value = autoplay ? "true" : "false";
    params.set("autoplay", value);
    params.set("autoPlay", value);
  }
  const progress = coercePositiveInteger(options.progress);
  if (progress) {
    params.set("progress", String(progress));
  }
  return url.toString();
}

function buildVidkingMovie(tmdbId, options) {
  if (!tmdbId) return "";
  const url = new URL(`${VIDKING_ORIGIN}/embed/movie/${encodeURIComponent(tmdbId)}`);
  return applyVidkingOptions(url, options);
}

function buildVidkingTv(tmdbId, season, episode, options) {
  if (!tmdbId) return "";
  const seasonSegment = season == null ? "1" : String(season);
  const episodeSegment = episode == null ? "1" : String(episode);
  const base = `${VIDKING_ORIGIN}/embed/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(
    seasonSegment,
  )}/${encodeURIComponent(episodeSegment)}`;
  const url = new URL(base);
  return applyVidkingOptions(url, options);
}

function clonePolicies(policies) {
  if (!policies || typeof policies !== "object") return null;
  const clone = {};
  if (typeof policies.allow === "string") {
    clone.allow = policies.allow;
  }
  if (policies.referrerPolicy === null) {
    clone.referrerPolicy = null;
  } else if (typeof policies.referrerPolicy === "string") {
    clone.referrerPolicy = policies.referrerPolicy;
  }
  if (policies.sandbox === null || policies.sandbox === false) {
    clone.sandbox = [];
  } else if (Array.isArray(policies.sandbox)) {
    clone.sandbox = policies.sandbox.map((token) => String(token).trim()).filter(Boolean);
  } else if (typeof policies.sandbox === "string") {
    clone.sandbox = policies.sandbox;
  }
  return Object.keys(clone).length ? clone : null;
}

function ensureServerObjects(candidates = []) {
  return candidates
    .filter((server) => server && server.src)
    .map((server) => ({
      id: server.id || server.label || server.origin || server.src,
      label: server.label || "Stream server",
      origin: server.origin || null,
      src: server.src,
      policies: clonePolicies(server.policies),
      region: typeof server.region === "string" ? server.region : null,
      country: typeof server.country === "string" ? server.country : null,
      city: typeof server.city === "string" ? server.city : null,
      latitude: Number.isFinite(server.latitude) ? Number(server.latitude) : null,
      longitude: Number.isFinite(server.longitude) ? Number(server.longitude) : null,
      priority: Number.isFinite(server.priority) ? Number(server.priority) : null,
      capabilities:
        server.capabilities && typeof server.capabilities === "object"
          ? {
              theaterEligible: server.capabilities.theaterEligible === true,
              theaterControl:
                typeof server.capabilities.theaterControl === "string"
                  ? server.capabilities.theaterControl
                  : null,
            }
          : { ...THEATER_INELIGIBLE },
    }));
}

export function movieServers(tmdbId, options = {}) {
  if (!tmdbId) return [];
  const normalizedId = String(tmdbId).trim();
  if (!normalizedId) return [];

  const vidkingUrl = buildVidkingMovie(normalizedId, options);
  if (!vidkingUrl) return [];

  return ensureServerObjects([
    {
      id: "vidking-primary",
      label: "VidKing",
      origin: VIDKING_ORIGIN,
      src: vidkingUrl,
      policies: VIDKING_POLICIES,
      capabilities: THEATER_CAPABLE,
      region: VIDKING_LOCATION.region,
      country: VIDKING_LOCATION.country,
      city: VIDKING_LOCATION.city,
      latitude: VIDKING_LOCATION.latitude,
      longitude: VIDKING_LOCATION.longitude,
      priority: 10,
    },
  ]);
}

export function tvServers(tmdbId, season, episode, options = {}) {
  if (!tmdbId) return [];
  const normalizedId = String(tmdbId).trim();
  if (!normalizedId) return [];

  const vidkingUrl = buildVidkingTv(normalizedId, season, episode, options);
  if (!vidkingUrl) return [];

  return ensureServerObjects([
    {
      id: "vidking-primary",
      label: "VidKing",
      origin: VIDKING_ORIGIN,
      src: vidkingUrl,
      policies: VIDKING_POLICIES,
      capabilities: THEATER_CAPABLE,
      region: VIDKING_LOCATION.region,
      country: VIDKING_LOCATION.country,
      city: VIDKING_LOCATION.city,
      latitude: VIDKING_LOCATION.latitude,
      longitude: VIDKING_LOCATION.longitude,
      priority: 10,
    },
  ]);
}

export function movieEmbed(tmdbId, options = {}) {
  const [first] = movieServers(tmdbId, options);
  return first ? first.src : "";
}

export function tvEmbed(tmdbId, season, episode, options = {}) {
  const [first] = tvServers(tmdbId, season, episode, options);
  return first ? first.src : "";
}
