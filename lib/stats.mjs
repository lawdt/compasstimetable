// Еженедельная сводка открытий: берём агрегаты из Supabase и собираем текст
// для Telegram. Общая часть для функции по расписанию и локального прогона.

const TZ = 'Europe/Podgorica';
const PLATFORMS = { telegram: 'Telegram', web: 'Сайт', android: 'Android' };
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const TOP_CLASSES = 8;

// Понедельник прошлой недели по часовому поясу школы, в виде YYYY-MM-DD.
export function lastWeekStart(now = new Date()) {
  const today = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const sinceMonday = (today.getDay() + 6) % 7;
  const monday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday - 7));
  return monday.toISOString().slice(0, 10);
}

export async function fetchReport({ url, key, weekStart }) {
  const res = await fetch(`${url}/rest/v1/rpc/visits_report`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ week_start: weekStart }),
  });
  if (!res.ok) throw new Error(`Supabase ответил ${res.status}: ${await res.text()}`);
  return res.json();
}

// Названия классов берём из расписания: в статистике лежат только id.
export async function fetchClassTitles(siteUrl) {
  try {
    const res = await fetch(`${siteUrl}/api/schedule`);
    const data = await res.json();
    return Object.fromEntries((data.classes || []).map((c) => [c.id, c.title]));
  } catch {
    return {};
  }
}

export function formatReport(r, weekStart, titles = {}) {
  const lines = [`📊 Расписание «Компас» · ${period(weekStart)}`, ''];

  if (!r.opens) {
    lines.push('За неделю приложение не открывали.');
    return lines.join('\n');
  }

  lines.push(
    `Открытий: ${r.opens}${trend(r.opens, r.prev_opens)}`,
    `Устройств: ${r.visitors}${trend(r.visitors, r.prev_visitors)}, из них новых ${r.new_visitors}`,
    '',
    'Где открывают (устройств / открытий)',
    ...r.platforms.map((p) => `${PLATFORMS[p.platform] || p.platform} — ${p.visitors} / ${p.opens}`),
    '',
    'По дням (открытий)',
    days(r.days, weekStart),
  );

  if (r.classes.length) {
    lines.push('', 'Классы (устройств)');
    for (const c of r.classes.slice(0, TOP_CLASSES)) {
      lines.push(`${titles[c.class_id] || c.class_id} — ${c.visitors}`);
    }
    const rest = r.classes.slice(TOP_CLASSES).reduce((sum, c) => sum + c.visitors, 0);
    if (rest) lines.push(`остальные — ${rest}`);
  }

  const seasons = Object.fromEntries(r.seasons.map((s) => [s.season, s.visitors]));
  const autumnOn = seasons.autumn || 0;
  const autumnAll = autumnOn + (seasons['autumn-off'] || 0);
  if (autumnAll) lines.push('', `🍁 Осенняя тема включена на ${autumnOn} из ${autumnAll} устройств`);

  return lines.join('\n');
}

// «3–9 ноября» или «27 октября – 2 ноября».
function period(weekStart) {
  const from = new Date(`${weekStart}T00:00:00Z`);
  const to = new Date(from.getTime() + 6 * 864e5);
  const [fd, fm, td, tm] = [from.getUTCDate(), from.getUTCMonth(), to.getUTCDate(), to.getUTCMonth()];
  return fm === tm
    ? `${fd}–${td} ${MONTHS[tm]}`
    : `${fd} ${MONTHS[fm]} – ${td} ${MONTHS[tm]}`;
}

function trend(now, before) {
  if (!before) return '';
  const diff = Math.round(((now - before) / before) * 100);
  if (diff === 0) return ' (как неделей раньше)';
  return ` (${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}% к прошлой неделе)`;
}

function days(list, weekStart) {
  const byDay = Object.fromEntries(list.map((d) => [d.day, d.opens]));
  const start = new Date(`${weekStart}T00:00:00Z`).getTime();
  return WEEKDAYS.map((name, i) => {
    const day = new Date(start + i * 864e5).toISOString().slice(0, 10);
    return `${name} ${byDay[day] || 0}`;
  }).join(' · ');
}
