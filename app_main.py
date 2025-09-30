import os, json, requests, urllib.parse, urllib.request
from flask import Flask, request, Response

app = Flask(__name__)

# --- Helper to call TMDB using Bearer token ---
def _tmdb_get(path, params=None):
    token = os.environ.get("TMDB_API_TOKEN")
    if not token:
        return Response(
            json.dumps({"error": "TMDB_API_TOKEN not set"}),
            status=500,
            mimetype="application/json"
        )
    url = f"https://api.themoviedb.org/3{path}"
    if params:
        qs = urllib.parse.urlencode(params)
        url += "?" + qs
    r = requests.get(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
    })
    return Response(r.text, status=r.status_code, mimetype="application/json")

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
