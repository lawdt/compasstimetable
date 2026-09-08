// Настройка бота: вебхук, кнопка меню, команды и описания.
//
// Запуск:  node scripts/setup-bot.mjs
// Токен и адрес берутся из .env или из переменных окружения.
//
// Установка вебхука заодно отбирает обновления у любого другого экземпляра
// бота: Telegram отдаёт их только одному получателю, поэтому старый бот,
// работавший на опросе, замолкает сразу.
import { readFile } from 'node:fs/promises';

for (const [key, value] of Object.entries(await readEnv('.env'))) {
  if (!process.env[key]) process.env[key] = value;
}

const token = process.env.BOT_TOKEN;
const appUrl = process.env.WEBAPP_URL;
const secret = process.env.WEBHOOK_SECRET || '';

if (!token || !appUrl) {
  console.error('Нужны BOT_TOKEN и WEBAPP_URL — в .env или в переменных окружения.');
  console.error('Пример .env:');
  console.error('  BOT_TOKEN=123456:AA...');
  console.error('  WEBAPP_URL=https://compass-bar-schedule.netlify.app');
  process.exit(1);
}

const origin = new URL(appUrl).origin;
const base = `https://api.telegram.org/bot${token}/`;

async function call(method, payload = {}) {
  const res = await fetch(base + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${method}: ${body.description}`);
  return body.result;
}

const before = await call('getWebhookInfo');
console.log('Было:', before.url ? before.url : 'вебхук не задан, бот работал на опросе');

await call('setWebhook', {
  url: `${origin}/api/bot`,
  allowed_updates: ['message'],
  drop_pending_updates: true,
  ...(secret ? { secret_token: secret } : {}),
});
await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Расписание', web_app: { url: appUrl } },
});
await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'Открыть расписание' },
    { command: 'id', description: 'Показать идентификатор чата' },
  ],
});
await call('setMyShortDescription', { short_description: 'Расписание школы «Компас» в Баре' });
await call('setMyDescription', {
  description: 'Расписание уроков школы «Компас» (Бар) с выбором класса. Данные берутся из таблицы школы.',
});

const me = await call('getMe');
const after = await call('getWebhookInfo');

console.log('Стало:', after.url);
console.log(`Бот @${me.username} открывает ${appUrl}`);
console.log('');
console.log('Дальше: отправьте боту /id и добавьте полученное число в настройки сайта,');
console.log('иначе форма «Сообщить об ошибке» не сможет присылать сообщения:');
console.log('  netlify env:set OWNER_CHAT_ID <число> && netlify deploy --prod');

async function readEnv(path) {
  try {
    const text = await readFile(path, 'utf8');
    return Object.fromEntries(text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
      }));
  } catch {
    return {};
  }
}
