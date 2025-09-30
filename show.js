(function(){
  const u=new URL(location.href);
  const slug=u.searchParams.get("slug")||"";
  const seasonSel=document.getElementById("season");
  const epsEl=document.getElementById("episodes");
  const qEl=document.getElementById("q");
  const tpl=document.getElementById("tpl-ep");
  const showTitle=document.getElementById("showTitle");
  if(!slug){ epsEl.innerHTML="<p>Missing show.</p>"; return; }
  if(showTitle) showTitle.textContent = slug.replace(/[._]/g," ").replace(/\s+/g," ").trim().replace(/\b\w/g,c=>c.toUpperCase());

  const poster = (file) => {
    const base=String(file||"").split("/").pop().replace(/\.[^.]+$/,"");
    return "/poster_smart/" + encodeURIComponent(base);
  };
  const playUrl = (rel) => "/player.html?"+ new URLSearchParams({ file: "series/"+slug+"/"+rel });

  async function j(url){ const r=await fetch(url,{cache:"no-store"}); if(!r.ok) throw new Error(await r.text()); return r.json(); }

  let all=[];

  async function loadSeasons(){
    const meta=await j("/api/series/"+encodeURIComponent(slug));
    const seasons=meta.seasons||[];
    if(!seasons.length){ epsEl.innerHTML="<p>No seasons.</p>"; return; }
    seasonSel.innerHTML = seasons.map(s=>`<option value="${s}">${s}</option>`).join("");
    await loadSeason(seasons[0]);
  }

  async function loadSeason(s){
    const data=await j("/api/series/"+encodeURIComponent(slug)+"?season="+encodeURIComponent(s));
    all=(data.episodes||[]).map(e=>({...e, rel:s+"/"+e.file}));
    render();
    seasonSel.value=s;
  }

  function render(){
    const q=(qEl.value||"").toLowerCase();
    epsEl.innerHTML="";
    (q?all.filter(e=>(e.title||e.file||"").toLowerCase().includes(q)):all).forEach(e=>{
      const el=tpl.content.firstElementChild.cloneNode(true);
      const img=el.querySelector(".shot");
      img.src=poster(e.file); img.onerror=()=>{img.onerror=null; img.src="/thumbs/__missing__.jpg";};
      const epNo = (e.episode != null) ? `E${String(e.episode).padStart(2,"0")} · ` : "";
      el.querySelector(".title").textContent = epNo + (e.title || e.file);
      el.querySelector(".play").href = playUrl(e.rel);
      epsEl.appendChild(el);
    });
    if(!epsEl.children.length) epsEl.innerHTML="<p>No episodes.</p>";
  }

  seasonSel.addEventListener("change",e=>loadSeason(e.target.value));
  qEl.addEventListener("input",render);
  loadSeasons().catch(e=>{ console.error(e); epsEl.innerHTML="<p>Failed to load show.</p>"; });
})();
