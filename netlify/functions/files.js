// netlify/functions/files.js
// GET /files — list files with filters
// POST /files — update metadata (rating, comment, download, favourite, rename, delete, move)
const https = require('https');

function ghReq(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.github.com', path, method,
      headers: {
        Authorization: `token ${token}`, 'User-Agent': 'FileVault',
        Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, body: raw }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function readMeta(owner, repo, uploadPath, token) {
  const p = `/repos/${owner}/${repo}/contents/${uploadPath}/_meta/index.json`;
  const r = await ghReq('GET', p, null, token);
  if (r.status === 200) {
    const txt = Buffer.from(r.body.content.replace(/\n/g,''), 'base64').toString('utf8');
    return { files: JSON.parse(txt).files || [], sha: r.body.sha, path: p };
  }
  return { files: [], sha: null, path: p };
}

async function writeMeta(meta, token) {
  const content = Buffer.from(JSON.stringify({ files: meta.files, updatedAt: new Date().toISOString() })).toString('base64');
  const body = { message: '🗂️ FileVault meta update', content, ...(meta.sha ? { sha: meta.sha } : {}) };
  return ghReq('PUT', meta.path, body, token);
}

function pruneExpired(files) {
  const now = new Date();
  return files.filter(f => !f.expiresAt || new Date(f.expiresAt) > now);
}

exports.handler = async (event) => {
  const { GITHUB_TOKEN: TOKEN, GITHUB_OWNER: OWNER, GITHUB_REPO: REPO } = process.env;
  const UPLOAD_PATH = process.env.UPLOAD_PATH || 'uploads';
  if (!TOKEN || !OWNER || !REPO) return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // ── GET: list files ──────────────────────────────
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    const meta = await readMeta(OWNER, REPO, UPLOAD_PATH, TOKEN);
    let files = pruneExpired(meta.files);

    // Filters
    if (q.folder)   files = files.filter(f => (f.folder||'') === q.folder);
    if (q.user)     files = files.filter(f => f.uploadedBy === q.user);
    if (q.tag)      files = files.filter(f => (f.tags||[]).includes(q.tag));
    if (q.type)     files = files.filter(f => f.group === q.type);
    if (q.public === 'true') files = files.filter(f => f.isPublic);
    if (q.search)   { const s = q.search.toLowerCase(); files = files.filter(f => f.originalName.toLowerCase().includes(s)); }

    // Stats
    const totalSize = files.reduce((a,f) => a+(f.size||0), 0);
    const today = new Date().toDateString();
    const todayCount = files.filter(f => f.uploadedAt && new Date(f.uploadedAt).toDateString()===today).length;
    const folders = [...new Set(files.map(f=>f.folder).filter(Boolean))];

    return { statusCode: 200, headers, body: JSON.stringify({ files, totalSize, todayCount, folders, total: files.length }) };
  }

  // ── POST: mutation ───────────────────────────────
  if (event.httpMethod === 'POST') {
    let p; try { p = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
    const { action, fileId, username } = p;
    const meta = await readMeta(OWNER, REPO, UPLOAD_PATH, TOKEN);
    const idx = meta.files.findIndex(f => f.id === fileId);

    if (action === 'delete') {
      // Delete from GitHub
      const file = meta.files[idx];
      if (!file) return { statusCode: 404, body: JSON.stringify({ error: 'File not found' }) };
      await ghReq('DELETE', `/repos/${OWNER}/${REPO}/contents/${file.path}`, { message: `🗑️ Delete: ${file.originalName}`, sha: file.sha }, TOKEN);
      meta.files.splice(idx, 1);
      await writeMeta(meta, TOKEN);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (action === 'rename') {
      if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
      meta.files[idx].originalName = p.newName.replace(/[^a-zA-Z0-9._\-()\s]/g,'_');
      await writeMeta(meta, TOKEN);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, file: meta.files[idx] }) };
    }

    if (action === 'move') {
      if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
      meta.files[idx].folder = p.newFolder || '';
      await writeMeta(meta, TOKEN);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (action === 'rate') {
      if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
      const f = meta.files[idx];
      if (!f.rating) f.rating = { total: 0, count: 0, avg: 0 };
      f.rating.total += p.stars;
      f.rating.count += 1;
      f.rating.avg = parseFloat((f.rating.total / f.rating.count).toFixed(1));
      await writeMeta(meta, TOKEN);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, rating: f.rating }) };
    }

    if (action === 'comment') {
      if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
      const comment = { id: Date.now().toString(), username: username || 'anon', text: p.text, at: new Date().toISOString() };
      if (!meta.files[idx].comments) meta.files[idx].comments = [];
      meta.files[idx].comments.push(comment);
      await writeMeta(meta, TOKEN);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, comment }) };
    }

    if (action === 'favourite') {
      if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
      if (!meta.files[idx].favouritedBy) meta.files[idx].favouritedBy = [];
      const fi = meta.files[idx].favouritedBy.indexOf(username);
      if (fi > -1) meta.files[idx].favouritedBy.splice(fi, 1);
      else meta.files[idx].favouritedBy.push(username);
      await writeMeta(meta, TOKEN);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, favouritedBy: meta.files[idx].favouritedBy }) };
    }

    if (action === 'download') {
      if (idx >= 0) { meta.files[idx].downloads = (meta.files[idx].downloads || 0) + 1; await writeMeta(meta, TOKEN); }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (action === 'expiry') {
      if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
      meta.files[idx].expiresAt = p.expiresAt || null;
      await writeMeta(meta, TOKEN);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (action === 'toggle_public') {
      if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
      meta.files[idx].isPublic = !meta.files[idx].isPublic;
      await writeMeta(meta, TOKEN);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, isPublic: meta.files[idx].isPublic }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
