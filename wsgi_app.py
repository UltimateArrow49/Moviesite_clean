import os
from flask import Flask, redirect, jsonify
from urllib.parse import quote

app = Flask(__name__, static_folder=".", static_url_path="")

BASE = os.environ.get("MEDIA_BASE_URL","https://f003.backblazeb2.com/file/moviesite-media-henry").rstrip("/")

@app.route("/media/<path:key>")
def media_redirect(key):
    return redirect(f"{BASE}/{quote(key, safe='/')}", code=302)

@app.route("/api/movies")
def api_movies():
    try:
        import boto3
        bucket = os.environ.get("B2_BUCKET","moviesite-media-henry")
        endpoint = os.environ.get("B2_S3_ENDPOINT","https://s3.eu-central-003.backblazeb2.com")
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            region_name="eu-central-003",
        )
        items=[]
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket):
            for obj in page.get("Contents", []):
                key=obj["Key"]; low=key.lower()
                if not (low.endswith(".mp4") or low.endswith(".mkv") or low.endswith(".webm")):
                    continue
                items.append({"key": key, "name": key.split("/")[-1], "url": f"/media/{key}"})
        items.sort(key=lambda x: x["name"].lower())
        return jsonify(items)
    except Exception:
        return jsonify([])

@app.route("/")
def root():
    return app.send_static_file("index.html")


from urllib.parse import quote
import os
from flask import redirect

@app.route("/poster/<path:name>")
def poster(name):
    base = name.rsplit("/",1)[-1]
    stem = base.rsplit(".",1)[0]
    BASE = os.environ.get("MEDIA_BASE_URL","https://f003.backblazeb2.com/file/moviesite-media-henry").rstrip("/")
    return redirect(f"{BASE}/{quote(stem + '.jpg')}", code=302)
