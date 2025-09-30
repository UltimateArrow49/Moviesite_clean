(function(){
  // Build several likely poster filenames for a title (period separated, no year, jpg/png, etc.)
  function candidatesForTitle(title){
    const clean = String(title||'').replace(/_/g,' ').replace(/\s+/g,' ').trim();
    const noYear = clean.replace(/\b(19|20)\d{2}\b/g,'').replace(/\s{2,}/g,' ').trim();
    const normalize = s => s
      .replace(/&/g,' and ')
      .replace(/[^a-z0-9]+/gi,'.')      // convert gaps to dots
      .replace(/\.+/g,'.')              // collapse dots
      .replace(/^\.+|\.+$/g,'');        // trim dots
    const C = new Set();
    for (const base of [clean, noYear]){
      const dot = normalize(base);
      if (!dot) continue;
      const cap = dot.replace(/\b\w/g,c=>c.toUpperCase());
      // try both cases and both extensions
      for (const stem of [dot, cap]){
        C.add(stem + '.jpg');
        C.add(stem + '.png');
      }
    }
    return Array.from(C);
  }

  // Attach to an <img> and try candidates until one loads
  window.attachThumb = function attachThumb(img, section, titleOrKey){
    const prefix = '/thumbs/' + section + '/';
    const list = candidatesForTitle(titleOrKey);
    let i = 0;
    function tryNext(){
      if (i >= list.length){
        img.src = '/thumbs/placeholder.png';
        img.onerror = null;
        return;
      }
      img.src = prefix + encodeURIComponent(list[i++]);
    }
    img.onerror = tryNext;
    tryNext();
  };
})();
