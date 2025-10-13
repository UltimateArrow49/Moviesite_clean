Theblackbox Desktop Bundle
==========================

This portable bundle contains the core theblackbox experience for desktops.
Unzip the archive and open `index.html` in your browser to use the offline-ready
shell with movies, shows, live channels, and the Info relay player.

For the most reliable playback, run the files through a local web server
(for example, `python -m http.server` from this folder) so that the browser can
load the JavaScript modules without security warnings.

Need fresh data or stream endpoints? The player still reaches out to TMDB and
the VidKing relay over HTTPS, so an internet connection is required for live
requests.
