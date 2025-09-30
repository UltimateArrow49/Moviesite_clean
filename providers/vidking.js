export function vkMovieEmbed(tmdbId, opts={}){
  const base = "https://www.vidking.net/embed/movie/" + encodeURIComponent(tmdbId);
  const q = new URLSearchParams();
  if (opts.color) q.set("color", String(opts.color).replace(/^#/,""));
  if (opts.autoPlay) q.set("autoPlay","true");
  return q.toString()? base + "?" + q.toString() : base;
}
export function vkTvEmbed(tmdbId, season=1, episode=1, opts={}){
  const base = `https://www.vidking.net/embed/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`;
  const q = new URLSearchParams();
  if (opts.color) q.set("color", String(opts.color).replace(/^#/,""));
  if (opts.autoPlay) q.set("autoPlay","true");
  if (opts.nextEpisode) q.set("nextEpisode","true");
  if (opts.episodeSelector) q.set("episodeSelector","true");
  return q.toString()? base + "?" + q.toString() : base;
}
