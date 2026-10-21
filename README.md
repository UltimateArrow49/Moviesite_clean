# theblackbox

A cinema-inspired web interface for discovering films and series, tracking viewing progress, and sharing watch-together rooms. Includes a book discovery interface and an installable web app shell.

[Open the live site](https://movies.example.com/)

## Features

- Film and TV discovery powered by TMDB metadata
- Continue-watching history and episode progress
- Watch-together rooms with chat and playback coordination
- Responsive navigation and installable web app support
- Book discovery and reading integrations

## Architecture

Nginx serves the frontend and proxies API requests to Flask through Gunicorn. SQLite stores sync and room state. The deployed frontend includes compiled assets plus standalone interface enhancements; the original frontend build project is not included, so these assets cannot currently be rebuilt from this repository.

## Run the backend

Requires Python 3.10 or later. On Linux:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export TMDB_API_TOKEN='your-own-read-access-token'
gunicorn --workers 2 --threads 8 --bind 127.0.0.1:5001 wsgi:app
```

Serve the repository through Nginx for the complete application. Flask alone serves backend routes, not the frontend. Proxy `/api/`, `/ext/`, and `/embed/` to the backend. Keep environment files, database files, private keys, backups, and operational notes outside the public web root.

## Configuration

| Variable | Purpose |
| --- | --- |
| `TMDB_API_TOKEN` | TMDB read access token |
| `TMDB_API_KEY` | Alternative TMDB API key |
| `MOVIESITE_SYNC_DB` | SQLite path; defaults to the application directory |
| `GOOGLE_BOOKS_API_KEY` | Optional Google Books API credential |

## Deployment status

The free hostname was configured on 21 October 2026 with HTTPS and scheduled certificate renewal. It depends on the current server IP and a third-party DNS service. Existing browser history and saved progress are scoped to the previous origin and will not automatically transfer.

Third-party playback availability is independent of metadata search. Cineby returned HTTP 403 during this maintenance pass; no new Cineby source integration has been added. Only use media and upstream services you are authorized to access.

## Maintenance

Back up the SQLite database before backend changes. Validate Python syntax and Nginx configuration before reloading services. Check the homepage, metadata search, episode navigation, sync, and watch-together flows after deployment. Never commit credentials or user databases.

TMDB provides metadata; this project is not endorsed or certified by TMDB. No license grant is implied for third-party media or assets.
