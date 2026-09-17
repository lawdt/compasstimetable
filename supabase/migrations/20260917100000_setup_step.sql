-- Шаг настройки храним рядом с настройками, а не в состоянии сессии Алисы:
-- она возвращает state только при включённой опции «Использовать хранилище
-- данных в навыке», и без неё диалог зацикливался на первом вопросе.
alter table public.alice_settings
  add column if not exists setup_step text;

-- Пока настройка не закончена, класса ещё нет.
alter table public.alice_settings
  alter column class_id drop not null;

alter table public.alice_settings
  drop constraint if exists alice_settings_ready_check;
alter table public.alice_settings
  add constraint alice_settings_ready_check
  check (setup_step is not null or class_id is not null);

comment on column public.alice_settings.setup_step is
  'class | programme | extras — на каком вопросе настройка; null — завершена';
