document.addEventListener('DOMContentLoaded', () => {
  const clean = (t) => {
    let s = (t||'').replace(/\.[^. ]{2,4}$/,'');     // drop extension
    s = s.replace(/[_\.]+/g,' ');                    // dots/underscores -> space
    s = s.replace(/\b(720p|1080p|2160p|x264|x265|hevc|webrip|b[r|d]rip|bluray|dvdrip|yts|yify|hdr|10bit)\b/ig,' ');
    s = s.replace(/\s{2,}/g,' ').trim();
    return s.replace(/\b\w/g, m => m.toUpperCase());
  };
  // captions
  document.querySelectorAll('.card .cap').forEach(c => {
    if (/\./.test(c.textContent) || /_/ .test(c.textContent)) c.textContent = clean(c.textContent);
  });
  // fuzzy poster fallback for any broken images
  document.querySelectorAll('.card img').forEach(img => {
    const key = (img.getAttribute('data-title') || img.alt || img.src.split('/').pop() || '').replace(/\.[^.]+$/,'');
    img.onerror = () => { img.onerror = null; img.src = '/poster_guess/' + encodeURIComponent(key); };
  });
});
