(function(){
  const API='/api/b2_list_json?prefix=series/';
  const $=(s,r)=> (r||document).querySelector(s);
  const enc=encodeURIComponent;

  function ensureGrid(){
    let g=$("#grid");
    if(!g){ g=document.createElement("div"); g.id="grid"; g.className="grid"; document.body.appendChild(g); }
    return g;
  }
  function caption(a,t){
    let c=a.querySelector(".cap");
    if(!c){ c=document.createElement("div"); c.className="cap"; a.appendChild(c); }
    c.textContent=t;
  }
  function card(href,img,title){
    const a=document.createElement("a"); a.href=href; a.className="card";
    const i=document.createElement("img"); i.src=img; i.alt=title; a.appendChild(i);
    caption(a,title); return a;
  }
  function se(str){
    const m=String(str||"").match(/S(\d+)\s*E(\d+)/i);
    return m?{s:+m[1],e:+m[2]}:{s:1,e:1};
  }
  function bySE(a,b){
    const A=se(a.title), B=se(b.title);
    if(A.s!==B.s) return A.s-B.s;
    if(A.e!==B.e) return A.e-B.e;
    return a.title.localeCompare(b.title);
  }
  function showPoster(slug){ return '/poster/series/'+enc(slug); }

  function slugToTitle(slug){
    return slug.split('.').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  }

  async function load(){
    const grid=ensureGrid();
    const url=new URL(location.href);
    const show=url.searchParams.get("show");
    const want=url.searchParams.get("season");

    const res=await fetch(API); const json=await res.json();
    const items=Array.isArray(json.items)?json.items:[];

    // list all shows
    if(!show){
      const slugs=new Map();
      for(const it of items){
        const m=/^series\/([^/]+)\//.exec(it.name||"");
        if(m) slugs.set(m[1], slugToTitle(m[1]));
      }
      grid.innerHTML="";
      const frag=document.createDocumentFragment();
      for(const [slug,title] of Array.from(slugs).sort((a,b)=>a[1].localeCompare(b[1]))){
        frag.appendChild(card(`series.html?show=${enc(slug)}`, showPoster(slug), title));
      }
      const bar=document.createElement("div"); bar.className="toolbar";
      const back=document.createElement("a"); back.className="pill"; back.href="index.html"; back.textContent="← Back to Movies";
      bar.appendChild(back); grid.before(bar); grid.appendChild(frag); return;
    }

    // list episodes for a show
    const showItems = items
      .filter(it => (it.name||"").startsWith(`series/${show}/`))
      .map(it => {
        const base = (it.name||"").split("/").pop().replace(/\.mp4$/i,"");
        const title = (it.title || base).replace(/\s*-\s*\[\d{4}\]\s*$/,"");
        return {title, name: it.name, size: it.size||0};
      })
      .sort(bySE);

    const seasons = Array.from(new Set(showItems.map(x=>se(x.title).s))).sort((a,b)=>a-b);
    const cur = want ? +want : (seasons[0]||1);

    grid.innerHTML="";
    const bar=document.createElement("div"); bar.className="toolbar";
    const back=document.createElement("a"); back.className="pill"; back.href="series.html"; back.textContent="← Back to Series";
    bar.appendChild(back);
    if(seasons.length){
      const lab=document.createElement("label"); lab.style.marginLeft="8px"; lab.textContent="Season ";
      const sel=document.createElement("select"); sel.id="seasonSelect";
      for(const n of seasons){ const o=document.createElement("option"); o.value=String(n); o.textContent=`Season ${n}`; if(n===cur) o.selected=true; sel.appendChild(o); }
      sel.addEventListener("change",()=>{ const u=new URL(location.href); u.searchParams.set("show",show); u.searchParams.set("season",sel.value); location.href=u; });
      lab.appendChild(sel); bar.appendChild(lab);
    }
    grid.before(bar);

    const frag=document.createDocumentFragment();
    for(const ep of showItems){
      if(se(ep.title).s !== cur) continue;
      frag.appendChild(card(`/video/${enc(ep.name)}`, showPoster(show), ep.title));
    }
    grid.appendChild(frag);
  }
  window.addEventListener("load", ()=>load().catch(console.error));
})();
