'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GROUP_ID = '240781627';
const API_VERSION = '5.199';
const QUEUE_FILE = 'content/vk-daily-posts.json';
const groupToken = String(process.env.VK_TOKEN || '').trim();
const userToken = String(process.env.VK_USER_TOKEN || '').trim();
const requestedMode = process.argv.find((argument) => argument.startsWith('--mode='));
const mode = String(requestedMode ? requestedMode.slice(7) : process.env.VK_MODE || 'dry_run').trim().toLowerCase();

if (!['dry_run', 'publish'].includes(mode)) {
  throw new Error('VK_MODE must be dry_run or publish.');
}

function apiError(method, payload, status) {
  const code = payload?.error?.error_code ?? status ?? 'unknown';
  const message = payload?.error?.error_msg || 'VK API request failed';
  return new Error(`${method} failed (${code}): ${message}`);
}

async function callVk(method, params = {}, accessToken = groupToken) {
  if (!accessToken) throw new Error('VK_TOKEN is not available to this workflow.');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }
  body.set('access_token', accessToken);
  body.set('v', API_VERSION);
  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`${method} returned non-JSON.`); }
  if (!response.ok || payload?.error) throw apiError(method, payload, response.status);
  return payload.response;
}

function toIsoDate(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateIndex(startDate, currentDate, length) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const current = Date.parse(`${currentDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(current)) throw new Error('Queue dates are invalid.');
  return Math.max(0, Math.floor((current - start) / 86400000)) % length;
}

function validateQueue(queue) {
  if (!Array.isArray(queue.posts) || queue.posts.length === 0) throw new Error('Daily VK queue is empty.');
  for (const post of queue.posts) {
    if (!post?.id || !post?.text) throw new Error('Each post must include id and text.');
    if (post.text.length > 4000) throw new Error(`Post ${post.id} is too long for VK.`);
    if (/chatgpt\.site/i.test(post.text)) throw new Error(`Post ${post.id} contains the retired catalog link.`);
    if (post.media && !fs.existsSync(post.media)) throw new Error(`Media for ${post.id} is missing: ${post.media}`);
  }
}

async function uploadPhoto(filePath) {
  if (!userToken || !filePath) return null;
  const upload = await callVk('photos.getWallUploadServer', { group_id: GROUP_ID }, userToken);
  if (!upload?.upload_url) throw new Error('VK did not return a wall-photo upload URL.');

  const image = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('photo', new Blob([image], { type: 'image/jpeg' }), path.basename(filePath));
  const uploaded = await fetch(upload.upload_url, { method: 'POST', body: form });
  const payload = await uploaded.json();
  if (!uploaded.ok || !payload?.photo) throw new Error('VK did not accept the wall photo.');

  const saved = await callVk('photos.saveWallPhoto', {
    group_id: GROUP_ID,
    photo: payload.photo,
    server: payload.server,
    hash: payload.hash
  }, userToken);
  const photo = Array.isArray(saved) ? saved[0] : saved;
  if (!photo?.id || photo.owner_id === undefined) throw new Error('VK did not return a saved wall photo.');
  return `photo${photo.owner_id}_${photo.id}`;
}

async function main() {
  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  validateQueue(queue);
  const today = toIsoDate(queue.timeZone || 'Europe/Moscow');
  const item = queue.posts[dateIndex(queue.startDate, today, queue.posts.length)];
  const guid = `deli-berry-daily-${today}-${item.id}`;

  const group = await callVk('groups.getById', { group_id: GROUP_ID });
  const verified = Array.isArray(group) ? group[0] : group;
  if (String(verified?.id ?? '') !== GROUP_ID) throw new Error('VK token did not return the Deli Berry community.');

  console.log(`Prepared ${today}: ${item.id}.`);
  if (mode === 'dry_run') {
    console.log('Dry run complete. No post was published.');
    return;
  }

  const attachment = await uploadPhoto(item.media);
  const response = await callVk('wall.post', {
    owner_id: `-${GROUP_ID}`,
    from_group: 1,
    signed: 0,
    guid,
    message: item.text,
    attachments: attachment || undefined
  });
  const postId = Number(response?.post_id ?? response?.id);
  if (!Number.isSafeInteger(postId) || postId <= 0) throw new Error('VK did not return a valid post ID.');
  console.log(`Published ${item.id} as post ${postId}${attachment ? ' with a photo.' : ' without a photo (VK_USER_TOKEN is not set).'}`);
}

main().catch((error) => {
  console.error(`Daily VK post failed: ${error.message}`);
  process.exit(1);
});
