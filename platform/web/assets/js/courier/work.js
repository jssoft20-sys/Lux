/* Рабочие экраны курьера: смена, предложение заказа, заказ в работе и история
   с деньгами. Плюс служебные вещи, которые нужны всему приложению, — слежение
   за геопозицией, звук предложения, настройки этого звука и мост для событий
   потока. Личный кабинет и проверка документов живут в auth.js, оттуда же
   приходит переключатель звука; общий с ним ключ хранилища — sg_sound.

   Правило экранов простое: каждая функция render* получает пустой контейнер
   и возвращает функцию уборки. Всё, что она завела (карту, таймеры, подписки),
   она сама и гасит — иначе после десятка переходов телефон начнёт греться.

   Четыре вещи здесь сделаны нарочно и требуют пояснения:

   1. Заказ в работе — это карта во весь экран и панель снизу. Панель тянется
      пальцем и сворачивается до заголовка с главной кнопкой, чтобы водитель
      видел дорогу целиком. Сворачивается не переездом вниз, а сжатием списка:
      кнопка «еду дальше» обязана оставаться под пальцем в любом положении.
   2. Зоны спроса рисуются своим слоем на canvas поверх плиток: сорок мягких
      розовых пятен перерисовываются на каждый сдвиг карты, и делать это
      сорока элементами разметки было бы вдвое дороже.
   3. Звук предложения синтезируется: три мягких тона по возрастанию с короткой
      реверберацией. Файл сюда не кладём — он весит больше, чем весь модуль,
      и на плохой сети приезжает уже после того, как заказ ушёл другому.
   4. Чужой текст (сообщения клиента) попадает на страницу только через
      textContent. innerHTML в этом файле встречается лишь для наших
      собственных иконок, ни разу — для данных с сервера.
*/

import { api, ApiError } from '../core/api.js';
import { t, tp, getLang, extend } from '../core/i18n.js';
import { money, moneyShort, distance, duration, time, date, phone as fmtPhone,
  initials, num } from '../core/fmt.js';
import { el, toast, sheet, confirm as ask, haptic, spinner, mountStars,
  copyText } from '../core/ui.js';
import { createMap, pin, distanceM } from '../core/map.js';
import native from '../core/native.js';

/* ─────────────────────────────────────────────────────── свои строки

   Общий словарь правят соседние модули, поэтому свои тексты экран везёт с
   собой. Кыргызский — как говорят в Бишкеке: «заказ», «унаа», «жүкчү»,
   «баасы», а не книжные кальки. */

extend({
  ru: {
    'job.to_pickup_left': 'До погрузки',
    'job.to_drop_left': 'До выгрузки',
    'job.route_straight': 'по прямой',
    'job.arrive_at': 'будем в {time}',
    'job.calc': 'Строим маршрут',
    'job.nav_go': 'Открыть в Яндекс Навигаторе',
    'job.nav_pick': 'Каким навигатором вести?',
    'job.nav_ya': 'Яндекс Навигатор',
    'job.nav_2gis': '2ГИС',
    'job.fit': 'Показать весь маршрут',
    'job.follow': 'Вести по маршруту',
    'job.back': 'К смене',
    'job.details': 'Детали заказа',
    'job.cargo': 'Что везём',
    'job.addresses': 'Адреса',
    'job.money': 'Деньги',
    'job.at_pickup_auto': 'Вы на месте погрузки',
    'job.at_drop_auto': 'Вы на месте выгрузки',
    'job.point_done': 'Адрес пройден, ведём к следующему',
    'job.copy_addr': 'Нажмите — адрес скопируется',
    'job.copied': 'Адрес скопирован',
    'job.still': 'Стоите {time}',
    'job.still_text': 'Уже на месте? Поменяйте статус заказа',
    'job.still_hide': 'Понятно',

    'zone.near': 'Рядом с вами сейчас {orders}',
    'zone.near_go': 'Рядом с вами {orders} — выходите на линию',
    'zone.city': 'В городе сейчас {orders}',
    'zone.look': 'Показать, где заказов больше',

    'snd.title': 'Звук нового заказа',
    'snd.hint': 'Слышно за рулём, но не пугает',
    'snd.volume': 'Громкость',
    'snd.low': 'Тихо',
    'snd.mid': 'Средне',
    'snd.high': 'Громко',
    'snd.test': 'Проверить звук',
    'snd.ok': 'Звук работает',
    'snd.off_note': 'Звук выключен — заказ придёт молча, только вибрацией',
    'snd.blocked': 'Браузер ещё не разрешил звук. Нажмите «Проверить звук» — и он заработает',
    'snd.blocked_btn': 'Включить звук',
    'snd.none': 'Этот браузер не умеет играть звук — останется вибрация',
    'snd.idle': 'Коснитесь экрана — после этого браузер разрешит звук',

    'chat.title': 'Чат с клиентом',
    'chat.ph': 'Сообщение клиенту',
    'chat.send': 'Отправить',
    'chat.empty': 'Здесь пока пусто. Напишите клиенту, если не можете найти адрес или подъезд.',
    'chat.closed': 'Переписка по этому заказу закрыта',
    'chat.sent': 'Отправлено',
    'chat.read': 'Прочитано',
    'chat.new': 'Новое сообщение от клиента',
    'chat.unread': 'Непрочитанных: {n}',
    'chat.load_fail': 'Не получилось загрузить переписку',
    'chat.slow': 'Связь подвисла, но сообщение доставлено',

    'rate.client': 'Оцените клиента',
    'rate.hint': 'Оценку видят диспетчер и другие курьеры, клиенту она не уходит',
    'rate.comment_ph': 'Пара слов о клиенте',
    'rate.send': 'Отправить оценку',
    'rate.skip': 'Пропустить',
    'rate.need': 'Поставьте звёзды',
    'rate.thanks': 'Спасибо, оценка ушла',
    'rate.client_of': 'Клиент',
    'rate.client_new': 'Новый клиент, оценок пока нет',

    'shift.earned': 'Заработано сегодня',
    'shift.orders': 'Заказов',
    'shift.hours': 'На линии',
    'shift.min_zero': '0 мин',
    'shift.week': 'За неделю',
    'shift.month': 'За месяц',
    'shift.goal': 'Цель на день',
    'shift.goal_set': 'Поставьте цель на день',
    'shift.goal_left': 'Осталось {sum}',
    'shift.goal_done': 'Цель на сегодня взята',
    'shift.goal_hint': 'Цель видите только вы, она хранится в телефоне',
    'shift.goal_own': 'Своя сумма, сом',
    'shift.goal_save': 'Поставить цель',
    'shift.goal_off': 'Убрать цель',
    'shift.goal_bad': 'Введите сумму больше нуля',
    'shift.goal_gone': 'Цель убрана',
    'shift.leave_title': 'У вас заказ в работе',
    'shift.leave_text': 'Заказ останется на вас, его нужно довезти. Новых предложений после ухода не будет.',
    'shift.leave_ok': 'Всё равно уйти',
    'shift.stay': 'Остаться на линии',

    'earn.net': 'На руки после комиссии',
    'earn.avg': 'Средний чек',
    'earn.cash': 'Собрано наличными',
    'earn.by_days': 'По дням',
    'earn.best': 'Лучший день',
    'earn.picked': 'Выбранный день',
    'earn.best_none': 'Заказов пока не было',
    'earn.chart_alt': 'Заработок по дням, всего {sum}',
    'earn.more': 'Показать ещё',
    'earn.empty': 'За этот период заказов не было',
  },
  ky: {
    'job.to_pickup_left': 'Жүк алганга чейин',
    'job.to_drop_left': 'Жүк түшүргөнгө чейин',
    'job.route_straight': 'түз сызык менен',
    'job.arrive_at': 'саат {time}да жетебиз',
    'job.calc': 'Багыт түзүлүп жатат',
    'job.nav_go': 'Яндекс Навигатордон ачуу',
    'job.nav_pick': 'Кайсы навигатор менен барабыз?',
    'job.nav_ya': 'Яндекс Навигатор',
    'job.nav_2gis': '2ГИС',
    'job.fit': 'Бүт багытты көрсөтүү',
    'job.follow': 'Багыт менен алып баруу',
    'job.back': 'Сменага',
    'job.details': 'Заказдын деталдары',
    'job.cargo': 'Эмне ташыйбыз',
    'job.addresses': 'Даректер',
    'job.money': 'Акча',
    'job.at_pickup_auto': 'Жүк алчу жерге жеттиңиз',
    'job.at_drop_auto': 'Жүк түшүрчү жерге жеттиңиз',
    'job.point_done': 'Бул дарек өттү, кийинкисине алып баратабыз',
    'job.copy_addr': 'Бассаңыз дарек көчүрүлөт',
    'job.copied': 'Дарек көчүрүлдү',
    'job.still': '{time} турасыз',
    'job.still_text': 'Жетип калдыңызбы? Заказдын абалын которуңуз',
    'job.still_hide': 'Түшүндүм',

    'zone.near': 'Жаныңызда азыр {orders} бар',
    'zone.near_go': 'Жаныңызда {orders} бар — линияга чыгыңыз',
    'zone.city': 'Шаарда азыр {orders} бар',
    'zone.look': 'Заказ көп жерлерди көрсөтүү',

    'snd.title': 'Жаңы заказдын үнү',
    'snd.hint': 'Рулда угулат, бирок чочутпайт',
    'snd.volume': 'Үн катуулугу',
    'snd.low': 'Акырын',
    'snd.mid': 'Орто',
    'snd.high': 'Катуу',
    'snd.test': 'Үндү угуп көрүү',
    'snd.ok': 'Үн иштеп жатат',
    'snd.off_note': 'Үн өчүк — заказ үнсүз, дирилдөө менен гана келет',
    'snd.blocked': 'Браузер үнгө уруксат берген жок. «Үндү угуп көрүү» баскычын бассаңыз, иштеп кетет',
    'snd.blocked_btn': 'Үндү күйгүзүү',
    'snd.none': 'Бул браузер үн ойнотпойт — дирилдөө гана калат',
    'snd.idle': 'Экранды бир басыңыз — ошондон кийин браузер үнгө уруксат берет',

    'chat.title': 'Клиент менен чат',
    'chat.ph': 'Клиентке кабар',
    'chat.send': 'Жиберүү',
    'chat.empty': 'Азырынча бош. Дарек же подъезд табылбай жатса, клиентке жазып коюңуз.',
    'chat.closed': 'Бул заказ боюнча жазышуу жабылды',
    'chat.sent': 'Жиберилди',
    'chat.read': 'Окулду',
    'chat.new': 'Клиенттен жаңы кабар',
    'chat.unread': 'Окулбагандары: {n}',
    'chat.load_fail': 'Жазышууну жүктөй албадык',
    'chat.slow': 'Байланыш кечиктирди, бирок билдирүү жеткирилди',

    'rate.client': 'Клиентти баалаңыз',
    'rate.hint': 'Бааны диспетчер жана башка жүкчүлөр көрөт, клиентке барбайт',
    'rate.comment_ph': 'Клиент жөнүндө бир-эки сөз',
    'rate.send': 'Бааны жиберүү',
    'rate.skip': 'Өткөрүп жиберүү',
    'rate.need': 'Жылдызчаларды коюңуз',
    'rate.thanks': 'Рахмат, баа жиберилди',
    'rate.client_of': 'Клиент',
    'rate.client_new': 'Жаңы клиент, баасы али жок',

    'shift.earned': 'Бүгүн таптыңыз',
    'shift.orders': 'Заказ',
    'shift.hours': 'Линияда',
    'shift.min_zero': '0 мүн',
    'shift.week': 'Жума ичинде',
    'shift.month': 'Ай ичинде',
    'shift.goal': 'Күндүк максат',
    'shift.goal_set': 'Күнгө максат коюңуз',
    'shift.goal_left': '{sum} калды',
    'shift.goal_done': 'Бүгүнкү максат аткарылды',
    'shift.goal_hint': 'Максатты өзүңүз гана көрөсүз, ал телефонуңузда сакталат',
    'shift.goal_own': 'Өз сумманыз, сом',
    'shift.goal_save': 'Максат коюу',
    'shift.goal_off': 'Максатты алып салуу',
    'shift.goal_bad': 'Нөлдөн чоң сумма жазыңыз',
    'shift.goal_gone': 'Максат алынды',
    'shift.leave_title': 'Колуңузда заказ бар',
    'shift.leave_text': 'Заказ сизде калат, аны жеткирүү керек. Чыккандан кийин жаңы заказ келбейт.',
    'shift.leave_ok': 'Баары бир чыгам',
    'shift.stay': 'Линияда калам',

    'earn.net': 'Комиссиядан кийин колго',
    'earn.avg': 'Орточо заказ',
    'earn.cash': 'Накталай чогулду',
    'earn.by_days': 'Күндөр боюнча',
    'earn.best': 'Эң мыкты күн',
    'earn.picked': 'Тандалган күн',
    'earn.best_none': 'Заказ азырынча болгон жок',
    'earn.chart_alt': 'Күндөр боюнча киреше, бардыгы {sum}',
    'earn.more': 'Дагы көрсөтүү',
    'earn.empty': 'Бул мезгилде заказ болгон жок',
  },
});

/* ─────────────────────────────────────────────────────── иконки */

const S = (d, extra) =>
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
  'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + (extra || '') + '</svg>';

export const ICONS = {
  shift: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2v5l3 1.8"/>'),
  job: S('<path d="M3.5 8.2 12 4l8.5 4.2v7.6L12 20l-8.5-4.2z"/><path d="M3.5 8.2 12 12.4l8.5-4.2M12 12.4V20"/>'),
  hist: S('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  me: S('<circle cx="12" cy="8" r="3.6"/><path d="M4.8 19.4c1.1-3.2 3.9-5 7.2-5s6.1 1.8 7.2 5"/>'),
  phone: S('<path d="M7.2 4.5h2.1l1.5 3.6-1.8 1.3a10.4 10.4 0 0 0 4.6 4.6l1.3-1.8 3.6 1.5v2.1c0 1-.8 1.8-1.8 1.7C10.5 17 7 13.5 5.5 6.3c-.1-1 .7-1.8 1.7-1.8z"/>'),
  nav: S('<path d="M20.5 3.5 3.5 10.4l7 2.6 2.6 7z"/>'),
  clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3 1.7"/>'),
  check: S('<path d="M20 6.5 9.5 17 4 11.6"/>'),
  star: S('<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>'),
  wallet: S('<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v1.5"/><path d="M4 7.5v9A2.5 2.5 0 0 0 6.5 19H18a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 1 4 7.5z"/><circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none"/>'),
  out: S('<path d="M15 8.5V6.2a1.7 1.7 0 0 0-1.7-1.7H6.2A1.7 1.7 0 0 0 4.5 6.2v11.6a1.7 1.7 0 0 0 1.7 1.7h7.1a1.7 1.7 0 0 0 1.7-1.7V15"/><path d="M19.5 12H9.8m9.7 0-3-3m3 3-3 3"/>'),
  box: S('<rect x="4" y="4.8" width="16" height="14.4" rx="2.2"/><path d="M8.5 4.8v14.4M4 10h16"/>'),
  chat: S('<path d="M4.6 12.3c0-4 3.4-7.2 7.6-7.2s7.6 3.2 7.6 7.2-3.4 7.2-7.6 7.2c-1 0-1.9-.1-2.8-.4l-4 1.2 1.1-3.4a6.9 6.9 0 0 1-1.9-4.6z"/>'),
  send: S('<path d="M20.4 3.6 3.8 10.3l6.6 2.9 2.9 6.6z"/><path d="m10.4 13.2 10-9.6"/>'),
  back: S('<path d="M14.8 5.5 8.3 12l6.5 6.5"/>'),
  chev: S('<path d="M9.4 5.5 15.9 12l-6.5 6.5"/>'),
  fit: S('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3.2M12 18v3.2M2.8 12H6M18 12h3.2"/>'),
  // Флажок точки выгрузки: в списке адресов он отличает «куда» от «откуда».
  flag: S('<path d="M6.4 20.5V4.2"/><path d="M6.4 5.2h10.3l-2 3.6 2 3.6H6.4z"/>'),
  vol: S('<path d="M5 9.4h3.2L12 6v12l-3.8-3.4H5z"/><path d="M15.8 9.4a3.8 3.8 0 0 1 0 5.2M18.4 6.9a7.4 7.4 0 0 1 0 10.2"/>'),
  mute: S('<path d="M5 9.4h3.2L12 6v12l-3.8-3.4H5z"/><path d="m16 9.6 4.4 4.8M20.4 9.6 16 14.4"/>'),
  copy: S('<rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M15 6.4V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.4"/>'),
  goal: S('<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.4"/><path d="M12 2.6v1.4M12 20v1.4M2.6 12H4M20 12h1.4"/>'),
  alert: S('<path d="M10.3 4.7 3.6 16.9A2 2 0 0 0 5.3 20h13.4a2 2 0 0 0 1.7-3.1L13.7 4.7a2 2 0 0 0-3.4 0z"/><path d="M12 9.6v3.6"/><circle cx="12" cy="16.4" r="1" fill="currentColor" stroke="none"/>'),
};

/* Иконка отдельным узлом, без обёртки. Общие стили пишут правила на прямого
   потомка («.btn > svg», «.pill > svg»), и лишний <span> вокруг иконки их
   отключает — значок молча схлопывается в ничто. */
function ico(markup) {
  const box = document.createElement('div');
  box.innerHTML = markup;
  const node = box.firstElementChild;
  if (node) node.classList.add('sg-ico');
  return node;
}

/* ─────────────────────────────────────────────────────── свои стили

   Карта заказа, зоны спроса, чат и оценка живут только здесь, поэтому и
   правила везут с собой: в courier.css их пришлось бы искать через файл,
   который правят соседние модули. Цвета — из токенов, кроме розового:
   зона спроса одинаково читается и на светлой, и на тёмной карте. */

const OWN_CSS = `
/* Размер иконки по умолчанию. Правила общих стилей («.btn > svg» и прочие)
   специфичнее и перебивают его там, где у иконки свой размер. */
.sg-ico { flex: none; width: 20px; height: 20px; }

/* ── «вы стоите на месте» ──────────────────────────────────────────────── */

/* Напоминание мягкое: появляется без движения и рывков, просто проявляется.
   Водитель смотрит на экран урывками — дёрганье он воспримет как ошибку. */
.sg-still {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: var(--warn-soft);
  color: var(--warn);
  animation: sg-fade-in var(--dur-3) var(--ease) both;
}
.sg-still > svg { flex: none; width: 22px; height: 22px; }

@keyframes sg-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.sg-still__body {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: 1.35;
}
.sg-still__t { display: block; font-weight: 700; }
.sg-still__note { color: var(--text); }

.sg-still__x {
  flex: none;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-sm);
  color: var(--warn);
  font-weight: 700;
  font-size: var(--fs-sm);
}
.sg-still__x:active { background: var(--warn-soft); }

/* ── рейтинг клиента в карточке ────────────────────────────────────────── */

.sg-crate {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.sg-crate .stars svg { width: 13px; height: 13px; }
.sg-crate b { color: var(--text); font-variant-numeric: tabular-nums; }

/* ── счётчик непрочитанных на круглой кнопке чата ──────────────────────── */

.sg-chatbtn { position: relative; overflow: visible; }

.sg-unread {
  position: absolute;
  top: -2px;
  right: -2px;
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
  line-height: 1;
  box-shadow: 0 0 0 2px var(--surface);
}

/* ── чат с клиентом ────────────────────────────────────────────────────── */

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

.sg-chat__sub {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: var(--fs-xs);
}

.sg-chat__x,
.sg-chat__call {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r-full);
  color: var(--text);
}
.sg-chat__call { background: var(--ok-soft); color: var(--ok); }
.sg-chat__x:active,
.sg-chat__call:active { transform: scale(var(--press)); }
.sg-chat__x > svg,
.sg-chat__call > svg { width: 22px; height: 22px; }

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
  background: var(--surface);
  border: 1px solid var(--line-soft);
  animation: sg-msg-in var(--dur-2) var(--ease) both;
}
.sg-msg--mine {
  align-self: flex-end;
  border-radius: var(--r-md) var(--r-md) var(--r-xs) var(--r-md);
  background: var(--accent-soft);
  border-color: var(--accent-line);
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
.sg-chat__send:active:not(:disabled) { transform: scale(var(--press)); }
.sg-chat__send > svg { width: 20px; height: 20px; }

/* ── оценка клиента ────────────────────────────────────────────────────── */

.sg-rate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line-soft);
}

.sg-rate__title { font-family: var(--font-display); font-weight: 700; }

.sg-rate__hint {
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.4;
  text-align: center;
}

/* ── звук в профиле ────────────────────────────────────────────────────── */

.sg-snd {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-lg);
  background: var(--surface-2);
}

.sg-snd__body { flex: 1 1 auto; min-width: 0; }
.sg-snd__k { font-weight: 600; }
.sg-snd__note { color: var(--muted); font-size: var(--fs-xs); line-height: 1.4; }
.sg-snd__warn { color: var(--warn); font-size: var(--fs-xs); line-height: 1.4; }

/* ── цель на день ──────────────────────────────────────────────────────── */

.sg-goal {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  min-height: 56px;
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-2);
  text-align: left;
  transition: border-color var(--dur-2) var(--ease), background-color var(--dur-2) var(--ease),
              transform var(--dur-1) var(--ease);
}
.sg-goal:active { transform: scale(var(--press)); }
.sg-goal.is-done { background: var(--ok-soft); border-color: rgba(18, 165, 102, .4); }

.sg-goal--empty {
  align-items: center;
  justify-content: center;
  flex-direction: row;
  gap: var(--sp-2);
  border-style: dashed;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: var(--fs-body);
  font-weight: 600;
}

.sg-goal__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.sg-goal__row b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sg-goal__bar {
  height: 10px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  overflow: hidden;
}

.sg-goal__fill {
  display: block;
  width: 0;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--accent);
  transition: width var(--dur-3) var(--ease), background-color var(--dur-2) var(--ease);
}
.sg-goal.is-done .sg-goal__fill { background: var(--ok); }

.sg-goal__note { color: var(--muted); font-size: var(--fs-xs); line-height: 1.35; }
.sg-goal.is-done .sg-goal__note { color: var(--ok); }

/* Пресеты в шторке цели. */
.sg-chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.sg-chips .chip { min-height: 44px; }

/* ── деньги: столбики по дням ──────────────────────────────────────────── */

.sg-sum {
  padding: var(--sp-5);
  border-radius: var(--r-xl);
  background: var(--surface);
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-1);
  text-align: center;
}

.sg-sum__k { color: var(--muted); font-size: var(--fs-sm); }

.sg-sum__v {
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: var(--fs-display);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: -.03em;
  line-height: 1.05;
}

.sg-sum__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
  margin-top: var(--sp-4);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--line-soft);
}

.sg-cell b {
  display: block;
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sg-cell span { color: var(--muted); font-size: var(--fs-xs); }

.sg-bars {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-1);
}

/* Подпись дня стоит отдельной строкой, а не сбоку: «Лучший день: 14 сентября ·
   2 300 сом · 3 заказа» в одну строку с заголовком не влезает на 360 px, а
   обрезать в ней нечего — там каждое слово по делу. */
.sg-bars__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--muted);
  font-size: var(--fs-sm);
}

.sg-bars__pick {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text);
  font-weight: 600;
}

/* Столбики — не кнопки: за месяц их тридцать, и каждый был бы уже пальца.
   Нажатие ловит вся полоса разом и показывает тот день, куда попал палец.
   Подписи вынесены отдельной строкой с теми же долями и зазорами: так высота
   столбика считается от всей полосы, а буквы под ней ничего не сдвигают. */
.sg-bars__grid {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 120px;
  touch-action: pan-y;
}

.sg-bars__col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 100%;
}

/* Приглушённый жёлтый, а не совсем прозрачный: на светлой теме заливка в
   четырнадцать процентов на белом почти не видна. */
.sg-bars__bar {
  width: 100%;
  min-height: 3px;
  border-radius: var(--r-xs) var(--r-xs) 2px 2px;
  background: var(--accent-line);
  transition: height var(--dur-3) var(--ease), background-color var(--dur-2) var(--ease);
}
.sg-bars__col.is-on .sg-bars__bar { background: var(--accent); }

.sg-bars__caps { display: flex; gap: 3px; }

.sg-bars__cap {
  flex: 1 1 0;
  min-width: 0;
  /* В месяце столбик уже двузначного числа, но подписан только каждый пятый
     день — соседние пустые, и «15» спокойно ложится поверх них. */
  overflow: visible;
  color: var(--muted-2);
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  white-space: nowrap;
}
.sg-bars__cap.is-on { color: var(--text); font-weight: 700; }

.sg-more { align-self: center; }
`;

let cssDone = false;

function ensureCss() {
  if (cssDone || typeof document === 'undefined' || !document.head) return;
  cssDone = true;
  document.head.appendChild(el('style', { id: 'sg-work-css', text: OWN_CSS }));
}

/* ─────────────────────────────────────────────────────── тема */

const THEME_KEY = 'sg_theme';

/** Тема приложения: 'light' | 'dark' | 'auto'.
 *  Светлая по умолчанию — так решил владелец: днём на улице сливочный фон
 *  читается лучше чёрного стекла, а ночную тему водитель включит сам. */
export function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light' || v === 'auto') return v;
  } catch (e) { /* хранилище закрыто */ }
  return 'light';
}

export function applyTheme(next) {
  const value = next === 'dark' || next === 'auto' ? next : 'light';
  if (value === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try { localStorage.setItem(THEME_KEY, value); } catch (e) { /* переживём */ }
  // Строка состояния телефона красится в фон страницы, а не в акцент: жёлтая
  // полоса над светлым экраном выглядит как недогрузившаяся картинка.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mapTheme() === 'dark' ? '#0E0E10' : '#F3F1EB');
  return value;
}

/* Какая тема сейчас на самом деле — карте нужен ответ «светлая или тёмная». */
function mapTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'light') return 'light';
  if (set === 'dark') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark' : 'light';
}

/* ─────────────────────────────────────────────────────── часы на линии и цель дня

   Сервер часы не считает: он знает только, включён курьер сейчас или нет.
   Поэтому считаем на телефоне — запомнили минуту выхода на линию, при уходе
   прибавили. День берём по часам телефона: курьер и его телефон стоят в одном
   городе, и полночь у них общая.

   Цель на день тоже лежит только здесь. Это личное дело водителя, серверу она
   не нужна, а спрашивать её у сервера — лишний запрос на каждом открытии. */

const CLOCK_KEY = 'sg_shift_clock';
const GOAL_KEY = 'sg_goal';           // цель на день в тыйынах, 0 — цели нет
const GOAL_HIT_KEY = 'sg_goal_hit';   // день, в который цель уже отпраздновали
const CLOCK_MAX_S = 12 * 3600;        // дольше подряд за рулём не бывает
const GOAL_STEPS = [150000, 250000, 350000, 500000];

/* Число вида 20260914: по нему видно, тот же это день или уже следующий. */
function dayStamp(ms) {
  const d = new Date(ms === undefined ? Date.now() : ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function readStore(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;                      // хранилище закрыто — работаем без памяти
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) { /* переживём: значение продержится до перезагрузки */ }
}

function readClock() {
  const now = Math.floor(Date.now() / 1000);
  const day = dayStamp();
  let saved = null;
  try {
    saved = JSON.parse(readStore(CLOCK_KEY) || 'null');
  } catch (e) {
    saved = null;
  }
  const same = saved && Number(saved.day) === day;
  const clock = {
    day,
    secs: same ? Math.max(0, Number(saved.secs) || 0) : 0,
    since: saved && Number(saved.since) > 0 ? Math.floor(Number(saved.since)) : 0,
  };
  let healed = !same;
  // Смену забыли закрыть: телефон сел, приложение снесли, вкладку выгрузили.
  // Такой хвост тянуть нечестно — засчитываем не больше двенадцати часов.
  if (clock.since && now - clock.since > CLOCK_MAX_S) {
    clock.secs += CLOCK_MAX_S;
    clock.since = 0;
    healed = true;
  } else if (!same && clock.since) {
    clock.since = now;                // перевалили за полночь прямо на линии
  }
  if (healed) writeStore(CLOCK_KEY, JSON.stringify(clock));
  return clock;
}

/* Часы, посчитанные сервером. Он ведёт их по-настоящему: водитель меняет
   телефон, чистит браузер, заходит со второго устройства — и цифра остаётся
   та же. Память телефона остаётся запасным вариантом на случай старого
   сервера, который про online_s ещё не знает. */
const serverClock = { secs: 0, at: 0, online: false, known: false };

/** Принять часы с сервера. Зовётся на каждое состояние и на сводку по деньгам. */
export function takeServerShift(state) {
  if (!state || typeof state.online_s !== 'number') return;
  serverClock.secs = Math.max(0, Math.floor(state.online_s));
  serverClock.at = Math.floor(Date.now() / 1000);
  serverClock.online = !!state.online;
  serverClock.known = true;
}

/** Сколько секунд курьер сегодня на линии, вместе с идущей прямо сейчас сменой. */
export function shiftSeconds() {
  if (serverClock.known) {
    // Между ответами сервера досчитываем сами, иначе цифра стояла бы на месте
    // полминуты и казалась сломанной.
    const drift = serverClock.online
      ? Math.max(0, Math.floor(Date.now() / 1000) - serverClock.at) : 0;
    return serverClock.secs + drift;
  }
  const clock = readClock();
  const now = Math.floor(Date.now() / 1000);
  return clock.secs + (clock.since ? Math.max(0, now - clock.since) : 0);
}

/**
 * Сообщить часам, на линии курьер или нет. Вызывать можно сколько угодно:
 * повторный вызов с тем же значением ничего не меняет, поэтому это можно
 * делать на каждое состояние, приходящее с сервера.
 */
export function markShift(online) {
  const clock = readClock();
  const now = Math.floor(Date.now() / 1000);
  if (online && !clock.since) clock.since = now;
  else if (!online && clock.since) {
    clock.secs += Math.max(0, now - clock.since);
    clock.since = 0;
  } else {
    return clock;
  }
  writeStore(CLOCK_KEY, JSON.stringify(clock));
  return clock;
}

/** Цель на день в тыйынах. Ноль — водитель цели не ставил. */
export function getGoal() {
  const raw = Math.round(Number(readStore(GOAL_KEY)) || 0);
  return raw > 0 ? raw : 0;
}

export function setGoal(tiyin) {
  const value = Math.max(0, Math.round(Number(tiyin) || 0));
  writeStore(GOAL_KEY, String(value));
  return value;
}

/* Цель взята — сказать об этом стоит один раз за день, а не на каждый заказ. */
function goalCelebrated() {
  return Number(readStore(GOAL_HIT_KEY) || 0) === dayStamp();
}

function markGoalCelebrated() {
  writeStore(GOAL_HIT_KEY, String(dayStamp()));
}

/* Часы и минуты на линии. fmt.duration ниже минуты говорит «меньше минуты» —
   для смены это звучит странно, поэтому нулевой случай пишем сами. */
function onLineText(seconds) {
  const v = Math.max(0, Math.round(seconds || 0));
  return v < 60 ? t('shift.min_zero') : duration(v);
}

/* ─────────────────────────────────────────────────────── звук предложения */

/* Звук синтезируем, а не грузим файлом: короткий перезвон весит ноль байт,
   звучит одинаково везде и не ждёт загрузки на плохой сети.

   Что играет: три тона по возрастанию (ми — соль-диез — си), мягкая атака,
   короткий «зал» на свёртке. Такой сигнал слышно сквозь музыку в машине,
   но он не бьёт по нервам, как сирена, — водитель за рулём. */

/* Включение звука лежит в том же ключе, что читает профиль в auth.js:
   строка 'on' или 'off'. Формат чужой, но общий — иначе переключатель в
   профиле и сигнал здесь разошлись бы, и водитель остался бы без звука,
   будучи уверенным в обратном. Громкость нужна только здесь, поэтому у неё
   свой ключ. */
const SOUND_KEY = 'sg_sound';
const VOL_KEY = 'sg_sound_vol';
const LEVELS = { low: 0.16, mid: 0.32, high: 0.58 };
const TONES = [659.25, 830.61, 987.77];     // ми, соль-диез, си пятой октавы
const ALERT_TIMES = 3;                      // столько раз повторяем, пока живо предложение
const ALERT_GAP_MS = 2000;
const BUZZ = [0, 90, 70, 90, 70, 170];      // вибрация в такт перезвону

let ctxAudio = null;
let audioBus = null;
let alertTimer = 0;

function readSound() {
  const out = { on: true, level: 'mid' };
  try {
    out.on = localStorage.getItem(SOUND_KEY) !== 'off';
    const level = localStorage.getItem(VOL_KEY);
    if (level && LEVELS[level]) out.level = level;
  } catch (e) { /* хранилище закрыто — пусть лучше звенит */ }
  return out;
}

/** Настройки звука: {on, level}. Помним между запусками.
 *  Имена нарочно длиннее привычных: короткие getSound/setSound уже заняты
 *  профилем в auth.js, и одинаковые имена в двух модулях однажды столкнутся
 *  в одном импорте. Ключ хранилища при этом общий, значения — тоже. */
export function getSoundPrefs() {
  return readSound();
}

export function setSoundPrefs(patch) {
  const next = Object.assign(readSound(), patch || {});
  if (!LEVELS[next.level]) next.level = 'mid';
  next.on = !!next.on;
  try {
    localStorage.setItem(SOUND_KEY, next.on ? 'on' : 'off');
    localStorage.setItem(VOL_KEY, next.level);
  } catch (e) { /* переживём: настройка продержится до перезагрузки */ }
  if (audioBus) audioBus.master.gain.value = LEVELS[next.level];
  return next;
}

function audio() {
  if (ctxAudio) return ctxAudio;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctxAudio = new Ctor();
  } catch (e) {
    ctxAudio = null;
  }
  return ctxAudio;
}

/* Комнатка для перезвона: шум с затуханием вместо записанного зала. Секунда
   такого шума звучит как небольшое помещение и считается один раз за запуск. */
function roomBuffer(ac) {
  const len = Math.floor(ac.sampleRate * 0.9);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const x = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 3.4) * 0.7;
    }
  }
  return buf;
}

function bus() {
  const ac = audio();
  if (!ac) return null;
  if (audioBus) return audioBus;
  const master = ac.createGain();
  master.gain.value = LEVELS[readSound().level];
  master.connect(ac.destination);

  const dry = ac.createGain();
  dry.gain.value = 0.82;
  dry.connect(master);

  const wet = ac.createGain();
  wet.gain.value = 0.36;
  wet.connect(master);

  let room = null;
  try {
    room = ac.createConvolver();
    room.buffer = roomBuffer(ac);
    room.connect(wet);
  } catch (e) {
    room = null;                 // без свёртки просто останется сухой сигнал
  }

  const input = ac.createGain();
  input.connect(dry);
  if (room) input.connect(room);

  audioBus = { master, input };
  return audioBus;
}

/** Браузер разрешает звук только после касания — цепляемся за первое же.
 *  Возвращает промис: true, если контекст ожил. */
export function unlockAudio() {
  const ac = audio();
  if (!ac) return Promise.resolve(false);
  bus();
  if (ac.state === 'running') return Promise.resolve(true);
  return ac.resume().then(() => ac.state === 'running', () => false);
}

/** Что со звуком прямо сейчас: 'none' | 'off' | 'idle' | 'blocked' | 'ok'. */
export function soundStatus() {
  if (!(window.AudioContext || window.webkitAudioContext)) return 'none';
  if (!readSound().on) return 'off';
  if (!ctxAudio) return 'idle';
  return ctxAudio.state === 'running' ? 'ok' : 'blocked';
}

/** Один перезвон. force=true — проиграть, даже если звук выключен (проверка). */
export function chime(force) {
  const settings = readSound();
  if (!settings.on && !force) return false;
  const ac = audio();
  const b = bus();
  if (!ac || !b) return false;
  if (ac.state !== 'running') {
    ac.resume().catch(() => {});
    if (ac.state !== 'running') return false;
  }
  b.master.gain.value = LEVELS[settings.level];
  const t0 = ac.currentTime + 0.03;
  for (let i = 0; i < TONES.length; i++) {
    const at = t0 + i * 0.15;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(TONES[i], at);
    // Мягкая атака и длинный хвост: щелчка в начале нет, звук «дышит».
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(i === 2 ? 0.9 : 0.62, at + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
    osc.connect(gain).connect(b.input);
    osc.start(at);
    osc.stop(at + 0.62);
  }
  return true;
}

function buzz() {
  if (!navigator.vibrate) return;
  try { navigator.vibrate(BUZZ); } catch (e) { /* вибрация выключена настройками */ }
}

/** Сигнал о новом заказе: перезвон и вибрация, трижды, пока живо предложение. */
export function startAlert() {
  stopAlert();
  let left = ALERT_TIMES;
  const tick = () => {
    chime();
    buzz();
    if (--left <= 0) stopAlert();
  };
  // Первый сигнал — сразу, но после попытки разбудить звук: если браузер ещё
  // не разрешал его, перезвон пропадёт, а вибрация останется. Со звуком,
  // выключенным в профиле, звуковой движок не заводим вовсе — только трясём.
  if (readSound().on) {
    unlockAudio().then(() => {
      if (!alertTimer) return;      // на предложение уже успели ответить
      tick();
    });
  } else {
    tick();
  }
  alertTimer = setInterval(tick, ALERT_GAP_MS);
}

export function stopAlert() {
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = 0;
  if (navigator.vibrate) {
    try { navigator.vibrate(0); } catch (e) { /* выключена */ }
  }
}

/* ─────────────────────────────────────────────────────── мост событий потока

   Поток курьера один на всё приложение, и держит его app.js. Сюда события
   приходят двумя дорогами: прямым вызовом handleStreamEvent из app.js либо
   событием 'sg:stream' на документе. Обе ведут в один список подписчиков,
   поэтому экранам всё равно, какую выбрал сосед. */

const streamSubs = new Set();

export function handleStreamEvent(name, data) {
  if (!name) return;
  for (const fn of Array.from(streamSubs)) {
    try {
      fn(name, data);
    } catch (e) {
      console.error('[courier] обработчик события «' + name + '» упал', e);
    }
  }
}

function onStream(fn) {
  if (typeof fn !== 'function') return () => {};
  streamSubs.add(fn);
  return () => streamSubs.delete(fn);
}

if (typeof document !== 'undefined') {
  document.addEventListener('sg:stream', (e) => {
    const d = e && e.detail;
    if (d) handleStreamEvent(d.name, d.data);
  });
}

/* ─────────────────────────────────────────────────────── геопозиция */

const MIN_MOVE_M = 15;          // меньше — это дрожание датчика, а не поездка
const SEND_FG_MS = 10000;       // экран открыт: раз в десять секунд
const SEND_BG_MS = 30000;       // приложение свернули: реже, батарея дороже
// «Я жив» даже на стоянке. В фоне срок короче секундомера не от щедрости:
// свёрнутой вкладке браузер разрешает просыпаться раз в минуту, и с порогом
// в полторы минуты очередная отправка попадала бы уже за черту, после которой
// сервер считает позицию потерянной и перестаёт слать заказы.
const BEAT_FG_MS = 45000;       // «я жив» даже стоя на месте: сервер считает
const BEAT_BG_MS = 55000;       // позицию старше двух минут потерянной

/**
 * Слежение за своей позицией.
 * Отправляем на сервер, только если реально сдвинулись больше пятнадцати метров,
 * либо давно ничего не слали. В фоне интервал растягиваем, но не глушим совсем:
 * иначе курьер пропадёт с карты и перестанет получать заказы.
 */
export function createGeoTracker(opts = {}) {
  const onFix = typeof opts.onFix === 'function' ? opts.onFix : () => {};
  const onState = typeof opts.onState === 'function' ? opts.onState : () => {};

  let watchId = 0;
  let timer = 0;
  let running = false;
  let sending = false;
  let last = null;            // самая свежая точка с датчика
  let sent = null;            // что уже ушло на сервер
  let sentAt = 0;
  let denied = false;

  const hidden = () => document.visibilityState === 'hidden';
  const every = () => (hidden() ? SEND_BG_MS : SEND_FG_MS);
  const beat = () => (hidden() ? BEAT_BG_MS : BEAT_FG_MS);

  function should(now) {
    if (!last || sending) return false;
    if (!sent) return true;
    if (now - sentAt < every()) return false;
    if (now - sentAt >= beat()) return true;
    return distanceM(sent, [last.lat, last.lng]) >= MIN_MOVE_M;
  }

  async function push() {
    const now = Date.now();
    if (!should(now)) return;
    const point = last;
    sending = true;
    try {
      await api.post('/courier/geo', {
        lat: point.lat, lng: point.lng,
        heading: point.heading, speed: point.speed,
      });
      sent = [point.lat, point.lng];
      sentAt = Date.now();
      onState({ ok: true, at: sent, geoAt: Math.floor(sentAt / 1000) });
    } catch (e) {
      // Сеть пропала — не страшно: следующая точка уйдёт, когда связь вернётся.
      if (e instanceof ApiError && e.isAuth) stop();
    } finally {
      sending = false;
    }
  }

  function fix(pos) {
    const c = pos.coords;
    denied = false;
    last = {
      lat: c.latitude, lng: c.longitude,
      heading: isFinite(c.heading) ? c.heading : null,
      speed: isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
      accuracy: c.accuracy,
      at: Math.floor((pos.timestamp || Date.now()) / 1000),
    };
    onFix(last);
    push();
  }

  function fail(err) {
    denied = err && err.code === 1;
    onState({ ok: false, denied, message: denied ? t('err.geo_denied') : t('err.geo_failed') });
  }

  function start() {
    if (running || !navigator.geolocation) {
      if (!navigator.geolocation) onState({ ok: false, denied: false, message: t('err.geo_failed') });
      return;
    }
    running = true;
    watchId = navigator.geolocation.watchPosition(fix, fail, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 25000,
    });
    // Отдельный будильник нужен для «я жив»: пока машина стоит, датчик
    // может молчать минутами, а сервер за это время спишет курьера с линии.
    timer = setInterval(push, 5000);
  }

  function stop() {
    running = false;
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (timer) clearInterval(timer);
    watchId = 0;
    timer = 0;
  }

  return {
    start, stop,
    get running() { return running; },
    get denied() { return denied; },
    at: () => (last ? [last.lat, last.lng] : null),
    heading: () => (last ? last.heading : null),
    /* Одиночный запрос позиции: им экран просит разрешение по кнопке. */
    request() {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(fix, fail, { enableHighAccuracy: true, timeout: 15000 });
    },
  };
}

/* ─────────────────────────────────────────────────────── общие куски разметки */

function pill(icon, text) {
  return el('span', { className: 'pill' }, ico(icon), text);
}

/* Ссылка в навигатор: схема geo: открывает то приложение, которым человек
   пользуется сам, — 2ГИС, Яндекс или Google, какое стоит по умолчанию. */
function navHref(point) {
  if (!point || point.lat == null || point.lng == null) return null;
  const label = encodeURIComponent(point.addr || 'Точка');
  return 'geo:' + point.lat + ',' + point.lng + '?q=' + point.lat + ',' + point.lng + '(' + label + ')';
}

function telHref(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  return digits ? 'tel:' + digits : null;
}

/* Подробности адреса одной строкой: «подъезд 2 · кв. 14 · этаж 5 · домофон 14К». */
function pointDetails(p) {
  const parts = [];
  if (p.entrance) parts.push(t('order.entrance').toLowerCase() + ' ' + p.entrance);
  if (p.flat) parts.push('кв. ' + p.flat);
  if (p.floor) parts.push(t('order.floor').toLowerCase() + ' ' + p.floor);
  if (p.intercom) parts.push(t('order.intercom').toLowerCase() + ' ' + p.intercom);
  return parts.join(' · ');
}

/**
 * Адрес в списке. full=true добавляет кнопки «позвонить» и «навигатор»
 * и показывает контакт — до принятия заказа этих данных у курьера нет.
 */
function pointRow(p, index, count, full) {
  const isLast = index === count - 1;
  const details = pointDetails(p);
  const body = el('div', { className: 'point__body' },
    el('div', { className: 'point__addr' }, p.addr || t('order.on_map')),
    details ? el('div', { className: 'point__extra' }, details) : null);

  if (full && (p.name || p.phone)) {
    body.appendChild(el('div', { className: 'point__extra' },
      [p.name, p.phone ? fmtPhone(p.phone) : null].filter(Boolean).join(' · ')));
  }
  if (p.comment) {
    body.appendChild(el('div', { className: 'point__note' }, p.comment));
  }
  if (full) {
    const acts = el('div', { className: 'point__acts' });
    const tel = telHref(p.phone);
    if (tel) {
      acts.appendChild(el('a', { className: 'btn btn--ghost btn--sm', href: tel },
        ico(ICONS.phone), t('common.call')));
    }
    const nav = navHref(p);
    if (nav) {
      acts.appendChild(el('a', { className: 'btn btn--ghost btn--sm', href: nav },
        ico(ICONS.nav), t('courier.navigate')));
    }
    if (acts.children.length) body.appendChild(acts);
  }

  return el('div', { className: 'point' + (isLast && count > 1 ? ' point--to' : '') },
    el('div', { className: 'point__mark' }, el('span', { className: 'point__dot' })),
    body);
}

/**
 * Госномер в поле: только буквы и цифры, верхний регистр, не длиннее двенадцати.
 * «01 kg 762 atn» и «01KG762ATN» — один и тот же номер, и вводить его человек
 * может как привык. Ограничение длины стоит здесь, а не в maxlength: иначе
 * пробелы съедали бы половину номера ещё до того, как мы их уберём.
 */
export function bindPlate(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const before = input.value;
    const at = input.selectionStart;
    const clean = before.toUpperCase().replace(/[^0-9A-ZА-Я]/g, '').slice(0, 12);
    if (clean === before) return;
    input.value = clean;
    const shift = before.length - clean.length;
    try { input.setSelectionRange(Math.max(0, at - shift), Math.max(0, at - shift)); }
    catch (e) { /* поле уже потеряло фокус */ }
  });
}

/* Названия допуслуг берём из /config: в заказе лежат только коды и количества. */
function extrasText(order, config) {
  const list = Array.isArray(order.extras) ? order.extras : [];
  if (!list.length) return '';
  const lang = getLang();
  const dict = new Map();
  for (const e of (config && config.extras) || []) {
    dict.set(e.code, (lang === 'ky' ? e.name_ky : e.name_ru) || e.code);
  }
  return list.map((e) => {
    const name = dict.get(e.code) || e.code;
    return e.qty && e.qty > 1 ? name + ' × ' + num(e.qty) : name;
  }).join(', ');
}

/* Секунды в «12:34» — счётчику ожидания нужны именно часы с минутами. */
function clock(seconds) {
  const v = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = v % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(s) : two(m) + ':' + two(s);
}

/* Рейтинг клиента строкой: звёзды, цифра и сколько у него заказов.
   Курьер должен видеть, с кем едет, ещё до того, как нажмёт «Принять». */
function clientRating(client) {
  if (!client) return null;
  const box = el('div', { className: 'sg-crate' });
  if (client.rating == null) {
    box.appendChild(el('span', null, t('rate.client_new')));
    return box;
  }
  const stars = el('span');
  box.appendChild(stars);
  box.appendChild(el('b', null, String(client.rating).replace('.', ',')));
  if (client.orders_count) {
    box.appendChild(el('span', null, '· ' + tp(client.orders_count, 'common.n_order')));
  }
  mountStars(stars, { value: client.rating, readonly: true });
  return box;
}

/* ─────────────────────────────────────────────────────── карта */

function makeMap(node, config, opts = {}) {
  const m = (config && config.map) || {};
  return createMap(node, Object.assign({
    center: m.center && m.center[0] != null ? m.center : [42.8746, 74.5698],
    zoom: m.zoom || 13,
    tiles_light: m.tiles_light,
    tiles_dark: m.tiles_dark,
    max_zoom: m.max_zoom,
    attribution: m.attribution,
    theme: mapTheme(),
  }, opts));
}

/* ─────────────────────────────────────────────────────── экран смены */

/* Зоны спроса рисует сам движок карты — своим слоем, привязанным к местности.
   Спрашиваем их раз в минуту и показываем всегда, а не только на линии:
   человек открывает приложение именно затем, чтобы понять, стоит ли сегодня
   выезжать. Фиолетовые пятна и строка «рядом с вами столько-то заказов» —
   это и есть ответ. */

const ZONES_TTL_MS = 60000;
const ZONE_NEAR_M = 3000;       // «рядом» для водителя — это минут десять езды

let zonesCache = { at: 0, data: null };

/* Сколько заказов в пятнах вокруг точки. Без точки считаем весь город:
   лучше сказать «в городе сейчас двенадцать», чем промолчать. */
function zonesNear(data, at) {
  const cells = (data && data.cells) || [];
  let near = 0;
  let all = 0;
  let top = null;
  for (const c of cells) {
    const n = Math.max(0, Math.round(Number(c.orders) || 0));
    all += n;
    if (c.lat == null || c.lng == null) continue;
    if (!top || n > top.orders) top = { at: [c.lat, c.lng], orders: n };
    if (at && distanceM(at, [c.lat, c.lng]) <= ZONE_NEAR_M) near += n;
  }
  return { near, all, top };
}

/**
 * Смена: переключатель «на линии», строка спроса, деньги за день, карта
 * с зонами и настройки звука. ctx = {store, go, tracker, refresh}.
 */
export function renderShift(root, ctx) {
  ensureCss();
  const state = ctx.store.get();
  const stop = [];
  let alive = true;
  stop.push(() => { alive = false; });

  /* ── главная кнопка смены и строка спроса ───────────────────────────────
     Обе в одной карточке и без зазора между ними: строка объясняет кнопку,
     а не живёт сама по себе. */
  const lamp = el('span', { className: 'shift__lamp' });
  const title = el('span', { className: 'shift__state' });
  const toggle = el('button', { className: 'shift__toggle', type: 'button' }, lamp, title);

  const nearText = el('span', { className: 'shift__near-t' });
  const nearBtn = el('button', {
    className: 'shift__near', type: 'button', hidden: true,
    'aria-label': t('zone.look'), title: t('zone.look'),
    onClick: () => showZones(),
  }, el('span', { className: 'shift__near-dot' }), nearText,
    el('span', { className: 'shift__near-go', html: ICONS.chev }));

  const geoBox = el('div', { className: 'shift__geo', hidden: true });
  const headCard = el('div', { className: 'shift__head' }, toggle, nearBtn, geoBox);

  const mapNode = el('div', { className: 'shift__map' });

  /* ── деньги за сегодня ───────────────────────────────────────────────────
     Первое, ради чего открывают приложение. Узлы собираем один раз и дальше
     меняем только текст: экран обновляется от каждого события сервера, и
     пересборка карточки давала бы мигание там, где цифры и не поменялись. */
  const earnValue = el('div', { className: 'earn__v' }, money(0));
  const factOrders = el('b', null, '0');
  const factHours = el('b', null, onLineText(0));
  const factRating = el('b', null, '—');

  const goalNums = el('b');
  const goalFill = el('i', { className: 'sg-goal__fill' });
  const goalNote = el('div', { className: 'sg-goal__note' });
  const goalBody = [
    el('div', { className: 'sg-goal__row' }, el('span', null, t('shift.goal')), goalNums),
    el('div', { className: 'sg-goal__bar' }, goalFill),
    goalNote,
  ];
  const goalEmpty = [ico(ICONS.goal), el('span', null, t('shift.goal_set'))];
  const goalBtn = el('button', {
    className: 'sg-goal sg-goal--empty', type: 'button',
    onClick: () => askGoal(),
  }, goalEmpty);
  let goalMode = 'empty';

  const weekValue = el('b', null, money(0));
  const monthValue = el('b', null, money(0));
  const openMoney = () => { haptic(); ctx.go('/history'); };

  const earnBox = el('div', { className: 'earn' },
    el('div', { className: 'earn__top' },
      el('div', { className: 'earn__k' }, t('shift.earned')),
      earnValue),
    el('div', { className: 'earn__facts' },
      el('div', { className: 'fact' }, factOrders, el('span', null, t('shift.orders'))),
      el('div', { className: 'fact' }, factHours, el('span', null, t('shift.hours'))),
      el('div', { className: 'fact' }, factRating, el('span', null, t('courier.rating')))),
    el('div', { className: 'earn__past' },
      el('button', { className: 'fact fact--tap', type: 'button', onClick: openMoney },
        weekValue, el('span', null, t('shift.week'))),
      el('button', { className: 'fact fact--tap', type: 'button', onClick: openMoney },
        monthValue, el('span', null, t('shift.month')))),
    goalBtn);

  // Звук живёт здесь же, на экране смены: именно отсюда водитель уходит ждать
  // заказ, и именно здесь важно знать, услышит он его или нет.
  root.replaceChildren(el('div', { className: 'shift' },
    headCard, earnBox, mapNode,
    el('div', { className: 'shift__sound' }, soundSettings())));

  /* ── карта и своя точка ── */
  const map = makeMap(mapNode, state.config, { locate: false });
  stop.push(() => map.destroy());

  const zonesLayer = map.zones(null);
  stop.push(() => zonesLayer.remove());

  let me = null;
  const putMe = (at, heading) => {
    if (!at) return;
    if (!me) {
      me = map.marker({ at, html: pin('me'), anchor: 'center', zIndex: 30 });
      map.setView(at, Math.max(map.getZoom(), 14), { animate: false });
    } else {
      me.moveTo(at, { duration: 700, heading });
    }
  };
  putMe(ctx.tracker.at() || state.at, ctx.tracker.heading());

  /* ── зоны спроса ──────────────────────────────────────────────────────
     Гасим их только в заказе: там водителю нужна дорога, а не подсказки. */
  let zoneTimer = 0;
  let zoneData = null;

  function zonesWanted() {
    return !ctx.store.get().order;
  }

  function showZones() {
    const spot = zonesNear(zoneData, null).top;
    haptic();
    if (spot) map.setView(spot.at, Math.max(13, Math.min(15, map.getZoom())), { animate: true });
    mapNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function paintNear() {
    const s = ctx.store.get();
    const at = ctx.tracker.at() || s.at;
    const counts = zonesNear(zoneData, at);
    const n = at && counts.near ? counts.near : counts.all;
    if (!n) {
      nearBtn.hidden = true;
      return;
    }
    const orders = tp(n, 'common.n_order');
    const key = !at || !counts.near ? 'zone.city' : (s.online ? 'zone.near' : 'zone.near_go');
    nearText.textContent = t(key, { orders });
    nearBtn.hidden = false;
  }

  /* Чтобы сказать «рядом с вами», надо знать, где человек. На линии координаты
     идут сами; до выхода на линию спрашиваем их один раз — но только если
     разрешение уже дано. Выпрашивать доступ при открытии приложения нельзя:
     человек ещё не понял, зачем он нам, и откажет. */
  function askPointOnce() {
    if (ctx.tracker.at() || ctx.store.get().at) return;
    if (!navigator.permissions || !navigator.permissions.query) return;
    navigator.permissions.query({ name: 'geolocation' })
      .then((st) => { if (st.state === 'granted' && alive) ctx.tracker.request(); })
      .catch(() => { /* браузер про разрешения не рассказывает — обойдёмся без точки */ });
  }

  function putZones(data) {
    zoneData = data && Array.isArray(data.cells) && data.cells.length ? data : null;
    zonesLayer.setCells(zoneData);
    paintNear();
  }

  async function pullZones(fresh) {
    if (!alive || !zonesWanted()) return;
    if (!fresh && zonesCache.data && Date.now() - zonesCache.at < ZONES_TTL_MS) {
      putZones(zonesCache.data);
      return;
    }
    try {
      const data = await api.get('/courier/zones');
      zonesCache = { at: Date.now(), data };
      if (alive && zonesWanted()) putZones(data);
    } catch (e) {
      // Зоны — подсказка, а не работа: молчим и попробуем через минуту.
    }
  }

  function syncZones() {
    if (zoneTimer) clearInterval(zoneTimer);
    zoneTimer = 0;
    if (!zonesWanted()) {
      putZones(null);
      return;
    }
    pullZones(false);
    zoneTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') pullZones(true);
    }, ZONES_TTL_MS);
  }

  stop.push(() => { if (zoneTimer) clearInterval(zoneTimer); });

  /* ── переключатель ── */
  function paint() {
    const s = ctx.store.get();
    const on = !!s.online;
    toggle.classList.toggle('is-on', on);
    title.replaceChildren(
      document.createTextNode(on ? t('courier.online') : t('courier.offline')),
      el('span', { className: 'shift__note' },
        on ? t('courier.online_hint') : t('courier.offline_hint')));
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');

    const needGeo = on && !s.geoOk;
    geoBox.hidden = !needGeo;
    if (needGeo) {
      geoBox.replaceChildren(
        el('div', { className: 'grow' },
          el('b', null, t('courier.geo_off')),
          el('div', null, t('courier.geo_hint'))),
        el('button', {
          // Не btn--sm: без геопозиции заказы не приходят вовсе, и промахнуться
          // мимо этой кнопки на ходу нельзя.
          className: 'btn btn--ghost',
          type: 'button',
          onClick: () => ctx.tracker.request(),
        }, t('courier.geo_retry')));
    }
  }

  toggle.addEventListener('click', async () => {
    if (toggle.classList.contains('is-loading')) return;
    const next = !ctx.store.get().online;
    // Уйти с линии с заказом в работе можно — но человек должен понимать, что
    // заказ остаётся на нём. Молча выключить смену посреди рейса нельзя.
    if (!next && ctx.store.get().order) {
      const leave = await ask({
        title: t('shift.leave_title'),
        text: t('shift.leave_text'),
        ok: t('shift.leave_ok'),
        cancel: t('shift.stay'),
        danger: true,
      });
      if (!leave || !alive) return;
    }
    haptic(next ? [12, 40, 18] : 12);
    spinner(toggle, true);
    unlockAudio();          // заодно первое касание разрешает звук предложений
    try {
      const res = await api.post('/courier/online', { online: next });
      takeServerShift(res);             // часы на линии ведёт сервер
      markShift(!!res.online);          // запасной счёт в телефоне — на случай старого сервера
      ctx.store.set({
        online: !!res.online,
        busy: !!res.busy,
        geoOk: !!res.geo_fresh,
        order: res.order || null,
      });
      if (res.message) toast(res.message, { type: 'warn', ms: 4500 });
      if (next) ctx.tracker.start();
      else ctx.tracker.stop();
      // В приложении смену ведёт служба телефона: она шлёт координаты и держит
      // связь, когда экран погас. Говорим ей о смене здесь, по ответу сервера,
      // а не по нажатию, — иначе служба поднялась бы и на отказ сервера.
      native.setShift(!!res.online);
    } catch (e) {
      toast((e && e.message) || t('err.unknown'), { type: 'err' });
    } finally {
      spinner(toggle, false);
      paint();
      paintHours();
      paintNear();
      syncZones();
    }
  });

  /* ── цель на день ────────────────────────────────────────────────────────
     Цель водитель ставит себе сам, и живёт она в его же телефоне. Полоса
     прогресса — не украшение: видимая цель заметно дольше держит людей
     на линии, чем просто сумма заработка. */

  function todayEarned() {
    const s = ctx.store.get().stats;
    return (s && s.today && s.today.earned) || 0;
  }

  function paintGoal() {
    const goal = getGoal();
    const earned = todayEarned();
    const mode = goal > 0 ? 'set' : 'empty';
    if (mode !== goalMode) {
      goalMode = mode;
      goalBtn.replaceChildren(...(mode === 'set' ? goalBody : goalEmpty));
    }
    goalBtn.className = 'sg-goal' + (mode === 'set' ? '' : ' sg-goal--empty');
    if (mode !== 'set') {
      goalBtn.setAttribute('aria-label', t('shift.goal_set'));
      return;
    }
    const part = Math.max(0, Math.min(1, earned / goal));
    const done = earned >= goal;
    goalNums.textContent = moneyShort(earned) + ' / ' + moneyShort(goal);
    goalFill.style.width = (part * 100).toFixed(1) + '%';
    goalNote.textContent = done
      ? t('shift.goal_done')
      : t('shift.goal_left', { sum: money(goal - earned) });
    goalBtn.classList.toggle('is-done', done);
    goalBtn.setAttribute('aria-label',
      t('shift.goal') + ': ' + money(earned) + ' / ' + money(goal));
    // О взятой цели говорим один раз за день: приятно, но не назойливо.
    if (done && !goalCelebrated()) {
      markGoalCelebrated();
      toast(t('shift.goal_done'), { type: 'ok', ms: 4000 });
      haptic([16, 60, 16]);
    }
  }

  function askGoal() {
    haptic();
    const now = getGoal();
    const input = el('input', {
      className: 'field__input', type: 'number', inputMode: 'numeric',
      min: '0', step: '100', placeholder: ' ',
      value: now ? String(Math.round(now / 100)) : '',
    });
    const chips = el('div', { className: 'sg-chips' });

    function markChips() {
      const som = Math.round(Number(input.value) || 0);
      for (const chip of Array.from(chips.children)) {
        chip.classList.toggle('chip--on', Number(chip.dataset.som) === som && som > 0);
      }
    }

    for (const value of GOAL_STEPS) {
      chips.appendChild(el('button', {
        className: 'chip', type: 'button', dataset: { som: String(value / 100) },
        onClick: () => {
          input.value = String(value / 100);
          haptic();
          markChips();
        },
      }, moneyShort(value)));
    }
    input.addEventListener('input', markChips);
    markChips();

    const actions = [];
    if (now) {
      actions.push({
        label: t('shift.goal_off'),
        kind: 'ghost',
        onClick: () => {
          setGoal(0);
          paintGoal();
          toast(t('shift.goal_gone'), { type: 'info' });
        },
      });
    }
    actions.push({
      label: t('shift.goal_save'),
      kind: 'primary',
      onClick: () => {
        const som = Math.round(Number(input.value) || 0);
        if (som <= 0) {
          toast(t('shift.goal_bad'), { type: 'warn' });
          return false;
        }
        setGoal(som * 100);
        paintGoal();
        haptic([12, 40, 18]);
        return true;
      },
    });

    sheet({
      title: t('shift.goal'),
      content: el('div', { className: 'col gap-3' },
        chips,
        el('label', { className: 'field' },
          input, el('span', { className: 'field__label' }, t('shift.goal_own'))),
        el('p', { className: 'sheet__text' }, t('shift.goal_hint'))),
      actions,
    });
  }

  /* ── итоги дня ── */
  function paintStats() {
    const s = ctx.store.get().stats;
    const today = (s && s.today) || {};
    earnValue.textContent = money(today.earned || 0);
    factOrders.textContent = num(today.orders || 0);
    factRating.textContent = s && s.rating != null ? String(s.rating).replace('.', ',') : '—';
    weekValue.textContent = money((s && s.week && s.week.earned) || 0);
    monthValue.textContent = money((s && s.month && s.month.earned) || 0);
    paintGoal();
  }

  /* Часы на линии тикают сами по себе, поэтому обновляем их по будильнику,
     а не по событиям сервера. Раз в полминуты достаточно: минуты меняются
     медленно, а лишние перерисовки на экране за рулём только мешают. */
  function paintHours() {
    factHours.textContent = onLineText(shiftSeconds());
  }

  const hoursTimer = setInterval(paintHours, 30000);
  stop.push(() => clearInterval(hoursTimer));

  paint();
  paintStats();
  paintHours();
  syncZones();
  askPointOnce();

  stop.push(ctx.store.on(() => { paint(); paintStats(); }));
  stop.push(ctx.store.select((s) => s.online, () => { paintHours(); paintNear(); syncZones(); }));
  stop.push(ctx.store.select((s) => s.order, () => syncZones()));
  stop.push(ctx.onFix((point) => {
    putMe([point.lat, point.lng], point.heading);
    paintNear();
  }));

  /* Свежие цифры по смене: экран смены открывают как раз затем, чтобы их
     увидеть. Возвращение к приложению — тоже повод спросить заново, но не
     чаще раза в минуту: заказы столько не делаются. */
  let statsAt = 0;

  function pullStats(force) {
    if (!alive) return;
    if (!force && Date.now() - statsAt < 60000) return;
    statsAt = Date.now();
    api.get('/courier/stats', { period: 'today' })
      .then((s) => { if (alive) ctx.store.set({ stats: s }); })
      .catch(() => { /* остаются прошлые цифры, тост здесь только помешает */ });
  }

  const onWake = () => {
    if (document.visibilityState !== 'visible') return;
    paintHours();
    pullStats(false);
    pullZones(false);
  };
  document.addEventListener('visibilitychange', onWake);
  stop.push(() => document.removeEventListener('visibilitychange', onWake));

  pullStats(true);

  return () => { for (const fn of stop) fn(); };
}

/* ─────────────────────────────────────────────────────── предложение заказа */

const RING_R = 53;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Полноэкранная карточка предложения с кольцом обратного отсчёта.
 * Возвращает {close}. onAnswer('accept'|'skip'|'gone') зовётся один раз.
 */
export function showOffer(box, offer, ctx, onAnswer) {
  ensureCss();
  const order = offer.order || {};
  const points = order.points || [];
  const lang = getLang();
  const tariff = order.tariff || {};
  const answered = { done: false };

  const bar = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [node, cls] of [[track, 'ring__track'], [bar, 'ring__bar']]) {
    node.setAttribute('class', cls);
    node.setAttribute('cx', '58');
    node.setAttribute('cy', '58');
    node.setAttribute('r', String(RING_R));
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke-width', '6');
  }
  bar.setAttribute('stroke-dasharray', RING_C.toFixed(1));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ring__svg');
  svg.setAttribute('viewBox', '0 0 116 116');
  svg.appendChild(track);
  svg.appendChild(bar);

  const left = el('span', { className: 'ring__left' });
  const accept = el('button', { className: 'ring__btn', type: 'button' },
    el('span', null, t('courier.accept')), left);
  const ring = el('div', { className: 'ring' }, svg, accept);

  const skip = el('button', { className: 'offer__skip', type: 'button' }, t('courier.decline'));

  const rows = el('div', { className: 'offer__rows' });
  for (let i = 0; i < points.length; i++) {
    rows.appendChild(pointRow(points[i], i, points.length, false));
  }

  const facts = el('div', { className: 'row wrap gap-2', style: { marginTop: 'var(--sp-4)' } });
  if (offer.to_pickup_m != null) {
    facts.appendChild(pill(ICONS.nav, t('courier.offer_distance') + ': ' + distance(offer.to_pickup_m)));
  }
  if (order.distance_m) facts.appendChild(pill(ICONS.job, distance(order.distance_m)));
  if (order.duration_s) facts.appendChild(pill(ICONS.clock, duration(order.duration_s)));
  if (order.loaders) facts.appendChild(pill(ICONS.me, tp(order.loaders, 'common.n_loader')));

  const extras = extrasText(order, ctx.store.get().config);
  if (extras) facts.appendChild(pill(ICONS.box, extras));

  const head = el('div', { className: 'offer__head' },
    el('div', null,
      el('div', { className: 'offer__kind' }, t('courier.new_order')),
      el('div', { className: 'muted t-sm' },
        (lang === 'ky' ? tariff.name_ky : tariff.name_ru) || '')),
    el('span', { className: 'badge badge--accent' }, order.public_id || ''));

  const pay = el('div', { className: 'offer__pay' },
    el('div', { className: 'offer__pay-k' }, t('courier.offer_pay')),
    el('div', { className: 'offer__pay-v' }, money(order.courier_payout || 0)),
    el('div', { className: 'offer__pay-note' },
      t('order.price_total') + ': ' + money(order.price_total || 0)));

  const body = el('div', { className: 'offer__body' }, head, pay, facts, rows);

  // С кем ехать — видно до того, как палец нажмёт «Принять».
  const rate = clientRating(order.client);
  if (rate) {
    rate.style.marginTop = 'var(--sp-3)';
    body.appendChild(rate);
  }
  if (order.comment) {
    body.appendChild(el('div', { className: 'point__note', style: { marginTop: 'var(--sp-4)' } },
      t('courier.client_comment') + ': ' + order.comment));
  }

  // Если браузер ещё не разрешил звук, честно говорим об этом здесь же:
  // предложение — единственное место, где тишина стоит денег. Ответ узнаём
  // после попытки разбудить контекст, а не гадаем заранее.
  const wake = el('button', {
    className: 'btn btn--ghost btn--block',
    type: 'button',
    hidden: true,
    style: { marginTop: 'var(--sp-3)' },
    onClick: async () => {
      const ok = await unlockAudio();
      if (ok) {
        chime(true);
        wake.hidden = true;
      } else {
        toast(t('snd.blocked'), { type: 'warn', ms: 5000 });
      }
    },
  }, ico(ICONS.vol), t('snd.blocked_btn'));
  body.appendChild(wake);
  unlockAudio().then((ok) => { wake.hidden = ok || !readSound().on; });

  box.replaceChildren(body, el('div', { className: 'offer__foot' }, skip, ring));
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', t('courier.new_order'));
  box.tabIndex = -1;
  box.hidden = false;
  box.focus({ preventScroll: true });

  /* ── обратный отсчёт ── */
  const ttl = Math.max(1, offer.ttl_s || 30);
  const until = (offer.expires_at || 0) * 1000;
  let raf = 0;

  function tick() {
    const ms = until ? until - Date.now() : 0;
    const secs = Math.max(0, ms / 1000);
    const part = Math.max(0, Math.min(1, secs / ttl));
    bar.setAttribute('stroke-dashoffset', (RING_C * (1 - part)).toFixed(1));
    bar.classList.toggle('is-hot', secs <= 5);
    left.textContent = Math.ceil(secs) + (getLang() === 'ky' ? ' сек' : ' с');
    if (secs <= 0) {
      finish('gone');
      return;
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function finish(how, payload) {
    if (answered.done) return;
    answered.done = true;
    cancelAnimationFrame(raf);
    stopAlert();
    box.hidden = true;
    box.replaceChildren();
    if (onAnswer) onAnswer(how, payload);
  }

  accept.addEventListener('click', async () => {
    if (accept.disabled) return;
    haptic([18, 40, 24]);
    accept.disabled = true;
    skip.disabled = true;
    try {
      const res = await api.post('/courier/offers/' + offer.offer_id + '/accept');
      toast(t('courier.accepted'), { type: 'ok' });
      finish('accept', res);
    } catch (e) {
      const gone = e instanceof ApiError && (e.status === 409 || e.status === 404);
      toast((e && e.message) || t('courier.offer_gone'), { type: gone ? 'info' : 'err' });
      finish('gone');
    }
  });

  skip.addEventListener('click', async () => {
    if (skip.disabled) return;
    haptic();
    skip.disabled = true;
    accept.disabled = true;
    try {
      await api.post('/courier/offers/' + offer.offer_id + '/decline');
    } catch (e) { /* сервер и сам снимет предложение по таймеру */ }
    finish('skip');
  });

  startAlert();
  return { close: (how) => finish(how || 'gone'), offerId: offer.offer_id };
}

/* ─────────────────────────────────────────────────────── чат с клиентом

   Переписка живёт в модуле, а не в экране: курьер уходит в историю и
   возвращается, а сообщения должны остаться на месте, без повторной загрузки.
   Живые сообщения приходят событием 'message' из потока курьера; опрос раз в
   несколько секунд оставлен запасным путём — на случай, если поток лёг. */

const CHAT_POLL_OPEN_MS = 12000;
const CHAT_POLL_IDLE_MS = 45000;
const CHAT_POLL_LIVE_MS = 70000;
const CHAT_KEEP = 4;                 // переписок в памяти: старые заказы уже закрыты

const chats = new Map();

function chatOf(orderId) {
  let c = chats.get(orderId);
  if (!c) {
    c = {
      items: [], ids: new Set(), unread: 0, lastId: 0,
      canSend: true, note: '', maxText: 1000, loaded: false, live: false,
    };
    chats.set(orderId, c);
    while (chats.size > CHAT_KEEP) {
      const oldest = chats.keys().next().value;
      if (oldest === orderId) break;
      chats.delete(oldest);
    }
  }
  return c;
}

/* Сообщение в наш вид. Повтор из потока не задваивается: id уже известен. */
function chatPush(c, raw) {
  if (!raw || raw.id === undefined || raw.id === null) return null;
  const id = Number(raw.id);
  if (c.ids.has(id)) {
    const was = c.items.find((m) => m.id === id);
    if (was && raw.read_at && !was.read_at) was.read_at = raw.read_at;
    return null;
  }
  const msg = {
    id,
    mine: raw.mine === undefined ? raw.sender === 'courier' : !!raw.mine,
    text: String(raw.text || ''),
    at: Number(raw.at) || 0,
    read_at: raw.read_at || null,
  };
  c.ids.add(id);
  c.items.push(msg);
  const n = c.items.length;
  if (n > 1 && c.items[n - 2].id > id) c.items.sort((a, b) => a.id - b.id);
  if (id > c.lastId) c.lastId = id;
  return msg;
}

async function chatLoad(orderId, after) {
  const c = chatOf(orderId);
  const res = await api.get('/courier/orders/' + orderId + '/messages',
    after ? { after } : null);
  if (!after) {
    c.items = [];
    c.ids = new Set();
  }
  const fresh = [];
  for (const m of (Array.isArray(res.items) ? res.items : [])) {
    const msg = chatPush(c, m);
    if (msg) fresh.push(msg);
  }
  c.unread = Math.max(0, Number(res.unread) || 0);
  c.canSend = res.can_send !== false;
  c.note = res.message || '';
  c.maxText = Number(res.max_text) || 1000;
  if (Number(res.last_id) > c.lastId) c.lastId = Number(res.last_id);
  c.loaded = true;
  return fresh;
}

async function chatRead(orderId) {
  const c = chatOf(orderId);
  if (!c.unread) return;
  try {
    await api.post('/courier/orders/' + orderId + '/messages/read');
    c.unread = 0;
  } catch (e) { /* не прочиталось — отметим при следующем открытии */ }
}

/* Отметка «прочитано» на наших сообщениях: галочка появляется без перезагрузки. */
function chatMarkRead(c, ids, at) {
  const set = new Set((ids || []).map(Number));
  let touched = false;
  for (const m of c.items) {
    if (m.mine && !m.read_at && (!set.size || set.has(m.id))) {
      m.read_at = at || Math.floor(Date.now() / 1000);
      touched = true;
    }
  }
  return touched;
}

/**
 * Экран переписки поверх всего. Возвращает {sync, close}.
 * peer = {name, sub, tel} — кто по ту сторону.
 */
function openChat(orderId, peer, opts = {}) {
  ensureCss();
  const c = chatOf(orderId);
  const list = el('div', { className: 'sg-chat__list' });
  const note = el('div', { className: 'sg-chat__note', hidden: true });

  const input = el('textarea', {
    className: 'sg-chat__input',
    rows: 1,
    placeholder: t('chat.ph'),
    maxLength: c.maxText,
    enterkeyhint: 'send',
  });
  const sendBtn = el('button', {
    type: 'submit', className: 'sg-chat__send', html: ICONS.send,
    'aria-label': t('chat.send'), title: t('chat.send'), disabled: true,
  });
  const form = el('form', { className: 'sg-chat__form' }, input, sendBtn);

  const head = el('div', { className: 'sg-chat__head' },
    el('button', {
      className: 'sg-chat__x', type: 'button', html: ICONS.back,
      'aria-label': t('common.back'), onClick: () => close(),
    }),
    el('span', { className: 'avatar avatar--accent' }, initials(peer.name) || '·'),
    el('div', { className: 'sg-chat__who' },
      el('span', { className: 'sg-chat__name' }, peer.name || t('rate.client_of')),
      el('span', { className: 'sg-chat__sub' }, peer.sub || '')),
    peer.tel
      ? el('a', {
        className: 'sg-chat__call', href: peer.tel, html: ICONS.phone,
        'aria-label': t('courier.call_client'), title: t('courier.call_client'),
      })
      : null);

  const root = el('div', {
    className: 'sg-chat', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('chat.title'),
  }, head, list, note, form);

  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('sg-chat--in'));

  function nearBottom() {
    return list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  }

  function toBottom() {
    list.scrollTop = list.scrollHeight;
  }

  /* Чужой текст только через textContent: el() кладёт строки текстовым узлом,
     а html здесь не используется ни для одного сообщения. */
  function bubble(m) {
    const tick = m.mine
      ? el('span', {
        className: 'sg-msg__tick' + (m.read_at ? ' is-read' : ''),
        title: m.read_at ? t('chat.read') : t('chat.sent'),
      }, m.read_at ? '✓✓' : '✓')
      : null;
    return el('div', { className: 'sg-msg' + (m.mine ? ' sg-msg--mine' : '') },
      el('span', { className: 'sg-msg__text' }, m.text),
      el('span', { className: 'sg-msg__meta' }, time(m.at), tick));
  }

  let loading = false;
  let failed = null;

  function paint() {
    const stick = nearBottom();
    const kids = [];
    let lastDay = '';
    for (const m of c.items) {
      const key = date(m.at);
      if (key !== lastDay) {
        lastDay = key;
        kids.push(el('div', { className: 'sg-chat__day' }, key));
      }
      kids.push(bubble(m));
    }
    if (!kids.length) {
      kids.push(el('div', { className: 'sg-chat__empty' },
        loading ? t('common.loading')
          : (failed ? t('chat.load_fail') : t('chat.empty'))));
    }
    list.replaceChildren(...kids);
    note.textContent = c.canSend ? (c.note || '') : (c.note || t('chat.closed'));
    note.hidden = !note.textContent;
    input.disabled = !c.canSend;
    input.maxLength = c.maxText;
    sendBtn.disabled = !c.canSend || !input.value.trim();
    if (stick) toBottom();
  }

  function add(m) {
    const stick = nearBottom() || m.mine;
    const empty = list.querySelector('.sg-chat__empty');
    if (empty) empty.remove();
    const key = date(m.at);
    const days = list.querySelectorAll('.sg-chat__day');
    const lastDay = days.length ? days[days.length - 1].textContent : '';
    if (lastDay !== key) list.appendChild(el('div', { className: 'sg-chat__day' }, key));
    list.appendChild(bubble(m));
    if (stick) toBottom();
  }

  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(122, input.scrollHeight) + 'px';
    sendBtn.disabled = !c.canSend || !input.value.trim();
  }
  input.addEventListener('input', grow);

  /* Один и тот же текст, набранный человеком: пробелы по краям и перевод
     строки в счёт не идут. */
  function sameText(a, b) {
    return String(a || '').trim() === String(b || '').trim();
  }

  let sending = false;
  /* Ключ отправки живёт, пока в поле тот же текст: связь подвисла, водитель
     жмёт ещё раз — сервер узнаёт свою же запись по ключу и второго пузыря не
     заводит (server/routers/extra.py, _send_message). */
  let sendKey = '';
  let sendKeyFor = '';

  function keyFor(text) {
    if (sendKey && sendKeyFor === text) return sendKey;
    sendKeyFor = text;
    sendKey = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    return sendKey;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || sending || !c.canSend) return;
    sending = true;
    sendBtn.disabled = true;
    const key = keyFor(text);
    input.value = '';
    grow();
    try {
      const res = await api.post('/courier/orders/' + orderId + '/messages', { text, key });
      const msg = chatPush(c, res && res.message);
      if (msg) add(msg);
      sendKey = '';
      sendKeyFor = '';
      haptic();
      if (typeof opts.onChange === 'function') opts.onChange();
    } catch (e) {
      // Сообщение могло уже уйти и вернуться потоком, пока мы ждали ответа.
      // Тогда возвращать текст в поле нельзя: водитель отправит его вторым.
      if (c.items.some((m) => m.mine && sameText(m.text, text))) {
        sendKey = '';
        sendKeyFor = '';
        toast(t('chat.slow'), { type: 'warn' });
      } else {
        input.value = text;               // текст возвращаем: набирать заново обидно
        grow();
        toast((e && e.message) || t('err.unknown'), { type: 'err' });
      }
    }
    sending = false;
    sendBtn.disabled = !c.canSend || !input.value.trim();
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
    close();
  }
  document.addEventListener('keydown', onKey, true);

  let closed = false;

  function close(now) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    if (vv) {
      vv.removeEventListener('resize', fitKeyboard);
      vv.removeEventListener('scroll', fitKeyboard);
    }
    root.classList.remove('sg-chat--in');
    if (now) root.remove();
    else setTimeout(() => root.remove(), 400);
    if (typeof opts.onClose === 'function') opts.onClose();
  }

  paint();
  if (!c.loaded) {
    loading = true;
    paint();
    chatLoad(orderId, 0)
      .then(() => { loading = false; failed = null; })
      .catch((e) => { loading = false; failed = e; })
      .then(() => {
        if (closed) return;
        paint();
        chatRead(orderId).then(() => {
          if (typeof opts.onChange === 'function') opts.onChange();
        });
      });
  } else {
    toBottom();
    chatRead(orderId).then(() => {
      if (typeof opts.onChange === 'function') opts.onChange();
    });
  }

  return {
    /** Пришли новые сообщения или отметки прочтения — дорисовать. */
    sync(fresh) {
      if (closed) return;
      if (Array.isArray(fresh) && fresh.length && list.querySelector('.sg-msg')) {
        for (const m of fresh) add(m);
      } else {
        paint();
      }
    },
    close,
    get closed() { return closed; },
  };
}

/* ─────────────────────────────────────────────────────── заказ в работе */

/* Куда идём дальше и что написано на большой кнопке. Порядок совпадает
   с тем, что разрешает сервер: назад по цепочке заказ не ходит. */
const FLOW = {
  assigned: { next: 'to_pickup', label: 'courier.to_pickup', now: 'courier.accepted' },
  to_pickup: { next: 'at_pickup', label: 'courier.arrived', now: 'courier.to_pickup' },
  at_pickup: { next: 'in_transit', label: 'courier.go', now: 'courier.start_loading' },
  in_transit: { next: 'at_dropoff', label: 'courier.at_dropoff', now: 'order.in_transit' },
  at_dropoff: { next: 'done', label: 'courier.finish', now: 'track.at_dropoff', swipe: true },
};

const WAITING_AT = ['at_pickup', 'at_dropoff'];
const TO_PICKUP = ['assigned', 'to_pickup', 'at_pickup'];

/* Маршрут до следующей точки пересчитываем не чаще, чем раз в двенадцать
   секунд, и только если проехали заметный кусок: сервер отдаёт его из кэша,
   но лишние запросы на плохой сети всё равно тормозят экран. */
const LEG_MIN_MS = 12000;
const LEG_MAX_MS = 60000;
const LEG_MOVE_M = 150;
const CITY_SPEED = 7.8;         // м/с, средняя скорость по городу для запасного расчёта
const ROAD_FACTOR = 1.28;       // насколько дорога длиннее прямой линии

/** Полоса протяжки для последнего шага. onDone вызывается один раз. */
function swipeBar(label, onDone) {
  const fill = el('div', { className: 'swipe__fill' });
  const text = el('div', { className: 'swipe__text' }, label);
  const knob = el('div', { className: 'swipe__knob', html: ICONS.check });
  const box = el('div', {
    className: 'swipe', role: 'button', tabIndex: 0, 'aria-label': label,
  }, fill, text, knob);

  let pid = null, x0 = 0, span = 0, dx = 0, fired = false, t0 = 0;

  const draw = (value) => {
    knob.style.transform = 'translateX(' + value + 'px)';
    fill.style.width = (value + 60) + 'px';
  };

  const done = () => {
    if (fired) return;
    fired = true;
    box.classList.add('is-done');
    box.classList.remove('is-drag');
    knob.style.transform = 'translateX(' + span + 'px)';
    haptic([20, 60, 30]);
    onDone();
  };

  box.addEventListener('pointerdown', (e) => {
    if (fired || e.button) return;
    pid = e.pointerId;
    x0 = e.clientX;
    t0 = performance.now();
    span = Math.max(40, box.clientWidth - 60);
    box.classList.add('is-drag');
    try { box.setPointerCapture(pid); } catch (err) { /* мышь без захвата */ }
  });

  box.addEventListener('pointermove', (e) => {
    if (pid === null || e.pointerId !== pid) return;
    dx = Math.max(0, Math.min(span, e.clientX - x0));
    draw(dx);
  });

  const release = (e) => {
    if (pid === null || (e.pointerId !== undefined && e.pointerId !== pid)) return;
    pid = null;
    box.classList.remove('is-drag');
    // Три четверти пути — или резкий рывок больше чем на половину: случайным
    // касанием столько не проедешь, а нарочно получается с первого раза.
    const speed = dx / Math.max(1, performance.now() - t0);
    if (dx >= span * 0.75 || (dx >= span * 0.5 && speed > 0.9)) done();
    else { dx = 0; draw(0); }
  };
  box.addEventListener('pointerup', release);
  box.addEventListener('pointercancel', release);

  // С клавиатуры протянуть нечем, поэтому там обычное подтверждение вопросом.
  box.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (fired) return;
    if (await ask({ title: t('courier.finish'), text: t('courier.finish_confirm'), ok: t('common.done') })) {
      done();
    }
  });

  return box;
}

/* Приложение навигатора, а если его нет — сайт. Понять, ушли мы или нет,
   можно только по одному признаку: свернулась вкладка или осталась на месте. */
function openNav(appUrl, webUrl) {
  let left = false;
  const mark = () => { if (document.visibilityState === 'hidden') left = true; };
  document.addEventListener('visibilitychange', mark);
  try {
    window.location.href = appUrl;
  } catch (e) { /* схема не поддержана — уйдём на сайт по таймеру */ }
  setTimeout(() => {
    document.removeEventListener('visibilitychange', mark);
    if (left || document.visibilityState === 'hidden') return;
    const w = window.open(webUrl, '_blank', 'noopener');
    if (!w) window.location.href = webUrl;      // всплывающие окна запрещены
  }, 1300);
}

function yandexLinks(lat, lng) {
  return {
    app: 'yandexnavi://build_route_on_map?lat_to=' + lat + '&lon_to=' + lng,
    web: 'https://yandex.ru/maps/?rtext=~' + lat + ',' + lng + '&rtt=auto',
  };
}

function dgisLinks(lat, lng) {
  return {
    app: 'dgis://2gis.ru/routeSearch/rsType/car/to/' + lng + ',' + lat,
    web: 'https://2gis.kg/bishkek/directions/points/%7C' + lng + ',' + lat,
  };
}

/* Каким навигатором человек пользуется. Запоминаем его выбор, чтобы долгое
   нажатие на адрес открывало сразу нужное приложение, без лишнего вопроса.
   По умолчанию Яндекс: в Бишкеке он чаще стоит у водителей и знает пробки. */
const NAV_KEY = 'sg_nav';

function preferredNav() {
  return readStore(NAV_KEY) === '2gis' ? '2gis' : 'ya';
}

function rememberNav(code) {
  writeStore(NAV_KEY, code === '2gis' ? '2gis' : 'ya');
}

function navLinks(code, lat, lng) {
  return code === '2gis' ? dgisLinks(lat, lng) : yandexLinks(lat, lng);
}

/**
 * Долгое нажатие на узел. Возвращает {long, destroy}: long() говорит, было ли
 * последнее касание долгим, — обычный клик после него надо пропустить, иначе
 * одно касание сработает дважды.
 */
function onLongPress(node, ms, onLong) {
  let timer = 0;
  let x0 = 0;
  let y0 = 0;
  let fired = false;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
  };
  const down = (e) => {
    if (e.button) return;
    fired = false;
    x0 = e.clientX;
    y0 = e.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = 0;
      fired = true;
      onLong();
    }, ms);
  };
  // Палец поехал — значит, человек листает карту, а не держит кнопку.
  const move = (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) cancel();
  };
  const menu = (e) => e.preventDefault();

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', menu);

  return {
    long: () => fired,
    /* Снять отметку долгого нажатия: без этого следующий вызов с клавиатуры,
       где pointerdown не бывает, тоже посчитали бы долгим. */
    reset() { fired = false; },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('contextmenu', menu);
    },
  };
}

/* ─────────────────────────────────────────────────────── навигатор

   Как только заказ принят, экран заказа — это карта во весь экран с уже
   построенной ниткой от машины до точки А. Ни списка адресов, ни кнопки
   «построить маршрут»: всё, что можно посчитать по координатам, экран
   считает сам. Машина стоит в нижней трети, карта поворачивается по ходу,
   пройденный кусок нитки гаснет, между посылками GPS кадры дорисовываются —
   это делает map.follow() в ядре карты.

   Нажимать человеку остаётся только то, чего телефон знать не может:
   «погрузился» и «отдал». Приезд, отъезд и сход с маршрута видны по
   координатам, и заказ переключается сам. */

const DRIVE_TO_PICKUP = ['assigned', 'to_pickup'];

const ARRIVE_M = 70;            // ближе этого считаем, что доехали
const ARRIVE_SPEED = 4.2;       // м/с: быстрее — это проезд мимо, а не приезд
const ARRIVE_HOLD_MS = 6000;    // столько стоим у точки, прежде чем поверить
const OFF_ROUTE_M = 70;         // дальше от нитки — значит, свернули; строим заново
const NAV_ZOOM = 17;            // «вплотную»: видно перекрёсток и заезды во дворы
const NAV_ANCHOR = 0.7;         // машина в нижней трети экрана
const NAV_BACK_MS = 12000;      // через столько карта сама возвращается к машине
const FIRST_FOLLOW_MS = 2600;   // сперва весь маршрут целиком, потом ведём

/**
 * Где машина на нитке маршрута: сколько пройдено, сколько осталось и
 * насколько мы от неё отклонились. Считаем в плоскости вокруг самой машины —
 * на городских расстояниях такая проекция врёт меньше метра, а тригонометрии
 * в ней нет, и звать её можно хоть каждый кадр.
 */
function alongLine(line, at) {
  const out = { progress: 0, off: 0, left: 0 };
  if (!Array.isArray(line) || line.length < 2 || !at) return out;
  const k = Math.cos(at[0] * Math.PI / 180);
  const xs = [];
  for (const p of line) xs.push([(p[1] - at[1]) * k * 111320, (p[0] - at[0]) * 110540]);
  let run = 0;
  let best = { d: Infinity, run: 0 };
  for (let i = 0; i < xs.length - 1; i++) {
    const ax = xs[i][0];
    const ay = xs[i][1];
    const vx = xs[i + 1][0] - ax;
    const vy = xs[i + 1][1] - ay;
    const len = Math.hypot(vx, vy);
    const u = len > 0 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (len * len))) : 0;
    const d = Math.hypot(ax + vx * u, ay + vy * u);   // машина — в начале координат
    if (d < best.d) best = { d, run: run + len * u };
    run += len;
  }
  if (run <= 0) return out;
  out.progress = Math.max(0, Math.min(1, best.run / run));
  out.off = best.d;
  out.left = Math.max(0, run - best.run);
  return out;
}

/**
 * Точка для карты. Курс и скорость кладём только тогда, когда датчик их
 * действительно дал: «неизвестно» — это отсутствующее поле, а не ноль. Ноль
 * карта прочитает как «стоим носом на север» и перестанет поворачиваться
 * по ходу движения, хотя машина едет.
 */
function fixPos(lat, lng, heading, speed) {
  const out = { lat, lng };
  if (typeof heading === 'number' && isFinite(heading)) out.heading = heading;
  if (typeof speed === 'number' && isFinite(speed) && speed >= 0) out.speed = speed;
  return out;
}

/** Строка «к 14:35»: клиенту по телефону называют именно время, а не минуты. */
function arriveClock(seconds) {
  const secs = Math.max(0, Math.round(Number(seconds) || 0));
  return time(Math.floor(Date.now() / 1000) + secs);
}

/**
 * Экран активного заказа: карта во весь экран, свой навигатор, панель в одну
 * строку и полноэкранные детали. ctx = {store, go, tracker, onFix, refresh}.
 */
export function renderJob(root, ctx) {
  ensureCss();
  const stop = [];
  const state = ctx.store.get();
  let alive = true;

  if (!state.order) {
    root.replaceChildren(el('div', { className: 'empty' },
      el('div', { className: 'empty__icon', html: ICONS.box }),
      el('div', { className: 'empty__title' }, t('courier.no_order')),
      el('div', { className: 'empty__text' }, t('courier.offline_hint')),
      el('button', {
        className: 'btn btn--primary', type: 'button',
        style: { marginTop: 'var(--sp-3)' },
        onClick: () => ctx.go('/shift'),
      }, t('courier.shift'))));
    return () => {};
  }

  const orderId = state.order.id;
  // Первым делом в уборке гасим признак жизни: асинхронные ответы, пришедшие
  // после ухода с экрана, не должны трогать уже снятую разметку.
  stop.push(() => { alive = false; });

  /* ── разметка экрана ──────────────────────────────────────────────────── */

  const mapNode = el('div', { className: 'job__map', 'data-map': '' });

  const backBtn = el('button', {
    className: 'job__round', type: 'button', html: ICONS.back,
    'aria-label': t('job.back'), title: t('job.back'),
    onClick: () => { haptic(); ctx.go('/shift'); },
  });

  // Карточка манёвра: слева расстояние крупно, дальше — куда едем. Она видна
  // всегда и читается вполглаза, как дорожный знак. Нажатие копирует адрес:
  // его диктуют по телефону и отправляют в мессенджер.
  const nextDist = el('b', { className: 'job__next-d' }, '—');
  const nextKicker = el('span', { className: 'job__next-w' });
  const nextAddr = el('span', { className: 'job__next-a' }, '—');
  const nextBtn = el('button', {
    className: 'job__next', type: 'button', title: t('job.copy_addr'),
  }, el('span', { className: 'job__next-k' }, nextDist, nextKicker), nextAddr);

  // Чужой навигатор остаётся, но маленькой кнопкой сбоку: своей карты хватает.
  const navBtn = el('button', {
    className: 'job__round job__round--sm', type: 'button', html: ICONS.nav,
    'aria-label': t('job.nav_go'), title: t('job.nav_go'),
    onClick: () => { if (!longNav.long()) openNavTo(preferredNav()); else longNav.reset(); },
  });

  const topBar = el('div', { className: 'job__top' }, backBtn, nextBtn, navBtn);

  const eyeBtn = el('button', {
    className: 'job__round job__round--eye', type: 'button', html: ICONS.fit,
    'aria-label': t('job.fit'), title: t('job.fit'),
    onClick: () => { haptic(); toggleFollow(); },
  });

  const etaValue = el('b', { className: 'job__eta-v' }, t('job.calc'));
  const etaNote = el('span', { className: 'job__eta-s' });
  const infoBtn = el('button', {
    className: 'job__info', type: 'button',
    'aria-label': t('job.details'), title: t('job.details'),
    onClick: () => showDetails(),
  }, el('span', { className: 'job__eta' }, etaValue, etaNote),
    el('span', { className: 'job__info-go', html: ICONS.chev }));

  const unreadBadge = el('span', { className: 'sg-unread', hidden: true });
  const chatBtn = el('button', {
    className: 'job__round job__round--act sg-chatbtn', type: 'button',
    'aria-label': t('chat.title'), title: t('chat.title'),
    onClick: () => showChat(),
  }, ico(ICONS.chat), unreadBadge);

  const callBtn = el('a', {
    className: 'job__round job__round--call', href: '#', hidden: true,
    'aria-label': t('courier.call_client'), title: t('courier.call_client'),
  }, ico(ICONS.phone));

  const rowTop = el('div', { className: 'job__row' }, infoBtn, callBtn, chatBtn);
  const stillBox = el('div', { className: 'sg-still', hidden: true });
  const waitBox = el('div', { className: 'wait' });
  const actBox = el('div', { className: 'act' });
  const panelBox = el('div', { className: 'job__panel' }, rowTop, stillBox, waitBox, actBox);

  const jobBox = el('div', { className: 'job job--full' }, mapNode, topBar, eyeBtn, panelBox);

  root.replaceChildren(jobBox);
  document.getElementById('app').classList.add('app--job');
  document.documentElement.dataset.job = 'full';
  stop.push(() => {
    document.getElementById('app').classList.remove('app--job');
    delete document.documentElement.dataset.job;
  });

  /* Кнопки и подпись карты обязаны стоять над панелью, а панель меняет высоту
     вместе с содержимым — счётчик ожидания появляется и пропадает. Поэтому
     высоту меряем, а не угадываем. */
  function syncPanel() {
    const h = Math.round(panelBox.getBoundingClientRect().height);
    if (!h) return;
    jobBox.style.setProperty('--job-panel', h + 'px');
  }
  let panelSizes = null;
  if (typeof ResizeObserver === 'function') {
    panelSizes = new ResizeObserver(syncPanel);
    panelSizes.observe(panelBox);
    stop.push(() => panelSizes.disconnect());
  }
  window.addEventListener('resize', syncPanel);
  stop.push(() => window.removeEventListener('resize', syncPanel));
  syncPanel();

  /* ── карта: точки заказа, план поездки и живая нитка до цели ──────────── */

  // Своих кнопок у карты здесь нет: у навигатора их быть не должно, а щипок
  // и перетаскивание работают и так.
  const map = makeMap(mapNode, state.config, { locate: false, controls: false });
  stop.push(() => map.destroy());

  // Оба маршрута заводим сразу и в этом порядке: план лежит под ниткой, а
  // нитка остаётся последней созданной — именно к ней относится подсветка
  // пройденного в ядре карты.
  const plan = map.route([], { dashed: true, width: 5 });
  const leg = map.route([], { width: 7 });
  stop.push(() => { plan.remove(); leg.remove(); });

  let carMarker = null;
  const pointMarkers = [];
  const visited = new Set();        // промежуточные адреса, которые уже проехали

  function points() {
    const order = ctx.store.get().order;
    return (order && order.points) || [];
  }

  function orderCoords() {
    const out = [];
    for (const p of points()) {
      if (p.lat == null || p.lng == null) continue;
      out.push([p.lat, p.lng]);
    }
    return out;
  }

  function drawOrder() {
    for (const m of pointMarkers.splice(0)) m.remove();
    const list = points();
    const coords = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.lat == null || p.lng == null) continue;
      coords.push([p.lat, p.lng]);
      pointMarkers.push(map.marker({
        at: [p.lat, p.lng],
        html: pin(i === 0 ? 'a' : 'b', i === 0 ? '' : String(i)),
        anchor: 'bottom', zIndex: 10 + i,
      }));
    }
    plan.setCoords(coords.length >= 2 ? coords : []);
  }

  function putCar(at, heading) {
    if (!at) return;
    if (!carMarker) {
      carMarker = map.marker({
        at, html: pin('car'), anchor: 'center', zIndex: 40, rotate: true,
        heading: typeof heading === 'number' ? heading : 0,
      });
    } else if (!following) {
      // В режиме следования метку ведёт сама карта — теми же кадрами, что и вид.
      carMarker.moveTo(at, { duration: 900, heading });
    }
  }

  /** Показать всё сразу: машину, точки заказа и остаток маршрута.
      Отступы меряем по живой разметке: карточка манёвра сверху и панель снизу
      бывают разной высоты, а маршрут не должен уходить под них. */
  function fitAll() {
    const all = orderCoords();
    const at = ctx.tracker.at() || ctx.store.get().at;
    if (at) all.push(at);
    const box = mapNode.getBoundingClientRect();
    const top = Math.max(16, Math.round(topBar.getBoundingClientRect().bottom - box.top) + 16);
    const bottom = Math.max(16, Math.round(box.bottom - eyeBtn.getBoundingClientRect().top) + 16);
    if (all.length > 1) {
      map.fitPoints(all, { padding: { top, right: 48, bottom, left: 48 } });
    } else if (all.length === 1) {
      map.setView(all[0], 15, { animate: true });
    }
  }

  /* ── режим ведения ────────────────────────────────────────────────────── */

  let following = false;
  let backTimer = 0;
  let firstTimer = 0;

  function followOpts(extra) {
    return Object.assign({
      rotate: true, zoom: NAV_ZOOM, anchor: NAV_ANCHOR,
      marker: carMarker, resume: NAV_BACK_MS,
    }, extra || {});
  }

  function paintEye() {
    eyeBtn.innerHTML = following ? ICONS.fit : ICONS.nav;
    const label = following ? t('job.fit') : t('job.follow');
    eyeBtn.setAttribute('aria-label', label);
    eyeBtn.title = label;
    eyeBtn.classList.toggle('is-on', following);
  }

  function startFollow() {
    const me = ctx.tracker.at() || ctx.store.get().at;
    if (!me || !alive) return;
    putCar(me, ctx.tracker.heading());
    following = true;
    if (backTimer) { clearTimeout(backTimer); backTimer = 0; }
    map.follow(fixPos(me[0], me[1], ctx.tracker.heading()), followOpts({ snap: true }));
    paintEye();
  }

  function stopFollow(comeBack) {
    following = false;
    map.unfollow();
    if (backTimer) clearTimeout(backTimer);
    backTimer = comeBack ? setTimeout(() => { backTimer = 0; startFollow(); }, NAV_BACK_MS) : 0;
    paintEye();
  }

  function toggleFollow() {
    if (following) {
      stopFollow(true);       // посмотрел весь маршрут — карта вернётся к машине сама
      fitAll();
    } else {
      startFollow();
    }
  }

  stop.push(() => {
    if (backTimer) clearTimeout(backTimer);
    if (firstTimer) clearTimeout(firstTimer);
  });

  /* ── остаток пути: нитка, расстояние и время ──────────────────────────── */

  const nav = { key: '', at: null, reqAt: 0, busy: false, info: null, left: 0 };

  /** Куда едем прямо сейчас: до погрузки это первая точка, дальше — непройденные. */
  function legIndex() {
    const order = ctx.store.get().order;
    const list = points();
    if (!order || !list.length) return -1;
    if (DRIVE_TO_PICKUP.indexOf(order.status) >= 0) return 0;
    for (let i = 1; i < list.length; i++) {
      if (!visited.has(i)) return i;
    }
    return list.length - 1;
  }

  function legPoint() {
    const i = legIndex();
    return i >= 0 ? (points()[i] || null) : null;
  }

  function legGeo() {
    const p = legPoint();
    return p && p.lat != null && p.lng != null ? p : null;
  }

  /* Запасной расчёт, когда маршрутизатор молчит: прямая с поправкой на то,
     что дорога длиннее, и средняя городская скорость. Лучше приблизительно,
     чем прочерк: курьеру надо сказать клиенту хоть что-то. */
  function straightLeg(me, to) {
    const d = Math.round(distanceM(me, [to.lat, to.lng]) * ROAD_FACTOR);
    return {
      distance_m: d,
      duration_s: Math.round(d / CITY_SPEED),
      line: [me.slice(), [to.lat, to.lng]],
      rough: true,
    };
  }

  async function refreshLeg(force) {
    const order = ctx.store.get().order;
    if (!alive || !order) return;
    const to = legGeo();
    const me = ctx.tracker.at() || ctx.store.get().at;
    if (!to || !me) {
      paintEta();
      return;
    }
    const key = to.lat + ',' + to.lng;
    const now = Date.now();
    const moved = nav.at ? distanceM(nav.at, me) : Infinity;
    const since = now - nav.reqAt;
    if (!force && key === nav.key) {
      if (since < LEG_MIN_MS) return;
      if (moved < LEG_MOVE_M && since < LEG_MAX_MS) return;
    }
    if (nav.busy) return;
    nav.busy = true;
    nav.key = key;
    nav.at = me.slice();
    nav.reqAt = now;
    try {
      const r = await api.post('/geo/route', { points: [[me[0], me[1]], [to.lat, to.lng]] });
      if (!alive) return;
      nav.info = {
        distance_m: r.distance_m || 0,
        duration_s: r.duration_traffic_s || r.duration_s || 0,
        line: Array.isArray(r.route) && r.route.length > 1 ? r.route : [me.slice(), [to.lat, to.lng]],
        rough: false,
      };
    } catch (e) {
      if (!alive) return;
      nav.info = straightLeg(me, to);
    } finally {
      nav.busy = false;
    }
    nav.left = nav.info.distance_m;
    leg.setCoords(nav.info.line);
    paintProgress(0);
    paintEta();
  }

  /* Пройденное гаснет. У нитки есть свой setProgress, но сборки карты бывают
     и с общим map.setRouteProgress — экран не должен падать из-за того, какое
     из двух имён ему досталось. */
  function paintProgress(part) {
    if (typeof leg.setProgress === 'function') leg.setProgress(part);
    else if (typeof map.setRouteProgress === 'function') map.setRouteProgress(part);
  }

  /* Между запросами к маршрутизатору остаток пути считаем сами — по той же
     нитке. Так цифра уменьшается на каждую посылку GPS, а не раз в минуту. */
  function traceLeg(me) {
    const line = nav.info && nav.info.line;
    if (!line || line.length < 2) return;
    const a = alongLine(line, me);
    nav.left = a.left;
    paintProgress(a.progress);
    paintEta();
    // Свернули не туда — строим заново молча. Просить об этом человека нельзя:
    // он за рулём и на кнопку «перестроить» смотреть не будет. Чаще, чем раз
    // в LEG_MIN_MS, не дёргаем: на развязке отклонение бывает и без ошибки.
    if (!nav.info.rough && a.off > OFF_ROUTE_M && Date.now() - nav.reqAt > LEG_MIN_MS) {
      refreshLeg(true);
    }
  }

  function paintEta() {
    const order = ctx.store.get().order;
    if (!order) return;
    const toPickup = DRIVE_TO_PICKUP.indexOf(order.status) >= 0;
    const info = nav.info;
    const step = FLOW[order.status];
    const left = info ? Math.max(0, Math.round(nav.left)) : 0;

    nextDist.textContent = info ? distance(left) : '—';
    etaValue.textContent = info ? duration(info.duration_s) : t('job.calc');
    // В строке под минутами — расстояние и время приезда: именно его называют
    // клиенту по телефону. Сам шаг заказа написан на главной кнопке, повторять
    // его здесь незачем.
    etaNote.textContent = info
      ? distance(left) + ' · ' + (info.rough
        ? t('job.route_straight')
        : t('job.arrive_at', { time: arriveClock(info.duration_s) }))
      : (step ? t(step.now) : (order.public_id || ''));

    infoBtn.setAttribute('aria-label',
      (toPickup ? t('job.to_pickup_left') : t('job.to_drop_left')) + ': ' +
      (info ? duration(info.duration_s) : t('job.calc')) + '. ' + t('job.details'));
  }

  /* ── адрес следующей точки ────────────────────────────────────────────── */

  /* Город в начале адреса не несёт ничего: курьер и так в нём. Убираем его —
     и в одну строку влезает то, что важно, улица с домом. */
  function shortAddr(addr) {
    const config = ctx.store.get().config;
    const city = (config && config.service && config.service.city) || '';
    if (!city) return addr;
    const head = (city + ', ').toLowerCase();
    return addr.toLowerCase().startsWith(head) ? addr.slice(head.length) : addr;
  }

  function paintNext() {
    const order = ctx.store.get().order;
    const toPickup = !order || DRIVE_TO_PICKUP.indexOf(order.status) >= 0;
    const point = legPoint();
    const addr = point && point.addr ? shortAddr(point.addr) : t('order.on_map');
    const kicker = toPickup ? t('courier.offer_pickup') : t('courier.offer_drop');
    if (nextKicker.textContent !== kicker) nextKicker.textContent = kicker;
    nextBtn.title = t('job.copy_addr');
    if (nextAddr.textContent !== addr) nextAddr.textContent = addr;
    nextBtn.setAttribute('aria-label', kicker + ': ' + addr + '. ' + t('job.copy_addr'));
  }

  nextBtn.addEventListener('click', () => {
    if (longAddr.long()) {              // навигатор уже открылся, копировать не надо
      longAddr.reset();
      return;
    }
    const point = legPoint();
    // Копируем адрес целиком, вместе с городом: его диктуют по телефону
    // и отправляют в мессенджер, а там сокращения только мешают.
    if (!point || !point.addr) return;
    copyText(point.addr, t('job.copied'));
  });

  /* ── чужой навигатор ──────────────────────────────────────────────────── */

  function openNavTo(code) {
    const to = legGeo();
    if (!to) return;
    rememberNav(code);
    haptic(16);
    const links = navLinks(code, to.lat, to.lng);
    openNav(links.app, links.web);
  }

  /* Долгое нажатие — выбрать другой навигатор. Выбор запоминается, поэтому
     спрашиваем один раз, а не перед каждой поездкой. */
  function pickNav() {
    haptic();
    const box = el('div', { className: 'col gap-2' });
    const panel = sheet({ title: t('job.nav_pick'), content: box });
    for (const [code, key] of [['ya', 'job.nav_ya'], ['2gis', 'job.nav_2gis']]) {
      box.appendChild(el('button', {
        className: 'btn btn--ghost btn--lg btn--block', type: 'button',
        onClick: () => { panel.close(); openNavTo(code); },
      }, ico(ICONS.nav), t(key)));
    }
  }

  const longNav = onLongPress(navBtn, 520, () => pickNav());
  const longAddr = onLongPress(nextBtn, 520, () => openNavTo(preferredNav()));
  stop.push(() => { longNav.destroy(); longAddr.destroy(); });

  /* ── чат с клиентом ───────────────────────────────────────────────────── */

  let chatUi = null;
  let pollTimer = 0;

  function paintUnread() {
    const c = chatOf(orderId);
    const n = chatUi && !chatUi.closed ? 0 : c.unread;
    unreadBadge.textContent = String(n);
    unreadBadge.hidden = n < 1;
    chatBtn.setAttribute('aria-label',
      n ? t('chat.title') + '. ' + t('chat.unread', { n }) : t('chat.title'));
  }

  function chatPeer() {
    const order = ctx.store.get().order || {};
    const list = order.points || [];
    const contact = list[0] || {};
    const client = order.client || {};
    const name = contact.name || client.name || t('rate.client_of');
    const sub = client.rating != null
      ? t('courier.rating') + ' ' + String(client.rating).replace('.', ',')
      : (order.public_id || '');
    return { name, sub, tel: telHref(contact.phone || client.phone) };
  }

  function showChat() {
    if (chatUi && !chatUi.closed) return;
    haptic();
    chatUi = openChat(orderId, chatPeer(), {
      onChange: () => paintUnread(),
      onClose: () => { chatUi = null; paintUnread(); schedulePoll(); },
    });
    paintUnread();
    schedulePoll();
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    if (!alive) return;
    const c = chatOf(orderId);
    const open = !!(chatUi && !chatUi.closed);
    const ms = c.live ? CHAT_POLL_LIVE_MS : (open ? CHAT_POLL_OPEN_MS : CHAT_POLL_IDLE_MS);
    pollTimer = setTimeout(pollChat, ms);
  }

  async function pollChat() {
    if (!alive) return;
    if (document.visibilityState !== 'hidden') {
      const c = chatOf(orderId);
      const open = !!(chatUi && !chatUi.closed);
      const wasLast = c.lastId;
      try {
        // Открытый чат перечитываем целиком: отметки «прочитано» приходят
        // правкой старых сообщений, а по хвосту после last_id их не видно.
        await chatLoad(orderId, open ? 0 : (c.loaded ? c.lastId : 0));
        if (!alive) return;
        const fresh = c.items.filter((m) => m.id > wasLast);
        if (open) {
          chatUi.sync();
          if (fresh.some((m) => !m.mine)) chatRead(orderId).then(paintUnread);
        } else if (fresh.some((m) => !m.mine)) {
          haptic([12, 60, 12]);
          toast(t('chat.new'), { type: 'info' });
        }
        paintUnread();
      } catch (e) { /* переписка подождёт до следующего круга */ }
    }
    schedulePoll();
  }

  stop.push(() => { if (pollTimer) clearTimeout(pollTimer); });
  stop.push(() => { if (chatUi) chatUi.close(true); });

  // Живые сообщения из потока курьера. Пока мост не подключён, работает опрос.
  stop.push(onStream((name, data) => {
    if (!alive || !data) return;
    if (name !== 'message' && name !== 'message_read') return;
    const order = ctx.store.get().order;
    if (!order) return;
    const mine = (data.order_id && Number(data.order_id) === order.id) ||
      (!data.order_id && data.public_id && data.public_id === order.public_id);
    if (!mine) return;
    const c = chatOf(order.id);
    // Поток работает — значит, опрос можно делать реже: он тут запасной.
    c.live = true;
    if (name === 'message') {
      const msg = chatPush(c, data.message);
      if (!msg) return;
      if (chatUi && !chatUi.closed) {
        chatUi.sync([msg]);
        if (!msg.mine) chatRead(order.id).then(paintUnread);
      } else if (!msg.mine) {
        c.unread += 1;
        haptic([12, 60, 12]);
        toast(t('chat.new'), { type: 'info' });
      }
      paintUnread();
      schedulePoll();
    } else if (name === 'message_read') {
      if (chatMarkRead(c, data.ids, data.at) && chatUi && !chatUi.closed) chatUi.sync();
    }
  }));

  /* ── счётчик ожидания ──────────────────────────────────────────────────
     Цифры тикают раз в секунду, поэтому узлы собраны один раз: пересборка
     карточки каждую секунду — это мигание прямо под рукой водителя. */
  let waitTimer = 0;
  const waitTime = el('div', { className: 'wait__t' }, clock(0));
  const waitNote = el('div', { className: 'wait__note' });
  const waitBtn = el('button', {
    className: 'btn btn--ghost', type: 'button',
    onClick: () => toggleWait((ctx.store.get().waiting || {}).running ? 'stop' : 'start'),
  }, t('courier.waiting_start'));
  waitBox.append(
    ico(ICONS.clock),
    el('div', { className: 'wait__body' }, waitTime, waitNote),
    waitBtn);

  function paintWait() {
    const order = ctx.store.get().order;
    const info = ctx.store.get().waiting || {};
    const canWait = !!(order && WAITING_AT.indexOf(order.status) >= 0);
    waitBox.hidden = !canWait;
    if (!canWait) {
      if (waitTimer) clearInterval(waitTimer);
      waitTimer = 0;
      return;
    }
    const base = info.waiting_s || 0;
    const since = info.running && info.since ? info.since : 0;
    const shown = since ? base + Math.max(0, Math.floor(Date.now() / 1000) - since) : base;

    waitBox.classList.toggle('is-on', !!info.running);
    waitTime.textContent = clock(shown);
    waitNote.textContent = info.price_waiting
      ? t('track.waiting') + ': ' + money(info.price_waiting)
      : t('courier.waiting_free', { time: clock(shown) });
    waitBtn.textContent = info.running ? t('courier.waiting_stop') : t('courier.waiting_start');
    waitBtn.className = 'btn ' + (info.running ? 'btn--danger' : 'btn--ghost');

    if (info.running && !waitTimer) waitTimer = setInterval(paintWait, 1000);
    if (!info.running && waitTimer) { clearInterval(waitTimer); waitTimer = 0; }
  }
  stop.push(() => { if (waitTimer) clearInterval(waitTimer); });

  async function toggleWait(action) {
    const order = ctx.store.get().order;
    if (!order) return;
    haptic();
    try {
      const res = await api.post('/courier/orders/' + order.id + '/waiting', { action });
      ctx.store.set({ waiting: res });
    } catch (e) {
      toast((e && e.message) || t('err.unknown'), { type: 'err' });
    }
  }

  /* ── «вы стоите на месте» ────────────────────────────────────────────────
     Груз уже выгружен, а статус так и остался «в пути» — самая частая ошибка
     за смену. Молча стоящая пять минут машина — повод мягко об этом спросить. */
  const STILL_MS = 5 * 60 * 1000;
  const STILL_MOVE_M = 80;
  const STILL_EVERY_MS = 30000;

  const stillTitle = el('span', { className: 'sg-still__t' });
  const stillHide = el('button', {
    className: 'sg-still__x', type: 'button',
    onClick: () => { still.muted = true; haptic(); showStill(false); },
  }, t('job.still_hide'));
  stillBox.append(
    ico(ICONS.alert),
    el('div', { className: 'sg-still__body' },
      stillTitle,
      el('span', { className: 'sg-still__note' }, t('job.still_text'))),
    stillHide);

  const still = { from: null, at: 0, on: false, muted: false };

  function showStill(on) {
    if (still.on === on) return;
    still.on = on;
    stillBox.hidden = !on;
  }

  function stillReset(at) {
    still.from = at ? at.slice() : null;
    still.at = Date.now();
    still.muted = false;
    showStill(false);
  }

  function checkStill(point) {
    const order = ctx.store.get().order;
    if (!order || order.status !== 'in_transit') {
      if (still.from || still.on) stillReset(null);
      return;
    }
    const at = point ? [point.lat, point.lng] : (ctx.tracker.at() || ctx.store.get().at);
    if (!at) return;
    if (!still.from) {
      still.from = at.slice();
      still.at = Date.now();
      return;
    }
    if (distanceM(still.from, at) > STILL_MOVE_M) {
      stillReset(at);                   // поехали дальше — напоминание больше не нужно
      return;
    }
    if (Date.now() - still.at < STILL_MS) return;
    const minutes = Math.floor((Date.now() - still.at) / 60000);
    stillTitle.textContent = t('job.still', { time: tp(minutes, 'common.n_min') });
    if (still.muted || still.on) return;
    showStill(true);
    haptic([14, 70, 14]);
  }

  const stillTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') checkStill(null);
  }, STILL_EVERY_MS);
  stop.push(() => clearInterval(stillTimer));

  /* ── приезд считаем по координатам ────────────────────────────────────── */

  const arrive = { index: -1, since: 0, sent: '', sentAt: 0 };

  /* Один и тот же шаг не отправляем повторно двадцать секунд: ответ сервера
     может задержаться, а второй такой же запрос ничего не добавит. Совсем
     запрещать повтор нельзя — тогда потерянный в сети шаг не доедет никогда. */
  function autoStep(target, note) {
    if (arrive.sent === target && Date.now() - arrive.sentAt < 20000) return;
    arrive.sent = target;
    arrive.sentAt = Date.now();
    move(target, null, { note, auto: true });
  }

  /** Доехали до точки. Что дальше — зависит от того, какая это точка. */
  function reachPoint(index) {
    const order = ctx.store.get().order;
    const list = points();
    if (!order || !list.length) return;
    const last = list.length - 1;
    if (index === 0) {
      if (DRIVE_TO_PICKUP.indexOf(order.status) >= 0) {
        autoStep('at_pickup', t('job.at_pickup_auto'));
      }
      return;
    }
    if (index === last) {
      if (order.status === 'in_transit') autoStep('at_dropoff', t('job.at_drop_auto'));
      return;
    }
    if (visited.has(index)) return;
    // Промежуточный адрес сервер отдельным статусом не считает — помечаем сами
    // и сразу ведём к следующему.
    visited.add(index);
    toast(t('job.point_done'), { type: 'ok' });
    haptic([14, 60, 14]);
    paintNext();
    refreshLeg(true);
  }

  function checkArrival(me, speed) {
    const index = legIndex();
    const to = legGeo();
    if (index < 0 || !to) { arrive.since = 0; return; }
    if (index !== arrive.index) {
      arrive.index = index;
      arrive.since = 0;
    }
    const near = distanceM(me, [to.lat, to.lng]) <= ARRIVE_M;
    const slow = speed == null || !isFinite(speed) || speed < ARRIVE_SPEED;
    if (!near || !slow) { arrive.since = 0; return; }
    if (!arrive.since) { arrive.since = Date.now(); return; }
    if (Date.now() - arrive.since < ARRIVE_HOLD_MS) return;
    arrive.since = 0;
    reachPoint(index);
  }

  /* ── карточка заказа и главная кнопка ─────────────────────────────────── */

  let lastStatus = '';
  let lastCard = '';

  /* Карточка приходит с сервера при каждом обновлении состояния, но меняется
     в ней от силы раз за поездку. Сравниваем содержимое и молча выходим, если
     оно то же: иначе разметка пересобиралась бы каждые несколько секунд. */
  function cardKey(order) {
    return JSON.stringify([
      order.status, order.public_id, order.points, order.comment, order.loaders,
      order.extras, order.distance_m, order.duration_s,
      order.price_total, order.commission, order.courier_payout,
      order.payment_status, order.paid_amount,
      order.client && order.client.rating, order.client && order.client.orders_count,
    ]);
  }

  function paintOrder() {
    const order = ctx.store.get().order;
    if (!order) {
      ctx.go('/shift');
      return;
    }
    const key = cardKey(order);
    if (key === lastCard) {
      paintEta();
      paintWait();
      paintUnread();
      return;
    }
    lastCard = key;

    const list = order.points || [];
    // Пока едем за грузом — на связи отправитель, после погрузки — получатель.
    const toPickup = TO_PICKUP.indexOf(order.status) >= 0;
    const contact = toPickup ? list[0] : list[list.length - 1];
    // У точки может не быть своего телефона — тогда звоним тому, кто заказал.
    const tel = telHref((contact && contact.phone) || (order.client && order.client.phone));
    callBtn.hidden = !tel;
    if (tel) callBtn.href = tel;

    paintUnread();
    paintNext();
    paintAct(order);
    paintWait();
    paintEta();
    drawOrder();

    // Сменился шаг заказа — цель переехала, маршрут строим заново.
    const changed = lastStatus && lastStatus !== order.status;
    const first = !lastStatus;
    lastStatus = order.status;
    if (changed) {
      refreshLeg(true);
      if (!following) fitAll();
    }
    // Часы стоянки отсчитываем от смены статуса, а не от входа на экран:
    // иначе напоминание прилетало бы через пять минут после каждого открытия.
    if (changed || first) stillReset(ctx.tracker.at() || ctx.store.get().at);
  }

  function paintAct(order) {
    const step = FLOW[order.status];
    if (!step) {
      actBox.replaceChildren(el('button', {
        className: 'btn btn--ghost btn--lg btn--block', type: 'button',
        onClick: () => ctx.go('/shift'),
      }, t('common.done')));
      return;
    }
    const label = t(step.label);
    if (step.swipe) {
      actBox.replaceChildren(
        el('span', { className: 'act__step' }, t('courier.finish_confirm')),
        swipeBar(label, () => move('done')));
      return;
    }
    actBox.replaceChildren(el('button', {
      className: 'btn btn--primary btn--lg btn--block',
      type: 'button',
      onClick: (e) => move(step.next, e.currentTarget),
    }, label));
  }

  /* Шаг заказа. opts.auto — шаг сделан не пальцем, а по координатам:
     тогда о нём говорим словами и не пугаем красной ошибкой, если сервер
     его не принял, — человек ничего не нажимал. */
  async function move(target, btn, opts = {}) {
    const order = ctx.store.get().order;
    if (!order) return;
    haptic(opts.auto ? [16, 70, 16] : 16);
    if (btn) spinner(btn, true);
    try {
      const res = await api.post('/courier/orders/' + order.id + '/status', { status: target });
      ctx.store.set({ order: res.order || null, waiting: res.waiting || null });
      if (opts.note) toast(opts.note, { type: 'ok', ms: 4000 });
      if (target === 'done') {
        if (typeof ctx.finished === 'function') ctx.finished(order.id);
        ctx.store.set({ order: null, busy: false });
        showFinish(res.price || {}, res.order || order);
        ctx.refresh();
        ctx.go('/shift');
      }
    } catch (e) {
      if (!opts.auto) toast((e && e.message) || t('err.unknown'), { type: 'err', ms: 4500 });
      ctx.refresh();
    } finally {
      if (btn) spinner(btn, false);
    }
  }

  /* ── полноэкранные детали ──────────────────────────────────────────────
     Всё, что не нужно за рулём, живёт здесь: груз, адреса целиком, телефоны,
     деньги. Одним движением и без мелкого текста. */

  function kv(label, value) {
    return el('div', { className: 'list__row' },
      el('span', { className: 'grow muted t-sm' }, label),
      el('b', { className: 'job__kv-v' }, value));
  }

  function showDetails() {
    const order = ctx.store.get().order;
    if (!order) return;
    haptic();
    const list = order.points || [];
    const config = ctx.store.get().config;
    const lang = getLang();
    const tariff = order.tariff || {};
    const extras = extrasText(order, config);
    const paid = order.payment_status === 'paid';
    const client = order.client || {};
    const contact = list[0] || {};
    const who = contact.name || client.name || t('rate.client_of');
    const known = contact.phone || client.phone || '';
    const tel = telHref(known);

    const clientCard = el('div', { className: 'job__who' },
      el('span', { className: 'avatar avatar--accent avatar--lg' }, initials(who) || '·'),
      el('div', { className: 'grow' },
        el('div', { className: 'job__who-name' }, who),
        known ? el('div', { className: 'muted t-sm' }, fmtPhone(known)) : null,
        clientRating(client)));

    const acts = el('div', { className: 'job__who-acts' });
    if (tel) {
      acts.appendChild(el('a', { className: 'btn btn--primary btn--lg grow', href: tel },
        ico(ICONS.phone), t('common.call')));
    }
    acts.appendChild(el('button', {
      className: 'btn btn--ghost btn--lg grow', type: 'button',
      onClick: () => { panel.close(); showChat(); },
    }, ico(ICONS.chat), t('chat.title')));

    const cargo = el('div', { className: 'list' },
      kv(t('order.tariff'), (lang === 'ky' ? tariff.name_ky : tariff.name_ru) || '—'),
      kv(t('order.loaders'), order.loaders
        ? tp(order.loaders, 'common.n_loader') : t('order.loaders_none')),
      extras ? kv(t('order.extras'), extras) : null,
      order.distance_m ? kv(t('order.distance'), distance(order.distance_m)) : null,
      order.duration_s ? kv(t('order.duration'), duration(order.duration_s)) : null);

    const addrs = el('div', { className: 'offer__rows' });
    for (let i = 0; i < list.length; i++) {
      addrs.appendChild(pointRow(list[i], i, list.length, true));
    }
    if (order.comment) {
      addrs.appendChild(el('div', { className: 'point__note' },
        t('courier.client_comment') + ': ' + order.comment));
    }

    const cash = el('div', { className: 'list' },
      kv(t('track.price'), money(order.price_total || 0)),
      kv(t('courier.commission'), money(order.commission || 0)),
      kv(paid ? t('track.paid') : t('order.pay_cash'),
        money(paid ? (order.paid_amount || order.price_total || 0) : (order.price_total || 0))));

    const payout = el('div', { className: 'job__payout' },
      el('div', { className: 'job__payout-k' }, t('courier.payout')),
      el('div', { className: 'job__payout-v' }, money(order.courier_payout || 0)));

    const body = el('div', { className: 'job__details' },
      clientCard, acts,
      el('div', { className: 'job__sect' }, t('job.cargo')), cargo,
      el('div', { className: 'job__sect' }, t('job.addresses')), addrs,
      el('div', { className: 'job__sect' }, t('job.money')), payout, cash);

    const panel = sheet({
      full: true,
      title: (order.public_id || t('courier.order')),
      content: body,
    });
  }

  /* ── свежие координаты ────────────────────────────────────────────────── */

  function onPoint(point) {
    const me = [point.lat, point.lng];
    putCar(me, point.heading);
    if (following) {
      map.follow(fixPos(point.lat, point.lng, point.heading, point.speed), followOpts());
    } else if (!backTimer && !firstTimer) {
      // Ведение не включилось на старте — значит, датчик тогда ещё молчал.
      // Первая же координата ставит машину на место, нажимать ничего не надо.
      startFollow();
    }
    traceLeg(me);
    checkArrival(me, point.speed);
    checkStill(point);
    refreshLeg(false);
  }

  const onShow = () => {
    if (document.visibilityState !== 'visible') return;
    pollChat();
    refreshLeg(true);
    checkStill(null);
  };
  document.addEventListener('visibilitychange', onShow);
  stop.push(() => document.removeEventListener('visibilitychange', onShow));

  /* ── запуск ───────────────────────────────────────────────────────────── */

  paintEye();
  paintOrder();
  putCar(ctx.tracker.at() || state.at, ctx.tracker.heading());
  fitAll();
  refreshLeg(true);

  // Заказ принят — значит, курьер уже едет. Отдельной кнопки «выехал» ему
  // не нужно: шаг честный и делается сам.
  if (state.order.status === 'assigned') move('to_pickup', null, { auto: true });

  // Сначала показываем маршрут целиком — человеку надо понять, куда его зовут.
  // Через пару секунд карта сама переходит в ведение и прижимается к машине.
  firstTimer = setTimeout(() => { firstTimer = 0; startFollow(); }, FIRST_FOLLOW_MS);

  stop.push(ctx.store.select((s) => s.order, () => paintOrder()));
  stop.push(ctx.store.select((s) => s.waiting, () => paintWait()));
  stop.push(ctx.onFix(onPoint));

  // Ожидание после перезапуска приложения знает только сервер — спрашиваем его.
  api.get('/courier/orders/' + orderId)
    .then((res) => {
      if (alive) ctx.store.set({ order: res.order || null, waiting: res.waiting || null });
    })
    .catch(() => { /* экран уже нарисован тем, что было в памяти */ });

  // Переписка нужна сразу: значок непрочитанных должен быть честным с первой секунды.
  chatLoad(orderId, 0).then(() => { if (alive) paintUnread(); }).catch(() => {});
  schedulePoll();

  return () => { for (const fn of stop) fn(); };
}

/* ─────────────────────────────────────────────────────── итог заказа и оценка */

/**
 * Итог заказа: сколько взять с клиента, сколько осталось курьеру, и тут же
 * оценка клиента. Отдельной шторкой её показывать нельзя — две подряд человек
 * закрывает не глядя, а нам важно, чтобы оценки были настоящими.
 */
function showFinish(price, order) {
  ensureCss();
  const collect = price.to_collect != null
    ? price.to_collect
    : Math.max(0, (price.total || 0) - (price.paid || 0));

  const body = el('div', { className: 'col gap-3' },
    el('div', { className: 'offer__pay' },
      el('div', { className: 'offer__pay-k' }, t('courier.payout')),
      el('div', { className: 'offer__pay-v' }, money(price.payout || 0))),
    collect > 0
      ? el('p', { className: 'sheet__text' }, t('courier.cash_note', { price: money(collect) }))
      : el('p', { className: 'sheet__text' }, t('track.paid')),
    el('div', { className: 'list' },
      el('div', { className: 'list__row' },
        el('span', { className: 'grow muted t-sm' }, t('order.price_total')),
        el('b', null, money(price.total || 0))),
      el('div', { className: 'list__row' },
        el('span', { className: 'grow muted t-sm' }, t('courier.commission')),
        el('b', null, money(price.commission || 0))),
      price.waiting_s
        ? el('div', { className: 'list__row' },
          el('span', { className: 'grow muted t-sm' }, t('track.waiting')),
          el('b', null, clock(price.waiting_s)))
        : null));

  const canRate = !!(order && order.id && !order.courier_rating);
  let stars = null;
  let comment = null;

  if (canRate) {
    const starsBox = el('div');
    comment = el('input', {
      className: 'field__input', type: 'text', placeholder: ' ', maxLength: 300,
    });
    const field = el('label', { className: 'field', style: { width: '100%' } },
      comment, el('span', { className: 'field__label' }, t('rate.comment_ph')));
    body.appendChild(el('div', { className: 'sg-rate' },
      el('div', { className: 'sg-rate__title' }, t('rate.client')),
      starsBox,
      el('div', { className: 'sg-rate__hint' }, t('rate.hint')),
      field));
    stars = mountStars(starsBox, { value: 0, size: 'lg', onChange: () => {} });
  }

  const actions = canRate
    ? [
      { label: t('rate.skip'), kind: 'ghost' },
      {
        label: t('rate.send'), kind: 'primary',
        onClick: async () => {
          const value = Math.round(stars.value());
          if (value < 1) {
            toast(t('rate.need'), { type: 'warn' });
            return false;
          }
          try {
            await api.post('/courier/orders/' + order.id + '/rate-client', {
              rating: value,
              comment: String(comment.value || '').trim(),
            });
            toast(t('rate.thanks'), { type: 'ok' });
            return true;
          } catch (e) {
            toast((e && e.message) || t('err.save_failed'), { type: 'err' });
            return false;
          }
        },
      },
    ]
    : [{ label: t('common.ok'), kind: 'primary' }];

  sheet({ title: t('track.done'), content: body, actions });
  haptic([20, 60, 20, 60, 30]);
}

/* ─────────────────────────────────────────────────────── история и деньги */

const PERIODS = [
  ['today', 'common.today'],
  ['week', 'common.week'],
  ['month', 'common.month'],
];

const ROWS_STEP = 40;           // столько заказов показываем за раз
const MAX_PAGES = 3;            // триста заказов за месяц — потолок с запасом

const DAY_SHORT = {
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  ky: ['Жк', 'Дш', 'Ше', 'Шр', 'Бш', 'Жм', 'Иш'],
};

/* Дни считаем по часам телефона: курьер и его телефон стоят в одном городе,
   и полночь у них общая. Полдень внутри дня берём нарочно — так подпись под
   столбиком не съезжает на сутки из-за часового пояса сервиса.

   Неделю и месяц показываем целиком, вместе с днями, которые ещё не наступили:
   в понедельник иначе получился бы один столбик во весь экран, а так сразу
   видно, что неделя только началась. */
function chartRange(period) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const start = new Date(day.getTime());
  let days = 7;
  if (period === 'week') {
    start.setDate(start.getDate() - ((day.getDay() + 6) % 7));
  } else if (period === 'month') {
    start.setDate(1);
    days = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
  } else {
    start.setDate(start.getDate() - 6);        // «сегодня» — на фоне недели
  }
  return { from: Math.floor(start.getTime() / 1000), days };
}

function daySeries(items, fromSec, days) {
  const start = new Date(fromSec * 1000);
  start.setHours(0, 0, 0, 0);
  const out = [];
  const byDay = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime());
    d.setDate(d.getDate() + i);
    const row = { at: Math.floor(d.getTime() / 1000) + 43200, sum: 0, orders: 0 };
    out.push(row);
    byDay.set(dayStamp(d.getTime()), row);
  }
  for (const o of items || []) {
    if (!o || o.status !== 'done' || !o.done_at) continue;
    const row = byDay.get(dayStamp(o.done_at * 1000));
    if (!row) continue;
    row.sum += Math.max(0, Number(o.courier_payout) || 0);
    row.orders += 1;
  }
  return out;
}

/**
 * Столбики заработка по дням. Рисуем руками: ради тридцати прямоугольников
 * тянуть библиотеку незачем, а так график весит ноль байт и слушается токенов.
 * Возвращает {el, set(series)}.
 */
function createBars() {
  const grid = el('div', { className: 'sg-bars__grid', role: 'img' });
  const caps = el('div', { className: 'sg-bars__caps', 'aria-hidden': 'true' });
  const kicker = el('span', null, t('earn.by_days'));
  const caption = el('b', { className: 'sg-bars__pick' });
  const box = el('div', { className: 'sg-bars' },
    el('div', { className: 'sg-bars__head' }, kicker, caption),
    grid, caps);

  let series = [];
  let bestAt = -1;
  let picked = -1;

  function select(index) {
    if (index < 0 || index >= series.length || index === picked) return;
    picked = index;
    for (let i = 0; i < grid.children.length; i++) {
      grid.children[i].classList.toggle('is-on', i === picked);
      if (caps.children[i]) caps.children[i].classList.toggle('is-on', i === picked);
    }
    const day = series[index];
    kicker.textContent = index === bestAt ? t('earn.best') : t('earn.picked');
    caption.textContent = date(day.at) + ' · ' + money(day.sum) +
      (day.orders ? ' · ' + tp(day.orders, 'common.n_order') : '');
  }

  /* Столбик пальцем не поймать — их бывает тридцать. Поэтому нажатие ловит
     вся полоса и показывает тот день, над которым оказался палец. */
  grid.addEventListener('pointerdown', (e) => {
    if (!series.length) return;
    const rect = grid.getBoundingClientRect();
    const part = (e.clientX - rect.left) / Math.max(1, rect.width);
    const index = Math.floor(part * series.length);
    if (index === picked) return;
    select(Math.max(0, Math.min(series.length - 1, index)));
    haptic();
  });

  return {
    el: box,
    set(next) {
      series = Array.isArray(next) ? next : [];
      let max = 0;
      let total = 0;
      bestAt = -1;
      for (let i = 0; i < series.length; i++) {
        total += series[i].sum;
        if (series[i].sum > max) {
          max = series[i].sum;
          bestAt = i;
        }
      }
      // Тридцать подписей в ряд не читаются: в месяце оставляем каждую пятую,
      // в неделе пишем дни словами.
      const dense = series.length > 10;
      const lang = getLang() === 'ky' ? 'ky' : 'ru';
      const bars = [];
      const marks = [];
      for (const day of series) {
        const d = new Date(day.at * 1000);
        const height = max > 0 ? Math.max(3, Math.round((day.sum / max) * 100)) : 3;
        bars.push(el('div', { className: 'sg-bars__col' },
          el('div', { className: 'sg-bars__bar', style: { height: height + '%' } })));
        marks.push(el('div', { className: 'sg-bars__cap' },
          dense ? (d.getDate() % 5 === 0 ? String(d.getDate()) : '') : DAY_SHORT[lang][d.getDay()]));
      }
      grid.replaceChildren(...bars);
      caps.replaceChildren(...marks);
      grid.setAttribute('aria-label', t('earn.chart_alt', { sum: money(total) }));
      picked = -1;
      if (max > 0) {
        select(bestAt);
      } else {
        kicker.textContent = t('earn.by_days');
        caption.textContent = t('earn.best_none');
      }
    },
  };
}

/* История страницами: за месяц заказов бывает больше сотни, а график обязан
   считать их все. Больше трёх страниц не берём — это уже триста поездок. */
async function loadOrders(params) {
  const first = await api.get('/courier/orders', Object.assign({ per_page: 100, page: 1 }, params));
  const items = Array.isArray(first.items) ? first.items.slice() : [];
  const total = Math.max(items.length, Number(first.total) || 0);
  for (let page = 2; page <= MAX_PAGES && items.length < total; page++) {
    const more = await api.get('/courier/orders', Object.assign({ per_page: 100, page }, params));
    const part = Array.isArray(more.items) ? more.items : [];
    if (!part.length) break;
    items.push(...part);
  }
  return { items, summary: first.summary || {} };
}

/**
 * Деньги: сколько вышло на руки за день, неделю и месяц, столбики по дням,
 * средний чек, лучший день и список заказов с суммами.
 */
export function renderHistory(root, ctx) {
  ensureCss();
  let period = ctx.store.get().period || 'today';
  let alive = true;
  let seq = 0;              // номер запроса: быстрые переключения не должны спорить
  let rows = [];
  let shown = ROWS_STEP;

  const seg = el('div', { className: 'segmented seg-wrap' });

  const sumValue = el('div', { className: 'sg-sum__v' }, money(0));
  const cellOrders = el('b', null, '0');
  const cellAvg = el('b', null, moneyShort(0));
  const cellFee = el('b', null, moneyShort(0));
  const cellCash = el('b', null, moneyShort(0));
  const sumBox = el('div', { className: 'sg-sum' },
    el('div', { className: 'sg-sum__k' }, t('earn.net')),
    sumValue,
    el('div', { className: 'sg-sum__grid' },
      el('div', { className: 'sg-cell' }, cellOrders, el('span', null, t('shift.orders'))),
      el('div', { className: 'sg-cell' }, cellAvg, el('span', null, t('earn.avg'))),
      el('div', { className: 'sg-cell' }, cellFee, el('span', null, t('courier.commission'))),
      el('div', { className: 'sg-cell' }, cellCash, el('span', null, t('earn.cash')))));

  const bars = createBars();
  const list = el('div', { className: 'list' });
  const moreBtn = el('button', {
    className: 'btn btn--ghost sg-more', type: 'button', hidden: true,
    onClick: () => {
      shown += ROWS_STEP;
      haptic();
      paintList();
    },
  }, t('earn.more'));

  root.replaceChildren(el('div', { className: 'hist' },
    seg, sumBox, bars.el, list, moreBtn));

  function paintSeg() {
    seg.replaceChildren(...PERIODS.map(([code, key]) => el('button', {
      className: 'segmented__i' + (code === period ? ' is-on' : ''),
      type: 'button',
      onClick: () => {
        if (code === period) return;
        period = code;
        ctx.store.set({ period: code });
        haptic();
        paintSeg();
        load();
      },
    }, t(key))));
  }

  function paintSummary(s) {
    sumValue.textContent = money(s.earned || 0);
    cellOrders.textContent = num(s.orders || 0);
    cellAvg.textContent = moneyShort(s.avg_order || 0);
    cellFee.textContent = moneyShort(s.commission || 0);
    cellCash.textContent = moneyShort(s.cash || 0);
  }

  function row(o) {
    const when = o.done_at || o.cancelled_at || o.created_at;
    const cancelled = o.status === 'cancelled';
    return el('div', { className: 'list__row hist__row' },
      el('div', { className: 'hist__when' }, time(when)),
      el('div', { className: 'hist__where' },
        el('div', { className: 'hist__addr truncate' }, o.from || '—'),
        el('div', { className: 'hist__addr truncate' }, o.to || '—'),
        el('div', { className: 'muted t-xs truncate' },
          [date(when), o.tariff, o.distance_m ? distance(o.distance_m) : null]
            .filter(Boolean).join(' · '))),
      el('div', { className: 'hist__pay' },
        cancelled ? '—' : money(o.courier_payout || 0),
        el('small', null, cancelled ? t('track.cancelled') : o.public_id)));
  }

  function paintList() {
    if (!rows.length) {
      moreBtn.hidden = true;
      list.replaceChildren(el('div', { className: 'empty' },
        el('div', { className: 'empty__icon', html: ICONS.hist }),
        el('div', { className: 'empty__title' }, t('courier.history_empty')),
        el('div', { className: 'empty__text' }, t('earn.empty'))));
      return;
    }
    list.replaceChildren(...rows.slice(0, shown).map(row));
    moreBtn.hidden = rows.length <= shown;
  }

  async function load() {
    const my = ++seq;
    list.replaceChildren(el('div', { className: 'list__row' },
      el('div', { className: 'skeleton grow' })));
    moreBtn.hidden = true;
    try {
      const main = await loadOrders({ period });
      if (!alive || my !== seq) return;
      paintSummary(main.summary);
      rows = main.items;
      shown = ROWS_STEP;
      paintList();

      // За «сегодня» один столбик ни о чём не говорит, поэтому график там
      // показывает прошедшую неделю — сразу видно, какой сегодня день.
      const range = chartRange(period);
      const forChart = period === 'today'
        ? (await loadOrders({ from: range.from })).items
        : main.items;
      if (!alive || my !== seq) return;
      bars.set(daySeries(forChart, range.from, range.days));
    } catch (e) {
      if (!alive || my !== seq) return;
      list.replaceChildren(el('div', { className: 'empty' },
        el('div', { className: 'empty__title' }, t('err.load_failed')),
        el('button', {
          className: 'btn btn--ghost', type: 'button', onClick: load,
        }, t('common.retry'))));
    }
  }

  paintSeg();
  paintSummary({});
  load();

  return () => { alive = false; };
}

/* ─────────────────────────────────────────────────────── настройки звука */

/**
 * Готовый блок: переключатель, громкость, проверка и честная подпись о том,
 * разрешил ли браузер звук. Проверка нужна не для красоты — без касания экрана
 * звука не будет, и водитель должен убедиться в этом до того, как проспит
 * первый заказ. Блок отдаётся наружу: его вставляют и в профиль.
 */
export function soundSettings() {
  const box = el('div', { className: 'col gap-3' });
  const note = el('div');
  const volSeg = el('div', { className: 'segmented seg-wrap' });
  const toggleWrap = el('label', { className: 'switch' });
  const input = el('input', { type: 'checkbox', checked: readSound().on,
    'aria-label': t('snd.title') });
  toggleWrap.append(input, el('span', { className: 'switch__track' }));

  const testBtn = el('button', {
    className: 'btn btn--ghost btn--block', type: 'button',
    onClick: async () => {
      haptic();
      const ok = await unlockAudio();
      if (ok) chime(true);
      buzz();
      paintNote();
      if (!ok) toast(t('snd.blocked'), { type: 'warn', ms: 5000 });
    },
  }, ico(ICONS.vol), t('snd.test'));

  function paintNote() {
    const status = soundStatus();
    const text = {
      none: t('snd.none'),
      off: t('snd.off_note'),
      idle: t('snd.idle'),
      blocked: t('snd.blocked'),
      ok: t('snd.ok'),
    }[status];
    note.className = status === 'blocked' || status === 'none' ? 'sg-snd__warn' : 'sg-snd__note';
    note.textContent = text || '';
  }

  function paintVol() {
    const now = readSound();
    volSeg.hidden = !now.on;
    volSeg.replaceChildren(...[
      ['low', 'snd.low'],
      ['mid', 'snd.mid'],
      ['high', 'snd.high'],
    ].map(([code, key]) => el('button', {
      className: 'segmented__i' + (code === now.level ? ' is-on' : ''),
      type: 'button',
      onClick: async () => {
        setSoundPrefs({ level: code });
        paintVol();
        haptic();
        // Слышно сразу: иначе выбирать громкость приходится наугад.
        if (await unlockAudio()) chime(true);
        paintNote();
      },
    }, t(key))));
  }

  input.addEventListener('change', async () => {
    setSoundPrefs({ on: input.checked });
    paintVol();
    haptic();
    if (input.checked && await unlockAudio()) chime(true);
    paintNote();
  });

  box.append(
    el('div', { className: 'sg-snd' },
      ico(ICONS.vol),
      el('div', { className: 'sg-snd__body' },
        el('div', { className: 'sg-snd__k' }, t('snd.title')),
        el('div', { className: 'sg-snd__note' }, t('snd.hint'))),
      toggleWrap),
    el('div', { className: 'muted t-sm' }, t('snd.volume')),
    volSeg,
    testBtn,
    note);

  paintVol();
  paintNote();
  return box;
}

/** Вставить блок настроек звука в чужой экран (профиль): одна строка вызова. */
export function mountSoundSettings(node) {
  if (!node) return null;
  ensureCss();
  const box = soundSettings();
  node.appendChild(box);
  return box;
}

export default {
  renderShift, renderJob, renderHistory,
  showOffer, createGeoTracker, startAlert, stopAlert, unlockAudio,
  chime, getSoundPrefs, setSoundPrefs, soundStatus, soundSettings, mountSoundSettings,
  handleStreamEvent, getTheme, applyTheme, bindPlate, ICONS,
  markShift, takeServerShift, shiftSeconds, getGoal, setGoal,
};
