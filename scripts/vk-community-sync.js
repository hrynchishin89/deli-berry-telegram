'use strict';

const GROUP_ID = '240781627';
const API_VERSION = '5.199';
// Until GitHub Pages is active, the only public destination is the community's messages.
const CONTACT_URL = 'https://vk.me/club240781627';
const LAUNCH_MARKER = '#DeliBerryСтарт';
const POST_GUID = 'deli-berry-launch-v1';

const CONTENT = Object.freeze({
  title: 'Deli Berry | Клубника в шоколаде',
  status: 'Клубника в шоколаде • до 30 минут после подтверждения',
  description: [
    'Deli Berry — наборы из клубники в шоколаде.',
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
    `Заказ: ${CONTACT_URL}`,
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
    'Готовность — до 30 минут после подтверждения заказа.',
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
    `Написать: ${CONTACT_URL}`,
    '',
    LAUNCH_MARKER
  ].join('\n')
});

const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='));
const mode = String(modeArgument ? modeArgument.slice('--mode='.length) : process.env.VK_MODE || 'dry_run')
  .trim()
  .toLowerCase()
  .replace('-', '_');
if (!['dry_run', 'apply', 'profile_only'].includes(mode)) throw new Error('VK_MODE must be dry_run, profile_only, or apply.');

const groupToken = String(process.env.VK_TOKEN || '').trim();
const userToken = String(process.env.VK_USER_TOKEN || '').trim();

function apiError(method, payload, status) {
  const code = payload?.error?.error_code ?? status ?? 'unknown';
  const message = payload?.error?.error_msg || 'VK API request failed';
  return new Error(`${method} failed (${code}): ${message}`);
}

async function callVk(method, params = {}, accessToken = groupToken) {
  if (!accessToken) throw new Error('The required VK token is not available to this workflow.');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) body.set(key, String(value));
  body.set('access_token', accessToken);
  body.set('v', API_VERSION);
  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`${method} failed (${response.status}): VK returned non-JSON.`); }
  if (!response.ok || payload?.error) throw apiError(method, payload, response.status);
  return payload.response;
}

function firstGroup(response) {
  if (Array.isArray(response)) return response[0];
  if (Array.isArray(response?.groups)) return response.groups[0];
  return response && typeof response === 'object' ? response : null;
}

async function main() {
  const group = firstGroup(await callVk('groups.getById', { group_id: GROUP_ID, fields: 'description,site,status' }));
  if (String(group?.id ?? group?.gid ?? '') !== GROUP_ID) throw new Error(`VK token did not return community ${GROUP_ID}. No changes were made.`);
  console.log(`Target verified: ${String(group?.name || 'community').replace(/[\r\n]/g, ' ')} (id ${GROUP_ID}).`);
  if (mode === 'dry_run') { console.log('Dry run complete. No VK changes were made.'); return; }

  await callVk('groups.edit', {
    group_id: GROUP_ID,
    title: CONTENT.title,
    description: CONTENT.description,
    status: CONTENT.status,
    website: CONTACT_URL
  });
  if (mode === 'profile_only') { console.log('Community profile updated. No wall post was created.'); return; }

  const response = await callVk('wall.post', {
    owner_id: `-${GROUP_ID}`, from_group: 1, signed: 0, guid: POST_GUID, message: CONTENT.launchPost
  });
  const postId = Number(response?.post_id ?? response?.id);
  if (!Number.isSafeInteger(postId) || postId <= 0) throw new Error('VK did not return a valid launch-post ID.');
  try {
    await callVk('wall.pin', { owner_id: `-${GROUP_ID}`, post_id: postId }, userToken || groupToken);
    console.log(`Community updated and launch post ${postId} pinned.`);
  } catch (error) {
    if (/method is unavailable with group auth/i.test(error.message)) {
      console.warn(`Community updated and launch post ${postId} published. Add VK_USER_TOKEN to pin it automatically.`);
      return;
    }
    throw error;
  }
}

main().catch((error) => { console.error(`VK community sync failed: ${error.message}`); process.exit(1); });
