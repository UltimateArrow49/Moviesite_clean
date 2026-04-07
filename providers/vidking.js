const VIDKING_ORIGIN = "https://www.vidking.net";
const VIDEASY_ORIGIN = "https://player.videasy.net";
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
const VIDSRC_POLICIES = Object.freeze({
  allow: `${BASE_ALLOW}; accelerometer; gyroscope`,
  referrerPolicy: "origin-when-cross-origin",
  sandbox: false,
});
const VIDEASY_POLICIES = Object.freeze({
  allow: `${BASE_ALLOW}; accelerometer; gyroscope`,
  referrerPolicy: "strict-origin-when-cross-origin",
  sandbox: false,
});

const VIDKING_LOCATION = Object.freeze({
  region: "NA",
  country: "US",
  city: "Dallas",
  latitude: 32.7767,
  longitude: -96.797,
});

const VIDEASY_LOCATION = Object.freeze({
  region: "NA",
  country: "US",
  city: "Los Angeles",
  latitude: 34.0522,
  longitude: -118.2437,
});

const VIDSRC_EMBED_MIRRORS = Object.freeze([
  {
    origin: "https://vidsrc-embed.ru",
    id: "vidsrc-europe-1",
    label: "VidSrc Mirror · Europe #1",
    city: "Berlin",
    country: "DE",
    region: "EU",
    latitude: 52.52,
    longitude: 13.405,
    priority: 14,
  },
  {
    origin: "https://vidsrc-embed.su",
    id: "vidsrc-europe-2",
    label: "VidSrc Mirror · Europe #2",
    city: "Prague",
    country: "CZ",
    region: "EU",
    latitude: 50.0755,
    longitude: 14.4378,
    priority: 14,
  },
  {
    origin: "https://vidsrcme.ru",
    id: "vidsrc-europe-3",
    label: "VidSrc Mirror · Europe #3",
    city: "Vienna",
    country: "AT",
    region: "EU",
    latitude: 48.2082,
    longitude: 16.3738,
    priority: 14,
  },
  {
    origin: "https://vidsrcme.su",
    id: "vidsrc-europe-4",
    label: "VidSrc Mirror · Europe #4",
    city: "Warsaw",
    country: "PL",
    region: "EU",
    latitude: 52.2297,
    longitude: 21.0122,
    priority: 14,
  },
  {
    origin: "https://vidsrc-me.ru",
    id: "vidsrc-europe-5",
    label: "VidSrc Mirror · Europe #5",
    city: "Riga",
    country: "LV",
    region: "EU",
    latitude: 56.9496,
    longitude: 24.1052,
    priority: 14,
  },
  {
    origin: "https://vidsrc-me.su",
    id: "vidsrc-europe-6",
    label: "VidSrc Mirror · Europe #6",
    city: "Helsinki",
    country: "FI",
    region: "EU",
    latitude: 60.1699,
    longitude: 24.9384,
    priority: 14,
  },
  {
    origin: "https://vsrc.su",
    id: "vidsrc-europe-7",
    label: "VidSrc Mirror · Europe #7",
    city: "Bucharest",
    country: "RO",
    region: "EU",
    latitude: 44.4268,
    longitude: 26.1025,
    priority: 14,
  },
  {
    origin: "https://vidsrc.rip",
    id: "vidsrc-western-europe",
    label: "VidSrc Mirror · Western Europe",
    city: "Amsterdam",
    country: "NL",
    region: "EU",
    latitude: 52.3676,
    longitude: 4.9041,
    priority: 13,
  },
  {
    origin: "https://vidsrc.to",
    id: "vidsrc-global-1",
    label: "VidSrc Mirror · Global #1",
    city: "Singapore",
    country: "SG",
    region: "APAC",
    latitude: 1.3521,
    longitude: 103.8198,
    priority: 18,
  },
  {
    origin: "https://vidsrc.vip",
    id: "vidsrc-north-america",
    label: "VidSrc Mirror · North America",
    city: "New York",
    country: "US",
    region: "NA",
    latitude: 40.7128,
    longitude: -74.006,
    priority: 12,
  },
  {
    origin: "https://vidsrc.xyz",
    id: "vidsrc-us-east",
    label: "VidSrc Mirror · US East",
    city: "Atlanta",
    country: "US",
    region: "NA",
    latitude: 33.749,
    longitude: -84.388,
    priority: 11,
  },
  {
    origin: "https://vidsrc.ws",
    id: "vidsrc-oceania",
    label: "VidSrc Mirror · Oceania",
    city: "Sydney",
    country: "AU",
    region: "OC",
    latitude: -33.8688,
    longitude: 151.2093,
    priority: 18,
  },
  {
    origin: "https://vidsrc.stream",
    id: "vidsrc-us-west",
    label: "VidSrc Mirror · US West",
    city: "Los Angeles",
    country: "US",
    region: "NA",
    latitude: 34.0522,
    longitude: -118.2437,
    priority: 11,
  },
]);

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

function applyVidsrcOptions(url, options = {}) {
  const autoplay = coerceBoolean(options.autoplay ?? options.autoPlay);
  if (autoplay !== undefined) {
    url.searchParams.set("autoplay", autoplay ? "1" : "0");
  }
  return url.toString();
}

function buildVidsrcMovie(host, tmdbId, options) {
  if (!host || !tmdbId) return "";
  try {
    const url = new URL(`${host.replace(/\/$/, "")}/embed/movie`);
    if (/^tt[0-9]+$/i.test(String(tmdbId))) {
      url.searchParams.set("imdb", String(tmdbId));
    } else {
      url.searchParams.set("tmdb", String(tmdbId));
    }
    applyVidsrcOptions(url, options);
    return url.toString();
  } catch (error) {
    return "";
  }
}

function buildVidsrcTv(host, tmdbId, season, episode, options) {
  if (!host || !tmdbId) return "";
  try {
    const url = new URL(`${host.replace(/\/$/, "")}/embed/tv`);
    if (/^tt[0-9]+$/i.test(String(tmdbId))) {
      url.searchParams.set("imdb", String(tmdbId));
    } else {
      url.searchParams.set("tmdb", String(tmdbId));
    }
    const safeSeason = coercePositiveInteger(season) || 1;
    const safeEpisode = coercePositiveInteger(episode) || 1;
    url.searchParams.set("season", String(safeSeason));
    url.searchParams.set("episode", String(safeEpisode));
    applyVidsrcOptions(url, options);
    return url.toString();
  } catch (error) {
    return "";
  }
}

function applyVideasyOptions(url, options = {}) {
  const color = normalizeHexColor(options.color ?? options.colour);
  if (color) {
    url.searchParams.set("color", color);
  }
  const autoplay = coerceBoolean(options.autoplay ?? options.autoPlay);
  if (autoplay !== undefined) {
    url.searchParams.set("autoplay", autoplay ? "true" : "false");
  }
  if (coerceBoolean(options.nextEpisode ?? options.nextepisode)) {
    url.searchParams.set("nextEpisode", "true");
  }
  if (coerceBoolean(options.episodeSelector ?? options.episodeselector)) {
    url.searchParams.set("episodeSelector", "true");
  }
  if (coerceBoolean(options.autoplayNextEpisode ?? options.autoPlayNextEpisode)) {
    url.searchParams.set("autoplayNextEpisode", "true");
  }
  return url.toString();
}

function buildVideasyMovie(tmdbId, options) {
  if (!tmdbId) return "";
  try {
    const url = new URL(`${VIDEASY_ORIGIN}/movie/${encodeURIComponent(tmdbId)}`);
    applyVideasyOptions(url, options);
    return url.toString();
  } catch (error) {
    return "";
  }
}

function buildVideasyTv(tmdbId, season, episode, options) {
  if (!tmdbId) return "";
  try {
    const safeSeason = coercePositiveInteger(season) || 1;
    const safeEpisode = coercePositiveInteger(episode) || 1;
    const url = new URL(
      `${VIDEASY_ORIGIN}/tv/${encodeURIComponent(tmdbId)}/${safeSeason}/${safeEpisode}`,
    );
    applyVideasyOptions(url, options);
    return url.toString();
  } catch (error) {
    return "";
  }
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
    }));
}

export function movieServers(tmdbId, options = {}) {
  if (!tmdbId) return [];
  const normalizedId = String(tmdbId).trim();
  if (!normalizedId) return [];
  const servers = [];

  const vidkingUrl = buildVidkingMovie(normalizedId, options);
  if (vidkingUrl) {
    servers.push({
      id: "vidking-primary",
      label: "VidKing · Primary",
      origin: VIDKING_ORIGIN,
      src: vidkingUrl,
      policies: VIDKING_POLICIES,
      region: VIDKING_LOCATION.region,
      country: VIDKING_LOCATION.country,
      city: VIDKING_LOCATION.city,
      latitude: VIDKING_LOCATION.latitude,
      longitude: VIDKING_LOCATION.longitude,
      priority: 10,
    });
  }

  for (const mirror of VIDSRC_EMBED_MIRRORS) {
    const url = buildVidsrcMovie(mirror.origin, normalizedId, options);
    if (url) {
      servers.push({
        id: mirror.id,
        label: mirror.label,
        origin: mirror.origin,
        src: url,
        policies: VIDSRC_POLICIES,
        region: mirror.region,
        country: mirror.country,
        city: mirror.city,
        latitude: mirror.latitude,
        longitude: mirror.longitude,
        priority: mirror.priority,
      });
    }
  }

  const videasyUrl = buildVideasyMovie(normalizedId, options);
  if (videasyUrl) {
    servers.push({
      id: "videasy-player",
      label: "Videasy · Player",
      origin: VIDEASY_ORIGIN,
      src: videasyUrl,
      policies: VIDEASY_POLICIES,
      region: VIDEASY_LOCATION.region,
      country: VIDEASY_LOCATION.country,
      city: VIDEASY_LOCATION.city,
      latitude: VIDEASY_LOCATION.latitude,
      longitude: VIDEASY_LOCATION.longitude,
      priority: 25,
    });
  }

  return ensureServerObjects(servers);
}

export function tvServers(tmdbId, season, episode, options = {}) {
  if (!tmdbId) return [];
  const normalizedId = String(tmdbId).trim();
  if (!normalizedId) return [];
  const servers = [];

  const vidkingUrl = buildVidkingTv(normalizedId, season, episode, options);
  if (vidkingUrl) {
    servers.push({
      id: "vidking-primary",
      label: "VidKing · Primary",
      origin: VIDKING_ORIGIN,
      src: vidkingUrl,
      policies: VIDKING_POLICIES,
      region: VIDKING_LOCATION.region,
      country: VIDKING_LOCATION.country,
      city: VIDKING_LOCATION.city,
      latitude: VIDKING_LOCATION.latitude,
      longitude: VIDKING_LOCATION.longitude,
      priority: 10,
    });
  }

  for (const mirror of VIDSRC_EMBED_MIRRORS) {
    const url = buildVidsrcTv(mirror.origin, normalizedId, season, episode, options);
    if (url) {
      servers.push({
        id: `${mirror.id}-tv`,
        label: mirror.label,
        origin: mirror.origin,
        src: url,
        policies: VIDSRC_POLICIES,
        region: mirror.region,
        country: mirror.country,
        city: mirror.city,
        latitude: mirror.latitude,
        longitude: mirror.longitude,
        priority: mirror.priority,
      });
    }
  }

  const videasyUrl = buildVideasyTv(normalizedId, season, episode, options);
  if (videasyUrl) {
    servers.push({
      id: "videasy-player",
      label: "Videasy · Player",
      origin: VIDEASY_ORIGIN,
      src: videasyUrl,
      policies: VIDEASY_POLICIES,
      region: VIDEASY_LOCATION.region,
      country: VIDEASY_LOCATION.country,
      city: VIDEASY_LOCATION.city,
      latitude: VIDEASY_LOCATION.latitude,
      longitude: VIDEASY_LOCATION.longitude,
      priority: 25,
    });
  }

  return ensureServerObjects(servers);
}

export function movieEmbed(tmdbId, options = {}) {
  const [first] = movieServers(tmdbId, options);
  return first ? first.src : "";
}

export function tvEmbed(tmdbId, season, episode, options = {}) {
  const [first] = tvServers(tmdbId, season, episode, options);
  return first ? first.src : "";
}
