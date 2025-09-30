async function fetchJSON(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

const grid = document.getElementById("grid");
const search = document.getElementById("search");

async function loadTrending(){
  const data = await fetchJSON("/api/tmdb/trending/tv/week");
  render(data.results);
}

async function searchShows(q){
  const data = await fetchJSON("/api/tmdb/search/tv?query=" + encodeURIComponent(q));
  render(data.results);
}

function render(list){
  grid.innerHTML = "";
  for(const s of list){
    if(!s.poster_path) continue;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img class="thumb" src="https://image.tmdb.org/t/p/w500${s.poster_path}" alt="">
      <div class="meta">
        <p class="title">${s.name}</p>
        <p class="sub">${s.first_air_date || ""}</p>
      </div>`;
    grid.appendChild(card);
  }
}

search.addEventListener("input", ()=>{
  const q = search.value.trim();
  if(q) searchShows(q).catch(console.error);
  else loadTrending().catch(console.error);
});

document.addEventListener("DOMContentLoaded", loadTrending);
