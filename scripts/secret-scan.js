const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOKEN_RE = /\b\d{8,12}:AA[0-9A-Za-z_-]{30,}\b/g;
const SKIP_DIRS = new Set(['node_modules', '.git', 'logs']);
const SKIP_FILES = new Set(['.env']);
const SKIP_EXT = new Set(['.zip', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.lock']);

let findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (TOKEN_RE.test(text)) findings.push(path.relative(ROOT, full));
    TOKEN_RE.lastIndex = 0;
  }
}

walk(ROOT);

if (findings.length) {
  console.error('Найден похожий на Telegram-токен текст в файлах:');
  for (const file of findings) console.error(`- ${file}`);
  console.error('Удалите токен из проекта. Секреты должны быть только в .env или переменных хостинга.');
  process.exit(1);
}

console.log('OK: в коде и документах проекта не найден открытый Telegram-токен.');
