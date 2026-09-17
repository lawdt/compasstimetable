// Настройки лежат в Postgres. Ходим через PostgREST сервисным ключом: он
// обходит RLS, а политик у таблицы намеренно нет.
const URL_BASE = Deno.env.get('SUPABASE_URL') ?? '';
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TABLE = `${URL_BASE}/rest/v1/alice_settings`;

export interface Settings {
  class_id: string;
  programme: string;
  extras: boolean;
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
    select: 'class_id,programme,extras',
    limit: '1',
  });
  const res = await fetch(`${TABLE}?${query}`, { headers });
  if (!res.ok) throw new Error(`чтение настроек: HTTP ${res.status}`);
  const rows = await res.json() as Settings[];
  return rows[0] ?? null;
}

export async function writeSettings(userId: string, patch: Partial<Settings>): Promise<void> {
  const res = await fetch(`${TABLE}?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...headers, prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, ...patch }),
  });
  if (!res.ok) throw new Error(`запись настроек: HTTP ${res.status} ${await res.text()}`);
}

export async function dropSettings(userId: string): Promise<void> {
  const res = await fetch(`${TABLE}?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { ...headers, prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`сброс настроек: HTTP ${res.status}`);
}
