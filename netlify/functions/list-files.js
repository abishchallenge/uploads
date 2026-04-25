// netlify/functions/list-files.js
// Lists all files in the uploads folder from GitHub

const https = require("https");

function githubRequest(method, path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path,
      method,
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "Netlify-FileVault",
        Accept: "application/vnd.github.v3+json",
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
    req.end();
  });
}

exports.handler = async (event) => {
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

  const apiPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${UPLOAD_PATH}`;
  const result = await githubRequest("GET", apiPath, GITHUB_TOKEN);

  if (result.status === 404) {
    // Folder doesn't exist yet — return empty list
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [] }),
    };
  }

  if (result.status !== 200) {
    return {
      statusCode: result.status,
      body: JSON.stringify({ error: result.body.message || "GitHub API error" }),
    };
  }

  const files = Array.isArray(result.body)
    ? result.body
        .filter((f) => f.type === "file")
        .map((f) => {
          // Extract original name and timestamp from stored filename
          const match = f.name.match(/^(\d+)_(.+)$/);
          return {
            name: f.name,
            originalName: match ? match[2] : f.name,
            uploadedAt: match ? new Date(parseInt(match[1])).toISOString() : null,
            size: f.size,
            sha: f.sha,
            downloadUrl: f.download_url,
            htmlUrl: f.html_url,
            path: f.path,
          };
        })
        .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""))
    : [];

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  };
};
