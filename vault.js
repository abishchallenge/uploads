/* ═══════════════════════════════
   FILEVAULT  shared utils  v2
   ═══════════════════════════════ */

/* ── FILE HELPERS ──────────────── */
const FILE_ICONS={jpg:'🖼️',jpeg:'🖼️',png:'🖼️',gif:'🎞️',webp:'🖼️',svg:'🎨',avif:'🖼️',bmp:'🖼️',ico:'🖼️',heic:'🖼️',mp4:'🎬',mov:'🎬',avi:'🎬',mkv:'🎬',webm:'🎬',m4v:'🎬',flv:'🎬',wmv:'🎬',mp3:'🎵',wav:'🎵',ogg:'🎵',flac:'🎵',aac:'🎵',m4a:'🎵',wma:'🎵',opus:'🎵',pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📋',pptx:'📋',txt:'📄',md:'📝',rtf:'📝',csv:'📊',js:'💻',ts:'💻',jsx:'💻',tsx:'💻',html:'🌐',css:'🎨',scss:'🎨',py:'🐍',java:'☕',cpp:'⚙️',c:'⚙️',cs:'💻',php:'💻',rb:'💻',go:'💻',rs:'⚙️',swift:'🍎',kt:'💻',dart:'💻',vue:'💻',json:'📋',xml:'📋',yaml:'📋',yml:'📋',toml:'📋',env:'🔐',sh:'⚙️',bat:'⚙️',zip:'📦',rar:'📦',tar:'📦',gz:'📦','7z':'📦',bz2:'📦',exe:'⚙️',dmg:'💿',apk:'📱',iso:'💿',db:'🗄️',sql:'🗄️',fig:'🎨',psd:'🎨',ai:'🎨',ttf:'🔤',otf:'🔤',woff:'🔤',woff2:'🔤'};
const TYPE_GROUPS={Images:['jpg','jpeg','png','gif','webp','svg','avif','bmp','ico','heic','psd','ai'],Videos:['mp4','mov','avi','mkv','webm','m4v','flv','wmv'],Audio:['mp3','wav','ogg','flac','aac','m4a','wma','opus'],Docs:['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','rtf','csv'],Code:['js','ts','jsx','tsx','html','css','scss','py','java','cpp','c','cs','php','rb','go','rs','swift','kt','dart','vue','json','xml','yaml','yml','toml','env','sh','bat'],Archives:['zip','rar','tar','gz','7z','bz2'],Design:['fig','sketch','xd','psd','ai'],Fonts:['ttf','otf','woff','woff2']};

function getExt(n){return(n.split('.').pop()||'').toLowerCase()}
function getIcon(n){return FILE_ICONS[getExt(n)]||'📎'}
function getGroup(n){const e=getExt(n);for(const[g,a]of Object.entries(TYPE_GROUPS))if(a.includes(e))return g;return'Other'}
function isImage(n){return['jpg','jpeg','png','gif','webp','svg','avif','bmp','ico','heic'].includes(getExt(n))}
function isVideo(n){return['mp4','webm','mov','m4v'].includes(getExt(n))}
function isAudio(n){return['mp3','wav','ogg','flac','aac','m4a','opus'].includes(getExt(n))}
function isPDF(n){return getExt(n)==='pdf'}
function isText(n){return['txt','md','json','xml','yaml','yml','toml','js','ts','html','css','py','sh','bat','csv','log','env'].includes(getExt(n))}

/* ── FORMAT ────────────────────── */
function fmtBytes(b){if(!b||b===0)return'0 B';const k=1024,s=['B','KB','MB','GB','TB'];const i=Math.floor(Math.log(b)/Math.log(k));return parseFloat((b/Math.pow(k,i)).toFixed(1))+' '+s[i]}
function timeAgo(iso){if(!iso)return'—';const d=new Date(iso),diff=Date.now()-d;if(diff<60000)return'just now';if(diff<3600000)return Math.floor(diff/60000)+'m ago';if(diff<86400000)return Math.floor(diff/3600000)+'h ago';if(diff<604800000)return Math.floor(diff/86400000)+'d ago';return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
function fmtDate(iso){if(!iso)return'—';return new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function uid(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36)}

/* ── AUTH ──────────────────────── */
const Auth={
  KEY:'fv2_session',
  set(u){localStorage.setItem(this.KEY,JSON.stringify(u))},
  get(){try{return JSON.parse(localStorage.getItem(this.KEY))}catch{return null}},
  clear(){localStorage.removeItem(this.KEY)},
  isAdmin(){const u=this.get();return u&&u.role==='admin'},
  logged(){return!!this.get()},
  guard(r='login.html'){if(!this.logged()){location.href=r;return false}return true},
  guardAdmin(r='login.html'){if(!this.isAdmin()){location.href=r;return false}return true}
};

/* ── API ───────────────────────── */
async function api(fn,body=null,method=null){
  const opts={method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json'}};
  const sess=Auth.get();
  if(sess)opts.headers['X-FV-Token']=JSON.stringify({u:sess.username,r:sess.role});
  if(body)opts.body=JSON.stringify(body);
  const res=await fetch(`/.netlify/functions/${fn}`,opts);
  const data=await res.json().catch(()=>({error:'Bad response'}));
  if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
  return data;
}

function fileToB64(f){return new Promise((ok,err)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=err;r.readAsDataURL(f)})}

/* ── TOAST ─────────────────────── */
function toast(type,title,sub='',ms=4200){
  let root=document.getElementById('toast-root');
  if(!root){root=document.createElement('div');root.id='toast-root';document.body.appendChild(root)}
  const icons={success:'✅',error:'❌',warn:'⚠️',info:'💡'};
  const el=document.createElement('div');
  el.className=`toast t-${type}`;
  el.innerHTML=`<div class="toast-icon">${icons[type]||'📢'}</div><div class="toast-body"><strong>${title}</strong>${sub?`<span>${sub}</span>`:''}</div><button class="toast-dismiss" onclick="this.closest('.toast').remove()">✕</button>`;
  root.appendChild(el);
  setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),300)},ms);
}

/* ── MODAL ─────────────────────── */
function openModal(id){document.getElementById(id)?.classList.add('open')}
function closeModal(id){document.getElementById(id)?.classList.remove('open')}
function closeAllModals(){document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open'))}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAllModals()});

/* ── CONFIRM ───────────────────── */
function confirm2(title,msg,cb,danger=true){
  let m=document.getElementById('_cm');
  if(!m){m=document.createElement('div');m.id='_cm';m.className='modal-overlay';m.innerHTML=`<div class="modal-box" style="max-width:400px"><div class="modal-header"><span class="modal-title" id="_cm_t"></span><button class="modal-close" onclick="closeModal('_cm')">✕</button></div><div class="modal-body"><p id="_cm_m" style="color:var(--text2);font-size:.88rem;line-height:1.6"></p></div><div class="modal-footer"><button class="btn btn-ghost btn-sm" onclick="closeModal('_cm')">Cancel</button><button class="btn btn-sm" id="_cm_ok"></button></div></div>`;document.body.appendChild(m)}
  document.getElementById('_cm_t').textContent=title;
  document.getElementById('_cm_m').textContent=msg;
  const ok=document.getElementById('_cm_ok');
  ok.className=`btn btn-sm ${danger?'btn-danger':'btn-primary'}`;
  ok.textContent='Confirm';
  ok.onclick=()=>{closeModal('_cm');cb()};
  openModal('_cm');
}

/* ── CONTEXT MENU ──────────────── */
let _ctx=null;
function ctxMenu(e,items){
  e.preventDefault();e.stopPropagation();
  if(_ctx)_ctx.remove();
  _ctx=document.createElement('div');_ctx.className='ctx-menu';
  items.forEach(item=>{
    if(item==='---'){const d=document.createElement('div');d.className='ctx-sep';_ctx.appendChild(d);return}
    const el=document.createElement('div');
    el.className=`ctx-item${item.danger?' danger':''}`;
    el.innerHTML=`<span>${item.icon||''}</span><span>${item.label}</span>`;
    el.onclick=()=>{_ctx?.remove();item.fn()};
    _ctx.appendChild(el);
  });
  const x=Math.min(e.clientX,window.innerWidth-190);
  const y=Math.min(e.clientY,window.innerHeight-300);
  _ctx.style.cssText=`left:${x}px;top:${y}px`;
  document.body.appendChild(_ctx);
  setTimeout(()=>document.addEventListener('click',()=>_ctx?.remove(),{once:true}),10);
}

/* ── FILE PATH DISPLAY ─────────── */
// Shows uploads/filename — never the full GitHub URL
function displayPath(file){
  const folder=file.folder?`${file.folder}/`:'';
  return `uploads/${folder}${file.originalName||file.storedName}`;
}

/* ── PREVIEW MODAL ─────────────── */
function showPreview(file,localUrl=null){
  const name=file.originalName||file.name||'';
  const src=localUrl||file.rawUrl||null; // rawUrl = GitHub raw content URL
  const modalId='_preview_modal';
  let m=document.getElementById(modalId);
  if(!m){
    m=document.createElement('div');m.id=modalId;m.className='modal-overlay';
    m.innerHTML=`<div class="modal-box" style="max-width:900px"><div class="modal-header"><div style="min-width:0"><div class="modal-title" id="_pv_title" style="font-size:.9rem;word-break:break-all"></div><div id="_pv_meta" style="font-size:.72rem;color:var(--muted);font-family:'DM Mono',monospace;margin-top:3px"></div></div><div style="display:flex;gap:8px;flex-shrink:0"><a id="_pv_open" class="btn btn-primary btn-sm" target="_blank" style="display:none">↗ Open</a><button class="modal-close" onclick="closeModal('${modalId}')">✕</button></div></div><div class="modal-body" id="_pv_body" style="padding:14px"></div></div>`;
    document.body.appendChild(m);
  }
  document.getElementById('_pv_title').textContent=name;
  document.getElementById('_pv_meta').textContent=`${fmtBytes(file.size||0)} • ${getExt(name).toUpperCase()||'FILE'} • ${displayPath(file)}`;
  const openBtn=document.getElementById('_pv_open');
  openBtn.style.display=src?'':'none';
  if(src)openBtn.href=src;
  const body=document.getElementById('_pv_body');
  if(isImage(name)&&src){body.innerHTML=`<img src="${src}" class="preview-img">`}
  else if(isVideo(name)&&src){body.innerHTML=`<video src="${src}" class="preview-video" controls autoplay muted></video>`}
  else if(isAudio(name)&&src){body.innerHTML=`<div class="preview-audio-wrap"><div style="font-size:5rem">🎵</div><div style="color:var(--text2);margin:10px 0">${name}</div><audio src="${src}" controls></audio></div>`}
  else if(isPDF(name)&&src){body.innerHTML=`<iframe src="${src}" class="preview-pdf"></iframe>`}
  else if(isText(name)&&src){body.innerHTML=`<div class="preview-code">Loading…</div>`;fetch(src).then(r=>r.text()).then(t=>{body.querySelector('.preview-code').textContent=t.slice(0,8000)+(t.length>8000?'\n…(truncated)':'')})}
  else{body.innerHTML=`<div class="preview-none"><span class="pi">${getIcon(name)}</span><p style="color:var(--text2)">Preview not available for <strong>.${getExt(name)}</strong> files</p>${src?`<a href="${src}" class="btn btn-primary btn-sm" target="_blank" style="margin-top:14px">⬇️ Download</a>`:''}</div>`}
  openModal(modalId);
}

/* ── HEADER SCROLL ─────────────── */
function initHeader(){
  const h=document.querySelector('.site-header');
  if(!h)return;
  const check=()=>h.classList.toggle('scrolled',scrollY>8);
  window.addEventListener('scroll',check,{passive:true});check();
  // hamburger
  const hbg=document.querySelector('.hamburger');
  const nav=document.querySelector('.main-nav');
  if(hbg&&nav){hbg.addEventListener('click',()=>{nav.classList.toggle('open');hbg.setAttribute('aria-expanded',nav.classList.contains('open'))})}
  // mark active link
  document.querySelectorAll('.nav-link').forEach(a=>{
    if(a.href&&location.pathname.endsWith(new URL(a.href,location.href).pathname))a.classList.add('active')
  });
}

/* ── INJECT HEADER HTML ────────── */
function buildHeader(activePage){
  const sess=Auth.get();
  const isAdmin=sess?.role==='admin';
  const nav=[
    {href:'index.html',label:'⬆️ Upload'},
    {href:'dashboard.html',label:'🗄️ My Files'},
    {href:'public.html',label:'🌐 Public'},
  ];
  if(isAdmin)nav.push({href:'admin.html',label:'⚙️ Admin',cls:'admin-link'});
  const links=nav.map(n=>`<a href="${n.href}" class="nav-link${n.cls?' '+n.cls:''}${activePage===n.href?' active':''}">${n.label}</a>`).join('');
  const avatar=sess?(sess.displayName||sess.username).slice(0,2).toUpperCase():'?';
  const userSection=sess?`
    <div class="user-chip" onclick="location.href='account.html'">
      <div class="av av-sm" id="hdr-av">${sess.avatarUrl?`<img src="${sess.avatarUrl}">`:`<span>${avatar}</span>`}</div>
      <span class="hide-sm" style="font-size:.8rem;color:var(--text2)">${sess.displayName||sess.username}</span>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="logoutNow()">Sign out</button>
  `:`<a href="login.html" class="btn btn-primary btn-sm">Sign in</a>`;
  const hdr=document.querySelector('.site-header');
  if(hdr)hdr.innerHTML=`<div class="header-inner"><a href="index.html" class="logo"><div class="logo-icon">📦</div>File<em>Vault</em></a><button class="hamburger" aria-label="Menu"><span></span><span></span><span></span></button><nav class="main-nav">${links}</nav><div class="header-right">${userSection}</div></div>`;
  initHeader();
}

function logoutNow(){Auth.clear();location.href='login.html'}

document.addEventListener('DOMContentLoaded',()=>{
  // Close nav on link click (mobile)
  document.querySelectorAll('.main-nav .nav-link').forEach(a=>{a.addEventListener('click',()=>document.querySelector('.main-nav')?.classList.remove('open'))});
});
