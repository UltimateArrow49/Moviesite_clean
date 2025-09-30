(function(){
  function safe(fn){ try{ fn(); }catch(e){ console.error('series.enhance error:', e); } }
  function qs(s, r){ return (r||document).querySelector(s); }
  function qsa(s, r){ return Array.from((r||document).querySelectorAll(s)); }
  function getTitle(el){
    const img = el.querySelector('img');
    return el.dataset.title
        || el.getAttribute('data-title')
        || el.title
        || (img && (img.getAttribute('data-title') || img.alt))
        || '';
  }
  function ensureCaption(el){
    if (!el || el.querySelector('.cap')) return;
    const t = getTitle(el);
    if (!t) return;
    const c = document.createElement('div');
    c.className = 'cap';
    c.textContent = t;
    el.appendChild(c);
  }
  function parseSE(t){
    const m = String(t||'').match(/S(\d+)\s*E(\d+)/i);
    return m ? [parseInt(m[1],10), parseInt(m[2],10)] : [999,999];
  }
  function enhance(){
    const grid = qs('.grid') || qs('#grid') || document.body;
    const cards = qsa('.grid a, a.card, a.tile, .card, .tile', grid).filter(el => el.querySelector('img'));
    if (!cards.length) return;
    cards.forEach(ensureCaption);
    const parent = cards[0].parentElement;
    if (!parent || cards.length < 2) return;
    cards.sort((a,b)=>{
      const ta=getTitle(a), tb=getTitle(b);
      const [sa,ea]=parseSE(ta), [sb,eb]=parseSE(tb);
      if (sa!==sb) return sa-sb;
      if (ea!==eb) return ea-eb;
      return ta.localeCompare(tb);
    });
    cards.forEach(n=>parent.appendChild(n));
  }
  window.addEventListener('load', ()=>safe(enhance));
  new MutationObserver(()=>safe(enhance))
    .observe(document.body || document.documentElement, {childList:true, subtree:true});
})();
