const OWNER = String(process.env.GITHUB_OWNER || '').trim();
const REPO = String(process.env.GITHUB_REPO || '').trim();
const BRANCH = String(process.env.GITHUB_BRANCH || 'main').trim();
const TOKEN = String(process.env.GITHUB_TOKEN || '').trim();

function configured() {
  return Boolean(OWNER && REPO && BRANCH && TOKEN);
}

function status() {
  return {
    githubSyncConfigured: configured(),
    owner: OWNER || null,
    repo: REPO || null,
    branch: BRANCH || null,
    note: configured()
      ? 'Изменения сохраняются в GitHub и переживают перезапуск Render.'
      : 'GitHub-синхронизация не настроена. Изменения могут пропасть после redeploy/restart Render.'
  };
}

async function githubRequest(method, apiPath, body) {
  if (!configured()) {
    return { ok: false, configured: false, skipped: true, error: 'GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO не настроены' };
  }

  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'deli-berry-catalog-admin'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_error) { data = { raw: text }; }

  if (!response.ok) {
    const message = data?.message || `GitHub API error ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function getCurrentSha(filePath) {
  try {
    const encoded = filePath.split('/').map(encodeURIComponent).join('/');
    const data = await githubRequest('GET', `/repos/${OWNER}/${REPO}/contents/${encoded}?ref=${encodeURIComponent(BRANCH)}`);
    return data?.sha || null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function commitFile(filePath, buffer, message) {
  if (!configured()) return { ok: false, configured: false, skipped: true, path: filePath };
  const sha = await getCurrentSha(filePath);
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  const payload = {
    message: message || `update ${filePath}`,
    content: Buffer.from(buffer).toString('base64'),
    branch: BRANCH
  };
  if (sha) payload.sha = sha;
  const data = await githubRequest('PUT', `/repos/${OWNER}/${REPO}/contents/${encoded}`, payload);
  return { ok: true, configured: true, path: filePath, commit: data?.commit?.sha || null, url: data?.content?.html_url || null };
}

async function commitJsonFile(filePath, value, message) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  return commitFile(filePath, Buffer.from(json, 'utf8'), message || `update ${filePath}`);
}

async function commitBinaryFile(filePath, buffer, message) {
  return commitFile(filePath, buffer, message || `upload ${filePath}`);
}

module.exports = {
  status,
  configured,
  commitJsonFile,
  commitBinaryFile
};
