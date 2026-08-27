'use strict';

const GROUP_ID = String(process.env.VK_GROUP_ID || '240781627').trim();
const API_VERSION = String(process.env.VK_API_VERSION || '5.199').trim();
const MODE = String(process.env.VK_MODE || 'validate').trim().toLowerCase();
const TOKEN = String(process.env.VK_TOKEN || '').trim();
const MESSAGE = String(process.env.VK_MESSAGE || '').trim();
const PHOTO_URL = String(process.env.VK_PHOTO_URL || '').trim();
const GUID = String(process.env.VK_GUID || `deli-berry-${Date.now()}`).trim();

if (!['validate', 'publish'].includes(MODE)) {
  throw new Error('VK_MODE must be validate or publish.');
}
if (!TOKEN) throw new Error('VK_TOKEN is not available to this workflow.');
if (!/^\d+$/.test(GROUP_ID)) throw new Error('VK_GROUP_ID must contain only digits.');
if (MODE === 'publish' && !MESSAGE) throw new Error('VK_MESSAGE is required in publish mode.');

function apiError(method, payload, status) {
  const code = payload?.error?.error_code ?? status ?? 'unknown';
  const message = payload?.error?.error_msg || 'VK API request failed';
  return new Error(`${method} failed (${code}): ${message}`);
}

async function callVk(method, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') body.set(key, String(value));
  }
  body.set('access_token', TOKEN);
  body.set('v', API_VERSION);

  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${method} failed (${response.status}): VK API returned non-JSON data.`);
  }

  if (!response.ok || payload?.error) throw apiError(method, payload, response.status);
  return payload.response;
}

function firstGroup(response) {
  if (Array.isArray(response)) return response[0];
  if (Array.isArray(response?.groups)) return response.groups[0];
  return response && typeof response === 'object' ? response : null;
}

async function verifyTarget() {
  const response = await callVk('groups.getById', {
    group_id: GROUP_ID,
    fields: 'description,site,status'
  });
  const group = firstGroup(response);
  const returnedId = String(group?.id ?? group?.gid ?? '');
  if (returnedId !== GROUP_ID) {
    throw new Error(`VK token did not resolve community ${GROUP_ID}.`);
  }
  console.log(`Target verified: ${String(group?.name || 'community')} (id ${GROUP_ID}).`);
  return group;
}

async function uploadWallPhoto(photoUrl) {
  const uploadServer = await callVk('photos.getWallUploadServer', { group_id: GROUP_ID });
  if (!uploadServer?.upload_url) throw new Error('VK did not return a wall photo upload URL.');

  const source = await fetch(photoUrl, { redirect: 'follow' });
  if (!source.ok) throw new Error(`Could not download photo (${source.status}).`);

  const contentType = source.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    throw new Error(`PHOTO_URL returned ${contentType}, not an image.`);
  }

  const bytes = await source.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error('Downloaded photo is empty.');
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('Downloaded photo exceeds 20 MB safety limit.');

  const form = new FormData();
  form.append('photo', new Blob([bytes], { type: contentType }), 'vk-post-image');

  const uploadResponse = await fetch(uploadServer.upload_url, {
    method: 'POST',
    body: form
  });
  const uploadPayload = await uploadResponse.json();
  if (!uploadResponse.ok || !uploadPayload?.photo || uploadPayload?.server === undefined || !uploadPayload?.hash) {
    throw new Error(`VK photo upload failed (${uploadResponse.status}).`);
  }

  const saved = await callVk('photos.saveWallPhoto', {
    group_id: GROUP_ID,
    photo: uploadPayload.photo,
    server: uploadPayload.server,
    hash: uploadPayload.hash
  });

  const photo = Array.isArray(saved) ? saved[0] : saved?.[0];
  const ownerId = Number(photo?.owner_id);
  const photoId = Number(photo?.id);
  if (!Number.isSafeInteger(ownerId) || !Number.isSafeInteger(photoId)) {
    throw new Error('VK did not return a valid saved wall photo.');
  }

  return `photo${ownerId}_${photoId}`;
}

async function main() {
  await verifyTarget();

  if (MODE === 'validate') {
    console.log('Validation complete. No VK changes were made.');
    return;
  }

  let attachment;
  if (PHOTO_URL) {
    console.log('Uploading wall photo...');
    attachment = await uploadWallPhoto(PHOTO_URL);
    console.log(`Photo uploaded as ${attachment}.`);
  }

  const result = await callVk('wall.post', {
    owner_id: `-${GROUP_ID}`,
    from_group: 1,
    signed: 0,
    guid: GUID,
    message: MESSAGE,
    attachments: attachment
  });

  const postId = Number(result?.post_id ?? result?.id);
  if (!Number.isSafeInteger(postId) || postId <= 0) {
    throw new Error('VK did not return a valid post ID.');
  }

  console.log(`Published VK post ${postId}${attachment ? ' with photo' : ''}.`);
}

main().catch((error) => {
  console.error(`VK publish failed: ${error.message}`);
  process.exit(1);
});
