// Навык Алисы «Расписание школы Компас».
//
// Отвечает, какие уроки завтра (или в названный день) у класса, выбранного
// этим пользователем. Настройки — класс, программа и нужно ли упоминать
// дополнительные занятия — спрашиваются один раз и лежат в Postgres.
import { loadSchedule, planFor, schoolDay } from '../_shared/schedule.ts';
import { readSettings, Settings, writeSettings } from '../_shared/store.ts';
import {
  listOut, mergeRepeats, parseClass, parseDay, parseProgramme, parseYesNo,
  plural, PROGRAMME_NAMES, speakTime,
} from '../_shared/speech.ts';

const WEEKDAY_NAMES: Record<string, string> = {
  mon: 'в понедельник', tue: 'во вторник', wed: 'в среду',
  thu: 'в четверг', fri: 'в пятницу', sat: 'в субботу', sun: 'в воскресенье',
};

const HELP = 'Я подсказываю расписание школы Компас. Спросите «какие завтра уроки» '
  + 'или назовите день — «что в среду». Чтобы сменить класс или программу, '
  + 'скажите «настройки».';

interface Reply {
  text: string;
  buttons?: string[];
  session?: Record<string, unknown>;
  end?: boolean;
}

Deno.serve({ port: Number(Deno.env.get('PORT') ?? 8000) }, async (req) => {
  if (req.method !== 'POST') return new Response('ok');

  let update: Record<string, any>;
  try {
    update = await req.json();
  } catch {
    return Response.json(answer({ text: 'Не разобрала запрос.' }));
  }

  try {
    return Response.json(answer(await handle(update)));
  } catch (err) {
    console.error(err);
    return Response.json(answer({
      text: 'Не получилось заглянуть в расписание. Попробуйте ещё раз чуть позже.',
    }));
  }
});

function answer(reply: Reply) {
  return {
    version: '1.0',
    session_state: reply.session ?? {},
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

async function handle(update: Record<string, any>): Promise<Reply> {
  const session = update.session ?? {};
  const userId: string = session.user?.user_id ?? session.application?.application_id ?? '';
  if (!userId) return { text: 'Не удалось вас узнать, попробуйте ещё раз.' };

  const said: string = update.request?.command
    ?? update.request?.payload?.command
    ?? update.request?.original_utterance
    ?? '';
  const settings = await readSettings(userId);
  // Шаг настройки держим в базе, а не в состоянии сессии: Алиса возвращает
  // state только при включённой опции «Использовать хранилище данных»,
  // и без неё диалог зацикливался на первом вопросе.
  const step = settings?.setup_step ?? '';

  // Из настройки должен быть выход: справка и отмена работают и в ней.
  if (step && isHelp(said)) {
    return { text: HELP, buttons: ['Продолжить настройку'] };
  }
  if (step && /отмена|отмени|хватит|стоп|не надо ничего/.test(said)) {
    if (settings?.class_id) {
      await writeSettings(userId, { setup_step: null });
      return { text: 'Хорошо, оставила как было.', buttons: ['Какие завтра уроки'] };
    }
    return { text: 'Хорошо. Скажите «настройки», когда будете готовы.' };
  }
  if (step) return continueSetup(userId, step, said, settings);

  if (/настройк|смен|помен|заново|сначала|сброс/.test(said)) {
    return startSetup(userId, 'Давайте настроим заново.');
  }
  if (isHelp(said)) {
    return { text: HELP, buttons: ['Какие завтра уроки', 'Настройки'] };
  }
  if (!settings?.class_id) return startSetup(userId, 'Здравствуйте!');

  const wanted = parseDay(said);
  if (wanted) return tell(settings, wanted);

  // Просто «расписание» или «уроки», без дня: показываем завтрашний —
  // ради него навык и нужен. Такие фразы стоят в примерах для каталога.
  if (/расписани|уроки|занятия/.test(said)) return tell(settings, { offset: 1 });

  // Навык вызвали без вопроса — самое полезное по умолчанию это завтра.
  if (session.new || !said) return tell(settings, { offset: 1 });

  return {
    text: 'Не поняла. Спросите «какие завтра уроки» или назовите день недели.',
    buttons: ['Какие завтра уроки', 'Что в среду', 'Настройки'],
  };
}

/* ── Настройка ─────────────────────────────────────────────────────────── */

async function startSetup(userId: string, prefix: string): Promise<Reply> {
  const { classes } = await loadSchedule();
  await writeSettings(userId, { setup_step: 'class' });
  return {
    text: `${prefix} Для какого класса смотреть расписание? `
      + 'Скажите номер — например, пятый или второй А.',
    buttons: classes.map((c) => c.title),
  };
}

async function continueSetup(
  userId: string,
  step: string,
  said: string,
  settings: Settings | null,
): Promise<Reply> {
  const data = await loadSchedule();

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
    await writeSettings(userId, { class_id: found.id, setup_step: 'programme' });
    return {
      text: 'Записала. По какой программе — российской, местной или обеим сразу?',
      buttons: ['Российская', 'Местная', 'Обе'],
    };
  }

  if (step === 'programme') {
    // Класс сохраняется на предыдущем шаге; если записи нет, разговор
    // потерял нить — начинаем сначала, а не пишем пустой класс.
    if (!settings) return startSetup(userId, '');
    const programme = parseProgramme(said);
    if (!programme) {
      return {
        text: 'Скажите «российская», «местная» или «обе».',
        buttons: ['Российская', 'Местная', 'Обе'],
      };
    }
    await writeSettings(userId, { programme, setup_step: 'extras' });
    return {
      text: 'Хорошо. Рассказывать про дополнительные занятия после уроков?',
      buttons: ['Да', 'Нет'],
    };
  }

  if (step === 'extras') {
    if (!settings) return startSetup(userId, '');
    const extras = parseYesNo(said);
    if (extras === null) {
      return { text: 'Скажите «да» или «нет».', buttons: ['Да', 'Нет'] };
    }
    await writeSettings(userId, { extras, setup_step: null });

    const saved = await readSettings(userId);
    if (!saved?.class_id) return { text: 'Настройки не сохранились, попробуйте ещё раз.' };

    const title = data.classes.find((c) => c.id === saved.class_id)?.title ?? saved.class_id;
    const head = `Готово: ${title}, ${PROGRAMME_NAMES[saved.programme]}, `
      + `${saved.extras ? 'с дополнительными занятиями' : 'без дополнительных занятий'}.`;
    const plan = await tell(saved, { offset: 1 });
    return { text: `${head} ${plan.text}`, buttons: plan.buttons };
  }

  return startSetup(userId, '');
}

/* ── Ответ про день ────────────────────────────────────────────────────── */

async function tell(
  settings: Settings,
  wanted: { offset?: number; weekday?: string },
): Promise<Reply> {
  const data = await loadSchedule();
  const buttons = ['Какие завтра уроки', 'Настройки'];
  const classId = settings.class_id;
  if (!classId) {
    return { text: 'Сначала нужно выбрать класс. Скажите «настройки».', buttons: ['Настройки'] };
  }

  const weekday = wanted.weekday ?? schoolDay(wanted.offset ?? 0).weekday;
  const when = wanted.weekday
    ? WEEKDAY_NAMES[weekday]
    : ['сегодня', 'завтра', 'послезавтра'][wanted.offset ?? 0] ?? WEEKDAY_NAMES[weekday];

  const plan = planFor(data, classId, weekday, settings.programme);
  if (!plan.found || !plan.lessons.length) {
    const next = nextSchoolDay(data, weekday);
    const tail = next && next !== weekday
      ? ` Ближайшие уроки — ${WEEKDAY_NAMES[next]}.`
      : '';
    return { text: `${capitalize(when)} уроков нет.${tail}`, buttons };
  }

  const names = plan.lessons.map((l) => l.name);
  const count = `${names.length} ${plural(names.length)}`;
  const spoken = mergeRepeats(names);
  const span = plan.from && plan.till
    ? ` С ${speakTime(plan.from)} до ${speakTime(plan.till)}.`
    : '';
  let text = `${capitalize(when)} ${count}: ${listOut(spoken)}.${span}`;

  if (settings.extras && plan.extras.length) {
    text += ` После уроков: ${listOut(mergeRepeats(plan.extras.map((e) => e.name)))}.`;
  }
  return { text, buttons };
}

function nextSchoolDay(data: { days: { id: string }[] }, from: string): string | null {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const start = order.indexOf(from);
  for (let i = 1; i <= 7; i += 1) {
    const id = order[(start + i) % 7];
    if (data.days.some((d) => d.id === id)) return id;
  }
  return null;
}

const isHelp = (said: string) => /что ты умеешь|что умеешь|помощь|помоги|справка/.test(said);

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
