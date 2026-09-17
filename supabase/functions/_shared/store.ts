// Настройки лежат в Postgres. Ходим через PostgREST сервисным ключом: он
// обходит RLS, а политик у таблицы намеренно нет.
const URL_BASE = Deno.env.get('SUPABASE_URL') ?? '';
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TABLE = `${URL_BASE}/rest/v1/alice_settings`;

export interface Settings {
  class_id: string | null;
  programme: string;
  extras: boolean;
  // На каком вопросе остановилась настройка; null — она завершена.
  setup_step: string | null;
}

const headers = {
  apikey: KEY,
  authorization: `Bearer ${KEY}`,
  'content-type': 'application/json',
};

export async function readSettings(userId: string): Promise<Settings | null> {
  if (!URL_BASE || !KEY) throw new Error('не заданы SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');

  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    select: 'class_id,programme,extras,setup_step',
    limit: '1',
  });
  const res = await fetch(`${TABLE}?${query}`, { headers });
  if (!res.ok) throw new Error(`чтение настроек: HTTP ${res.status}`);
  const rows = await res.json() as Settings[];
  return rows[0] ?? null;
}

// Обновляем точечно, а не через upsert: PostgREST при конфликте заменяет
// строку целиком и подставляет умолчания в непереданные столбцы — так
// сохранение одного поля стирало класс и программу.
export async function writeSettings(userId: string, patch: Partial<Settings>): Promise<void> {
  const updated = await fetch(`${TABLE}?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...headers, prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!updated.ok) {
    throw new Error(`обновление настроек: HTTP ${updated.status} ${await updated.text()}`);
  }
  if ((await updated.json() as unknown[]).length) return;

  const created = await fetch(TABLE, {
    method: 'POST',
    headers: { ...headers, prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, ...patch }),
  });
  if (!created.ok) {
    throw new Error(`создание настроек: HTTP ${created.status} ${await created.text()}`);
  }
}
