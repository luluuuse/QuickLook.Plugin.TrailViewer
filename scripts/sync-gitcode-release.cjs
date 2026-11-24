'use strict';

// Syncs a GitHub release (tag, release notes, and .qlplugin/.sha256 assets) to the GitCode mirror.
// Usage: node scripts/sync-gitcode-release.cjs <tag> <notes-file> <asset1> [asset2...]
// Requires GITCODE_TOKEN in the environment; exits cleanly with a notice when unset.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OWNER = process.env.GITCODE_OWNER || 'luluse';
const REPO = process.env.GITCODE_REPO || 'QuickLook.Plugin.TrailViewer';
const TOKEN = (process.env.GITCODE_TOKEN || '').trim();
const API_BASE = `https://api.gitcode.com/api/v5/repos/${OWNER}/${REPO}`;

function maskToken(text) {
  return TOKEN ? String(text || '').split(TOKEN).join('***') : String(text || '');
}

async function apiRequest(method, url, body) {
  const headers = {
    Accept: 'application/json',
    'PRIVATE-TOKEN': TOKEN,
    Authorization: `Bearer ${TOKEN}`,
  };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json };
}

function pushTagToMirror(tag) {
  const remoteUrl = `https://oauth2:${encodeURIComponent(TOKEN)}@gitcode.com/${OWNER}/${REPO}.git`;
  try {
    execFileSync('git', ['push', remoteUrl, 'HEAD:refs/heads/main'], { stdio: 'pipe' });
  } catch (error) {
    console.warn(`gitcode sync: pushing main branch warning: ${maskToken(error.stderr || error.message)}`);
  }
  try {
    execFileSync('git', ['push', remoteUrl, `refs/tags/${tag}:refs/tags/${tag}`], { stdio: 'pipe' });
    console.log(`gitcode sync: pushed tag ${tag}`);
  } catch (error) {
    const detail = maskToken(error.stderr || error.message);
    if (!/already exists/i.test(detail)) {
      throw new Error(`failed to push tag ${tag} to GitCode: ${detail}`);
    }
  }
}

async function createOrEnsureRelease(tag, notes) {
  const body = {
    tag_name: tag,
    name: tag,
    body: notes,
    target_commitish: 'main',
    prerelease: tag.includes('-'),
  };
  const res = await apiRequest('POST', `${API_BASE}/releases`, body);
  if (res.ok) {
    console.log(`gitcode sync: created release ${tag}`);
    return;
  }
  if (res.status === 409 || /exist|已存在/i.test(res.text)) {
    console.log(`gitcode sync: release ${tag} already exists, continuing asset upload`);
    return;
  }
  throw new Error(`failed to create GitCode release (${res.status}): ${maskToken(res.text)}`);
}

async function uploadAsset(tag, filePath) {
  const fileName = path.basename(filePath);
  const url = `${API_BASE}/releases/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(fileName)}`;
  const meta = await apiRequest('GET', url);
  if (!meta.ok || !meta.json) {
    throw new Error(`failed to get upload_url for ${fileName} (${meta.status}): ${maskToken(meta.text)}`);
  }
  const uploadUrl = meta.json.url || meta.json.upload_url;
  if (!uploadUrl) {
    throw new Error(`upload_url response for ${fileName} did not include a URL: ${maskToken(meta.text)}`);
  }
  const uploadHeaders = { ...(meta.json.headers || {}) };
  const bytes = fs.readFileSync(filePath);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    body: bytes,
  });
  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => '');
    throw new Error(`failed to upload ${fileName} (${putRes.status}): ${maskToken(errText)}`);
  }
  console.log(`gitcode sync: uploaded ${fileName} (${bytes.length} bytes)`);
}

async function main() {
  const [tag, notesPath, ...assets] = process.argv.slice(2);
  if (!tag || !notesPath) {
    console.error('Usage: node scripts/sync-gitcode-release.cjs <tag> <notes-file> <asset...>');
    process.exit(1);
  }
  if (!TOKEN) {
    console.log('gitcode sync: GITCODE_TOKEN secret is not configured; skipping GitCode mirror sync.');
    return;
  }

  const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : `Release ${tag}`;
  pushTagToMirror(tag);
  await createOrEnsureRelease(tag, notes);
  for (const asset of assets) {
    if (asset && fs.existsSync(asset)) {
      await uploadAsset(tag, asset);
    }
  }
  console.log(`gitcode sync: completed ${OWNER}/${REPO} ${tag}`);
}

main().catch((error) => {
  console.error(`gitcode sync error: ${maskToken(error.message)}`);
  process.exit(1);
});
