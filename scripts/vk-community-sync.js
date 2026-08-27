'use strict';

const GROUP_ID = '240781627';
const API_VERSION = '5.199';
const CATALOG_URL = 'https://deli-berry-catalog.neuronix.chatgpt.site';
const LAUNCH_MARKER = '#DeliBerryСтарт';
const POST_GUID = 'deli-berry-launch-v1';

const CONTENT = Object.freeze({
  title: 'Deli Berry | Клубника в шоколаде',
  status: 'Клубника в шоколаде до 30 минут • Discovery и Зеленопарк',
  description: [
    'Deli Berry — наборы из клубники в шоколаде для подарка и приятного повода.',
    '',
    'Наборы:',
    '• 9 ягод — 1 190 ₽',
    '• 12 ягод — 1 590 ₽',
    '• 16 ягод — 1 990 ₽',
    '',
    'Готовность — до 30 минут после подтверждения заказа.',
    '',
    'Самовывоз:',
    '• ТЦ Discovery — Москва, ул. Дыбенко, 7/1, м. Ховрино',
    '• ТРЦ «Зеленопарк» — Ржавки',
    '',
    'Чтобы заказать, напишите в сообщения сообщества: размер набора, точку получения, дату и время.',
    '',
    `Каталог: ${CATALOG_URL}`,
    '',
    'Фотографии показывают примеры оформления. Доступный декор подтверждаем перед сборкой.'
  ].join('\n'),
  launchPost: [
    '🍓 Клубника в шоколаде — Deli Berry',
    '',
    'Выберите размер набора:',
    '• 9 ягод — 1 190 ₽',
    '• 12 ягод — 1 590 ₽',
    '• 16 ягод — 1 990 ₽',
    '',
    'Соберём заказ до 30 минут после подтверждения.',
    '',
    'Самовывоз:',
    '📍 ТЦ Discovery — Москва, ул. Дыбенко, 7/1, м. Ховрино',
    '📍 ТРЦ «Зеленопарк» — Ржавки',
    '',
    'Как заказать:',
    '1. Выберите набор в каталоге.',
    '2. Напишите нам размер набора, точку, дату и время.',
    '3. Дождитесь подтверждения наличия и готовности.',
    '',
    `Каталог: ${CATALOG_URL}`,
    'Написать: https://vk.me/club240781627',
    '',
    LAUNCH_MARKER
  ].join('\n')
});

const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='));
const mode = String(modeArgument ? modeArgument.slice('--mode='.length) : process.env.VK_MODE || 'dry_run')
  .trim()
  .toLowerCase()
  .replace('-', '_');

if (!['dry_run', 'apply'].includes(mode)) {
  throw new Error('VK_MODE must be either dry_run or apply.');
}

const token = String(process.env.VK_TOKEN || '').trim();

function apiError(method, payload, status) {
  const code = payload?.error?.error_code ?? status ?? 'unknown';
  const message = payload?.error?.error_msg || 'VK API request failed';
  return new Error(`${method} failed (${code}): ${message}`);
}

async function callVk(method, params = {}) {
  if (!token) throw new Error('VK_TOKEN is not available to this workflow.');

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }
  body.set('access_token', token);
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
    throw new Error(`${method} failed (${response.status}): VK API returned a non-JSON response.`);
  }

  if (!response.ok || payload?.error) throw apiError(method, payload, response.status);
  return payload?.response;
}

function firstGroup(response) {
  if (Array.isArray(response)) return response[0];
  if (Array.isArray(response?.groups)) return response.groups[0];
  if (response && typeof response === 'object') return response;
  return null;
}

async function verifyTarget() {
  const response = await callVk('groups.getById', {
    group_id: GROUP_ID,
    fields: 'description,site,status'
  });
  const group = firstGroup(response);
  const returnedId = String(group?.id ?? group?.gid ?? '');
  if (returnedId !== GROUP_ID) {
    throw new Error(`VK token did not return community ${GROUP_ID}. No changes were made.`);
  }
  return group;
}

async function main() {
  const group = await verifyTarget();
  const displayName = String(group?.name || 'community').replace(/[\r\n]/g, ' ');

  console.log(`Target verified: ${displayName} (id ${GROUP_ID}).`);
  console.log('The post uses VK guid-based duplicate protection; group tokens cannot call wall.get.');

  if (mode === 'dry_run') {
    console.log('Dry run complete. No VK changes were made.');
    return;
  }

  await callVk('groups.edit', {
    group_id: GROUP_ID,
    title: CONTENT.title,
    description: CONTENT.description,
    status: CONTENT.status,
    website: CATALOG_URL
  });

  const response = await callVk('wall.post', {
    owner_id: `-${GROUP_ID}`,
    from_group: 1,
    signed: 0,
    guid: POST_GUID,
    message: CONTENT.launchPost
  });
  const postId = Number(response?.post_id ?? response?.id);

  if (!Number.isSafeInteger(postId) || postId <= 0) {
    throw new Error('VK did not return a valid launch-post ID.');
  }

  await callVk('wall.pin', { owner_id: `-${GROUP_ID}`, post_id: postId });
  console.log(`Community updated and launch post ${postId} pinned.`);
}

main().catch((error) => {
  console.error(`VK community sync failed: ${error.message}`);
  process.exit(1);
});
