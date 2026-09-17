// Разбор того, что человек сказал, и сборка ответа. Алиса присылает команду
// уже в нижнем регистре и без знаков препинания.

// Сравниваем по основе, а не по целому слову: класс называют в любом падеже
// — «второго», «во втором», «вторая группа».
const ORDINALS: [RegExp, string][] = [
  [/подготов|нулев/, 'подг'],
  [/перв/, '1'], [/втор/, '2'], [/трет/, '3'], [/четв/, '4'], [/пят/, '5'],
  [/шест/, '6'], [/седьм/, '7'], [/восьм/, '8'], [/девят/, '9'],
];

// Дни недели убираем перед разбором: «вторник» начинается так же, как
// «второй», а «пятница» — как «пятый».
const WEEKDAY_WORDS = /понедельник\w*|вторник\w*|сред[ауые]\w*|четверг\w*|пятниц\w*|суббот\w*|воскресен\w*/g;

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
  const said = normalize(text).replace(WEEKDAY_WORDS, ' ');

  let base = '';
  const digit = word('(\\d)').exec(said);
  if (digit) base = digit[1];
  for (const [stem, value] of ORDINALS) {
    if (stem.test(said)) { base = value; break; }
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
  // «украинская» и «местная» оставлены синонимами: так эту программу
  // называют в школе и в миниаппе.
  if (/друг|украин|местн/.test(said)) return 'ua';
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

const TIMES_FORMS = ['раз', 'раза', 'раз'];
const NUMBER_WORDS = ['', '', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь'];

// Повторы схлопываем в «труд два раза». Форму «два труда» не берём нарочно:
// после числительного нужен родительный падеж, а предметы в таблице
// появляются новые каждую неделю — «два Soft skills» звучало бы хуже.
export function mergeRepeats(names: string[]): string[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const name of names) {
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return order.map((name) => {
    const n = counts.get(name) ?? 1;
    if (n < 2) return name;
    return `${name} ${NUMBER_WORDS[n] ?? n} ${plural(n, TIMES_FORMS)}`;
  });
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
  ua: 'другая программа',
};
