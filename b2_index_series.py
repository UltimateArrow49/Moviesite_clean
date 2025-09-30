#!/usr/bin/env python3
# Build /movie_site_clean/cache/b2_series_index.json from B2 "series/" prefix
import os, re, json, time
from pathlib import Path
from b2sdk.v2 import InMemoryAccountInfo, B2Api

KEY_ID  = "00349c73e022de10000000001"
APP_KEY = "K003fr4VhIAH5XAn29eh1TWeLB8TtOk"
BUCKET  = "moviesite-media-henry"
PREFIX  = "series/"  # everything under series/

VID = {".mp4",".m4v",".webm",".mov",".mkv",".avi",".wmv",".ts",".m2ts",".mpg",".mpeg"}

def pretty_title(name: str) -> str:
    base = name.rsplit("/",1)[-1]
    base = base.rsplit(".",1)[0]
    t = re.sub(r"\s+"," ", base.replace("."," ").replace("_"," ")).strip()
    # trim common junk tags but keep episode hints
    t = re.sub(r"\b(720p|1080p|2160p|4k|x264|x265|hdr|webrip|web\-dl|bluray|yts\.?mx|\[.*?\])\b","",t,flags=re.I)
    t = re.sub(r"\s{2,}"," ",t).strip()
    return t.title()

def main():
    out_dir = Path("/movie_site_clean/cache")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "b2_series_index.json"

    info = InMemoryAccountInfo()
    b2 = B2Api(info)
    b2.authorize_account("production", KEY_ID, APP_KEY)
    bucket = b2.get_bucket_by_name(BUCKET)

    files=[]
    for fv, folder in bucket.ls(folder_to_list=PREFIX, recursive=True):
        if not fv:
            continue
        key = fv.file_name  # full key, e.g. series/rick.and.morty/s1/E01.mp4
        if not any(key.lower().endswith(ext) for ext in VID):
            continue
        files.append({"name": key, "title": pretty_title(key)})

    files.sort(key=lambda x: x["name"].lower())
    data={"files":files,"total":len(files),"generated":int(time.time())}
    out_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out_file} with {len(files)} items")

if __name__=="__main__":
    main()
