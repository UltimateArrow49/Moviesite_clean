#!/usr/bin/env python3
import os, json, pathlib, re, time

ROOT    = pathlib.Path("/movie_site_clean/media/series")
OUTDIR  = pathlib.Path("/movie_site_clean/manifests/series")
OUTDIR.mkdir(parents=True, exist_ok=True)
TOP_MANIFEST = pathlib.Path("/movie_site_clean/manifests/series.json")

def slugify(name):
    return re.sub(r'[^a-z0-9]+','-', name.lower()).strip('-')

def natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]

def build_series():
    shows = []
    for showdir in sorted(ROOT.iterdir()):
        if not showdir.is_dir(): continue
        showname = showdir.name
        slug = slugify(showname)
        seasons = []
        for season in sorted(showdir.iterdir()):
            if not season.is_dir(): continue
            m = re.search(r'(\d+)', season.name)
            num = int(m.group(1)) if m else len(seasons)+1
            eps = []
            for f in sorted(season.iterdir(), key=lambda x: natural_key(x.name)):
                if not f.is_file(): continue
                if not f.suffix.lower() in (".mp4",".mkv",".avi",".mov",".webm",".m4v"):
                    continue
                ep_m = re.search(r'(\d+)', f.stem)
                epnum = int(ep_m.group(1)) if ep_m else len(eps)+1
                eps.append({
                    "file": f.relative_to(ROOT).as_posix(),
                    "title": f.stem,
                    "epNumber": epnum,
                    "size": f.stat().st_size
                })
            if eps:
                seasons.append({"number": num, "name": f"Season {num}", "episodes": eps})
        data = {"show": showname, "slug": slug, "seasons": seasons}
        with open(OUTDIR/f"{slug}.json","w",encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        shows.append({"slug": slug, "title": showname, "thumb": f"/thumbs/series/{showname}.jpg"})
    TOP_MANIFEST.write_text(json.dumps({"items": shows}, indent=2), encoding="utf-8")

def build_movies():
    MROOT   = pathlib.Path("/movie_site_clean/media/movies")
    MOUT    = pathlib.Path("/movie_site_clean/manifests/movies.json")
    items   = []
    if not MROOT.exists(): return
    for f in sorted(MROOT.iterdir(), key=lambda x: natural_key(x.name)):
        if not f.is_file(): continue
        if f.suffix.lower() not in (".mp4",".mkv",".avi",".mov",".webm",".m4v"):
            continue
        items.append({
            "file": f.name,
            "title": f.stem,
            "size": f.stat().st_size,
            "thumb": f"/thumbs/movies/{f.stem}.jpg"
        })
    MOUT.write_text(json.dumps({"items": items}, indent=2), encoding="utf-8")

def main():
    build_movies()
    build_series()
    print("scan_cloud: manifests written")

if __name__=="__main__":
    main()
