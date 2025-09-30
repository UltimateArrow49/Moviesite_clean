/* Try several filename variants based on a movie/show title. Falls back to placeholder. */
(function(){
  function variants(title){
    const t = String(title||'').trim();
    const base = t
      .replace(/\s+/g,' ')                     // collapse spaces
      .replace(/[^\w\s.-]/g,' ')               // drop punctuation except . and -
      .trim();

    const dots = base.replace(/\s+/g,'.');     // "The Godfather Part II" -> "The.Godfather.Part.II"
    const unds = base.replace(/\s+/g,'_');     // "The_Godfather_Part_II"
    const lowerDots = dots.toLowerCase();
    const short = base.replace(/\b(19|20)\d{2}\b/g,'').replace(/\s+/g,'.').replace(/\.+/g,'.').replace(/\.$/,'');

    const uniq = new Set([
      dots, unds, lowerDots, short,
      base,                                  // raw (with spaces)
      base.toLowerCase().replace(/\s+/g,'.')
    ]);

    // add common alternate spellings
    const m = base.toLowerCase();
    if (m.includes('28 days later')) uniq.add('28.Days.Later');
    if (m.includes('28 weeks later')) uniq.add('28.Weeks.Later');
    if (m.includes('minecraft')) uniq.add('A.Minecraft.Movie');
    if (m.includes('the godfather part ii')) uniq.add('The.Godfather.Part.II');
    if (m.includes('the italian job')) uniq.add('The.Italian.Job');
    if (m.includes('the shining')) { uniq.add('The.Shining'); uniq.add('Shining'); }

    return Array.from(uniq).map(v => `${v}.jpg`);
  }

  function tryNext(img, list, i){
    if (i >= list.length){ img.src = '/thumbs/placeholder.png'; return; }
    img.onerror = function(){ tryNext(img, list, i+1); };
    img.src = '/thumbs/movies/' + encodeURIComponent(list[i]);
  }

  // public helpers
  window.loadMovieThumb = function(img, title){
    tryNext(img, variants(title), 0);
  };

  window.loadSeriesThumb = function(img, key){
    // series thumbs are exact by key; fallback to placeholder
    img.onerror = function(){ img.onerror=null; img.src='/thumbs/placeholder.png'; };
    img.src = '/thumbs/series/' + encodeURIComponent(key);
  };
})();
