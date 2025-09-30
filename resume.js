(function(){
  const v = document.getElementById('player');
  if(!v) return;

  const KEY_PREFIX = 'ms:progress:';

  function storageKey(){
    return KEY_PREFIX + (v.dataset.key || '');
  }

  function save(){
    // Only save when we know which movie it is
    if(!v.dataset.key) return;
    const t = Math.floor(v.currentTime || 0);
    if(Number.isFinite(t) && t > 0){
      try { localStorage.setItem(storageKey(), String(t)); } catch {}
    }
  }

  function clear(){
    if(!v.dataset.key) return;
    try { localStorage.removeItem(storageKey()); } catch {}
  }

  function restore(){
    if(!v.dataset.key) return;
    let t = 0;
    try { t = parseInt(localStorage.getItem(storageKey()) || '0', 10); } catch {}
    if(!Number.isFinite(t) || t <= 0) return;
    // Wait for metadata so duration is known
    const trySeek = () => {
      if(Number.isFinite(v.duration) && v.duration > 0){
        if(t < v.duration - 5){             // don’t jump if basically finished
          v.currentTime = t;
        } else {
          clear();
        }
      }
    };
    if(v.readyState >= 1) trySeek(); else v.addEventListener('loadedmetadata', trySeek, { once: true });
  }

  // When a new movie is selected (src changes), try to restore
  v.addEventListener('loadedmetadata', restore);
  v.addEventListener('timeupdate', save);
  v.addEventListener('ended', clear);
})();
