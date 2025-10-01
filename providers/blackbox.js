const VIDKING_ORIGIN = "https://www.vidking.net";

function coerceBoolean(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
    return undefined;
  }
  return Boolean(value);
}

function setFlag(params, names, value) {
  const stringValue = value == null ? null : String(value);
  for (const name of names) {
    if (stringValue == null) {
      params.delete(name);
    } else {
      params.set(name, stringValue);
    }
  }
}

function applyOptions(url, options = {}) {
  const params = url.searchParams;
  const color = options.color ?? options.colour;
  if (color) params.set("color", String(color).replace(/^#/, ""));

  const autoplayOption = coerceBoolean(options.autoplay ?? options.autoPlay);
  if (autoplayOption !== undefined) {
    const flag = autoplayOption ? "1" : "0";
    setFlag(params, ["autoplay", "autoPlay"], flag);
  }

  if (coerceBoolean(options.nextEpisode ?? options.nextepisode)) {
    setFlag(params, ["nextepisode", "nextEpisode"], "1");
  }

  if (coerceBoolean(options.episodeSelector ?? options.episodeselector)) {
    setFlag(params, ["episodeselector", "episodeSelector"], "1");
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
