/* Public embed routes observed in Cineby's source selector, 21 October 2026.
   Keep provider definitions shared by the detail page and playback screen. */
(function () {
  "use strict";
  var providers = {
    cinesrc: { label: "CineSrc", movie: "https://cinesrc.st/embed/movie/{id}?color=%2314ff9f&controls=true&continueprompt=true", tv: "https://cinesrc.st/embed/tv/{id}?s={s}&e={e}&color=%2314ff9f&controls=true&continueprompt=true" },
    vidcore: { label: "VidCore", movie: "https://vidcore.io/movie/{id}?theme=14ff9f", tv: "https://vidcore.io/tv/{id}/{s}/{e}?theme=14ff9f" },
    vidnest: { label: "VidNest", movie: "https://vidnest.fun/movie/{id}", tv: "https://vidnest.fun/tv/{id}/{s}/{e}" },
    videasy: { label: "Videasy · saves progress", sandbox: false, movie: "https://player.videasy.to/movie/{id}", tv: "https://player.videasy.to/tv/{id}/{s}/{e}" }
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
  window.tbbSources = { providers: providers, selected: selected, fill: fill };
})();
