-- Сводка открытий за неделю для еженедельного отчёта в Telegram. Считает
-- база: строк за неделю может быть больше, чем Data API отдаёт за раз.
-- Неделя — семь дней с week_start по часовому поясу школы; для сравнения
-- рядом лежат цифры предыдущей недели.
create or replace function public.visits_report(week_start date)
returns json
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      (week_start::timestamp at time zone 'Europe/Podgorica')       as since,
      ((week_start + 7)::timestamp at time zone 'Europe/Podgorica') as until,
      ((week_start - 7)::timestamp at time zone 'Europe/Podgorica') as prev_since
  ),
  week as (
    select v.* from visits v, bounds b where v.at >= b.since and v.at < b.until
  ),
  prev as (
    select v.* from visits v, bounds b where v.at >= b.prev_since and v.at < b.since
  ),
  -- Новое устройство — то, которое до этой недели не встречалось ни разу.
  fresh as (
    select distinct w.visitor
    from week w, bounds b
    where not exists (
      select 1 from visits o where o.visitor = w.visitor and o.at < b.since
    )
  ),
  -- Класс и тему устройства берём по последнему открытию за неделю: если
  -- класс меняли, считается тот, на котором остановились.
  latest as (
    select distinct on (visitor) visitor, class_id, season
    from week
    order by visitor, at desc
  )
  select json_build_object(
    'opens',          (select count(*) from week),
    'visitors',       (select count(distinct visitor) from week),
    'new_visitors',   (select count(*) from fresh),
    'prev_opens',     (select count(*) from prev),
    'prev_visitors',  (select count(distinct visitor) from prev),
    'platforms', coalesce((
      select json_agg(p order by p.visitors desc) from (
        select platform, count(*) as opens, count(distinct visitor) as visitors
        from week group by platform
      ) p), '[]'::json),
    'days', coalesce((
      select json_agg(d order by d.day) from (
        select (at at time zone 'Europe/Podgorica')::date as day,
               count(*) as opens, count(distinct visitor) as visitors
        from week group by 1
      ) d), '[]'::json),
    'classes', coalesce((
      select json_agg(c order by c.visitors desc, c.class_id) from (
        select class_id, count(*) as visitors
        from latest where class_id is not null group by class_id
      ) c), '[]'::json),
    'seasons', coalesce((
      select json_agg(s order by s.visitors desc) from (
        select season, count(*) as visitors
        from latest where season is not null group by season
      ) s), '[]'::json)
  );
$$;

comment on function public.visits_report(date) is
  'Сводка открытий за неделю с week_start (Europe/Podgorica) для отчёта в Telegram';

revoke all on function public.visits_report(date) from public, anon, authenticated;
grant execute on function public.visits_report(date) to service_role;
