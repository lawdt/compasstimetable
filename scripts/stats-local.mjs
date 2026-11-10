// Печатает еженедельный отчёт, ничего не отправляя в Telegram.
//
//   node scripts/stats-local.mjs              прошлая неделя
//   node scripts/stats-local.mjs 2026-11-03   неделя с этого понедельника
//
// Нужны SUPABASE_URL и SUPABASE_SECRET_KEY в окружении или в .env.
import { readFileSync } from 'node:fs';
import { fetchReport, fetchClassTitles, formatReport, lastWeekStart } from '../lib/stats.mjs';

try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* .env необязателен */ }

const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
if (!url || !key) {
  console.error('Задайте SUPABASE_URL и SUPABASE_SECRET_KEY.');
  process.exit(1);
}

const weekStart = process.argv[2] || lastWeekStart();
const site = process.env.WEBAPP_URL || 'https://compass-bar-schedule.netlify.app';
const [report, titles] = await Promise.all([
  fetchReport({ url, key, weekStart }),
  fetchClassTitles(site),
]);
console.log(formatReport(report, weekStart, titles));
