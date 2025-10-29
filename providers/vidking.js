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

const VIDSRC_EMBED_HOSTS = [
  "https://vidsrc-embed.ru",
  "https://vidsrc-embed.su",
  "https://vidsrcme.ru",
  "https://vidsrcme.su",
  "https://vidsrc-me.ru",
  "https://vidsrc-me.su",
  "https://vsrc.su",
  "https://vidsrc.rip",
  "https://vidsrc.to",
  "https://vidsrc.vip",
  "https://vidsrc.xyz",
  "https://vidsrc.ws",
  "https://vidsrc.stream",
].map((origin) => {
  try {
    const url = new URL(origin);
    const host = url.hostname;
    const slug = host.replace(/[^a-z0-9]+/gi, "-");
    return {
      origin,
      label: `VidSrc · ${host}`,
      id: `vidsrc-${slug}`,
    };
  } catch (error) {
    return {
      origin,
      label: "VidSrc",
      id: `vidsrc-${origin.replace(/[^a-z0-9]+/gi, "-")}`,
    };
  }
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
  if (coerceBoolean(options.nextEpisode ?? options.nextepisode)) {
    params.set("nextEpisode", "true");
    params.set("nextepisode", "true");
  }
  if (coerceBoolean(options.episodeSelector ?? options.episodeselector)) {
    params.set("episodeSelector", "true");
    params.set("episodeselector", "true");
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
    });
  }

  for (const host of VIDSRC_EMBED_HOSTS) {
    const url = buildVidsrcMovie(host.origin, normalizedId, options);
    if (url) {
      servers.push({
        id: host.id,
        label: host.label,
        origin: host.origin,
        src: url,
        policies: VIDSRC_POLICIES,
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
    });
  }

  for (const host of VIDSRC_EMBED_HOSTS) {
    const url = buildVidsrcTv(host.origin, normalizedId, season, episode, options);
    if (url) {
      servers.push({
        id: `${host.id}-tv`,
        label: host.label,
        origin: host.origin,
        src: url,
        policies: VIDSRC_POLICIES,
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
