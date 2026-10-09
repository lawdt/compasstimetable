import { speakSubject } from './speech.mjs';

// Расписание навык берёт из того же /api/schedule, что и миниапп, а не
// разбирает таблицу сам: разбор занимает пару секунд, а у Алисы на ответ
// около трёх. Ответ API лежит в кэше CDN, так что запрос дешёвый.
const TZ = 'Europe/Podgorica';
const CACHE_MS = 10 * 60 * 1000;

const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

let cache = null;

export async function loadSchedule(url) {
  if (cache && cache.url === url && Date.now() - cache.at < CACHE_MS) return cache.data;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`расписание недоступно: HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.days?.length) throw new Error('расписание пустое');
  cache = { url, at: Date.now(), data };
  return data;
}

// Дни считаем по часовому поясу школы: расписание принадлежит ей, а не тому,
// кто спрашивает. Полдень нужен, чтобы перевод часов не сдвинул дату.
export function schoolDay(offset = 0) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const at = new Date(`${today}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + offset);
  return { iso: at.toISOString().slice(0, 10), weekday: WEEK[at.getUTCDay()] };
}

export function visibleTracks(entry, programme) {
  if (!entry.tracks.length || programme === 'all') return entry.tracks;
  const kept = entry.tracks.filter((t) => !t.programme || t.programme === programme);
  return kept.length ? kept : entry.tracks;
}

// Название урока для произношения. У двойного урока при выбранной программе
// остаётся одна половина, иначе называем обе через «или».
export function lessonName(entry, programme) {
  const tracks = visibleTracks(entry, programme);
  // Строчную применяем к каждой половине: иначе «русский язык или Soft
  // skills» — вторая половина остаётся с заглавной посреди фразы.
  if (tracks.length > 1) return tracks.map((t) => speakSubject(t.subject)).join(' или ');
  if (tracks.length === 1) return speakSubject(tracks[0].subject);
  return speakSubject(entry.subject);
}

export function planFor(data, classId, weekday, programme) {
  const day = data.days.find((d) => d.id === weekday);
  const empty = {
    found: false, dayTitle: '', lessons: [], extras: [], from: null, till: null,
  };
  if (!day) return empty;

  const entries = (day.byClass[classId] ?? []).filter((e) => e.kind === 'lesson');
  const lessons = entries.filter((e) => !e.paid).map((e) => ({
    name: lessonName(e, programme), start: e.start, end: e.end,
  }));
  const extras = entries.filter((e) => e.paid).map((e) => ({
    name: lessonName(e, programme), start: e.start,
  }));

  return {
    found: true,
    dayTitle: day.title,
    lessons,
    extras,
    from: lessons[0]?.start ?? null,
    till: lessons[lessons.length - 1]?.end ?? null,
  };
}
