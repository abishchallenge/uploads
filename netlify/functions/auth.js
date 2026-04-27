// netlify/functions/auth.js
// Handles: login, register, forgot, reset_password, update_profile, delete_account
// list_users, admin_user, get_logs
// Users stored at: uploads/_meta/users.json
// Logs stored at:  uploads/_meta/logs.json

'use strict';
const https  = require('https');
const crypto = require('crypto');

const TOKEN  = process.env.GITHUB_TOKEN;
const OWNER  = process.env.GITHUB_OWNER;
const REPO   = process.env.GITHUB_REPO;
const UP     = process.env.UPLOAD_PATH || 'uploads';
const ADMIN_U = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_P = process.env.ADMIN_PASSWORD || 'admin123';

const HDRS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-FV-Token',
};

// ── GitHub helper ─────────────────────────────────────────
function ghReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        Authorization: `token ${TOKEN}`,
        'User-Agent': 'FileVault-2',
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Read/Write JSON from GitHub ───────────────────────────
async function readGHJSON(repoPath) {
  const r = await ghReq('GET', `/repos/${OWNER}/${REPO}/contents/${repoPath}`, null);
  if (r.status === 200 && r.body && r.body.content) {
    try {
      const raw = Buffer.from(r.body.content.replace(/\n/g, ''), 'base64').toString('utf8');
      return { data: JSON.parse(raw), sha: r.body.sha };
    } catch (e) {
      return { data: null, sha: r.body.sha };
    }
  }
  return { data: null, sha: null };
}

async function writeGHJSON(repoPath, data, sha, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const body = { message, content };
  if (sha) body.sha = sha;
  return ghReq('PUT', `/repos/${OWNER}/${REPO}/contents/${repoPath}`, body);
}

// ── Paths ─────────────────────────────────────────────────
const USERS_FILE = `${UP}/_meta/users.json`;
const LOGS_FILE  = `${UP}/_meta/logs.json`;

// ── Load users (safe — returns [] if file missing) ────────
async function loadUsers() {
  const { data, sha } = await readGHJSON(USERS_FILE);
  return {
    users: Array.isArray(data?.users) ? data.users : [],
    sha,
  };
}

async function saveUsers(users, sha) {
  return writeGHJSON(
    USERS_FILE,
    { users, updatedAt: new Date().toISOString() },
    sha,
    '👤 FileVault: users update',
  );
}

// ── Append a log entry (fire-and-forget safe) ─────────────
async function appendLog(entry) {
  try {
    const { data, sha } = await readGHJSON(LOGS_FILE);
    const logs = Array.isArray(data?.logs) ? data.logs : [];
    logs.unshift({ ...entry, at: new Date().toISOString(), id: Date.now().toString(36) });
    if (logs.length > 500) logs.length = 500;
    await writeGHJSON(LOGS_FILE, { logs }, sha, '📋 FileVault: log entry');
  } catch (_) {
    // Non-critical — never let logging crash the main operation
  }
}

// ── Password hashing ──────────────────────────────────────
function hashPw(pw) {
  return crypto.createHash('sha256').update(pw + 'fv2_s@lt_2024').digest('hex');
}

// ── Strip password before returning user ──────────────────
function safeUser(u) {
  const { password, ...rest } = u;
  return rest;
}

// ── Response helpers ──────────────────────────────────────
const ok  = body => ({ statusCode: 200, headers: HDRS, body: JSON.stringify(body) });
const err = (code, msg) => ({ statusCode: code, headers: HDRS, body: JSON.stringify({ error: msg }) });

// ═════════════════════════════════════════════════════════
// MAIN HANDLER
// ═════════════════════════════════════════════════════════
exports.handler = async event => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HDRS, body: '' };
  if (event.httpMethod !== 'POST')    return err(405, 'Method not allowed');

  // Env check
  if (!TOKEN || !OWNER || !REPO) {
    return err(500, 'Missing GitHub env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO');
  }

  // Parse body
  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return err(400, 'Invalid JSON body'); }

  const { action } = p;
  if (!action) return err(400, 'Missing action');

  // ── LOGIN ─────────────────────────────────────────────
  if (action === 'login') {
    const { username, password } = p;
    if (!username || !password) return err(400, 'Username and password required');

    // Admin shortcut (credentials from env)
    if (username === ADMIN_U && password === ADMIN_P) {
      await appendLog({ type: 'login', username: ADMIN_U, detail: 'Admin login' });
      return ok({
        success: true,
        user: { username: ADMIN_U, role: 'admin', displayName: 'Administrator', email: '', avatarUrl: null, bio: '' },
      });
    }

    const { users } = await loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) return err(401, 'Username not found');
    if (user.password !== hashPw(password)) return err(401, 'Incorrect password');
    if (user.banned) return err(403, 'Account suspended. Contact admin.');

    await appendLog({ type: 'login', username, detail: 'User login' });
    return ok({ success: true, user: safeUser(user) });
  }

  // ── REGISTER ──────────────────────────────────────────
  if (action === 'register') {
    const { username, password, displayName, email, recoveryHint = '' } = p;
    if (!username || !password) return err(400, 'Username and password required');
    if (username.length < 3) return err(400, 'Username must be at least 3 characters');
    if (password.length < 6) return err(400, 'Password must be at least 6 characters');
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return err(400, 'Username: letters, numbers, _ and - only');
    if (username === ADMIN_U) return err(400, 'Username not available');

    const { users, sha } = await loadUsers();
    if (users.find(u => u.username === username)) return err(409, 'Username already taken');

    const newUser = {
      username,
      password: hashPw(password),
      displayName: displayName || username,
      email: email || '',
      bio: '',
      role: 'user',
      createdAt: new Date().toISOString(),
      banned: false,
      storageUsed: 0,
      avatarUrl: null,
      recoveryHint,
    };

    users.push(newUser);
    const wr = await saveUsers(users, sha);
    if (wr.status !== 200 && wr.status !== 201) {
      return err(500, 'Failed to save user: ' + (wr.body?.message || 'GitHub error'));
    }

    await appendLog({ type: 'register', username, detail: 'New registration' });
    return ok({ success: true, user: safeUser(newUser) });
  }

  // ── FORGOT PASSWORD ───────────────────────────────────
  if (action === 'forgot') {
    const { username } = p;
    if (!username) return err(400, 'Username required');
    const { users } = await loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) return err(404, 'Username not found');
    return ok({ hint: user.recoveryHint || 'No hint set. Please contact admin.' });
  }

  // ── RESET PASSWORD ────────────────────────────────────
  if (action === 'reset_password') {
    const { username, recoveryHint, newPassword } = p;
    if (!username || !recoveryHint || !newPassword) return err(400, 'All fields required');
    if (newPassword.length < 6) return err(400, 'Password must be 6+ characters');
    const { users, sha } = await loadUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx < 0) return err(404, 'User not found');
    if (users[idx].recoveryHint !== recoveryHint) return err(401, 'Recovery hint does not match');
    users[idx].password = hashPw(newPassword);
    await saveUsers(users, sha);
    return ok({ success: true });
  }

  // ── UPDATE PROFILE ────────────────────────────────────
  if (action === 'update_profile') {
    const { username, displayName, email, bio, currentPassword, newPassword, avatarUrl, newUsername } = p;
    if (!username) return err(400, 'Username required');
    const { users, sha } = await loadUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx < 0) return err(404, 'User not found');

    // Sensitive changes require current password
    if (newPassword || newUsername) {
      if (!currentPassword) return err(400, 'Current password required for this change');
      if (users[idx].password !== hashPw(currentPassword)) return err(401, 'Current password incorrect');
    }

    // Change username
    if (newUsername) {
      if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) return err(400, 'Invalid username format');
      if (newUsername.length < 3) return err(400, 'Username must be 3+ characters');
      if (newUsername === ADMIN_U) return err(400, 'Username not available');
      if (users.find((u, i) => u.username === newUsername && i !== idx)) return err(409, 'Username already taken');
      users[idx].username = newUsername;
    }

    if (displayName !== undefined) users[idx].displayName = displayName;
    if (email      !== undefined) users[idx].email        = email;
    if (bio        !== undefined) users[idx].bio          = bio;
    if (newPassword)              users[idx].password     = hashPw(newPassword);
    if (avatarUrl  !== undefined) users[idx].avatarUrl    = avatarUrl;

    await saveUsers(users, sha);
    await appendLog({ type: 'profile_update', username, detail: 'Profile updated' });
    return ok({ success: true, user: safeUser(users[idx]) });
  }

  // ── DELETE ACCOUNT ────────────────────────────────────
  if (action === 'delete_account') {
    const { username, password } = p;
    if (!username || !password) return err(400, 'Username and password required');
    const { users, sha } = await loadUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx < 0) return err(404, 'User not found');
    if (users[idx].password !== hashPw(password)) return err(401, 'Incorrect password');
    users.splice(idx, 1);
    await saveUsers(users, sha);
    await appendLog({ type: 'delete_account', username, detail: 'Account deleted' });
    return ok({ success: true });
  }

  // ── LIST USERS (admin) ────────────────────────────────
  if (action === 'list_users') {
    const { users } = await loadUsers();
    return ok({ users: users.map(safeUser) });
  }

  // ── ADMIN USER OP (ban/unban/delete/make_admin/make_user) ─
  if (action === 'admin_user') {
    const { target, op } = p;
    if (!target || !op) return err(400, 'Missing target or op');
    const { users, sha } = await loadUsers();
    const idx = users.findIndex(u => u.username === target);
    if (idx < 0) return err(404, 'User not found');

    switch (op) {
      case 'ban':        users[idx].banned = true;         break;
      case 'unban':      users[idx].banned = false;        break;
      case 'delete':     users.splice(idx, 1);             break;
      case 'make_admin': users[idx].role   = 'admin';      break;
      case 'make_user':  users[idx].role   = 'user';       break;
      default: return err(400, 'Unknown op: ' + op);
    }

    await saveUsers(users, sha);
    await appendLog({ type: `admin_${op}`, username: target, detail: `Admin action: ${op}` });
    return ok({ success: true });
  }

  // ── GET LOGS (admin) ──────────────────────────────────
  if (action === 'get_logs') {
    const { data } = await readGHJSON(LOGS_FILE);
    return ok({ logs: Array.isArray(data?.logs) ? data.logs : [] });
  }

  return err(400, `Unknown action: "${action}"`);
};
