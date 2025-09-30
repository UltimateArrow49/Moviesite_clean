async function fetchJSON(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

const grid = document.getElementById("grid");
const search = document.getElementById("search");

async function loadTrending(){
  const data = await fetchJSON("/api/tmdb/trending/movie/week");
  render(data.results);
}

async function searchMovies(q){
  const data = await fetchJSON("/api/tmdb/search/movie?query=" + encodeURIComponent(q));
  render(data.results);
}

function render(list){
  grid.innerHTML = "";
  for(const m of list){
    if(!m.poster_path) continue;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img class="thumb" src="https://image.tmdb.org/t/p/w500${m.poster_path}" alt="">
      <div class="meta">
        <p class="title">${m.title}</p>
        <p class="sub">${m.release_date || ""}</p>
      </div>`;
    grid.appendChild(card);
  }
}

search.addEventListener("input", ()=>{
  const q = search.value.trim();
  if(q) searchMovies(q).catch(console.error);
  else loadTrending().catch(console.error);
});

document.addEventListener("DOMContentLoaded", loadTrending);
