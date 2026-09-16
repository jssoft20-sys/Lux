/* Маленькое хранилище состояния: объект, подписки и поверхностное слияние.

   Экраны заказа и курьера перерисовываются от каждого события SSE, а событий
   бывает по несколько в секунду. Поэтому главное здесь — не будить подписчиков
   впустую: если новые значения совпали со старыми, никто ничего не узнает.
*/

const MAX_DEPTH = 25;   // защита от подписчика, который в ответ бесконечно пишет в store

export function createStore(initial = {}) {
  let state = Object.assign({}, initial);
  const subs = new Set();
  let depth = 0;

  function get() {
    return state;
  }

  function notify(prev) {
    if (depth > MAX_DEPTH) {
      console.error('[store] подписчики зациклились на записи, дальше не идём');
      return;
    }
    depth += 1;
    try {
      for (const fn of Array.from(subs)) {
        try {
          fn(state, prev);
        } catch (e) {
          console.error('[store] подписчик упал', e);
        }
      }
    } finally {
      depth -= 1;
    }
  }

  /* set принимает либо кусок состояния, либо функцию от текущего состояния.
     Возвращает новое состояние — удобно писать const s = store.set({...}). */
  function set(patch) {
    const part = typeof patch === 'function' ? patch(state) : patch;
    if (!part || typeof part !== 'object') return state;

    let changed = false;
    for (const k of Object.keys(part)) {
      if (!Object.is(state[k], part[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return state;

    const prev = state;
    state = Object.assign({}, state, part);
    notify(prev);
    return state;
  }

  /* Полная замена состояния — на выходе из экрана, когда проще начать с чистого. */
  function reset(next = {}) {
    const prev = state;
    state = Object.assign({}, next);
    notify(prev);
    return state;
  }

  function on(fn) {
    if (typeof fn !== 'function') return () => {};
    subs.add(fn);
    return () => subs.delete(fn);
  }

  /* Подписка на кусочек состояния: cb дёргается, только когда выбранное значение
     изменилось. Сравнение по ссылке, поэтому селектор должен возвращать примитив
     или сам объект из состояния, а не собранный на лету новый. */
  function select(selector, cb, opts = {}) {
    if (typeof selector !== 'function' || typeof cb !== 'function') return () => {};
    let prev = selector(state);
    if (opts.immediate) {
      try {
        cb(prev, prev);
      } catch (e) {
        console.error('[store] подписчик упал', e);
      }
    }
    return on((next) => {
      const value = selector(next);
      if (Object.is(value, prev)) return;
      const old = prev;
      prev = value;
      cb(value, old);
    });
  }

  return { get, set, reset, on, select };
}

export default createStore;
