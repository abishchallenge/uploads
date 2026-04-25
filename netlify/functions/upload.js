// netlify/functions/upload.js
const https = require('https');
const MAX_MB = 50;

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
  const path = `/repos/${owner}/${repo}/contents/${uploadPath}/_meta/index.json`;
  const r = await ghReq('GET', path, null, token);
  if (r.status === 200) {
    const content = Buffer.from(r.body.content.replace(/\n/g,''), 'base64').toString('utf8');
    return { files: JSON.parse(content).files || [], sha: r.body.sha, path };
  }
  return { files: [], sha: null, path };
}

async function writeMeta(meta, token) {
  const content = Buffer.from(JSON.stringify({ files: meta.files, updatedAt: new Date().toISOString() })).toString('base64');
  const body = { message: '🗂️ FileVault: update index', content, ...(meta.sha ? { sha: meta.sha } : {}) };
  return ghReq('PUT', meta.path, body, token);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  const { GITHUB_TOKEN: TOKEN, GITHUB_OWNER: OWNER, GITHUB_REPO: REPO } = process.env;
  const UPLOAD_PATH = process.env.UPLOAD_PATH || 'uploads';
  if (!TOKEN || !OWNER || !REPO) return { statusCode: 500, body: JSON.stringify({ error: 'Missing GitHub env vars (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO)' }) };

  let p; try { p = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  const { fileName, fileData, fileType, fileSize, folder, expiresAt, uploadedBy = 'anonymous', isPublic = true, tags = [] } = p;
  if (!fileName || !fileData) return { statusCode: 400, body: JSON.stringify({ error: 'Missing fileName or fileData' }) };

  const b64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
  const estBytes = Math.ceil(b64.length * 0.75);
  if (estBytes > MAX_MB * 1024 * 1024) return { statusCode: 413, body: JSON.stringify({ error: `File exceeds ${MAX_MB}MB limit (estimated ${Math.ceil(estBytes/1048576)}MB)` }) };

  const safeName = fileName.replace(/[^a-zA-Z0-9._\-()\s]/g, '_');
  const ts = Date.now();
  const storedName = `${ts}_${safeName}`;
  const subDir = folder ? `${UPLOAD_PATH}/${folder.replace(/[^a-zA-Z0-9_-]/g,'_')}` : UPLOAD_PATH;
  const filePath = `${subDir}/${storedName}`;
  const apiPath = `/repos/${OWNER}/${REPO}/contents/${filePath}`;

  // Get existing SHA if file exists
  const existing = await ghReq('GET', apiPath, null, TOKEN);
  const sha = existing.status === 200 ? existing.body.sha : undefined;

  // Upload file
  const uploadRes = await ghReq('PUT', apiPath, {
    message: `📁 Upload: ${safeName}`,
    content: b64,
    ...(sha ? { sha } : {}),
  }, TOKEN);

  if (uploadRes.status !== 200 && uploadRes.status !== 201) {
    const msg = typeof uploadRes.body === 'object' ? uploadRes.body.message : 'GitHub API error';
    return { statusCode: uploadRes.status, body: JSON.stringify({ error: msg }) };
  }

  const record = {
    id: `fv${ts}${Math.random().toString(36).slice(2,6)}`,
    originalName: safeName, storedName, path: filePath, folder: folder || '',
    size: fileSize || estBytes, type: fileType || '',
    sha: uploadRes.body.content?.sha,
    downloadUrl: uploadRes.body.content?.download_url,
    htmlUrl: uploadRes.body.content?.html_url,
    uploadedAt: new Date().toISOString(),
    uploadedBy, isPublic, tags,
    expiresAt: expiresAt || null,
    downloads: 0, rating: { avg: 0, count: 0, total: 0 },
    comments: [], favouritedBy: [],
  };

  // Update metadata index
  const meta = await readMeta(OWNER, REPO, UPLOAD_PATH, TOKEN);
  meta.files.unshift(record);
  await writeMeta(meta, TOKEN);

  // Update user upload history
  if (uploadedBy && uploadedBy !== 'anonymous') {
    const userMetaPath = `/repos/${OWNER}/${REPO}/contents/${UPLOAD_PATH}/_meta/users/${uploadedBy}.json`;
    const ur = await ghReq('GET', userMetaPath, null, TOKEN);
    let userData = { uploads: [], totalSize: 0 };
    let userSHA = null;
    if (ur.status === 200) {
      userData = JSON.parse(Buffer.from(ur.body.content.replace(/\n/g,''), 'base64').toString('utf8'));
      userSHA = ur.body.sha;
    }
    userData.uploads.unshift({ id: record.id, name: safeName, size: record.size, uploadedAt: record.uploadedAt });
    userData.totalSize = (userData.totalSize || 0) + record.size;
    const uc = Buffer.from(JSON.stringify(userData)).toString('base64');
    await ghReq('PUT', userMetaPath, { message: `👤 User upload: ${uploadedBy}`, content: uc, ...(userSHA ? { sha: userSHA } : {}) }, TOKEN);
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, file: record }) };
};
