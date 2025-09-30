/* hard-force cloud mapping */
(function(){
  window.CLOUD_BASE = window.CLOUD_BASE || "https://f003.backblazeb2.com/file/moviesite-media-henry";
  function mapToCloud(p){
    if(!p) return "";
    if(/^https?:\/\//i.test(p)) return p;               // already absolute
    // keep slashes readable in URL path
    var enc = encodeURIComponent(String(p)).replace(/%2F/gi,"/");
    return String(window.CLOUD_BASE || "").replace(/\/+$/,"") + "/" + enc;
  }
  // expose
  window.mediaUrl = function(name){ return mapToCloud(name); };
})();
