// Локальный прогон навыка: поднимает заглушку PostgREST, запускает функцию
// на Deno и проигрывает диалог. Нужен, чтобы проверять реплики без
// развёртывания и без Docker.
//
// Запуск: node scripts/alice-local.mjs [сценарий]
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const DB_PORT = 54331;
const FN_PORT = 54330 + Math.floor(Math.random() * 400);
const rows = new Map();

const db = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${DB_PORT}`);
  const id = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');

  if (req.method === 'GET') {
    const row = rows.get(id);
    return json(res, row ? [row] : []);
  }
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const patch = JSON.parse(body);
    rows.set(patch.user_id, { ...(rows.get(patch.user_id) || { programme: 'all', extras: true }), ...patch });
    return json(res, [], 201);
  }
  if (req.method === 'DELETE') { rows.delete(id); return json(res, [], 204); }
  json(res, {}, 405);
});

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

await new Promise((r) => db.listen(DB_PORT, r));

const fn = spawn('deno', ['run', '--allow-net', '--allow-env',
  'supabase/functions/alice/index.ts'], {
  env: {
    ...process.env,
    PORT: String(FN_PORT),
    SUPABASE_URL: `http://localhost:${DB_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: 'local',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
fn.stderr.on('data', (d) => {
  const line = String(d);
  if (!/Listening|Watcher|^\s*$/.test(line)) process.stderr.write('  [deno] ' + line);
});

// Ждём, пока функция поднимется.
for (let i = 0; i < 40; i += 1) {
  try {
    await fetch(`http://127.0.0.1:${FN_PORT}/`, { method: 'GET' });
    break;
  } catch { await new Promise((r) => setTimeout(r, 150)); }
}

let sessionState = {};
let first = true;
const USER = process.env.ALICE_USER || 'test-user';

async function say(command) {
  const res = await fetch(`http://127.0.0.1:${FN_PORT}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      meta: { locale: 'ru-RU', timezone: 'Europe/Moscow' },
      session: {
        new: first, message_id: 0, session_id: 's1', skill_id: 'x',
        user: { user_id: USER }, application: { application_id: 'app' },
      },
      request: { command, original_utterance: command, type: 'SimpleUtterance', nlu: { tokens: command.split(' ') } },
      state: { session: sessionState },
      version: '1.0',
    }),
  });
  const body = await res.json();
  sessionState = body.session_state || {};
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
  escape: ['', 'что ты умеешь', 'отмена'],
  second: ['', 'второй', 'второй а', 'обе', 'нет', 'какие завтра уроки'],
};

const name = process.argv[2] || 'setup';

// Сценарии про вопросы начинаются с уже настроенного пользователя.
if (name === 'ask') {
  rows.set(USER, { user_id: USER, class_id: '5', programme: 'ru', extras: true });
}

for (const line of SCRIPTS[name] || SCRIPTS.setup) await say(line);

console.log('\n── что сохранилось ──');
for (const [k, v] of rows) console.log(' ', k, JSON.stringify(v));

fn.kill();
db.close();
