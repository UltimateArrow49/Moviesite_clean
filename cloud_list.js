// /movie_site_clean/cloud_list.js
(function(){
  const BASE_API = "https://theblackbox.ddns.net/api";
  const grid = document.getElementById("movie-grid") || document.querySelector(".grid") || document.body;

  function el(tag, attrs){
    const e = document.createElement(tag);
    if (attrs) Object.assign(e, attrs);
    return e;
  }

  async function getJSON(url){
    try{
      const r = await fetch(url, {cache:"no-store"});
      if(!r.ok) return null;
      return await r.json();
    }catch{return null;}
  }

  (async () => {
    // Prefer cloud /movies; fallback to local /api/media
    const cloud = await getJSON(`${BASE_API}/movies`);
    let list = [];
    if (Array.isArray(cloud)) {
      list = cloud.map(x => ({ name: x.title || x.name || x.id || "", url: x.url || x.stream || "" }));
    } else {
      const local = await getJSON("/api/media");
      list = (local?.files || []).map(x => ({ name: x.title || x.name, url: "/video/" + encodeURIComponent(x.name) }));
    }

    list.forEach(m=>{
      const a = el("a", { href: m.url || "#", textContent: m.name });
      a.style.display = "block"; a.style.margin = "6px 0";
      a.onclick = function(ev){
        ev.preventDefault();
        const v = document.querySelector("video#player, video") || el("video", {controls:true});
        v.style.maxWidth = "100%";
        if (!v.parentNode) document.body.prepend(v);
        v.src = this.href;
        v.play().catch(()=>{});
      };
      grid.appendChild(a);
    });
  })();
})();
