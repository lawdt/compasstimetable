// Каждый понедельник шлёт владельцу в Telegram статистику открытий за
// прошлую неделю. Расписание Netlify задаётся в UTC: 7:00 — это 8:00 зимой
// и 9:00 летом по Черногории.
import { fetchReport, fetchClassTitles, formatReport, lastWeekStart } from '../../lib/stats.mjs';

export default async () => {
  const token = process.env.BOT_TOKEN;
  const chatId = process.env.OWNER_CHAT_ID;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!token || !chatId || !url || !key) {
    console.error('статистика: не заданы BOT_TOKEN, OWNER_CHAT_ID, SUPABASE_URL или SUPABASE_SECRET_KEY');
    return;
  }

  const weekStart = lastWeekStart();
  const [report, titles] = await Promise.all([
    fetchReport({ url, key, weekStart }),
    fetchClassTitles(process.env.WEBAPP_URL || process.env.URL),
  ]);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatReport(report, weekStart, titles),
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) console.error(`статистика: Telegram ответил ${res.status}: ${await res.text()}`);
};

export const config = { schedule: '0 7 * * 1' };
