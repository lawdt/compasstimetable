// Расшифровка сокращённых названий предметов. В таблице один и тот же
// предмет записан по-разному ("Матем.", "Мат.", "Математ."), поэтому ключом
// служит название без точек, пробелов и регистра.
//
// Названия, которых здесь нет, показываются как в таблице — только без
// точки в конце. Появился новый предмет в сокращении — допишите строку.
const SUBJECTS = {
  математика: 'Математика',
  матем: 'Математика',
  мат: 'Математика',
  математ: 'Математика',

  словесность: 'Словесность',
  словесн: 'Словесность',
  слов: 'Словесность',
  сл: 'Словесность',

  информатика: 'Информатика',
  информ: 'Информатика',
  инф: 'Информатика',

  технологии: 'Технологии',
  техн: 'Технологии',

  русскийязык: 'Русский язык',
  русяз: 'Русский язык',
  ряз: 'Русский язык',

  украинскийязык: 'Украинский язык',
  укр: 'Украинский язык',

  черногорскийязык: 'Черногорский язык',
  черногязык: 'Черногорский язык',
  черняз: 'Черногорский язык',

  английский: 'Английский',
  english: 'Английский',
  eng: 'Английский',
  en: 'Английский',

  биология: 'Биология',
  биолог: 'Биология',

  география: 'География',
  геогр: 'География',

  геометрия: 'Геометрия',
  геометр: 'Геометрия',
  геом: 'Геометрия',

  история: 'История',
  истор: 'История',

  литература: 'Литература',
  литер: 'Литература',

  окружающиймир: 'Окружающий мир',
  окружмир: 'Окружающий мир',
  окрмир: 'Окружающий мир',
  навсвіт: 'Навколишній світ',

  классныйчас: 'Классный час',
  класснчас: 'Классный час',
  клчас: 'Классный час',

  внеклчтение: 'Внеклассное чтение',
  логопед: 'Логопедические занятия',
  логопедическиезанятия: 'Логопедические занятия',
  физкультура: 'Физкультура',
  обществознание: 'Обществознание',
  softskills: 'Soft skills',
  ssk: 'Soft skills',
};

// В таблице попадаются латинские двойники кириллических букв: "Cлов.".
// Подменяем их только там, где кириллица уже есть, чтобы не задеть
// английские названия вроде "Soft skills".
const LOOKALIKE = {
  c: 'с', a: 'а', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у',
  C: 'С', A: 'А', E: 'Е', O: 'О', P: 'Р', X: 'Х', Y: 'У',
};

function subjectKey(name) {
  let s = String(name || '');
  if (/[а-яёіїєґ]/i.test(s)) s = s.replace(/[caeopxyCAEOPXY]/g, (ch) => LOOKALIKE[ch]);
  return s.toLowerCase().replace(/[^0-9a-zа-яёіїєґ]+/gi, '');
}

function tidySubject(name) {
  return String(name || '')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/[.\s]+$/, '')
    .trim();
}

// Полные написания предметов, встреченные в таблице: по ним разворачиваются
// сокращения, которых нет в словаре. Ключ — название без точек и пробелов.
function collectSubjectForms(names) {
  const forms = new Map();
  for (const name of names) {
    const text = String(name || '').trim();
    if (!text || text.includes('/') || /\.\s*$/.test(text)) continue;
    const key = subjectKey(text);
    if (key.length < 3) continue;
    const prev = forms.get(key);
    if (!prev || text.length > prev.length) forms.set(key, text);
  }
  return forms;
}

// "Ист." -> "История": сокращение узнаётся по полному написанию из той же
// таблицы, поэтому новое сокращение не требует правки словаря.
function derive(text, forms) {
  const key = subjectKey(text);
  if (!key) return '';
  if (forms.has(key)) return forms.get(key);
  if (!/\.\s*$/.test(text)) return '';

  let best = '';
  for (const [k, v] of forms) {
    if (k.length > key.length && k.startsWith(key) && (!best || v.length < best.length)) best = v;
  }
  return best;
}

function expandSubject(name, forms) {
  const text = String(name || '');
  const whole = SUBJECTS[subjectKey(text)];
  if (whole) return whole;

  // Составное название разбираем по частям, иначе половинки остаются
  // сокращениями, а точка последней съедается: "Рус. яз. / Укр.".
  if (text.includes('/')) {
    return text
      .split('/')
      .map((part) => expandSubject(part, forms))
      .filter(Boolean)
      .join(' / ');
  }

  return (forms && derive(text, forms)) || tidySubject(text);
}

const SUBJECT_KEYS = new Set(Object.keys(SUBJECTS));

export { SUBJECT_KEYS, SUBJECTS, collectSubjectForms, expandSubject, subjectKey, tidySubject };
