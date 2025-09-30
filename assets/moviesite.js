
// moviesite.js — robust renderer for Movies (items[].file) or Series Index (items[].slug / no file)
(function(){
  function $(s, r){ return (r||document).querySelector(s); }
  var grid = $('.grid') || document.body;

  function makeCard(html){
    var d = document.createElement('div'); d.className='card'; d.innerHTML=html; return d;
  }
  function imgTag(src, alt){
    var a = alt || '';
    return '<img class="thumb" src="'+src+'" alt="'+a+'" onerror="this.onerror=null;this.src=\'/thumbs/placeholder.png\'">';
  }

  // manifest param required
  var u = new URL(location.href);
  var manifest = u.searchParams.get('manifest');
  if(!manifest){ grid.innerHTML = "<p style='opacity:.7'>No manifest set.</p>"; return; }

  fetch(manifest, {cache:'no-store'}).then(function(r){ return r.json(); }).then(function(data){
    var items = Array.isArray(data.items) ? data.items : [];
    var base  = data.baseUrl || '';

    function buildSrc(file){
      try{ if (typeof window.mediaUrl === 'function') return window.mediaUrl(file); }catch(e){}
      if (/^https?:\/\//i.test(base)) return base + file;
      return '/video/' + encodeURIComponent(file);
    }

    // Decide: is this a series index (shows) or movies
    var isSeriesIndex = false;
    if (items.length){
      var x = items[0];
      isSeriesIndex = (!x.file) || (typeof x.slug !== 'undefined') || (typeof x.show !== 'undefined') || (typeof x.seasons !== 'undefined');
    }

    grid.innerHTML = '';

    if (isSeriesIndex){
      // SERIES (shows list)
      for (var i=0;i<items.length;i++){
        var s = items[i];
        var showName = (s.show || s.title || s.name || 'Show');
        var slug = s.slug || showName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'show';
        var thumb = s.thumb || ('/thumbs/series/' + encodeURIComponent(slug) + '.jpg');
        var seasonCount = (typeof s.seasonCount !== 'undefined') ? s.seasonCount :
                          (Array.isArray(s.seasons) ? s.seasons.length : '');
        var sub = '';
        if (seasonCount !== ''){
          sub = seasonCount + ' season' + (seasonCount!==1?'s':'');
          if (typeof s.totalEpisodes !== 'undefined') sub += ', ' + s.totalEpisodes + ' eps';
        }
        var href = '/show.html?slug=' + encodeURIComponent(slug);
        var html = ''
          + '<a class="card" href="'+href+'" style="display:block;text-decoration:none;color:inherit">'
          +   imgTag(thumb, showName)
          +   '<div class="meta"><p class="title">'+showName+'</p><p class="sub">'+sub+'</p></div>'
          + '</a>';
        grid.appendChild(makeCard(html));
      }
      var c1 = document.querySelector('.count'); if (c1) c1.textContent = '('+items.length+')';
      return;
    }

    // MOVIES
    for (var j=0;j<items.length;j++){
      var m = items[j];
      var file = m.file || '';
      var title = m.title || file;
      var src = buildSrc(file);
      var img = imgTag('/poster/' + encodeURIComponent(file), title);
      var size = (m.size && isFinite(m.size)) ? (m.size/1e9).toFixed(2) + ' GB' : '';
      var playerHref = '/player.html?src=' + encodeURIComponent(src);
      var html2 = ''
        + '<a class="card" href="'+playerHref+'" style="display:block;text-decoration:none;color:inherit">'
        +   img
        +   '<div class="meta"><p class="title">'+title+'</p><p class="sub">'+size+'</p></div>'
        + '</a>';
      grid.appendChild(makeCard(html2));
    }
    var c2 = document.querySelector('.count'); if (c2) c2.textContent = '('+items.length+')';
  }).catch(function(){
    grid.innerHTML = "<p style='opacity:.7'>Failed to load manifest.</p>";
  });
})();
