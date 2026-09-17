-- Настройки навыка Алисы: у каждого пользователя свой класс, программа и
-- признак, рассказывать ли о дополнительных занятиях.
create table if not exists public.alice_settings (
  user_id     text primary key,
  class_id    text        not null,
  programme   text        not null default 'all',
  extras      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint alice_settings_programme_check
    check (programme in ('all', 'ru', 'ua'))
);

comment on table public.alice_settings is
  'Настройки пользователей навыка Алисы «Расписание школы Компас»';
comment on column public.alice_settings.user_id is
  'session.user.user_id из запроса Алисы, иначе application_id устройства';
comment on column public.alice_settings.programme is
  'all — обе программы, ru — российская, ua — местная';

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists alice_settings_touch on public.alice_settings;
create trigger alice_settings_touch
  before update on public.alice_settings
  for each row execute function public.touch_updated_at();

-- Навык ходит с сервисным ключом, он обходит RLS. Политик нет намеренно:
-- анонимный и авторизованный ключи не должны видеть чужие настройки.
alter table public.alice_settings enable row level security;
