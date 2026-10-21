const splashEl = document.getElementById("landingSplash");

const splashLines = [
  "Cinema made easy",
  "Press play faster",
  "Less digging, more watching",
  "Your queue, simplified",
  "Movies without the maze",
  "Shows in one move",
  "Find it. Play it.",
  "Watch smarter tonight",
  "Skip the streaming mess",
  "Built for easy watching",
  "Streaming, minus the fuss",
  "Fast picks, fast play",
  "Everything worth watching",
  "One search, done",
  "Start the good stuff",
  "Clean picks, quick starts",
  "Your next watch, ready",
  "All killer, no clutter",
  "Play more, hunt less",
  "Big screen, no stress",
  "Easy nights start here",
  "Queue up in seconds",
  "The easy watch button",
  "Browse less. Enjoy more.",
  "The shortcut to cinema",
  "Series made simple",
  "Skip the endless scrolling",
  "Movie night, unlocked",
  "One box, every genre",
  "Watch picks that click",
  "Every lane, one home",
  "Fast lanes for film fans",
  "Quick starts, clean screens",
  "The no-mess movie hub",
  "A better way to browse",
  "Search once, relax",
  "Your easy watchlist",
  "From browse to play",
  "The easy stream scene",
  "Smart picks, smooth starts",
  "Hit play, not problems",
  "Find a film faster",
  "The smoother watch stop",
  "Fewer tabs, better nights",
  "Keep the story moving",
  "Cinema in one click",
  "Simple picks for long nights",
  "The fast track to film",
  "Less lag, more laughs",
  "A cleaner way to watch",
  "Queue less. Watch more.",
  "The simple binge switch",
  "Your movie lane, sorted",
  "Zero clutter, full screen",
  "The easy episode run",
  "Built for quick picks",
  "Watch flow, not friction",
  "Short path to showtime",
  "Sharper nights start here",
  "One stop for watch time",
  "Find the fun faster",
  "The calm side of streaming",
  "Movie mode, instantly",
  "Shows on easy mode",
  "Film night, streamlined",
  "Quick picks for any mood",
  "Your nightly watch engine",
  "Find something good, fast",
  "The tidy movie toolbox",
  "Better picks, less noise",
  "Queue up the good stuff",
  "A cleaner cinema lane",
  "Always one click closer",
  "Where movie nights land",
  "Quick jumps to great stuff",
  "Your next favorite, faster",
  "Built for smooth watching",
  "The better binge button",
  "Easy watching starts now",
  "One place, all the good stuff",
  "Fast route to film night",
  "The easy search signal",
  "From title to play",
  "Quick launch for movie nights",
  "Pick a lane, hit play",
  "Nothing extra, just watch",
  "Easy picks for every mood",
  "Your fast lane to series",
  "Good screens, no nonsense",
  "Find it without the mess",
  "Play first, fuss never",
  "Everything lined up",
  "The softer side of streaming",
  "Cut the clutter, roll tape",
  "Open fast, watch faster",
  "The quick route to credits",
  "Queue made comfortable",
  "The cleaner click to watch",
  "Smooth starts for every screen",
  "Movie nights, refined",
  "One home for every watch",
  "The watchlist shortcut",
  "Start here, stay watching",
];

if (splashEl && splashLines.length) {
  let activeIndex = Math.floor(Math.random() * splashLines.length);

  const renderSplash = () => {
    splashEl.textContent = splashLines[activeIndex];
    splashEl.classList.remove("is-animating");
    void splashEl.offsetWidth;
    splashEl.classList.add("is-animating");
  };

  renderSplash();

  if (splashLines.length > 1) {
    window.setInterval(() => {
      let nextIndex = activeIndex;
      while (nextIndex === activeIndex) {
        nextIndex = Math.floor(Math.random() * splashLines.length);
      }
      activeIndex = nextIndex;
      renderSplash();
    }, 7000);
  }
}
