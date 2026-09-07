const tg = window.Telegram?.WebApp;
const STORE_KEY = 'compass.class';
const PROG_KEY = 'compass.programme';
const CACHE_KEY = 'compass.cache.v1';
const TZ = 'Europe/Podgorica';

// Расшифровка расписания от школы. Порядок пунктов сохранён.
const NOTES = [
  'По российской программе смотрите первый урок, то есть литературу (Кристина).',
  'Буква «N» обозначает вторую группу английского языка с Натальей (5-й класс делится на две группы).',
  'Зелёные клеточки обозначают, что половина класса идёт на информатику, а половина на труд, а потом они меняются местами.',
  'Это тоже обозначение второй группы английского языка.',
  'Черногорский для старших — доп. программа. 1 занятие 10 евро. Также есть абонемент 100 евро за все активности второй половины дня в месяц (включая дополнительные спортивные и другие занятия, а также помощь с домашкой).',
  'Минимум 1 черногорский, если сформируется группа желающих, можем также организовать черногорский+ для высоко мотивированных.',
];

const el = (id) => document.getElementById(id);
const dom = {
  topbar: el('topbar'), days: el('days'), page: el('page'), content: el('content'),
  skeleton: el('skeleton'), foot: el('foot'), freshness: el('freshness'),
  sourceLink: el('sourceLink'), currentClass: el('currentClass'),
  sheet: el('sheet'), sheetTitle: el('sheetTitle'), sheetBody: el('sheetBody'),
  progTrigger: el('progTrigger'), currentProgramme: el('currentProgramme'),
  pullHint: el('pullHint'),
};

// Двойные уроки идут по двум программам: первая половина клетки — российская,
// вторая — украинская (пункт 1 расшифровки). Выбор сворачивает такой урок до
// нужной половины; деление на информатику/труд и группы английского не трогает.
const PROGRAMMES = [
  { id: 'all', title: 'Обе программы', hint: 'Двойные уроки показываются целиком' },
  { id: 'ru', title: 'Российская', hint: 'В двойном уроке — только первая половина' },
  { id: 'ua', title: 'Украинская', hint: 'В двойном уроке — только вторая половина' },
];

const state = { data: null, classId: null, programme: 'all', dayId: null, error: null };
let booted = false;

/* ── Хранилище выбранного класса ───────────────────────────────────────── */
// CloudStorage синхронизируется между устройствами пользователя,
// localStorage остаётся запасным вариантом вне Telegram.
const store = {
  get(key) {
    const cloud = tg?.CloudStorage;
    if (!cloud?.getItem) return Promise.resolve(readLocal(key));
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      setTimeout(() => done(readLocal(key)), 1200);
      try {
        cloud.getItem(key, (err, value) => done(err || !value ? readLocal(key) : value));
      } catch { done(readLocal(key)); }
    });
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
    try { tg?.CloudStorage?.setItem?.(key, value, () => {}); } catch { /* не критично */ }
  },
};

function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/* ── Время ─────────────────────────────────────────────────────────────── */
const WEEK_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function schoolNow() {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  return {
    dayId: WEEK_ORDER[local.getDay()],
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function humanDuration(from, to) {
  const a = toMinutes(from);
  const b = toMinutes(to);
  if (a == null || b == null || b <= a) return '';
  const total = b - a;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} ч${m ? ' ' + m + ' мин' : ''}` : `${m} мин`;
}

/* ── Загрузка данных ───────────────────────────────────────────────────── */
async function load({ force = false } = {}) {
  if (!force) {
    const cached = readLocal(CACHE_KEY);
    if (cached) {
      try {
        state.data = JSON.parse(cached);
        state.error = null;
        render();
      } catch { /* повреждённый кэш игнорируем */ }
    }
  }

  try {
    const res = await fetch(`/api/schedule${force ? '?fresh=1' : ''}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.days?.length) throw new Error('пустой ответ');
    state.data = data;
    state.error = null;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* переполнение */ }
  } catch (err) {
    state.error = state.data ? null : err;
  }
  render();
}

/* ── Отрисовка ─────────────────────────────────────────────────────────── */
function render() {
  if (!booted) return;
  const { data } = state;

  if (!data) {
    dom.skeleton.hidden = !!state.error;
    dom.content.hidden = !state.error;
    if (state.error) {
      dom.content.innerHTML = `
        <div class="empty">
          <div class="empty__mark">📡</div>
          <p>Не получилось загрузить расписание.<br>Проверьте связь и попробуйте снова.</p>
          <button class="retry" type="button" id="retryBtn">Повторить</button>
        </div>`;
      el('retryBtn').onclick = () => { state.error = null; render(); load({ force: true }); };
    }
    return;
  }

  dom.skeleton.hidden = true;
  dom.content.hidden = false;

  if (!data.classes.some((c) => c.id === state.classId)) state.classId = null;
  const now = schoolNow();
  if (!data.days.some((d) => d.id === state.dayId)) {
    state.dayId = data.days.some((d) => d.id === now.dayId) ? now.dayId : data.days[0].id;
  }

  const cls = data.classes.find((c) => c.id === state.classId);
  dom.currentClass.textContent = cls ? cls.title : 'Выберите класс';

  // Переключатель нужен только там, где есть деление по программам:
  // в младших классах двойных уроков может не быть вовсе.
  const prog = PROGRAMMES.find((p) => p.id === state.programme) || PROGRAMMES[0];
  dom.currentProgramme.textContent = prog.title;
  dom.progTrigger.classList.toggle('prog-trigger--set', prog.id !== 'all');
  dom.progTrigger.hidden = !cls || !hasProgrammeSplit(data, cls.id);

  renderDays(data, now);

  if (!cls) {
    dom.content.innerHTML = `
      <div class="empty">
        <div class="empty__mark">🧭</div>
        <p>Выберите класс, чтобы увидеть расписание.<br>Мы запомним выбор.</p>
        <button class="retry" type="button" id="pickBtn">Выбрать класс</button>
      </div>`;
    el('pickBtn').onclick = openClassPicker;
  } else {
    const day = data.days.find((d) => d.id === state.dayId);
    dom.content.innerHTML = renderDay(day, cls, now);
  }

  dom.foot.hidden = false;
  dom.freshness.textContent = data.updatedAt
    ? 'Обновлено ' + new Intl.DateTimeFormat('ru-RU', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
    }).format(new Date(data.updatedAt))
    : '';
  dom.sourceLink.href = data.source || '#';
  dom.sourceLink.hidden = !data.source;
}

function renderDays(data, now) {
  dom.days.innerHTML = data.days.map((d) => `
    <button class="day" type="button" role="tab" data-day="${d.id}"
            aria-selected="${d.id === state.dayId}">
      ${esc(d.short)}${d.id === now.dayId ? '<span class="day__dot"></span>' : ''}
    </button>`).join('');
}

function renderDay(day, cls, now) {
  const entries = day.byClass[cls.id] || [];
  if (!entries.length) {
    return `<div class="empty"><div class="empty__mark">🌿</div>
      <p>В ${esc(day.title.toLowerCase())} занятий нет.</p></div>`;
  }

  const isToday = day.id === now.dayId;
  const notices = day.notices.map(noticeCard).join('');
  const rows = entries.map((e) => slot(e, cls, isToday, now.minutes)).join('');
  return notices + `<div class="timeline">${rows}</div>`;
}

function noticeCard(text) {
  return `<div class="notice">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 9v4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="10" cy="6.5" r="1" fill="currentColor"/></svg>
    <span>${esc(text)}</span></div>`;
}

function slot(e, cls, isToday, nowMinutes) {
  const from = toMinutes(e.start);
  const to = toMinutes(e.end);
  const live = isToday && from != null && to != null && nowMinutes >= from && nowMinutes < to;

  // У конца дня и объявлений время окончания взято из следующей строки
  // таблицы и смысла не несёт — показываем только начало.
  const showEnd = e.end && e.kind !== 'outro' && e.kind !== 'notice';
  const time = `<div class="slot__time">
      ${e.start ? `<span class="slot__from">${esc(e.start)}</span>` : ''}
      ${showEnd ? `<span class="slot__to">${esc(e.end)}</span>` : ''}
    </div>`;

  let body;
  if (e.kind === 'break' || e.kind === 'free') {
    const len = humanDuration(e.start, e.end);
    body = `<div class="pause">${esc(e.subject)}${len ? `<span class="pause__len">${len}</span>` : ''}</div>`;
  } else if (e.kind === 'outro') {
    body = `<div class="outro"><strong>${esc(e.subject)}</strong>${e.note ? `<span>${esc(e.note)}</span>` : ''}</div>`;
  } else if (e.kind === 'notice') {
    body = noticeCard(e.note ? `${e.subject} (${e.note})` : e.subject);
  } else {
    body = lessonCard(e, cls, live);
  }

  return `<div class="slot">${time}<div class="slot__body">${body}</div></div>`;
}

function hasProgrammeSplit(data, classId) {
  return data.days.some((day) => (day.byClass[classId] || [])
    .some((e) => e.tracks.some((t) => t.programme)));
}

// Оставляет подгруппы выбранной программы. Подгруппы без программы (труд,
// информатика, группы английского) остаются на месте при любом выборе.
function visibleTracks(e) {
  if (!e.tracks.length || state.programme === 'all') return e.tracks;
  const kept = e.tracks.filter((t) => !t.programme || t.programme === state.programme);
  return kept.length ? kept : e.tracks;
}

function lessonCard(e, cls, live) {
  const hue = e.color ? ` style="--hue:${esc(e.color)}"` : '';
  const tracks = visibleTracks(e);

  // Пометки относятся к уроку целиком, поэтому стоят в шапке карточки:
  // под подгруппами их можно принять за пометку последней подгруппы.
  const tags = [];
  if (live) tags.push(tag('now', 'сейчас'));
  if (e.double) tags.push(tag('long', 'сдвоенный урок'));
  if (tracks.length > 1) tags.push(tag('split', 'делится на 2 группы'));
  if (e.secondEnglish) tags.push(tag('english', SECOND_ENGLISH_LABEL));
  if (e.sharedWith.length) tags.push(tag('shared', sharedLabel(e.sharedWith, cls.id)));
  if (e.paid) tags.push(tag('extra', 'платное доп. занятие'));

  const classes = ['lesson'];
  if (live) classes.push('lesson--now');
  if (e.paid) classes.push('lesson--paid');
  if (e.double) classes.push('lesson--long');

  // Когда у половин класса одно и то же название предмета, повторять его
  // дважды незачем — достаточно перечислить преподавателей.
  const merged = tracks.length > 1 && tracks.every((t) => t.subject === tracks[0].subject)
    ? {
      subject: tracks[0].subject,
      teachers: tracks.map((t) => t.teacher).filter(Boolean),
      place: tracks.map((t) => t.place).filter(Boolean).join(' / '),
      secondEnglish: tracks.some((t) => t.secondEnglish),
    }
    : null;

  let body;
  if (merged) body = trackBody(merged);
  else if (tracks.length > 1) body = trackList(tracks);
  else body = trackBody(tracks[0] || e, tracks.length === 1);

  return `<div class="${classes.join(' ')}"${hue}>
    ${e.index ? `<span class="lesson__n">${e.index}</span>` : ''}
    ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
    ${body}
  </div>`;
}

// Один урок или одна подгруппа — разметка у них общая. Для целого урока
// пометка про вторую группу английского уже стоит в шапке карточки.
function trackBody(x, isTrack = true) {
  const teachers = x.teachers ? x.teachers.join(' · ') : x.teacher;
  const meta = [];
  if (teachers) meta.push(`<span class="lesson__teacher">${esc(teachers)}</span>`);
  if (x.place) meta.push(`<span class="room">${esc(placeLabel(x.place))}</span>`);
  if (x.note) meta.push(esc(x.note));
  if (isTrack && x.secondEnglish) meta.push(tag('english', SECOND_ENGLISH_LABEL));
  return `<div class="lesson__title">${subjectHtml(x.subject)}</div>
    ${meta.length ? `<div class="lesson__meta">${meta.join('')}</div>` : ''}`;
}

// Двойной урок: у каждой подгруппы свой предмет, преподаватель и кабинет.
// Порядок важен — первая строка идёт по российской программе (пункт 1 легенды).
function trackList(tracks) {
  return `<div class="tracks">${tracks
    .map((t) => `<div class="track">${trackBody(t)}</div>`)
    .join('')}</div>`;
}

const tag = (kind, text) => `<span class="tag tag--${kind}">${esc(text)}</span>`;

// Пункты 2 и 4 расшифровки: N — вторая группа английского с Натальей.
// Пометка встречается и рядом с другим предметом: вторая группа в это время
// уходит на английский, поэтому в подписи назван и предмет.
const SECOND_ENGLISH_LABEL = '2-я группа англ. — Наталья';

// Слэш между подгруппами делаем тише самих названий предметов.
function subjectHtml(subject) {
  return esc(subject).replace(/\s*\/\s*/g, '<span class="slash"> / </span>');
}

function placeLabel(place) {
  return /^\d/.test(place) ? `каб. ${place}` : place;
}

// Урок идёт сразу у нескольких классов: показываем их перечнем, сжимая
// подряд идущие в диапазон — "5–9 кл.".
function sharedLabel(ids, currentId) {
  const order = state.data.classes;
  const wanted = new Set([currentId, ...ids]);
  const runs = [];
  order.forEach((cls, i) => {
    if (!wanted.has(cls.id)) return;
    const last = runs[runs.length - 1];
    if (last && last.at === i - 1) { last.at = i; last.items.push(cls); } else {
      runs.push({ at: i, items: [cls] });
    }
  });

  const short = (cls) => cls.title.replace(/\s*(класс|кл\.)\s*$/i, '').trim();
  return runs.map(({ items }) => (items.length > 1
    ? `${short(items[0])}–${short(items[items.length - 1])}`
    : short(items[0]))).join(', ') + ' кл.';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ── Шторки ────────────────────────────────────────────────────────────── */
let sheetOpen = false;

function openSheet(title, html) {
  dom.sheetTitle.textContent = title;
  dom.sheetBody.innerHTML = html;
  dom.sheet.hidden = false;
  sheetOpen = true;
  tg?.BackButton?.show?.();
}

function closeSheet() {
  dom.sheet.hidden = true;
  sheetOpen = false;
  tg?.BackButton?.hide?.();
}

function openClassPicker() {
  const { classes } = state.data;
  const rank = (id) => {
    const n = parseInt(id, 10);
    return Number.isFinite(n) && n >= 5 ? 1 : 0;
  };
  const groups = [
    { label: 'Младшая школа', items: classes.filter((c) => rank(c.id) === 0) },
    { label: 'Старшая школа', items: classes.filter((c) => rank(c.id) === 1) },
  ].filter((g) => g.items.length);

  openSheet('Выберите класс', groups.map((g) => `
    ${groups.length > 1 ? `<div class="group-label">${esc(g.label)}</div>` : ''}
    <div class="class-grid">${g.items.map(classButton).join('')}</div>`).join(''));
}

function classButton(c) {
  const hue = homeroomColor(c.id);
  return `<button class="class-btn" type="button" data-class="${esc(c.id)}"
      aria-current="${c.id === state.classId}"${hue ? ` style="--hue:${esc(hue)}"` : ''}>
      <span class="class-btn__dot"></span><span>${esc(c.title)}</span></button>`;
}

// Цвет классного руководителя: берём его из клетки классного часа.
function homeroomColor(classId) {
  for (const day of state.data.days) {
    for (const e of day.byClass[classId] || []) {
      if (e.kind === 'lesson' && /\bкл[а-яё]*\.?\s*час/i.test(e.subject) && e.color) return e.color;
    }
  }
  return '';
}

function openProgrammePicker() {
  openSheet('Программа обучения', `
    <div class="options">${PROGRAMMES.map((p) => `
      <button class="option" type="button" data-prog="${esc(p.id)}"
              aria-current="${p.id === state.programme}">
        <div class="option__body">
          <div class="option__title">${esc(p.title)}</div>
          <div class="option__hint">${esc(p.hint)}</div>
        </div>
        <svg class="option__check" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>`).join('')}</div>`);
}

function openLegend() {
  const legend = state.data.legend || [];
  openSheet('Как читать расписание', `
    <div class="legend-block">
      <ol class="notes">${NOTES.map((n) => `<li>${esc(n)}</li>`).join('')}</ol>
    </div>
    ${legend.length ? `
      <div class="legend-block">
        <div class="group-label">Цвета преподавателей</div>
        <div class="teacher-list">${legend.map((t) => `
          <div class="teacher">
            <span class="swatches">${t.colors.map((c) => `<span class="swatch" style="background:${esc(c)}"></span>`).join('')}</span>
            <span>${esc(t.name)}</span>
          </div>`).join('')}</div>
      </div>` : ''}`);
}

/* ── События ───────────────────────────────────────────────────────────── */
const haptic = (style = 'light') => {
  try { tg?.HapticFeedback?.impactOccurred?.(style); } catch { /* нет поддержки */ }
};

/* ── Переключение дней ─────────────────────────────────────────────────── */
const dayIndex = () => (state.data
  ? state.data.days.findIndex((d) => d.id === state.dayId)
  : -1);

// День всегда открывается с начала: с первого урока, а не с той середины,
// где человек листал предыдущий.
function setDay(id) {
  state.dayId = id;
  render();
  window.scrollTo(0, 0);
}

function dayAt(step) {
  const i = dayIndex();
  return i < 0 ? null : state.data.days[i + step] || null;
}

dom.days.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-day]');
  if (!btn) return;
  haptic();
  setDay(btn.dataset.day);
});

/* ── Переход к соседнему дню вытягиванием за край ──────────────────────── */
// Долистали день до конца и продолжаете тянуть — открывается следующий.
// Порог небольшой, но заметный, чтобы обычная прокрутка не перелистывала.
const PULL_LIMIT = 96;
const PULL_LIMIT_WHEEL = 260;
const PULL_IDLE = 260;

let pull = 0;
let pullAt = 0;
let pullLock = 0;
let touchY = null;

const atTop = () => window.scrollY <= 0;
const atBottom = () => {
  const doc = document.documentElement;
  return window.scrollY + window.innerHeight >= doc.scrollHeight - 1;
};

function resetPull() {
  pull = 0;
  dom.pullHint.hidden = true;
}

function showPullHint(day, step, progress) {
  const arrow = step > 0
    ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v11m0 0l-4.5-4.5M10 15l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V5m0 0L5.5 9.5M10 5l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  dom.pullHint.innerHTML = arrow + esc(day.title);
  dom.pullHint.hidden = false;
  dom.pullHint.classList.toggle('pull-hint--top', step < 0);
  if (step < 0) dom.pullHint.style.top = `${dom.topbar.offsetHeight + 12}px`;
  else dom.pullHint.style.top = '';
  dom.pullHint.style.opacity = String(0.3 + progress * 0.7);
  dom.pullHint.style.transform =
    `translateX(-50%) translateY(${(1 - progress) * (step < 0 ? -10 : 10)}px)`;
}

function feedPull(dy, wheel) {
  if (!dy || !state.data || !state.classId || sheetOpen) return;

  const now = Date.now();
  if (now < pullLock) return;
  if (now - pullAt > PULL_IDLE) pull = 0;
  pullAt = now;

  const step = dy > 0 ? 1 : -1;
  const day = (step > 0 ? atBottom() : atTop()) ? dayAt(step) : null;
  if (!day) { resetPull(); return; }

  if (pull && Math.sign(pull) !== step) pull = 0;
  pull += dy;

  const limit = wheel ? PULL_LIMIT_WHEEL : PULL_LIMIT;
  const progress = Math.min(1, Math.abs(pull) / limit);
  showPullHint(day, step, progress);

  if (progress === 1) {
    pullLock = now + 500;
    resetPull();
    haptic('medium');
    setDay(day.id);
  }
}

document.addEventListener('touchstart', (ev) => {
  touchY = ev.touches.length === 1 ? ev.touches[0].clientY : null;
  resetPull();
}, { passive: true });

document.addEventListener('touchmove', (ev) => {
  if (touchY == null || ev.touches.length !== 1) return;
  const y = ev.touches[0].clientY;
  feedPull(touchY - y, false);
  touchY = y;
}, { passive: true });

document.addEventListener('touchend', () => { touchY = null; resetPull(); }, { passive: true });
document.addEventListener('touchcancel', () => { touchY = null; resetPull(); }, { passive: true });
window.addEventListener('wheel', (ev) => feedPull(ev.deltaY, true), { passive: true });

el('pickerTrigger').addEventListener('click', () => {
  if (!state.data) return;
  haptic();
  openClassPicker();
});

dom.progTrigger.addEventListener('click', () => {
  if (!state.data) return;
  haptic();
  openProgrammePicker();
});

el('infoBtn').addEventListener('click', () => {
  if (!state.data) return;
  haptic();
  openLegend();
});

el('refreshBtn').addEventListener('click', (ev) => {
  const btn = ev.currentTarget;
  btn.classList.remove('icon-btn--spin');
  void btn.offsetWidth;
  btn.classList.add('icon-btn--spin');
  haptic();
  load({ force: true });
});

dom.sheet.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-close]')) { closeSheet(); return; }
  const cls = ev.target.closest('[data-class]');
  if (cls) {
    state.classId = cls.dataset.class;
    store.set(STORE_KEY, state.classId);
    haptic('medium');
    closeSheet();
    render();
    return;
  }

  const prog = ev.target.closest('[data-prog]');
  if (!prog) return;
  state.programme = prog.dataset.prog;
  store.set(PROG_KEY, state.programme);
  haptic('medium');
  closeSheet();
  render();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && sheetOpen) closeSheet();
});

const onScroll = () => dom.topbar.classList.toggle('topbar--stuck', window.scrollY > 4);
document.addEventListener('scroll', onScroll, { passive: true });

// Подсветка текущего урока должна успевать за временем, но перерисовывать
// ленту каждую минуту без причины незачем.
let liveKey = '';
setInterval(() => {
  if (!state.data || sheetOpen) return;
  const key = currentLiveKey();
  if (key === liveKey) return;
  liveKey = key;
  render();
}, 30_000);

function currentLiveKey() {
  if (!state.data) return 'off';
  const now = schoolNow();
  if (state.dayId !== now.dayId) return 'off';
  const entries = state.data.days.find((d) => d.id === state.dayId)?.byClass[state.classId] || [];
  const live = entries.find((e) => {
    const from = toMinutes(e.start);
    const to = toMinutes(e.end);
    return from != null && to != null && now.minutes >= from && now.minutes < to;
  });
  return live ? `${live.start}-${live.subject}` : 'none';
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load();
});

/* ── Старт ─────────────────────────────────────────────────────────────── */
if (tg) {
  tg.ready();
  tg.expand?.();
  tg.setHeaderColor?.('secondary_bg_color');
  tg.disableVerticalSwipes?.();
  tg.BackButton?.onClick?.(() => { if (sheetOpen) closeSheet(); else tg.close(); });
}

// Ссылка вида ?class=5&prog=ru (или start_param у бота) открывает нужный
// класс и программу, не затирая сохранённый выбор.
const params = new URLSearchParams(location.search);
const requested = params.get('class') || tg?.initDataUnsafe?.start_param || '';
const requestedProg = params.get('prog') || '';

const loading = load();
const [savedClass, savedProg] = await Promise.all([
  store.get(STORE_KEY),
  store.get(PROG_KEY),
]);
state.classId = requested || savedClass;
const prog = requestedProg || savedProg;
if (PROGRAMMES.some((p) => p.id === prog)) state.programme = prog;
booted = true;
render();
await loading;
render();
