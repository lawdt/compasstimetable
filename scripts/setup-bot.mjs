// Разовая настройка бота: вебхук, кнопка меню и описания.
// Запуск: BOT_TOKEN=... WEBAPP_URL=https://<сайт> node scripts/setup-bot.mjs

const token = process.env.BOT_TOKEN;
const appUrl = process.env.WEBAPP_URL;
const secret = process.env.WEBHOOK_SECRET || '';

if (!token || !appUrl) {
  console.error('нужны переменные BOT_TOKEN и WEBAPP_URL');
  process.exit(1);
}

const base = `https://api.telegram.org/bot${token}/`;

async function call(method, payload) {
  const res = await fetch(base + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${method}: ${body.description}`);
  console.log(`  ${method} — готово`);
  return body.result;
}

const origin = new URL(appUrl).origin;

console.log('Настройка бота:');
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
  commands: [{ command: 'start', description: 'Открыть расписание' }],
});
await call('setMyShortDescription', {
  short_description: 'Расписание школы «Компас» в Баре',
});
await call('setMyDescription', {
  description: 'Расписание уроков школы «Компас» (Бар) с выбором класса. Данные берутся из таблицы школы.',
});

const me = await call('getMe', {});
console.log(`\nГотово: @${me.username} открывает ${appUrl}`);
