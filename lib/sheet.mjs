// Разбор расписания из опубликованной таблицы Google Sheets.
//
// Берём HTML-версию публикации (pubhtml/sheet), а не CSV: только в ней есть
// объединённые клетки и цвета фона. Цвет в этой таблице кодирует
// преподавателя, поэтому по нему же группируются уроки и вычисляется имя.

import { EXTRA_STAFF, SECOND_ENGLISH, UA_TEACHER } from './staff.mjs';
import { SUBJECT_KEYS, collectSubjectForms, expandSubject, subjectKey } from './subjects.mjs';

const DEFAULT_SHEET =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSrAMZV_aCBwnIwQOAiZOu8IMzO4xTpG14L6IUoYt-47T5aXJkj1KJRgVT_bg5IkUOdq5qCJlTQTZjV';
const DEFAULT_GID = '78299199';

const WEEKDAYS = [
  { id: 'mon', short: 'Пн', title: 'Понедельник', keys: ['пн', 'понедельник'] },
  { id: 'tue', short: 'Вт', title: 'Вторник', keys: ['вт', 'вторник'] },
  { id: 'wed', short: 'Ср', title: 'Среда', keys: ['ср', 'среда'] },
  { id: 'thu', short: 'Чт', title: 'Четверг', keys: ['чт', 'четверг'] },
  { id: 'fri', short: 'Пт', title: 'Пятница', keys: ['пт', 'пятница'] },
  { id: 'sat', short: 'Сб', title: 'Суббота', keys: ['сб', 'суббота'] },
  { id: 'sun', short: 'Вс', title: 'Воскресенье', keys: ['вс', 'воскресенье'] },
];

const BREAK_RE = /перемена|перекус|обед|динамическ/i;
const PAID_RE = /черногорск[а-яё]*\s+(язык\s+)?для\s+старших/i;
// Татьяна В. ведёт местную программу. Если предмет назван один раз, а
// преподавателей двое и второй — она, класс всё равно делится: у половин
// просто одинаковое название предмета ("Математика Над. / Т.В.").
// Алла Г. в младших классах — второй педагог на том же уроке, не деление.
const HOMEROOM_RE = /^кл[а-яё]*\.?\s*час\.?\s+(.+)$/i;
// Вторая половина названа по-украински — верный признак деления по программам.
const UA_SUBJECT = /укр|нав\.?\s*світ|дивослово/i;
const ENGLISH_RE = /\b(eng|англ)/i;
const NATALYA_RE = /^(n|nat|natalya)\.?$/i;

const OUTRO_RE = /дети идут домой|дети уходят/i;
const LUNCH_RE = /обед/i;
// Обычный урок идёт 40-45 минут, сдвоенный — 90-95: он занимает два звонка
// с переменой внутри. Занятия второй половины дня тоже длинные, но это
// кружки, а не сдвоенные уроки, поэтому они не в счёт.
const DOUBLE_LESSON_MINUTES = 70;
const FREE_RE = /^(прогулка|свободная игра|самоподготовка|свободное время)/i;
const TIME_RE = /^(\d{1,2})[.:](\d{2})$/;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const key = body.toLowerCase();
    return key in ENTITIES ? ENTITIES[key] : m;
  });
}

// Google переносит длинные слова дефисом внутри клетки: "Физкуль-<br>тура".
// Склеиваем такие строки обратно, остальные соединяем пробелом.
function cellText(html) {
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  );
  const lines = text
    .replace(/\u00a0/g, ' ')
    // "Информа- тика" — перенос, набранный дефисом вручную, без <br>.
    .replace(/([а-яёa-z])-\s+(?=[а-яё])/gi, '$1')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  let out = '';
  for (const line of lines) {
    if (!out) out = line;
    else if (/[а-яёa-z]-$/i.test(out)) out = out.slice(0, -1) + line;
    else out += ' ' + line;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function parseStyles(html) {
  const colors = new Map();
  for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of block[1].matchAll(/\.(s\d+)\s*\{([^}]*)\}/g)) {
      const bg = /background-color:\s*(#[0-9a-fA-F]{6})/.exec(rule[2]);
      if (bg) colors.set(rule[1], bg[1].toLowerCase());
    }
  }
  return colors;
}

// Развёртка таблицы в плотную сетку с учётом rowspan/colspan.
// Каждая позиция ссылается на исходную (origin) клетку, поэтому объединённый
// урок виден из всех классов, которые он накрывает.
function buildGrid(html) {
  const colors = parseStyles(html);
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);

  const cells = new Map();
  const key = (r, c) => r + ':' + c;
  let width = 0;

  rows.forEach((rowHtml, r) => {
    let c = 0;
    for (const m of rowHtml.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      const attrs = m[2];
      const cls = (/class="([^"]*)"/.exec(attrs) || [, ''])[1];
      const rowspan = Math.max(1, parseInt((/rowspan="(\d+)"/.exec(attrs) || [, '1'])[1], 10));
      const colspan = Math.max(1, parseInt((/colspan="(\d+)"/.exec(attrs) || [, '1'])[1], 10));

      while (cells.has(key(r, c))) c += 1;

      const cell = {
        text: cellText(m[3]),
        bg: colors.get(cls.split(/\s+/)[0]) || '',
        row: r,
        col: c,
        rowspan,
        colspan,
        service: /freezebar|row-header|header-shim/.test(cls),
      };
      for (let dr = 0; dr < rowspan; dr += 1) {
        for (let dc = 0; dc < colspan; dc += 1) {
          cells.set(key(r + dr, c + dc), cell);
        }
      }
      c += colspan;
      if (c > width) width = c;
    }
  });

  return {
    height: rows.length,
    width,
    at: (r, c) => cells.get(key(r, c)) || null,
  };
}

function toMinutes(value) {
  const m = TIME_RE.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesBetween(from, to) {
  const a = toMinutes((from || '').replace(':', '.'));
  const b = toMinutes((to || '').replace(':', '.'));
  return a == null || b == null ? 0 : b - a;
}

function formatTime(minutes) {
  if (minutes == null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Строки-заголовки: в них подряд стоят подписи вида "3 класс" / "9 кл.".
function findHeaderRows(grid) {
  const out = [];
  for (let r = 0; r < grid.height; r += 1) {
    const labels = [];
    for (let c = 0; c < grid.width; c += 1) {
      const cell = grid.at(r, c);
      if (!cell || cell.service || cell.row !== r || cell.col !== c) continue;
      if (/^.{1,12}?\s*(класс|кл\.)$/i.test(cell.text)) labels.push({ col: c, text: cell.text });
    }
    if (labels.length >= 5) out.push({ row: r, labels });
  }
  return out;
}

function classId(title) {
  const m = /^\s*(.+?)\s*(класс|кл\.)\s*$/i.exec(title);
  const base = (m ? m[1] : title).trim();
  return base.replace(/\s+/g, '').replace(/\.$/, '').toLowerCase();
}

function findDayName(grid, row) {
  for (let r = row; r >= Math.max(0, row - 3); r -= 1) {
    for (let c = 0; c < grid.width; c += 1) {
      const cell = grid.at(r, c);
      if (!cell || cell.row !== r || cell.col !== c) continue;
      const t = cell.text.trim().toLowerCase().replace(/\.$/, '');
      const day = WEEKDAYS.find((d) => d.keys.includes(t));
      if (day) return day;
    }
  }
  return null;
}

// Колонки со звонками. Их две (младшая и старшая школа) плюс дубль справа,
// поэтому на каждую строку берём первое значение, не ломающее возрастание.
function findTimeColumns(grid, from, to) {
  const out = [];
  for (let c = 0; c < grid.width; c += 1) {
    let hits = 0;
    for (let r = from; r <= to; r += 1) {
      const cell = grid.at(r, c);
      if (cell && cell.row === r && cell.col === c && toMinutes(cell.text) != null) hits += 1;
    }
    if (hits >= 5) out.push(c);
  }
  return out;
}

function buildTimeLadder(grid, from, to, timeCols) {
  const ladder = new Array(to - from + 1).fill(null);
  let last = -1;
  for (let r = from; r <= to; r += 1) {
    const candidates = [];
    for (const c of timeCols) {
      const cell = grid.at(r, c);
      if (!cell || cell.row !== r || cell.col !== c) continue;
      const v = toMinutes(cell.text);
      if (v != null) candidates.push(v);
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => a - b);
    const picked = candidates.find((v) => v >= last);
    const value = picked != null ? picked : candidates[candidates.length - 1];
    ladder[r - from] = value;
    last = value;
  }
  return ladder;
}

// Кабинет: короткая пометка в скобках вида (6), (библ.), (м./6).
// Всё остальное в скобках — примечание, а не место.
const PLACE_RE = /^(\d{1,2}|[а-яё]{1,6}\.|м\.\/\d{1,2}|\d{1,2}\/[а-яё.]{1,6})$/i;

// Делит строку по слэшам верхнего уровня: скобки не режем, потому что
// внутри них встречается и слэш — "(м./6)".
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '/' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map((x) => x.trim()).filter(Boolean);
}

function spaceSlashes(text) {
  let depth = 0;
  let out = '';
  for (const ch of String(text || '')) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    out += ch === '/' && depth === 0 ? ' / ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function dropParens(text) {
  return String(text || '')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/[*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Приводит найденный кусок к виду имени и отсеивает то, что именем быть не
// может: слишком длинное, со строчной буквы, начинающееся с названия
// предмета ("English Natalya" -> "Natalya").
function asName(text) {
  let s = dropParens(text).replace(/^[\s/,.-]+|[\s/,-]+$/g, '');
  if (!s) return '';

  let words = s.split(' ').filter(Boolean);
  while (words.length > 1 && SUBJECT_KEYS.has(subjectKey(words[0]))) words.shift();
  s = words.join(' ');

  if (!s || s.length > 24 || words.length > 3) return '';
  if (!/^[A-ZА-ЯЁІЇЄҐ]/.test(s)) return '';
  if (SUBJECT_KEYS.has(subjectKey(s))) return '';
  return s;
}

function commonSuffixWords(list) {
  const words = list.map((x) => x.split(' ').filter(Boolean));
  const limit = Math.min(...words.map((w) => w.length));
  let best = [];
  for (let n = 1; n <= limit; n += 1) {
    const variants = new Set(words.map((w) => w.slice(-n).join(' ').toLowerCase()));
    if (variants.size !== 1) break;
    best = words[0].slice(-n);
  }
  return best;
}

// Собирает имена преподавателей из самой таблицы, чтобы новый человек в
// расписании не требовал правки кода. Три независимых признака:
//   1) в клетке с двумя и более слэшами последняя часть — всегда имя
//      ("Литература / Матем. Кристина (5) / Т.В.");
//   2) в клетке классного часа имя стоит сразу после "Кл. час";
//   3) клетки одного цвета ведёт один человек, поэтому общий хвост
//      названий внутри цвета — тоже имя.
function learnStaff(entries) {
  const found = new Map();
  const add = (text) => {
    const name = asName(text);
    if (name) found.set(name.toLowerCase(), name);
  };

  const byColor = new Map();
  const opens = new Set();
  const tails = [];

  for (const e of entries) {
    if (e.kind !== 'lesson') continue;

    const parts = splitTopLevel(e.raw);
    if (parts.length >= 3) add(parts[parts.length - 1]);

    const homeroom = HOMEROOM_RE.exec(e.raw);
    if (homeroom) add(homeroom[1]);

    if (e.color) {
      if (!byColor.has(e.color)) byColor.set(e.color, new Set());
      byColor.get(e.color).add(dropParens(e.raw));
    }

    const words = dropParens(spaceSlashes(e.raw)).split(' ').filter(Boolean);
    if (words.length > 1) {
      opens.add(words[0].toLowerCase());
      tails.push(words);
    }
  }

  for (const texts of byColor.values()) {
    if (texts.size < 2) continue;
    add(commonSuffixWords([...texts]).join(' '));
  }

  // Предмет стоит в начале клетки, преподаватель — в конце. Значит слово,
  // которое встречается только в конце и ни разу в начале, — это имя.
  const lastWords = new Set();
  for (const words of tails) {
    const last = words[words.length - 1];
    if (/^[A-ZА-ЯЁІЇЄҐ]/.test(last)) lastWords.add(last.toLowerCase());
  }

  for (const words of tails) {
    for (const n of [2, 1]) {
      if (words.length <= n) continue;
      const tail = words.slice(-n);
      if (opens.has(tail[0].toLowerCase())) continue;
      if (tail.some((w) => SUBJECT_KEYS.has(subjectKey(w)))) continue;
      // Из двух слов имя выходит, только если второе — сокращение
      // ("Мария К."), либо первое само встречается как имя целиком.
      if (n === 2 && !tail[1].endsWith('.') && !lastWords.has(tail[0].toLowerCase())) continue;
      add(tail.join(' '));
    }
  }

  for (const name of EXTRA_STAFF) add(name);

  // Сначала пробуем самые длинные варианты: "Мария Кикт." важнее "Мария".
  return [...found.values()].sort((a, b) => b.length - a.length);
}

// Сравниваем имена без точек и пробелов: "Т.В." и "Т.В" — одно и то же.
const nameKey = (text) => String(text || '').replace(/[\s.]/g, '').toLowerCase();

// Имя ли это. Кроме точного совпадения принимаем сокращение известного имени
// и, наоборот, полную форму известного сокращения: "Крист." от "Кристина",
// "Александр" от "Алекс.". Название предмета именем быть не может.
function isStaffName(candidate, staff) {
  if (!/^[A-ZА-ЯЁІЇЄҐ]/.test(candidate)) return false;
  if (SUBJECT_KEYS.has(subjectKey(candidate))) return false;

  if (candidate.includes('/')) return false;

  const key = nameKey(candidate);
  if (!key) return false;
  const min = candidate.endsWith('.') ? 2 : 3;
  // Разворачивать сокращение до полного имени можно только у одного слова:
  // иначе "Крист. / Т.В." сойдёт за длинную форму имени "Крист.".
  const single = !candidate.includes(' ');

  return staff.some((name) => {
    const other = nameKey(name);
    if (other === key) return true;
    if (key.length < 2) return false;
    if (other.length < key.length) return single && other.length >= min && key.startsWith(other);
    return key.length >= min && other.startsWith(key);
  });
}

// Ищет имя в конце строки и возвращает его длину.
function matchStaff(text, staff) {
  const words = text.split(' ').filter(Boolean);
  for (let n = Math.min(3, words.length); n >= 1; n -= 1) {
    const candidate = words.slice(words.length - n).join(' ');
    const before = text[text.length - candidate.length - 1];
    if (before !== undefined && !/[\s/,(]/.test(before)) continue;
    if (isStaffName(candidate, staff)) return candidate.length;
  }

  // Имя может примыкать к предмету без пробела: "Инф.Ал.".
  const glued = /\.([A-ZА-ЯЁІЇЄҐ][A-Za-zА-Яа-яЁёІЇЄҐ]*\.?)$/.exec(text);
  if (glued && isStaffName(glued[1], staff)) return glued[1].length;
  return 0;
}

// Отделяем преподавателей от названия урока, снимая с конца известные имена
// вместе со слэшами между ними: "Матем. Ангелина / Алла Г." -> "Матем.".
function splitLesson(source, staff) {
  const raw = spaceSlashes(source);
  const places = [];
  let note = '';
  let extra = false;
  let end = raw.length;

  const head = () => raw.slice(0, end);

  const peelParens = () => {
    const m = /\s*\(([^()]*)\)\s*(\*?)\s*$/.exec(head());
    if (!m) return false;
    const body = m[1].trim();
    if (m[2]) extra = true;
    if (PLACE_RE.test(body)) places.push(body);
    else if (!note) note = body;
    end = m.index;
    return true;
  };

  if (!peelParens() && /\*\s*$/.test(raw)) {
    extra = true;
    end = raw.replace(/\*\s*$/, '').length;
  }

  const teachers = [];
  for (;;) {
    // Скобки встречаются и между именами: "Кристина (5) / Т.В.".
    if (teachers.length && peelParens()) continue;

    const trimmed = head().trimEnd();
    const len = matchStaff(trimmed, staff);
    if (!len) break;

    teachers.unshift(trimmed.slice(trimmed.length - len));
    end = trimmed.length - len;

    const afterName = head().trimEnd();
    if (!/[/,]$/.test(afterName)) break;
    end = afterName.length - 1;
  }

  const subjectRaw = raw.slice(0, end);
  const teacherRaw = raw.slice(end);
  const subject = subjectRaw.replace(/[\s,/–-]+$/, '').trim();

  // Двойной урок: "Литература / Матем." + "Кристина (5) / Т.В." — это две
  // подгруппы, и кабинет относится только к своей половине класса.
  const subjects = splitTopLevel(subjectRaw);
  const parts = splitTopLevel(teacherRaw);
  const roomOf = (i) => (i === 0 ? places.slice().reverse().join(' / ') : '');
  let tracks = [];

  if (subjects.length === 1 && teachers.length === 2 && UA_TEACHER.test(teachers[1])) {
    // Название предмета одно, а половины класса ведут разные преподаватели.
    tracks = teachers.map((teacher, i) => ({ subject, teacher, place: roomOf(i) }));
  } else if (subjects.length > 1 && subjects.length === parts.length) {
    tracks = subjects.map((name, i) => {
      const part = parts[i];
      // Кабинет может стоять и при предмете: "Рус.яз. / Eng. (5) Крист. / N.".
      const room = /\(([^()]*)\)/.exec(part) || /\(([^()]*)\)/.exec(name);
      return {
        subject: dropParens(name).replace(/[\s,/–-]+$/, '').trim() || name,
        teacher: dropParens(part),
        place: room && PLACE_RE.test(room[1].trim()) ? room[1].trim() : '',
      };
    });
  } else if (subjects.length === 2 && parts.length === 1 && UA_SUBJECT.test(subjects[1])) {
    // "Рус. яз. / Укр. Крист." — обе половины ведёт один преподаватель.
    tracks = subjects.map((name, i) => ({
      subject: name.replace(/[\s,/–-]+$/, '').trim() || name,
      teacher: dropParens(parts[0]),
      place: roomOf(i),
    }));
  }

  return {
    subject: subject || raw,
    teachers: subject ? teachers : [],
    place: tracks.length ? '' : places.slice().reverse().join(' / '),
    note,
    extra,
    tracks,
    split: tracks.length > 1,
  };
}

function classifyKind(text, classSpanCount, totalClasses) {
  if (BREAK_RE.test(text)) return 'break';
  if (OUTRO_RE.test(text)) return 'outro';
  if (FREE_RE.test(text)) return 'free';
  if (classSpanCount >= Math.min(8, totalClasses)) return 'notice';
  return 'lesson';
}

function parseSchedule(html, { sourceUrl } = {}) {
  const grid = buildGrid(html);
  const headers = findHeaderRows(grid);
  if (!headers.length) throw new Error('в таблице не найдены строки с названиями классов');

  const classOrder = [];
  const classSeen = new Map();
  for (const { labels } of headers) {
    for (const { text } of labels) {
      const id = classId(text);
      if (!classSeen.has(id)) {
        classSeen.set(id, { id, title: text.trim() });
        classOrder.push(classSeen.get(id));
      }
    }
  }

  const days = [];
  const allEntries = [];

  headers.forEach((header, i) => {
    const from = Math.max(0, header.row - 1);
    const to = i + 1 < headers.length ? headers[i + 1].row - 3 : grid.height - 1;
    if (to < from) return;

    const day = findDayName(grid, header.row - 1) || {
      id: 'day' + (i + 1),
      short: String(i + 1),
      title: 'День ' + (i + 1),
    };
    const timeCols = new Set(findTimeColumns(grid, from, to));
    const ladder = buildTimeLadder(grid, from, to, [...timeCols].sort((a, b) => a - b));

    const startAt = (row) => {
      for (let r = row; r >= from; r -= 1) if (ladder[r - from] != null) return ladder[r - from];
      return null;
    };
    const endAt = (row) => {
      for (let r = row + 1; r <= to; r += 1) if (ladder[r - from] != null) return ladder[r - from];
      return null;
    };

    const colToClass = new Map(header.labels.map(({ col, text }) => [col, classId(text)]));
    const byClass = {};
    for (const cls of classOrder) byClass[cls.id] = [];

    for (const { col, text } of header.labels) {
      const id = classId(text);
      const seen = new Set();

      for (let r = header.row + 1; r <= to; r += 1) {
        const cell = grid.at(r, col);
        if (!cell || cell.service || !cell.text) continue;
        const originKey = cell.row + ':' + cell.col;
        if (seen.has(originKey)) continue;
        seen.add(originKey);
        if (toMinutes(cell.text) != null) continue;

        const spanCols = [];
        for (let c = cell.col; c < cell.col + cell.colspan; c += 1) {
          if (colToClass.has(c)) spanCols.push(colToClass.get(c));
        }
        const kind = classifyKind(cell.text, spanCols.length, header.labels.length);
        const lastRow = cell.row + cell.rowspan - 1;

        const marker = (() => {
          if (kind !== 'lesson' || timeCols.has(col + 1) || colToClass.has(col + 1)) return '';
          const m = grid.at(cell.row, col + 1);
          if (!m || m.service || !m.text || m.text === cell.text) return '';
          return toMinutes(m.text) != null ? '' : m.text;
        })();

        byClass[id].push({
          raw: cell.text,
          kind,
          start: formatTime(startAt(Math.max(cell.row, from))),
          end: formatTime(endAt(Math.min(lastRow, to))),
          color: cell.bg && cell.bg !== '#ffffff' ? cell.bg : '',
          marker,
          sharedWith: spanCols.filter((x) => x !== id),
          row: cell.row,
        });
      }
    }

    // Общешкольные объявления живут в строке над заголовком классов.
    const notices = [];
    for (let c = 0; c < grid.width; c += 1) {
      const cell = grid.at(header.row - 1, c);
      if (!cell || cell.service || !cell.text || cell.row !== header.row - 1) continue;
      if (toMinutes(cell.text) != null) continue;
      if (cell.colspan < 4) continue;
      if (!notices.includes(cell.text)) notices.push(cell.text);
    }

    for (const id of Object.keys(byClass)) {
      byClass[id].sort((a, b) => a.row - b.row);
      let n = 0;
      // Границей второй половины дня служит последний служебный блок:
      // у младших это прогулка, у старших обед или самоподготовка. Всё, что
      // стоит после него, — дополнительные занятия (пункт 5 расшифровки).
      // Обед в середине дня границей не является: после него у младших
      // классов идут обычные уроки.
      const isBoundary = (e) => e.kind === 'free'
        || (e.kind === 'break' && LUNCH_RE.test(e.raw));
      let boundary = -1;
      byClass[id].forEach((e, i) => { if (isBoundary(e)) boundary = i; });

      byClass[id].forEach((e, i) => {
        delete e.row;
        e.index = e.kind === 'lesson' ? (n += 1) : 0;
        e.afternoon = e.kind === 'lesson' && i > boundary;
        e.double = e.kind === 'lesson' && !e.afternoon
          && minutesBetween(e.start, e.end) >= DOUBLE_LESSON_MINUTES;
      });
      allEntries.push(...byClass[id]);
    }

    days.push({ id: day.id, short: day.short, title: day.title, notices, byClass });
  });

  // Словарь имён собираем по всей таблице сразу: разбору отдельной клетки
  // нужны имена, встреченные в других клетках.
  const staff = learnStaff(allEntries);

  for (const e of allEntries) {
    if (e.kind !== 'lesson') continue;
    const parsed = splitLesson(e.raw, staff);
    Object.assign(e, parsed);
    // Дополнительное занятие: звёздочка в таблице, черногорский для старших
    // либо любая активность после обеда.
    e.paid = parsed.extra || PAID_RE.test(e.raw) || Boolean(e.afternoon);
    if (e.paid && /^доп\.?\s*(курс|программа)/i.test(e.note)) e.note = '';

    // Вторая группа английского (Наталья) помечена буквой N в узкой колонке
    // либо стоит прямо в клетке как преподаватель. Пометка относится только
    // к английскому, поэтому у двойного урока переносим её на свою подгруппу.
    const markerN = SECOND_ENGLISH.test(e.marker);
    e.secondEnglish = markerN;

    // Сам английский делится на две группы: часть класса у Mrs. Strock,
    // часть у Натальи. Это не связано с программой, поэтому пометка нужна
    // при любом выборе.
    for (const t of e.tracks) {
      t.programme = '';
      t.secondEnglish = ENGLISH_RE.test(t.subject)
        && (markerN || NATALYA_RE.test(t.teacher));
    }
    if (e.tracks.some((t) => t.secondEnglish)) e.secondEnglish = false;

    // Двойная клетка — это деление класса по программам: первая половина
    // идёт по российской, вторая по местной (пункт 1 расшифровки).
    if (e.tracks.length === 2) {
      e.tracks[0].programme = 'ru';
      e.tracks[1].programme = 'ua';
    }

  }

  // Раскрываем сокращения после того, как разобрана вся таблица: полные
  // написания одних клеток расшифровывают сокращения в других.
  const forms = collectSubjectForms(allEntries.flatMap((e) => (e.kind === 'lesson'
    ? [e.subject, ...e.tracks.map((t) => t.subject)]
    : [])));

  for (const e of allEntries) {
    if (e.kind !== 'lesson') continue;
    e.subject = expandSubject(e.subject, forms);
    for (const t of e.tracks) t.subject = expandSubject(t.subject, forms);
  }

  for (const e of allEntries) {
    if (e.kind === 'lesson') continue;
    const parsed = splitLesson(e.raw, staff);
    Object.assign(e, {
      subject: parsed.place ? e.raw : parsed.subject,
      teachers: [],
      place: '',
      note: parsed.place ? '' : parsed.note,
      extra: parsed.extra,
      paid: false,
      afternoon: false,
      double: false,
      tracks: [],
      marker: '',
      split: false,
      secondEnglish: false,
      sharedWith: [],
    });
  }

  return {
    updatedAt: new Date().toISOString(),
    source: sourceUrl || null,
    classes: classOrder,
    days,
  };
}

function sheetUrl({ sheet = DEFAULT_SHEET, gid = DEFAULT_GID } = {}) {
  return `${sheet.replace(/\/+$/, '')}/pubhtml/sheet?headers=false&gid=${encodeURIComponent(gid)}`;
}

// Адрес таблицы для человека — на него ведёт ссылка в подвале приложения.
function publicUrl({ sheet = DEFAULT_SHEET, gid = DEFAULT_GID } = {}) {
  return `${(sheet || DEFAULT_SHEET).replace(/\/+$/, '')}/pubhtml?gid=${encodeURIComponent(gid || DEFAULT_GID)}&single=true`;
}

async function fetchSchedule(options = {}) {
  const url = sheetUrl(options);
  const res = await fetch(url, {
    headers: { 'user-agent': 'compass-timetable/1.0', 'accept-language': 'ru,en' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`таблица недоступна: HTTP ${res.status}`);
  const html = await res.text();
  return parseSchedule(html, { sourceUrl: options.publicUrl || null });
}

export { DEFAULT_GID, DEFAULT_SHEET, WEEKDAYS, fetchSchedule, parseSchedule, publicUrl, sheetUrl };
