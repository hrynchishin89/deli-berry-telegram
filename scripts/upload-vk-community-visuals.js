'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GROUP_ID = '240781627';
const API_VERSION = '5.199';
const USER_TOKEN = String(process.env.VK_USER_TOKEN || '').trim();
const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='));
const mode = String(modeArgument ? modeArgument.slice('--mode='.length) : process.env.VK_MODE || 'dry_run').trim().toLowerCase();

const ASSETS = Object.freeze({
  avatar: 'webapp/assets/deli-berry-logo-square.jpg',
  cover: 'vk-assets/cover.jpg',
  catalog: [
    'catalog-site/assets/set-09.jpg',
    'catalog-site/assets/set-12.jpg',
    'catalog-site/assets/set-16.jpg'
  ]
});

const CATALOG_POST = [
  '🍓 Актуальный каталог Deli Berry',
  '',
  'Наборы:',
  '• 9 ягод — 1 190 ₽',
  '• 12 ягод — 1 590 ₽',
  '• 16 ягод — 1 990 ₽',
  '',
  'Готовность — до 30 минут после подтверждения заказа.',
  '',
  'Самовывоз:',
  '📍 ТЦ Discovery — Москва, ул. Дыбенко, 7/1, м. Ховрино',
  '📍 ТРЦ «Зеленопарк» — Ржавки',
  '',
  'Чтобы заказать, напишите в сообщения размер набора, точку, дату и время.',
  '',
  'Фотографии показывают примеры оформления. Доступный декор подтверждаем перед сборкой.',
  '#DeliBerryКаталог'
].join('\n');

if (!['dry_run', 'apply'].includes(mode)) throw new Error('VK_MODE must be dry_run or apply.');

function apiError(method, payload, status) {
  const code = payload?.error?.error_code ?? status ?? 'unknown';
  const message = payload?.error?.error_msg || 'VK API request failed';
  return new Error(`${method} failed (${code}): ${message}`);
}

async function callVk(method, params = {}) {
  if (!USER_TOKEN) throw new Error('VK_USER_TOKEN is required for VK visual uploads.');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }
  body.set('access_token', USER_TOKEN);
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

function firstGroup(response) {
  if (Array.isArray(response)) return response[0];
  if (Array.isArray(response?.groups)) return response.groups[0];
  return response && typeof response === 'object' ? response : null;
}

function verifyAssets() {
  for (const asset of [ASSETS.avatar, ASSETS.cover, ...ASSETS.catalog]) {
    if (!fs.existsSync(asset)) throw new Error(`Required visual asset is missing: ${asset}`);
  }
}

async function uploadFile(uploadUrl, filePath) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: 'image/jpeg' }), path.basename(filePath));
  const response = await fetch(uploadUrl, { method: 'POST', body: form });
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`Upload failed for ${filePath}: non-JSON response.`); }
  if (!response.ok || payload?.error) throw new Error(`Upload failed for ${filePath}.`);
  return payload;
}

async function uploadOwnerPhoto() {
  const upload = await callVk('photos.getOwnerPhotoUploadServer', { owner_id: `-${GROUP_ID}` });
  const payload = await uploadFile(upload.upload_url, ASSETS.avatar);
  return callVk('photos.saveOwnerPhoto', payload);
}

async function uploadCover() {
  const upload = await callVk('photos.getOwnerCoverPhotoUploadServer', {
    group_id: GROUP_ID,
    crop_x: 0,
    crop_y: 0,
    crop_x2: 1590,
    crop_y2: 400
  });
  const payload = await uploadFile(upload.upload_url, ASSETS.cover);
  return callVk('photos.saveOwnerCoverPhoto', payload);
}

async function uploadWallPhoto(filePath) {
  const upload = await callVk('photos.getWallUploadServer', { group_id: GROUP_ID });
  const payload = await uploadFile(upload.upload_url, filePath);
  const saved = await callVk('photos.saveWallPhoto', { group_id: GROUP_ID, ...payload });
  const photo = Array.isArray(saved) ? saved[0] : saved;
  if (!photo?.id || photo.owner_id === undefined) throw new Error(`VK did not save ${filePath}.`);
  return `photo${photo.owner_id}_${photo.id}`;
}

async function main() {
  verifyAssets();
  const group = firstGroup(await callVk('groups.getById', { group_id: GROUP_ID }));
  if (String(group?.id ?? group?.gid ?? '') !== GROUP_ID) throw new Error('VK user token did not return the Deli Berry community.');
  console.log(`Target verified: ${String(group?.name || 'community').replace(/[\r\n]/g, ' ')} (id ${GROUP_ID}).`);
  if (mode === 'dry_run') {
    console.log('Dry run complete. Avatar, cover, and catalog post were not changed.');
    return;
  }

  await uploadOwnerPhoto();
  await uploadCover();
  const attachments = await Promise.all(ASSETS.catalog.map(uploadWallPhoto));
  const response = await callVk('wall.post', {
    owner_id: `-${GROUP_ID}`,
    from_group: 1,
    signed: 0,
    guid: 'deli-berry-catalog-v2',
    message: CATALOG_POST,
    attachments: attachments.join(',')
  });
  const postId = Number(response?.post_id ?? response?.id);
  if (!Number.isSafeInteger(postId) || postId <= 0) throw new Error('VK did not return a catalog post ID.');
  await callVk('wall.pin', { owner_id: `-${GROUP_ID}`, post_id: postId });
  console.log(`Avatar, cover, and catalog post ${postId} were updated and pinned.`);
}

main().catch((error) => { console.error(`VK visual upload failed: ${error.message}`); process.exit(1); });
