/* Клиентское приложение: карта во весь экран и шторка снизу.

   Здесь собрана оболочка — настройки сервиса, карта, шторка с переходами между
   шагами, язык, тема и маршрутизация. Сами экраны живут в order.js и track.js, а
   поиск адреса в address.js; оболочка передаёт им объект app со всем, что нужно.

   Ещё оболочка помнит человека. Регистрации у клиента нет и не будет: телефон,
   имя и постоянный ключ клиента лежат в localStorage под ключом sg_client, ключ
   выдаёт сервер тому, кто предъявил свой заказ вместе с токеном отслеживания.
   Отсюда же открывается профиль с историей заказов — не отдельной страницей, а
   шторкой поверх карты, чтобы наполовину набранный заказ под ней остался цел.

   Всё общение с сервером идёт через core/api.js, тексты — только через t().
*/

import { api } from '../core/api.js';
import {
  t, tp, has, setLang, getLang, onLangChange, applyTo, extend, LANGS,
} from '../core/i18n.js';
import { createMap, pin } from '../core/map.js';
import {
  el, toast, sheet, confirm, haptic, skeleton, mountStars, copyText,
  pressable, rowGroup, segmented,
} from '../core/ui.js';
import { createRouter } from '../core/router.js';
import {
  setTimeZone, money, moneyShort, distance, duration, dateTime, date as fmtDate,
  phone as fmtPhone, plate as fmtPlate, initials,
} from '../core/fmt.js';
import { mountOrder } from './order.js';
import { mountTrack } from './track.js';

/* Свои строки: в общий словарь их не тащим, там правки соседних модулей.
   Кыргызский — как говорят в Бишкеке, а не как переводит машина. */
extend({
  ru: {
    'me.noname': 'Без имени',
    'me.name_ph': 'Как к вам обращаться',
    'me.phone_note': 'Номер меняется вместе с новым заказом',
    'me.since': 'С нами с {date}',
    'me.orders': 'Всего заказов',
    'me.done': 'Довезли',
    'me.spent': 'Потрачено',
    'me.rating': 'Как вас оценивают',
    'me.no_rating': 'Оценок пока нет',
    'me.history': 'История заказов',
    'me.live_now': 'Заказ в работе',
    'me.watch': 'Смотреть на карте',
    'me.empty_title': 'Заказов пока нет',
    'me.empty_text': 'Первый заказ появится здесь сразу после поездки.',
    'me.load_more': 'Показать ещё',
    'me.unknown': 'Список заказов откроется, когда вы оформите заказ с этого телефона.',
    'me.card': 'Заказ {id}',
    'me.points': 'Адреса',
    'me.car': 'Машина',
    'me.pay': 'Оплата',
    'me.rated': 'Ваша оценка заказу',
    'me.not_rated': 'Заказ не оценён',
    'me.repeated': 'Берём те же адреса',
    'me.forget': 'Забыть меня',
    'me.forget_q': 'Забыть этот телефон?',
    'me.forget_text': 'С этого устройства пропадут имя, номер и список заказов. '
      + 'Сами заказы никуда не денутся — открыть их снова можно по ссылке из смс.',
    'me.forget_ok': 'Забыть',
    'me.forgot': 'Готово. Больше мы вас не помним',
    'me.support_call': 'Позвонить в поддержку',
    'me.wa_hello': 'Здравствуйте! У меня вопрос по заказу машины.',
    'me.hub_orders': 'Заказы',
    'me.places': 'Адреса',
    'me.places_none': 'Не отмечены',
    'me.details': 'Заказ целиком',
    'me.no_phone': 'Номер узнаем с первого заказа',
    'me.recent': 'Недавние адреса',
    'me.recent_empty': 'Адреса появятся здесь после первой поездки.',
    'me.theme_note': 'Открываемся светлой — на улице так виднее',

    'bn.title': 'Бонусы',
    'bn.sub': 'Кэшбек и приглашения',
    'bn.balance': 'На бонусном счету',
    'bn.empty': 'Бонусов пока нет',
    'bn.how': 'Возвращаем {percent}% с каждой поездки. Бонусами можно закрыть до {share}% заказа.',
    'bn.off': 'Бонусы сейчас выключены. Кэшбек не начисляется и не списывается.',
    'bn.unknown': 'Бонусы откроются, когда вы оформите заказ с этого телефона.',
    'bn.burn': 'Сгорят {date}, если не заказывать',
    'bn.burn_soon': 'Сгорят {date}. Закажите машину — и срок сдвинется',
    'bn.invite': 'Ваш код приглашения',
    'bn.invite_gain': 'Другу {friend} сразу, вам {owner} — после его первой поездки',
    'bn.invite_gain_short': 'Другу {friend}, вам {owner}',
    'bn.share_text': 'Заказываю машину в «{service}». Мой код {code} — вам сразу {sum} '
      + 'на первую поездку.',
    'bn.copied': 'Код с ссылкой скопированы — отправьте другу',
    'bn.waiting': 'Ждём первую поездку друзей: {n}',
    'bn.done_n': 'Друзей уже съездило: {n}',
    'bn.have_code': 'Пришёл по коду друга?',
    'bn.code_ph': 'Код из шести знаков',
    'bn.apply': 'Применить код',
    'bn.applied': 'Готово, {sum} уже на счету',
    'bn.history': 'Движение бонусов',
    'bn.history_empty': 'Здесь появятся начисления и списания.',
    'bn.show_all': 'Показать все движения',
    'bn.spend': 'Списать бонусы',
    'bn.spend_on': 'Спишем {sum} с бонусного счёта',
    'bn.spend_rest': 'Останется {sum}',
    'bn.spend_none': 'Бонусов пока нет. С этой поездки вернётся {sum}',
    'bn.spend_zero': 'По этому заказу списать нечего',
    'bn.spend_cap': 'По этому заказу можно списать до {sum}',
    'bn.spend_short': 'До полного списания не хватает {sum}',
    'bn.spend_total': 'К оплате',
    'bn.spend_keep': 'Бонусы останутся на счету',

    'tip.title': 'Как это работает',
    'tip.one': 'Два адреса — и цена сразу на экране, без звонков и торга.',
    'tip.two': 'Машину видно на карте, время подачи считается вживую.',
    'tip.three': 'С каждой поездки возвращаем {percent}% бонусами.',
    'tip.three_plain': 'Заказы, чеки и любимые адреса остаются в вашем профиле.',
    'tip.ok': 'Понятно, поехали',
    'tip.skip': 'Пропустить',

    'fav.group': 'Дом и работа',
    'fav.home': 'Дом',
    'fav.work': 'Работа',
    'fav.set_home': 'Сделать домом',
    'fav.set_work': 'Сделать работой',
    'fav.saved_home': 'Адрес сохранён как дом',
    'fav.saved_work': 'Адрес сохранён как работа',
    'fav.drop': 'Убрать',
    'fav.dropped': 'Убрали из любимых',
    'fav.hint': 'Отметьте второй адрес — и поездка между ними будет в одно касание.',
    'fav.empty': 'Отметьте дом и работу — они встанут в начало подсказок адреса, '
      + 'а поездка между ними соберётся одной кнопкой.',
    'fav.ride_home': 'Домой',
    'fav.ride_work': 'На работу',
    'fav.ride_sub': '{from} → {to}',

    'again.repeat': 'Повторить заказ',
    'again.live': 'Заказ в работе',
    'again.live_sub': 'Смотреть на карте',
    'again.hide': 'Скрыть подсказку',
  },
  ky: {
    'me.noname': 'Аты жок',
    'me.name_ph': 'Сизди кантип атайбыз',
    'me.phone_note': 'Номер жаңы заказ менен кошо өзгөрөт',
    'me.since': '{date} тартып биз менен',
    'me.orders': 'Бардык заказдар',
    'me.done': 'Жеткирилди',
    'me.spent': 'Төлөнгөн сумма',
    'me.rating': 'Сизди кандай баалашат',
    'me.no_rating': 'Азырынча баа жок',
    'me.history': 'Заказдардын тарыхы',
    'me.live_now': 'Заказ иштеп жатат',
    'me.watch': 'Картадан көрүү',
    'me.empty_title': 'Азырынча заказ жок',
    'me.empty_text': 'Биринчи заказ сапардан кийин ушул жерден көрүнөт.',
    'me.load_more': 'Дагы көрсөтүү',
    'me.unknown': 'Заказдардын тизмеси ушул телефондон заказ бергенде ачылат.',
    'me.card': 'Заказ {id}',
    'me.points': 'Даректер',
    'me.car': 'Унаа',
    'me.pay': 'Төлөм',
    'me.rated': 'Заказга койгон бааңыз',
    'me.not_rated': 'Заказга баа коюлган жок',
    'me.repeated': 'Ошол эле даректерди алабыз',
    'me.forget': 'Мени унутуңуз',
    'me.forget_q': 'Бул телефонду унутабызбы?',
    'me.forget_text': 'Бул түзмөктөн атыңыз, номериңиз жана заказдар тизмеси өчөт. '
      + 'Заказдардын өзү жоголбойт — смстеги шилтеме менен кайра ачса болот.',
    'me.forget_ok': 'Унутуу',
    'me.forgot': 'Болду. Эми сизди эстебейбиз',
    'me.support_call': 'Колдоо кызматына чалуу',
    'me.wa_hello': 'Саламатсызбы! Унаа заказы боюнча суроом бар.',
    'me.hub_orders': 'Заказдар',
    'me.places': 'Даректер',
    'me.places_none': 'Белгиленген эмес',
    'me.details': 'Заказдын толугу',
    'me.no_phone': 'Номериңизди биринчи заказдан билебиз',
    'me.recent': 'Акыркы даректер',
    'me.recent_empty': 'Биринчи сапардан кийин даректер ушул жерде турат.',
    'me.theme_note': 'Ачык түс менен ачылабыз — көчөдө ушул жакшы көрүнөт',

    'bn.title': 'Бонустар',
    'bn.sub': 'Кэшбек жана чакыруу',
    'bn.balance': 'Бонус эсебиңизде',
    'bn.empty': 'Азырынча бонус жок',
    'bn.how': 'Ар бир сапардан {percent}% кайтарабыз. Заказдын {share}% чейинкисин '
      + 'бонус менен жабууга болот.',
    'bn.off': 'Бонустар азыр өчүк. Кэшбек кошулбайт, эсептен да алынбайт.',
    'bn.unknown': 'Ушул телефондон заказ бергениңизде бонустар ачылат.',
    'bn.burn': 'Заказ болбосо, {date} күйүп кетет',
    'bn.burn_soon': '{date} күйүп кетет. Унаа заказ кылсаңыз, мөөнөтү жылат',
    'bn.invite': 'Чакыруу кодуңуз',
    'bn.invite_gain': 'Досуңузга {friend} дароо, сизге {owner} — ал биринчи жолу жүргөндөн кийин',
    'bn.invite_gain_short': 'Досуңузга {friend}, сизге {owner}',
    'bn.share_text': '«{service}» менен унаа заказ кылам. Менин кодум {code} — '
      + 'биринчи сапарыңызга дароо {sum}.',
    'bn.copied': 'Код менен шилтеме көчүрүлдү — досуңузга жөнөтүңүз',
    'bn.waiting': 'Биринчи сапарын күтүп жаткан дос: {n}',
    'bn.done_n': 'Жүрүп чыккан дос: {n}',
    'bn.have_code': 'Достун коду менен келдиңизби?',
    'bn.code_ph': 'Алты белгилүү код',
    'bn.apply': 'Кодду колдонуу',
    'bn.applied': 'Болду, {sum} эсепке түштү',
    'bn.history': 'Бонустун кыймылы',
    'bn.history_empty': 'Кошулган жана алынган сумма ушул жерден көрүнөт.',
    'bn.show_all': 'Бардык кыймылды көрсөтүү',
    'bn.spend': 'Бонус менен төлөө',
    'bn.spend_on': 'Бонус эсебинен {sum} кетет',
    'bn.spend_rest': '{sum} калат',
    'bn.spend_none': 'Азырынча бонус жок. Бул сапардан {sum} кайтат',
    'bn.spend_zero': 'Бул заказга бонус кетпейт',
    'bn.spend_cap': 'Бул заказга {sum} чейин бонус кетет',
    'bn.spend_short': 'Толук жабууга {sum} жетишпей турат',
    'bn.spend_total': 'Төлөөгө',
    'bn.spend_keep': 'Бонустар эсепте калат',

    'tip.title': 'Кантип иштейт',
    'tip.one': 'Эки дарек — баасы дароо экранда, чалуунун да, сүйлөшүүнүн да кереги жок.',
    'tip.two': 'Унаа картадан көрүнөт, келүү убактысы тирүүлөй эсептелет.',
    'tip.three': 'Ар бир сапардан {percent}% бонус кайтарабыз.',
    'tip.three_plain': 'Заказдар, чектер жана сүйүктүү даректер профилиңизде калат.',
    'tip.ok': 'Түшүндүм, кеттик',
    'tip.skip': 'Өткөрүп жиберүү',

    'fav.group': 'Үй жана жумуш',
    'fav.home': 'Үй',
    'fav.work': 'Жумуш',
    'fav.set_home': 'Үй кылып коюу',
    'fav.set_work': 'Жумуш кылып коюу',
    'fav.saved_home': 'Дарек үй катары сакталды',
    'fav.saved_work': 'Дарек жумуш катары сакталды',
    'fav.drop': 'Алып салуу',
    'fav.dropped': 'Сүйүктүүлөрдөн алынды',
    'fav.hint': 'Экинчи даректи да белгилеңиз — ортосундагы сапар бир басууда болот.',
    'fav.empty': 'Үйүңүз менен жумушуңузду белгилеңиз — алар дарек тизмесинин башына '
      + 'турат, ортосундагы сапар бир баскычта чогулат.',
    'fav.ride_home': 'Үйгө',
    'fav.ride_work': 'Жумушка',
    'fav.ride_sub': '{from} → {to}',

    'again.repeat': 'Заказды кайталоо',
    'again.live': 'Заказ иштеп жатат',
    'again.live_sub': 'Картадан көрүү',
    'again.hide': 'Жашыруу',
  },
});

/* Ключи в localStorage: активный заказ, память о человеке, недавние адреса, тема.
   KEY_ME остался от первой версии — он ещё читается один раз, при переносе. */
export const KEY_ORDER = 'sg_order';
export const KEY_ME = 'sg_me';
export const KEY_CLIENT = 'sg_client';
export const KEY_RECENT = 'sg_recent';
export const KEY_THEME = 'sg_theme';
/* Тот же ключ читает скрипт в index.html: «выбор темы человек уже делал». */
export const KEY_THEME_SET = 'sg_theme_set';
export const KEY_SEEN = 'sg_seen';       // подсказку при первом заходе уже показали
export const KEY_PLACES = 'sg_places';   // любимые адреса: дом и работа

const HISTORY_PAGE = 20;
const NEAR_BOTTOM = 260;      // за сколько пикселей до конца списка просим следующую страницу
const RECENT_MAX = 8;         // столько адресов помнит поиск (столько же, сколько address.js)
const CLAIM_RETRY_S = 120;    // ключ клиента не дался — не долбим сервер чаще, чем раз в две минуты
const WARM_ORDERS = 5;        // столько последних заказов смотрим на старте
const BONUS_TTL_S = 45;       // столько секунд считаем баланс бонусов свежим
const TIP_DELAY_MS = 900;     // даём первому экрану встать, и только потом подсказываем

/* Коды ошибок, у которых имя в словаре не совпадает с кодом сервера. */
const ERR_ALIAS = {
  server_error: 'server',
  http_500: 'server',
  http_502: 'server',
  http_503: 'server',
  bad_json: 'bad_request',
  stream: 'network',
};

/* Цвет метки статуса в истории: зелёный — довезли, красный — не состоялось,
   синий — едет прямо сейчас, жёлтый — ещё ищем машину. */
const STATUS_TONE = {
  done: 'ok',
  cancelled: 'err',
  expired: 'err',
  draft: 'warn',
  searching: 'warn',
  assigned: 'info',
  to_pickup: 'info',
  at_pickup: 'info',
  in_transit: 'info',
  at_dropoff: 'info',
};

/* Статусы, при которых заказ ещё живой и его стоит открыть на карте. */
const LIVE_STATUSES = ['draft', 'searching', 'assigned', 'to_pickup',
  'at_pickup', 'in_transit', 'at_dropoff'];

/* ─────────────────────────────────────────────────────── хранилище */

/* localStorage закрыт в инкогнито и в части встроенных браузеров. Читать и писать
   туда без try/catch нельзя: одно исключение — и весь экран не соберётся. */
export function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* места нет или хранилище закрыто — приложение работает и без памяти */
  }
  return value;
}

/* ─────────────────────────────────────────────────────── память о человеке */

/** Что мы помним: {phone, name, token, photo}. Пустой объект — человек новый. */
export function readClient() {
  const saved = readJson(KEY_CLIENT);
  if (saved && typeof saved === 'object') return saved;
  // Первая версия держала телефон с именем под другим ключом. Переносим один
  // раз и старый ключ убираем, чтобы не остаться с двумя разными правдами.
  const old = readJson(KEY_ME);
  if (old && typeof old === 'object' && (old.phone || old.name)) {
    const moved = { phone: old.phone || '', name: old.name || '' };
    writeJson(KEY_CLIENT, moved);
    writeJson(KEY_ME, null);
    return moved;
  }
  return {};
}

/**
 * Дописать то, что узнали. undefined значит «не трогай это поле», пустая строка
 * и null — «забудь». Разница важная: человек мог стереть имя нарочно, а мог
 * просто прислать патч, где имени нет вовсе.
 */
export function saveClient(patch) {
  const next = readClient();
  for (const key of Object.keys(patch || {})) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null || value === '') delete next[key];
    else next[key] = value;
  }
  writeJson(KEY_CLIENT, next);
  paintProfileButton();
  return next;
}

/** «Забыть меня»: с устройства уходит всё, что могло указать на человека. */
export function forgetClient() {
  writeJson(KEY_CLIENT, null);
  writeJson(KEY_ME, null);
  writeJson(KEY_ORDER, null);
  writeJson(KEY_RECENT, null);
  paintProfileButton();
}

export function clientToken() {
  return readClient().token || '';
}

let claiming = null;      // запрос за ключом уже в пути — второй не нужен
let claimAfter = 0;       // раньше этой секунды не пробуем снова

/**
 * Постоянный ключ клиента. Сервер выдаёт его тому, кто доказал, что заказ его:
 * нужны телефон, номер заказа и токен отслеживания. Всё это у нас есть сразу
 * после оформления, поэтому ключ забираем молча и в фоне — человека это не
 * касается, а без ключа не откроется ни профиль, ни история.
 */
export function ensureClientToken() {
  const me = readClient();
  if (me.token) return Promise.resolve(me.token);
  if (claiming) return claiming;

  const order = readJson(KEY_ORDER);
  const now = Math.floor(Date.now() / 1000);
  if (!me.phone || !order || !order.pid || !order.token || now < claimAfter) {
    return Promise.resolve('');
  }

  claiming = api.post('/client/claim', {
    phone: me.phone, order_id: order.pid, track_token: order.token,
  }, { auth: false }).then((res) => {
    const token = (res && res.token) || '';
    if (token) saveClient({ token, name: (res.profile && res.profile.name) || me.name });
    return token;
  }).catch(() => {
    // Сервер отказал или связи нет: подождём и попробуем со следующим заказом.
    claimAfter = Math.floor(Date.now() / 1000) + CLAIM_RETRY_S;
    return '';
  }).then((token) => {
    claiming = null;
    return token;
  });

  return claiming;
}

/* Адрес из истории кладём в «недавние» — так «Повторить заказ» помогает даже
   на шаге поиска адреса, а не только подстановкой в новый заказ. */
function rememberRecent(points) {
  const key = (p) => (p.addr || '') + '|' + Number(p.lat).toFixed(4) + Number(p.lng).toFixed(4);
  const fresh = (points || [])
    .filter((p) => p && p.addr && p.lat != null && p.lng != null)
    .map((p) => ({
      addr: p.addr, subtitle: p.subtitle || '', lat: p.lat, lng: p.lng,
    }));
  if (!fresh.length) return;
  const was = readJson(KEY_RECENT, []);
  const list = (Array.isArray(was) ? was : [])
    .filter((p) => p && p.lat != null && !fresh.some((f) => key(f) === key(p)));
  writeJson(KEY_RECENT, fresh.concat(list).slice(0, RECENT_MAX));
}

/* ─────────────────────────────────────────────────────── тема */

const THEMES = ['auto', 'dark', 'light'];
const lightMedia = window.matchMedia('(prefers-color-scheme: light)');
const themeWatchers = new Set();

/**
 * Какая тема выбрана: 'light' | 'dark' | 'auto'.
 *
 * Владелец сказал прямо: сервис открывается светлым. Поэтому «ничего не
 * выбирали» — это светлая, а не «как в системе»: человек с тёмным телефоном
 * увидел бы иначе покрашенный сервис ещё до того, как что-то настроил.
 *
 * «Как в системе» хранится отсутствием ключа рядом с отметкой о сделанном
 * выборе — ровно так же, как это делает скрипт в index.html, который красит
 * страницу до первой отрисовки. Две правды об одной настройке нам не нужны.
 */
export function getTheme() {
  const saved = readJson(KEY_THEME);
  if (THEMES.indexOf(saved) >= 0) return saved;
  return themePicked() ? 'auto' : 'light';
}

function themePicked() {
  try {
    return !!localStorage.getItem(KEY_THEME_SET);
  } catch (e) {
    return false;               // хранилище закрыто — считаем, что не выбирали
  }
}

/** Светло ли сейчас на самом деле: «как в системе» спрашиваем у системы. */
export function isLightNow() {
  const mode = getTheme();
  return mode === 'light' || (mode === 'auto' && lightMedia.matches);
}

/** Выбор темы. 'auto' убирает атрибут и отдаёт решение системе. */
export function setTheme(mode) {
  const next = THEMES.indexOf(mode) >= 0 ? mode : 'light';
  writeJson(KEY_THEME, next === 'auto' ? null : next);
  // Отметка о сделанном выборе: без неё «как в системе» на следующей загрузке
  // не отличить от «ничего не выбирали», и человека молча вернуло бы к светлой.
  try {
    localStorage.setItem(KEY_THEME_SET, '1');
  } catch (e) {
    /* приватный режим: выбор продержится до перезагрузки, это не повод падать */
  }
  applyTheme();
  return next;
}

function applyTheme() {
  const mode = getTheme();
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  const light = isLightNow();
  for (const fn of Array.from(themeWatchers)) {
    try {
      fn(light);
    } catch (e) {
      console.error('[theme]', e);
    }
  }
}

export function onThemeChange(fn) {
  if (typeof fn !== 'function') return () => {};
  themeWatchers.add(fn);
  return () => themeWatchers.delete(fn);
}

// Тему ставим до первой отрисовки: иначе светлый экран успеет мигнуть тёмным.
applyTheme();
if (lightMedia.addEventListener) {
  lightMedia.addEventListener('change', () => {
    if (getTheme() === 'auto') applyTheme();
  });
}

/* ─────────────────────────────────────────────────────── мелкие помощники */

/** Длительность из токенов в миллисекундах: с «меньше движения» вернётся 1 мс. */
export function dur(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  if (!isFinite(n)) return fallback;
  return raw.endsWith('ms') ? n : n * 1000;
}

/** Префикс установки: сервис может стоять и в корне, и в подпапке (site.kg/go/).
    Тот же источник, что у core/api.js, — иначе ссылки уйдут на чужой сайт. */
export function basePath() {
  const raw = String(window.SG_BASE || '/');
  return raw.endsWith('/') ? raw : raw + '/';
}

/** Адрес сайта целиком: с него начинаются все ссылки, которыми делятся. */
export function siteUrl(tail = '') {
  return location.origin + basePath() + String(tail || '').replace(/^\/+/, '');
}

/** Человеческий текст ошибки: с сервера берём его пояснение, из сети — своё. */
export function errText(e) {
  if (!e) return t('err.unknown');
  const code = ERR_ALIAS[e.code] || e.code || '';
  if (e.status === 0) {
    return has('err.' + code) ? t('err.' + code) : t('err.network');
  }
  if (e.message) return e.message;
  if (has('err.' + code)) return t('err.' + code);
  return t('err.unknown');
}

/** Название из справочника на текущем языке: у тарифов и услуг оно приходит парой. */
export function nameOf(row, field = 'name') {
  if (!row) return '';
  const key = field + '_' + (getLang() === 'ky' ? 'ky' : 'ru');
  return row[key] || row[field + '_ru'] || '';
}

/** «4.7» → «4,7». Дробная часть показывается, только если она есть. */
function rate(value) {
  const v = Math.round((Number(value) || 0) * 10) / 10;
  return String(v).replace('.', ',');
}

/** Название статуса: из словаря, а если ключа нет — то, что прислал сервер. */
function statusName(item) {
  const key = 'status.' + item.status;
  return has(key) ? t(key) : (item.status_name || item.status || '');
}

function statusBadge(item) {
  const tone = STATUS_TONE[item.status] || '';
  return el('span', { className: 'badge' + (tone ? ' badge--' + tone : '') }, statusName(item));
}

/* ─────────────────────────────────────────────────────── иконки */

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  go: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  minus: '<path d="M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.4V12l3.2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  locate: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="6.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 1.8v3.2M12 19v3.2M1.8 12H5M19 12h3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  map: '<path d="M9 4.5L3.8 6.6v13L9 17.4l6 2.1 5.2-2.1v-13L15 6.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 4.5v12.9M15 6.6v12.9" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  note: '<path d="M4.5 19.5l.9-3.6L15.7 5.6a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8L9 19.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  phone: '<path d="M6.4 3.8h3l1.5 3.8-2 1.4a11 11 0 0 0 5.1 5.1l1.4-2 3.8 1.5v3a1.6 1.6 0 0 1-1.8 1.6C10.6 17.5 6.5 13.4 4.8 5.6a1.6 1.6 0 0 1 1.6-1.8z" fill="currentColor"/>',
  chat: '<path d="M4.5 6.6c0-1.2 1-2.1 2.1-2.1h10.8c1.2 0 2.1.9 2.1 2.1v7.2c0 1.2-.9 2.1-2.1 2.1H10l-4.2 3.4-.1-3.4h-.2A1.4 1.4 0 0 1 4.5 14z" fill="currentColor"/>',
  alert: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.4v5.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.3" r="1.2" fill="currentColor"/>',
  car: '<path d="M3.5 15.5v-3.2l2.1-4.1a2.4 2.4 0 0 1 2.1-1.3h8.6a2.4 2.4 0 0 1 2.1 1.3l2.1 4.1v3.2a1 1 0 0 1-1 1h-1.3v-1.4H5.8v1.4H4.5a1 1 0 0 1-1-1z" fill="currentColor"/><circle cx="7.4" cy="16.4" r="1.9" fill="currentColor"/><circle cx="16.6" cy="16.4" r="1.9" fill="currentColor"/>',
  van: '<path d="M2.6 7.2h10.6v9.1H2.6z" fill="currentColor"/><path d="M13.2 9.6h3.6l3.4 4v2.7h-7z" fill="currentColor"/><circle cx="7" cy="17" r="2" fill="currentColor"/><circle cx="17" cy="17" r="2" fill="currentColor"/>',
  truck: '<path d="M2 6.4h11.4v9.9H2z" fill="currentColor"/><path d="M13.4 9.2h3.9l3.7 4.3v2.8h-7.6z" fill="currentColor"/><circle cx="6.6" cy="17.2" r="2.1" fill="currentColor"/><circle cx="17.4" cy="17.2" r="2.1" fill="currentColor"/>',
  'truck-big': '<path d="M1.4 5.6h12.8v10.9H1.4z" fill="currentColor"/><path d="M14.2 8.4h4.2l4.2 4.7v3.4h-8.4z" fill="currentColor"/><circle cx="6.2" cy="17.4" r="2.2" fill="currentColor"/><circle cx="18.2" cy="17.4" r="2.2" fill="currentColor"/>',
  user: '<circle cx="12" cy="8.4" r="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.8 20.2c.6-3.8 3.6-5.8 7.2-5.8s6.6 2 7.2 5.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  list: '<path d="M8.4 6.6h11M8.4 12h11M8.4 17.4h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="4.6" cy="6.6" r="1.4" fill="currentColor"/><circle cx="4.6" cy="12" r="1.4" fill="currentColor"/><circle cx="4.6" cy="17.4" r="1.4" fill="currentColor"/>',
  star: '<path d="M12 17.1l-5.3 3.1 1.4-6L3.4 10l6.1-.5L12 3.9l2.5 5.6 6.1.5-4.7 4.2 1.4 6z" fill="currentColor"/>',
  wa: '<path d="M12 3.4a8.5 8.5 0 0 0-7.3 12.8L3.4 20.6l4.5-1.2A8.5 8.5 0 1 0 12 3.4zm4.7 11.9c-.2.6-1.2 1.1-1.7 1.2-.4.1-1 .1-1.6-.1a12 12 0 0 1-5.2-4.5c-.4-.6-.7-1.3-.7-2 0-.7.4-1.2.6-1.4.2-.2.4-.3.6-.3h.4c.2 0 .3 0 .5.4l.7 1.6c.1.2 0 .4-.1.5l-.3.4c-.1.1-.2.3-.1.5.3.5.7 1.1 1.2 1.6.6.5 1.1.8 1.6 1 .2.1.4 0 .5-.1l.5-.6c.1-.2.3-.2.5-.1l1.5.8c.2.1.3.2.3.3 0 .1 0 .5-.2.8z" fill="currentColor"/>',
  trash: '<path d="M5.6 7.2h12.8M9.4 7.2V5.6c0-.6.5-1.1 1.1-1.1h3c.6 0 1.1.5 1.1 1.1v1.6M7.2 7.2l.8 11.2c0 .6.5 1.1 1.1 1.1h5.8c.6 0 1.1-.5 1.1-1.1l.8-11.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  gift: '<path d="M4.4 10.6h15.2v8.3a1.1 1.1 0 0 1-1.1 1.1H5.5a1.1 1.1 0 0 1-1.1-1.1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M3.4 7.3h17.2v3.3H3.4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 7.3V20" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.3S10.8 3.6 8.6 3.6a2 2 0 0 0 0 3.7zM12 7.3s1.2-3.7 3.4-3.7a2 2 0 0 1 0 3.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  home: '<path d="M4.2 10.8 12 4.4l7.8 6.4V19a1.1 1.1 0 0 1-1.1 1.1h-3.6v-5.3H8.9v5.3H5.3A1.1 1.1 0 0 1 4.2 19z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  work: '<path d="M3.6 8.4h16.8v10a1.1 1.1 0 0 1-1.1 1.1H4.7a1.1 1.1 0 0 1-1.1-1.1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 8.4V6.2c0-.6.5-1.1 1.1-1.1h3.8c.6 0 1.1.5 1.1 1.1v2.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M3.6 13.2h16.8" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  repeat: '<path d="M5 9.4a7 7 0 0 1 11.6-2.6l2 1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 14.6a7 7 0 0 1-11.6 2.6l-2-1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.9 4.6v4.3h-4.3M5.1 19.4v-4.3h4.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  gear: '<circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 14.2a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.3a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.6-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.3a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1.1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.3a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.3a1.8 1.8 0 1 1 0 3.6h-.2a1.5 1.5 0 0 0-1.4.9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  share: '<circle cx="17.6" cy="6.2" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="6.4" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="17.6" cy="17.8" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.8 10.8 15.2 7.4M8.8 13.2l6.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
};

/** Разметка иконки для вставки через html. Незнакомое имя рисуем кружком:
    пустое место на кнопке выглядит как поломка. */
export function icon(name) {
  const body = ICONS[name] || '<circle cx="12" cy="12" r="3" fill="currentColor"/>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>';
}

/** Кнопка-иконка одной строкой: класс, подпись для скринридера, обработчик. */
export function iconBtn(name, cls, label, onClick) {
  return el('button', {
    type: 'button', className: cls, 'aria-label': label, title: label,
    html: icon(name), onClick,
  });
}

/* Иконка отдельным узлом заданного размера. Размер ставим атрибутами самому svg:
   там, где у контейнера нет своего правила для svg, браузер растянет картинку
   до 300×150 и разнесёт вёрстку. */
function iconNode(name, size) {
  const box = el('span', {
    html: icon(name),
    style: { display: 'block', width: size + 'px', height: size + 'px' },
  });
  const svg = box.firstElementChild;
  if (svg) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  return box;
}

/* Голый svg-узел без обёртки: нужен там, где правило CSS достаёт иконку
   прямым потомком кнопки. */
function svgIcon(name) {
  return el('span', { html: icon(name) }).firstElementChild;
}

/* ─────────────────────────────────────────────────────── свои стили

   Бонусы, подсказка над шторкой и любимые адреса — это только клиентская
   оболочка, поэтому и правила они везут с собой: client.css правят соседние
   модули, и лезть туда за четырьмя блоками незачем. Цвета — только токены,
   тогда обе темы работают сами. */
const OWN_CSS = `
/* ── подсказка, которая висит над шторкой ──────────────────────────────── */

.sg-flash {
  position: absolute;
  left: var(--sp-3);
  /* справа оставляем колонку кнопок карты — перекрывать их нельзя */
  right: calc(var(--sp-3) + 56px);
  bottom: calc(max(0px, var(--sg-panel-h, 240px) - var(--sg-panel-off, 0px)) + var(--sp-3));
  z-index: 14;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-3);
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--shadow-2);
  opacity: 0;
  transform: translateY(10px);
  transition: opacity var(--dur-2) var(--ease), transform var(--dur-2) var(--ease);
}
.sg-flash--in { opacity: 1; transform: none; }

.sg-flash__go {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 44px;
  text-align: left;
}
.sg-flash__go:active { transform: scale(.985); }

.sg-flash__ico {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--r-full);
  background: var(--accent-soft);
  color: var(--accent);
}
.sg-flash__ico > svg { width: 19px; height: 19px; }

.sg-flash__text { flex: 1 1 auto; min-width: 0; }

.sg-flash__title {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.25;
}
.sg-flash__sub {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.3;
}

.sg-flash__x {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--muted-2);
}
.sg-flash__x:active { color: var(--text); transform: scale(.92); }
.sg-flash__x > svg { width: 17px; height: 17px; }

/* Поиск адреса разворачивает шторку на весь экран — подсказке там не место. */
.sg-app.is-deep .sg-flash { display: none; }

/* ── бонусный счёт ─────────────────────────────────────────────────────── */

.sg-bal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-3) 0 var(--sp-2);
}
.sg-bal__val {
  font-family: var(--font-display);
  font-size: var(--fs-display);
  font-weight: 800;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.sg-bal__name { color: var(--muted); font-size: var(--fs-sm); }
.sg-bal__burn {
  max-width: 34ch;
  color: var(--warn);
  font-size: var(--fs-xs);
  line-height: 1.4;
  text-align: center;
}

.sg-code {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-3);
  border: 1px dashed var(--accent-line);
  border-radius: var(--r-md);
  background: var(--accent-soft);
}
.sg-code__val {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: var(--fs-h2);
  font-weight: 700;
  letter-spacing: .14em;
}
.sg-code__btn { flex: none; min-height: 44px; }

/* ── переключатель «списать бонусы» в заказе ───────────────────────────── */

.sg-bonus { display: flex; flex-direction: column; }

.sg-bonus__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 56px;
  padding: var(--sp-2) 0;
  cursor: pointer;
}

.sg-bonus__ico {
  flex: none;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--r-full);
  background: var(--accent-soft);
  color: var(--accent);
}
.sg-bonus__ico > svg { width: 20px; height: 20px; }

.sg-bonus__text { flex: 1 1 auto; min-width: 0; }

.sg-bonus__title {
  display: block;
  font-size: var(--fs-body);
  font-weight: 600;
  line-height: 1.3;
}
/* Это не заголовок строки, а объяснение — пусть переносится целиком:
   обрезанное многоточием «не хватает…» ничего не объясняет. */
.sg-bonus__sub {
  display: block;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.4;
}
.sg-bonus__sub--warn { color: var(--warn); }

.sg-bonus__total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line-soft);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.sg-bonus__total b {
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

/* ── подсказка при первом заходе ───────────────────────────────────────── */

.sg-tip {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-2) 0;
}
.sg-tip__ico { flex: none; width: 30px; font-size: 22px; line-height: 1.3; text-align: center; }
.sg-tip__text { flex: 1 1 auto; min-width: 0; font-size: var(--fs-sm); line-height: 1.45; }

/* ── отметки «дом» и «работа» в карточке заказа ────────────────────────── */

.sg-mark { display: flex; gap: var(--sp-2); padding: var(--sp-1) 0 var(--sp-2) 50px; }

.sg-mark__b {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.sg-mark__b > svg { width: 17px; height: 17px; }
.sg-mark__b:active { transform: scale(.96); }
.sg-mark__b.is-on { background: var(--accent-soft); color: var(--accent); }

@media (max-width: 380px) {
  .sg-flash { right: calc(var(--sp-3) + 52px); }
}

/* На широком экране шторка стоит слева, подсказке хватает места рядом с ней. */
@media (min-width: 620px) {
  .sg-flash { left: var(--sp-4); right: auto; width: 420px; }
}

/* ── профиль: полки вместо одной длинной ленты ─────────────────────────── */

/* Профиль открывается во весь экран, и разделы в нём переключают, а не листают.
   Шапка шторки работает шапкой раздела: слева «назад», посередине название,
   справа крестик — так же, как в приложениях, к которым человек привык. */

.sg-me .sheet__body {
  padding-bottom: calc(var(--sp-6) + var(--safe-b));
  /* Раздел уезжает вбок; без этого на время переезда появлялась бы
     горизонтальная прокрутка и экран дёргался бы вправо. */
  overflow-x: hidden;
}

.sg-me__wrap { display: flex; flex-direction: column; gap: var(--sp-3); }

/* Подпись группы и так отделена промежутком колонки — своего отступа сверху
   ей тут не нужно, иначе между карточками зияет дыра. */
.sg-me__wrap > .sg-group { padding: var(--sp-1) 0 0; }
.sg-me__wrap > .sheet__text { padding-bottom: 0; }

/* Сцена держит высоту, пока разделы меняются местами: уходящий лежит абсолютом
   и места в потоке не занимает, а без подпорки шторка схлопнулась бы до нуля
   и тут же прыгнула обратно. */
.sg-stage {
  position: relative;
  transition: min-height var(--dur-2) var(--ease);
}

.sg-view {
  transition: opacity var(--dur-2) var(--ease),
              transform var(--dur-2) var(--ease-spring);
}

/* Вглубь — раздел въезжает справа, назад — слева. Направление и есть ответ на
   вопрос «где я оказался»: его читают быстрее любой надписи. */
.sg-view--enter { opacity: 0; transform: translateX(30px); }
.sg-view--back.sg-view--enter { transform: translateX(-30px); }

.sg-view--out {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  opacity: 0;
  transform: translateX(-24px);
  pointer-events: none;
  transition: opacity var(--dur-1) var(--ease-in),
              transform var(--dur-2) var(--ease);
}
.sg-view--out.sg-view--back-out { transform: translateX(24px); }

/* Шапка профиля: лицо, имя, телефон. Нажатие ведёт в настройки — имя правят там. */
.sg-me__card {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  padding: var(--sp-4);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-lg);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
}

.sg-me__who {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sg-me__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -.01em;
}

.sg-me__phone {
  color: var(--muted);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
}

.sg-me__since { color: var(--muted-2); font-size: var(--fs-xs); }

/* Четыре полки. Две в ряд: на 360 px три уже не читаются, а одна в ряд —
   это снова лента, от которой мы и уходим. */
.sg-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}

.sg-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 118px;
  padding: var(--sp-4);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-lg);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
}

.sg-tile__ico {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: var(--sp-2);
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--muted);
}
.sg-tile__ico > svg { width: 22px; height: 22px; }

.sg-tile--accent .sg-tile__ico { background: var(--accent-soft); color: var(--accent-text); }

.sg-tile__name { color: var(--muted); font-size: var(--fs-sm); line-height: 1.3; }

.sg-tile__val {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 800;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}

/* Плотная группа строк в одной карточке: разделители внутри, а не зазоры
   снаружи — десять отдельных карточек читаются как десять разных дел. */
.sg-me__rows {
  padding: 0 var(--sp-4);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-lg);
  background: var(--surface);
}
.sg-me__rows > * + * { border-top: 1px solid var(--line-soft); }

/* Строка въезжает один раз — когда список впервые появился. Задержку ставит
   скрипт по номеру строки, здесь только само движение. */
.sg-rise { animation: sg-me-rise var(--dur-2) var(--ease) backwards; }

@keyframes sg-me-rise {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
}

/* Три цифры о заказах одной строкой: сколько всего, сколько доехало, на сколько. */
.sg-stats {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--sp-2);
}

.sg-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-3);
  border-radius: var(--r-md);
  background: var(--surface-2);
}

.sg-stat__val {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.sg-stat__name { color: var(--muted); font-size: var(--fs-xs); line-height: 1.3; }

/* Карта в карточке заказа: только посмотреть, куда ездили. */
.sg-me__map {
  position: relative;
  height: 172px;
  border-radius: var(--r-lg);
  overflow: hidden;
}

/* Разбивка цены стоит карточкой, как и всё остальное на экране. */
.sg-me__sums {
  padding: var(--sp-1) var(--sp-4);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-lg);
  background: var(--surface);
}

/* Отметки «дом» и «работа» внутри профиля. Ужиматься кнопкам нельзя: подпись
   ломается на две строки и строка адреса раздувается вдвое. Поэтому отступы
   тут поджаты — на 360 px обе подписи должны встать в один ряд. Если всё-таки
   не хватит, вторая кнопка перенесётся под первую, а не порвёт надпись. */
.sg-me .sg-mark { flex-wrap: wrap; padding: 0 0 var(--sp-2); }
.sg-me .sg-mark__b { flex: none; padding: 0 var(--sp-3) 0 var(--sp-2); }

/* Убрать отметку «дом»/«работа» — кнопка на 44 px, иначе в неё не попасть. */
.sg-me__x {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r-full);
  color: var(--muted-2);
}
.sg-me__x > svg { width: 20px; height: 20px; }
.sg-me__x.is-press { color: var(--err); }

/* Заказ, который едет прямо сейчас, и поездка «домой» — единственные строки
   профиля с жёлтым значком: это то, ради чего его чаще всего и открывают. */
.sg-me__live .rowgroup__ico,
.sg-me__ride .rowgroup__ico { background: var(--accent-soft); color: var(--accent-text); }

/* На большом экране полок в ряд больше: место есть, а тянуться пальцем
   через весь монитор не нужно. */
@media (min-width: 620px) {
  .sg-tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
`;

let cssDone = false;

function ensureCss() {
  if (cssDone || !document.head) return;
  cssDone = true;
  document.head.appendChild(el('style', { id: 'sg-client-css', text: OWN_CSS }));
}

/* ─────────────────────────────────────────────────────── бонусы: данные

   Бонусы спрашивают из двух мест: экран профиля показывает весь счёт целиком,
   а экран заказа — только «сколько можно списать по этой сумме». Второй запрос
   короткий и уходит на каждое изменение цены, поэтому он и живёт отдельно.
   Баланс держим в памяти ненадолго: между открытием профиля и оформлением
   заказа он не меняется, а лишний запрос на медленной связи заметен. */

const bonusMem = { data: null, at: 0, wait: null };

/** Включены ли бонусы вообще — это решает админ, а не устройство. */
export function bonusOn(cfg) {
  const b = (cfg && cfg.bonus) || {};
  return b.enabled !== false;
}

function bonusForget() {
  bonusMem.data = null;
  bonusMem.at = 0;
}

/**
 * Весь бонусный счёт: баланс, код приглашения, сгорание и история.
 * Без ключа клиента вернёт null — человека мы ещё не знаем.
 */
export function loadBonus(force) {
  const token = clientToken();
  if (!token) return Promise.resolve(null);
  const now = Math.floor(Date.now() / 1000);
  if (!force && bonusMem.data && now - bonusMem.at < BONUS_TTL_S) {
    return Promise.resolve(bonusMem.data);
  }
  if (bonusMem.wait) return bonusMem.wait;
  bonusMem.wait = api.get('/client/bonus', { token, lang: getLang() }, { auth: false })
    .then((res) => {
      bonusMem.data = res || null;
      bonusMem.at = Math.floor(Date.now() / 1000);
      bonusMem.wait = null;
      return bonusMem.data;
    })
    .catch((e) => {
      bonusMem.wait = null;
      throw e;
    });
  return bonusMem.wait;
}

/** Что уже знаем о бонусах, без запроса. Нужен экрану заказа до первой цены. */
export function bonusKnown() {
  return bonusMem.data;
}

/**
 * Сколько бонусов реально уйдёт в заказ такой суммы. Считает сервер: он один
 * знает и остаток на счету, и долю заказа, которую разрешено закрыть.
 */
export function bonusMaxFor(total, opts = {}) {
  const token = clientToken();
  const sum = Math.max(0, Math.round(Number(total) || 0));
  if (!token || sum <= 0) {
    return Promise.resolve({ enabled: false, balance: 0, max: 0, cap: 0 });
  }
  return api.get('/client/bonus/max', { token, total: sum }, {
    auth: false, signal: opts.signal || null,
  });
}

/** Применить код друга. Возвращает то, что ответил сервер, — вместе с суммой. */
export function applyInviteCode(code) {
  const token = clientToken();
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (!token || clean.length < 4) {
    return Promise.reject(new Error(t('bn.code_ph')));
  }
  return api.post('/client/bonus/invite', { token, code: clean, lang: getLang() }, { auth: false })
    .then((res) => {
      bonusForget();
      return res;
    });
}

/* ─────────────────────────────────────────────────────── любимые адреса */

/* Дом и работа: {home: точка, work: точка}. Точка — тот же объект, что в заказе,
   поэтому её можно положить и в «недавние», и в заготовку нового заказа. */
export function readPlaces() {
  const v = readJson(KEY_PLACES, {});
  return v && typeof v === 'object' ? v : {};
}

function cleanPlace(p) {
  if (!p || p.lat == null || p.lng == null || !p.addr) return null;
  return {
    addr: String(p.addr), subtitle: p.subtitle || '',
    lat: p.lat, lng: p.lng,
    entrance: p.entrance || '', flat: p.flat || '', floor: p.floor || '',
    intercom: p.intercom || '', comment: p.comment || '',
  };
}

/**
 * Отметить адрес домом или работой. Кроме своего списка кладём точку в
 * «недавние»: их читает поиск адреса, и дом оказывается первой строкой
 * подсказок — это и есть «в один тап».
 */
export function setPlace(kind, point) {
  const key = kind === 'work' ? 'work' : 'home';
  const places = readPlaces();
  const clean = cleanPlace(point);
  if (clean) places[key] = clean;
  else delete places[key];
  writeJson(KEY_PLACES, places);
  if (clean) rememberRecent([clean]);
  return places;
}

/** Совпадают ли адрес из истории и отмеченное место: сверяем по координатам. */
function samePlace(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return false;
  return Math.abs(a.lat - b.lat) < 0.0002 && Math.abs(a.lng - b.lng) < 0.0002;
}

/* ─────────────────────────────────────────────────────── списание в заказе */

/* Человек один раз выключил списание — значит, копит. Помним это до конца
   сеанса, иначе каждый пересчёт цены снова включал бы переключатель. */
let wantSpend = true;

/**
 * Переключатель «Списать бонусы» для экрана заказа.
 *
 * Сколько можно списать, знает только сервер: у него и остаток на счету, и
 * доля заказа, которую разрешено закрыть бонусами. Поэтому на каждое изменение
 * цены уходит один короткий запрос, а предыдущий отменяется — иначе ответы
 * обгоняли бы друг друга и на экране оставалась цифра от старой суммы.
 *
 * Возвращает {node, setTotal(тыйыны), value(), refresh(), destroy()}.
 * value() — сколько списать, ровно это число уходит в поле bonus_spend заказа.
 */
export function mountBonusSpend(app, opts = {}) {
  ensureCss();

  const cfg = (app && app.cfg) || {};
  const percent = Math.max(0, Number((cfg.bonus || {}).percent) || 0);
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};

  const state = {
    total: 0, balance: 0, max: 0, cap: 0,
    ready: false,     // сервер уже сказал, сколько можно списать
    pending: false,   // цена поменялась, ответ по новой сумме ещё не пришёл
    live: false,      // есть что показывать: бонусы включены и человек нам знаком
  };

  const title = el('span', { className: 'sg-bonus__title' }, t('bn.spend'));
  const sub = el('span', { className: 'sg-bonus__sub' });
  const warn = el('span', { className: 'sg-bonus__sub sg-bonus__sub--warn', hidden: true });
  const input = el('input', { type: 'checkbox' });
  const sum = el('b');
  const totalRow = el('div', { className: 'sg-bonus__total', hidden: true },
    el('span', null, t('bn.spend_total')), sum);

  const row = el('label', { className: 'sg-bonus__row' },
    el('span', { className: 'sg-bonus__ico', html: icon('gift') }),
    el('span', { className: 'sg-bonus__text' }, title, sub, warn),
    el('span', { className: 'switch' }, input, el('span', { className: 'switch__track' })));

  const node = el('div', { className: 'sg-bonus' }, row, totalRow);
  node.hidden = true;

  let timer = 0;
  let ctrl = null;
  let dead = false;
  let last = -1;             // сумма, по которой уже спросили сервер

  /** Сколько уйдёт в заказ прямо сейчас. Пока ответа по текущей сумме нет —
      ноль: своей арифметике в чужих деньгах тут верить нельзя. */
  function spend() {
    return state.ready && !state.pending && input.checked ? state.max : 0;
  }

  /* Что написано под заголовком. Молча выключенный переключатель — худшее, что
     можно сделать: человек видит бонусы в профиле и не понимает, куда они
     делись. Поэтому у каждого «нельзя» здесь есть своя строка. */
  function paint() {
    node.hidden = !state.live;
    if (!state.live) {
      totalRow.hidden = true;
      return;
    }

    const waiting = state.pending || !state.ready;
    input.disabled = waiting || state.max <= 0;
    // Пока ждём ответ, положение переключателя не трогаем: моргание
    // «выключили — включили» на каждое изменение цены читается как сбой.
    input.checked = waiting ? wantSpend : (wantSpend && state.max > 0);

    const used = spend();
    if (waiting) {
      sub.textContent = t('common.loading');
    } else if (state.balance <= 0) {
      // Бонусов нет — вместо глухого «нельзя» показываем, сколько вернётся.
      const back = percent > 0 ? Math.floor(state.total * percent / 100 / 100) * 100 : 0;
      sub.textContent = back > 0
        ? t('bn.spend_none', { sum: money(back) })
        : t('bn.empty');
    } else if (state.max <= 0) {
      sub.textContent = t('bn.spend_zero');
    } else if (used > 0) {
      sub.textContent = t('bn.spend_on', { sum: money(used) })
        + (state.balance > used ? ' · ' + t('bn.spend_rest', { sum: money(state.balance - used) }) : '');
    } else {
      sub.textContent = t('bn.spend_cap', { sum: money(state.max) }) + ' · ' + t('bn.spend_keep');
    }

    // Бонусов меньше, чем разрешает заказ: списываем что есть и честно говорим,
    // сколько не хватило до потолка. Переключатель при этом остаётся живым.
    const short = !waiting && state.balance > 0 && state.balance < state.cap
      ? state.cap - state.balance : 0;
    warn.hidden = !short;
    if (short) warn.textContent = t('bn.spend_short', { sum: money(short) });

    if (used > 0) {
      sum.textContent = money(Math.max(0, state.total - used));
      totalRow.hidden = false;
    } else {
      totalRow.hidden = true;
    }

    input.setAttribute('aria-label', t('bn.spend') + '. ' + sub.textContent);
  }

  function push() {
    paint();
    if (!dead) onChange(spend());
  }

  async function ask(total) {
    if (ctrl) ctrl.abort();
    ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    try {
      const res = await bonusMaxFor(total, { signal: ctrl ? ctrl.signal : null });
      if (dead || total !== state.total) return;
      state.balance = Math.max(0, Number(res.balance) || 0);
      state.max = Math.max(0, Number(res.max) || 0);
      state.cap = Math.max(0, Number(res.cap) || 0);
      state.live = res.enabled !== false && bonusOn(cfg);
      state.ready = true;
      state.pending = false;
      push();
    } catch (e) {
      if (dead || (e && e.code === 'aborted')) return;
      // Не спросили — значит, ничего не списываем. Переключатель гаснет, но с
      // объяснением: связь вернётся — цифра приедет со следующим пересчётом.
      state.ready = false;
      state.pending = false;
      state.max = 0;
      last = -1;
      push();
    }
  }

  input.addEventListener('change', () => {
    wantSpend = input.checked;
    haptic();
    push();
  });

  /** Новая сумма заказа. Ноль прячет переключатель: списывать не из чего. */
  function setTotal(total) {
    const value = Math.max(0, Math.round(Number(total) || 0));
    if (value === state.total) return;
    state.total = value;
    clearTimeout(timer);

    if (!clientToken() || !bonusOn(cfg) || value <= 0) {
      state.live = false;
      state.ready = false;
      state.pending = false;
      push();
      return;
    }
    state.live = true;

    // Эту сумму сервер уже посчитал — ответ у нас на руках, спрашивать нечего.
    if (value === last && state.ready) {
      state.pending = false;
      push();
      return;
    }

    // Цена пересчитывается на каждое касание счётчика — ждём, пока человек
    // закончит, и только потом идём на сервер.
    state.pending = true;
    timer = setTimeout(() => {
      if (dead || value !== state.total) return;
      last = value;
      ask(value);
    }, 260);
    push();
  }

  paint();

  return {
    node,
    setTotal,
    value: spend,
    /** Пересчитать заново: баланс мог измениться, пока человек собирал заказ. */
    refresh() {
      last = -1;
      if (state.total <= 0) return;
      state.pending = true;
      paint();
      ask(state.total);
    },
    destroy() {
      dead = true;
      clearTimeout(timer);
      if (ctrl) ctrl.abort();
      node.remove();
    },
  };
}

/* ─────────────────────────────────────────────────────── кнопка профиля */

let profileBtn = null;

/* Кружок справа сверху. У нового человека его нет: показывать пустой профиль
   тому, кто зашёл впервые, — только пугать лишней кнопкой. */
function makeProfileButton(onOpen) {
  // Если кнопка уже стоит в разметке — берём её, а не заводим вторую такую же.
  const ready = document.getElementById('profile-btn');
  if (ready) {
    ready.addEventListener('click', () => { haptic(); onOpen(); });
    ready.hidden = true;
    return ready;
  }

  const btn = el('button', {
    type: 'button',
    id: 'profile-btn',
    className: 'avatar no-sel sg-profile',
    // Своих правил в client.css у кнопки нет — её правит другой модуль, поэтому
    // размер и тень задаём здесь: 44 px под палец и та же подложка, что у языка.
    style: {
      width: '44px', height: '44px', fontSize: '16px',
      background: 'var(--surface)', boxShadow: 'var(--shadow-2)', cursor: 'pointer',
    },
    onClick: () => { haptic(); onOpen(); },
  });
  btn.hidden = true;

  const lang = document.getElementById('lang-switch');
  const top = document.querySelector('.sg-top');
  if (lang && lang.parentNode) {
    // Язык и профиль встают одной связкой: в шапке space-between, и три
    // самостоятельных ребёнка расползлись бы по углам.
    const side = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' },
    });
    lang.parentNode.insertBefore(side, lang);
    side.appendChild(lang);
    side.appendChild(btn);
  } else if (top) {
    top.appendChild(btn);
  } else {
    document.body.appendChild(btn);
  }
  return btn;
}

function paintProfileButton() {
  if (!profileBtn) return;
  const me = readClient();
  const known = !!(me.phone || me.token);
  profileBtn.hidden = !known;
  if (!known) return;
  const label = me.name ? t('common.profile') + ': ' + me.name : t('common.profile');
  profileBtn.setAttribute('aria-label', label);
  profileBtn.title = label;
  if (me.photo) {
    profileBtn.replaceChildren(el('img', { src: me.photo, alt: '' }));
  } else {
    const short = initials(me.name);
    profileBtn.replaceChildren(short
      ? document.createTextNode(short)
      : iconNode('user', 22));
  }
}

/* ─────────────────────────────────────────────────────── кирпичики профиля */

function group(title) {
  return el('div', { className: 'sg-group' }, title);
}

/** Строка «название — значение», как в разбивке цены. */
function sumRow(name, value, total) {
  return el('div', { className: 'sg-sum' + (total ? ' sg-sum--total' : '') },
    el('span', { className: 'sg-sum__name' }, name),
    el('span', { className: 'sg-sum__val' }, value));
}

/* Поле с плавающей меткой: метка идёт после поля, её поднимает соседний
   селектор в components.css — без единой строчки скрипта. */
function textField(label, value, opts = {}) {
  const input = el('input', {
    className: 'field__input',
    type: opts.type || 'text',
    placeholder: ' ',
    value: value || '',
    autocomplete: opts.autocomplete || 'off',
    enterkeyhint: 'done',
    maxLength: opts.maxLength || 80,
    disabled: !!opts.disabled,
  });
  const node = el('label', { className: 'field' },
    input,
    el('span', { className: 'field__label' }, label),
    opts.hint ? el('span', { className: 'field__hint' }, opts.hint) : null);
  return { node, input };
}

/** Приписка к адресу: подъезд, квартира, этаж — то, что человек уточнил сам. */
function pointNote(p) {
  const parts = [];
  if (p.entrance) parts.push(t('order.entrance') + ' ' + p.entrance);
  if (p.flat) parts.push(t('order.flat') + ' ' + p.flat);
  if (p.floor) parts.push(t('order.floor') + ' ' + p.floor);
  if (p.comment) parts.push(p.comment);
  return parts.join(', ');
}

/* Карточка заказа в списке: маршрут двумя строками, под ним статус с датой,
   справа сумма. Всё, по чему человек узнаёт свою поездку. */
function historyRow(item, onOpen) {
  const pts = Array.isArray(item.points) ? item.points : [];
  const from = item.from || (pts[0] && pts[0].addr) || t('order.from');
  const last = pts.length > 1 ? pts[pts.length - 1] : null;
  const to = item.to || (last && last.addr) || '';
  const meta = el('span', { className: 'row wrap gap-2', style: { paddingTop: '4px' } },
    statusBadge(item),
    el('span', { className: 'sg-opt__sub' }, dateTime(item.at || item.created_at)),
    item.rating
      ? el('span', { className: 'sg-opt__sub t-accent' }, '★ ' + rate(item.rating))
      : null);

  return el('button', {
    type: 'button', className: 'sg-opt',
    onClick: () => { haptic(); onOpen(item); },
  },
    el('span', { className: 'sg-route__line' }, el('i'), el('b'), el('i')),
    el('span', { className: 'sg-opt__text' },
      el('span', { className: 'sg-route__row' }, from),
      to ? el('span', { className: 'sg-route__row' }, to) : null,
      meta),
    el('span', { className: 'sg-opt__total' }, money(item.price_total || 0)));
}

/** Одна строка движения бонусов: плюс начислили, минус потратили. */
function bonusMove(item) {
  const amount = Number(item.amount) || 0;
  const plus = amount > 0;
  return el('div', { className: 'sg-item' },
    el('span', {
      className: 'sg-item__icon' + (plus ? ' sg-item__icon--accent' : ''),
      html: icon(plus ? 'plus' : 'minus'),
    }),
    el('span', { className: 'sg-item__text' },
      el('span', { className: 'sg-item__title' }, item.text || ''),
      el('span', { className: 'sg-item__sub' }, dateTime(item.at))),
    el('span', {
      className: 'sg-opt__total' + (plus ? ' t-accent' : ''),
    }, (plus ? '+' : '−') + money(Math.abs(amount))));
}

/* Настройки плиток из /config. Пустые значения не подставляем совсем:
   Object.assign внутри createMap перекрыл бы ими её собственные умолчания,
   и вместо карты остался бы серый квадрат. Подпись — исключение: пустую
   строку админ ставит нарочно, и заменять её чужой нельзя. */
function mapTiles(cfg) {
  const out = { attribution: cfg.attribution || '' };
  if (cfg.tiles_light) out.tilesLight = cfg.tiles_light;
  if (cfg.tiles_dark) out.tilesDark = cfg.tiles_dark;
  if (cfg.max_zoom) out.maxZoom = +cfg.max_zoom;
  return out;
}

/* Маленькая карта в карточке заказа: пальцем не двигается, только показывает,
   куда ездили. Живёт вместе с видом и уничтожается вместе с ним. */
function miniMap(app, coords, line) {
  const box = el('div', { className: 'sg-me__map' });
  const cfg = (app.cfg && app.cfg.map) || {};
  const map = createMap(box, Object.assign({
    center: coords[0] || cfg.center || [42.8746, 74.5698],
    zoom: cfg.zoom || 13,
    theme: isLightNow() ? 'light' : 'dark',
    interactive: false,
    controls: false,
    locate: false,
  }, mapTiles(cfg)));
  const start = line && line.length > 1 ? line : coords;
  let drawn = start.length > 1 ? map.route(start, { width: 5 }) : null;
  coords.forEach((ll, i) => map.marker({
    at: ll,
    html: i === 0 ? pin('a') : pin('b', coords.length > 2 ? String(i + 1) : ''),
    anchor: i === 0 ? 'center' : 'bottom',
    zIndex: 10 + i,
  }));

  function fit(path) {
    map.fitPoints(path, {
      padding: { top: 26, right: 26, bottom: 26, left: 26 },
      maxZoom: 16, animate: false,
    });
  }
  fit(start);

  return {
    node: box,
    /* Настоящая линия дороги приходит вместе с полным заказом — до неё рисуем
       прямую между точками, чтобы карта не стояла пустой. */
    setRoute(path) {
      if (drawn) drawn.setCoords(path);
      else drawn = map.route(path, { width: 5 });
      fit(path);
    },
    destroy() { map.destroy(); },
  };
}

/* ─────────────────────────────────────────────────────── живое движение

   Три приёма, которые делают профиль приятным на ощупь, и ни один из них не
   заставляет ждать: всё гаснет само, когда человек просил меньше движения —
   длительности мы берём из токенов, а там в этом режиме стоит 1 мс. */

/**
 * Число добегает до нового значения. Возвращает «остановить».
 *
 * onValue зовётся на каждом кадре: туда кладут «сколько показано сейчас», и
 * если раздел пересоберётся на полпути, добег продолжится с того же места,
 * а не начнётся сначала.
 *
 * grain — с каким шагом считать по дороге. Для денег это сто тыйынов: бегущие
 * копейки читаются как сбой, а не как начисление. В конце показываем ровно то,
 * что просили, — на цифру без округления человек и смотрит.
 */
function countUp(node, from, to, render, onValue, grain) {
  const time = dur('--dur-4', 560);
  const a = Math.round(Number(from) || 0);
  const b = Math.round(Number(to) || 0);
  const step = Math.max(1, Math.round(Number(grain) || 1));
  const show = (v) => {
    node.textContent = render(v);
    if (onValue) onValue(v);
  };
  if (time <= 20 || a === b) {
    show(b);
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now();
  const frame = (now) => {
    const k = Math.min(1, (now - t0) / time);
    // Кубическое замедление: цифра стартует резво и мягко садится на место.
    const eased = 1 - Math.pow(1 - k, 3);
    show(k < 1 ? Math.round((a + (b - a) * eased) / step) * step : b);
    raf = k < 1 ? requestAnimationFrame(frame) : 0;
  };
  show(a);
  raf = requestAnimationFrame(frame);
  return () => { if (raf) cancelAnimationFrame(raf); };
}

const fadeJobs = new WeakMap();

/**
 * Короткое растворение на месте: текст гаснет, меняется и проявляется обратно.
 * Нужно при смене языка — мгновенная подмена всех надписей читается как сбой,
 * а полноценный переезд был бы враньём: экран-то тот же самый.
 */
function fadeSwap(target, apply) {
  const nodes = (Array.isArray(target) ? target : [target]).filter(Boolean);
  const time = Math.round(dur('--dur-1', 140) * 0.8);
  if (!nodes.length || time <= 20) {
    apply();
    return;
  }
  for (const node of nodes) {
    const job = fadeJobs.get(node);
    if (job) clearTimeout(job);
    node.style.transition = 'opacity ' + time + 'ms var(--ease-in)';
    node.style.opacity = '0';
  }
  const back = setTimeout(() => {
    apply();
    for (const node of nodes) {
      node.style.transition = 'opacity ' + time + 'ms var(--ease)';
      node.style.opacity = '';
      const done = setTimeout(() => {
        node.style.transition = '';
        fadeJobs.delete(node);
      }, time + 40);
      fadeJobs.set(node, done);
    }
  }, time);
  for (const node of nodes) fadeJobs.set(node, back);
}

/**
 * Сцена, по которой ездят разделы. Новый раздел въезжает сбоку, старый уходит
 * в ту же сторону и ложится абсолютом — в потоке его больше нет, поэтому
 * высоту на время переезда держит сама сцена, иначе шторка успела бы
 * схлопнуться до нуля и прыгнуть обратно.
 *
 * scroller — прокручиваемый ящик шторки: при смене раздела он возвращается
 * наверх, а при перерисовке на месте остаётся там, где стоял.
 */
function createStage(scroller) {
  const node = el('div', { className: 'sg-stage' });
  let current = null;
  let timer = 0;
  let leaving = [];

  function clean() {
    for (const gone of leaving) gone.remove();
    leaving = [];
    node.style.minHeight = '';
  }

  /** Новый раздел с переездом. back — движение в обратную сторону. */
  function show(next, back) {
    next.classList.add('sg-view');
    const old = current;
    current = next;
    clearTimeout(timer);
    clean();

    if (!old) {
      node.replaceChildren(next);
      return next;
    }

    const h0 = node.offsetHeight;
    node.style.minHeight = h0 + 'px';
    old.classList.add('sg-view--out');
    if (back) old.classList.add('sg-view--back-out');
    next.classList.add('sg-view--enter');
    if (back) next.classList.add('sg-view--back');
    node.appendChild(next);

    const h1 = next.offsetHeight;          // заодно и есть тот самый пересчёт вёрстки
    node.style.minHeight = h1 + 'px';
    requestAnimationFrame(() => next.classList.remove('sg-view--enter', 'sg-view--back'));

    leaving.push(old);
    timer = setTimeout(clean, dur('--dur-2', 240) + 80);
    if (scroller) scroller.scrollTop = 0;
    return next;
  }

  /** Тот же раздел, собранный заново: данные пришли или сменился язык. */
  function swap(next) {
    next.classList.add('sg-view');
    clearTimeout(timer);
    clean();
    current = next;
    node.replaceChildren(next);
    return next;
  }

  return { node, show, swap, current: () => current };
}

/* ─────────────────────────────────────────────────────── шторка профиля */

/* Разделы профиля. overlay — то, что видно в адресе (#/~profile:bonus), по нему
   человек возвращается в тот же раздел после перезагрузки. depth нужен только
   для направления переезда: вглубь вправо, обратно влево. */
const ME_SECTIONS = {
  hub: { overlay: 'profile', depth: 0, title: () => t('common.profile') },
  orders: { overlay: 'profile:orders', depth: 1, title: () => t('order.my_orders') },
  bonus: { overlay: 'profile:bonus', depth: 1, title: () => t('bn.title') },
  places: { overlay: 'profile:places', depth: 1, title: () => t('me.places') },
  settings: { overlay: 'profile:settings', depth: 1, title: () => t('common.settings') },
  order: { overlay: 'profile:order', depth: 2, title: () => t('me.details') },
};

/* Куда ведёт кнопка «назад» из раздела. */
const ME_PARENT = {
  orders: 'hub', bonus: 'hub', places: 'hub', settings: 'hub', order: 'orders',
};

/** Раздел по имени наложения из адреса. Незнакомое имя — это корень профиля. */
function meSection(overlay) {
  const raw = String(overlay || '');
  if (raw !== 'profile' && raw.indexOf('profile:') !== 0) return '';
  const tail = raw.slice('profile'.length).replace(/^:/, '');
  return Object.prototype.hasOwnProperty.call(ME_SECTIONS, tail) ? tail : 'hub';
}

/**
 * Профиль целиком: шапка, плитки разделов, заказы, бонусы, адреса, настройки.
 *
 * Открывается во весь экран и разложен по полочкам: разделы переключают, а не
 * прокручивают — каждый помещается в экран, и до настроек больше не нужно
 * пролистывать всю историю заказов.
 *
 * Открытый раздел живёт в адресе, поэтому перезагрузка возвращает человека
 * ровно туда, где он был. Меняем адрес заменой записи, а не добавлением: иначе
 * «назад» пришлось бы жать столько раз, сколько разделов человек успел открыть,
 * а одного нажатия должно хватать, чтобы выйти из профиля на карту.
 *
 * Возвращает {apply(section), close(fromRouter), section()} — этим управляет
 * оболочка, когда адрес меняется.
 */
function openProfileSheet(app, startWith, onGone) {
  ensureCss();

  /* Состояние живёт рядом со шторкой, а не внутри раздела: разделы собираются
     заново на смене языка и после сохранения имени, а уже загруженные страницы
     истории при этом должны остаться на месте. */
  const state = {
    profile: null,
    loading: true,
    error: null,
    items: [],
    page: 0,
    total: 0,
    more: true,
    listing: false,
    listError: null,
    card: null,           // открытый заказ: {item, order}
    bonus: bonusKnown(),  // весь бонусный счёт
    bonusLoading: false,
    bonusError: null,
    /* С какого числа бонусов начинать добег. Память своя у плитки в корне и у
       крупного счёта в разделе: каждое место показывает своё прошлое значение,
       и цифра добегает и при первом появлении, и потом — при начислении. */
    shownTile: 0,
    shownBig: 0,
  };

  let alive = true;
  let byRouter = false;   // закрывает оболочка, потому что наложение ушло из адреса
  let view = ME_SECTIONS[startWith] ? startWith : 'hub';
  let current = null;     // {node, destroy?, apply?}
  let stopCount = null;   // остановить добег числа, если раздел ушёл раньше
  let child = null;       // экран поверх профиля: все движения бонусов
  const shown = new Set();  // заказы, которые уже въезжали строкой
  let fresh = 0;            // сколько строк анимируем в этой сборке

  if (view === 'order') view = 'orders';   // карточку из адреса не восстановить

  const stage = createStage(null);

  const ui = sheet({
    full: true,
    className: 'sg-me',
    title: ME_SECTIONS[view].title(),
    content: stage.node,
    onClose: () => {
      alive = false;
      offLang();
      offTheme();
      drop();
      // Экран поверх профиля закрываем вместе с ним: системная «назад» знает
      // только про наложение в адресе, и брошенный поверх пустоты список
      // движений остался бы висеть сам по себе.
      if (child) {
        const gone = child;
        child = null;
        gone.close();
      }
      if (typeof onGone === 'function') onGone();
      // Закрыли крестиком, смахиванием или Esc — адрес обязан догнать, иначе
      // перезагрузка снова откроет профиль поверх карты.
      if (!byRouter && app.router) app.router.closeOverlay();
    },
  });

  const head = ui.box.querySelector('.sheet__head');
  const titleNode = ui.box.querySelector('.sheet__title');
  const backBtn = iconBtn('back', 'sg-back', t('common.back'), () => {
    haptic();
    nav(ME_PARENT[view] || 'hub');
  });
  if (head && titleNode) head.insertBefore(backBtn, titleNode);

  /* Язык переключают прямо здесь, в настройках, поэтому профиль обязан
     переодеться сам — и не рывком, а короткой растворяющейся сменой. */
  const offLang = onLangChange(() => {
    if (!alive) return;
    fadeSwap([titleNode, ui.body], () => {
      paintHead();
      repaint();
    });
    // Строки истории бонусов («Кэшбек с заказа», «Пригласили Азамата») собирает
    // сервер, и на новом языке за ними надо сходить заново.
    if (state.bonus && clientToken()) loadBonusState(true);
  });

  // Тему меняют в настройках, а мини-карта в карточке заказа нарисована в
  // старой — только её и пересобираем, остальным разделам это безразлично.
  const offTheme = onThemeChange(() => {
    if (alive && view === 'order') repaint();
  });

  function drop() {
    if (stopCount) { stopCount(); stopCount = null; }
    if (current && typeof current.destroy === 'function') current.destroy();
    current = null;
  }

  const BUILD = {
    hub: buildHub,
    orders: buildOrders,
    order: buildCard,
    bonus: buildBonus,
    places: buildPlaces,
    settings: buildSettings,
  };

  function paintHead() {
    const at = ME_SECTIONS[view];
    titleNode.textContent = at.title();
    backBtn.hidden = !ME_PARENT[view];
    backBtn.setAttribute('aria-label', t('common.back'));
    backBtn.title = t('common.back');
    ui.box.setAttribute('aria-label', at.title());
  }

  /** Раздел с переездом. Направление считаем по глубине: вглубь или обратно. */
  function render(next, back) {
    if (!alive) return;
    view = next;
    fresh = 0;
    paintHead();
    drop();
    current = BUILD[view]();
    stage.show(current.node, back);
    ui.body.scrollTop = 0;
  }

  /** Тот же раздел заново, без переезда: пришли данные или сменился язык. */
  function repaint() {
    if (!alive || !current) return;
    const top = ui.body.scrollTop;
    fresh = 0;
    // Гасим прежний раздел до сборки нового: иначе его destroy остановил бы
    // добег числа, который новый раздел только что запустил.
    drop();
    current = BUILD[view]();
    stage.swap(current.node);
    ui.body.scrollTop = top;
  }

  /* Переход внутри профиля идёт через адрес: так открытый раздел переживает
     перезагрузку. Роутер тут же позовёт нас обратно через onOverlay, поэтому
     рисовать здесь ничего не нужно. Без роутера (такого быть не должно, но
     проверка дешёвая) рисуем сами. */
  function nav(next) {
    const name = ME_SECTIONS[next] ? next : 'hub';
    if (name === view) return;
    const router = app.router;
    if (!router) {
      render(name, ME_SECTIONS[name].depth < ME_SECTIONS[view].depth);
      return;
    }
    router.overlay(ME_SECTIONS[name].overlay, { replace: true });
  }

  /* Уйти собирать новый заказ. Сначала убираем профиль из адреса и только
     потом просим заказ: иначе роутер сочтёт это сменой одного наложения на
     другое, экран заказа не пересоберётся и заготовку никто не заберёт. */
  function startOrder(next) {
    if (app.router) app.router.closeOverlay({ replace: true });
    app.startOrder(next);
  }

  /** Уйти из профиля на экран сервиса: адрес профиля заменяем, а не копим. */
  function leave(path, query) {
    if (app.router) app.router.go(path, { query, replace: true });
    else app.go(path, query);
  }

  /** Строка списка въезжает один раз — при первом появлении, а не на каждой
      перерисовке: мигающий на ровном месте список выглядит как сбой. */
  function riseOnce(node, key) {
    if (shown.has(key)) return node;
    shown.add(key);
    node.classList.add('sg-rise');
    node.style.animationDelay = Math.min(fresh++, 9) * 26 + 'ms';
    return node;
  }

  /* ── данные ──────────────────────────────────────────────────────────── */

  async function loadProfile() {
    state.loading = true;
    state.error = null;
    try {
      const token = clientToken() || await ensureClientToken();
      if (!token) {
        state.profile = null;
      } else {
        state.profile = await api.get('/client/profile', { token }, { auth: false });
        // Сервер помнит имя точнее нас: оно переживает смену устройства.
        if (state.profile.name) saveClient({ name: state.profile.name });
      }
    } catch (e) {
      state.error = e;
    }
    state.loading = false;
    if (!alive) return;
    // Карточку заказа не трогаем: в ней живая карта, а счётчики профиля к ней
    // отношения не имеют — пересборка только моргнула бы картой.
    if (view !== 'order') repaint();
    // Ключ мог приехать только что — тогда список ждал именно его.
    if (view === 'orders') loadFirstPage();
  }

  async function loadPage(page) {
    const token = clientToken();
    if (!token || state.listing) return;
    state.listing = true;
    state.listError = null;
    if (view === 'orders') repaint();
    try {
      const res = await api.get('/client/orders',
        { token, page, per_page: HISTORY_PAGE }, { auth: false });
      const items = Array.isArray(res.items) ? res.items : [];
      // Страницу могли догрузить дважды подряд — повторы отсекаем по номеру.
      const seen = new Set(state.items.map((x) => x.public_id));
      state.items = state.items.concat(items.filter((x) => x && !seen.has(x.public_id)));
      state.page = res.page || page;
      state.total = res.total || state.items.length;
      state.more = !!res.has_more;
    } catch (e) {
      state.listError = e;
    }
    state.listing = false;
    if (alive && view === 'orders') repaint();
  }

  function loadFirstPage() {
    if (state.items.length || state.listing) return;
    loadPage(1);
  }

  function loadMore() {
    if (!state.more || state.listing || state.listError) return;
    loadPage(state.page + 1);
  }

  /* Полный заказ ради разбивки цены и линии маршрута: в списке их нет, а
     показывать «из чего цена» по одной итоговой сумме нечестно. */
  async function loadCard(item) {
    if (!item.track_token) return;
    try {
      const order = await api.get('/orders/' + encodeURIComponent(item.public_id),
        { t: item.track_token }, { auth: false });
      if (!alive || !state.card || state.card.item.public_id !== item.public_id) return;
      state.card.order = order;
      if (view !== 'order') return;
      if (current && typeof current.apply === 'function') current.apply(order);
      else repaint();
    } catch (e) {
      /* не пришло — карточка и без разбивки полная, шуметь не о чем */
    }
  }

  /* Бонусный счёт. Тянем при каждом открытии раздела: сервер по дороге
     доначисляет кэшбек по закрытым заказам, и показать вчерашний баланс
     было бы обидно. */
  async function loadBonusState(force) {
    if (state.bonusLoading || !clientToken()) return;
    state.bonusLoading = true;
    state.bonusError = null;
    // Пересобираем только если показывать пока нечего: иначе счёт моргнул бы
    // скелетом на ровном месте, да ещё и сбил добег числа.
    if (view === 'bonus' && !state.bonus) repaint();
    try {
      state.bonus = await loadBonus(force !== false);
    } catch (e) {
      state.bonusError = e;
    }
    state.bonusLoading = false;
    // Баланс виден в двух местах: крупно в разделе и цифрой на плитке в корне.
    if (alive && (view === 'bonus' || view === 'hub')) repaint();
  }

  /* ── корень профиля ──────────────────────────────────────────────────── */

  /** Крупная плитка раздела: значок, название, одна цифра по делу. */
  function tile(o) {
    const value = el('span', { className: 'sg-tile__val' });
    if (o.value instanceof Node) value.appendChild(o.value);
    else value.textContent = o.value === undefined || o.value === null ? '' : String(o.value);

    const node = el('button', {
      type: 'button',
      className: 'sg-tile' + (o.accent ? ' sg-tile--accent' : ''),
      onClick: () => { haptic(); nav(o.to); },
    },
      el('span', { className: 'sg-tile__ico', html: icon(o.icon) }),
      el('span', { className: 'sg-tile__name' }, o.name),
      value);
    // Плитка большая, и проседать ей положено заметнее строки списка.
    pressable(node, { scale: 0.955, pop: 1.03 });
    return { node, value };
  }

  /** Пока счётчики не приехали, вместо цифры стоит серая полоска. */
  function waitBar() {
    return el('span', {
      className: 'skeleton',
      style: { display: 'block', width: '54px', height: '16px' },
    });
  }

  function buildHub() {
    const me = readClient();
    const p = state.profile;
    const node = el('div', { className: 'sg-me__wrap' });

    // ── шапка: лицо, имя, телефон. Нажатие ведёт в настройки — имя правят там.
    const face = me.photo
      ? el('span', { className: 'avatar avatar--lg' }, el('img', { src: me.photo, alt: '' }))
      : el('span', { className: 'avatar avatar--lg avatar--accent' },
        initials(me.name) || iconNode('user', 30));

    // Третья строка шапки: оценка и с какого дня человек с нами. Обе цифры
    // необязательные, поэтому собираем из того, что пришло.
    const meta = [];
    if (p && p.rating) meta.push('★ ' + rate(p.rating));
    if (p && p.created_at) meta.push(t('me.since', { date: fmtDate(p.created_at) }));

    const card = el('button', {
      type: 'button', className: 'sg-me__card',
      'aria-label': t('common.settings'),
      onClick: () => { haptic(); nav('settings'); },
    },
      face,
      el('span', { className: 'sg-me__who' },
        el('span', { className: 'sg-me__name' }, me.name || t('me.noname')),
        el('span', { className: 'sg-me__phone' },
          me.phone ? fmtPhone(me.phone) : t('me.no_phone')),
        meta.length ? el('span', { className: 'sg-me__since' }, meta.join(' · ')) : null),
      el('span', { className: 'sg-opt__go', html: icon('go') }));
    pressable(card, { scale: 0.985, pop: 1.008 });
    node.appendChild(card);

    // ── человек нам ещё незнаком: объясняем это словами, а не пустыми плитками
    if (!state.loading && !clientToken() && !state.error) {
      node.appendChild(el('p', { className: 'sheet__text' }, t('me.unknown')));
    }
    if (state.error) {
      node.appendChild(el('div', { className: 'sg-fail' },
        el('div', { className: 'sg-fail__text' }, errText(state.error)),
        el('button', {
          type: 'button', className: 'btn btn--ghost', onClick: loadProfile,
        }, t('common.retry'))));
    }

    // ── заказ, который едет прямо сейчас: важнее всего остального на экране
    const live = (p && Array.isArray(p.active) ? p.active : [])[0];
    if (live && live.track_token) {
      node.appendChild(rowGroup([{
        icon: icon('car'),
        label: t('me.live_now'),
        sub: statusName(live) + ' · ' + t('me.card', { id: live.public_id }),
        className: 'sg-me__live',
        onClick: () => leave('/order/' + live.public_id, { t: live.track_token }),
      }]));
    }

    // ── четыре полки, между которыми и разложен весь профиль
    const balance = state.bonus ? Math.max(0, Number(state.bonus.balance) || 0) : 0;
    const places = readPlaces();
    const marked = ['home', 'work'].filter((k) => places[k]);

    const known = !!clientToken();
    const tiles = [tile({
      to: 'orders', icon: 'list', name: t('me.hub_orders'),
      value: !known ? '—' : (state.loading && !p ? waitBar() : String((p && p.orders_count) || 0)),
    }).node];

    if (bonusOn(app.cfg)) {
      const gift = tile({
        to: 'bonus', icon: 'gift', name: t('bn.title'), accent: true,
        value: !known ? '—' : (state.bonus ? '' : waitBar()),
      });
      if (known && state.bonus) {
        // Начисленные бонусы приятнее увидеть, чем застать: цифра добегает.
        stopCount = countUp(gift.value, state.shownTile, balance, money,
          (v) => { state.shownTile = v; }, 100);
      }
      tiles.push(gift.node);
    }

    tiles.push(tile({
      to: 'places', icon: 'home', name: t('me.places'),
      value: marked.length
        ? marked.map((k) => t('fav.' + k)).join(' · ')
        : t('me.places_none'),
    }).node);

    tiles.push(tile({
      to: 'settings', icon: 'gear', name: t('common.settings'),
      value: t('common.lang_' + getLang()),
    }).node);

    node.appendChild(el('div', { className: 'sg-tiles' }, tiles));

    // ── поддержка: два способа дозвониться, оба в одной карточке
    const rows = supportRows();
    if (rows.length) node.appendChild(rowGroup(rows));

    return { node };
  }

  /** Строки «написать» и «позвонить» — их место и в корне, и в настройках. */
  function supportRows() {
    const p = state.profile;
    const wa = String((p && p.support_wa)
      || (app.cfg.service && app.cfg.service.support_wa) || '').replace(/\D/g, '');
    const line = String((p && p.support_phone)
      || (app.cfg.service && app.cfg.service.phone) || '').replace(/[^\d+]/g, '');
    const rows = [];
    if (wa) {
      rows.push({
        icon: icon('wa'),
        label: t('common.whatsapp'),
        href: 'https://wa.me/' + wa + '?text=' + encodeURIComponent(t('me.wa_hello')),
        chevron: true,
      });
    }
    if (line) {
      rows.push({
        icon: icon('phone'),
        label: t('me.support_call'),
        sub: fmtPhone(line),
        href: 'tel:' + line,
        chevron: true,
      });
    }
    return rows;
  }

  /* ── заказы ──────────────────────────────────────────────────────────── */

  function buildOrders() {
    const node = el('div', { className: 'sg-me__wrap' });

    if (!clientToken()) {
      node.appendChild(el('p', { className: 'sheet__text' }, t('me.unknown')));
      return { node };
    }

    // Три цифры одной строкой: сколько заказов, сколько доехало, сколько денег.
    // Тому, кто ещё не ездил, три нуля ничего не расскажут — их и не показываем.
    const p = state.profile;
    if (p && p.orders_count) {
      node.appendChild(el('div', { className: 'sg-stats' },
        statCell(t('me.orders'), String(p.orders_count || 0)),
        statCell(t('me.done'), String(p.orders_done || 0)),
        // В третью ячейку длинная сумма не влезает — здесь у денег короткая форма.
        p.spent ? statCell(t('me.spent'), moneyShort(p.spent)) : null));
    }

    const rows = el('div', { className: 'sg-me__rows' });
    for (const item of state.items) {
      rows.appendChild(riseOnce(historyRow(item, openCard), item.public_id));
    }
    if (state.items.length) node.appendChild(rows);

    if (state.listing) {
      const box = el('div', { style: { padding: 'var(--sp-4) 0' } });
      skeleton(box, state.items.length ? 2 : 4);
      node.appendChild(box);
    } else if (state.listError) {
      node.appendChild(el('div', { className: 'sg-fail' },
        el('div', { className: 'sg-fail__text' }, errText(state.listError)),
        el('button', {
          type: 'button', className: 'btn btn--ghost',
          onClick: () => { state.listError = null; loadPage(state.page + 1); },
        }, t('common.retry'))));
    } else if (!state.items.length) {
      node.appendChild(el('div', { className: 'empty' },
        el('div', { className: 'empty__icon', html: icon('list') }),
        el('div', { className: 'empty__title' }, t('me.empty_title')),
        el('div', { className: 'empty__text' }, t('me.empty_text')),
        el('button', {
          type: 'button', className: 'btn btn--primary btn--lg',
          onClick: () => leave('/'),
        }, t('order.submit'))));
    } else if (state.more) {
      // Прокрутка догружает сама, но кнопка нужна: мышью до низа доезжают не все,
      // да и на длинном списке видно, что дальше ещё есть — и сколько именно.
      const rest = Math.max(0, state.total - state.items.length);
      node.appendChild(el('button', {
        type: 'button', className: 'btn btn--ghost btn--lg btn--block', onClick: loadMore,
      }, rest ? t('me.load_more') + ' · ' + tp(rest, 'common.n_order') : t('me.load_more')));
    }

    function onScroll() {
      if (!alive || state.listing || !state.more || state.listError) return;
      const box = ui.body;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - NEAR_BOTTOM) loadMore();
    }
    ui.body.addEventListener('scroll', onScroll, { passive: true });

    return {
      node,
      destroy() { ui.body.removeEventListener('scroll', onScroll); },
    };
  }

  function statCell(name, value) {
    return el('div', { className: 'sg-stat' },
      el('span', { className: 'sg-stat__val' }, value),
      el('span', { className: 'sg-stat__name' }, name));
  }

  function openCard(item) {
    state.card = { item, order: null };
    nav('order');
    loadCard(item);
  }

  /* ── карточка одного заказа ──────────────────────────────────────────── */

  /* Две кнопки под адресом: «сделать домом» и «сделать работой». Нажатая
     подсвечена — повторный тап снимает отметку, чтобы не искать её в другом
     месте. Перерисовываем только эту строку: карта в карточке моргать не должна. */
  function markRow(point, whole) {
    const box = el('div', { className: 'sg-mark' });

    function paint() {
      const places = readPlaces();
      box.replaceChildren(...['home', 'work'].map((kind) => {
        const on = samePlace(places[kind], point);
        return el('button', {
          type: 'button',
          className: 'sg-mark__b' + (on ? ' is-on' : ''),
          'aria-pressed': on ? 'true' : 'false',
          onClick: () => {
            haptic();
            if (on) {
              setPlace(kind, null);
              toast(t('fav.dropped'), { type: 'ok' });
            } else {
              setPlace(kind, point);
              toast(t(kind === 'home' ? 'fav.saved_home' : 'fav.saved_work'), { type: 'ok' });
            }
            // В разделе «Адреса» отмеченный адрес переезжает из недавних наверх,
            // поэтому там пересобираем всё; в карточке заказа — только строку,
            // иначе моргнула бы карта.
            if (whole) repaint();
            else paint();
          },
        }, svgIcon(kind),
        t(on ? 'fav.' + kind : (kind === 'home' ? 'fav.set_home' : 'fav.set_work')));
      }));
    }
    paint();
    return box;
  }

  function buildCard() {
    const node = el('div', { className: 'sg-me__wrap' });
    if (!state.card) {
      node.appendChild(el('p', { className: 'sheet__text' }, t('me.empty_text')));
      return { node };
    }
    const { item } = state.card;

    const pts = (Array.isArray(item.points) ? item.points : []).filter((p) => p && p.addr);
    const coords = pts.filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat, p.lng]);
    const order = state.card.order;
    const line = order && Array.isArray(order.route) ? order.route : null;

    let map = null;
    if (coords.length) {
      map = miniMap(app, coords, line);
      node.appendChild(map.node);
    }

    node.appendChild(el('div', { className: 'row wrap gap-2' },
      statusBadge(item),
      el('span', { className: 'sg-opt__sub' }, dateTime(item.at || item.created_at)),
      el('span', { className: 'sg-opt__sub' }, t('me.card', { id: item.public_id }))));

    // ── адреса. Под каждым — две отметки: дом и работа. Один тап, и адрес
    // встаёт в начало подсказок, а поездка между домом и работой собирается
    // из раздела «Адреса» одной кнопкой.
    node.appendChild(group(t('me.points')));
    const list = el('div', { className: 'sg-me__rows' });
    pts.forEach((p, i) => {
      const note = pointNote(p);
      list.appendChild(el('div', null,
        el('div', { className: 'sg-item' },
          el('span', {
            className: 'sg-item__icon' + (i === 0 ? ' sg-item__icon--accent' : ''),
            html: icon('pin'),
          }),
          el('span', { className: 'sg-item__text' },
            el('span', { className: 'sg-item__title' }, p.addr),
            note ? el('span', { className: 'sg-item__sub' }, note) : null)),
        p.lat != null && p.lng != null ? markRow(p) : null));
    });
    node.appendChild(list);

    // ── из чего цена. Итог и общие цифры знаем сразу, разбивку — когда придёт
    // полный заказ, поэтому строки собираются отдельной функцией.
    node.appendChild(group(t('order.price_details')));
    const rows = el('div', { className: 'sg-me__sums' });
    function fillPrice(full) {
      const price = (full && full.price) || {};
      const out = [];
      if (item.distance_m) out.push(sumRow(t('order.distance'), distance(item.distance_m)));
      if (item.duration_s) out.push(sumRow(t('order.duration'), duration(item.duration_s)));
      if (item.tariff) out.push(sumRow(t('me.car'), nameOf(item.tariff)));
      if (price.base) out.push(sumRow(t('order.price_base'), money(price.base)));
      if (price.distance) out.push(sumRow(t('order.price_distance'), money(price.distance)));
      if (price.time) out.push(sumRow(t('order.price_time'), money(price.time)));
      if (item.loaders) {
        out.push(sumRow(t('order.price_loaders'),
          price.loaders ? money(price.loaders) : String(item.loaders)));
      }
      for (const ex of (Array.isArray(item.extras) ? item.extras : [])) {
        const found = app.extras.find((x) => x && x.code === ex.code);
        const qty = Number(ex.qty) || 1;
        out.push(sumRow(nameOf(found) || ex.code,
          qty === 1 ? t('common.yes') : '×' + String(qty).replace('.', ',')));
      }
      if (price.waiting) out.push(sumRow(t('order.price_waiting'), money(price.waiting)));
      out.push(sumRow(t('order.price_total'), money(item.price_total || 0), true));
      const payKey = 'status.pay_' + (item.payment_status || 'none');
      if (has(payKey)) out.push(sumRow(t('me.pay'), t(payKey)));
      rows.replaceChildren(...out);
    }
    fillPrice(order);
    node.appendChild(rows);

    if (item.comment) {
      node.appendChild(group(t('common.comment')));
      node.appendChild(el('p', { className: 'sheet__text' }, item.comment));
    }

    // ── курьер
    const courier = item.courier || (order && order.courier);
    if (courier && courier.name) {
      node.appendChild(group(t('track.courier')));
      const car = courier.car || {};
      node.appendChild(el('div', { className: 'sg-courier' },
        el('span', { className: 'avatar' },
          courier.avatar ? el('img', { src: courier.avatar, alt: '' }) : initials(courier.name)),
        el('span', { className: 'sg-courier__text' },
          el('span', { className: 'sg-courier__name' }, courier.name),
          el('span', { className: 'sg-courier__car' },
            car.model ? el('span', { className: 'truncate' }, car.model) : null,
            car.plate ? el('span', { className: 'sg-plate' }, fmtPlate(car.plate)) : null)),
        courier.rating
          ? el('span', { className: 'sg-courier__rate' }, '★ ' + rate(courier.rating))
          : null));
    }

    // ── оценка
    if (item.status === 'done') {
      node.appendChild(group(item.rating ? t('me.rated') : t('me.not_rated')));
      if (item.rating) {
        const stars = el('div');
        mountStars(stars, { value: item.rating, readonly: true, size: 'lg' });
        node.appendChild(el('div', { className: 'col center gap-2' }, stars,
          item.rating_comment
            ? el('div', { className: 'muted t-sm ta-c' }, item.rating_comment)
            : null));
      }
    }

    // ── что можно сделать дальше
    const foot = el('div', { className: 'col gap-2', style: { paddingTop: 'var(--sp-3)' } });
    const live = item.live || LIVE_STATUSES.indexOf(item.status) >= 0;
    if (live && item.track_token) {
      foot.appendChild(el('button', {
        type: 'button', className: 'btn btn--ghost btn--lg btn--block',
        onClick: () => leave('/order/' + item.public_id, { t: item.track_token }),
      }, t('me.watch')));
    }
    if (pts.length >= 2) {
      foot.appendChild(el('button', {
        type: 'button', className: 'sg-cta',
        onClick: () => {
          haptic(18);
          startOrder(draftFrom(item));
          toast(t('me.repeated'), { type: 'ok' });
        },
      }, el('span', { className: 'sg-cta__label' }, t('order.repeat'))));
    }
    node.appendChild(foot);

    return {
      node,
      destroy() { if (map) map.destroy(); },
      /* Пришёл полный заказ: дописываем разбивку и настоящую линию маршрута,
         а карточку целиком не пересобираем — карта бы моргнула. */
      apply(full) {
        fillPrice(full);
        if (map && Array.isArray(full.route) && full.route.length > 1) map.setRoute(full.route);
      },
    };
  }

  /* ── бонусы ──────────────────────────────────────────────────────────── */

  /* Ссылкой делятся в мессенджере, поэтому отдаём человеческий текст целиком:
     код отдельной строкой никто пересказывать не будет. */
  function shareInvite(b) {
    const service = (app.cfg.service && app.cfg.service.name) || 'Sprinter Go';
    const text = t('bn.share_text', {
      service, code: b.code || '', sum: money(b.invite_friend || 0),
    });
    const url = siteUrl();
    haptic();
    if (navigator.share) {
      navigator.share({ title: service, text, url }).catch(() => {});
      return;
    }
    copyText(text + ' ' + url, t('bn.copied'));
  }

  function inviteField() {
    const field = textField(t('bn.have_code'), '', {
      maxLength: 16, hint: t('bn.code_ph'), autocomplete: 'off',
    });
    field.input.setAttribute('autocapitalize', 'characters');
    field.input.setAttribute('spellcheck', 'false');
    const go = el('button', {
      type: 'button', className: 'btn btn--ghost btn--lg btn--block',
      onClick: async () => {
        const code = field.input.value.trim();
        if (code.length < 4) {
          toast(t('bn.code_ph'), { type: 'err' });
          field.input.focus();
          return;
        }
        go.disabled = true;
        try {
          const res = await applyInviteCode(code);
          haptic(20);
          toast(t('bn.applied', { sum: money((res && res.amount) || 0) }), { type: 'ok' });
          await loadBonusState(true);
        } catch (e) {
          toast(errText(e), { type: 'err' });
          go.disabled = false;
        }
      },
    }, t('bn.apply'));
    return el('div', { className: 'col gap-3' }, field.node, go);
  }

  function buildBonus() {
    const node = el('div', { className: 'sg-me__wrap' });

    if (!clientToken()) {
      node.appendChild(el('p', { className: 'sheet__text' }, t('bn.unknown')));
      return { node };
    }

    const b = state.bonus;
    if (!b) {
      if (state.bonusLoading) {
        const box = el('div', { style: { padding: 'var(--sp-5) 0' } });
        skeleton(box, 4);
        node.appendChild(box);
      } else {
        node.appendChild(el('div', { className: 'sg-fail' },
          el('div', { className: 'sg-fail__text' }, errText(state.bonusError)),
          el('button', {
            type: 'button', className: 'btn btn--ghost',
            onClick: () => loadBonusState(true),
          }, t('common.retry'))));
      }
      return { node };
    }

    const balance = Math.max(0, Number(b.balance) || 0);

    // ── баланс крупно и срок, до которого он живёт
    let burn = null;
    if (balance > 0 && b.expires_at) {
      const when = fmtDate(b.expires_at);
      burn = b.expire_soon
        ? el('div', { className: 'sg-bal__burn' }, t('bn.burn_soon', { date: when }))
        : el('div', { className: 'muted-2 t-xs ta-c' }, t('bn.burn', { date: when }));
    }
    const big = el('div', { className: 'sg-bal__val' });
    stopCount = countUp(big, state.shownBig, balance, money,
      (v) => { state.shownBig = v; }, 100);

    node.appendChild(el('div', { className: 'sg-bal' },
      big,
      el('div', { className: 'sg-bal__name' }, balance > 0 ? t('bn.balance') : t('bn.empty')),
      burn));

    node.appendChild(el('p', { className: 'sheet__text ta-c' },
      b.enabled === false
        ? t('bn.off')
        : t('bn.how', { percent: rate(b.percent), share: rate(b.max_share) })));

    // ── код приглашения: выгода объяснена одной строкой, кнопка одна
    if (b.code) {
      node.appendChild(group(t('bn.invite')));
      node.appendChild(el('div', { className: 'sg-code' },
        el('span', { className: 'sg-code__val' }, b.code),
        // Иконку кладём прямым потомком кнопки: правило .btn > svg в
        // components.css достаёт только их, а в обёртке svg растянется до 300×150.
        el('button', {
          type: 'button', className: 'btn btn--primary sg-code__btn',
          onClick: () => shareInvite(b),
        }, svgIcon('share'), t('common.share'))));
      node.appendChild(el('p', { className: 'sheet__text' },
        t('bn.invite_gain', {
          friend: money(b.invite_friend || 0), owner: money(b.invite_owner || 0),
        })));

      const counters = [];
      if (b.invites_done) counters.push(t('bn.done_n', { n: b.invites_done }));
      if (b.invites_waiting) counters.push(t('bn.waiting', { n: b.invites_waiting }));
      if (counters.length) {
        node.appendChild(el('div', { className: 'muted t-xs' }, counters.join(' · ')));
      }
    }

    // ── чужой код принимаем только у тех, кто ещё ни разу не ездил
    if (!b.invited && b.enabled !== false && !(state.profile && state.profile.orders_done)) {
      node.appendChild(group(t('bn.have_code')));
      node.appendChild(inviteField());
    }

    // ── движение бонусов: три последних строки здесь, остальное отдельным
    // экраном. Раздел должен помещаться в экран, а движений за год набирается
    // на сотню строк — им тут не место.
    const moves = Array.isArray(b.history) ? b.history : [];
    node.appendChild(group(t('bn.history')));
    if (!moves.length) {
      node.appendChild(el('p', { className: 'sheet__text' }, t('bn.history_empty')));
    } else {
      const rows = el('div', { className: 'sg-me__rows' });
      moves.slice(0, 3).forEach((one, i) => {
        rows.appendChild(riseOnce(bonusMove(one), 'bn' + (one.at || '') + '-' + i));
      });
      node.appendChild(rows);
      if (moves.length > 3) {
        node.appendChild(el('button', {
          type: 'button', className: 'btn btn--ghost btn--lg btn--block',
          onClick: () => {
            haptic();
            child = openBonusMoves(moves, () => { child = null; });
          },
        }, t('bn.show_all')));
      }
    }

    return { node };
  }

  /* ── адреса ──────────────────────────────────────────────────────────── */

  function buildPlaces() {
    const node = el('div', { className: 'sg-me__wrap' });
    const places = readPlaces();
    const home = places.home || null;
    const work = places.work || null;

    if (home || work) {
      const rows = [];
      for (const [kind, place] of [['home', home], ['work', work]]) {
        if (!place) continue;
        // Живое нажатие вешаем через pressable: тогда и просевшая кнопка, и
        // «меньше движения» работают ровно так же, как у всех остальных.
        const forget = iconBtn('trash', 'sg-me__x', t('fav.drop'), (e) => {
          e.stopPropagation();
          setPlace(kind, null);
          haptic();
          toast(t('fav.dropped'), { type: 'ok' });
          repaint();
        });
        pressable(forget, { scale: 0.9 });
        rows.push({
          icon: icon(kind),
          hint: t('fav.' + kind),
          label: place.addr,
          sub: place.subtitle || '',
          end: forget,
        });
      }
      node.appendChild(rowGroup(rows));
    }

    if (home && work) {
      // Оба адреса на месте — поездка между ними собирается одной кнопкой.
      node.appendChild(group(t('fav.group')));
      node.appendChild(rowGroup([
        ride(home, work, t('fav.ride_work')),
        ride(work, home, t('fav.ride_home')),
      ]));
    } else {
      node.appendChild(el('p', { className: 'sheet__text' },
        home || work ? t('fav.hint') : t('fav.empty')));
    }

    // ── недавние адреса: отсюда их и отмечают домом или работой
    const recent = (readJson(KEY_RECENT, []) || [])
      .filter((p) => p && p.addr && p.lat != null && p.lng != null)
      .filter((p) => !samePlace(home, p) && !samePlace(work, p));
    node.appendChild(group(t('me.recent')));
    if (!recent.length) {
      node.appendChild(el('p', { className: 'sheet__text' }, t('me.recent_empty')));
    } else {
      const rows = el('div', { className: 'sg-me__rows' });
      recent.slice(0, 6).forEach((p, i) => {
        rows.appendChild(riseOnce(el('div', null,
          el('div', { className: 'sg-item' },
            el('span', { className: 'sg-item__icon', html: icon('pin') }),
            el('span', { className: 'sg-item__text' },
              el('span', { className: 'sg-item__title' }, p.addr),
              p.subtitle ? el('span', { className: 'sg-item__sub' }, p.subtitle) : null)),
          markRow(p, true)), 'rc' + i + p.addr));
      });
      node.appendChild(rows);
    }

    return { node };
  }

  function ride(from, to, label) {
    return {
      icon: icon('car'),
      label,
      sub: t('fav.ride_sub', { from: from.addr, to: to.addr }),
      className: 'sg-me__ride',
      onClick: () => {
        haptic(18);
        startOrder({
          points: [from, to], tariffId: 0, loaders: 0, extras: {}, comment: '',
        });
      },
    };
  }

  /* ── настройки ───────────────────────────────────────────────────────── */

  function buildSettings() {
    const me = readClient();
    const node = el('div', { className: 'sg-me__wrap' });

    const nameField = textField(t('common.name'), me.name || '', {
      autocomplete: 'name', maxLength: 80, hint: t('me.name_ph'),
    });
    nameField.input.addEventListener('change', () => saveName(nameField.input));
    node.appendChild(nameField.node);

    const phoneField = textField(t('common.phone'), me.phone ? fmtPhone(me.phone) : '', {
      type: 'tel', disabled: true, hint: me.phone ? t('me.phone_note') : t('me.no_phone'),
    });
    node.appendChild(phoneField.node);

    /* Язык и тема — сегментами, а не списками: вариантов по два-три, и выбор
       должен быть виден целиком, без лишнего нажатия. Тема идёт отдельной
       строкой во всю ширину: «Как в системе» рядом с подписью не помещается. */
    const langSeg = segmented(
      LANGS.map((code) => ({ value: code, label: t('common.lang_' + code) })),
      { value: getLang(), label: t('common.language'), onChange: pickLang });
    const themeSeg = segmented([
      { value: 'light', label: t('common.theme_light') },
      { value: 'dark', label: t('common.theme_dark') },
      { value: 'auto', label: t('common.theme_auto') },
    ], { value: getTheme(), label: t('common.theme'), onChange: setTheme });

    node.appendChild(rowGroup([
      { label: t('common.language'), end: langSeg },
      { label: t('common.theme'), sub: t('me.theme_note') },
      themeSeg,
    ]));

    const rows = supportRows();
    if (rows.length) {
      node.appendChild(group(t('common.support')));
      node.appendChild(rowGroup(rows));
    }

    node.appendChild(el('div', { style: { paddingTop: 'var(--sp-3)' } },
      el('button', {
        type: 'button', className: 'btn btn--danger btn--lg btn--block',
        onClick: askForget,
      }, t('me.forget'))));

    return { node };
  }

  async function saveName(input) {
    const name = input.value.trim().slice(0, 80);
    const me = readClient();
    if (name === (me.name || '')) return;
    saveClient({ name });
    const token = clientToken();
    if (!token) {
      toast(t('common.saved'), { type: 'ok' });
      return;
    }
    try {
      const fresh = await api.patch('/client/profile', { token, name }, { auth: false });
      if (fresh && fresh.phone !== undefined) state.profile = fresh;
      toast(t('common.saved'), { type: 'ok' });
    } catch (e) {
      toast(errText(e), { type: 'err' });
    }
  }

  function pickLang(code) {
    setLang(code);
    const token = clientToken();
    // Язык нужен и серверу: письма, смс и названия статусов приходят на нём.
    if (token) api.patch('/client/profile', { token, lang: code }, { auth: false }).catch(() => {});
  }

  async function askForget() {
    const yes = await confirm({
      title: t('me.forget_q'),
      text: t('me.forget_text'),
      ok: t('me.forget_ok'),
      cancel: t('common.cancel'),
      danger: true,
    });
    if (!yes) return;
    forgetClient();
    ui.close();
    toast(t('me.forgot'), { type: 'ok' });
  }

  /* ── запуск ──────────────────────────────────────────────────────────── */

  paintHead();
  current = BUILD[view]();
  stage.show(current.node, false);
  if (view === 'orders') loadFirstPage();
  loadProfile();
  // Баланс нужен и на плитке в корне профиля — там он стоит цифрой.
  if (bonusOn(app.cfg) && clientToken()) loadBonusState(view === 'bonus');

  return {
    /** Раздел сменился в адресе: показываем его и считаем направление переезда. */
    apply(next) {
      const name = ME_SECTIONS[next] ? next : 'hub';
      if (name === view) return;
      // Карточку из адреса не восстановить — честно правим адрес на список.
      if (name === 'order' && !state.card) {
        if (app.router) app.router.overlay(ME_SECTIONS.orders.overlay, { replace: true });
        else render('orders', true);
        return;
      }
      render(name, ME_SECTIONS[name].depth < ME_SECTIONS[view].depth);
      if (name === 'orders') loadFirstPage();
      if (name === 'bonus') loadBonusState(true);
    },
    /** Закрыть. fromRouter — закрывает оболочка, адрес уже без наложения. */
    close(fromRouter) {
      byRouter = !!fromRouter;
      ui.close();
    },
    section() { return view; },
  };
}

/* Все движения бонусов отдельным экраном: в разделе «Бонусы» им места нет —
   он обязан помещаться в экран, а движений за год набирается на сотню строк. */
function openBonusMoves(list, onGone) {
  const rows = el('div', { className: 'sg-me__rows' });
  (list || []).forEach((one, i) => {
    const row = bonusMove(one);
    row.classList.add('sg-rise');
    row.style.animationDelay = Math.min(i, 9) * 26 + 'ms';
    rows.appendChild(row);
  });
  return sheet({
    full: true,
    className: 'sg-me',
    title: t('bn.history'),
    content: el('div', { className: 'sg-me__wrap' },
      list && list.length ? rows : el('p', { className: 'sheet__text' }, t('bn.history_empty'))),
    onClose: onGone,
  });
}

/** Заказ из истории превращаем в заготовку нового: те же адреса и та же машина. */
function draftFrom(item) {
  const extras = {};
  for (const ex of (Array.isArray(item.extras) ? item.extras : [])) {
    if (ex && ex.code) extras[ex.code] = ex.qty || 1;
  }
  return {
    points: (Array.isArray(item.points) ? item.points : [])
      .filter((p) => p && p.lat != null && p.lng != null)
      .map((p) => ({
        addr: p.addr || '', subtitle: '', lat: p.lat, lng: p.lng,
        entrance: p.entrance || '', flat: p.flat || '', floor: p.floor || '',
        intercom: p.intercom || '', comment: p.comment || '',
        name: p.name || '', phone: p.phone || '',
      })),
    tariffId: item.tariff_id || 0,
    loaders: item.loaders || 0,
    extras,
    comment: item.comment || '',
  };
}

/* ─────────────────────────────────────────────────────── подсказка над шторкой */

/* Одна плашка над шторкой на экране заказа. Показывает то единственное, что
   человеку сейчас полезно сделать одним касанием: вернуться в заказ, который
   уже едет, или повторить прошлый. Закрыл — до перезагрузки больше не лезем:
   навязчивая подсказка надоедает быстрее, чем помогает. */
function createFlash() {
  ensureCss();
  const shell = document.querySelector('.sg-app') || document.body;
  let node = null;
  let off = false;

  function hide() {
    if (!node) return;
    node.remove();
    node = null;
  }

  function show(o) {
    if (off) return;
    hide();
    const go = el('button', {
      type: 'button', className: 'sg-flash__go',
      onClick: () => { haptic(18); o.onClick(); },
    },
      el('span', { className: 'sg-flash__ico', html: icon(o.icon) }),
      el('span', { className: 'sg-flash__text' },
        el('span', { className: 'sg-flash__title' }, o.title),
        o.sub ? el('span', { className: 'sg-flash__sub' }, o.sub) : null));

    const close = iconBtn('close', 'sg-flash__x', t('again.hide'), () => {
      haptic();
      off = true;
      hide();
    });

    node = el('div', { className: 'sg-flash', role: 'group', 'aria-label': o.title }, go, close);
    shell.appendChild(node);
    requestAnimationFrame(() => { if (node) node.classList.add('sg-flash--in'); });
  }

  return {
    show,
    hide,
    /** Подсказкой воспользовались — больше она не нужна. */
    done() { off = true; hide(); },
  };
}

/* ─────────────────────────────────────────────────────── первый заход */

/* Один экран, три строки, кнопка «Пропустить». Показываем ровно один раз и
   только тому, кто ещё ни разу не заказывал: остальным она уже ничего не
   объяснит, а место на экране займёт. */
function showFirstTip(app) {
  if (readJson(KEY_SEEN)) return;
  ensureCss();

  const percent = Math.max(0, Number((app.cfg.bonus || {}).percent) || 0);
  const third = bonusOn(app.cfg) && percent > 0
    ? t('tip.three', { percent: rate(percent) })
    : t('tip.three_plain');

  const line = (ico, text) => el('div', { className: 'sg-tip' },
    el('span', { className: 'sg-tip__ico', 'aria-hidden': 'true' }, ico),
    el('span', { className: 'sg-tip__text' }, text));

  // Закрыли любым способом — считаем, что подсказку видели. Второй раз
  // показывать её было бы уже навязчивостью.
  const seen = () => writeJson(KEY_SEEN, Math.floor(Date.now() / 1000));

  sheet({
    title: t('tip.title'),
    content: el('div', null,
      line('📍', t('tip.one')),
      line('🚚', t('tip.two')),
      line('🎁', third)),
    actions: [
      { label: t('tip.skip'), kind: 'ghost' },
      { label: t('tip.ok'), kind: 'primary' },
    ],
    onClose: seen,
  });
}

/* ─────────────────────────────────────────────────────── шторка */

/* Шторка живёт на странице всегда, меняется только её содержимое. Высоту
   анимируем числом: если менять auto, браузер просто дёрнет вёрстку скачком. */
function createPanel(root) {
  const slot = root.querySelector('.sg-panel__slot');
  let timer = 0;
  let current = null;
  let leaving = [];             // шаги, которые ещё дотаивают на экране

  const shell = document.querySelector('.sg-app');

  function measure() {
    const h = Math.round(root.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--sg-panel-h', h + 'px');
    // На весь экран шторка разворачивается только для поиска адреса: кнопки карты
    // под ней всё равно не нажать, и они лезут в шапку — прячем их на это время.
    if (shell) shell.classList.toggle('is-deep', !!slot.querySelector('.sg-step--tall'));
    return h;
  }

  function show(node, opts = {}) {
    if (node === current) return node;
    const old = current;
    node.classList.add('sg-step');
    current = node;

    // Хвосты прошлых переходов убираем сразу: иначе прозрачный шаг остаётся
    // в разметке и его читают поиск по странице и скринридер.
    clearTimeout(timer);
    for (const gone of leaving) gone.remove();
    leaving = [];

    if (!old) {
      slot.replaceChildren(node);
      measure();
      return node;
    }

    const time = dur('--dur-2', 240);
    const h0 = slot.getBoundingClientRect().height;
    old.classList.add('sg-step--out');
    if (opts.back) old.classList.add('sg-step--back-out');
    node.classList.add('sg-step--enter');
    if (opts.back) node.classList.add('sg-step--back');
    slot.appendChild(node);

    const h1 = node.getBoundingClientRect().height;
    slot.style.height = h0 + 'px';
    void slot.offsetHeight;                 // фиксируем стартовый кадр
    slot.style.height = h1 + 'px';
    requestAnimationFrame(() => node.classList.remove('sg-step--enter', 'sg-step--back'));

    leaving.push(old);
    timer = setTimeout(() => {
      for (const gone of leaving) gone.remove();
      leaving = [];
      slot.style.height = '';
      measure();
    }, time + 60);
    measure();
    return node;
  }

  /* Содержимое шага поменялось само (пришла цена, сменился статус) — просто
     пересчитываем высоту, чтобы кнопки карты остались над шторкой. */
  function refresh() {
    return measure();
  }

  window.addEventListener('resize', () => measure());
  return { el: root, slot, show, refresh, height: measure, current: () => current };
}

/* ─────────────────────────────────────────────────────── оболочка */

async function boot() {
  const mapBox = document.getElementById('map');
  const panel = createPanel(document.getElementById('panel'));
  const langBtn = document.getElementById('lang-switch');

  applyTo(document);
  paintLang();

  let cfg = null;
  try {
    cfg = await api.get('/config');
  } catch (e) {
    return bootFailed(panel, e);
  }

  if (cfg.service && cfg.service.tz) setTimeZone(cfg.service.tz);
  if (cfg.service && cfg.service.name) {
    const name = document.getElementById('brand-name');
    if (name) name.textContent = cfg.service.name;
    document.title = cfg.service.name + ' — ' + t('order.title');
  }

  const mapCfg = cfg.map || {};
  const map = createMap(mapBox, Object.assign({
    center: mapCfg.center || [42.8746, 74.5698],
    zoom: mapCfg.zoom || 13,
    theme: isLightNow() ? 'light' : 'dark',
  }, mapTiles(mapCfg)));
  // Тему меняют и в профиле, и в настройках телефона — карта следует за обеими.
  onThemeChange((light) => map.setTheme(light ? 'light' : 'dark'));

  // Пока карту тянут, метка выбора точки приподнимается — как настоящая булавка.
  const shell = document.querySelector('.sg-app');
  map.on('move', () => shell.classList.add('is-dragging'));
  map.on('moveend', () => shell.classList.remove('is-dragging'));

  const owned = new Set();
  const centerPin = document.getElementById('center-pin');
  let lastFit = null;
  let screen = null;
  let draft = null;              // заготовка нового заказа после «Повторить заказ»

  const app = {
    cfg,
    map,
    panel,
    maxPoints: Math.max(2, (cfg.order && cfg.order.max_points) || 5),
    tariffs: Array.isArray(cfg.tariffs) ? cfg.tariffs.slice() : [],
    extras: Array.isArray(cfg.extras) ? cfg.extras.slice() : [],

    /** Маркер карты, который оболочка уберёт сама при смене экрана. */
    marker(o) {
      const m = map.marker(o);
      const off = m.remove;
      m.remove = () => { owned.delete(m); off(); };
      owned.add(m);
      return m;
    },

    route(coords, o) {
      const r = map.route(coords, o);
      const off = r.remove;
      r.remove = () => { owned.delete(r); off(); };
      owned.add(r);
      return r;
    },

    clearMap() {
      for (const item of Array.from(owned)) item.remove();
      owned.clear();
    },

    /** Вписать точки в свободную часть карты — ту, что не закрыта шторкой.
        Шторка бывает выше половины экрана; если честно отдать ей весь отступ,
        для маршрута не останется места вовсе — поэтому ограничиваем. */
    fit(points, o = {}) {
      const list = (points || []).filter(Boolean);
      if (!list.length) return;
      lastFit = { points: list, o };
      const tall = mapBox.clientHeight || window.innerHeight || 640;
      const bottom = Math.min(panel.height() + 24, Math.round(tall * 0.56));
      map.fitPoints(list, {
        padding: { top: Math.min(92, Math.round(tall * 0.16)), right: 32, bottom, left: 32 },
        animate: o.animate !== false,
        maxZoom: o.maxZoom || 16.5,
        zoom: o.zoom,
      });
    },

    /** Шторка выросла или сжалась — маршрут должен остаться на виду. */
    refit() {
      if (lastFit) app.fit(lastFit.points, { ...lastFit.o, animate: true });
    },

    centerPin(on) {
      centerPin.hidden = !on;
    },

    go(path, query) { router.go(path, query ? { query } : undefined); },
    back() { router.back(); },

    activeOrder() {
      const v = readJson(KEY_ORDER);
      return v && v.pid && v.token ? v : null;
    },
    saveOrder(pid, token) {
      writeJson(KEY_ORDER, { pid, token, at: Math.floor(Date.now() / 1000) });
      // Заказ есть, телефон есть — значит, можно забрать постоянный ключ клиента.
      ensureClientToken();
      // В заказ могли уйти бонусы: запомненный баланс уже неправда.
      bonusForget();
    },
    forgetOrder() { writeJson(KEY_ORDER, null); },

    /** Что мы помним о человеке. known — телефон уже спрашивали, второй раз не надо. */
    me() {
      const saved = readClient();
      return {
        phone: saved.phone || '',
        name: saved.name || '',
        token: saved.token || '',
        known: !!saved.phone,
      };
    },
    setMe(patch) {
      saveClient(patch);
      return app.me();
    },
    known() { return !!readClient().phone; },
    clientToken,

    /** Тема: 'auto' | 'dark' | 'light'. */
    theme: getTheme,
    setTheme,

    /* Профиль открываем не напрямую, а через адрес: шторка попадает в
       #/~profile, и перезагрузка возвращает человека в тот же раздел.
       Саму шторку поднимает подписка на наложения — она ниже, в boot(). */
    openProfile() { openMe('hub'); },
    openHistory() { openMe('orders'); },
    openBonus() { openMe('bonus'); },

    /**
     * Бонусы для соседних экранов.
     *
     * spend({onChange}) отдаёт готовый переключатель «Списать бонусы»:
     * ставим его узел в нужное место, на каждое изменение цены зовём
     * setTotal(итог в тыйынах), а при оформлении кладём value() в поле
     * bonus_spend запроса POST /orders. Сервер всё равно пересчитает сам —
     * это защита от несходящихся цифр, а не недоверие.
     */
    bonus: {
      on: () => bonusOn(cfg),
      load: loadBonus,
      known: bonusKnown,
      forget: bonusForget,
      maxFor: bonusMaxFor,
      spend: (opts) => mountBonusSpend(app, opts),
      open: () => openMe('bonus'),
    },

    /** Любимые адреса: {home, work}. Ставятся из истории в один тап. */
    places: readPlaces,
    setPlace,

    /** Заготовка нового заказа из «Повторить заказ». Экран заказа забирает её
        один раз при запуске: второй вызов вернёт null. */
    takeDraft() {
      const v = draft;
      draft = null;
      return v;
    },

    /** Начать новый заказ с готовыми адресами. Адреса заодно кладём в недавние —
        так они под рукой и на шаге поиска адреса. */
    startOrder(next) {
      draft = next || null;
      if (next) rememberRecent(next.points);
      router.go('/', { force: true });
    },
  };

  function leave() {
    if (screen && typeof screen.destroy === 'function') screen.destroy();
    screen = null;
    app.clearMap();
    app.centerPin(false);
    lastFit = null;
  }

  const flash = createFlash();
  let warm = null;          // что знаем о прошлых заказах: {live, last}
  let touched = false;      // шторку уже трогали — уводить человека с неё нельзя

  // Как только человек взялся за форму заказа, автоматический уход на
  // отслеживание отменяется: под пальцем не переключают экраны.
  panel.el.addEventListener('pointerdown', () => { touched = true; }, { passive: true });

  /* Что предложить одним касанием на главном экране. Порядок важен: заказ,
     который едет прямо сейчас, важнее прошлого. */
  /** Открыть профиль на нужном разделе. Шторку поднимет подписка на наложения. */
  function openMe(section) {
    const at = ME_SECTIONS[section] ? section : 'hub';
    router.overlay(ME_SECTIONS[at].overlay);
  }

  function paintFlash() {
    if (!warm) return;
    if (warm.live) {
      flash.show({
        icon: 'car',
        title: t('again.live'),
        sub: t('again.live_sub'),
        onClick: () => {
          flash.done();
          app.go('/order/' + warm.live.public_id, { t: warm.live.track_token });
        },
      });
      return;
    }
    if (!warm.last) return;
    const item = warm.last;
    const pts = (Array.isArray(item.points) ? item.points : []).filter((p) => p && p.addr);
    const route = [pts[0] && pts[0].addr, pts.length > 1 && pts[pts.length - 1].addr]
      .filter(Boolean).join(' → ');
    flash.show({
      icon: 'repeat',
      title: t('again.repeat'),
      sub: route,
      onClick: () => {
        flash.done();
        app.startOrder(draftFrom(item));
        toast(t('me.repeated'), { type: 'ok' });
      },
    });
  }

  const router = createRouter({
    '/': () => {
      leave();
      screen = mountOrder(app);
      paintFlash();
    },
    '/order/:pid': (ctx) => {
      leave();
      flash.hide();
      screen = mountTrack(app, String(ctx.params.pid || '').toUpperCase(), ctx.query.t || '');
    },
    '*': () => router.go('/', { replace: true }),
  }, { auto: false, home: '/' });

  app.router = router;

  /* Профиль живёт в адресе отдельным куском (#/~profile:bonus). Роутер зовёт
     эту подписку и при открытии, и при перезагрузке страницы — так человек
     возвращается ровно в тот раздел, где был, а системная «назад» закрывает
     профиль, а не уводит с сервиса. */
  let me = null;
  router.onOverlay((name) => {
    const section = meSection(name);
    if (!section) {
      if (me) {
        const going = me;
        me = null;
        going.close(true);
      }
      return;
    }
    if (me) {
      me.apply(section);
      return;
    }
    me = openProfileSheet(app, section, () => { me = null; });
    /* Раздел мог получиться не тем, что просили в адресе: карточку отдельного
       заказа после перезагрузки восстановить нечем, и открывается список.
       Пусть адрес говорит правду — иначе следующая перезагрузка снова обещала
       бы карточку. Подписка сработает второй раз, но шторка уже есть и просто
       сверит раздел. */
    const real = ME_SECTIONS[me.section()].overlay;
    if (router.overlayName() !== real) router.overlay(real, { replace: true });
  });

  profileBtn = makeProfileButton(app.openProfile);
  paintProfileButton();

  /* Язык меняется на лету: заголовок вкладки, разметка и текущий экран.
     Шторку гасим и проявляем обратно — мгновенная подмена всех надписей
     читается как сбой, а короткое растворение показывает, что сработало
     именно то, на что человек нажал. */
  onLangChange(() => {
    paintLang();
    paintProfileButton();
    if (cfg.service && cfg.service.name) {
      document.title = cfg.service.name + ' — ' + t('order.title');
    }
    applyTo(document);
    fadeSwap(panel.slot, () => {
      if (screen && typeof screen.relang === 'function') screen.relang();
      panel.refresh();
    });
  });

  langBtn.addEventListener('click', () => {
    const next = getLang() === 'ru' ? 'ky' : 'ru';
    setLang(LANGS.indexOf(next) >= 0 ? next : 'ru');
  });

  // Вернулись на сайт с открытым заказом — показываем его сразу, а не пустую форму.
  const live = app.activeOrder();
  const hash = String(location.hash || '').slice(1);
  if (live && (!hash || hash === '/' || hash === '#/')) {
    router.go('/order/' + live.pid, { query: { t: live.token }, replace: true });
  }
  router.start();

  // Ключ клиента могли не успеть получить в прошлый раз — тихо доберём сейчас.
  ensureClientToken();

  /* Один короткий запрос на старте отвечает сразу на два вопроса: куда вернуть
     человека и что предложить повторить. Память устройства знает только заказы
     с этого телефона — а заказ могли сделать и на другом, поэтому спрашиваем. */
  async function warmUp() {
    const token = clientToken() || await ensureClientToken();
    if (!token) return;
    let res = null;
    try {
      res = await api.get('/client/orders',
        { token, page: 1, per_page: WARM_ORDERS }, { auth: false });
    } catch (e) {
      return;                     // не ответил — обойдёмся без подсказки
    }
    const items = Array.isArray(res.items) ? res.items : [];
    const pointsOf = (x) => (Array.isArray(x && x.points) ? x.points : [])
      .filter((p) => p && p.lat != null && p.lng != null);
    warm = {
      live: items.find((x) => x && x.live && x.track_token) || null,
      last: items.find((x) => pointsOf(x).length >= 2) || null,
    };

    const at = router.current();
    const home = at && at.path === '/';
    // Заказ едет, а человек смотрит на пустую форму — уводим на отслеживание.
    // Но только если он к ней ещё не притронулся: выдёргивать экран из-под
    // пальца нельзя ни под каким предлогом.
    if (warm.live && home && !touched && !app.activeOrder()) {
      app.saveOrder(warm.live.public_id, warm.live.track_token);
      router.go('/order/' + warm.live.public_id,
        { query: { t: warm.live.track_token }, replace: true });
      return;
    }
    if (home) paintFlash();
  }
  warmUp();

  // Первому гостю — короткая подсказка. Даём экрану встать: шторка поверх
  // недорисованной карты выглядит как ошибка загрузки. И не лезем, если за эту
  // секунду человека увели на отслеживание своего заказа.
  if (!live && !app.known()) {
    setTimeout(() => {
      const at = router.current();
      if (at && at.path === '/') showFirstTip(app);
    }, TIP_DELAY_MS);
  }
}

function paintLang() {
  const lang = getLang();
  for (const node of document.querySelectorAll('[data-lang-code]')) {
    node.classList.toggle('is-on', node.getAttribute('data-lang-code') === lang);
  }
}

/* Настройки не пришли — без них нет ни тарифов, ни карты. Показываем причину
   и кнопку «повторить»: чаще всего это метро и пропавшая связь. */
function bootFailed(panel, e) {
  const box = el('div', { className: 'sg-step' },
    el('div', { className: 'sg-fail' },
      el('div', { className: 'sg-fail__icon', html: icon('alert') }),
      el('div', { className: 'sg-fail__title' }, t('err.load_failed')),
      el('div', { className: 'sg-fail__text' }, errText(e)),
    ),
    el('div', { className: 'sg-foot' },
      el('button', {
        type: 'button', className: 'btn btn--primary btn--lg btn--block',
        onClick: () => location.reload(),
      }, t('common.retry')),
    ),
  );
  panel.show(box);
}

boot().catch((e) => {
  toast(errText(e), { type: 'err' });
});
