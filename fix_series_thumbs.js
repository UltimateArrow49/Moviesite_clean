(function(){
  function fixOne(img){
    if(!img || !img.src) return;
    try{
      var u = new URL(img.src, location.origin);
      // If path is like /thumbs/series/<key> (no extension) -> add .jpg
      if(/^\/thumbs\/series\/[^.\/]+$/i.test(u.pathname)){
        u.pathname += ".jpg";
        img.src = u.toString();
      }
      // Add a one-time onerror fallback to placeholder
      img.onerror = function(){ this.onerror=null; this.src="/thumbs/placeholder.png"; };
    }catch(e){}
  }
  document.addEventListener("DOMContentLoaded", function(){
    document.querySelectorAll("img").forEach(fixOne);
    // also catch dynamically added images
    new MutationObserver(function(muts){
      muts.forEach(function(m){
        m.addedNodes && m.addedNodes.forEach(function(n){
          if(n.tagName==="IMG") fixOne(n);
          if(n.querySelectorAll) n.querySelectorAll("img").forEach(fixOne);
        });
      });
    }).observe(document.documentElement, {childList:true, subtree:true});
  });
})();
