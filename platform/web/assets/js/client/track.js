/* Отслеживание заказа: поиск машины, курьер на карте, чат, статусы и оценка.

   Экран живёт на потоке событий: сервер сам присылает смену статуса, координаты
   машины и сообщения от курьера, поэтому опроса здесь нет вовсе. Если связь
   оборвалась, core/api.js переподключится сам, а мы честно показываем полоску
   «нет связи».

   Три вещи здесь сделаны нарочно не так, как обычно:

   1. Пока ищется машина, поверх карты живёт маленькая игра — коробки падают,
      кузов ловит их пальцем. Ожидание в пять минут без единого движения на
      экране злит сильнее, чем само ожидание. Игра появляется только когда
      панель свёрнута, гаснет в фоне вкладки и исчезает в ту же секунду, как
      нашёлся курьер.
   2. Оценка спрашивается с эмоцией: до трёх звёзд мы извиняемся и обязательно
      выясняем, что случилось; четыре и пять — радуемся вместе с человеком.
   3. Чат с курьером — свой экран поверх всего, с пузырями и отметками
      прочтения. Чужой текст попадает на страницу только через textContent:
      innerHTML для сообщений не используется нигде.
*/

import { api } from '../core/api.js';
import { t, has, extend, getLang } from '../core/i18n.js';
import { createStore } from '../core/store.js';
import {
  el, toast, sheet, haptic, mountStars, copyText, photoViewer,
} from '../core/ui.js';
import { pin, distanceM } from '../core/map.js';
import {
  money, distance, duration, time as clock, date as day,
  plate as fmtPlate, initials,
} from '../core/fmt.js';
import { icon, iconBtn, errText, readJson, writeJson, onThemeChange } from './app.js';

/* Свои строки модуль приносит сам: общий словарь правят соседние экраны.
   Префиксы нарочно редкие (game./talk./mood.) — так строки клиента не столкнутся
   с чатом курьера, который пишется параллельно.
   Кыргызский — как говорят в Бишкеке: «унаа», «жүк», «заказ», «кузов». */
extend({
  ru: {
    'game.title': 'Ловите коробки',
    'game.hint': 'Ведите пальцем — кузов едет за вами',
    'game.best': 'Рекорд',
    'game.again': 'Ещё раз',
    'game.over': 'Коробки закончились',
    'game.caught': 'Поймано: {n}',
    'game.new_best': 'Новый рекорд!',
    'game.close': 'Убрать игру',
    'game.play': 'Поиграть, пока ищем',
    'game.play_hint': 'Свернём панель — и ловите коробки в кузов',
    'game.play_best': 'Ваш рекорд: {n}',

    'talk.title': 'Чат с курьером',
    'talk.open': 'Чат',
    'talk.ph': 'Сообщение курьеру',
    'talk.send': 'Отправить',
    'talk.empty': 'Здесь пока пусто. Напишите курьеру, где вас встретить.',
    'talk.wa': 'Написать в WhatsApp',
    'talk.wa_hello': 'Здравствуйте! Я по заказу {id}.',
    'talk.read': 'Прочитано',
    'talk.sent': 'Отправлено',
    'talk.closed': 'Переписка по этому заказу закрыта',
    'talk.plate_copied': 'Номер машины скопирован',
    'talk.new': 'Новое сообщение от курьера',
    'talk.load_fail': 'Не получилось загрузить переписку',
    'talk.photo': 'Фото курьера',
    'talk.unread': 'Непрочитанных сообщений: {n}',

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
  },
  ky: {
    'game.title': 'Кутуларды кармаңыз',
    'game.hint': 'Манжаңыз менен жылдырыңыз — кузов артыңыздан жүрөт',
    'game.best': 'Рекорд',
    'game.again': 'Дагы бир жолу',
    'game.over': 'Кутулар түгөндү',
    'game.caught': 'Кармалды: {n}',
    'game.new_best': 'Жаңы рекорд!',
    'game.close': 'Оюнду жабуу',
    'game.play': 'Издеп жатканда оюн ойноңуз',
    'game.play_hint': 'Панелди түшүрөбүз — кутуларды кузовго кармаңыз',
    'game.play_best': 'Сиздин рекорд: {n}',

    'talk.title': 'Курьер менен чат',
    'talk.open': 'Чат',
    'talk.ph': 'Курьерге билдирүү',
    'talk.send': 'Жөнөтүү',
    'talk.empty': 'Азырынча бош. Курьерге кайдан тосуп аларыңызды жазыңыз.',
    'talk.wa': "WhatsApp'ка жазуу",
    'talk.wa_hello': 'Саламатсызбы! {id} заказы боюнча жазып жатам.',
    'talk.read': 'Окулду',
    'talk.sent': 'Жөнөтүлдү',
    'talk.closed': 'Бул заказ боюнча жазышуу жабылды',
    'talk.plate_copied': 'Унаанын номери көчүрүлдү',
    'talk.new': 'Курьерден жаңы билдирүү',
    'talk.load_fail': 'Жазышууну жүктөй албадык',
    'talk.photo': 'Курьердин сүрөтү',
    'talk.unread': 'Окулбаган билдирүү: {n}',

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
  },
});

/* Статусы, после которых заказ больше не меняется. */
const CLOSED = ['done', 'cancelled', 'expired'];

/* Сколько едет машина между двумя точками от сервера: координаты приходят раз
   в несколько секунд, и такая длительность выглядит как непрерывное движение. */
const CAR_MOVE_MS = 1400;

/* Ключи в localStorage: рекорд в игре и избранные курьеры. */
const KEY_BEST = 'sg_catch_best';
const KEY_FAV = 'sg_fav_couriers';
const FAV_MAX = 20;

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

/* ─────────────────────────────────────────────────────── свои стили

   Игра, чат и экран оценки живут только на этом экране, поэтому и правила они
   везут с собой: в client.css их пришлось бы искать через файл, который правят
   соседние модули. Цвета — только из токенов, чтобы обе темы работали сами. */
const OWN_CSS = `
/* ── игра «поймай коробку» ─────────────────────────────────────────────── */

.sg-game {
  position: absolute;
  left: var(--sp-3);
  /* справа оставляем колонку кнопок карты: игра не должна их закрывать */
  right: calc(var(--sp-3) + 56px);
  bottom: calc(max(0px, var(--sg-panel-h, 240px) - var(--sg-panel-off, 0px)) + var(--sp-3));
  z-index: 15;
  display: flex;
  flex-direction: column;
  height: min(38dvh, 280px);
  min-height: 176px;
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--shadow-2);
  overflow: hidden;
  opacity: 0;
  transform: translateY(12px) scale(.98);
  transition: opacity var(--dur-2) var(--ease), transform var(--dur-2) var(--ease);
}
.sg-game--in { opacity: 1; transform: none; }
.sg-game.is-hit { animation: sg-game-hit var(--dur-2) var(--ease); }

@keyframes sg-game-hit {
  0%, 100% { transform: none; }
  30% { transform: translateX(-5px); }
  70% { transform: translateX(5px); }
}

.sg-game__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding-left: var(--sp-3);
  font-size: var(--fs-sm);
}

.sg-game__hearts { display: flex; gap: 2px; color: var(--err); font-size: 13px; }
.sg-game__hearts i.is-off { color: var(--surface-3); }

.sg-game__score { display: flex; align-items: center; gap: 4px; }
.sg-game__score b { font-family: var(--font-display); font-size: var(--fs-h3); font-weight: 800; }

.sg-game__best {
  margin-left: auto;
  color: var(--muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

.sg-game__x {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--muted);
}
.sg-game__x:active { color: var(--text); transform: scale(.92); }
.sg-game__x > svg { width: 18px; height: 18px; }

.sg-game__stage { position: relative; flex: 1 1 auto; min-height: 0; }

.sg-game__cv {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}
.sg-game__cv:active { cursor: grabbing; }

.sg-game__hint {
  position: absolute;
  left: var(--sp-3);
  right: var(--sp-3);
  top: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-xs);
  text-align: center;
  pointer-events: none;
}

.sg-game__over {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-3);
  background: var(--surface);
  text-align: center;
}

.sg-game__over-title { font-family: var(--font-display); font-weight: 700; }
.sg-game__over-sub { color: var(--muted); font-size: var(--fs-sm); }

/* ── строка «поиграть, пока ищем» в шторке ─────────────────────────────── */

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
  /* Пока экран уезжает, он не должен ловить нажатия вместо карты под ним. */
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
  padding: 2px var(--sp-3);
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

.sg-msg {
  max-width: 84%;
  align-self: flex-start;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md) var(--r-md) var(--r-md) var(--r-xs);
  background: var(--surface-2);
  animation: sg-msg-in var(--dur-2) var(--ease) both;
}
.sg-msg--mine {
  align-self: flex-end;
  border-radius: var(--r-md) var(--r-md) var(--r-xs) var(--r-md);
  background: var(--accent-soft);
}

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
.sg-msg__tick.is-read { color: var(--info); }

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
  padding: 11px var(--sp-3);
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
  width: 44px;
  height: 44px;
  border-radius: var(--r-full);
  background: var(--accent);
  color: var(--on-accent);
  transition: transform var(--dur-1) var(--ease), opacity var(--dur-1) var(--ease);
}
.sg-chat__send:disabled { opacity: .4; }
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
  padding: var(--sp-2) 0;
  cursor: pointer;
}
.sg-fav__ico { font-size: 22px; line-height: 1; }
.sg-fav__text { flex: 1 1 auto; min-width: 0; }
/* Заголовок строки списка обычно в одну строку с многоточием, но здесь это
   предложение целиком — пусть переносится, обрезанное слово читается хуже. */
.sg-fav__text .sg-item__title { white-space: normal; overflow: visible; }

@media (max-width: 380px) {
  .sg-game { right: calc(var(--sp-3) + 52px); }
}

/* На широком экране шторка стоит слева, игре хватает места рядом с ней. */
@media (min-width: 620px) {
  .sg-game { left: var(--sp-4); right: auto; width: 420px; }
}

@media (prefers-reduced-motion: reduce) {
  .sg-mood--sad .sg-mood__face,
  .sg-mood--glad .sg-mood__face i,
  .sg-mood__tear { animation: none; }
  .sg-mood__tear { opacity: .9; }
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

   Всё рисуется руками на canvas: на слабом телефоне это дешевле десятка
   движущихся узлов, а кадры идут только пока карточка видна и вкладка на
   переднем плане — в фоне цикл останавливается совсем и батарею не ест. */
function createCatchGame(onClose) {
  const state = {
    w: 0, h: 0, dpr: 1,
    points: 0, lives: 3, best: readBest(),
    over: false, visible: false, dead: false,
    spawnIn: 600, raf: 0, last: 0, rect: null,
  };
  const truck = { x: 0, to: 0, w: 88, h: 26 };
  let boxes = [];
  let pops = [];

  const scoreOut = el('b', null, '0');
  const bestOut = el('span', { className: 'sg-game__best' });
  const hearts = el('span', { className: 'sg-game__hearts' });
  const closeBtn = iconBtn('close', 'sg-game__x', t('game.close'), () => {
    haptic();
    if (onClose) onClose();
  });
  const head = el('div', { className: 'sg-game__head' },
    hearts,
    el('span', { className: 'sg-game__score' }, '📦', scoreOut),
    bestOut,
    closeBtn);

  const cv = el('canvas', { className: 'sg-game__cv' });
  const hint = el('div', { className: 'sg-game__hint' }, t('game.hint'));
  const over = el('div', { className: 'sg-game__over', hidden: true });
  const stage = el('div', { className: 'sg-game__stage' }, cv, hint, over);
  const node = el('div', {
    className: 'sg-game', hidden: true, role: 'group', 'aria-label': t('game.title'),
  }, head, stage);

  const ctx = cv.getContext('2d');
  // Кузов и дорога рисуются цветами темы. Читаем их один раз при показе и на
  // смене темы: спрашивать getComputedStyle в каждом кадре — лишняя работа.
  let colors = { accent: '#FFDF00', line: '#2E2E36' };

  function readColors() {
    const cs = getComputedStyle(node);
    const one = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    colors = { accent: one('--accent', '#FFDF00'), line: one('--line', '#2E2E36') };
  }

  const offTheme = onThemeChange(() => {
    readColors();
    if (state.visible) draw();
  });

  /* ── размеры ───────────────────────────────────────────────────────────── */

  function fit() {
    const w = Math.max(120, Math.round(stage.clientWidth));
    const h = Math.max(100, Math.round(stage.clientHeight));
    if (w === state.w && h === state.h) return;
    const kx = state.w ? w / state.w : 1;
    state.w = w;
    state.h = h;
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * state.dpr);
    cv.height = Math.round(h * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.rect = null;
    truck.w = Math.round(Math.max(64, Math.min(112, w * 0.3)));
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
    truck.to = Math.max(truck.w / 2, Math.min(state.w - truck.w / 2, x));
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

  function spawn() {
    const size = 18 + Math.round(Math.random() * 10);
    boxes.push({
      x: size + Math.random() * Math.max(1, state.w - size * 2),
      y: -size,
      size,
      v: 86 + Math.min(150, state.points * 5) + Math.random() * 34,
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
      el('div', { className: 'sg-game__over-title' },
         state.points >= state.best && state.points > 0 ? t('game.new_best') : t('game.over')),
      el('div', { className: 'sg-game__over-sub' }, t('game.caught', { n: state.points })),
      el('button', {
        type: 'button', className: 'btn btn--primary', onClick: restart,
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
      if (boxes.length < 6) spawn();
      state.spawnIn = Math.max(430, 950 - state.points * 16);
    }

    const groundY = state.h - 12;
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
    rr(-s / 2, -s / 2, s, s, 3);
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
    rr(left, top, w * 0.6, h, 4);
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
      ctx.arc(left + w * k, baseY + 1, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw() {
    if (!state.w) return;
    const groundY = state.h - 12;
    ctx.clearRect(0, 0, state.w, state.h);

    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 7);
    ctx.lineTo(state.w, groundY + 7);
    ctx.stroke();

    for (const b of boxes) drawBox(b);
    drawTruck(groundY);

    if (pops.length) {
      ctx.font = '700 13px ' + 'system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const p of pops) {
        ctx.globalAlpha = Math.max(0, 1 - p.life / 0.7);
        ctx.fillStyle = colors.accent;
        ctx.fillText('+1', p.x, p.y - 8 - p.life * 34);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ── цикл ──────────────────────────────────────────────────────────────── */

  function frame(now) {
    state.raf = 0;
    if (state.dead || !state.visible || state.over) return;
    const dt = Math.min(0.05, (now - (state.last || now)) / 1000);
    state.last = now;
    step(dt);
    draw();
    if (!state.over) state.raf = requestAnimationFrame(frame);
  }

  function run() {
    if (state.dead || state.raf || !state.visible || state.over) return;
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

    /** Показать или спрятать карточку. Спрятанная игра не считает кадры. */
    show(on) {
      if (state.dead || state.visible === !!on) return;
      state.visible = !!on;
      if (state.visible) {
        node.hidden = false;
        readColors();                // до вставки в страницу цвета темы не спросить
        fit();
        requestAnimationFrame(() => {
          if (!state.dead && state.visible) node.classList.add('sg-game--in');
        });
        run();
      } else {
        halt();
        node.classList.remove('sg-game--in');
        node.hidden = true;
      }
    },

    /** Сменился язык — переписываем подписи, не сбрасывая счёт. */
    relang() {
      hint.textContent = t('game.hint');
      closeBtn.setAttribute('aria-label', t('game.close'));
      closeBtn.title = t('game.close');
      node.setAttribute('aria-label', t('game.title'));
      paintHead();
      if (state.over) finish();
    },

    destroy() {
      state.dead = true;
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
  let line = null;
  let radar = null;
  let car = null;
  let mapKey = '';

  const base = '/orders/' + encodeURIComponent(pid);

  /* ── карта ───────────────────────────────────────────────────────────── */

  function points(order) {
    return (order && Array.isArray(order.points) ? order.points : [])
      .filter((p) => p && p.lat != null);
  }

  function syncMap(order) {
    if (!order) return;
    const pts = points(order);
    const key = order.status + '|' + pts.map((p) => p.lat.toFixed(5) + p.lng.toFixed(5)).join(';');
    if (key !== mapKey) {
      mapKey = key;
      for (const m of markers) m.remove();
      markers = pts.map((p, i) => app.marker({
        at: [p.lat, p.lng],
        html: i === 0 ? pin('a') : pin('b', pts.length > 2 ? String(i + 1) : ''),
        anchor: i === 0 ? 'center' : 'bottom',
        zIndex: 10 + i,
      }));

      const path = Array.isArray(order.route) && order.route.length > 1 ? order.route : null;
      if (path) {
        if (line) line.setCoords(path);
        else line = app.route(path, { width: 6 });
      }

      // Пока ищем машину, вокруг точки подачи расходятся круги — видно, что работа идёт.
      const searching = isSearching(order);
      if (searching && pts.length && !radar) {
        radar = app.marker({ at: [pts[0].lat, pts[0].lng], html: '<span class="sg-radar"></span>', zIndex: 30 });
      }
      if (!searching && radar) { radar.remove(); radar = null; }

      fitAll(order);
    }

    const at = order.courier && order.courier.at;
    if (at && at[0] != null) {
      if (!car) {
        car = app.marker({ at, html: pin('car'), rotate: true, zIndex: 40 });
        fitAll(order);
      } else {
        car.moveTo(at, { duration: CAR_MOVE_MS, heading: order.courier.heading });
      }
    } else if (car) {
      car.remove();
      car = null;
    }
  }

  function fitAll(order) {
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
    const path = Array.isArray(order.route) && order.route.length > 1 ? order.route : pts;
    app.fit(at.concat(path));
  }

  /* Машину ищем — значит, экрану нечего показывать, кроме бегущей полоски.
     Черновик в ожидании оплаты сюда не входит: там человек занят делом. */
  function isSearching(order) {
    if (!order) return false;
    if (order.status === 'searching') return true;
    return order.status === 'draft' && order.payment_status !== 'pending';
  }

  /* ── игра, пока ищется машина ────────────────────────────────────────── */

  let game = null;
  let gameOff = false;        // человек закрыл игру сам — больше не навязываемся

  function dropGame() {
    if (!game) return;
    game.destroy();
    game = null;
  }

  /* Игра появляется только когда панель опущена: развёрнутая шторка занимает
     пол-экрана, и лишняя карточка поверх карты там ни к чему. */
  function syncGame() {
    if (dead) return;
    if (!isSearching(store.get().order) || gameOff) {
      dropGame();
      return;
    }
    if (!game) {
      game = createCatchGame(() => {
        gameOff = true;
        dropGame();
      });
      (document.querySelector('.sg-app') || document.body).appendChild(game.node);
    }
    game.show((app.panel.el.dataset.pos || 'full') !== 'full');
  }

  function onSheetMove() {
    syncGame();
  }
  app.panel.el.addEventListener('sheetmove', onSheetMove);

  /* Кнопка «Поиграть»: сворачиваем шторку тем же способом, что и палец — тапом
     по грипу, чтобы панель встала ровно в своё нижнее положение. */
  function playNow() {
    haptic();
    gameOff = false;
    const grip = app.panel.el.querySelector('.sg-panel__grip');
    if (grip && (app.panel.el.dataset.pos || 'full') === 'full') grip.click();
    syncGame();
  }

  /* ── чат с курьером ──────────────────────────────────────────────────── */

  const chat = {
    items: [],
    ids: new Set(),
    unread: 0,
    loaded: false,
    loading: false,
    tried: false,
    canSend: true,
    note: '',
    maxText: 1000,
    error: null,
  };
  let chatUi = null;
  let unreadBadge = null;
  let readTimer = 0;

  /* Сообщение в наш вид. Повтор из потока не задваивается: id уже известен. */
  function pushMsg(raw) {
    if (!raw || raw.id === undefined || raw.id === null) return null;
    const id = Number(raw.id);
    if (chat.ids.has(id)) {
      const was = chat.items.find((x) => x.id === id);
      if (was && raw.read_at && !was.read_at) was.read_at = raw.read_at;
      return null;
    }
    const msg = {
      id,
      mine: raw.mine === undefined ? raw.sender === 'client' : !!raw.mine,
      text: String(raw.text || ''),
      at: Number(raw.at) || 0,
      read_at: raw.read_at || null,
    };
    chat.ids.add(id);
    chat.items.push(msg);
    const n = chat.items.length;
    if (n > 1 && chat.items[n - 2].id > id) chat.items.sort((a, b) => a.id - b.id);
    return msg;
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
    if (chatUi) chatUi.paint();
    try {
      const res = await api.get(base + '/messages', { t: token, lang: getLang() });
      if (dead) return;
      chat.items = [];
      chat.ids = new Set();
      for (const m of (Array.isArray(res.items) ? res.items : [])) pushMsg(m);
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
      chatUi.paint();
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
      if (chatUi) chatUi.paint();
    }, 400);
  }

  function onChatMessage(data) {
    const msg = pushMsg(data && data.message);
    if (!msg) return;
    if (chatUi) {
      chatUi.add(msg);
      markRead();
      return;
    }
    if (msg.mine) return;
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
      if (m.mine && ids.has(m.id) && !m.read_at) {
        m.read_at = at;
        changed = true;
      }
    }
    if (changed && chatUi) chatUi.paint();
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

  /* Экран чата: свой слой поверх всего, а не шторка. Так поле ввода можно
     держать над клавиатурой, а список — на всю оставшуюся высоту. */
  function openChat() {
    if (dead || chatUi) return;
    haptic();
    const order = store.get().order || {};
    const c = order.courier || {};
    const car2 = c.car || {};
    const avatar = courierFace(c, false);
    // В WhatsApp уводим с готовым началом письма: номер заказа искать не придётся.
    const wa = waLink(c, t('talk.wa_hello', { id: pid }));
    const list = el('div', { className: 'sg-chat__list' });
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
      iconBtn('back', 'sg-back', t('common.back'), () => closeChat()),
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
    }, head, list, note, form);

    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('sg-chat--in'));

    /* ── список ──────────────────────────────────────────────────────────── */

    function nearBottom() {
      return list.scrollHeight - list.scrollTop - list.clientHeight < 90;
    }

    function toBottom() {
      list.scrollTop = list.scrollHeight;
    }

    /* Чужой текст только через textContent: el() кладёт строки узлом текста,
       а html здесь не используется ни для одного сообщения. */
    function bubble(m) {
      const tick = m.mine
        ? el('span', {
          className: 'sg-msg__tick' + (m.read_at ? ' is-read' : ''),
          title: m.read_at ? t('talk.read') : t('talk.sent'),
        }, m.read_at ? '✓✓' : '✓')
        : null;
      return el('div', { className: 'sg-msg' + (m.mine ? ' sg-msg--mine' : '') },
        el('span', { className: 'sg-msg__text' }, m.text),
        el('span', { className: 'sg-msg__meta' }, clock(m.at), tick));
    }

    function paint() {
      // Перерисовка не должна утаскивать вниз того, кто листает переписку вверх.
      const stick = nearBottom();
      const kids = [];
      let lastDay = '';
      for (const m of chat.items) {
        const key = day(m.at);
        if (key !== lastDay) {
          lastDay = key;
          kids.push(el('div', { className: 'sg-chat__day' }, key));
        }
        kids.push(bubble(m));
      }
      if (!kids.length) {
        kids.push(el('div', { className: 'sg-chat__empty' },
          chat.loading ? t('common.loading')
            : (chat.error ? errText(chat.error) : t('talk.empty'))));
      }
      list.replaceChildren(...kids);
      note.textContent = chat.canSend ? (chat.note || '') : (chat.note || t('talk.closed'));
      note.hidden = !note.textContent;
      input.disabled = !chat.canSend;
      input.maxLength = chat.maxText;
      sendBtn.disabled = !chat.canSend || !input.value.trim();
      if (stick) toBottom();
    }

    function add(m) {
      const stick = nearBottom() || m.mine;
      const empty = list.querySelector('.sg-chat__empty');
      if (empty) empty.remove();
      const key = day(m.at);
      const days = list.querySelectorAll('.sg-chat__day');
      const lastDay = days.length ? days[days.length - 1].textContent : '';
      if (lastDay !== key) list.appendChild(el('div', { className: 'sg-chat__day' }, key));
      list.appendChild(bubble(m));
      if (stick) toBottom();
    }

    /* ── ввод ────────────────────────────────────────────────────────────── */

    function grow() {
      input.style.height = 'auto';
      input.style.height = Math.min(122, input.scrollHeight) + 'px';
      sendBtn.disabled = !chat.canSend || !input.value.trim();
    }
    input.addEventListener('input', grow);

    let sending = false;
    async function send() {
      const text = input.value.trim();
      if (!text || sending || !chat.canSend) return;
      sending = true;
      sendBtn.disabled = true;
      input.value = '';
      grow();
      try {
        const res = await api.post(base + '/messages',
                                   { text, t: token, lang: getLang() });
        if (dead) return;
        const msg = pushMsg(res && res.message);
        if (msg && chatUi) add(msg);
        haptic();
      } catch (e) {
        if (!dead) {
          input.value = text;               // текст возвращаем: набирать заново обидно
          grow();
          toast(errText(e), { type: 'err' });
        }
      }
      sending = false;
      if (!dead) sendBtn.disabled = !input.value.trim();
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
      toBottom();
    }
    if (vv) {
      vv.addEventListener('resize', fitKeyboard);
      vv.addEventListener('scroll', fitKeyboard);
    }
    input.addEventListener('focus', () => setTimeout(toBottom, 120));

    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeChat();
    }
    document.addEventListener('keydown', onKey, true);

    chatUi = {
      root,
      paint,
      add,
      teardown() {
        document.removeEventListener('keydown', onKey, true);
        if (vv) {
          vv.removeEventListener('resize', fitKeyboard);
          vv.removeEventListener('scroll', fitKeyboard);
        }
      },
    };

    paint();
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
      else app.saveOrder(pid, token);
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
          if (CLOSED.indexOf(merged.status) >= 0) app.forgetOrder();
          return;
        }
        if (name === 'geo' && data.at) {
          const order = store.get().order;
          if (!order || !order.courier) return;
          const courier = Object.assign({}, order.courier, {
            at: data.at, heading: data.heading, geo_at: data.geo_at,
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

  function shareLink() {
    const url = location.origin + '/#/order/' + pid + '?t=' + encodeURIComponent(token);
    if (navigator.share) {
      navigator.share({ title: t('track.title', { id: pid }), url }).catch(() => {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => toast(t('common.copied'), { type: 'ok' }))
        .catch(() => toast(url, { type: 'info', ms: 6000 }));
      return;
    }
    toast(url, { type: 'info', ms: 6000 });
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
      const chip = el('button', { type: 'button', className: 'chip' }, t(key));
      chip.addEventListener('click', () => {
        chosen = t(key);
        for (const other of chips.children) other.classList.toggle('chip--on', other === chip);
        haptic();
      });
      chips.appendChild(chip);
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

  /* Из чего сложилась цена: те же строки, что видит бухгалтерия в заказе. */
  function openDetails() {
    const order = store.get().order || {};
    const p = order.price || {};
    const rows = el('div', null);
    const add = (key, value) => {
      if (!value) return;
      rows.appendChild(el('div', { className: 'sg-sum' },
        el('span', { className: 'sg-sum__name' }, t(key)),
        el('span', { className: 'sg-sum__val' }, money(value))));
    };
    rows.appendChild(el('div', { className: 'sg-sum' },
      el('span', { className: 'sg-sum__name' }, t('order.distance')),
      el('span', { className: 'sg-sum__val' }, distance(order.distance_m || 0))));
    rows.appendChild(el('div', { className: 'sg-sum' },
      el('span', { className: 'sg-sum__name' }, t('order.duration')),
      el('span', { className: 'sg-sum__val' }, duration(order.duration_s || 0))));
    add('order.price_base', p.base);
    add('order.price_distance', p.distance);
    add('order.price_time', p.time);
    add('order.price_loaders', p.loaders);
    add('order.price_extras', p.extras);
    add('order.price_waiting', p.waiting);
    rows.appendChild(el('div', { className: 'sg-sum sg-sum--total' },
      el('span', { className: 'sg-sum__name' }, t('order.price_total')),
      el('span', { className: 'sg-sum__val' }, money(p.total || order.price_total || 0))));

    sheet({
      title: t('track.details'),
      content: el('div', null, rows,
        el('p', { className: 'sheet__text', style: { paddingTop: 'var(--sp-3)' } },
           t('order.price_note'))),
      actions: [{ label: t('common.close'), kind: 'ghost' }],
    });
  }

  /* ── куски интерфейса ────────────────────────────────────────────────── */

  function headBox(status, order) {
    // Незнакомый статус — берём общее название из словаря, лишь бы не ключ на экране.
    const fallback = has('status.' + status) ? 'status.' + status : 'common.status';
    const pair = HEAD[status] || [fallback, ''];
    let sub = pair[1] ? t(pair[1]) : '';
    if (status === 'in_transit' && order && order.duration_s) {
      sub = t('track.eta_drop', { time: duration(order.duration_s) });
    }
    return el('div', { className: 'sg-head' },
      el('div', { className: 'sg-head__text' },
        el('div', { className: 'sg-head__title' }, t(pair[0])),
        sub ? el('div', { className: 'sg-head__sub' }, sub) : null));
  }

  function routeRow(order) {
    const pts = points(order);
    const first = pts[0] || {};
    const last = pts[pts.length - 1] || {};
    return el('button', { type: 'button', className: 'sg-route', onClick: openDetails },
      el('span', { className: 'sg-route__line' },
        el('i', null), el('b', null), el('i', null)),
      el('span', { className: 'sg-route__text' },
        el('span', { className: 'sg-route__row' }, first.addr || t('order.from')),
        el('span', { className: 'sg-route__row' }, last.addr || t('order.to'))),
      el('span', { className: 'sg-route__meta' }, distance(order.distance_m || 0)));
  }

  function priceRow(order) {
    const payKey = 'status.pay_' + (order.payment_status || 'none');
    const badge = order.payment_status && order.payment_status !== 'none' && has(payKey)
      ? el('span', { className: 'badge' }, t(payKey))
      : null;
    return el('button', { type: 'button', className: 'sg-opt', onClick: openDetails },
      el('span', { className: 'sg-opt__text' },
        el('span', { className: 'sg-opt__title' }, t('track.price')),
        el('span', { className: 'sg-opt__sub' }, t('order.price_details'))),
      badge,
      el('span', { className: 'sg-opt__total' }, money(order.price_total || 0)),
      el('span', { className: 'sg-opt__go', html: icon('go') }));
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
    if (c.phone) {
      acts.appendChild(el('a', {
        className: 'btn btn--primary grow', href: 'tel:' + c.phone.replace(/[^\d+]/g, ''),
      }, el('span', { html: icon('phone') }), t('track.call')));
    }
    const badge = el('span', { className: 'sg-unread', hidden: true }, '0');
    acts.appendChild(el('button', {
      type: 'button', className: 'btn btn--ghost grow', onClick: openChat,
      'aria-label': t('talk.title'),
    }, el('span', { html: icon('chat') }), t('talk.open'), badge));

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
    const line2 = el('div', { className: 'sg-search-line' },
      el('div', { className: 'progress progress--wait' }, el('div', { className: 'progress__bar' })));
    const play = el('button', { type: 'button', className: 'sg-item', onClick: playNow },
      el('span', { className: 'sg-item__icon sg-item__icon--accent sg-play__ico' }, '📦'),
      el('span', { className: 'sg-item__text' },
        el('span', { className: 'sg-item__title' }, t('game.play')),
        el('span', { className: 'sg-item__sub' },
           best ? t('game.play_best', { n: best }) : t('game.play_hint'))),
      el('span', { className: 'sg-opt__go', html: icon('go') }));

    const node = el('div', { className: 'sg-step' },
      headBox(order.status, order),
      el('div', { className: 'sg-body' }, line2, play, routeRow(order), priceRow(order)),
      el('div', { className: 'sg-foot' },
        el('button', {
          type: 'button', className: 'btn btn--danger btn--lg btn--block', onClick: askCancel,
        }, t('track.cancel'))));
    return { name: 'search', node, update() {} };
  }

  function stepLive(order) {
    const canCancel = !!order.can_cancel;
    const card = courierCard(order);
    const node = el('div', { className: 'sg-step' },
      headBox(order.status, order),
      el('div', { className: 'sg-body' },
        card ? card.node : null, routeRow(order), priceRow(order)),
      el('div', { className: 'sg-foot' },
        el('div', { className: 'row gap-2' },
          el('button', {
            type: 'button', className: 'btn btn--ghost grow', onClick: shareLink,
          }, t('track.share')),
          canCancel ? el('button', {
            type: 'button', className: 'btn btn--danger grow', onClick: askCancel,
          }, t('track.cancel')) : null)));
    return {
      name: 'live:' + order.status,
      node,
      /* Шаг встал на экран: счётчик непрочитанных теперь живёт на этой кнопке. */
      mount() {
        unreadBadge = card ? card.badge : null;
        paintUnread();
      },
      update(state) {
        if (card && state.order) card.sync(state.order);
      },
    };
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
      el('div', { className: 'sg-mood__title' }, t('track.rate_title')));
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

  function stepDone(order) {
    const body = el('div', { className: 'sg-body' }, routeRow(order), priceRow(order));
    const foot = el('div', { className: 'sg-foot' });

    if (store.get().rated) {
      body.appendChild(el('div', { className: 'sg-rate' },
        el('div', { className: 'sg-mood sg-mood--glad' },
          el('div', { className: 'sg-mood__face' }, el('i', null, '🙏')),
          el('div', { className: 'sg-mood__title' }, t('track.rate_thanks')))));
    } else {
      const c = order.courier;
      let value = 0;
      let reason = '';
      let wasGlad = false;

      const wrap = el('div', { className: 'sg-mood-wrap' }, moodBlock(0));
      const stars = el('div');
      const chips = el('div', { className: 'sg-chips', hidden: true });
      const need = el('div', { className: 'sg-mood__need', hidden: true });

      const comment = el('textarea', { className: 'field__input', placeholder: ' ', maxLength: 500 });
      const commentLabel = el('span', { className: 'field__label' }, t('common.comment'));
      const commentHint = el('span', { className: 'field__hint' }, t('track.rate_comment_ph'));
      const field = el('label', { className: 'field', style: { width: '100%' } },
        comment, commentLabel, commentHint);

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

      const send = el('button', { type: 'button', className: 'sg-cta', disabled: true },
        el('span', { className: 'sg-cta__label' }, t('track.rate_send')));

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
        app.panel.refresh();
      }

      for (const [code, key] of BAD_REASONS) {
        const chip = el('button', { type: 'button', className: 'chip' }, t(key));
        chip.addEventListener('click', () => {
          reason = code;
          for (const other of chips.children) other.classList.toggle('chip--on', other === chip);
          haptic();
          paintNeed();
          if (code === 'other') comment.focus();
        });
        chips.appendChild(chip);
      }

      comment.addEventListener('input', paintNeed);

      send.addEventListener('click', async () => {
        if (!ready()) return;
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
          toast(res.message || t('track.rate_thanks'), { type: 'ok' });
          store.set({ rated: true });
        } catch (e) {
          toast(errText(e), { type: 'err' });
          send.disabled = false;
        }
      });

      body.appendChild(el('div', { className: 'sg-rate' },
        wrap, stars, chips, need, field, favRow));

      mountStars(stars, {
        value: 0,
        size: 'lg',
        onChange: (v) => { value = v; paint(); },
      });
      foot.appendChild(send);
    }

    foot.appendChild(el('button', {
      type: 'button', className: 'btn btn--ghost btn--lg btn--block',
      onClick: () => { app.forgetOrder(); app.go('/'); },
    }, t('track.repeat')));

    const node = el('div', { className: 'sg-step' }, headBox('done', order), body, foot);
    return { name: 'done:' + (store.get().rated ? '1' : '0'), node, update() {} };
  }

  /* Оплата вперёд: пока деньги не пришли, поиск машины не стартует. Показываем,
     чего ждём, и даём вернуться на страницу банка. */
  function stepPay(order) {
    const pay = el('button', {
      type: 'button', className: 'sg-cta',
      onClick: async () => {
        pay.disabled = true;
        try {
          const res = await api.post('/payments/init',
                                     { public_id: pid, t: token, lang: getLang() });
          if (res && res.url) { location.href = res.url; return; }
          if (res && res.message) toast(res.message, { type: 'ok' });
          load();
        } catch (e) {
          toast(errText(e), { type: 'err' });
        }
        pay.disabled = false;
      },
    },
      el('span', { className: 'sg-cta__label' }, t('order.pay_online')),
      el('span', { className: 'sg-cta__price' }, money(order.price_total || 0)));

    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t('status.pay_pending')))),
      el('div', { className: 'sg-body' }, routeRow(order), priceRow(order)),
      el('div', { className: 'sg-foot' }, pay,
        el('button', {
          type: 'button', className: 'btn btn--danger btn--block', onClick: askCancel,
        }, t('track.cancel'))));
    return { name: 'pay', node, update() {} };
  }

  function stepClosed(order) {
    const why = order.cancel_reason
      ? el('div', { className: 'sg-fail__text' }, order.cancel_reason)
      : null;
    const node = el('div', { className: 'sg-step' },
      headBox(order.status, order),
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
    if (isSearching(order)) return stepSearch(order);
    return stepLive(order);
  }

  /* Полоска «нет связи» появляется поверх шага и уходит сама, когда поток ожил. */
  const offline = el('div', { className: 'sg-offline', hidden: true }, t('common.offline'));
  app.panel.el.querySelector('.sg-panel__box').prepend(offline);

  function render(state) {
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
    offline.hidden = state.online;
    if (state.order) syncMap(state.order);
    syncGame();
    // Курьер появился — забираем переписку, чтобы счётчик непрочитанных был честным.
    if (state.order && state.order.courier && !chat.loaded && !chat.tried) loadChat();
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
      if (chatUi) {
        closeChat(true);
        openChat();
      }
    },
    destroy() {
      dead = true;
      clearTimeout(offTimer);
      clearTimeout(readTimer);
      readTimer = 0;
      app.panel.el.removeEventListener('sheetmove', onSheetMove);
      dropGame();
      closeChat(true);
      unreadBadge = null;
      if (stream) stream.close();
      stream = null;
      offline.remove();
    },
  };
}

export default mountTrack;
