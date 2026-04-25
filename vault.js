/* ═══════════════════════════════════════════════════
   FILEVAULT — SHARED UTILITIES  (vault.js)
   ═══════════════════════════════════════════════════ */

// ── FILE ICONS & TYPES ──────────────────────────────
const FILE_ICONS = {
  jpg:'🖼️',jpeg:'🖼️',png:'🖼️',gif:'🎞️',webp:'🖼️',svg:'🎨',avif:'🖼️',bmp:'🖼️',ico:'🖼️',heic:'🖼️',
  mp4:'🎬',mov:'🎬',avi:'🎬',mkv:'🎬',webm:'🎬',m4v:'🎬',flv:'🎬',wmv:'🎬',
  mp3:'🎵',wav:'🎵',ogg:'🎵',flac:'🎵',aac:'🎵',m4a:'🎵',wma:'🎵',opus:'🎵',
  pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📋',pptx:'📋',
  txt:'📄',md:'📝',rtf:'📝',odt:'📝',csv:'📊',
  js:'💻',ts:'💻',jsx:'💻',tsx:'💻',html:'🌐',css:'🎨',scss:'🎨',
  py:'🐍',java:'☕',cpp:'⚙️',c:'⚙️',cs:'💻',php:'💻',rb:'💻',
  go:'💻',rs:'⚙️',swift:'🍎',kt:'💻',dart:'💻',vue:'💻',
  json:'📋',xml:'📋',yaml:'📋',yml:'📋',toml:'📋',env:'🔐',sh:'⚙️',bat:'⚙️',
  zip:'📦',rar:'📦',tar:'📦',gz:'📦','7z':'📦',bz2:'📦',xz:'📦',
  exe:'⚙️',dmg:'💿',apk:'📱',iso:'💿',db:'🗄️',sql:'🗄️',
  fig:'🎨',sketch:'🎨',ai:'🎨',psd:'🎨',xd:'🎨',
  ttf:'🔤',otf:'🔤',woff:'🔤',woff2:'🔤',
};

const TYPE_GROUPS = {
  'Images': ['jpg','jpeg','png','gif','webp','svg','avif','bmp','ico','heic','psd','ai'],
  'Videos': ['mp4','mov','avi','mkv','webm','m4v','flv','wmv'],
  'Audio':  ['mp3','wav','ogg','flac','aac','m4a','wma','opus'],
  'Docs':   ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','rtf','odt','csv'],
  'Code':   ['js','ts','jsx','tsx','html','css','scss','py','java','cpp','c','cs','php','rb','go','rs','swift','kt','dart','vue','json','xml','yaml','yml','toml','env','sh','bat'],
  'Archives':['zip','rar','tar','gz','7z','bz2','xz'],
  'Design': ['fig','sketch','xd'],
  'Fonts':  ['ttf','otf','woff','woff2'],
};

const TYPE_ICONS = { Images:'🖼️',Videos:'🎬',Audio:'🎵',Docs:'📄',Code:'💻',Archives:'📦',Design:'🎨',Fonts:'🔤',Other:'📎' };

function getExt(name)  { return (name.split('.').pop() || '').toLowerCase(); }
function getIcon(name) { return FILE_ICONS[getExt(name)] || '📎'; }
function getGroup(name) {
  const ext = getExt(name);
  for (const [g, exts] of Object.entries(TYPE_GROUPS)) if (exts.includes(ext)) return g;
  return 'Other';
}

function isImage(name) { return ['jpg','jpeg','png','gif','webp','svg','avif','bmp','ico','heic'].includes(getExt(name)); }
function isVideo(name) { return ['mp4','webm','mov','m4v','avi'].includes(getExt(name)); }
function isAudio(name) { return ['mp3','wav','ogg','flac','aac','m4a','opus'].includes(getExt(name)); }
function isPDF(name)   { return getExt(name) === 'pdf'; }
function isText(name)  { return ['txt','md','json','xml','yaml','yml','toml','env','js','ts','jsx','tsx','html','css','py','rb','go','rs','sh','bat','csv','sql','log'].includes(getExt(name)); }

// ── FORMAT HELPERS ───────────────────────────────────
function formatBytes(b) {
  if (!b || b === 0) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}

function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso), now = new Date(), diff = now - d;
  if (diff < 60000)    return 'just now';
  if (diff < 3600000)  return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  if (diff < 604800000)return `${Math.floor(diff/86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function uid() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

// ── TOAST SYSTEM ─────────────────────────────────────
function toast(type, title, sub = '', duration = 4000) {
  let root = document.getElementById('toast-root');
  if (!root) { root = document.createElement('div'); root.id = 'toast-root'; document.body.appendChild(root); }
  const icons = { success:'✅', error:'❌', warn:'⚠️', info:'💡' };
  const el = document.createElement('div');
  el.className = `toast t-${type}`;
  el.innerHTML = `
    <div class="toast-icon">${icons[type] || '📢'}</div>
    <div class="toast-body">
      <strong>${title}</strong>
      ${sub ? `<span>${sub}</span>` : ''}
    </div>
    <button class="toast-dismiss" onclick="this.closest('.toast').remove()">✕</button>
  `;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('exiting');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── AUTH HELPERS ─────────────────────────────────────
const Auth = {
  KEY: 'fv_session',
  set(user)  { localStorage.setItem(this.KEY, JSON.stringify(user)); },
  get()      { try { return JSON.parse(localStorage.getItem(this.KEY)); } catch { return null; } },
  clear()    { localStorage.removeItem(this.KEY); },
  isAdmin()  { const u = this.get(); return u && u.role === 'admin'; },
  isLogged() { return !!this.get(); },
  require(redirect='login.html') {
    if (!this.isLogged()) { window.location.href = redirect; return false; }
    return true;
  },
  requireAdmin(redirect='login.html') {
    if (!this.isAdmin()) { window.location.href = redirect; return false; }
    return true;
  },
};

// ── API HELPERS ──────────────────────────────────────
async function api(endpoint, body = null, method = null) {
  const opts = {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const session = Auth.get();
  if (session) opts.headers['X-FV-User'] = JSON.stringify({ username: session.username, role: session.role });

  const res = await fetch(`/.netlify/functions/${endpoint}`, opts);
  const data = await res.json().catch(() => ({ error: 'Invalid response' }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── FILE CONVERSION ──────────────────────────────────
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ── MODAL HELPER ─────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeAllModals() { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });

// ── CONFIRM DIALOG ───────────────────────────────────
function showConfirm(title, message, onConfirm, danger = true) {
  let modal = document.getElementById('_confirm_modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = '_confirm_modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title" id="_cm_title"></span>
          <button class="modal-close" onclick="closeModal('_confirm_modal')">✕</button>
        </div>
        <div class="modal-body">
          <p id="_cm_msg" style="color:var(--text2);font-size:0.9rem;line-height:1.6"></p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" onclick="closeModal('_confirm_modal')">Cancel</button>
          <button class="btn btn-sm" id="_cm_ok"></button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('_cm_title').textContent = title;
  document.getElementById('_cm_msg').textContent   = message;
  const ok = document.getElementById('_cm_ok');
  ok.className = `btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`;
  ok.textContent = 'Confirm';
  ok.onclick = () => { closeModal('_confirm_modal'); onConfirm(); };
  openModal('_confirm_modal');
}

// ── CONTEXT MENU ─────────────────────────────────────
let _ctxMenu = null;
function showContextMenu(e, items) {
  e.preventDefault();
  if (_ctxMenu) _ctxMenu.remove();
  _ctxMenu = document.createElement('div');
  _ctxMenu.className = 'ctx-menu';
  items.forEach(item => {
    if (item === 'divider') {
      const d = document.createElement('div'); d.className = 'ctx-divider';
      _ctxMenu.appendChild(d);
    } else {
      const el = document.createElement('div');
      el.className = `ctx-item ${item.danger ? 'danger' : ''}`;
      el.innerHTML = `<span>${item.icon || ''}</span> ${item.label}`;
      el.onclick = () => { _ctxMenu?.remove(); item.action(); };
      _ctxMenu.appendChild(el);
    }
  });
  _ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  _ctxMenu.style.top  = Math.min(e.clientY, window.innerHeight - _ctxMenu.offsetHeight - 10) + 'px';
  document.body.appendChild(_ctxMenu);
  setTimeout(() => document.addEventListener('click', () => _ctxMenu?.remove(), { once: true }), 10);
}

// ── COPY TO CLIPBOARD ────────────────────────────────
function copyText(text, label = 'Copied!') {
  navigator.clipboard.writeText(text).then(() => toast('success', label));
}

// ── HEADER SCROLL EFFECT ─────────────────────────────
function initScrollHeader() {
  const h = document.querySelector('.site-header');
  if (!h) return;
  window.addEventListener('scroll', () => h.classList.toggle('scrolled', window.scrollY > 10));
}

// ── INIT COMMON ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initScrollHeader();
  // Mark active nav link
  document.querySelectorAll('.nav-link').forEach(a => {
    if (a.href === location.href) a.classList.add('active');
  });
});
