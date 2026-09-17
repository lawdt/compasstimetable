import { speakSubject } from './speech.ts';

// Расписание навык берёт из того же разбора, что и миниапп: держать вторую
// копию парсера на Deno означало бы чинить каждую особенность таблицы дважды.
const SCHEDULE_URL = Deno.env.get('SCHEDULE_URL')
  ?? 'https://compass-bar-schedule.netlify.app/api/schedule';
const TZ = 'Europe/Podgorica';
const CACHE_MS = 10 * 60 * 1000;

const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface Track {
  subject: string;
  teacher: string;
  place: string;
  programme: string;
}

export interface Entry {
  kind: 'lesson' | 'break' | 'free' | 'notice' | 'outro';
  subject: string;
  teachers: string[];
  place: string;
  tracks: Track[];
  start: string | null;
  end: string | null;
  index: number;
  paid: boolean;
  double: boolean;
  secondEnglish: boolean;
}

export interface Schedule {
  updatedAt: string;
  classes: { id: string; title: string }[];
  days: { id: string; short: string; title: string; byClass: Record<string, Entry[]> }[];
}

let cache: { at: number; data: Schedule } | null = null;

export async function loadSchedule(): Promise<Schedule> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const res = await fetch(SCHEDULE_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`расписание недоступно: HTTP ${res.status}`);
  const data = await res.json() as Schedule;
  if (!data?.days?.length) throw new Error('расписание пустое');
  cache = { at: Date.now(), data };
  return data;
}

// Дни считаем по часовому поясу школы: расписание принадлежит ей, а не тому,
// кто спрашивает. Полдень нужен, чтобы перевод часов не сдвинул дату.
export function schoolDay(offset = 0): { iso: string; weekday: string } {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const at = new Date(`${today}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + offset);
  return { iso: at.toISOString().slice(0, 10), weekday: WEEK[at.getUTCDay()] };
}

export function visibleTracks(entry: Entry, programme: string): Track[] {
  if (!entry.tracks.length || programme === 'all') return entry.tracks;
  const kept = entry.tracks.filter((t) => !t.programme || t.programme === programme);
  return kept.length ? kept : entry.tracks;
}

// Название урока для произношения. У двойного урока при выбранной программе
// остаётся одна половина, иначе называем обе через «или».
export function lessonName(entry: Entry, programme: string): string {
  const tracks = visibleTracks(entry, programme);
  if (tracks.length > 1) return tracks.map((t) => t.subject).join(' или ');
  if (tracks.length === 1) return tracks[0].subject;
  return entry.subject;
}

export interface DayPlan {
  found: boolean;
  dayTitle: string;
  lessons: { name: string; start: string | null; end: string | null }[];
  extras: { name: string; start: string | null }[];
  from: string | null;
  till: string | null;
}

export function planFor(
  data: Schedule,
  classId: string,
  weekday: string,
  programme: string,
): DayPlan {
  const day = data.days.find((d) => d.id === weekday);
  const empty: DayPlan = {
    found: false, dayTitle: '', lessons: [], extras: [], from: null, till: null,
  };
  if (!day) return empty;

  const entries = (day.byClass[classId] ?? []).filter((e) => e.kind === 'lesson');
  const lessons = entries.filter((e) => !e.paid).map((e) => ({
    name: speakSubject(lessonName(e, programme)), start: e.start, end: e.end,
  }));
  const extras = entries.filter((e) => e.paid).map((e) => ({
    name: speakSubject(lessonName(e, programme)), start: e.start,
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
