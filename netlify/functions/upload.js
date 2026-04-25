// netlify/functions/upload.js
// Receives file(s) as base64, commits them to GitHub via API

const https = require("https");

function githubRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.github.com",
      path,
      method,
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Netlify-FileVault",
        Accept: "application/vnd.github.v3+json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const GITHUB_REPO = process.env.GITHUB_REPO;
  const UPLOAD_PATH = process.env.UPLOAD_PATH || "uploads";

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing GitHub environment variables." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { fileName, fileData, fileType, fileSize } = payload;

  if (!fileName || !fileData) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing fileName or fileData" }) };
  }

  // Sanitize filename
  const safeName = fileName.replace(/[^a-zA-Z0-9._\-() ]/g, "_");
  const timestamp = Date.now();
  const uniqueName = `${timestamp}_${safeName}`;
  const filePath = `${UPLOAD_PATH}/${uniqueName}`;
  const apiPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;

  // Check if file already exists (to get SHA for update)
  const existing = await githubRequest("GET", apiPath, null, GITHUB_TOKEN);
  const sha = existing.status === 200 ? existing.body.sha : undefined;

  const commitBody = {
    message: `📁 Upload: ${safeName} (${new Date().toISOString()})`,
    content: fileData.includes(",") ? fileData.split(",")[1] : fileData,
    ...(sha ? { sha } : {}),
  };

  const result = await githubRequest("PUT", apiPath, commitBody, GITHUB_TOKEN);

  if (result.status === 200 || result.status === 201) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        fileName: safeName,
        storedAs: uniqueName,
        path: filePath,
        downloadUrl: result.body.content?.download_url || null,
        htmlUrl: result.body.content?.html_url || null,
        sha: result.body.content?.sha,
        size: fileSize,
        type: fileType,
        uploadedAt: new Date().toISOString(),
      }),
    };
  } else {
    return {
      statusCode: result.status,
      body: JSON.stringify({ error: result.body.message || "GitHub API error", detail: result.body }),
    };
  }
};
