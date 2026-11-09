-- Открытия миниаппа: одна строка на каждое открытие страницы. Пишет сама
-- страница через Data API публичным ключом, поэтому анонимной роли можно
-- только добавлять строки — читать их снаружи нельзя.
create table if not exists public.visits (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  platform   text        not null,
  visitor    text        not null,
  class_id   text,
  programme  text,
  compact    boolean,
  season     text,
  constraint visits_platform_check
    check (platform in ('telegram', 'web', 'android')),
  constraint visits_visitor_check
    check (char_length(visitor) between 8 and 40),
  constraint visits_class_check
    check (char_length(class_id) <= 16),
  constraint visits_programme_check
    check (programme in ('all', 'ru', 'ua')),
  constraint visits_season_check
    check (char_length(season) <= 16)
);

create index if not exists visits_at_idx on public.visits (at);

comment on table public.visits is
  'Открытия миниаппа «Расписание школы Компас»';
comment on column public.visits.platform is
  'telegram — миниапп в Telegram, web — сайт в браузере, android — приложение';
comment on column public.visits.visitor is
  'Случайный id, который страница один раз создаёт и хранит в localStorage';
comment on column public.visits.class_id is
  'Выбранный класс; null — класс ещё не выбран';

alter table public.visits enable row level security;

drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits
  for insert to anon
  with check (true);

grant insert on public.visits to anon;

-- Сводка по дням для просмотра в дашборде Supabase.
create or replace view public.visits_daily
with (security_invoker = true) as
select
  (at at time zone 'Europe/Podgorica')::date as day,
  platform,
  count(*)                as opens,
  count(distinct visitor) as visitors
from public.visits
group by 1, 2;

revoke all on public.visits_daily from anon, authenticated;
