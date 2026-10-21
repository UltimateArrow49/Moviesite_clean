const u=[{start:"#12ffb0",end:"#0b6751",accent:"#031b16",detail:"#5bffe0",text:"#f7fff9"},{start:"#7f5bff",end:"#140031",accent:"#100824",detail:"#c5a9ff",text:"#f4f0ff"},{start:"#ff5f6d",end:"#ffc371",accent:"#2c070b",detail:"#ffb7a5",text:"#fff7f4"},{start:"#56ccf2",end:"#2f80ed",accent:"#05172b",detail:"#9ed8ff",text:"#f5fbff"},{start:"#f857a6",end:"#ff5858",accent:"#300616",detail:"#ff9dd3",text:"#fff3fa"}],f=new Map,x=[/^https?:\/\/i\.imgur\.com\//i];function d(e){return typeof e!="string"?"":e.trim()}function y(e){const t=d(e);if(!t)return"??";let n=t.replace(/[_-]+/g," ");try{n=n.replace(new RegExp("[^\\p{L}\\p{N}\\s]+","gu")," ")}catch{n=n.replace(/[^A-Za-z0-9\s]+/g," ")}if(n=n.replace(/\s+/g," ").trim(),!n)return"??";const r=n.split(" ").filter(Boolean);if(!r.length)return"??";if(r.length===1){const o=r[0].slice(0,2).toUpperCase();return o.length===1?o:o[0]+o[1]}return(r[0][0]+r[1][0]).toUpperCase()}function m(e){const t=e||"";let n=0;for(let r=0;r<t.length;r+=1)n=(n<<5)-n+t.charCodeAt(r),n|=0;return Math.abs(n)}function w(e){const t=m(e),n=t%u.length;return{palette:u[n],hash:t}}function L(e){return`data:image/svg+xml,${encodeURIComponent(e).replace(/'/g,"%27").replace(/\(/g,"%28").replace(/\)/g,"%29")}`}function b(e,t,n,r){const o=n==="square",c=o?240:320,a=o?240:180,l=o?56:36,s=Math.max(l-8,12),i=`grad${r}`,h=`noise${r}`,p=`glow${r}`,$=Math.round(a*.36);return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c} ${a}" role="img" aria-hidden="true">
    <defs>
      <linearGradient id="${i}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${t.start}" />
        <stop offset="100%" stop-color="${t.end}" />
      </linearGradient>
      <radialGradient id="${p}" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="${t.detail}" stop-opacity="0.55" />
        <stop offset="100%" stop-color="${t.detail}" stop-opacity="0" />
      </radialGradient>
      <pattern id="${h}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="14" height="14" fill="transparent" />
        <path d="M0 14L14 0M-4 10L4 2M10 18L18 10" stroke="${t.detail}" stroke-width="1" stroke-opacity="0.12" />
      </pattern>
    </defs>
    <rect x="0" y="0" width="${c}" height="${a}" rx="${l}" fill="${t.accent}" />
    <rect x="8" y="8" width="${c-16}" height="${a-16}" rx="${s}" fill="url(#${i})" />
    <rect x="8" y="8" width="${c-16}" height="${a-16}" rx="${s}" fill="url(#${h})" opacity="0.18" />
    <circle cx="${c/2}" cy="${a/2}" r="${Math.min(c,a)*.42}" fill="url(#${p})" />
    <text x="50%" y="50%" fill="${t.text}" font-family="'Inter','Segoe UI',sans-serif" font-size="${$}" font-weight="700" text-anchor="middle" dominant-baseline="middle" letter-spacing="0.08em">${e}</text>
  </svg>`}function P(e,t="landscape"){const n=d(e)||"channel",r=`${t}:${n.toLowerCase()}`;if(f.has(r))return f.get(r);const{palette:o,hash:c}=w(r),a=y(n),l=b(a,o,t,c),s=L(l);return f.set(r,s),s}function v(e){return x.some(t=>t.test(e))}function g(e,t,n={}){const r=n.aspect||"landscape",o=typeof t=="string"?t.trim():"";return o&&!v(o)?{url:o,isPlaceholder:!1}:{url:P(e,r),isPlaceholder:!0}}function C(e,t,n,r={}){if(!(e instanceof HTMLImageElement))return{isPlaceholder:!1};const{aspect:o="landscape",lazy:c=!0}=r,a=d(t)||"Channel",{url:l,isPlaceholder:s}=g(a,n,{aspect:o});return e.decoding="async",e.loading=c===!1?"eager":"lazy",e.referrerPolicy="no-referrer",e.src=l,e.alt=s?`${a} placeholder logo`:`${a} logo`,s?e.dataset.placeholder="true":(e.removeAttribute("data-placeholder"),e.addEventListener("error",()=>{const i=g(a,"",{aspect:o});e.src=i.url,e.alt=`${a} placeholder logo`,e.dataset.placeholder="true"},{once:!0})),{isPlaceholder:s}}function E(e,t,n={}){const r=document.createElement("img");return C(r,e,t,n),r}export{C as a,E as c};
