// Навык Алисы «Расписание школы Компас».
//
// Отвечает, какие уроки завтра (или в названный день) у класса, выбранного
// этим пользователем. Настройки — класс, программа и нужно ли упоминать
// дополнительные занятия — спрашиваются один раз и хранятся в самой Алисе
// (см. lib/alice/store.mjs).
import { loadSchedule, planFor, schoolDay } from '../../lib/alice/schedule.mjs';
import { openStore } from '../../lib/alice/store.mjs';
import {
  listOut, mergeRepeats, parseClass, parseDay, parseProgramme, parseYesNo,
  plural, PROGRAMME_NAMES, speakTime,
} from '../../lib/alice/speech.mjs';

export const config = { path: '/api/alice' };

const WEEKDAY_NAMES = {
  mon: 'в понедельник', tue: 'во вторник', wed: 'в среду',
  thu: 'в четверг', fri: 'в пятницу', sat: 'в субботу', sun: 'в воскресенье',
};

const HELP = 'Я подсказываю расписание школы Компас. Спросите «какие завтра уроки» '
  + 'или назовите день — «что в среду». Чтобы сменить класс или программу, '
  + 'скажите «настройки».';

let stateLogged = false;

export default async (req) => {
  if (req.method !== 'POST') return new Response('ok');

  let update;
  try {
    update = await req.json();
  } catch {
    return Response.json(answer({ text: 'Не разобрала запрос.' }));
  }

  // Какие разделы состояния прислала Алиса — один раз на запуск функции,
  // чтобы по логу было видно, включено ли хранилище.
  if (!stateLogged) {
    stateLogged = true;
    console.log('alice state:', Object.keys(update?.state ?? {}).join(',') || 'нет');
  }

  const ctx = {
    store: openStore(update),
    // Расписание берём с того же сайта, где работает навык.
    scheduleUrl: process.env.SCHEDULE_URL || new URL('/api/schedule', req.url).href,
  };

  try {
    return Response.json(answer(await handle(update, ctx), ctx.store));
  } catch (err) {
    console.error(err);
    return Response.json(answer({
      text: 'Не получилось заглянуть в расписание. Попробуйте ещё раз чуть позже.',
    }, ctx.store));
  }
};

// Изменённые настройки уходят вместе с ответом: так ни одна ветка разговора
// не может забыть их сохранить.
function answer(reply, store) {
  return {
    version: '1.0',
    session_state: reply.session ?? {},
    ...(store ? store.response() : {}),
    response: {
      text: reply.text,
      tts: reply.text,
      end_session: Boolean(reply.end),
      ...(reply.buttons?.length
        ? { buttons: reply.buttons.map((title) => ({ title, hide: true })) }
        : {}),
    },
  };
}

async function handle(update, ctx) {
  const session = update.session ?? {};
  if (!ctx.store.available) {
    return {
      text: 'Мне негде запомнить ваш класс: в настройках навыка нужно включить '
        + '«Использовать хранилище данных».',
    };
  }

  const said = update.request?.command
    ?? update.request?.payload?.command
    ?? update.request?.original_utterance
    ?? '';
  const settings = ctx.store.read();
  const step = settings?.setup_step ?? '';

  // Из настройки должен быть выход: справка и отмена работают и в ней.
  if (step && isHelp(said)) {
    return { text: HELP, buttons: ['Продолжить настройку'] };
  }
  if (step && /отмена|отмени|хватит|стоп|не надо ничего/.test(said)) {
    if (settings?.class_id) {
      ctx.store.write({ setup_step: null });
      return { text: 'Хорошо, оставила как было.', buttons: ['Какие завтра уроки'] };
    }
    return { text: 'Хорошо. Скажите «настройки», когда будете готовы.' };
  }
  if (step) return continueSetup(ctx, step, said, settings);

  if (/настройк|смен|помен|заново|сначала|сброс/.test(said)) {
    return startSetup(ctx, 'Давайте настроим заново.');
  }
  if (isHelp(said)) {
    return { text: HELP, buttons: ['Какие завтра уроки', 'Настройки'] };
  }
  if (!settings?.class_id) return startSetup(ctx, 'Здравствуйте!');

  const wanted = parseDay(said);
  const asksSchedule = wanted || /расписани|уроки|занятия/.test(said);
  if (asksSchedule) {
    // В вопросе может быть назван чужой класс — отвечаем про него, но
    // сохранённый выбор не трогаем.
    const other = await namedClass(ctx, said, settings.class_id);
    if (other && 'ambiguous' in other) {
      return { text: `Уточните, пожалуйста: ${listOut(other.ambiguous)}?`, buttons: other.ambiguous };
    }
    const use = other ? { ...settings, class_id: other.id } : settings;
    // Просто «расписание» без дня — это про завтра, ради него навык и нужен.
    return tell(ctx, use, wanted ?? { offset: 1 }, Boolean(other));
  }

  // Навык вызвали без вопроса — самое полезное по умолчанию это завтра.
  if (session.new || !said) return tell(ctx, settings, { offset: 1 });

  return {
    text: 'Не поняла. Спросите «какие завтра уроки» или назовите день недели.',
    buttons: ['Какие завтра уроки', 'Что в среду', 'Настройки'],
  };
}

/* ── Настройка ─────────────────────────────────────────────────────────── */

async function startSetup(ctx, prefix) {
  const { classes } = await loadSchedule(ctx.scheduleUrl);
  ctx.store.write({ setup_step: 'class' });
  return {
    text: `${prefix} Для какого класса смотреть расписание? `
      + 'Скажите номер — например, пятый или второй А.',
    buttons: classes.map((c) => c.title),
  };
}

async function continueSetup(ctx, step, said, settings) {
  const data = await loadSchedule(ctx.scheduleUrl);

  if (step === 'class') {
    const found = parseClass(said, data.classes);
    if (!found) {
      return {
        text: 'Не расслышала класс. Скажите, например, «пятый» или «второй А».',
        buttons: data.classes.map((c) => c.title),
      };
    }
    if ('ambiguous' in found) {
      return {
        text: `Уточните, пожалуйста: ${listOut(found.ambiguous)}?`,
        buttons: found.ambiguous,
      };
    }
    ctx.store.write({ class_id: found.id, setup_step: 'programme' });
    return {
      text: 'Записала. По какой программе — российской, другой или обеим сразу?',
      buttons: ['Российская', 'Другая', 'Обе'],
    };
  }

  if (step === 'programme') {
    // Класс сохраняется на предыдущем шаге; если записи нет, разговор
    // потерял нить — начинаем сначала, а не пишем пустой класс.
    if (!settings) return startSetup(ctx, '');
    const programme = parseProgramme(said);
    if (!programme) {
      return {
        text: 'Скажите «российская», «другая» или «обе».',
        buttons: ['Российская', 'Другая', 'Обе'],
      };
    }
    ctx.store.write({ programme, setup_step: 'extras' });
    return {
      text: 'Хорошо. Рассказывать про дополнительные занятия после уроков?',
      buttons: ['Да', 'Нет'],
    };
  }

  if (step === 'extras') {
    if (!settings) return startSetup(ctx, '');
    const extras = parseYesNo(said);
    if (extras === null) {
      return { text: 'Скажите «да» или «нет».', buttons: ['Да', 'Нет'] };
    }
    ctx.store.write({ extras, setup_step: null });

    const saved = ctx.store.read();
    if (!saved?.class_id) return { text: 'Настройки не сохранились, попробуйте ещё раз.' };

    const title = data.classes.find((c) => c.id === saved.class_id)?.title ?? saved.class_id;
    const head = `Готово: ${title}, ${PROGRAMME_NAMES[saved.programme]}, `
      + `${saved.extras ? 'с дополнительными занятиями' : 'без дополнительных занятий'}.`;
    const plan = await tell(ctx, saved, { offset: 1 });
    return { text: `${head} ${plan.text}`, buttons: plan.buttons };
  }

  return startSetup(ctx, '');
}

// Класс засчитываем только при слове «класс»: иначе «первый урок» сойдёт
// за первый класс. Если назван тот же класс, что сохранён, ничего не меняем.
async function namedClass(ctx, said, current) {
  if (!/класс|\bкл\b/i.test(said)) return null;
  const { classes } = await loadSchedule(ctx.scheduleUrl);
  const found = parseClass(said, classes);
  if (!found) return null;
  if ('ambiguous' in found) return found;
  return found.id === current ? null : found;
}

/* ── Ответ про день ────────────────────────────────────────────────────── */

async function tell(ctx, settings, wanted, named = false) {
  const data = await loadSchedule(ctx.scheduleUrl);
  const buttons = ['Какие завтра уроки', 'Настройки'];
  const classId = settings.class_id;
  if (!classId) {
    return { text: 'Сначала нужно выбрать класс. Скажите «настройки».', buttons: ['Настройки'] };
  }

  const weekday = wanted.weekday ?? schoolDay(wanted.offset ?? 0).weekday;
  const when = wanted.weekday
    ? WEEKDAY_NAMES[weekday]
    : ['сегодня', 'завтра', 'послезавтра'][wanted.offset ?? 0] ?? WEEKDAY_NAMES[weekday];

  // Если класс назвали в вопросе, начинаем с него: отдельным предложением,
  // чтобы не склонять название.
  const prefix = named
    ? `${(data.classes.find((c) => c.id === classId)?.title ?? classId).replace(/\.$/, '')}. `
    : '';
  const plan = planFor(data, classId, weekday, settings.programme);
  if (!plan.found || !plan.lessons.length) {
    const next = nextSchoolDay(data, weekday);
    const tail = next && next !== weekday
      ? ` Ближайшие уроки — ${WEEKDAY_NAMES[next]}.`
      : '';
    return { text: `${prefix}${capitalize(when)} уроков нет.${tail}`, buttons };
  }

  const names = plan.lessons.map((l) => l.name);
  const count = `${names.length} ${plural(names.length)}`;
  const spoken = mergeRepeats(names);
  const span = plan.from && plan.till
    ? ` С ${speakTime(plan.from)} до ${speakTime(plan.till)}.`
    : '';
  let text = `${prefix}${capitalize(when)} ${count}: ${listOut(spoken)}.${span}`;

  if (settings.extras && plan.extras.length) {
    text += ` После уроков: ${listOut(mergeRepeats(plan.extras.map((e) => e.name)))}.`;
  }
  return { text, buttons };
}

function nextSchoolDay(data, from) {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const start = order.indexOf(from);
  for (let i = 1; i <= 7; i += 1) {
    const id = order[(start + i) % 7];
    if (data.days.some((d) => d.id === id)) return id;
  }
  return null;
}

const isHelp = (said) => /что ты умеешь|что умеешь|помощь|помоги|справка/.test(said);

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
