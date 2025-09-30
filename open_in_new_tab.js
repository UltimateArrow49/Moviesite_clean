(function () {
  const grid = document.getElementById('grid');
  if (!grid) return;
  function getSrc(el){
    if (el.dataset){
      return el.dataset.src || el.dataset.path || el.dataset.file || el.dataset.href || null;
    }
    const a = el.querySelector('a[href*="/media/"]');
    if (a) return a.getAttribute('href');
    return el.getAttribute('data-src') || el.getAttribute('data-path') || el.getAttribute('data-file') || null;
  }
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card, .movie, .tile, [data-src], [data-path], [data-file], [data-href]');
    if (!card) return;
    const src = getSrc(card);
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    window.open('/player.html?src=' + encodeURIComponent(src), '_blank', 'noopener');
  }, true);
})();
