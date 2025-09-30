
;(()=>{ 
  const S3 = "https://moviesite-media-henry.s3.eu-central-003.backblazeb2.com/";
  const FRIENDLY = "https://f003.backblazeb2.com/file/moviesite-media-henry/";
  window.CLOUD_S3_BASE = S3;
  window.CLOUD_FRIENDLY_BASE = FRIENDLY;

  // Always stream from S3
  window.mediaUrl = function(name){
    try { name = decodeURIComponent(name); } catch(e){}
    return S3 + encodeURIComponent(name);
  };

  // Thumbnails
  window.thumbUrl = function(kind, key){
    const base = (kind === "series") ? "/thumbs/series/" : "/thumbs/movies/";
    try { key = decodeURIComponent(key); } catch(e){}
    return base + encodeURIComponent(key) + ".jpg";
  };
})();
