// Локальный прогон навыка: вызывает функцию напрямую и проигрывает диалог.
// Хранилище Алисы изображаем сами: что навык вернул в user_state_update,
// уходит в state.user следующего запроса — так же, как делает Алиса.
//
// Запуск: node scripts/alice-local.mjs [сценарий]
// Расписание берётся с боевого сайта, адрес можно сменить через SCHEDULE_URL.
process.env.SCHEDULE_URL ||= 'https://compass-bar-schedule.netlify.app/api/schedule';

const { default: alice } = await import('../netlify/functions/alice.mjs');

let sessionState = {};
let userState = {};
let first = true;
const USER = process.env.ALICE_USER || 'test-user';

async function say(command) {
  const req = new Request('http://localhost/api/alice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      meta: { locale: 'ru-RU', timezone: 'Europe/Moscow' },
      session: {
        new: first, message_id: 0, session_id: 's1', skill_id: 'x',
        user: { user_id: USER }, application: { application_id: 'app' },
      },
      request: { command, original_utterance: command, type: 'SimpleUtterance', nlu: { tokens: command.split(' ') } },
      state: { session: sessionState, user: userState, application: {} },
      version: '1.0',
    }),
  });
  const body = await (await alice(req)).json();
  sessionState = body.session_state || {};
  // null в user_state_update удаляет ключ.
  for (const [key, value] of Object.entries(body.user_state_update || {})) {
    if (value === null) delete userState[key];
    else userState[key] = value;
  }
  first = false;
  console.log(`\n  › ${command || '(вызов навыка)'}`);
  console.log(`  ‹ ${body.response.text}`);
  if (body.response.buttons?.length) {
    console.log(`    [${body.response.buttons.map((b) => b.title).join('] [')}]`);
  }
  return body;
}

const SCRIPTS = {
  setup: ['', 'пятый', 'российская', 'да', 'какие завтра уроки', 'что в среду', 'настройки', 'второй'],
  ask: ['какие завтра уроки', 'а в пятницу', 'что в субботу', 'что сегодня',
    'что ты умеешь', 'бла бла бла'],
  other: ['какие завтра уроки у второго б класса', 'что в среду у 9 класса',
    'какие уроки во втором классе', 'во вторник у третьего класса',
    'первый урок завтра', 'какие завтра уроки'],
  escape: ['', 'что ты умеешь', 'отмена'],
  second: ['', 'второй', 'второй а', 'обе', 'нет', 'какие завтра уроки'],
};

const name = process.argv[2] || 'setup';

// Сценарии про вопросы начинаются с уже настроенного пользователя.
if (name === 'ask' || name === 'other') {
  userState.settings = { class_id: '5', programme: 'ru', extras: true, setup_step: null };
}

for (const line of SCRIPTS[name] || SCRIPTS.setup) await say(line);

console.log('\n── что сохранилось ──');
console.log(' ', USER, JSON.stringify(userState.settings ?? null));
