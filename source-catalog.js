/* Public embed routes observed in Cineby's source selector, 21 October 2026.
   Keep provider definitions shared by the detail page and playback screen. */
(function () {
  "use strict";
  var providers = {
    cinesrc: { label: "CineSrc", movie: "https://cinesrc.st/embed/movie/{id}?color=%2314ff9f&controls=true&continueprompt=true", tv: "https://cinesrc.st/embed/tv/{id}?s={s}&e={e}&color=%2314ff9f&controls=true&continueprompt=true" },
    vidcore: { label: "VidCore · new tab", external: true, movie: "https://vidcore.io/movie/{id}?theme=14ff9f", tv: "https://vidcore.io/tv/{id}/{s}/{e}?theme=14ff9f" },
    vidnest: { label: "VidNest · new tab", external: true, movie: "https://vidnest.fun/movie/{id}", tv: "https://vidnest.fun/tv/{id}/{s}/{e}" },
    videasy: { label: "Videasy · new tab", external: true, movie: "https://player.videasy.to/movie/{id}", tv: "https://player.videasy.to/tv/{id}/{s}/{e}" }
  };
  function selected(value) {
    return Object.prototype.hasOwnProperty.call(providers, value) ? value : "cinesrc";
  }
  function fill(select, value) {
    select.setAttribute("aria-label", "Playback source");
    Object.keys(providers).forEach(function (key) {
      var option = document.createElement("option");
      option.value = key;
      option.textContent = "Source: " + providers[key].label;
      select.appendChild(option);
    });
    select.value = selected(value);
  }
  function buildUrl(key, mode, id, season, episode) {
    if (!Object.prototype.hasOwnProperty.call(providers, key)) return null;
    if (mode !== "movie" && mode !== "tv") return null;
    if (!/^[1-9][0-9]*$/.test(String(id))) return null;
    season = season == null ? 1 : season;
    episode = episode == null ? 1 : episode;
    if (mode === "tv" && (!/^[0-9]+$/.test(String(season)) || !/^[1-9][0-9]*$/.test(String(episode)))) return null;
    return providers[key][mode].replace("{id}", id).replace("{s}", season).replace("{e}", episode);
  }
  window.tbbSources = { providers: providers, selected: selected, fill: fill, buildUrl: buildUrl };
})();
