// Разбор расписания из опубликованной таблицы Google Sheets.
//
// Берём HTML-версию публикации (pubhtml/sheet), а не CSV: только в ней есть
// объединённые клетки и цвета фона. Цвет в этой таблице кодирует
// преподавателя, поэтому по нему же группируются уроки и вычисляется имя.

import { BY_LENGTH as STAFF_BY_LENGTH, SECOND_ENGLISH } from './staff.mjs';
import { expandSubject } from './subjects.mjs';

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
const UA_TEACHER_RE = /^(т\.\s?в\.|татьяна\s+в\.?)$/i;
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

// Отделяем преподавателей от названия урока, снимая с конца известные имена
// вместе со слэшами между ними: "Матем. Ангелина / Алла Г." -> "Матем.".
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

function splitLesson(raw) {
  const places = [];
  let note = '';
  let extra = false;
  let end = raw.length;

  const head = () => raw.slice(0, end);

  // Снимает с конца пометку в скобках: кабинет запоминаем, прочее — примечание.
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
    const name = STAFF_BY_LENGTH.find((n) => {
      if (!trimmed.toLowerCase().endsWith(n.toLowerCase())) return false;
      const before = trimmed[trimmed.length - n.length - 1];
      return before === undefined || /[\s/,(.]/.test(before);
    });
    if (!name) break;

    teachers.unshift(trimmed.slice(trimmed.length - name.length));
    end = trimmed.length - name.length;

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
  let tracks = [];
  if (subjects.length === 1 && teachers.length === 2 && UA_TEACHER_RE.test(teachers[1])) {
    tracks = teachers.map((teacher, i) => ({
      subject,
      teacher,
      place: i === 0 ? places.slice().reverse().join(' / ') : '',
    }));
  } else if (subjects.length > 1 && subjects.length === parts.length) {
    tracks = subjects.map((name, i) => {
      const part = parts[i];
      const room = /\(([^()]*)\)/.exec(part);
      const place = room && PLACE_RE.test(room[1].trim()) ? room[1].trim() : '';
      return {
        subject: name.replace(/[\s,/–-]+$/, '').trim() || name,
        teacher: part.replace(/\s*\([^()]*\)\s*\*?/g, '').trim(),
        place,
      };
    });
  }

  return {
    subject: subject || raw,
    teachers: subject ? teachers : [],
    place: tracks.length ? '' : places.slice().reverse().join(' / '),
    note,
    extra,
    tracks,
    // Тег про подгруппы ставим только когда действительно вышло две дорожки.
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

  const teacherByColor = new Map();
  for (const e of allEntries) {
    if (e.kind !== 'lesson') continue;
    const parsed = splitLesson(e.raw);
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

    // Раскрываем сокращения в самом конце: логика выше опирается на то,
    // как предмет записан в таблице.
    e.subject = expandSubject(e.subject);
    for (const t of e.tracks) t.subject = expandSubject(t.subject);

    if (e.color && parsed.teachers.length === 1) {
      if (!teacherByColor.has(e.color)) teacherByColor.set(e.color, new Map());
      const tally = teacherByColor.get(e.color);
      tally.set(parsed.teachers[0], (tally.get(parsed.teachers[0]) || 0) + 1);
    }
  }

  for (const e of allEntries) {
    if (e.kind === 'lesson') continue;
    const parsed = splitLesson(e.raw);
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

  // Цвет клетки закреплён за преподавателем — на этом строится легенда.
  const byName = new Map();
  for (const [color, tally] of teacherByColor) {
    const names = [...tally].sort((x, y) => y[1] - x[1] || y[0].length - x[0].length);
    let name = names[0][0];
    // "Анаст." и "Анастасия" — один человек, в легенду ставим полное имя.
    const stem = name.replace(/\.$/, '').toLowerCase();
    const full = names.find(([n]) => n.length > name.length && n.toLowerCase().startsWith(stem));
    if (full) name = full[0];
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(color);
  }
  const legend = [...byName]
    .map(([name, colors]) => ({ name, colors }))
    .sort((x, y) => x.name.localeCompare(y.name, 'ru'));

  return {
    updatedAt: new Date().toISOString(),
    source: sourceUrl || null,
    classes: classOrder,
    legend,
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
