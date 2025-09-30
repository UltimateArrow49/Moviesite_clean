async function fetchJSON(url){const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error(await r.text());return r.json();}
const grid=document.getElementById("grid");
const modal=document.getElementById("playerModal");
const closeModal=document.getElementById("closeModal");
const nowPlaying=document.getElementById("nowPlaying");
const container=document.getElementById("embed-container");

async function loadMovies(){
  const data=await fetchJSON("/api/tmdb/movie/popular");
  grid.innerHTML="";
  for(const m of data.results){
    const card=document.createElement("div");card.className="card";
    card.innerHTML=`<img class="thumb" src="https://image.tmdb.org/t/p/w500${m.poster_path}" alt="">
      <div class="meta"><p class="title">${m.title}</p><p class="sub">${m.release_date||""}</p></div>`;
    card.addEventListener("click",()=>{
      container.innerHTML=`<iframe src="https://www.vidking.net/embed/movie/${m.id}?autoPlay=true&color=9146ff" width="100%" height="100%" frameborder="0" allowfullscreen></iframe>`;
      nowPlaying.textContent=m.title;
      modal.classList.remove("hidden");
    });
    grid.appendChild(card);
  }
}

async function loadShows(){
  const data=await fetchJSON("/api/tmdb/tv/popular");
  const divider=document.createElement("h2");divider.textContent="TV Shows";grid.appendChild(divider);
  for(const s of data.results){
    const card=document.createElement("div");card.className="card";
    card.innerHTML=`<img class="thumb" src="https://image.tmdb.org/t/p/w500${s.poster_path}" alt="">
      <div class="meta"><p class="title">${s.name}</p><p class="sub">${s.first_air_date||""}</p></div>`;
    card.addEventListener("click",()=>renderShow(s));
    grid.appendChild(card);
  }
}

async function renderShow(show){
  const data=await fetchJSON(`/api/tmdb/tv/${show.id}`);
  grid.innerHTML="";
  const selector=document.createElement("select");
  data.seasons.forEach(sea=>{
    const opt=document.createElement("option");opt.value=sea.season_number;opt.textContent=`Season ${sea.season_number}`;selector.appendChild(opt);
  });
  grid.before(selector);
  selector.addEventListener("change",()=>paint(parseInt(selector.value)));
  paint(1);

  async function paint(seasonNum){
    const eps=await fetchJSON(`/api/tmdb/tv/${show.id}/season/${seasonNum}`);
    grid.innerHTML="";
    eps.episodes.forEach(ep=>{
      const card=document.createElement("div");card.className="card";
      card.innerHTML=`<div class="meta"><p class="title">E${ep.episode_number}: ${ep.name}</p></div>`;
      card.addEventListener("click",()=>{
        container.innerHTML=`<iframe src="https://www.vidking.net/embed/tv/${show.id}/${seasonNum}/${ep.episode_number}?autoPlay=true&nextEpisode=true&episodeSelector=true" width="100%" height="100%" frameborder="0" allowfullscreen></iframe>`;
        nowPlaying.textContent=`${show.name} S${seasonNum}E${ep.episode_number}`;
        modal.classList.remove("hidden");
      });
      grid.appendChild(card);
    });
  }
}

async function init(){
  await loadMovies();
  await loadShows();
}
document.addEventListener("DOMContentLoaded",init);
closeModal.addEventListener("click",()=>{container.innerHTML="";modal.classList.add("hidden");});
