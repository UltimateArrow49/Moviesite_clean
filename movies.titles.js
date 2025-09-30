/* movies.titles.js – cleans captions on the Movies page */
(function(){
  const clean=(s)=>{
    if(!s) return s;
    s = s.replace(/\.[a-z0-9]{2,4}$/i,'');          // drop extension
    s = s.replace(/[_\.]+/g,' ');                   // dots/underscores -> spaces
    s = s.replace(/\[[^\]]*\]|\([^)]*\)/g,' ');     // remove [brackets] and (parentheses)
    s = s.replace(/\b(19|20)\d{2}\b/g,' ');         // remove year if present
    s = s.replace(/\b(480p|720p|1080p|2160p|4k|8k|hdr|hdrip|brrip|webrip|web[\-\s]?dl|bluray|bdrip|cam|remux|x264|x265|hevc|h\.?264|aac|dts|eac3|10bit|yts|yify|nf|amzn|hulu|proper|repack|extended|directors?\.? cut|dual|multi|subs?)\b/gi,' ');
    s = s.replace(/\s{2,}/g,' ').trim();
    // Title case with small-words rule
    const small=new Set(['a','an','the','and','but','or','nor','for','so','of','in','on','at','to','from','by','with']);
    return s.split(' ').map((w,i,a)=> (i&&i<a.length-1&&small.has(w.toLowerCase()))?w.toLowerCase():w[0]?w[0].toUpperCase()+w.slice(1):w ).join(' ');
  };

  const fixOne=(cap)=>{
    const before=cap.textContent.trim();
    const after=clean(before);
    if(after && after!==before) cap.textContent=after;
  };

  const scan=()=>document.querySelectorAll('.card .cap').forEach(fixOne);
  new MutationObserver(scan).observe(document.body,{subtree:true,childList:true});
  if(document.readyState!=='loading') scan(); else document.addEventListener('DOMContentLoaded',scan);
})();
