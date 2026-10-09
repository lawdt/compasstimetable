// Настройки хранит сама Алиса. Всё, что навык вернул в user_state_update,
// она присылает обратно в state.user со следующим запросом; для устройства
// без входа в аккаунт то же самое делает application_state. Работает только
// с включённой опцией «Использовать хранилище данных в навыке».
//
// Настройки лежат одним объектом под одним ключом: user_state_update
// дописывает ключи по одному, а application_state заменяет состояние целиком,
// и с единым объектом оба пути ведут себя одинаково — частичная запись не
// сотрёт соседние поля.
const KEY = 'settings';

// Раньше это были умолчания столбцов в таблице.
const DEFAULTS = {
  class_id: null,
  programme: 'all',
  extras: true,
  // На каком вопросе остановилась настройка; null — она завершена.
  setup_step: null,
};

const isObject = (v) => Boolean(v) && typeof v === 'object';

export function openStore(update) {
  // Блок state Алиса присылает только при включённом хранилище. Разделы
  // внутри него могут и не прийти, пока там ничего не сохранено, поэтому
  // наличие хранилища определяем по самому блоку, а раздел — по тому, вошёл
  // ли человек в аккаунт: пользовательский стейт хранится только для них.
  const state = update?.state;
  const scope = !isObject(state) ? null
    : update?.session?.user ? 'user'
      : 'application';

  const saved = scope ? state[scope]?.[KEY] : null;
  let current = isObject(saved) ? { ...DEFAULTS, ...saved } : null;
  let dirty = false;

  return {
    // Без хранилища навыку негде запомнить класс, и настройка ходила бы по
    // кругу на первом вопросе.
    available: Boolean(scope),
    scope,
    read: () => current,
    write(patch) {
      current = { ...DEFAULTS, ...current, ...patch };
      dirty = true;
    },
    // Поля ответа, которые сохраняют изменения. Пустой объект, если ничего
    // не менялось.
    response() {
      if (!dirty || !scope) return {};
      return scope === 'user'
        ? { user_state_update: { [KEY]: current } }
        : { application_state: { [KEY]: current } };
    },
  };
}
