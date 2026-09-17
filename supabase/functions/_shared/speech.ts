// Разбор того, что человек сказал, и сборка ответа. Алиса присылает команду
// уже в нижнем регистре и без знаков препинания.

const ORDINALS: Record<string, string> = {
  подготовительный: 'подг', подготовишка: 'подг', подготовка: 'подг', нулевой: 'подг',
  первый: '1', второй: '2', третий: '3', четвертый: '4', пятый: '5',
  шестой: '6', седьмой: '7', восьмой: '8', девятый: '9',
};

const COUNT_FORMS = ['урок', 'урока', 'уроков'];

// Граница слова \b в JavaScript опирается на латиницу, поэтому с кириллицей
// она не срабатывает вовсе. Обходим просмотром по сторонам.
export function word(source: string): RegExp {
  return new RegExp(`(?<![0-9a-zа-яё])(?:${source})(?![0-9a-zа-яё])`, 'i');
}

export function normalize(text: string): string {
  return String(text ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

// Класс ищем среди тех, что есть в таблице, а не по зашитому списку: если в
// школе появится новый класс, навык подхватит его вместе с расписанием.
export function parseClass(
  text: string,
  classes: { id: string; title: string }[],
): { id: string } | { ambiguous: string[] } | null {
  const said = normalize(text);

  let base = '';
  const digit = word('(\\d)').exec(said);
  if (digit) base = digit[1];
  for (const [word, value] of Object.entries(ORDINALS)) {
    if (said.includes(word)) { base = value; break; }
  }
  if (!base) return null;

  const letter = word('([аб])').exec(said)?.[1]
    ?? new RegExp(`${base}\\s*([аб])`).exec(said)?.[1]
    ?? '';

  const matches = classes.filter((c) => c.id === base || c.id.startsWith(base));
  if (!matches.length) return null;
  if (matches.length === 1) return { id: matches[0].id };

  const exact = matches.find((c) => c.id === base + letter);
  if (letter && exact) return { id: exact.id };
  return { ambiguous: matches.map((c) => c.title) };
}

export function parseProgramme(text: string): string | null {
  const said = normalize(text);
  if (word('обе|оба|все|любая|любую|не ?важно').test(said)) return 'all';
  if (/росси|русск/.test(said)) return 'ru';
  if (/украин|местн/.test(said)) return 'ua';
  return null;
}

export function parseYesNo(text: string): boolean | null {
  const said = normalize(text);
  if (word('да|ага|конечно|давай|хочу|нужно|можно|рассказывай').test(said)) return true;
  if (word('нет|не надо|не нужно|не хочу|не стоит').test(said)) return false;
  return null;
}

// Какой день спросили: сегодня, завтра или названный по имени.
export function parseDay(text: string): { offset?: number; weekday?: string } | null {
  const said = normalize(text);
  if (/послезавтра/.test(said)) return { offset: 2 };
  if (/завтра/.test(said)) return { offset: 1 };
  if (/сегодня|сейчас/.test(said)) return { offset: 0 };
  if (/вчера/.test(said)) return { offset: -1 };

  const days: [RegExp, string][] = [
    [/понедельник/, 'mon'], [/вторник/, 'tue'], [/сред[ауы]/, 'wed'],
    [/четверг/, 'thu'], [/пятниц/, 'fri'], [/суббот/, 'sat'], [/воскресен/, 'sun'],
  ];
  for (const [re, id] of days) if (re.test(said)) return { weekday: id };
  return null;
}

// В середине фразы предмет звучит со строчной, но аббревиатуры и латиницу
// трогать нельзя: «ИЗО», «English», «Soft skills».
export function speakSubject(name: string): string {
  const text = String(name ?? '').trim();
  if (!text) return text;
  if (/^[A-Za-z]/.test(text)) return text;
  const first = text.split(' ')[0];
  if (first.length > 1 && first === first.toUpperCase()) return text;
  return text[0].toLowerCase() + text.slice(1);
}

export function plural(n: number, forms = COUNT_FORMS): string {
  const ten = n % 100;
  if (ten >= 11 && ten <= 14) return forms[2];
  const one = n % 10;
  if (one === 1) return forms[0];
  if (one >= 2 && one <= 4) return forms[1];
  return forms[2];
}

export function listOut(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}

export function speakTime(time: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':');
  return m === '00' ? `${Number(h)}` : `${Number(h)}:${m}`;
}

export const PROGRAMME_NAMES: Record<string, string> = {
  all: 'обе программы',
  ru: 'российская программа',
  ua: 'местная программа',
};
