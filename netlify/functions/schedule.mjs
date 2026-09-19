import { fetchSchedule, publicUrl } from '../../lib/sheet.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const fresh = url.searchParams.get('fresh') === '1';

  try {
    const data = await fetchSchedule({
      sheet: process.env.SHEET_URL,
      gid: process.env.SHEET_GID,
      publicUrl: publicUrl({ sheet: process.env.SHEET_URL, gid: process.env.SHEET_GID }),
    });

    return json(data, {
      // Приложение для Android открывает страницу с локального origin, и без
      // этого заголовка запрос к расписанию блокируется. Данные публичные и
      // только на чтение.
      'access-control-allow-origin': '*',
      // Браузер держит ответ недолго, тяжёлый разбор кэширует CDN.
      'cache-control': fresh ? 'no-store' : 'public, max-age=120',
      // Тяга вниз должна давать свежие данные, поэтому окно кэша у CDN
      // короткое — только чтобы функция не пересчитывала таблицу на каждый
      // повторный жест.
      'netlify-cdn-cache-control': fresh
        ? 'public, durable, s-maxage=10'
        : 'public, durable, s-maxage=900, stale-while-revalidate=3600',
    });
  } catch (err) {
    return json(
      { error: String(err.message || err) },
      { 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
      502,
    );
  }
};

function json(body, headers = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export const config = { path: '/api/schedule' };
