#!/usr/bin/env python3
import os, json, re, urllib.parse
from pathlib import Path
from datetime import datetime, timezone
from b2sdk.v2 import InMemoryAccountInfo, B2Api

CFG_FILE = Path("/root/.config/moviesite/b2.env")
BASE_DIR = Path("/movie_site_clean")
CACHE_DIR = BASE_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
OUT = CACHE_DIR / "b2_index.json"

def load_env(path):
    env={}
    if path.exists():
        for line in path.read_text().splitlines():
            line=line.strip()
            if not line or line.startswith("#"): continue
            if "=" in line:
                k,v=line.split("=",1)
                env[k.strip()]=v.strip()
    return env

VID_EXTS = {".mp4",".m4v",".webm",".mov",".mkv",".avi",".wmv",".ts",".m2ts",".mpg",".mpeg"}

def pretty_title(name):
    base = Path(name).name
    base = re.sub(r"\.[^.]+$","",base)
    base = base.replace("_"," ").replace("."," ")
    base = re.sub(r"\s+"," ",base).strip()
    return base.title()

def main():
    env = load_env(CFG_FILE)
    key_id = env.get("B2_KEY_ID") or "00349c73e022de10000000001"
    app_key = env.get("B2_APP_KEY") or "K003fr4VhIAH5XAn29eh1TWeLB8TtOk"
    bucket_name = env.get("B2_BUCKET") or "moviesite-media-henry"
    prefix = env.get("B2_PREFIX","")

    info = InMemoryAccountInfo()
    b2 = B2Api(info)
    b2.authorize_account("production", key_id, app_key)
    bucket = b2.get_bucket_by_name(bucket_name)

    files=[]
    for fv, folder in bucket.ls(folder_to_list=prefix, recursive=True):
        if folder: 
            continue
        name = fv.file_name
        if Path(name).suffix.lower() not in VID_EXTS:
            continue
        files.append({
            "name": name,
            "title": pretty_title(name),
            "size": fv.size or 0,
        })
    files.sort(key=lambda x: x["title"].lower())

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bucket": bucket_name,
        "prefix": prefix,
        "download_url": info.get_download_url(),
        "remote_media_base": f'{info.get_download_url()}/file/{bucket_name}/',
        "total": len(files),
        "files": files,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False))
    print(f"Wrote {OUT} with {len(files)} items")

if __name__ == "__main__":
    main()
