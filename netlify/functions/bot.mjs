// Вебхук бота. Единственная задача — открыть миниапп.
const API = 'https://api.telegram.org/bot';

const GREETING = [
  'Расписание школы «Компас» в Баре.',
  '',
  'Откройте приложение и выберите класс — дальше оно само помнит выбор',
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

  const text = String(message.text || '').trim();
  // В группе команда приходит с именем бота: "/id@compass_bot".
  const command = (/^\/([a-z_]+)(?:@\w+)?\b/i.exec(text)?.[1] || '').toLowerCase();
  const private_ = message.chat.type === 'private';

  // В группе отвечаем только на команды, чтобы не влезать в переписку.
  if (!private_ && !command) return new Response('ok');

  // /id нужен один раз при настройке: это значение идёт в OWNER_CHAT_ID.
  if (command === 'id') {
    await send(token, chatId, `Идентификатор этого чата: ${chatId}`);
    return new Response('ok');
  }

  const appUrl = process.env.WEBAPP_URL || new URL(req.url).origin;

  // Кнопку с миниаппом Telegram разрешает только в личной переписке,
  // в группу отправляем обычную ссылку.
  if (private_) {
    await send(token, chatId, GREETING, {
      inline_keyboard: [[{ text: '📅 Открыть расписание', web_app: { url: appUrl } }]],
    });
  } else {
    await send(token, chatId, `${GREETING}\n\n${appUrl}`);
  }

  return new Response('ok');
};

function send(token, chatId, text, markup) {
  return fetch(`${API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(markup ? { reply_markup: markup } : {}),
    }),
  });
}

export const config = { path: '/api/bot' };
