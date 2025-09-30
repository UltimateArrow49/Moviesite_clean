/* Home grid progress bars + robust Rescan (compact, no backticks) */
(function(){
  var grid=document.getElementById('grid');
  function filenameFromHref(href){
    try{ return decodeURIComponent(new URL(href, location.origin).pathname.split('/').pop()||''); }
    catch(e){ return ''; }
  }
  function mmss(t){ t=Math.max(0,t|0); var m=('0'+((t/60)|0)).slice(-2); var s=('0'+(t%60)).slice(-2); return m+':'+s; }
  function readProgress(name){
    var pos=parseInt(localStorage.getItem('vpos::'+name)||'0',10);
    var len=parseInt(localStorage.getItem('vlen::'+name)||'0',10);
    var pct=(len>0 && isFinite(len)) ? Math.max(0,Math.min(100,(pos/len)*100)) : 0;
    return {pos:pos,len:len,pct:pct};
  }
  function insertBar(card, anchor){
    var bar=card.querySelector(':scope > .card-progress, .card-progress');
    if(!bar){
      bar=document.createElement('div'); bar.className='card-progress';
      var fill=document.createElement('div'); fill.className='fill'; bar.appendChild(fill);
      // place the bar right above the title link if we can
      if(anchor && anchor.parentElement){ anchor.parentElement.insertBefore(bar, anchor); }
      else{
        var img=card.querySelector('img, .thumb, .poster');
        if(img && img.parentElement===card) img.after(bar); else card.appendChild(bar);
      }
    }
    return bar.querySelector('.fill');
  }
  function paint(){
    if(!grid) return;
    grid.querySelectorAll('.card-progress').forEach(function(x){ x.remove(); });
    var cards=grid.querySelectorAll('.card, .movie, .item, li, div');
    cards.forEach(function(card){
      var a=card.matches('a[href^="/video/"]')?card:card.querySelector('a[href^="/video/"]');
      if(!a) return;
      var name=filenameFromHref(a.getAttribute('href')||''); if(!name) return;
      var st=readProgress(name); var fill=insertBar(card,a);
      if(st.pct>0 && st.len>0){
        fill.style.width=st.pct+'%';
        fill.title='Progress: '+mmss(st.pos)+' / '+mmss(st.len)+' ('+Math.round(st.pct)+'%)';
        fill.parentElement.style.visibility='visible';
      }else{
        fill.style.width='0%'; fill.title=''; fill.parentElement.style.visibility='hidden';
      }
    });
  }
  document.addEventListener('DOMContentLoaded', paint);
  window.addEventListener('load', paint);
  if(grid){ new MutationObserver(paint).observe(grid,{childList:true,subtree:true}); }
  // Rescan button: id, [data-rescan], or visible text "Rescan"
  function bindRescan(){
    var byId=document.getElementById('rescanBtn');
    var byData=document.querySelector('[data-rescan]');
    var byText=null, els=document.querySelectorAll('button, a');
    for(var i=0;i<els.length;i++){ if((els[i].textContent||'').trim().toLowerCase()==='rescan'){ byText=els[i]; break; } }
    var btn=byId||byData||byText;
    if(btn && !btn.__boundRescan){
      btn.__boundRescan=true;
      btn.addEventListener('click', function(e){
        e.preventDefault();
        var old=btn.textContent; btn.textContent='Rescanning...'; btn.disabled=true;
        fetch('/api/refresh',{method:'GET',cache:'no-store'})
          .finally(function(){ btn.textContent=old; btn.disabled=false; location.reload(); });
      });
    }
  }
  document.addEventListener('DOMContentLoaded', bindRescan);
  window.addEventListener('load', bindRescan);
})();
