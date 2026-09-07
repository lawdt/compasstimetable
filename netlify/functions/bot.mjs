// Вебхук бота. Единственная задача — открыть миниапп.
const API = 'https://api.telegram.org/bot';

const GREETING = [
  'Расписание школы «Компас» в Баре.',
  '',
  'Откройте приложение, выберите класс — дальше оно само помнит выбор',
  'и показывает актуальное расписание из таблицы школы.',
].join('\n');

export default async (req) => {
  if (req.method !== 'POST') return new Response('ok');

  const token = process.env.BOT_TOKEN;
  if (!token) return new Response('BOT_TOKEN не задан', { status: 500 });

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  let update;
  try { update = await req.json(); } catch { return new Response('ok'); }

  const message = update.message || update.edited_message;
  const chatId = message?.chat?.id;
  if (!chatId) return new Response('ok');

  const appUrl = process.env.WEBAPP_URL || new URL(req.url).origin;

  await fetch(`${API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: GREETING,
      reply_markup: {
        inline_keyboard: [[{ text: '📅 Открыть расписание', web_app: { url: appUrl } }]],
      },
    }),
  });

  return new Response('ok');
};

export const config = { path: '/api/bot' };
