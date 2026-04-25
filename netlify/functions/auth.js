// netlify/functions/auth.js
// Handles user registration, login, and admin user management
// Users stored in GitHub: uploads/_meta/users.json
const https = require('https');
const crypto = require('crypto');

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

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'fv_salt_2024').digest('hex');
}

async function readUsers(owner, repo, uploadPath, token) {
  const p = `/repos/${owner}/${repo}/contents/${uploadPath}/_meta/users.json`;
  const r = await ghReq('GET', p, null, token);
  if (r.status === 200) {
    const txt = Buffer.from(r.body.content.replace(/\n/g,''), 'base64').toString('utf8');
    return { users: JSON.parse(txt).users || [], sha: r.body.sha, path: p };
  }
  return { users: [], sha: null, path: p };
}

async function writeUsers(store, users, token) {
  const content = Buffer.from(JSON.stringify({ users, updatedAt: new Date().toISOString() })).toString('base64');
  return ghReq('PUT', store.path, { message: '👤 FileVault: update users', content, ...(store.sha ? { sha: store.sha } : {}) }, token);
}

exports.handler = async (event) => {
  const { GITHUB_TOKEN: TOKEN, GITHUB_OWNER: OWNER, GITHUB_REPO: REPO } = process.env;
  const UPLOAD_PATH = process.env.UPLOAD_PATH || 'uploads';
  const ADMIN_USER  = process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'admin123';
  if (!TOKEN || !OWNER || !REPO) return { statusCode: 500, body: JSON.stringify({ error: 'Missing GitHub env vars' }) };

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  let p; try { p = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  const { action } = p;

  // ── LOGIN ────────────────────────────────────────
  if (action === 'login') {
    const { username, password } = p;
    // Check admin credentials (from env)
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, user: { username: ADMIN_USER, role: 'admin', displayName: 'Administrator', email: '' } }) };
    }
    const store = await readUsers(OWNER, REPO, UPLOAD_PATH, TOKEN);
    const user = store.users.find(u => u.username === username);
    if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'User not found' }) };
    if (user.password !== hashPassword(password)) return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect password' }) };
    if (user.banned) return { statusCode: 403, body: JSON.stringify({ error: 'Account suspended' }) };
    const { password: _, ...safeUser } = user;
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, user: safeUser }) };
  }

  // ── REGISTER ─────────────────────────────────────
  if (action === 'register') {
    const { username, password, displayName, email } = p;
    if (!username || !password) return { statusCode: 400, body: JSON.stringify({ error: 'Username and password required' }) };
    if (username.length < 3) return { statusCode: 400, body: JSON.stringify({ error: 'Username must be 3+ characters' }) };
    if (password.length < 6) return { statusCode: 400, body: JSON.stringify({ error: 'Password must be 6+ characters' }) };
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return { statusCode: 400, body: JSON.stringify({ error: 'Username: letters, numbers, _ - only' }) };
    if (username === ADMIN_USER) return { statusCode: 400, body: JSON.stringify({ error: 'Username not available' }) };

    const store = await readUsers(OWNER, REPO, UPLOAD_PATH, TOKEN);
    if (store.users.find(u => u.username === username)) return { statusCode: 409, body: JSON.stringify({ error: 'Username already taken' }) };

    const newUser = {
      username, password: hashPassword(password),
      displayName: displayName || username,
      email: email || '', role: 'user',
      createdAt: new Date().toISOString(),
      banned: false, storageUsed: 0,
      avatar: username.slice(0,2).toUpperCase(),
    };
    store.users.push(newUser);
    await writeUsers(store, store.users, TOKEN);
    const { password: _, ...safeUser } = newUser;
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, user: safeUser }) };
  }

  // ── LIST USERS (admin) ───────────────────────────
  if (action === 'list_users') {
    const store = await readUsers(OWNER, REPO, UPLOAD_PATH, TOKEN);
    const safe = store.users.map(({ password, ...u }) => u);
    return { statusCode: 200, headers, body: JSON.stringify({ users: safe }) };
  }

  // ── BAN / UNBAN (admin) ──────────────────────────
  if (action === 'ban' || action === 'unban') {
    const store = await readUsers(OWNER, REPO, UPLOAD_PATH, TOKEN);
    const idx = store.users.findIndex(u => u.username === p.targetUsername);
    if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    store.users[idx].banned = action === 'ban';
    await writeUsers(store, store.users, TOKEN);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // ── DELETE USER (admin) ──────────────────────────
  if (action === 'delete_user') {
    const store = await readUsers(OWNER, REPO, UPLOAD_PATH, TOKEN);
    store.users = store.users.filter(u => u.username !== p.targetUsername);
    await writeUsers(store, store.users, TOKEN);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // ── UPDATE PROFILE ───────────────────────────────
  if (action === 'update_profile') {
    const store = await readUsers(OWNER, REPO, UPLOAD_PATH, TOKEN);
    const idx = store.users.findIndex(u => u.username === p.username);
    if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    if (p.displayName) store.users[idx].displayName = p.displayName;
    if (p.email)       store.users[idx].email = p.email;
    if (p.newPassword) store.users[idx].password = hashPassword(p.newPassword);
    await writeUsers(store, store.users, TOKEN);
    const { password: _, ...safeUser } = store.users[idx];
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, user: safeUser }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
