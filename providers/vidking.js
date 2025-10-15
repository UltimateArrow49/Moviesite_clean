const VIDKING_ORIGIN = "https://www.vidking.net";

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
