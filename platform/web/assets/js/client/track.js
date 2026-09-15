/* Отслеживание заказа: поиск машины, курьер на карте, чат, детали и оценка.

   Экран живёт на потоке событий: сервер сам присылает смену статуса, координаты
   машины и сообщения от курьера, поэтому опроса здесь нет вовсе. Если связь
   оборвалась, core/api.js переподключится сам, а мы честно показываем полоску
   «нет связи».

   Четыре вещи здесь сделаны нарочно и требуют объяснения:

   1. Всё, что открывается поверх карты — чат, детали заказа, оценка и игра, —
      живёт в адресе через router.overlay(). Перезагрузил страницу с открытым
      чатом — вернулся в чат, нажал системную «назад» — закрыл чат, а не ушёл
      с сервиса.
   2. Чат дорисовывает сообщения по одному и никогда не пересобирает список
      целиком: полная перерисовка сбрасывала прокрутку в начало, и человек
      терял место, где читал. Своё сообщение появляется мгновенно, ещё до
      ответа сервера, и не задваивается — пузырь ищется среди неподтверждённых
      по тексту, а дальше сверка идёт только по идентификатору.
   3. Игра запускается ровно одной кнопкой «Поиграть» и закрывается крестиком.
      Сама она не появляется никогда: свёрнутая панель — это просто свёрнутая
      панель, а не приглашение ловить коробки.
   4. Пока машина едет, карта ведёт её сама (map.follow): вид подтягивается за
      фургоном, время подачи тикает раз в секунду, пройденный кусок маршрута
      гаснет позади машины. Взялся за карту пальцем — слежение отпускает руль
      и возвращается через несколько секунд.

   Чужой текст попадает на страницу только через textContent: innerHTML для
   сообщений и адресов не используется нигде.
*/

import { api } from '../core/api.js';
import { t, tp, has, extend, getLang } from '../core/i18n.js';
import { createStore } from '../core/store.js';
import {
  el, toast, sheet, haptic, mountStars, copyText, photoViewer,
  chip, rowGroup, pressable,
} from '../core/ui.js';
import { pin, distanceM } from '../core/map.js';
import { createPayStep } from './pay.js';
import {
  money, distance, duration, time as clock, date as day,
  plate as fmtPlate, initials,
} from '../core/fmt.js';
import {
  icon, iconBtn, errText, readJson, writeJson, onThemeChange, siteUrl, nameOf,
} from './app.js';

/* Свои строки модуль приносит сам: общий словарь правят соседние экраны.
   Префиксы нарочно редкие (game./talk./mood./det.) — так строки клиента не
   столкнутся с чатом курьера, который пишется параллельно.
   Кыргызский — как говорят в Бишкеке: «унаа», «жүк», «заказ», «кузов». */
extend({
  ru: {
    'game.title': 'Ловите коробки',
    'game.hint': 'Ведите пальцем — кузов едет за вами',
    'game.again': 'Ещё раз',
    'game.over': 'Коробки закончились',
    'game.caught': 'Поймано: {n}',
    'game.new_best': 'Новый рекорд!',
    'game.close': 'Закрыть игру',
    'game.play': 'Поиграть, пока ищем',
    'game.play_hint': 'Маленькая игра на время ожидания',
    'game.play_best': 'Ваш рекорд: {n}',
    'game.wait': 'Машину ищем дальше — как найдём, сразу покажем',
    'game.found': 'Машина нашлась, игру закрыли',

    'talk.title': 'Чат с курьером',
    'talk.open': 'Чат',
    'talk.ph': 'Сообщение курьеру',
    'talk.send': 'Отправить',
    'talk.empty': 'Здесь пока пусто. Напишите курьеру, где вас встретить.',
    'talk.wa': 'Написать в WhatsApp',
    'talk.wa_hello': 'Здравствуйте! Я по заказу {id}.',
    'talk.read': 'Прочитано',
    'talk.sent': 'Отправлено',
    'talk.sending': 'Отправляется',
    'talk.fail': 'Не ушло. Нажмите на сообщение, чтобы отправить ещё раз',
    'talk.fail_tick': 'Не отправлено',
    'talk.jump': 'Новые сообщения',
    'talk.closed': 'Переписка по этому заказу закрыта',
    'talk.plate_copied': 'Номер машины скопирован',
    'talk.new': 'Новое сообщение от курьера',
    'talk.load_fail': 'Не получилось загрузить переписку',
    'talk.photo': 'Фото курьера',
    'talk.unread': 'Непрочитанных сообщений: {n}',

    'mood.open': 'Оценить поездку',
    'mood.tap': 'Нажмите на звёзды — это займёт полминуты',
    'mood.bad_title': 'Нам очень жаль',
    'mood.bad_text': 'Расскажите, что пошло не так, — разберёмся с курьером и вернёмся к вам.',
    'mood.good_title': 'Спасибо, мы рады!',
    'mood.good_text': 'Передадим курьеру. Пара слов — по желанию.',
    'mood.r_late': 'Опоздал',
    'mood.r_damage': 'Повредили груз',
    'mood.r_rude': 'Нагрубил',
    'mood.r_price': 'Дороже договорённого',
    'mood.r_other': 'Другое',
    'mood.need_reason': 'Отметьте, что пошло не так',
    'mood.need_text': 'Напишите пару слов — иначе мы не поймём, что случилось',
    'mood.comment_bad': 'Что случилось',
    'mood.comment_good': 'Что понравилось',
    'mood.fav': 'Сохранить курьера в избранные',
    'mood.fav_hint': 'Узнаем его в следующем заказе',
    'mood.fav_done': 'Курьер в избранных',
    'mood.fav_off': 'Убрали из избранных',
    'mood.fav_badge': 'Ваш курьер',

    'live.almost': 'Почти на месте',

    'det.points': 'Куда едем',
    'det.order': 'О заказе',
    'det.price': 'Расчёт цены',
    'det.number': 'Номер заказа',
    'det.created': 'Заказ оформлен',
    'det.car': 'Машина',
    'det.loaders': 'Грузчики',
    'det.extras': 'Дополнительно',
    'det.comment': 'Комментарий курьеру',
    'det.payment': 'Оплата',
    'det.contact': 'Кто встретит',
    'det.map': 'Показать на карте',
    'det.copied': 'Номер заказа скопирован',
    'det.open': 'Детали заказа',
    'det.none': 'Ничего не добавляли',

    'give.what': 'Отследите мой заказ: видно статус и время в пути.',
    'give.copied': 'Ссылка скопирована — по ней видно только статус и время',
    'give.note': 'По ссылке видно статус и примерное время. '
      + 'Телефон, квартиру и точный адрес не показываем.',
    'give.guest': 'Вы смотрите заказ по ссылке: видно машину и статус, не больше',

    'gift.title': 'Бонусы',
    'gift.after_ride': 'Кэшбек за эту поездку уже на счету',
    'gift.rated': 'Спасибо! Начислили {sum} бонусами',
  },
  ky: {
    'game.title': 'Кутуларды кармаңыз',
    'game.hint': 'Манжаңыз менен жылдырыңыз — кузов артыңыздан жүрөт',
    'game.again': 'Дагы бир жолу',
    'game.over': 'Кутулар түгөндү',
    'game.caught': 'Кармалды: {n}',
    'game.new_best': 'Жаңы рекорд!',
    'game.close': 'Оюнду жабуу',
    'game.play': 'Издеп жатканда оюн ойноңуз',
    'game.play_hint': 'Күтүп турганга кичинекей оюн',
    'game.play_best': 'Сиздин рекорд: {n}',
    'game.wait': 'Унааны издей беребиз — тапканыбызда дароо көрсөтөбүз',
    'game.found': 'Унаа табылды, оюнду жаптык',

    'talk.title': 'Курьер менен чат',
    'talk.open': 'Чат',
    'talk.ph': 'Курьерге билдирүү',
    'talk.send': 'Жөнөтүү',
    'talk.empty': 'Азырынча бош. Курьерге кайдан тосуп аларыңызды жазыңыз.',
    'talk.wa': "WhatsApp'ка жазуу",
    'talk.wa_hello': 'Саламатсызбы! {id} заказы боюнча жазып жатам.',
    'talk.read': 'Окулду',
    'talk.sent': 'Жөнөтүлдү',
    'talk.sending': 'Жөнөтүлүп жатат',
    'talk.fail': 'Кетпей калды. Кайра жөнөтүү үчүн билдирүүнү басыңыз',
    'talk.fail_tick': 'Жөнөтүлгөн жок',
    'talk.jump': 'Жаңы билдирүүлөр',
    'talk.closed': 'Бул заказ боюнча жазышуу жабылды',
    'talk.plate_copied': 'Унаанын номери көчүрүлдү',
    'talk.new': 'Курьерден жаңы билдирүү',
    'talk.load_fail': 'Жазышууну жүктөй албадык',
    'talk.photo': 'Курьердин сүрөтү',
    'talk.unread': 'Окулбаган билдирүү: {n}',

    'mood.open': 'Сапарга баа бериңиз',
    'mood.tap': 'Жылдызчаларды басыңыз — жарым мүнөт иш',
    'mood.bad_title': 'Абдан өкүнөбүз',
    'mood.bad_text': 'Эмне туура болбогонун жазыңыз — курьер менен сүйлөшүп, сизге кабар беребиз.',
    'mood.good_title': 'Рахмат, абдан кубанычтабыз!',
    'mood.good_text': 'Курьерге айтабыз. Кааласаңыз, эки ооз сөз жазыңыз.',
    'mood.r_late': 'Кечикти',
    'mood.r_damage': 'Жүктү бузуп алды',
    'mood.r_rude': 'Орой сүйлөдү',
    'mood.r_price': 'Келишкенден кымбат',
    'mood.r_other': 'Башка',
    'mood.need_reason': 'Эмне туура болбогонун белгилеңиз',
    'mood.need_text': 'Эки ооз сөз жазыңыз — болбосо эмне болгонун түшүнбөйбүз',
    'mood.comment_bad': 'Эмне болду',
    'mood.comment_good': 'Эмнеси жакты',
    'mood.fav': 'Курьерди тандалмага сактоо',
    'mood.fav_hint': 'Кийинки заказда тааныйбыз',
    'mood.fav_done': 'Курьер тандалмада',
    'mood.fav_off': 'Тандалмадан алынды',
    'mood.fav_badge': 'Сиздин курьер',

    'live.almost': 'Дээрлик жетти',

    'det.points': 'Кайда баратабыз',
    'det.order': 'Заказ жөнүндө',
    'det.price': 'Баанын эсеби',
    'det.number': 'Заказдын номери',
    'det.created': 'Заказ берилди',
    'det.car': 'Унаа',
    'det.loaders': 'Жүкчүлөр',
    'det.extras': 'Кошумча',
    'det.comment': 'Курьерге эскертүү',
    'det.payment': 'Төлөм',
    'det.contact': 'Ким тосуп алат',
    'det.map': 'Картадан көрсөтүү',
    'det.copied': 'Заказдын номери көчүрүлдү',
    'det.open': 'Заказдын деталдары',
    'det.none': 'Эч нерсе кошулган жок',

    'give.what': 'Заказымды карап туруңуз: абалы жана жолдогу убакыты көрүнөт.',
    'give.copied': 'Шилтеме көчүрүлдү — анда заказдын абалы менен убактысы гана көрүнөт',
    'give.note': 'Шилтемеден заказдын абалы жана болжолдуу убакыт көрүнөт. '
      + 'Телефон, батир жана так дарек көрсөтүлбөйт.',
    'give.guest': 'Сиз заказды шилтеме аркылуу көрүп жатасыз: унаа менен абалы гана көрүнөт',

    'gift.title': 'Бонустар',
    'gift.after_ride': 'Бул сапардын кэшбеги эсепке түштү',
    'gift.rated': 'Рахмат! {sum} бонус кошулду',
  },
});

/* Статусы, после которых заказ больше не меняется. */
const CLOSED = ['done', 'cancelled', 'expired'];

/* Статусы, на которых машина едет и карта имеет право вести её за собой. */
const DRIVING = ['assigned', 'to_pickup', 'in_transit'];

/* Сколько едет машина между двумя точками от сервера, когда карта её не ведёт:
   координаты приходят раз в несколько секунд, и такая длительность выглядит
   как непрерывное движение, а не как прыжок. */
const CAR_MOVE_MS = 1400;

/* Живое время подачи. Сервер присылает только координаты, поэтому время до
   подачи считаем сами: прямую между машиной и точкой умножаем на коэффициент
   дороги (по прямой в городе не ездит никто) и делим на скорость, которую
   меряем по самой машине. Между посылками координат счётчик просто идёт вниз —
   так цифра живёт, а не висит колом до следующего обновления. */
const ROAD_FACTOR = 1.35;
const SPEED_START = 8;        // м/с, около 29 км/ч — обычный ход по Бишкеку
const SPEED_MIN = 3;
const SPEED_MAX = 22;
const SPEED_STEP_S = 3;       // короче этого отрезка скорость не меряем
const SPEED_STEP_M = 15;      // и короче этого тоже: иначе меряем дрожание GPS
const ETA_MIN_S = 40;
const ETA_MAX_S = 7200;
const ETA_SMOOTH_S = 70;      // расхождение меньше этого сглаживаем, а не рвём

/* Насколько близко к маршруту должна быть машина, чтобы верить, что она едет
   именно по нему: дальше этого гасить пройденное — значит врать. */
const ON_ROUTE_M = 400;

/* Ключи в localStorage: рекорд в игре и избранные курьеры. */
const KEY_BEST = 'sg_catch_best';
const KEY_FAV = 'sg_fav_couriers';
const FAV_MAX = 20;

/* Наложения этого экрана. Всё, что открывается поверх карты, живёт в адресе:
   #/order/AB12CD/~chat?t=… — перезагрузка возвращает человека туда же. */
const OVERLAYS = ['chat', 'details', 'rate', 'game'];

/* Готовые ответы на «что пошло не так». Код уходит в комментарий словами:
   диспетчеру важнее прочитать фразу, чем расшифровывать код. */
const BAD_REASONS = [
  ['late', 'mood.r_late'],
  ['damage', 'mood.r_damage'],
  ['rude', 'mood.r_rude'],
  ['price', 'mood.r_price'],
  ['other', 'mood.r_other'],
];

/* Заголовок шторки и подсказка под ним для каждого статуса. */
const HEAD = {
  draft: ['track.searching', 'track.searching_hint'],
  searching: ['track.searching', 'track.searching_hint'],
  assigned: ['track.found', 'track.assigned_hint'],
  to_pickup: ['track.to_pickup', ''],
  at_pickup: ['track.at_pickup', 'track.loading'],
  in_transit: ['track.in_transit', ''],
  at_dropoff: ['track.at_dropoff', ''],
  done: ['track.done', ''],
  cancelled: ['track.cancelled', ''],
  expired: ['track.expired', 'track.expired_hint'],
};

/* Своя разметка — можно вставлять через html. Для чужого текста этого нет нигде. */
const SEND_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M4.2 11.3 19.4 4.6c.7-.3 1.4.4 1.1 1.1l-6.7 15.2c-.3.7-1.3.7-1.5-.1' +
  'l-1.7-5.3-5.3-1.7c-.8-.2-.8-1.2-.1-1.5z" fill="currentColor"/></svg>';

/* Флажок точки назначения: в общем наборе значков его нет, а «куда» без флажка
   читается как ещё одна промежуточная точка. */
const FLAG_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M6.4 3.4v17.2" fill="none" stroke="currentColor" stroke-width="1.9" ' +
  'stroke-linecap="round"/><path d="M6.4 4.6h10.9l-2.3 3.6 2.3 3.6H6.4z" ' +
  'fill="currentColor"/></svg>';

const DOWN_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 5v13m0 0 5.5-5.5M12 18l-5.5-5.5" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ─────────────────────────────────────────────────────── свои стили

   Игра, чат, детали и экран оценки живут только на этом экране, поэтому и
   правила они везут с собой: в client.css их пришлось бы искать через файл,
   который правят соседние модули. Цвета — только из токенов, тогда светлая и
   тёмная темы работают сами, без второго набора правил. */
const OWN_CSS = `
/* ── игра «поймай коробку»: открывается кнопкой, закрывается крестиком ──── */

.sg-play {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  opacity: 0;
  transform: translateY(14px);
  /* Пока экран уезжает, он не должен ловить нажатия вместо карты под ним. */
  pointer-events: none;
  transition: opacity var(--dur-2) var(--ease), transform var(--dur-2) var(--ease);
}
.sg-play--in { opacity: 1; transform: none; pointer-events: auto; }
.sg-play.is-hit { animation: sg-play-hit var(--dur-2) var(--ease); }

@keyframes sg-play-hit {
  0%, 100% { transform: none; }
  30% { transform: translateX(-6px); }
  70% { transform: translateX(6px); }
}

.sg-play__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: calc(var(--safe-t) + var(--sp-2)) var(--sp-3) var(--sp-2) var(--sp-4);
  border-bottom: 1px solid var(--line-soft);
  background: var(--surface);
}

.sg-play__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 700;
  letter-spacing: -.01em;
}

.sg-play__hearts { display: flex; gap: 3px; color: var(--err); font-size: 14px; }
.sg-play__hearts i.is-off { color: var(--surface-3); }

.sg-play__score {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px var(--sp-3);
  border-radius: var(--r-full);
  background: var(--accent-soft);
  font-size: var(--fs-sm);
}
.sg-play__score b {
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.sg-play__x {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--muted);
}
.sg-play__x:active { transform: scale(.92); color: var(--text); }
.sg-play__x > svg { width: 20px; height: 20px; }

.sg-play__stage { position: relative; flex: 1 1 auto; min-height: 0; }

.sg-play__cv {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}
.sg-play__cv:active { cursor: grabbing; }

.sg-play__hint {
  position: absolute;
  left: var(--sp-4);
  right: var(--sp-4);
  top: var(--sp-4);
  color: var(--muted);
  font-size: var(--fs-sm);
  text-align: center;
  pointer-events: none;
}

.sg-play__over {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg);
  text-align: center;
}

.sg-play__over-title {
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 800;
  letter-spacing: -.02em;
}
.sg-play__over-sub { color: var(--muted); font-size: var(--fs-body); }

.sg-play__foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4) calc(var(--sp-3) + var(--safe-b));
  border-top: 1px solid var(--line-soft);
  background: var(--surface);
  color: var(--muted);
  font-size: var(--fs-sm);
  line-height: 1.35;
}
.sg-play__foot .progress { flex: none; width: 64px; }

.sg-play__best {
  flex: none;
  color: var(--muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* Строка «Поиграть» в шторке: значок в жёлтом кружке, как у остальных строк. */
.sg-play__ico { font-size: 20px; line-height: 1; }

/* ── чат с курьером ────────────────────────────────────────────────────── */

.sg-chat {
  position: fixed;
  inset: 0;
  /* --sg-kb — высота экранной клавиатуры: без неё поле ввода уезжает под неё */
  bottom: var(--sg-kb, 0px);
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  opacity: 0;
  transform: translateY(14px);
  pointer-events: none;
  transition: opacity var(--dur-2) var(--ease), transform var(--dur-2) var(--ease);
}
.sg-chat--in { opacity: 1; transform: none; pointer-events: auto; }

.sg-chat__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: calc(var(--safe-t) + var(--sp-2)) var(--sp-3) var(--sp-2);
  border-bottom: 1px solid var(--line-soft);
  background: var(--surface);
}

.sg-chat__who { flex: 1 1 auto; min-width: 0; }
.sg-chat__name {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 700;
}
.sg-chat__car {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: var(--fs-xs);
}

.sg-chat__wa {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r-full);
  background: var(--ok-soft);
  color: var(--ok);
}
.sg-chat__wa:active { transform: scale(.92); }
.sg-chat__wa > svg { width: 22px; height: 22px; }

.sg-chat__wrap { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }

.sg-chat__list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: var(--sp-3) var(--sp-3) var(--sp-4);
}

.sg-chat__day {
  align-self: center;
  padding: 3px var(--sp-3);
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--muted);
  font-size: var(--fs-xs);
}

.sg-chat__empty {
  margin: auto;
  max-width: 30ch;
  color: var(--muted);
  font-size: var(--fs-sm);
  line-height: 1.45;
  text-align: center;
}

/* Кнопка «новые сообщения»: появляется, только если человек читает старое.
   Прокрутку под ним мы не трогаем — он сам решит, когда спуститься вниз. */
.sg-jump {
  position: absolute;
  left: 50%;
  bottom: var(--sp-3);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 44px;
  padding: 0 var(--sp-4);
  border-radius: var(--r-full);
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  transform: translate(-50%, 8px);
  opacity: 0;
  transition: opacity var(--dur-2) var(--ease), transform var(--dur-2) var(--ease);
}
.sg-jump--in { opacity: 1; transform: translate(-50%, 0); }
.sg-jump:active { transform: translate(-50%, 0) scale(.95); }
.sg-jump > svg { width: 16px; height: 16px; }

.sg-msg {
  max-width: 84%;
  align-self: flex-start;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md) var(--r-md) var(--r-md) var(--r-xs);
  background: var(--surface);
  border: 1px solid var(--line-soft);
  animation: sg-msg-in var(--dur-2) var(--ease) both;
}
.sg-msg--mine {
  align-self: flex-end;
  border-radius: var(--r-md) var(--r-md) var(--r-xs) var(--r-md);
  border-color: transparent;
  background: var(--accent-soft);
}
/* Пузыри, которые уже были на экране, при пересборке списка не мигают. */
.sg-msg--quiet { animation: none; }
.sg-msg--wait { opacity: .62; }
.sg-msg--fail { border-color: var(--err); cursor: pointer; }
.sg-msg--fail:active { transform: scale(.98); }

@keyframes sg-msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

.sg-msg__text {
  display: block;
  font-size: var(--fs-body);
  line-height: 1.4;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.sg-msg__meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 2px;
  color: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.sg-msg__tick { letter-spacing: -3px; color: var(--muted-2); }
.sg-msg__tick.is-read { color: var(--info); letter-spacing: -3px; }
.sg-msg__tick.is-fail { color: var(--err); letter-spacing: 0; }
.sg-msg__tick.is-wait { letter-spacing: 0; }

.sg-chat__note {
  flex: none;
  padding: var(--sp-2) var(--sp-4);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: var(--fs-xs);
  line-height: 1.4;
  text-align: center;
}

.sg-chat__form {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3) calc(var(--sp-2) + var(--safe-b));
  border-top: 1px solid var(--line-soft);
  background: var(--surface);
}

.sg-chat__input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 44px;
  max-height: 122px;
  padding: 11px var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--font-text);
  font-size: 16px;
  line-height: 1.35;
  resize: none;
}
.sg-chat__input:focus { border-color: var(--accent-line); outline: none; }
.sg-chat__input::placeholder { color: var(--muted-2); }

.sg-chat__send {
  flex: none;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: var(--r-full);
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-accent);
  transition: transform var(--dur-1) var(--ease), opacity var(--dur-1) var(--ease);
}
.sg-chat__send:disabled { opacity: .4; box-shadow: none; }
.sg-chat__send:active:not(:disabled) { transform: scale(.92); }
.sg-chat__send > svg { width: 20px; height: 20px; }

/* Счётчик непрочитанных на кнопке чата. */
.sg-unread {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: var(--r-full);
  background: var(--err);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ── карточка курьера: номер и аватар нажимаются ───────────────────────── */

/* Сама табличка ростом 26 px, а пальцу нужны 44 — кнопка вокруг неё выше
   таблички и прозрачна: видно номер, а нажимается всё поле вокруг. */
.sg-plate-btn {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0;
  background: none;
  cursor: pointer;
}
.sg-plate-btn:active .sg-plate { background: var(--surface-3); transform: scale(.96); }
.sg-plate-btn .sg-plate { transition: transform var(--dur-1) var(--ease); }

.sg-ava-tap { cursor: pointer; }
.sg-ava-tap:active { transform: scale(.96); }

/* Иконка на кнопке лежит в обёртке, а правило components.css достаёт только
   прямых потомков — размер задаём сами, иначе svg схлопывается в ноль. */
.sg-acts .btn > span { display: inline-flex; }
.sg-acts .btn > span > svg { flex: none; width: 20px; height: 20px; }

/* ── детали заказа во весь экран ───────────────────────────────────────── */

.sg-det .sheet__body > * + * { margin-top: var(--sp-4); }

/* Чипы быстрых действий идут одной строкой и уезжают вбок: перенос столбиком
   съедает пол-экрана и превращает второстепенное в главное. */
.sg-det__chips > .chip { flex: none; }

/* В расчёте цены важна сумма, а не слово: подпись спокойная, цифра чёрная. */
.sg-det__sum .rowgroup__label { font-weight: 500; }
.sg-det__sum .rowgroup__val {
  color: var(--text);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.sg-det__note {
  padding: 0 var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-sm);
  line-height: 1.45;
}

/* Итоговая строка в группе цены крупнее остальных: глаз должен цепляться
   за неё первой, а не пересчитывать столбик сам. */
.sg-det__total .rowgroup__label {
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 800;
}
.sg-det__total .rowgroup__val {
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 800;
}

/* ── оценка с эмоцией ──────────────────────────────────────────────────── */

.sg-mood-wrap { position: relative; width: 100%; }

.sg-mood {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding-top: var(--sp-2);
}

.sg-mood__face {
  position: relative;
  display: flex;
  gap: var(--sp-2);
  font-size: 46px;
  line-height: 1;
  user-select: none;
  -webkit-user-select: none;
}

.sg-mood--sad .sg-mood__face { animation: sg-sad 2.8s var(--ease) infinite; }
.sg-mood--glad .sg-mood__face i { animation: sg-jump 1.1s var(--ease-spring) infinite; }
.sg-mood--glad .sg-mood__face i:nth-child(2) { animation-delay: .12s; }
.sg-mood--glad .sg-mood__face i:nth-child(3) { animation-delay: .24s; }

@keyframes sg-sad {
  0%, 100% { transform: translateY(0) rotate(-5deg); }
  50% { transform: translateY(5px) rotate(5deg); }
}

@keyframes sg-jump {
  0%, 100% { transform: translateY(0) scale(1); }
  40% { transform: translateY(-12px) scale(1.06); }
  70% { transform: translateY(0) scale(.97); }
}

.sg-mood__tear {
  position: absolute;
  left: 46%;
  top: 58%;
  width: 6px;
  height: 8px;
  border-radius: 60% 0 60% 60%;
  background: var(--info);
  opacity: 0;
  animation: sg-tear 2.4s linear infinite;
}
.sg-mood__tear--b { left: 26%; animation-delay: 1.2s; }

@keyframes sg-tear {
  0% { opacity: 0; transform: translateY(0) scale(.6); }
  18% { opacity: .9; transform: translateY(0) scale(1); }
  70% { opacity: .9; transform: translateY(26px) scale(1); }
  100% { opacity: 0; transform: translateY(40px) scale(.8); }
}

.sg-mood__title {
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 700;
  letter-spacing: -.01em;
  text-align: center;
}

.sg-mood__text {
  max-width: 32ch;
  color: var(--muted);
  font-size: var(--fs-sm);
  line-height: 1.45;
  text-align: center;
}

.sg-mood__need {
  color: var(--warn);
  font-size: var(--fs-xs);
  text-align: center;
}

/* Экран оценки: одна колонка по центру, кнопка внизу во всю ширину. */
.sg-mood-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
}
.sg-mood-screen > * { width: 100%; }
/* Звёзды тянуть во всю ширину нельзя: закрашенная половина у них лежит
   абсолютом и считается от ширины всей коробки — растянутая коробка рисует
   второй ряд звёзд поверх первого. */
.sg-mood-screen > .stars { width: max-content; margin-inline: auto; }

/* Конфетти: восемнадцать бумажек, один проход и узел сам себя убирает. */
.sg-conf {
  position: absolute;
  inset: -8px 0 -40px;
  overflow: hidden;
  pointer-events: none;
}

.sg-conf i {
  position: absolute;
  top: 0;
  left: var(--x);
  width: 7px;
  height: 11px;
  border-radius: 2px;
  background: var(--c);
  opacity: 0;
  animation: sg-conf 1.5s var(--ease-in) var(--d) forwards;
}

@keyframes sg-conf {
  0% { opacity: 1; transform: translateY(-10px) rotate(0); }
  100% { opacity: 0; transform: translateY(var(--fall)) rotate(var(--r)); }
}

/* Строка «сохранить курьера в избранные»: нажимается вся целиком. */
.sg-fav {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 56px;
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  cursor: pointer;
}
.sg-fav__ico { font-size: 22px; line-height: 1; }
.sg-fav__text { flex: 1 1 auto; min-width: 0; }
/* Заголовок строки списка обычно в одну строку с многоточием, но здесь это
   предложение целиком — пусть переносится, обрезанное слово читается хуже. */
.sg-fav__text .sg-item__title { white-space: normal; overflow: visible; }

/* Оценка прямо в шторке: крупные звёзды и одна строка приглашения. */
.sg-stars-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
  border-radius: var(--r-lg);
  background: var(--surface-2);
}
.sg-stars-box__title {
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 700;
  letter-spacing: -.01em;
  text-align: center;
}
.sg-stars-box__sub { color: var(--muted); font-size: var(--fs-sm); text-align: center; }

@media (prefers-reduced-motion: reduce) {
  .sg-mood--sad .sg-mood__face,
  .sg-mood--glad .sg-mood__face i,
  .sg-mood__tear { animation: none; }
  .sg-mood__tear { opacity: .9; }
  .sg-msg { animation: none; }
}
`;

let cssDone = false;

function ensureCss() {
  if (cssDone || typeof document === 'undefined' || !document.head) return;
  cssDone = true;
  document.head.appendChild(el('style', { id: 'sg-track-css', text: OWN_CSS }));
}

/* ─────────────────────────────────────────────────────── память устройства */

function readBest() {
  const v = Math.round(Number(readJson(KEY_BEST, 0)) || 0);
  return v > 0 && v < 100000 ? v : 0;
}

function saveBest(v) {
  writeJson(KEY_BEST, Math.max(0, Math.round(v) || 0));
}

/* Курьера узнаём по госномеру: внутреннего id клиенту не показывают, а номер
   у машины один и меняется реже, чем что-либо ещё. */
function favKey(c) {
  const car = (c && c.car) || {};
  return String(car.plate || (c && c.name) || '').toUpperCase().replace(/\s+/g, '');
}

function favList() {
  const v = readJson(KEY_FAV, []);
  return Array.isArray(v) ? v.filter((x) => x && x.key) : [];
}

function isFav(c) {
  const key = favKey(c);
  return !!key && favList().some((x) => x.key === key);
}

function setFav(c, on) {
  const key = favKey(c);
  if (!key) return false;
  const list = favList().filter((x) => x.key !== key);
  if (on) {
    list.unshift({
      key,
      name: (c && c.name) || '',
      plate: ((c && c.car) || {}).plate || '',
      at: Math.floor(Date.now() / 1000),
    });
  }
  writeJson(KEY_FAV, list.slice(0, FAV_MAX));
  return on;
}

/* ─────────────────────────────────────────────────────── игра на время ожидания */

/* Коробки падают сверху, кузов ездит за пальцем. Правил нет: поймал — очко,
   промахнулся — минус попытка, рекорд остаётся на устройстве.

   Игра открывается только кнопкой и занимает весь экран: маленькая карточка
   поверх карты мешала и карте, и игре. Всё рисуется руками на canvas — на
   слабом телефоне это дешевле десятка движущихся узлов, а кадры идут только
   пока вкладка на переднем плане: в фоне цикл останавливается совсем. */
function createCatchGame(onClose) {
  const state = {
    w: 0, h: 0, dpr: 1,
    points: 0, lives: 3, best: readBest(),
    over: false, live: false, dead: false,
    spawnIn: 600, raf: 0, last: 0, rect: null,
  };
  const truck = { x: 0, to: 0, w: 96, h: 30 };
  let boxes = [];
  let pops = [];

  const scoreOut = el('b', null, '0');
  const bestOut = el('span', { className: 'sg-play__best' });
  const hearts = el('span', { className: 'sg-play__hearts' });
  const closeBtn = iconBtn('close', 'sg-play__x', t('game.close'), () => {
    haptic();
    if (onClose) onClose();
  });
  const head = el('div', { className: 'sg-play__head' },
    el('div', { className: 'sg-play__title' }, t('game.title')),
    hearts,
    el('span', { className: 'sg-play__score' }, '📦', scoreOut),
    closeBtn);

  const cv = el('canvas', { className: 'sg-play__cv' });
  const hint = el('div', { className: 'sg-play__hint' }, t('game.hint'));
  const over = el('div', { className: 'sg-play__over', hidden: true });
  const stage = el('div', { className: 'sg-play__stage' }, cv, hint, over);
  const waitText = el('span', { className: 'grow' }, t('game.wait'));
  const foot = el('div', { className: 'sg-play__foot' },
    el('div', { className: 'progress progress--wait' }, el('div', { className: 'progress__bar' })),
    waitText,
    bestOut);
  const node = el('div', {
    className: 'sg-play', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('game.title'),
  }, head, stage, foot);

  const ctx = cv.getContext('2d');
  // Кузов и дорога рисуются цветами темы. Читаем их один раз при показе и на
  // смене темы: спрашивать getComputedStyle в каждом кадре — лишняя работа.
  let colors = { accent: '#FFDF00', line: '#E2DFD6', muted: '#9A978E' };

  function readColors() {
    const cs = getComputedStyle(node);
    const one = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    colors = {
      accent: one('--accent', '#FFDF00'),
      line: one('--line', '#E2DFD6'),
      muted: one('--muted-2', '#9A978E'),
    };
  }

  const offTheme = onThemeChange(() => {
    readColors();
    if (state.live) draw();
  });

  /* ── размеры ───────────────────────────────────────────────────────────── */

  function fit() {
    const w = Math.max(160, Math.round(stage.clientWidth));
    const h = Math.max(160, Math.round(stage.clientHeight));
    if (w === state.w && h === state.h) return;
    const kx = state.w ? w / state.w : 1;
    state.w = w;
    state.h = h;
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * state.dpr);
    cv.height = Math.round(h * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.rect = null;
    truck.w = Math.round(clamp(w * 0.26, 76, 140));
    truck.h = Math.round(truck.w * 0.32);
    truck.x = truck.x ? truck.x * kx : w / 2;
    truck.to = truck.to ? truck.to * kx : w / 2;
    for (const b of boxes) b.x *= kx;
    draw();
  }

  let sizes = null;
  if (typeof ResizeObserver === 'function') {
    sizes = new ResizeObserver(() => fit());
    sizes.observe(stage);
  }

  /* ── управление одним пальцем ──────────────────────────────────────────── */

  function aimAt(clientX) {
    if (!state.rect) state.rect = cv.getBoundingClientRect();
    const x = clientX - state.rect.left;
    truck.to = clamp(x, truck.w / 2, Math.max(truck.w / 2, state.w - truck.w / 2));
  }

  cv.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    hint.hidden = true;
    state.rect = cv.getBoundingClientRect();
    aimAt(e.clientX);
    try {
      cv.setPointerCapture(e.pointerId);
    } catch (err) { /* мышь без захвата — не беда */ }
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    aimAt(e.clientX);
  });

  /* ── ход игры ──────────────────────────────────────────────────────────── */

  /* Скорость считаем от высоты поля, а не в пикселях: на большом экране
     коробка с постоянной скоростью летит вниз секунд восемь, и это уже не игра,
     а ожидание внутри ожидания. */
  function spawn() {
    const size = 20 + Math.round(Math.random() * 12);
    const step = Math.max(160, state.h);
    boxes.push({
      x: size + Math.random() * Math.max(1, state.w - size * 2),
      y: -size,
      size,
      v: Math.min(step * 0.9, step * 0.32 + state.points * step * 0.012)
         + Math.random() * step * 0.07,
      a: (Math.random() - 0.5) * 0.6,
      s: (Math.random() - 0.5) * 1.6,
    });
  }

  function paintHead() {
    scoreOut.textContent = String(state.points);
    bestOut.textContent = '🏆 ' + state.best;
    const list = [];
    for (let i = 0; i < 3; i++) {
      list.push(el('i', { className: i < state.lives ? '' : 'is-off' }, '♥'));
    }
    hearts.replaceChildren(...list);
  }

  function hitShake() {
    node.classList.remove('is-hit');
    void node.offsetWidth;                 // фиксируем кадр, иначе повтор не сыграет
    node.classList.add('is-hit');
  }

  function finish() {
    state.over = true;
    halt();
    if (state.points > state.best) state.best = state.points;
    saveBest(state.best);
    paintHead();
    over.replaceChildren(
      el('div', { className: 'sg-play__over-title' },
         state.points >= state.best && state.points > 0 ? t('game.new_best') : t('game.over')),
      el('div', { className: 'sg-play__over-sub' }, t('game.caught', { n: state.points })),
      el('button', {
        type: 'button', className: 'btn btn--primary btn--lg', onClick: restart,
      }, t('game.again')));
    over.hidden = false;
  }

  function restart() {
    haptic();
    boxes = [];
    pops = [];
    state.points = 0;
    state.lives = 3;
    state.spawnIn = 500;
    state.over = false;
    over.hidden = true;
    paintHead();
    run();
  }

  function step(dt) {
    // Кузов догоняет палец мягко: рывок читается хуже, чем короткое доведение.
    truck.x += (truck.to - truck.x) * Math.min(1, dt * 13);

    state.spawnIn -= dt * 1000;
    if (state.spawnIn <= 0) {
      if (boxes.length < 7) spawn();
      state.spawnIn = Math.max(420, 950 - state.points * 16);
    }

    const groundY = state.h - 18;
    const top = groundY - truck.h;
    const keep = [];
    for (const b of boxes) {
      b.y += b.v * dt;
      b.a += b.s * dt;
      if (b.y + b.size / 2 >= top) {
        if (Math.abs(b.x - truck.x) <= truck.w / 2 + b.size * 0.3) {
          state.points += 1;
          if (state.points > state.best) state.best = state.points;
          pops.push({ x: b.x, y: top, life: 0 });
          if (pops.length > 5) pops.shift();
          paintHead();
          haptic(8);
          continue;
        }
        if (b.y - b.size / 2 > state.h) {
          state.lives -= 1;
          paintHead();
          hitShake();
          haptic(24);
          if (state.lives <= 0) {
            boxes = keep;
            finish();
            return;
          }
          continue;
        }
      }
      keep.push(b);
    }
    boxes = keep;

    for (const p of pops) p.life += dt;
    pops = pops.filter((p) => p.life < 0.7);
  }

  /* ── рисование ─────────────────────────────────────────────────────────── */

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBox(b) {
    const s = b.size;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    ctx.fillStyle = '#D9A25F';
    rr(-s / 2, -s / 2, s, s, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.26)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-s / 2, 0);
    ctx.lineTo(s / 2, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawTruck(baseY) {
    const w = truck.w;
    const h = truck.h;
    const left = truck.x - w / 2;
    const top = baseY - h;
    ctx.fillStyle = colors.accent;
    rr(left, top, w * 0.6, h, 5);
    ctx.fill();
    ctx.beginPath();                        // кабина
    ctx.moveTo(left + w * 0.6, top + h * 0.3);
    ctx.lineTo(left + w * 0.82, top + h * 0.3);
    ctx.lineTo(left + w, top + h * 0.62);
    ctx.lineTo(left + w, top + h);
    ctx.lineTo(left + w * 0.6, top + h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.24)';      // окно
    rr(left + w * 0.66, top + h * 0.4, w * 0.16, h * 0.26, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.55)';      // колёса
    for (const k of [0.2, 0.82]) {
      ctx.beginPath();
      ctx.arc(left + w * k, baseY + 1, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw() {
    if (!state.w) return;
    const groundY = state.h - 18;
    ctx.clearRect(0, 0, state.w, state.h);

    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 8);
    ctx.lineTo(state.w, groundY + 8);
    ctx.stroke();

    for (const b of boxes) drawBox(b);
    drawTruck(groundY);

    if (pops.length) {
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const p of pops) {
        ctx.globalAlpha = Math.max(0, 1 - p.life / 0.7);
        ctx.fillStyle = colors.accent;
        ctx.fillText('+1', p.x, p.y - 10 - p.life * 34);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ── цикл ──────────────────────────────────────────────────────────────── */

  function frame(now) {
    state.raf = 0;
    if (state.dead || !state.live || state.over) return;
    const dt = Math.min(0.05, (now - (state.last || now)) / 1000);
    state.last = now;
    step(dt);
    draw();
    if (!state.over) state.raf = requestAnimationFrame(frame);
  }

  function run() {
    if (state.dead || state.raf || !state.live || state.over) return;
    if (document.visibilityState === 'hidden') return;
    state.last = 0;
    state.raf = requestAnimationFrame(frame);
  }

  function halt() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  // Вкладка ушла в фон — цикл останавливается совсем: батарея дороже коробок.
  function onVis() {
    if (document.visibilityState === 'hidden') halt();
    else run();
  }
  document.addEventListener('visibilitychange', onVis);

  const hintTimer = setTimeout(() => { hint.hidden = true; }, 5000);

  paintHead();

  return {
    node,

    /** Игра встала на экран — считаем кадры. */
    start() {
      if (state.dead || state.live) return;
      state.live = true;
      readColors();                  // до вставки в страницу цвета темы не спросить
      fit();
      run();
    },

    /** Сменился язык — переписываем подписи, не сбрасывая счёт. */
    relang() {
      hint.textContent = t('game.hint');
      waitText.textContent = t('game.wait');
      closeBtn.setAttribute('aria-label', t('game.close'));
      closeBtn.title = t('game.close');
      node.setAttribute('aria-label', t('game.title'));
      head.firstChild.textContent = t('game.title');
      paintHead();
      if (state.over) finish();
    },

    destroy() {
      state.dead = true;
      state.live = false;
      halt();
      clearTimeout(hintTimer);
      document.removeEventListener('visibilitychange', onVis);
      if (sizes) sizes.disconnect();
      offTheme();
      if (state.points > state.best) state.best = state.points;
      saveBest(state.best);
      node.remove();
    },
  };
}

/* ─────────────────────────────────────────────────────── экран отслеживания */

export function mountTrack(app, pid, token) {
  ensureCss();

  const store = createStore({
    order: null,
    loading: true,
    error: null,
    online: true,
    rated: false,
  });

  let view = null;
  let stream = null;
  let dead = false;
  let markers = [];
  let line = null;          // маршрут от точки А до точки Б
  let lead = null;          // пунктир от машины до точки подачи
  let radar = null;
  let car = null;
  let mapKey = '';

  const base = '/orders/' + encodeURIComponent(pid);
  const map = app.map || null;
  const canFollow = !!(map && typeof map.follow === 'function');

  /* Наблюдатель за наложениями отписывается в destroy: без этого закрытый
     экран продолжал бы открывать чужой чат. */
  let offOverlay = null;
  let overlayNow = '';        // какое наложение показываем прямо сейчас
  let overlayWanted = '';     // адрес просит наложение, а заказ ещё не загружен
  let overlaySheet = null;    // шторка наложения, если она сейчас открыта
  let byRouter = false;       // закрывает роутер, а не человек
  let rateStart = 0;          // с какой звезды открыли экран оценки

  function guest(order) {
    return !!(order && order.readonly);
  }

  /* ── карта ───────────────────────────────────────────────────────────── */

  function points(order) {
    return (order && Array.isArray(order.points) ? order.points : [])
      .filter((p) => p && p.lat != null);
  }

  function routeOf(order) {
    return Array.isArray(order && order.route) && order.route.length > 1 ? order.route : null;
  }

  function syncMap(order) {
    if (!order) return;
    const pts = points(order);
    const path = routeOf(order);
    const key = order.status + '|' + pts.map((p) => p.lat.toFixed(5) + p.lng.toFixed(5)).join(';')
      + '|' + (path ? path.length : 0);
    if (key !== mapKey) {
      mapKey = key;
      for (const m of markers) m.remove();
      markers = pts.map((p, i) => app.marker({
        at: [p.lat, p.lng],
        html: i === 0 ? pin('a') : pin('b', pts.length > 2 ? String(i + 1) : ''),
        anchor: i === 0 ? 'center' : 'bottom',
        zIndex: 10 + i,
      }));

      if (path) {
        if (line) line.setCoords(path);
        else line = app.route(path, { width: 6 });
        measureRoute(path);
      } else if (line) {
        line.remove();
        line = null;
        routeMeta = null;
      }

      // Пока ищем машину, вокруг точки подачи расходятся круги — видно, что работа идёт.
      const searching = isSearching(order);
      if (searching && pts.length && !radar) {
        radar = app.marker({
          at: [pts[0].lat, pts[0].lng], html: '<span class="sg-radar"></span>', zIndex: 30,
        });
      }
      if (!searching && radar) { radar.remove(); radar = null; }

      fitAll(order);
    }

    syncCar(order);
    syncLive(order);
  }

  function fitAll(order, force) {
    // Пока карта сама ведёт машину, подгонять вид нельзя: два хозяина у одного
    // вида — это дёрганье на каждой посылке координат.
    if (following && !force) return;
    const pts = points(order).map((p) => [p.lat, p.lng]);
    const at = order.courier && order.courier.at && order.courier.at[0] != null
      ? [order.courier.at] : [];
    if (order.status === 'searching' || order.status === 'draft') {
      if (pts.length) app.fit([pts[0]], { zoom: 15.5, maxZoom: 15.5 });
      return;
    }
    if (order.status === 'assigned' || order.status === 'to_pickup') {
      const set = at.concat(pts.slice(0, 1));
      app.fit(set.length ? set : pts);
      return;
    }
    const path = routeOf(order) || pts;
    app.fit(at.concat(path));
  }

  /* ── живая карта подачи ──────────────────────────────────────────────── */

  let following = false;
  let followZoomNow = 0;      // какой зум сейчас просили у слежения
  let followAnchorNow = 0;    // и на какой высоте держим машину
  let followHold = 0;         // до этого времени слежение молчит: человек смотрит маршрут

  /* Человек попросил показать весь маршрут — слежение уступает место на
     полминуты. Без паузы карта вернулась бы к машине через пару секунд, и
     маршрут человек так и не увидел бы. */
  function showWholeRoute() {
    const order = store.get().order;
    if (!order) return;
    followHold = Date.now() + 30000;
    if (following && canFollow) { map.unfollow(); following = false; followZoomNow = 0; }
    fitAll(order, true);
  }

  /* Свободная часть карты — та, которую не закрывает шторка. Из неё берём и
     место для машины (иначе фургон прячется под панелью ровно тогда, когда на
     него смотрят), и радиус кадра, в который обязана влезть цель. */
  function freeBox() {
    const box = map && map.el ? map.el : null;
    const tall = (box ? box.clientHeight : 0) || window.innerHeight || 640;
    const wide = (box ? box.clientWidth : 0) || window.innerWidth || 390;
    let panel = 0;
    try {
      const sheetBox = app.panel && app.panel.el
        ? app.panel.el.querySelector('.sg-panel__box') : null;
      const off = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--sg-panel-off')) || 0;
      if (sheetBox) panel = Math.max(0, sheetBox.getBoundingClientRect().height - off);
    } catch (e) {
      panel = 0;                      // размеры спросить не вышло — берём середину экрана
    }
    const free = Math.max(160, tall - panel);
    return {
      anchor: clamp((free / 2) / tall, 0.22, 0.6),
      radius: Math.max(80, Math.min(wide, free) / 2 - 28),
    };
  }

  /* Метров на пиксель у веб-меркатора на широте Бишкека: 156543·cos(42,9°).
     По нему считаем зум, при котором и машина, и цель влезают в свободный кадр:
     «вплотную» человек видит двор, но не видит, что фургон ещё в трёх
     километрах. Ступень в ползума — иначе карта ползала бы на каждой посылке. */
  const MPP_ZERO = 114800;

  function followZoom(gap, radius) {
    const need = Math.max(150, gap * 1.15) / Math.max(60, radius);
    return clamp(Math.round(Math.log2(MPP_ZERO / need) * 2) / 2, 12.5, 16.5);
  }

  function syncCar(order) {
    const at = order.courier && order.courier.at;
    if (!at || at[0] == null) {
      if (following && canFollow) { map.unfollow(); following = false; }
      if (car) { car.remove(); car = null; }
      if (lead) { lead.remove(); lead = null; }
      return;
    }
    const fresh = !car;
    if (fresh) {
      car = app.marker({ at, html: pin('car'), rotate: true, zIndex: 40 });
    }

    const goal = etaGoal(order);
    const drive = DRIVING.indexOf(order.status) >= 0;
    const gap = goal ? distanceM(at, goal.ll) : 0;

    if (canFollow && drive && Date.now() >= followHold) {
      const box = freeBox();
      const zoom = followZoom(gap, box.radius);
      const anchor = box.anchor;
      const opts = { marker: car, resume: 6000 };
      if (zoom !== followZoomNow) { opts.zoom = zoom; followZoomNow = zoom; }
      if (Math.abs(anchor - followAnchorNow) > 0.02) {
        opts.anchor = anchor;
        followAnchorNow = anchor;
      }
      map.follow({
        lat: at[0], lng: at[1],
        heading: order.courier.heading,
        speed: order.courier.speed,
      }, opts);
      following = true;
    } else {
      if (following && canFollow) { map.unfollow(); following = false; followZoomNow = 0; }
      car.moveTo(at, { duration: CAR_MOVE_MS, heading: order.courier.heading });
      if (fresh) fitAll(order);
    }

    // Пунктир «машина — точка подачи»: пока фургон едет к человеку, видно,
    // сколько ему осталось. После погрузки поводок не нужен — есть маршрут.
    const toPickup = goal && goal.goal === 'pick';
    if (toPickup) {
      const coords = [at.slice(), goal.ll.slice()];
      if (lead) lead.setCoords(coords);
      else lead = app.route(coords, { width: 3, dashed: true, color: 'var(--muted-2)' });
      leadGoal = goal.ll.slice();
    } else if (lead) {
      lead.remove();
      lead = null;
      leadGoal = null;
    }
  }

  /* Пройденный кусок маршрута гаснет позади машины. Долю считаем по длине, а
     не по числу точек: на прямом проспекте точек мало, а метров много. */
  let routeMeta = null;       // {pts, acc, total}
  let progressNow = 0;
  let leadGoal = null;        // куда тянется пунктир от машины

  function measureRoute(path) {
    const pts = path.map((p) => [Number(p[0]), Number(p[1])]);
    const acc = [0];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += distanceM(pts[i - 1], pts[i]);
      acc.push(total);
    }
    routeMeta = { pts, acc, total };
    progressNow = 0;
    if (line) line.setProgress(0);
  }

  /* Где машина на маршруте, 0…1. Вернём -1, если она далеко от линии: гасить
     маршрут по машине, которая едет в объезд, — значит показывать неправду. */
  function routeShare(ll) {
    const meta = routeMeta;
    if (!meta || meta.total <= 0) return -1;
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < meta.pts.length; i++) {
      const d = distanceM(meta.pts[i], ll);
      if (d < bestGap) { bestGap = d; best = i; }
    }
    if (bestGap > ON_ROUTE_M) return -1;
    return meta.acc[best] / meta.total;
  }

  /* Живое на карте, что нужно обновлять чаще посылок координат: пунктир до
     точки подачи и гаснущий позади машины маршрут. Позицию берём у самого
     маркера — он едет между посылками, и линии живут вместе с ним, а не
     дёргаются раз в несколько секунд. */
  function syncLive(order) {
    const at = car ? car.at() : (order && order.courier && order.courier.at);
    if (lead && leadGoal && at && at[0] != null) {
      lead.setCoords([at, leadGoal]);
    }
    if (!line || !order) return;
    if (order.status === 'done') {
      progressNow = 1;
      line.setProgress(1);
      return;
    }
    if (order.status !== 'in_transit' && order.status !== 'at_dropoff') return;
    if (!at || at[0] == null) return;
    const share = routeShare(at);
    if (share < 0) return;
    // Назад маршрут не «зажигаем»: дрожание GPS иначе моргало бы линией.
    if (share <= progressNow + 0.0008) return;
    progressNow = share;
    line.setProgress(share);
  }

  /* Машину ищем — значит, экрану нечего показывать, кроме бегущей полоски.
     Черновик в ожидании оплаты сюда не входит: там человек занят делом. */
  function isSearching(order) {
    if (!order) return false;
    if (order.status === 'searching') return true;
    return order.status === 'draft' && order.payment_status !== 'pending';
  }

  /* ── живое время подачи ──────────────────────────────────────────────── */

  const eta = {
    at: 0,            // когда ждём машину, unix-секунды
    goal: '',         // к чему считаем: 'pick' — к вам, 'drop' — до выгрузки
    pos: '',          // позиция машины, по которой считали в прошлый раз
    gap: 0,           // сколько метров до цели по дороге
    speed: SPEED_START,
    seen: null,       // прошлая посылка координат: {ll, ms}
  };

  /* Куда едет машина прямо сейчас: сначала к человеку, после погрузки — к
     месту выгрузки. На остальных статусах считать нечего. */
  function etaGoal(order) {
    const pts = points(order);
    if (!pts.length) return null;
    const s = order.status;
    if (s === 'assigned' || s === 'to_pickup') {
      return { ll: [pts[0].lat, pts[0].lng], goal: 'pick' };
    }
    if (s === 'in_transit') {
      const last = pts[pts.length - 1];
      return { ll: [last.lat, last.lng], goal: 'drop' };
    }
    return null;
  }

  function etaReset() {
    eta.at = 0;
    eta.goal = '';
    eta.pos = '';
    eta.gap = 0;
    eta.seen = null;
    eta.speed = SPEED_START;
  }

  /* Пересчёт по новой позиции машины. Зовём на каждое обновление заказа, но
     работаем только когда машина действительно сдвинулась: считать одно и то же
     по десять раз в секунду незачем. */
  function etaFeed(order) {
    const target = etaGoal(order);
    const at = order && order.courier && order.courier.at;
    if (!target || !at || at[0] == null) {
      if (eta.at) etaReset();
      return;
    }
    const key = Number(at[0]).toFixed(5) + ',' + Number(at[1]).toFixed(5);
    if (key === eta.pos && target.goal === eta.goal) return;

    const now = Date.now();
    if (eta.seen && target.goal === eta.goal) {
      const moved = distanceM(eta.seen.ll, at);
      const dt = (now - eta.seen.ms) / 1000;
      // Скорость берём у самой машины, но только на заметных отрезках: на
      // светофоре и на стоянке вышло бы «едет со скоростью пешехода».
      if (dt >= SPEED_STEP_S && moved > SPEED_STEP_M) {
        const v = moved / dt;
        if (v >= SPEED_MIN && v <= SPEED_MAX) eta.speed = eta.speed * 0.6 + v * 0.4;
      }
    } else {
      eta.speed = SPEED_START;
    }
    eta.seen = { ll: at.slice(), ms: now };
    eta.pos = key;

    eta.gap = Math.round(distanceM(at, target.ll) * ROAD_FACTOR);
    const left = eta.gap / Math.max(SPEED_MIN, eta.speed);
    const stamp = Math.floor(now / 1000)
      + Math.round(clamp(left, ETA_MIN_S, ETA_MAX_S));
    // Цель прежняя и расхождение небольшое — усредняем, а не переписываем:
    // иначе «5 минут» скакало бы туда-сюда на каждой посылке координат.
    if (eta.at && target.goal === eta.goal && Math.abs(stamp - eta.at) < ETA_SMOOTH_S) {
      eta.at = Math.round((eta.at + stamp) / 2);
    } else {
      eta.at = stamp;
    }
    eta.goal = target.goal;
  }

  /* Строка под заголовком. Пустая строка значит «сказать нечего» — тогда
     заголовок покажет свою обычную подсказку. */
  function etaText() {
    if (!eta.at) return '';
    const left = eta.at - Math.floor(Date.now() / 1000);
    if (left <= 60) return eta.goal === 'pick' ? t('track.arriving') : t('live.almost');
    const time = duration(left);
    // Только время: расстояние до машины и так стоит табличкой в карточке
    // курьера, а две цифры про одно и то же на экране спорят друг с другом.
    return eta.goal === 'pick' ? t('track.eta', { time }) : t('track.eta_drop', { time });
  }

  /* Пока живой цифры нет (машина ещё не прислала координаты), показываем то,
     что посчитал сервер при оформлении. Лучше приблизительно, чем пусто. */
  function staticSub(order) {
    if (order && order.status === 'in_transit' && order.duration_s) {
      return t('track.eta_drop', { time: duration(order.duration_s) });
    }
    return '';
  }

  /* ── наложения: чат, детали, оценка и игра живут в адресе ────────────── */

  /** Открыть наложение. Адрес меняет роутер, а он позовёт нас обратно. */
  function openMy(name) {
    haptic();
    if (app.router) app.router.overlay(name);
    else applyOverlay(name);
  }

  /** Закрыть наложение так, как это сделал бы человек: через адрес. */
  function closeMy() {
    if (app.router && OVERLAYS.indexOf(app.router.overlayName()) >= 0) {
      app.router.closeOverlay();
      return;
    }
    applyOverlay('');
  }

  /* Адрес обещает наложение, которого быть не может: чат без курьера, оценка
     уже поставленного заказа. Чиним молча заменой записи — лишний шаг истории
     человеку ни к чему. */
  function dropAddress() {
    if (app.router && OVERLAYS.indexOf(app.router.overlayName()) >= 0) {
      app.router.closeOverlay({ replace: true });
    }
  }

  function canOpen(name) {
    const order = store.get().order;
    if (!order) return false;
    if (name === 'chat') return !guest(order) && !!order.courier;
    if (name === 'details') return true;
    if (name === 'rate') {
      return !guest(order) && order.status === 'done' && !store.get().rated;
    }
    if (name === 'game') return isSearching(order);
    return false;
  }

  function shutOverlay() {
    const gone = overlayNow;
    if (!gone) return;
    overlayNow = '';
    byRouter = true;
    try {
      if (gone === 'chat') closeChat();
      else if (gone === 'game') closeGame();
      else if (overlaySheet) {
        const ui = overlaySheet;
        overlaySheet = null;
        ui.close();
      }
    } finally {
      byRouter = false;
    }
  }

  /** Привести экран в соответствие с адресом. Зовёт роутер, зовём и мы сами. */
  function applyOverlay(name) {
    if (dead) return;
    const want = OVERLAYS.indexOf(name) >= 0 ? name : '';
    if (want === overlayNow) return;
    shutOverlay();
    if (!want) return;
    // Заказ ещё грузится — придержим просьбу до первых данных, иначе после
    // перезагрузки с открытым чатом адрес просто потерял бы наложение.
    if (store.get().loading) {
      overlayWanted = want;
      return;
    }
    if (!canOpen(want)) {
      dropAddress();
      return;
    }
    overlayNow = want;
    if (want === 'chat') openChat();
    else if (want === 'game') openGame();
    else if (want === 'details') overlaySheet = buildDetails();
    else if (want === 'rate') overlaySheet = buildRate();
  }

  /* Шторку закрыли крестиком, смахиванием или Esc — адрес обязан догнать,
     иначе перезагрузка снова откроет её поверх карты. */
  function sheetGone() {
    overlaySheet = null;
    if (byRouter) return;
    overlayNow = '';
    if (app.router) app.router.closeOverlay();
  }

  if (app.router && typeof app.router.onOverlay === 'function') {
    offOverlay = app.router.onOverlay((name) => applyOverlay(name));
  }

  /* ── игра, пока ищется машина ────────────────────────────────────────── */

  let game = null;

  function openGame() {
    if (dead || game) return;
    const made = createCatchGame(() => closeMy());
    game = made;
    (document.querySelector('.sg-app') || document.body).appendChild(made.node);
    requestAnimationFrame(() => {
      if (game !== made) return;           // успели закрыть, пока ждали кадр
      made.node.classList.add('sg-play--in');
      made.start();
    });
  }

  /* Игра уезжает с тем же растворением, с каким приехала. now — когда экран
     уже уходит целиком и ждать анимацию не для кого. */
  function closeGame(now) {
    if (!game) return;
    const gone = game;
    game = null;
    gone.node.classList.remove('sg-play--in');
    if (now) gone.destroy();
    else setTimeout(() => gone.destroy(), 300);
  }

  /* ── чат с курьером ──────────────────────────────────────────────────── */

  /* Сообщения держим одним списком. У каждого — свой неизменный ключ: у
     пришедшего с сервера это его id, у своего неподтверждённого — временный.
     Ключ не меняется даже когда сервер подтвердит сообщение: по нему на экране
     находится узел, а сменить ключ значило бы нарисовать пузырь заново. */
  const chat = {
    items: [],
    byId: new Map(),
    pending: [],
    unread: 0,
    loaded: false,
    loading: false,
    tried: false,
    canSend: true,
    note: '',
    maxText: 1000,
    error: null,
    seq: 0,
  };
  let chatUi = null;
  let unreadBadge = null;
  let readTimer = 0;

  /* Текст для сверки: сервер подчищает пробелы и переносы, поэтому сравнивать
     буква в букву нельзя — иначе своё же сообщение вернётся вторым пузырём. */
  function sameText(a, b) {
    return String(a || '').replace(/\s+/g, ' ').trim()
      === String(b || '').replace(/\s+/g, ' ').trim();
  }

  /* Сообщение с сервера в наш список. Возвращает {item, fresh} или null, если
     это повтор. Задвоения нет по построению: сначала ищем по идентификатору,
     потом — свой неподтверждённый пузырь с тем же текстом. */
  function pushMsg(raw) {
    if (!raw || raw.id === undefined || raw.id === null) return null;
    const id = Number(raw.id);
    if (!isFinite(id)) return null;
    const known = chat.byId.get(id);
    if (known) {
      if (raw.read_at && !known.read_at) known.read_at = Number(raw.read_at) || known.read_at;
      return null;
    }
    const mine = raw.mine === undefined ? raw.sender === 'client' : !!raw.mine;
    const text = String(raw.text || '');
    if (mine) {
      const own = chat.pending.find((m) => !m.id && sameText(m.text, text));
      if (own) {                       // это наш же пузырь вернулся из потока
        own.id = id;
        own.at = Number(raw.at) || own.at;
        own.read_at = raw.read_at || null;
        own.pending = false;
        own.failed = false;
        chat.byId.set(id, own);
        chat.pending = chat.pending.filter((m) => m !== own);
        return { item: own, fresh: false };
      }
    }
    const msg = {
      key: 'm' + id,
      id,
      mine,
      text,
      at: Number(raw.at) || Math.floor(Date.now() / 1000),
      read_at: raw.read_at || null,
      pending: false,
      failed: false,
    };
    chat.byId.set(id, msg);
    chat.items.push(msg);
    return { item: msg, fresh: true };
  }

  /* Свой пузырь до ответа сервера: человек видит своё сообщение сразу, а не
     через полсекунды сетевого молчания. */
  function addPending(text) {
    chat.seq += 1;
    const msg = {
      key: 'p' + chat.seq,
      id: 0,
      mine: true,
      text,
      at: Math.floor(Date.now() / 1000),
      read_at: null,
      pending: true,
      failed: false,
    };
    chat.items.push(msg);
    chat.pending.push(msg);
    return msg;
  }

  function dropMsg(msg) {
    chat.items = chat.items.filter((m) => m !== msg);
    chat.pending = chat.pending.filter((m) => m !== msg);
  }

  function paintUnread() {
    if (!unreadBadge) return;
    unreadBadge.textContent = String(chat.unread);
    unreadBadge.hidden = chat.unread < 1;
    const btn = unreadBadge.parentNode;
    if (btn && btn.setAttribute) {
      btn.setAttribute('aria-label', chat.unread
        ? t('talk.title') + '. ' + t('talk.unread', { n: chat.unread })
        : t('talk.title'));
    }
  }

  async function loadChat(force) {
    if (dead || chat.loading) return;
    if (chat.loaded && !force) return;
    chat.loading = true;
    chat.tried = true;
    chat.error = null;
    if (chatUi) chatUi.sync();
    try {
      const res = await api.get(base + '/messages', { t: token, lang: getLang() });
      if (dead) return;
      // Неотправленные пузыри переживают перезагрузку списка: человек их
      // написал, и терять его текст из-за обновления истории нельзя.
      const keep = chat.pending.filter((m) => !m.id);
      chat.items = [];
      chat.byId = new Map();
      chat.pending = [];
      for (const m of (Array.isArray(res.items) ? res.items : [])) pushMsg(m);
      for (const m of keep) {
        chat.items.push(m);
        chat.pending.push(m);
      }
      chat.unread = Math.max(0, Number(res.unread) || 0);
      chat.canSend = res.can_send !== false;
      chat.note = res.message || '';
      chat.maxText = Number(res.max_text) || 1000;
      chat.loaded = true;
    } catch (e) {
      if (dead) return;
      chat.error = e;
    }
    chat.loading = false;
    if (dead) return;
    paintUnread();
    if (chatUi) {
      chatUi.sync(true);
      markRead();
    }
  }

  /* Отметка прочтения уходит пачкой и с задержкой: пока человек листает
     переписку, дёргать сервер на каждое сообщение незачем. */
  function markRead() {
    if (dead || !chatUi) return;
    const need = chat.unread > 0 || chat.items.some((m) => !m.mine && !m.read_at);
    if (!need || readTimer) return;
    readTimer = setTimeout(async () => {
      readTimer = 0;
      try {
        await api.post(base + '/messages/read', { t: token });
      } catch (e) {
        return;                       // не отметилось — отметим со следующим открытием
      }
      if (dead) return;
      const now = Math.floor(Date.now() / 1000);
      for (const m of chat.items) if (!m.mine && !m.read_at) m.read_at = now;
      chat.unread = 0;
      paintUnread();
      if (chatUi) chatUi.sync();
    }, 400);
  }

  function onChatMessage(data) {
    const got = pushMsg(data && data.message);
    if (!got) return;
    if (chatUi) {
      chatUi.sync();
      markRead();
      return;
    }
    if (got.item.mine) return;
    chat.unread += 1;
    paintUnread();
    haptic(14);
    toast(t('talk.new'), { type: 'info' });
  }

  function onChatRead(data) {
    if (!data || data.by !== 'courier') return;
    const ids = new Set((Array.isArray(data.ids) ? data.ids : []).map(Number));
    const at = Number(data.at) || Math.floor(Date.now() / 1000);
    let changed = false;
    for (const m of chat.items) {
      if (m.mine && m.id && ids.has(m.id) && !m.read_at) {
        m.read_at = at;
        changed = true;
      }
    }
    if (changed && chatUi) chatUi.sync();
  }

  function waLink(c, text) {
    const num = String((c && c.phone) || '').replace(/\D/g, '');
    if (!num) return '';
    return 'https://wa.me/' + num + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  /* Лицо курьера: с фотографией это кнопка — тап открывает снимок почти на весь
     экран; без фотографии обычный кружок с инициалами, нажимать нечего. */
  function courierFace(c, big) {
    const src = (c && c.avatar) || '';
    const face = el(src ? 'button' : 'span', {
      className: 'avatar' + (big ? ' avatar--lg' : '') + (src ? ' sg-ava-tap' : ''),
      type: src ? 'button' : null,
      'aria-label': src ? t('talk.photo') : null,
      title: src ? t('talk.photo') : null,
      onClick: src ? () => { haptic(); photoViewer(src, { alt: t('talk.photo') }); } : null,
    }, initials((c && c.name) || ''));
    if (src) face.appendChild(el('img', { src, alt: '', loading: 'lazy' }));
    return face;
  }

  /* Разделитель дня. «Сегодня» и «Вчера» читаются быстрее даты, а дальше уже
     нужна сама дата — иначе непонятно, когда это было. */
  function dayLabel(at) {
    const now = Math.floor(Date.now() / 1000);
    const key = day(at);
    if (key === day(now)) return t('common.today');
    if (key === day(now - 86400)) return t('common.yesterday');
    return key;
  }

  /* Экран чата: свой слой поверх всего, а не шторка. Так поле ввода можно
     держать над клавиатурой, а список — на всю оставшуюся высоту. */
  function openChat() {
    if (dead || chatUi) return;
    const order = store.get().order || {};
    const c = order.courier || {};
    const car2 = c.car || {};
    const avatar = courierFace(c, false);
    // В WhatsApp уводим с готовым началом письма: номер заказа искать не придётся.
    const wa = waLink(c, t('talk.wa_hello', { id: pid }));

    const list = el('div', { className: 'sg-chat__list' });
    const jump = el('button', {
      type: 'button', className: 'sg-jump', hidden: true, 'aria-label': t('talk.jump'),
    }, el('span', { html: DOWN_SVG }), t('talk.jump'));
    const wrap = el('div', { className: 'sg-chat__wrap' }, list, jump);
    const note = el('div', { className: 'sg-chat__note', hidden: true });

    const input = el('textarea', {
      className: 'sg-chat__input',
      rows: 1,
      placeholder: t('talk.ph'),
      maxLength: chat.maxText,
      enterkeyhint: 'send',
    });
    const sendBtn = el('button', {
      type: 'submit', className: 'sg-chat__send', html: SEND_SVG,
      'aria-label': t('talk.send'), title: t('talk.send'), disabled: true,
    });
    const form = el('form', { className: 'sg-chat__form' }, input, sendBtn);

    const head = el('div', { className: 'sg-chat__head' },
      iconBtn('back', 'sg-back', t('common.back'), () => { haptic(); closeMy(); }),
      avatar,
      el('div', { className: 'sg-chat__who' },
        el('span', { className: 'sg-chat__name' }, c.name || t('track.courier')),
        el('span', { className: 'sg-chat__car' },
           [car2.model, car2.plate ? fmtPlate(car2.plate) : ''].filter(Boolean).join(' · ')
           || t('track.car'))),
      wa ? el('a', {
        className: 'sg-chat__wa', href: wa, target: '_blank', rel: 'noopener noreferrer',
        'aria-label': t('talk.wa'), title: t('talk.wa'), html: icon('wa'),
      }) : null);

    const root = el('div', {
      className: 'sg-chat', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('talk.title'),
    }, head, wrap, note, form);

    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('sg-chat--in'));

    /* ── список ──────────────────────────────────────────────────────────── */

    /* Что уже нарисовано. Ключи лежат в том же порядке, что и узлы: по ним
       видно, можно ли дорисовать снизу или список пора собрать заново. */
    const nodes = new Map();
    let drawn = [];
    let lastDay = '';
    let empty = null;
    let unseen = 0;

    function atBottom() {
      return list.scrollHeight - list.scrollTop - list.clientHeight < 90;
    }

    function toBottom(smooth) {
      if (smooth && typeof list.scrollTo === 'function') {
        try {
          list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
          return;
        } catch (e) { /* старый браузер — уедем без плавности */ }
      }
      list.scrollTop = list.scrollHeight;
    }

    function tickMark(m) {
      if (m.failed) return { text: '!', cls: ' is-fail', title: t('talk.fail_tick') };
      if (m.pending) return { text: '⋯', cls: ' is-wait', title: t('talk.sending') };
      if (m.read_at) return { text: '✓✓', cls: ' is-read', title: t('talk.read') };
      return { text: '✓', cls: '', title: t('talk.sent') };
    }

    /* Чужой текст только через textContent: el() кладёт строки узлом текста,
       а html здесь не используется ни для одного сообщения. */
    function bubble(m, quiet) {
      const tick = m.mine ? el('span', { className: 'sg-msg__tick' }) : null;
      const row = el('div', { className: 'sg-msg' + (m.mine ? ' sg-msg--mine' : '') },
        el('span', { className: 'sg-msg__text' }, m.text),
        el('span', { className: 'sg-msg__meta' }, clock(m.at), tick));
      if (quiet) row.classList.add('sg-msg--quiet');
      // Не ушло — тап по пузырю отправляет ещё раз. Текст при этом остаётся
      // на месте: заставлять человека набирать всё заново — прямое неуважение.
      row.addEventListener('click', () => {
        if (!m.failed) return;
        haptic();
        resend(m);
      });
      const made = { row, tick, m };
      paintTick(made);
      return made;
    }

    function paintTick(made) {
      const m = made.m;
      made.row.classList.toggle('sg-msg--wait', !!m.pending);
      made.row.classList.toggle('sg-msg--fail', !!m.failed);
      // Что делать с неушедшим сообщением, должно быть написано словами, а не
      // угадываться по красной рамке.
      if (m.failed) made.row.title = t('talk.fail');
      else made.row.removeAttribute('title');
      if (!made.tick) return;
      const mark = tickMark(m);
      made.tick.className = 'sg-msg__tick' + mark.cls;
      made.tick.textContent = mark.text;
      made.tick.title = mark.title;
    }

    function showEmpty() {
      const text = chat.loading ? t('common.loading')
        : (chat.error ? t('talk.load_fail') + '. ' + errText(chat.error) : t('talk.empty'));
      if (!empty) {
        empty = el('div', { className: 'sg-chat__empty' }, text);
        list.appendChild(empty);
      } else {
        empty.textContent = text;
      }
    }

    function append(m, quiet) {
      const label = dayLabel(m.at);
      if (label !== lastDay) {
        lastDay = label;
        list.appendChild(el('div', { className: 'sg-chat__day' }, label));
      }
      const made = bubble(m, quiet);
      nodes.set(m.key, made);
      drawn.push(m.key);
      list.appendChild(made.row);
    }

    /* Полная пересборка — редкий путь: первая загрузка, смена языка, исчезнувший
       пузырь. Держим расстояние до низа, чтобы человек остался там же, где читал. */
    function rebuild() {
      const fromBottom = list.scrollHeight - list.scrollTop;
      nodes.clear();
      drawn = [];
      lastDay = '';
      empty = null;
      list.replaceChildren();
      for (const m of chat.items) append(m, true);
      if (!chat.items.length) showEmpty();
      list.scrollTop = Math.max(0, list.scrollHeight - fromBottom);
    }

    /* Порядок нарисованного обязан совпадать с началом списка: иначе пришло
       что-то в середину, и дорисовкой снизу это уже не исправить. */
    function sameHead() {
      if (drawn.length > chat.items.length) return false;
      for (let i = 0; i < drawn.length; i++) {
        if (!chat.items[i] || chat.items[i].key !== drawn[i]) return false;
      }
      return true;
    }

    /** Догнать список: дорисовать новое снизу, поправить галочки у старого. */
    function sync(reload) {
      if (reload || !sameHead()) {
        rebuild();
      } else {
        const stick = atBottom();
        let mine = false;
        let came = 0;
        for (const m of chat.items) {
          const made = nodes.get(m.key);
          if (made) { paintTick(made); continue; }
          if (empty) { empty.remove(); empty = null; }
          append(m, false);
          if (m.mine) mine = true;
          else came += 1;
        }
        // Догоняем низ мгновенно, без плавности: плавная прокрутка идёт
        // кадрами, и пока она едет, список «не внизу» — следующее сообщение
        // подряд решило бы, что человек читает старое, и цепочка рвалась бы.
        if (mine || (came && stick)) toBottom();
        else if (came) bumpJump(came);
        if (!chat.items.length) showEmpty();
      }
      note.textContent = chat.canSend ? (chat.note || '') : (chat.note || t('talk.closed'));
      note.hidden = !note.textContent;
      input.disabled = !chat.canSend;
      input.maxLength = chat.maxText;
      sendBtn.disabled = !chat.canSend || !input.value.trim();
    }

    /* Пришло новое, а человек читает старое — прокрутку не трогаем, только
       показываем кнопку «вниз». Это и есть «чат не прогоняет». */
    function bumpJump(n) {
      unseen += n;
      jump.hidden = false;
      requestAnimationFrame(() => jump.classList.add('sg-jump--in'));
    }

    function hideJump() {
      if (jump.hidden) return;
      unseen = 0;
      jump.classList.remove('sg-jump--in');
      setTimeout(() => { if (!unseen) jump.hidden = true; }, 260);
    }

    jump.addEventListener('click', () => {
      haptic();
      hideJump();
      toBottom(true);
    });

    list.addEventListener('scroll', () => {
      if (atBottom()) {
        hideJump();
        markRead();
      }
    }, { passive: true });

    /* ── ввод ────────────────────────────────────────────────────────────── */

    function grow() {
      input.style.height = 'auto';
      input.style.height = Math.min(122, input.scrollHeight) + 'px';
      sendBtn.disabled = !chat.canSend || !input.value.trim();
    }
    input.addEventListener('input', grow);

    async function deliver(msg) {
      try {
        const res = await api.post(base + '/messages',
                                   { text: msg.text, t: token, lang: getLang() });
        if (dead) return;
        const got = res && res.message;
        const id = got && got.id !== undefined && got.id !== null ? Number(got.id) : 0;
        if (id && chat.byId.get(id) && chat.byId.get(id) !== msg) {
          // Поток успел раньше и нарисовал это сообщение сам — свой черновик
          // убираем, иначе на экране будет два одинаковых пузыря.
          dropMsg(msg);
        } else if (id) {
          msg.id = id;
          msg.at = Number(got.at) || msg.at;
          msg.read_at = got.read_at || null;
          chat.byId.set(id, msg);
        }
        msg.pending = false;
        msg.failed = false;
        chat.pending = chat.pending.filter((m) => m !== msg);
        haptic();
      } catch (e) {
        if (dead) return;
        msg.pending = false;
        msg.failed = true;
        toast(errText(e), { type: 'err' });
      }
      if (chatUi) chatUi.sync();
    }

    function resend(msg) {
      if (!chat.canSend || msg.pending) return;
      msg.failed = false;
      msg.pending = true;
      if (chat.pending.indexOf(msg) < 0) chat.pending.push(msg);
      sync();
      deliver(msg);
    }

    function send() {
      const text = input.value.trim();
      if (!text || !chat.canSend) return;
      const msg = addPending(text);
      input.value = '';
      grow();
      sync();
      toBottom();
      deliver(msg);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      send();
    });

    // С мышью Enter отправляет, с телефона — переносит строку: там есть кнопка.
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
      e.preventDefault();
      send();
    });

    /* ── клавиатура ──────────────────────────────────────────────────────── */

    /* На айфоне страница под клавиатуру не сжимается, и поле ввода уезжает вниз.
       Считаем высоту клавиатуры сами и поднимаем на неё весь экран чата. */
    const vv = window.visualViewport;
    function fitKeyboard() {
      if (!vv) return;
      const gap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--sg-kb', gap + 'px');
      if (atBottom()) toBottom();
    }
    if (vv) {
      vv.addEventListener('resize', fitKeyboard);
      vv.addEventListener('scroll', fitKeyboard);
    }
    input.addEventListener('focus', () => setTimeout(() => toBottom(), 120));

    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeMy();
    }
    document.addEventListener('keydown', onKey, true);

    chatUi = {
      root,
      sync,
      teardown() {
        document.removeEventListener('keydown', onKey, true);
        if (vv) {
          vv.removeEventListener('resize', fitKeyboard);
          vv.removeEventListener('scroll', fitKeyboard);
        }
      },
    };

    sync(true);
    toBottom();
    if (!chat.loaded) loadChat(true);
    else markRead();
  }

  function closeChat(now) {
    if (!chatUi) return;
    const ui = chatUi;
    chatUi = null;
    ui.teardown();
    ui.root.classList.remove('sg-chat--in');
    if (now) ui.root.remove();
    else setTimeout(() => ui.root.remove(), 400);
    clearTimeout(readTimer);
    readTimer = 0;
    paintUnread();
  }

  /* ── загрузка и поток ────────────────────────────────────────────────── */

  async function load() {
    store.set({ loading: true, error: null });
    try {
      const order = await api.get(base, { t: token, lang: getLang() });
      if (dead) return;
      store.set({ order, loading: false, rated: !!order.rating });
      if (CLOSED.indexOf(order.status) >= 0) app.forgetOrder();
      else if (!guest(order)) app.saveOrder(pid, token);
      listen();
    } catch (e) {
      if (dead) return;
      store.set({ loading: false, error: e });
      if (e && (e.status === 404 || e.status === 403)) app.forgetOrder();
    }
  }

  /* Одиночный обрыв потока — обычное дело в лифте и в метро: core/api.js
     переподключится сам. Пугаем человека полоской «нет связи» только если
     за три секунды связь так и не вернулась. */
  let offTimer = 0;
  function markOffline() {
    clearTimeout(offTimer);
    offTimer = setTimeout(() => { if (!dead) store.set({ online: false }); }, 3000);
  }
  function markOnline() {
    clearTimeout(offTimer);
    offTimer = 0;
    store.set({ online: true });
  }

  /* Экран оплаты хочет знать, что заказ изменился. Свой поток он открывать умеет,
     но вкладка держит не больше шести — отдаём ему тот, что уже открыт. */
  const payWatchers = new Set();

  function watchPay(fn) {
    payWatchers.add(fn);
    return () => payWatchers.delete(fn);
  }

  function listen() {
    if (stream || dead) return;
    stream = api.stream(base + '/stream', {
      auth: false,
      params: { t: token, lang: getLang() },
      events: ['search_failed', 'message', 'message_read'],
      onOpen: markOnline,
      onError: markOffline,
      onEvent: (name, data) => {
        if (dead || !data || typeof data !== 'object') return;
        if (name === 'order') {
          const merged = Object.assign({}, store.get().order || {}, data);
          markOnline();
          store.set({ order: merged });
          for (const fn of payWatchers) { try { fn(merged); } catch (e) { /* чужая беда */ } }
          if (CLOSED.indexOf(merged.status) >= 0) app.forgetOrder();
          return;
        }
        if (name === 'geo' && data.at) {
          const order = store.get().order;
          if (!order || !order.courier) return;
          const courier = Object.assign({}, order.courier, {
            at: data.at, heading: data.heading, speed: data.speed, geo_at: data.geo_at,
          });
          store.set({ order: Object.assign({}, order, { courier }) });
          return;
        }
        if (name === 'message') {
          markOnline();
          onChatMessage(data);
          return;
        }
        if (name === 'message_read') {
          onChatRead(data);
          return;
        }
        if (name === 'search_failed') {
          markOnline();
          toast(data.message || t('track.expired'), { type: 'warn' });
        }
      },
    });
  }

  /* ── действия ────────────────────────────────────────────────────────── */

  /* Ссылка на карточку заказа: /go/share/AB12CD. Токена отслеживания в ней нет,
     и это главное: по такой ссылке видно только статус, город и примерное время.
     Телефон, квартира и точный адрес туда не попадают даже в разметку — этим
     занимается server/share.py, а мы всего лишь не подмешиваем токен. */
  function shareLink() {
    const url = siteUrl('share/' + encodeURIComponent(pid));
    haptic();
    if (navigator.share) {
      navigator.share({
        title: t('track.title', { id: pid }),
        text: t('give.what'),
        url,
      }).catch(() => {});
      return;
    }
    // Своего «не получилось» тут не нужно: copyText скажет об этом сам.
    copyText(url, t('give.copied'));
  }

  /* Отмена: сначала спрашиваем причину, она помогает диспетчеру больше, чем факт отмены. */
  function askCancel() {
    const order = store.get().order || {};
    const free = !order.cancel_free_until ||
      Math.floor(Date.now() / 1000) <= order.cancel_free_until;
    const reasons = ['track.cancel_r1', 'track.cancel_r2', 'track.cancel_r3', 'track.cancel_r4'];
    let chosen = '';

    const chips = el('div', { className: 'sg-chips' });
    for (const key of reasons) {
      const one = chip(t(key), {
        size: 'lg',
        onClick: () => {
          chosen = t(key);
          for (const other of chips.children) other.classList.toggle('chip--on', other === one);
        },
      });
      chips.appendChild(one);
    }
    const more = el('textarea', {
      className: 'field__input', placeholder: ' ', maxLength: 300,
    });

    sheet({
      title: t('track.cancel_title'),
      content: el('div', null,
        el('p', { className: 'sheet__text' }, free ? t('track.cancel_free') : t('track.cancel_paid')),
        chips,
        el('label', { className: 'field' }, more,
          el('span', { className: 'field__label' }, t('track.cancel_reason')),
          el('span', { className: 'field__hint' }, t('track.cancel_reason_ph')))),
      actions: [
        { label: t('common.back'), kind: 'ghost' },
        {
          label: t('track.cancel'),
          kind: 'danger',
          onClick: async () => {
            const reason = [chosen, more.value.trim()].filter(Boolean).join('. ');
            try {
              const res = await api.post(base + '/cancel',
                                         { reason, t: token, lang: getLang() });
              if (dead) return true;
              toast(res.message || t('track.cancelled_ok'), { type: 'ok' });
              if (res.order) store.set({ order: res.order });
              app.forgetOrder();
            } catch (e) {
              toast(errText(e), { type: 'err' });
              return false;                  // шторку не закрываем: причина ещё набрана
            }
            return true;
          },
        },
      ],
    });
  }

  /* ── детали заказа во весь экран ─────────────────────────────────────── */

  /* Что человек уточнял про адрес: подъезд, квартиру, этаж, домофон. Пустое не
     показываем вовсе — строка «Этаж: —» не говорит ничего. */
  function pointDetails(p) {
    const parts = [];
    if (p.entrance) parts.push(t('order.entrance') + ' ' + p.entrance);
    if (p.flat) parts.push(t('order.flat') + ' ' + p.flat);
    if (p.floor) parts.push(t('order.floor') + ' ' + p.floor);
    if (p.intercom) parts.push(t('order.intercom') + ' ' + p.intercom);
    if (p.lift === false) parts.push(t('order.no_lift'));
    return parts.join(' · ');
  }

  function extraName(item) {
    const list = Array.isArray(app.extras) ? app.extras : [];
    const found = list.find((x) => x && x.code === item.code);
    const name = found ? nameOf(found) : item.code;
    const qty = Number(item.qty) || 0;
    return qty > 1 ? name + ' × ' + qty : name;
  }

  function buildDetails() {
    const order = store.get().order || {};
    const pts = points(order);
    const p = order.price || {};
    const guestNow = guest(order);

    /* Быстрые действия чипами: показать маршрут, поделиться, позвонить.
       Это второстепенное, поэтому таблетки, а не кнопки во всю ширину. */
    const chips = el('div', { className: 'chips sg-det__chips' },
      chip(t('det.map'), {
        size: 'lg',
        icon: icon('map'),
        onClick: () => { closeMy(); showWholeRoute(); },
      }),
      guestNow ? null : chip(t('track.share'), {
        size: 'lg', icon: icon('share'), onClick: shareLink,
      }),
      order.courier && order.courier.phone ? chip(t('track.call'), {
        size: 'lg',
        icon: icon('phone'),
        onClick: () => {
          const tel = 'tel:' + String(order.courier.phone).replace(/[^\d+]/g, '');
          window.location.href = tel;
        },
      }) : null);

    /* Адреса: одна карточка со строками и разделителями — так видно весь путь
       целиком, а не десять карточек с зазорами. */
    const addrRows = [];
    pts.forEach((pt, i) => {
      const last = i === pts.length - 1;
      const hint = i === 0 ? t('order.from') : (last ? t('order.to') : t('order.point', { n: i + 1 }));
      addrRows.push({
        icon: last ? FLAG_SVG : icon('pin'),
        hint,
        label: pt.addr || hint,
        sub: pointDetails(pt),
      });
      if (pt.comment) addrRows.push({ hint: t('order.point_comment'), label: pt.comment });
      if (pt.name || pt.phone) {
        addrRows.push({
          hint: t('det.contact'),
          label: [pt.name, pt.phone].filter(Boolean).join(', '),
          href: pt.phone ? 'tel:' + String(pt.phone).replace(/[^\d+]/g, '') : null,
        });
      }
    });

    /* О заказе: номер, время, машина, грузчики, допуслуги, комментарий. */
    const info = [];
    info.push({
      hint: t('det.number'),
      label: pid,
      end: chip(t('common.copy'), {
        size: 'lg', onClick: () => copyText(pid, t('det.copied')),
      }),
    });
    if (order.created_at) {
      info.push({ hint: t('det.created'), label: clock(order.created_at) + ', ' + day(order.created_at) });
    }
    if (order.tariff) info.push({ hint: t('det.car'), label: nameOf(order.tariff) || t('track.car') });
    info.push({
      hint: t('det.loaders'),
      label: order.loaders > 0 ? tp(order.loaders, 'common.n_loader') : t('order.loaders_none'),
    });
    const extras = Array.isArray(order.extras) ? order.extras.filter(Boolean) : [];
    info.push({
      hint: t('det.extras'),
      label: extras.length ? extras.map(extraName).join(', ') : t('det.none'),
    });
    if (order.comment) info.push({ hint: t('det.comment'), label: order.comment });
    if (has('status.pay_' + (order.payment_status || 'none'))) {
      info.push({
        hint: t('det.payment'),
        label: t('status.pay_' + (order.payment_status || 'none')),
        value: order.paid_amount ? money(order.paid_amount) : null,
      });
    }

    /* Расчёт цены — те же строки, что видит бухгалтерия в заказе. */
    const sums = [];
    sums.push({ label: t('order.distance'), value: distance(order.distance_m || 0) });
    sums.push({ label: t('order.duration'), value: duration(order.duration_s || 0) });
    const add = (key, value) => {
      if (!value) return;
      sums.push({ label: t(key), value: money(value) });
    };
    add('order.price_base', p.base);
    add('order.price_distance', p.distance);
    add('order.price_time', p.time);
    add('order.price_loaders', p.loaders);
    add('order.price_extras', p.extras);
    add('order.price_waiting', p.waiting);
    sums.push({
      className: 'sg-det__total',
      label: t('order.price_total'),
      value: money(p.total || order.price_total || 0),
    });

    const body = el('div', null,
      chips,
      rowGroup(addrRows, { flat: true, title: t('det.points') }),
      rowGroup(info, { flat: true, title: t('det.order') }),
      rowGroup(sums, { flat: true, title: t('det.price'), className: 'sg-det__sum' }),
      el('div', { className: 'sg-det__note' }, t('order.price_note')),
      guestNow ? el('div', { className: 'sg-det__note' }, t('give.guest')) : null);

    return sheet({
      full: true,
      className: 'sg-det',
      title: t('track.details'),
      content: body,
      actions: [{ label: t('common.done'), kind: 'primary', className: 'btn--lg btn--block' }],
      onClose: sheetGone,
    });
  }

  /* ── экран оценки ────────────────────────────────────────────────────── */

  /* Лицо, заголовок и пояснение под звёздами. Одна и та же коробка на все три
     настроения: пока звёзд нет — просто машина, дальше грусть или радость. */
  function moodBlock(value) {
    if (value >= 1 && value <= 3) {
      return el('div', { className: 'sg-mood sg-mood--sad' },
        el('div', { className: 'sg-mood__face' }, '😔',
          el('span', { className: 'sg-mood__tear' }),
          el('span', { className: 'sg-mood__tear sg-mood__tear--b' })),
        el('div', { className: 'sg-mood__title' }, t('mood.bad_title')),
        el('div', { className: 'sg-mood__text' }, t('mood.bad_text')));
    }
    if (value >= 4) {
      return el('div', { className: 'sg-mood sg-mood--glad' },
        el('div', { className: 'sg-mood__face' },
          el('i', null, '🎉'), el('i', null, '😄'), el('i', null, '👍')),
        el('div', { className: 'sg-mood__title' }, t('mood.good_title')),
        el('div', { className: 'sg-mood__text' }, t('mood.good_text')));
    }
    return el('div', { className: 'sg-mood' },
      el('div', { className: 'sg-mood__face' }, '🚚'),
      el('div', { className: 'sg-mood__title' }, t('track.rate_title')),
      el('div', { className: 'sg-mood__text' }, t('mood.tap')));
  }

  /* Конфетти: восемнадцать бумажек падают один раз и узел сам себя убирает —
     вечная анимация на экране благодарности только грела бы телефон. */
  function confetti(host) {
    const tones = ['var(--accent)', 'var(--ok)', 'var(--info)', 'var(--warn)'];
    const box = el('div', { className: 'sg-conf', 'aria-hidden': 'true' });
    for (let i = 0; i < 18; i++) {
      box.appendChild(el('i', {
        style: {
          '--x': Math.round(Math.random() * 96) + '%',
          '--c': tones[i % tones.length],
          '--d': Math.round(Math.random() * 420) + 'ms',
          '--r': Math.round(180 + Math.random() * 540) + 'deg',
          '--fall': Math.round(150 + Math.random() * 90) + 'px',
        },
      }));
    }
    host.appendChild(box);
    setTimeout(() => box.remove(), 2200);
  }

  /* Оценка во весь экран: звёзды, настроение, причина и пара слов. В шторке
     панели ей было тесно — комментарий приходилось набирать вслепую. */
  function buildRate() {
    const order = store.get().order || {};
    const c = order.courier;
    let value = clamp(Math.round(rateStart) || 0, 0, 5);
    let reason = '';
    let wasGlad = false;
    rateStart = 0;

    const wrap = el('div', { className: 'sg-mood-wrap' }, moodBlock(value));
    const stars = el('div');
    const chips = el('div', { className: 'sg-chips', hidden: true });
    const need = el('div', { className: 'sg-mood__need', hidden: true });

    const comment = el('textarea', { className: 'field__input', placeholder: ' ', maxLength: 500 });
    const commentLabel = el('span', { className: 'field__label' }, t('common.comment'));
    const commentHint = el('span', { className: 'field__hint' }, t('track.rate_comment_ph'));
    const field = el('label', { className: 'field' }, comment, commentLabel, commentHint);

    const favInput = el('input', { type: 'checkbox' });
    favInput.checked = isFav(c);
    const favRow = el('label', { className: 'sg-fav', hidden: true },
      el('span', { className: 'sg-fav__ico' }, '⭐'),
      el('span', { className: 'sg-fav__text' },
        el('span', { className: 'sg-item__title' }, t('mood.fav')),
        el('span', { className: 'sg-item__sub' }, t('mood.fav_hint'))),
      el('span', { className: 'switch' }, favInput,
        el('span', { className: 'switch__track' })));
    favInput.addEventListener('change', () => {
      setFav(c, favInput.checked);
      haptic();
      toast(favInput.checked ? t('mood.fav_done') : t('mood.fav_off'), { type: 'ok' });
    });

    const send = el('button', {
      type: 'button', className: 'btn btn--primary btn--lg btn--block', disabled: true,
    }, t('track.rate_send'));

    /* Низкая оценка без объяснения бесполезна и нам, и человеку: пока причина
       не выбрана (а для «другого» — не написана), отправлять нечего. */
    function ready() {
      if (value < 1) return false;
      if (value > 3) return true;
      if (!reason) return false;
      return reason !== 'other' || comment.value.trim().length >= 3;
    }

    function paintNeed() {
      const sad = value >= 1 && value <= 3;
      need.hidden = !sad || ready();
      if (!need.hidden) {
        need.textContent = reason ? t('mood.need_text') : t('mood.need_reason');
      }
      send.disabled = !ready();
    }

    function paint() {
      const sad = value >= 1 && value <= 3;
      const glad = value >= 4;
      wrap.replaceChildren(moodBlock(value));
      if (glad && !wasGlad) confetti(wrap);
      wasGlad = glad;
      chips.hidden = !sad;
      favRow.hidden = !glad || !c;
      commentLabel.textContent = sad ? t('mood.comment_bad') : t('mood.comment_good');
      commentHint.textContent = sad ? t('mood.need_text') : t('track.rate_comment_ph');
      paintNeed();
    }

    for (const [code, key] of BAD_REASONS) {
      const one = chip(t(key), {
        size: 'lg',
        onClick: () => {
          reason = code;
          for (const other of chips.children) other.classList.toggle('chip--on', other === one);
          paintNeed();
          if (code === 'other') comment.focus();
        },
      });
      chips.appendChild(one);
    }

    comment.addEventListener('input', paintNeed);

    send.addEventListener('click', async () => {
      if (!ready() || send.disabled) return;
      send.disabled = true;
      const parts = [];
      if (value <= 3 && reason && reason !== 'other') {
        const found = BAD_REASONS.find((r) => r[0] === reason);
        if (found) parts.push(t(found[1]));
      }
      const own = comment.value.trim();
      if (own) parts.push(own);
      try {
        const res = await api.post(base + '/rate', {
          rating: value,
          comment: parts.join('. ').slice(0, 500),
          t: token,
          lang: getLang(),
        });
        if (dead) return;
        haptic(20);
        // За оценку начисляют бонусы — говорим об этом сразу и цифрой,
        // иначе человек узнает о подарке только в профиле и не свяжет одно
        // с другим.
        const gift = Math.max(0, Number(res && res.bonus) || 0);
        if (gift > 0 && app.bonus && typeof app.bonus.forget === 'function') app.bonus.forget();
        toast(gift > 0
          ? t('gift.rated', { sum: money(gift) })
          : (res.message || t('track.rate_thanks')), { type: 'ok' });
        store.set({ rated: true });
        closeMy();
      } catch (e) {
        toast(errText(e), { type: 'err' });
        send.disabled = false;
      }
    });

    const body = el('div', { className: 'sg-mood-screen' },
      wrap, stars, chips, need, field, favRow);

    const ui = sheet({
      full: true,
      className: 'sg-rate-sheet',
      title: t('track.rate_title'),
      content: body,
      actions: [send],
      onClose: sheetGone,
    });

    mountStars(stars, {
      value,
      size: 'lg',
      onChange: (v) => { value = v; haptic(); paint(); },
    });
    paint();
    return ui;
  }

  /* ── куски интерфейса ────────────────────────────────────────────────── */

  /* Заголовок шага. Возвращает не голый узел, а {node, setSub}: строка под
     заголовком обновляется раз в секунду живым временем подачи, и пересобирать
     ради неё весь шаг было бы расточительно. */
  function headBox(status, order) {
    // Незнакомый статус — берём общее название из словаря, лишь бы не ключ на экране.
    const fallback = has('status.' + status) ? 'status.' + status : 'common.status';
    const pair = HEAD[status] || [fallback, ''];
    const hint = pair[1] ? t(pair[1]) : '';
    const sub = el('div', { className: 'sg-head__sub' });

    function setSub(text) {
      const value = text || staticSub(order) || hint;
      sub.textContent = value;
      sub.hidden = !value;
    }
    setSub('');

    return {
      node: el('div', { className: 'sg-head' },
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t(pair[0])),
          sub)),
      setSub,
    };
  }

  function routeRow(order) {
    const pts = points(order);
    const first = pts[0] || {};
    const last = pts[pts.length - 1] || {};
    return pressable(el('button', {
      type: 'button', className: 'sg-route', onClick: () => openMy('details'),
    },
      el('span', { className: 'sg-route__line' },
        el('i', null), el('b', null), el('i', null)),
      el('span', { className: 'sg-route__text' },
        el('span', { className: 'sg-route__row' }, first.addr || t('order.from')),
        el('span', { className: 'sg-route__row' }, last.addr || t('order.to'))),
      el('span', { className: 'sg-route__meta' }, distance(order.distance_m || 0))));
  }

  function priceRow(order) {
    const payKey = 'status.pay_' + (order.payment_status || 'none');
    const badge = order.payment_status && order.payment_status !== 'none' && has(payKey)
      ? el('span', { className: 'badge' }, t(payKey))
      : null;
    return pressable(el('button', {
      type: 'button', className: 'sg-opt', onClick: () => openMy('details'),
    },
      el('span', { className: 'sg-opt__text' },
        el('span', { className: 'sg-opt__title' }, t('track.price')),
        el('span', { className: 'sg-opt__sub' }, t('det.open'))),
      badge,
      el('span', { className: 'sg-opt__total' }, money(order.price_total || 0)),
      el('span', { className: 'sg-opt__go', html: icon('go') })));
  }

  /* Карточка курьера: по номеру тапнули — он в буфере, по фото — оно во весь
     экран, рядом с «Позвонить» живёт чат со счётчиком непрочитанных. */
  function courierCard(order) {
    const c = order.courier;
    if (!c) return null;
    const car2 = c.car || {};
    const avatar = courierFace(c, true);

    let plateNode = null;
    if (car2.plate) {
      plateNode = el('button', {
        type: 'button', className: 'sg-plate-btn',
        'aria-label': t('common.copy') + ': ' + fmtPlate(car2.plate),
        title: t('common.copy'),
        onClick: () => copyText(car2.plate, t('talk.plate_copied')),
      }, el('span', { className: 'sg-plate' }, fmtPlate(car2.plate)));
    }

    const stars = el('span');
    const gapBadge = el('span', { className: 'badge badge--accent', hidden: true });
    const rate = el('div', { className: 'sg-courier__rate' }, stars,
      el('span', null, String(Math.round((c.rating || 5) * 10) / 10).replace('.', ',')),
      isFav(c) ? el('span', { className: 'badge badge--ok' }, t('mood.fav_badge')) : null,
      gapBadge);

    const card = el('div', { className: 'sg-courier' },
      avatar,
      el('div', { className: 'sg-courier__text' },
        el('div', { className: 'sg-courier__name' }, c.name || t('track.courier')),
        el('div', { className: 'sg-courier__car' },
          el('span', { className: 'truncate' },
             [car2.model, car2.color].filter(Boolean).join(', ') || t('track.car')),
          plateNode),
        rate));

    mountStars(stars, { value: c.rating || 5, readonly: true });

    const acts = el('div', { className: 'sg-acts' });
    let badge = null;
    if (c.phone) {
      acts.appendChild(el('a', {
        className: 'btn btn--primary grow', href: 'tel:' + c.phone.replace(/[^\d+]/g, ''),
      }, el('span', { html: icon('phone') }), t('track.call')));
    }
    if (!guest(order)) {
      badge = el('span', { className: 'sg-unread', hidden: true }, '0');
      acts.appendChild(el('button', {
        type: 'button', className: 'btn btn--ghost grow', onClick: () => openMy('chat'),
        'aria-label': t('talk.title'),
      }, el('span', { html: icon('chat') }), t('talk.open'), badge));
    }

    const box = el('div', null, card, acts);

    /* Курьер подъехал ближе — цифру рядом со звёздами обновляем на месте:
       перерисовывать всю карточку ради одной надписи незачем. */
    function sync(fresh) {
      const cc = fresh.courier;
      if (!cc) return;
      const pts = points(fresh);
      const gap = cc.at && cc.at[0] != null && pts.length
        ? distanceM(cc.at, [pts[0].lat, pts[0].lng]) : 0;
      const near = gap > 60 && (fresh.status === 'assigned' || fresh.status === 'to_pickup');
      gapBadge.hidden = !near;
      if (near) gapBadge.textContent = distance(gap);
    }
    sync(order);

    return { node: box, sync, badge };
  }

  /* ── шаги ────────────────────────────────────────────────────────────── */

  function stepLoading() {
    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t('track.title', { id: pid })),
          el('div', { className: 'sg-head__sub' }, t('common.loading')))),
      el('div', { className: 'sg-body' },
        el('div', { className: 'sg-wait' },
          el('div', { className: 'skeleton skeleton--box' }),
          el('div', { className: 'skeleton', style: { width: '64%' } }),
          el('div', { className: 'skeleton', style: { width: '40%' } }))),
      el('div', { className: 'sg-foot' }));
    return { name: 'loading', node, update() {} };
  }

  function stepError(e) {
    const gone = e && (e.status === 404 || e.status === 403);
    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-body' },
        el('div', { className: 'sg-fail' },
          el('div', { className: 'sg-fail__icon', html: icon('alert') }),
          el('div', { className: 'sg-fail__title' },
             gone ? t('track.not_found') : t('err.load_failed')),
          el('div', { className: 'sg-fail__text' },
             gone ? t('track.link_bad') : errText(e)))),
      el('div', { className: 'sg-foot' },
        gone ? null : el('button', {
          type: 'button', className: 'btn btn--ghost btn--lg btn--block', onClick: load,
        }, t('common.retry')),
        el('button', {
          type: 'button', className: 'sg-cta', onClick: () => { app.forgetOrder(); app.go('/'); },
        }, el('span', { className: 'sg-cta__label' }, t('order.submit')))));
    return { name: 'error', node, update() {} };
  }

  function stepSearch(order) {
    const best = readBest();
    const wait = el('div', { className: 'sg-search-line' },
      el('div', { className: 'progress progress--wait' }, el('div', { className: 'progress__bar' })));

    /* Одна скромная строка «Поиграть» — и всё. Сама игра поверх карты больше
       не выскакивает: свёрнутая панель это просто свёрнутая панель. */
    const rows = [{
      icon: el('span', { className: 'sg-play__ico' }, '📦'),
      label: t('game.play'),
      sub: best ? t('game.play_best', { n: best }) : t('game.play_hint'),
      onClick: () => openMy('game'),
    }];

    const node = el('div', { className: 'sg-step' },
      headBox(order.status, order).node,
      el('div', { className: 'sg-body' },
        wait,
        rowGroup(rows, { flat: true }),
        routeRow(order),
        priceRow(order)),
      el('div', { className: 'sg-foot' },
        guest(order) ? el('div', { className: 'sg-note' }, t('give.guest')) : el('button', {
          type: 'button', className: 'btn btn--danger btn--lg btn--block', onClick: askCancel,
        }, t('track.cancel'))));
    return { name: 'search', node, update() {} };
  }

  function stepLive(order) {
    const canCancel = !!order.can_cancel && !guest(order);
    const card = courierCard(order);
    const head = headBox(order.status, order);

    /* Время подачи переписываем на месте — раз в секунду, без пересборки шага. */
    function paintEta() {
      head.setSub(etaText());
    }
    paintEta();

    const foot = el('div', { className: 'sg-foot' });
    if (guest(order)) {
      foot.appendChild(el('div', { className: 'sg-note' }, t('give.guest')));
    } else {
      foot.appendChild(el('div', { className: 'row gap-2' },
        el('button', {
          type: 'button', className: 'btn btn--ghost grow', onClick: shareLink,
        }, t('track.share')),
        canCancel ? el('button', {
          type: 'button', className: 'btn btn--danger grow', onClick: askCancel,
        }, t('track.cancel')) : null));
      // Одной строкой объясняем, что уходит по ссылке: человек должен понимать,
      // что он отправляет, до того, как нажмёт «Поделиться».
      foot.appendChild(el('div', { className: 'sg-note' }, t('give.note')));
    }

    const node = el('div', { className: 'sg-step' },
      head.node,
      el('div', { className: 'sg-body' },
        card ? card.node : null, routeRow(order), priceRow(order)),
      foot);

    return {
      name: 'live:' + order.status + (guest(order) ? ':g' : ''),
      node,
      /* Шаг встал на экран: счётчик непрочитанных теперь живёт на этой кнопке. */
      mount() {
        unreadBadge = card ? card.badge : null;
        paintUnread();
        paintEta();
      },
      update(state) {
        if (card && state.order) card.sync(state.order);
        paintEta();
      },
      tick: paintEta,
    };
  }

  function stepDone(order) {
    const body = el('div', { className: 'sg-body' });
    const foot = el('div', { className: 'sg-foot' });

    if (store.get().rated) {
      body.appendChild(el('div', { className: 'sg-rate' },
        el('div', { className: 'sg-mood sg-mood--glad' },
          el('div', { className: 'sg-mood__face' }, el('i', null, '🙏')),
          el('div', { className: 'sg-mood__title' }, t('track.rate_thanks')))));
    } else if (!guest(order)) {
      /* Звёзды прямо в шторке, а всё остальное — на своём экране: человеку
         достаточно одного касания, чтобы сказать главное. */
      const stars = el('div');
      body.appendChild(el('div', { className: 'sg-stars-box' },
        el('div', { className: 'sg-stars-box__title' }, t('track.rate_title')),
        stars,
        el('div', { className: 'sg-stars-box__sub' }, t('mood.tap'))));
      mountStars(stars, {
        value: 0,
        size: 'lg',
        onChange: (v) => { rateStart = v; openMy('rate'); },
      });
      foot.appendChild(el('button', {
        type: 'button', className: 'btn btn--primary btn--lg btn--block',
        onClick: () => openMy('rate'),
      }, t('mood.open')));
    }

    body.appendChild(routeRow(order));
    body.appendChild(priceRow(order));

    /* Кэшбек за закрытый заказ сервер начисляет сам. Строка ведёт туда, где его
       видно: без неё человек узнаёт о своих бонусах случайно и через месяц. */
    if (!guest(order) && app.bonus && typeof app.bonus.on === 'function' && app.bonus.on()) {
      body.appendChild(pressable(el('button', {
        type: 'button', className: 'sg-item',
        onClick: () => { haptic(); app.bonus.open(); },
      },
        el('span', { className: 'sg-item__icon sg-item__icon--accent', html: icon('gift') }),
        el('span', { className: 'sg-item__text' },
          el('span', { className: 'sg-item__title' }, t('gift.title')),
          el('span', { className: 'sg-item__sub' }, t('gift.after_ride'))),
        el('span', { className: 'sg-opt__go', html: icon('go') }))));
    }

    foot.appendChild(el('button', {
      type: 'button', className: 'btn btn--ghost btn--lg btn--block',
      onClick: () => { app.forgetOrder(); app.go('/'); },
    }, t('track.repeat')));

    const node = el('div', { className: 'sg-step' }, headBox('done', order).node, body, foot);
    return { name: 'done:' + (store.get().rated ? '1' : '0'), node, update() {} };
  }

  /* Оплата вперёд: пока бронь не пришла, поиск машины не стартует. Показываем
     код банка и ждём подтверждения — человеку нажимать ничего не нужно.

     Шаг делаем один раз и держим: пересоздавать его на каждую перерисовку
     нельзя, иначе опрос банка начинается заново, а анимация дёргается. */
  let payStep = null;

  function stepPay(order) {
    if (!payStep) {
      payStep = createPayStep(app, {
        pid, token, order,
        subscribe: watchPay,
        onPaid: load,          // сервер уже перевёл заказ в поиск машины
        onSkip: load,
        onCancel: askCancel,
      });
    } else if (typeof payStep.update === 'function') {
      payStep.update(order);
    }
    return payStep;
  }

  function stepClosed(order) {
    const why = order.cancel_reason
      ? el('div', { className: 'sg-fail__text' }, order.cancel_reason)
      : null;
    const node = el('div', { className: 'sg-step' },
      headBox(order.status, order).node,
      el('div', { className: 'sg-body' }, why, routeRow(order)),
      el('div', { className: 'sg-foot' },
        el('button', {
          type: 'button', className: 'sg-cta',
          onClick: () => { app.forgetOrder(); app.go('/'); },
        }, el('span', { className: 'sg-cta__label' }, t('track.repeat')))));
    return { name: 'closed:' + order.status, node, update() {} };
  }

  /* ── сборка ──────────────────────────────────────────────────────────── */

  function build(state) {
    if (state.loading) return stepLoading();
    if (state.error) return stepError(state.error);
    const order = state.order || {};
    const s = order.status;
    if (s === 'done') return stepDone(order);
    if (s === 'cancelled' || s === 'expired') return stepClosed(order);
    if (s === 'draft' && order.payment_status === 'pending') return stepPay(order);
    if (payStep) { try { payStep.destroy && payStep.destroy(); } catch (e) { /* уже ушёл */ } payStep = null; }
    if (isSearching(order)) return stepSearch(order);
    return stepLive(order);
  }

  /* Полоска «нет связи» появляется поверх шага и уходит сама, когда поток ожил. */
  const offline = el('div', { className: 'sg-offline', hidden: true }, t('common.offline'));
  const panelBox = app.panel.el.querySelector('.sg-panel__box');
  if (panelBox) panelBox.prepend(offline);

  /* Панель подвинули — машина обязана остаться на виду: слежение держит её в
     середине свободной части экрана, а свободная часть только что изменилась. */
  function onPanelMove() {
    if (!following || !canFollow) return;
    const order = store.get().order;
    if (order) syncCar(order);
  }
  app.panel.el.addEventListener('sheetmove', onPanelMove);

  /* Секундный ход. Тикает время подачи и гаснет маршрут позади машины: сама
     машина едет кадрами карты, а эти две вещи достаточно обновлять раз в
     секунду. В фоне вкладки не считаем ничего — батарея дороже. */
  let beat = 0;

  function startBeat() {
    if (beat || dead) return;
    beat = setInterval(() => {
      if (dead || document.visibilityState === 'hidden') return;
      if (view && typeof view.tick === 'function') view.tick();
      const order = store.get().order;
      if (order) syncLive(order);
    }, 1000);
  }

  function stopBeat() {
    if (!beat) return;
    clearInterval(beat);
    beat = 0;
  }

  /* Машину нашли, пока человек играл — игру закрываем сами: держать её поверх
     найденного курьера бессмысленно, а бросать без объяснения невежливо. */
  function gameGuard(state) {
    if (overlayNow !== 'game') return;
    if (isSearching(state.order)) return;
    closeMy();
    toast(t('game.found'), { type: 'ok' });
    haptic(20);
  }

  function render(state) {
    if (state.order) etaFeed(state.order);
    const next = build(state);
    if (!view || view.name !== next.name) {
      unreadBadge = null;            // старая кнопка чата уходит вместе с шагом
      app.panel.show(next.node);
      view = next;
      if (typeof next.mount === 'function') next.mount();
    } else {
      view.update(state);
      app.panel.refresh();
    }
    if (view && typeof view.tick === 'function') startBeat();
    else stopBeat();
    offline.hidden = state.online;
    if (state.order) syncMap(state.order);
    gameGuard(state);
    // Курьер появился — забираем переписку, чтобы счётчик непрочитанных был честным.
    if (state.order && state.order.courier && !guest(state.order)
        && !chat.loaded && !chat.tried) loadChat();
    // Адрес просил наложение, пока заказ грузился, — самое время его открыть.
    if (overlayWanted && !state.loading) {
      const want = overlayWanted;
      overlayWanted = '';
      applyOverlay(want);
    }
  }

  store.on((state) => { if (!dead) render(state); });
  render(store.get());
  load();

  return {
    relang() {
      view = null;
      offline.textContent = t('common.offline');
      if (game) game.relang();
      render(store.get());
      // Наложение переодеваем на месте: адрес не трогаем, иначе системная
      // «назад» получила бы лишний шаг только из-за смены языка.
      const open = overlayNow;
      if (open && open !== 'game') {
        byRouter = true;
        shutOverlay();
        byRouter = false;
        applyOverlay(open);
      }
    },
    destroy() {
      dead = true;
      stopBeat();
      clearTimeout(offTimer);
      clearTimeout(readTimer);
      readTimer = 0;
      if (offOverlay) offOverlay();
      offOverlay = null;
      app.panel.el.removeEventListener('sheetmove', onPanelMove);
      byRouter = true;                // экран уходит: адрес меняет не он
      shutOverlay();
      byRouter = false;
      closeChat(true);
      closeGame(true);
      if (payStep) {
        try { payStep.destroy && payStep.destroy(); } catch (e) { /* уже ушёл */ }
        payStep = null;
      }
      unreadBadge = null;
      if (following && canFollow) { map.unfollow(); following = false; }
      if (stream) stream.close();
      stream = null;
      offline.remove();
    },
  };
}

export default mountTrack;
