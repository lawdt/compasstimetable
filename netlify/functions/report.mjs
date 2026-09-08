// Приём сообщений об ошибках в расписании: пересылаем их владельцу в Telegram.
import { createHmac } from 'node:crypto';

const MAX_LENGTH = 1000;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'только POST' }, 405);

  const token = process.env.BOT_TOKEN;
  const chatId = process.env.OWNER_CHAT_ID;
  if (!token || !chatId) {
    return json({ error: 'отправка сообщений не настроена' }, 503);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'битый запрос' }, 400); }

  const text = String(body.text || '').trim().slice(0, MAX_LENGTH);
  if (text.length < 3) return json({ error: 'слишком короткое сообщение' }, 400);

  const who = describeUser(body.initData, token);
  const lines = [
    '🐞 Сообщение об ошибке в расписании',
    '',
    text,
    '',
    `Класс: ${clean(body.class) || '—'}`,
    `День: ${clean(body.day) || '—'}`,
    `Программа: ${clean(body.programme) || '—'}`,
    `От: ${who}`,
  ];

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), disable_web_page_preview: true }),
  });
  if (!res.ok) return json({ error: 'не удалось отправить' }, 502);

  return json({ ok: true });
};

const clean = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);

// Подпись Telegram подтверждает, что запрос пришёл из миниаппа, а не со
// стороны. Без неё сообщение принимаем, но помечаем.
function describeUser(initData, token) {
  if (!initData) return 'вне Telegram';
  try {
    const params = new URLSearchParams(String(initData));
    const hash = params.get('hash');
    params.delete('hash');

    const check = [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const mine = createHmac('sha256', secret).update(check).digest('hex');
    if (mine !== hash) return 'подпись Telegram не сошлась';

    const user = JSON.parse(params.get('user') || '{}');
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    const tag = user.username ? ` @${user.username}` : '';
    return `${clean(name) || 'без имени'}${tag} (id ${user.id})`;
  } catch {
    return 'не удалось разобрать данные Telegram';
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const config = { path: '/api/report' };
