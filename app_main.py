import json
import logging
import os
from typing import Any, Dict, Optional

import requests
from flask import Flask, Response, request

app = Flask(__name__)

# Defaults provided by the operator for local development.
_TMDB_FALLBACK_TOKEN = (
    "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiN2QxY2M4NTU0ZmNhYjQxZTAxMzQyOGUyZGM0MThkZSIs"
    "Im5iZiI6MTc1ODQ5NjE2Ny4yMDMsInN1YiI6IjY4ZDA4NWE3YzliZWIyZmZjYmQ0MTliMCIsInNj"
    "b3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.Q2gi3xRWiPq8_2zICdbvvQ3hT0GQf6zQUGtRrBYXvcU"
)
_TMDB_FALLBACK_KEY = "b7d1cc8554fcab41e013428e2dc418de"


# --- Helper to call TMDB using Bearer token (with fallbacks) ---
def _tmdb_get(path: str, params: Optional[Dict[str, Any]] = None) -> Response:
    params = dict(params or {})

    token = (
        os.environ.get("TMDB_API_TOKEN")
        or os.environ.get("TMDB_BEARER_TOKEN")
        or os.environ.get("TMDB_READ_TOKEN")
        or _TMDB_FALLBACK_TOKEN
    )

    api_key = os.environ.get("TMDB_API_KEY") or _TMDB_FALLBACK_KEY

    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif api_key:
        params.setdefault("api_key", api_key)
    else:
        return Response(
            json.dumps({"error": "TMDB credentials not configured"}),
            status=500,
            mimetype="application/json",
        )

    url = f"https://api.themoviedb.org/3{path}"

    try:
        upstream = requests.get(url, headers=headers, params=params, timeout=12)
    except requests.RequestException as exc:  # pragma: no cover - defensive
        logging.getLogger(__name__).exception("TMDB request failed: %s", path)
        payload = json.dumps({"error": "upstream_tmdb_error", "detail": str(exc)})
        return Response(payload, status=502, mimetype="application/json")

    response = Response(upstream.content, status=upstream.status_code)
    content_type = upstream.headers.get("Content-Type") or "application/json"
    response.headers["Content-Type"] = content_type
    return response

# --- Routes ---
@app.get("/ext/tmdb/trending")
def tmdb_trending():
    media = request.args.get("media", "movie")
    page = request.args.get("page", "1")
    return _tmdb_get(f"/trending/{media}/week", {"page": page})

@app.get("/ext/tmdb/search")
def tmdb_search():
    media = request.args.get("media", "movie")
    query = request.args.get("query", "")
    page = request.args.get("page", "1")
    return _tmdb_get(f"/search/{media}", {"query": query, "page": page, "include_adult": "false"})

@app.get("/api/tmdb/<path:rest>")
def api_tmdb(rest):
    return _tmdb_get("/" + rest)
