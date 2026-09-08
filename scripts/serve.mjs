// Локальный сервер: статика из public/ и тот же /api/schedule, что на Netlify.
// Запуск: node scripts/serve.mjs [порт]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fetchSchedule, publicUrl } from '../lib/sheet.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8888);
const ROOT = new URL('../public/', import.meta.url).pathname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

let cache = { at: 0, data: null };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/schedule') {
    try {
      const fresh = url.searchParams.get('fresh') === '1';
      if (fresh || !cache.data || Date.now() - cache.at > 300_000) {
        cache = {
          at: Date.now(),
          data: await fetchSchedule({
            sheet: process.env.SHEET_URL,
            gid: process.env.SHEET_GID,
            publicUrl: publicUrl({ sheet: process.env.SHEET_URL, gid: process.env.SHEET_GID }),
          }),
        };
      }
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(cache.data));
    } catch (err) {
      send(res, 502, 'application/json; charset=utf-8', JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/report') {
    let body = '';
    for await (const chunk of req) body += chunk;
    console.log('[report]', body);
    send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
    return;
  }

  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, rel));
    send(res, 200, MIME[extname(rel)] || 'application/octet-stream', body);
  } catch {
    send(res, 404, 'text/plain; charset=utf-8', 'не найдено');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
