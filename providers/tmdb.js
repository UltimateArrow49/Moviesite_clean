export const TMDB_IMG = (path, size="w342") => path ? `https://image.tmdb.org/t/p/${size}${path}` : "/thumbs/placeholder.png";
export async function tmdbTrending(media="movie", page=1){
  const r = await fetch(`/ext/tmdb/trending?media=${encodeURIComponent(media)}&page=${page}`, {cache:"no-store"});
  return await r.json();
}
export async function tmdbSearch(q, media="movie", page=1){
  const r = await fetch(`/ext/tmdb/search?q=${encodeURIComponent(q)}&media=${encodeURIComponent(media)}&page=${page}`, {cache:"no-store"});
  return await r.json();
}
