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
      // Браузер держит ответ недолго, тяжёлый разбор кэширует CDN.
      'cache-control': fresh ? 'no-store' : 'public, max-age=120',
      'netlify-cdn-cache-control': fresh
        ? 'public, durable, s-maxage=60'
        : 'public, durable, s-maxage=900, stale-while-revalidate=3600',
    });
  } catch (err) {
    return json({ error: String(err.message || err) }, { 'cache-control': 'no-store' }, 502);
  }
};

function json(body, headers = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export const config = { path: '/api/schedule' };
