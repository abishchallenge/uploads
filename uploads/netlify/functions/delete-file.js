// netlify/functions/delete-file.js
// Deletes a file from the GitHub uploads folder

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
  if (event.httpMethod !== "DELETE" && event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const GITHUB_REPO = process.env.GITHUB_REPO;

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

  const { path: filePath, sha, fileName } = payload;

  if (!filePath || !sha) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing path or sha" }) };
  }

  const apiPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const result = await githubRequest(
    "DELETE",
    apiPath,
    {
      message: `🗑️ Delete: ${fileName || filePath} (${new Date().toISOString()})`,
      sha,
    },
    GITHUB_TOKEN
  );

  if (result.status === 200) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, deleted: filePath }),
    };
  } else {
    return {
      statusCode: result.status,
      body: JSON.stringify({ error: result.body.message || "GitHub API error" }),
    };
  }
};
