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

/* ─────────────────────────────────────────────────────── свои строки

   Общий словарь правят соседние модули, поэтому свои тексты экран везёт с
   собой. Кыргызский — как говорят в Бишкеке: «заказ», «унаа», «жүкчү»,
   «баасы», а не книжные кальки. */

extend({
  ru: {
    'job.to_pickup_left': 'До погрузки',
    'job.to_drop_left': 'До выгрузки',
    'job.route_straight': 'по прямой',
    'job.nav_ya': 'Яндекс Навигатор',
    'job.nav_2gis': '2ГИС',
    'job.nav_short_ya': 'Яндекс',
    'job.open_nav': 'Открыть маршрут в навигаторе',
    'job.panel_more': 'Развернуть панель',
    'job.panel_less': 'Свернуть панель, чтобы видеть карту',
    'job.fit': 'Показать весь маршрут',
    'job.back': 'К смене',

    'zone.hint': 'здесь сейчас больше заказов',
    'zone.title': 'Повышенный спрос',

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
    'earn.best_none': 'Заказов пока не было',
    'earn.chart_alt': 'Заработок по дням, всего {sum}',
    'earn.more': 'Показать ещё',
    'earn.orders_title': 'Заказы',
    'earn.empty': 'За этот период заказов не было',

    'job.next_title': 'Следующий адрес',
    'job.copy_addr': 'Нажмите — адрес скопируется. Удержите — откроется навигатор',
    'job.copied': 'Адрес скопирован',
    'job.still': 'Стоите {time}',
    'job.still_text': 'Уже на месте? Поменяйте статус заказа',
    'job.still_hide': 'Понятно',
  },
  ky: {
    'job.to_pickup_left': 'Жүк алганга чейин',
    'job.to_drop_left': 'Жүк түшүргөнгө чейин',
    'job.route_straight': 'түз сызык менен',
    'job.nav_ya': 'Яндекс Навигатор',
    'job.nav_2gis': '2ГИС',
    'job.nav_short_ya': 'Яндекс',
    'job.open_nav': 'Багытты навигатордон ачуу',
    'job.panel_more': 'Панелди жайуу',
    'job.panel_less': 'Картаны көрүш үчүн панелди жыйноо',
    'job.fit': 'Бүт багытты көрсөтүү',
    'job.back': 'Сменага',

    'zone.hint': 'бул жерде азыр заказ көп',
    'zone.title': 'Заказ көп жерлер',

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
    'earn.best_none': 'Заказ азырынча болгон жок',
    'earn.chart_alt': 'Күндөр боюнча киреше, бардыгы {sum}',
    'earn.more': 'Дагы көрсөтүү',
    'earn.orders_title': 'Заказдар',
    'earn.empty': 'Бул мезгилде заказ болгон жок',

    'job.next_title': 'Кийинки дарек',
    'job.copy_addr': 'Бассаңыз дарек көчүрүлөт. Кармап турсаңыз навигатор ачылат',
    'job.copied': 'Дарек көчүрүлдү',
    'job.still': '{time} турасыз',
    'job.still_text': 'Жетип калдыңызбы? Заказдын абалын которуңуз',
    'job.still_hide': 'Түшүндүм',
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
  fit: S('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3.2M12 18v3.2M2.8 12H6M18 12h3.2"/>'),
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

/* ── зоны повышенного спроса ───────────────────────────────────────────── */

.sg-zones {
  position: absolute;
  inset: 0;
  z-index: var(--z-map);
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-3) var(--ease);
}
.sg-zones.is-on { opacity: 1; }

.sg-zhint {
  position: absolute;
  left: var(--sp-3);
  top: var(--sp-3);
  z-index: var(--z-ui);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  max-width: calc(100% - 88px);
  padding: 6px var(--sp-3) 6px var(--sp-2);
  border-radius: var(--r-full);
  background: var(--surface);
  box-shadow: var(--shadow-2);
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.3;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity var(--dur-3) var(--ease), transform var(--dur-3) var(--ease);
}
.sg-zhint.is-on { opacity: 1; transform: none; }

.sg-zhint__dot {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(255, 72, 138, .9);
  box-shadow: 0 0 0 4px rgba(255, 72, 138, .22);
}

/* ── заказ во весь экран ───────────────────────────────────────────────── */

/* Список внутри панели меняет высоту пальцем, поэтому растягиваться сам
   по содержимому он не должен: высоту ему ставит скрипт. */
.job--full .job__scroll {
  flex: 0 1 auto;
  transition: height var(--dur-2) var(--ease);
}
.job--full.is-drag .job__scroll { transition: none; }
.job--full .job__scroll.is-shut { padding-block: 0; }

/* Грип в courier.css тонкий, 26 px, — пальцем за рулём в него не попасть.
   На этом экране он единственная ручка панели, поэтому даём полные 44 px. */
.job--full .job__grip {
  height: 44px;
  touch-action: none;
}

.sg-head {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: 0 var(--sp-4) var(--sp-3);
  touch-action: none;
}

.sg-eta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.sg-eta > svg { flex: none; width: 16px; height: 16px; }
.sg-eta b { color: var(--text); font-variant-numeric: tabular-nums; }

.sg-navs { display: flex; gap: var(--sp-2); }
.sg-navs .btn { flex: 1 1 0; min-width: 0; }

/* Телефон и чат — в шапке панели, а не в списке: список сворачивается пальцем,
   а позвонить клиенту нужно из любого положения панели, в одно касание. */
.sg-quick { display: flex; gap: var(--sp-2); }
.sg-quick .btn { flex: 1 1 auto; min-width: 0; }
.sg-quick .sg-chatbtn { flex: none; width: 56px; }

/* За рулём палец не целится, поэтому на экране заказа нет ничего мельче 56 px.
   Правила общих кнопок приходится перебивать: там размеры рассчитаны на руки,
   которые держат телефон, а не руль. */
.job--full .act .btn,
.job--full .sg-navs .btn,
.job--full .sg-quick .btn,
.job--full .point__acts .btn,
.job--full .wait .btn {
  min-height: 56px;
}
.job--full .point__acts .btn { padding-inline: var(--sp-4); }
.job--full .job__client .btn--icon,
.job--full .sg-quick .sg-chatbtn {
  width: 56px;
  min-width: 56px;
  height: 56px;
}

/* ── верхняя строка: куда едем прямо сейчас ────────────────────────────── */

/* Адрес следующей точки виден всегда, в одну строку и крупно: свёрнута панель
   или развёрнута, водителю достаточно одного взгляда. */
.sg-topbar {
  position: absolute;
  left: var(--sp-3);
  right: var(--sp-3);
  top: calc(var(--safe-t) + var(--sp-3));
  z-index: 2;
  display: flex;
  align-items: stretch;
  gap: var(--sp-2);
  pointer-events: none;
}
.sg-topbar > * { pointer-events: auto; }

.sg-rbtn {
  flex: none;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: var(--r-full);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-2);
}
.sg-rbtn:active { transform: scale(.94); }
.sg-rbtn > svg { width: 24px; height: 24px; }

.sg-next {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 56px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--shadow-2);
  text-align: left;
  /* Долгое нажатие открывает навигатор, поэтому системное выделение текста
     и всплывающее меню здесь только мешают. */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.sg-next:active { background: var(--surface-2); }
.sg-next__body { flex: 1 1 auto; min-width: 0; }

.sg-next__k {
  display: block;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.sg-next__addr {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.25;
}

.sg-next__copy { flex: none; width: 20px; height: 20px; color: var(--muted-2); }

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
.sg-still__x:active { background: rgba(255, 167, 38, .16); }

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

/* ── кнопка чата и счётчик непрочитанных ───────────────────────────────── */

.sg-chatbtn { position: relative; overflow: visible; }

.sg-unread {
  position: absolute;
  top: -5px;
  right: -5px;
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--r-full);
  background: var(--err);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
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
.sg-chat__call:active { transform: scale(.92); }
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
  background: var(--surface);
  border: 1px solid var(--line-soft);
}

.sg-snd__body { flex: 1 1 auto; min-width: 0; }
.sg-snd__k { font-weight: 600; }
.sg-snd__note { color: var(--muted); font-size: var(--fs-xs); line-height: 1.4; }
.sg-snd__warn { color: var(--warn); font-size: var(--fs-xs); line-height: 1.4; }

/* ── деньги на экране смены ────────────────────────────────────────────── */

/* Первое, что видит человек, открыв приложение: сколько он сегодня заработал.
   Всё остальное — мельче и ниже. */
.sg-earn {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-5);
  border-radius: var(--r-xl);
  background: var(--surface);
  border: 1px solid var(--line-soft);
}

.sg-earn__k { color: var(--muted); font-size: var(--fs-sm); }

.sg-earn__v {
  font-family: var(--font-display);
  font-size: var(--fs-display);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: -.03em;
  line-height: 1.05;
  color: var(--accent);
}

.sg-earn__facts {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line-soft);
}

.sg-fact { min-width: 0; }

.sg-fact b {
  display: block;
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  /* «5 ч 20 мин» и «12 400 сом» не должны переноситься посередине. */
  white-space: nowrap;
}

.sg-fact span { color: var(--muted); font-size: var(--fs-xs); }

/* ── цель на день ──────────────────────────────────────────────────────── */

.sg-goal {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  min-height: 56px;
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  text-align: left;
  transition: border-color var(--dur-2) var(--ease), background-color var(--dur-2) var(--ease);
}
.sg-goal:active { transform: scale(.995); }
.sg-goal.is-done { background: var(--ok-soft); border-color: rgba(36, 192, 122, .4); }

.sg-goal--empty {
  align-items: center;
  justify-content: center;
  border-style: dashed;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: var(--fs-body);
  font-weight: 600;
}
.sg-goal--empty > svg { width: 20px; height: 20px; }

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

/* Плитки «за неделю» и «за месяц» ведут в раздел денег, поэтому это кнопки. */
.sg-tile { width: 100%; min-height: 56px; text-align: left; }
.sg-tile:active { transform: scale(.99); }

/* Пресеты в шторке цели. */
.sg-chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.sg-chips .chip { min-height: 44px; }

/* ── деньги: столбики по дням ──────────────────────────────────────────── */

.sg-sum {
  padding: var(--sp-5);
  border-radius: var(--r-xl);
  background: var(--surface);
  border: 1px solid var(--line-soft);
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
}

.sg-bars__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-sm);
}

.sg-bars__pick {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text);
  font-weight: 600;
  text-align: right;
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

.sg-bars__bar {
  width: 100%;
  min-height: 3px;
  border-radius: var(--r-xs) var(--r-xs) 2px 2px;
  background: var(--accent-soft);
  transition: height var(--dur-3) var(--ease), background-color var(--dur-2) var(--ease);
}
.sg-bars__col.is-on .sg-bars__bar { background: var(--accent); }

.sg-bars__caps { display: flex; gap: 3px; }

.sg-bars__cap {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
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

/** Тема приложения: 'dark' | 'light' | 'auto'. Водитель ездит и днём, и ночью. */
export function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light' || v === 'auto') return v;
  } catch (e) { /* хранилище закрыто */ }
  return 'dark';
}

export function applyTheme(next) {
  const value = next === 'light' || next === 'auto' ? next : 'dark';
  if (value === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try { localStorage.setItem(THEME_KEY, value); } catch (e) { /* переживём */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mapTheme() === 'light' ? '#F4F4F6' : '#0E0E10');
  return value;
}

/* Какая тема сейчас на самом деле — карте нужен ответ «светлая или тёмная». */
function mapTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'light') return 'light';
  if (set === 'dark') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light' : 'dark';
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

/** Сколько секунд курьер сегодня на линии, вместе с идущей прямо сейчас сменой. */
export function shiftSeconds() {
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

/* ─────────────────────────────────────────────────────── зоны спроса

   Сервер отдаёт сетку ячеек с уровнем спроса от нуля до единицы. Рисуем их
   мягкими розовыми пятнами: квадраты с чёткими границами читались бы как
   запретная зона, а это подсказка «здесь чаще заказывают», не более. */

const ZONES_TTL_MS = 60000;
const ZONE_INK = '255, 72, 138';

let zonesCache = { at: 0, data: null };

function createZones(map, node) {
  const cv = el('canvas', { className: 'sg-zones', 'aria-hidden': 'true' });
  const hint = el('div', {
    className: 'sg-zhint', role: 'status',
    'aria-label': t('zone.title') + ': ' + t('zone.hint'),
  }, el('span', { className: 'sg-zhint__dot' }), el('span', null, t('zone.hint')));
  node.appendChild(cv);
  node.appendChild(hint);

  let data = null;
  let off = null;

  function draw() {
    const gc = cv.getContext ? cv.getContext('2d') : null;
    if (!gc) return;
    const rect = node.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    gc.setTransform(dpr, 0, 0, dpr, 0, 0);
    gc.clearRect(0, 0, w, h);

    const cells = (data && data.cells) || [];
    if (!cells.length) return;

    // Размер ячейки в пикселях меряем один раз за отрисовку: по городу
    // масштаб не меняется, а на каждую ячейку это лишние два пересчёта.
    const dlat = Number(data.cell_lat) || 0.0063;
    const dlng = Number(data.cell_lng) || 0.0086;
    const c = map.getCenter();
    const a = map.containerPoint([c[0] - dlat / 2, c[1] - dlng / 2]);
    const b = map.containerPoint([c[0] + dlat / 2, c[1] + dlng / 2]);
    const r = Math.max(28, Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 0.8);

    for (const cell of cells) {
      if (cell.lat == null || cell.lng == null) continue;
      const p = map.containerPoint([cell.lat, cell.lng]);
      if (p.x < -r || p.y < -r || p.x > w + r || p.y > h + r) continue;
      const level = Math.max(0.12, Math.min(1, Number(cell.level) || 0));
      // Пятно должно читаться как подсказка, а не как заливка: на приближённой
      // карте одна ячейка занимает пол-экрана, и густой розовый съел бы улицы.
      const alpha = 0.08 + 0.2 * level;
      const g = gc.createRadialGradient(p.x, p.y, r * 0.12, p.x, p.y, r);
      g.addColorStop(0, 'rgba(' + ZONE_INK + ', ' + alpha.toFixed(3) + ')');
      g.addColorStop(0.55, 'rgba(' + ZONE_INK + ', ' + (alpha * 0.5).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + ZONE_INK + ', 0)');
      gc.fillStyle = g;
      gc.beginPath();
      gc.arc(p.x, p.y, r, 0, Math.PI * 2);
      gc.fill();
    }
  }

  off = map.on('move', draw);

  let sizes = null;
  if (typeof ResizeObserver === 'function') {
    sizes = new ResizeObserver(() => draw());
    sizes.observe(node);
  }

  return {
    /** Новые данные с сервера. null — спрятать слой совсем. */
    set(next) {
      data = next && Array.isArray(next.cells) && next.cells.length ? next : null;
      cv.classList.toggle('is-on', !!data);
      hint.classList.toggle('is-on', !!data);
      draw();
    },
    destroy() {
      if (off) off();
      if (sizes) sizes.disconnect();
      cv.remove();
      hint.remove();
    },
  };
}

/* ─────────────────────────────────────────────────────── экран смены */

/**
 * Смена: переключатель «на линии», карта со своей позицией, зоны спроса
 * и итоги дня. ctx = {store, go, tracker, refresh}.
 */
export function renderShift(root, ctx) {
  ensureCss();
  const state = ctx.store.get();
  const stop = [];
  let alive = true;
  stop.push(() => { alive = false; });

  const lamp = el('span', { className: 'shift__lamp' });
  const title = el('span', { className: 'shift__state' });
  const toggle = el('button', { className: 'shift__toggle', type: 'button' }, lamp, title);

  const geoBox = el('div', { className: 'shift__geo', hidden: true });
  const mapNode = el('div', { className: 'shift__map' });

  /* ── деньги за сегодня ───────────────────────────────────────────────────
     Первое, ради чего открывают приложение. Узлы собираем один раз и дальше
     меняем только текст: экран обновляется от каждого события сервера, и
     пересборка карточки давала бы мигание там, где цифры и не поменялись. */
  const earnValue = el('div', { className: 'sg-earn__v' }, money(0));
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

  const earnBox = el('div', { className: 'sg-earn' },
    el('div', null,
      el('div', { className: 'sg-earn__k' }, t('shift.earned')),
      earnValue),
    el('div', { className: 'sg-earn__facts' },
      el('div', { className: 'sg-fact' }, factOrders, el('span', null, t('shift.orders'))),
      el('div', { className: 'sg-fact' }, factHours, el('span', null, t('shift.hours'))),
      el('div', { className: 'sg-fact' }, factRating, el('span', null, t('courier.rating')))),
    goalBtn);

  const weekValue = el('div', { className: 'tile__v' }, moneyShort(0));
  const monthValue = el('div', { className: 'tile__v' }, moneyShort(0));
  const openMoney = () => { haptic(); ctx.go('/history'); };
  const tilesBox = el('div', { className: 'tiles' },
    el('button', { className: 'tile sg-tile', type: 'button', onClick: openMoney },
      el('div', { className: 'tile__k' }, t('shift.week')), weekValue),
    el('button', { className: 'tile sg-tile', type: 'button', onClick: openMoney },
      el('div', { className: 'tile__k' }, t('shift.month')), monthValue));

  // Звук живёт здесь же, на экране смены: именно отсюда водитель уходит ждать
  // заказ, и именно здесь важно знать, услышит он его или нет.
  root.replaceChildren(el('div', { className: 'shift' },
    toggle, geoBox, earnBox, tilesBox, mapNode, soundSettings()));

  /* ── карта и своя точка ── */
  const map = makeMap(mapNode, state.config, { locate: false });
  stop.push(() => map.destroy());

  const zones = createZones(map, mapNode);
  stop.push(() => zones.destroy());

  let me = null;
  const putMe = (at, heading) => {
    if (!at) return;
    if (!me) {
      me = map.marker({ at, html: pin('me'), anchor: 'center', zIndex: 30 });
      map.setView(at, Math.max(map.getZoom(), 15), { animate: false });
    } else {
      me.moveTo(at, { duration: 700, heading });
    }
  };
  putMe(ctx.tracker.at() || state.at, ctx.tracker.heading());

  /* ── зоны спроса ──────────────────────────────────────────────────────
     Спрашиваем сервер раз в минуту и только пока курьер на линии и свободен:
     в заказе эта карта ему не нужна, а трафик и батарею тратит. */
  let zoneTimer = 0;

  function zonesWanted() {
    const s = ctx.store.get();
    return !!s.online && !s.order;
  }

  async function pullZones(fresh) {
    if (!alive || !zonesWanted()) return;
    if (!fresh && zonesCache.data && Date.now() - zonesCache.at < ZONES_TTL_MS) {
      zones.set(zonesCache.data);
      return;
    }
    try {
      const data = await api.get('/courier/zones');
      zonesCache = { at: Date.now(), data };
      if (alive && zonesWanted()) zones.set(data);
    } catch (e) {
      // Зоны — подсказка, а не работа: молчим и попробуем через минуту.
    }
  }

  function syncZones() {
    if (zoneTimer) clearInterval(zoneTimer);
    zoneTimer = 0;
    if (!zonesWanted()) {
      zones.set(null);
      return;
    }
    pullZones(false);
    zoneTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') pullZones(true);
    }, ZONES_TTL_MS);
  }

  stop.push(() => { if (zoneTimer) clearInterval(zoneTimer); });

  const onShow = () => { if (document.visibilityState === 'visible') pullZones(false); };
  document.addEventListener('visibilitychange', onShow);
  stop.push(() => document.removeEventListener('visibilitychange', onShow));

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
      markShift(!!res.online);          // часы на линии считаем сами, сервер их не ведёт
      ctx.store.set({
        online: !!res.online,
        busy: !!res.busy,
        geoOk: !!res.geo_fresh,
        order: res.order || null,
      });
      if (res.message) toast(res.message, { type: 'warn', ms: 4500 });
      if (next) ctx.tracker.start();
      else ctx.tracker.stop();
    } catch (e) {
      toast((e && e.message) || t('err.unknown'), { type: 'err' });
    } finally {
      spinner(toggle, false);
      paint();
      paintHours();
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
    weekValue.textContent = moneyShort((s && s.week && s.week.earned) || 0);
    monthValue.textContent = moneyShort((s && s.month && s.month.earned) || 0);
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

  stop.push(ctx.store.on(() => { paint(); paintStats(); }));
  stop.push(ctx.store.select((s) => s.online, () => { paintHours(); syncZones(); }));
  stop.push(ctx.store.select((s) => s.order, () => syncZones()));
  stop.push(ctx.onFix((point) => putMe([point.lat, point.lng], point.heading)));

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

  let sending = false;

  async function send() {
    const text = input.value.trim();
    if (!text || sending || !c.canSend) return;
    sending = true;
    sendBtn.disabled = true;
    input.value = '';
    grow();
    try {
      const res = await api.post('/courier/orders/' + orderId + '/messages', { text });
      const msg = chatPush(c, res && res.message);
      if (msg) add(msg);
      haptic();
      if (typeof opts.onChange === 'function') opts.onChange();
    } catch (e) {
      input.value = text;                 // текст возвращаем: набирать заново обидно
      grow();
      toast((e && e.message) || t('err.unknown'), { type: 'err' });
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

/**
 * Панель заказа: тянется пальцем и сворачивается до заголовка с кнопкой.
 * Сворачиваем не переездом вниз, а сжатием списка — тогда главная кнопка
 * остаётся на месте, а карта честно занимает освободившееся место.
 * Возвращает {sync, to, destroy}.
 */
function panelDrag(shell, panel, scroll, grip, head) {
  let maxH = 0;
  let pos = 'full';
  let cur = 0;

  function limits() {
    const cap = Math.round(window.innerHeight * 0.62);      // как в .job__panel
    const chrome = Math.max(0, panel.offsetHeight - scroll.offsetHeight);
    const room = Math.max(80, cap - chrome);
    const need = scroll.scrollHeight;
    return Math.max(0, Math.min(need, room));
  }

  function apply(h) {
    cur = Math.max(0, Math.round(h));
    scroll.style.height = cur + 'px';
    // Отступы у списка свои, и при нулевой высоте в них выглядывает край
    // карточки: прокрутка обрезает содержимое по краю padding, а не border.
    scroll.classList.toggle('is-shut', cur < 12);
  }

  function to(name, animate = true) {
    maxH = limits();
    pos = name === 'peek' || name === 'half' ? name : 'full';
    if (!animate) shell.classList.add('is-drag');
    apply(pos === 'full' ? maxH : (pos === 'half' ? Math.round(maxH / 2) : 0));
    if (!animate) {
      void scroll.offsetHeight;         // фиксируем кадр, иначе поедет анимация
      shell.classList.remove('is-drag');
    }
    if (grip) {
      grip.setAttribute('aria-expanded', pos === 'full' ? 'true' : 'false');
      grip.setAttribute('aria-label', pos === 'full' ? t('job.panel_less') : t('job.panel_more'));
    }
    return pos;
  }

  let pid = null, y0 = 0, h0 = 0, live = false, t0 = 0, endedAt = 0;

  function onDown(e) {
    if (e.button || pid !== null || !e.target.closest) return;
    // Тянут за грип и шапку. Списку внутри панели жест не мешает: он должен
    // листаться, а кнопки в шапке — нажиматься, а не тащить панель.
    if (!e.target.closest('.job__grip, .sg-head')) return;
    if (e.target.closest('a')) return;
    const btn = e.target.closest('button');
    if (btn && btn !== grip) return;
    pid = e.pointerId;
    y0 = e.clientY;
    t0 = performance.now();
    maxH = limits();
    h0 = cur;
    live = false;
  }

  function onMove(e) {
    if (pid === null || e.pointerId !== pid) return;
    const dy = e.clientY - y0;
    if (!live) {
      if (Math.abs(dy) < 6) return;
      live = true;
      shell.classList.add('is-drag');
      try { panel.setPointerCapture(pid); } catch (err) { /* мышь без захвата */ }
    }
    let h = h0 - dy;
    if (h > maxH) h = maxH + (h - maxH) / 4;      // выше своего края тянется туго
    apply(Math.max(0, Math.min(maxH, h)));
    if (e.cancelable) e.preventDefault();
  }

  function onUp(e) {
    if (pid === null || (e.pointerId !== undefined && e.pointerId !== pid)) return;
    pid = null;
    shell.classList.remove('is-drag');
    if (!live) return;
    live = false;
    endedAt = performance.now();
    // Инерция: куда палец доехал бы ещё за сто миллисекунд, к тому и садимся.
    const speed = (h0 - cur) / Math.max(1, performance.now() - t0);
    const aim = cur - speed * 100;
    const stops = { full: maxH, half: Math.round(maxH / 2), peek: 0 };
    let best = 'full';
    for (const name of ['full', 'half', 'peek']) {
      if (Math.abs(stops[name] - aim) < Math.abs(stops[best] - aim)) best = name;
    }
    to(best, true);
    haptic();
  }

  function onGrip() {
    if (performance.now() - endedAt < 300) return;    // это был жест, а не нажатие
    haptic();
    to(pos === 'full' ? 'peek' : 'full', true);
  }

  /* Пока панель в пальцах, страница под ней ехать не должна. */
  function onTouchMove(e) {
    if (live && e.cancelable) e.preventDefault();
  }

  panel.addEventListener('pointerdown', onDown);
  panel.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  if (grip) grip.addEventListener('click', onGrip);

  const onResize = () => { if (pid === null) to(pos, false); };
  window.addEventListener('resize', onResize);

  let sizes = null;
  if (typeof ResizeObserver === 'function') {
    // Содержимое подросло (пришёл счётчик ожидания) — держим положение, а не пиксели.
    sizes = new ResizeObserver(() => { if (pid === null && pos === 'full') to(pos, false); });
    sizes.observe(head);
  }

  to('full', false);

  return {
    /** Содержимое панели поменялось — пересчитать высоту под текущее положение. */
    sync() { if (pid === null) to(pos, false); },
    to,
    pos: () => pos,
    destroy() {
      if (sizes) sizes.disconnect();
      panel.removeEventListener('pointerdown', onDown);
      panel.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
      if (grip) grip.removeEventListener('click', onGrip);
      scroll.style.height = '';
    },
  };
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

/**
 * Экран активного заказа: карта во весь экран, панель снизу, маршрут,
 * чат с клиентом и главная кнопка. ctx = {store, go, tracker, onFix, refresh}.
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
  let panel = null;

  /* ── разметка экрана ── */
  const mapNode = el('div', { className: 'job__map', 'data-map': '' });
  const backBtn = el('button', {
    className: 'sg-rbtn', type: 'button', html: ICONS.back,
    'aria-label': t('job.back'), title: t('job.back'),
    onClick: () => { haptic(); ctx.go('/shift'); },
  });
  const fitBtn = el('button', {
    className: 'sg-rbtn', type: 'button', html: ICONS.fit,
    'aria-label': t('job.fit'), title: t('job.fit'),
    onClick: () => { haptic(); fitAll(); },
  });

  // Адрес следующей точки — самая верхняя строка экрана. Он виден всегда,
  // в каком бы положении ни стояла панель, и написан крупно: за рулём на него
  // смотрят вполглаза. Нажатие копирует адрес, долгое — открывает навигатор.
  const nextKicker = el('span', { className: 'sg-next__k' }, t('job.next_title'));
  const nextAddr = el('span', { className: 'sg-next__addr' }, '—');
  const nextBtn = el('button', {
    className: 'sg-next', type: 'button', title: t('job.copy_addr'),
  }, el('span', { className: 'sg-next__body' }, nextKicker, nextAddr),
    el('span', { className: 'sg-next__copy', html: ICONS.copy }));
  const topBar = el('div', { className: 'sg-topbar' }, backBtn, nextBtn, fitBtn);

  const grip = el('button', {
    className: 'job__grip', type: 'button',
    'aria-expanded': 'true', 'aria-label': t('job.panel_less'),
  });
  const statusRow = el('div', { className: 'job__status' });
  const stillBox = el('div', { className: 'sg-still', hidden: true });
  const etaRow = el('div', { className: 'sg-eta' });
  const quickRow = el('div', { className: 'sg-quick' });
  const navsRow = el('div', { className: 'sg-navs' });
  const headBox = el('div', { className: 'sg-head' },
    statusRow, stillBox, etaRow, quickRow, navsRow);

  const clientBox = el('div', { className: 'job__client' });
  const pointsBox = el('div', { className: 'offer__rows' });
  const moneyBox = el('div', { className: 'job__money' });
  const waitBox = el('div', { className: 'wait' });
  const extrasBox = el('div', { className: 'row wrap gap-2' });
  const scrollBox = el('div', { className: 'job__scroll' },
    clientBox, waitBox, extrasBox, pointsBox, moneyBox);

  const actBox = el('div', { className: 'act' });
  const panelBox = el('div', { className: 'job__panel' }, grip, headBox, scrollBox, actBox);
  const jobBox = el('div', { className: 'job job--full' },
    mapNode, topBar, panelBox);

  root.replaceChildren(jobBox);
  document.getElementById('app').classList.add('app--job');
  document.documentElement.dataset.job = 'full';
  stop.push(() => {
    document.getElementById('app').classList.remove('app--job');
    delete document.documentElement.dataset.job;
  });

  /* ── карта: точки заказа, нитка между ними и своя машина ── */
  const map = makeMap(mapNode, state.config, { locate: true });
  stop.push(() => map.destroy());
  // Кнопки карты держим над панелью: панель ей не мешает, она снизу отдельно.
  mapNode.style.setProperty('--map-ui-bottom', 'var(--sp-3)');

  let carMarker = null;
  let plan = null;            // весь маршрут заказа, пунктиром
  let leg = null;             // остаток пути до ближайшей точки, сплошной
  const pointMarkers = [];

  function orderCoords(order) {
    const out = [];
    for (const p of order.points || []) {
      if (p.lat == null || p.lng == null) continue;
      out.push([p.lat, p.lng]);
    }
    return out;
  }

  function drawOrder(order) {
    for (const m of pointMarkers.splice(0)) m.remove();
    const points = order.points || [];
    const coords = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.lat == null || p.lng == null) continue;
      coords.push([p.lat, p.lng]);
      const kind = i === 0 ? 'a' : 'b';
      const label = i === 0 ? '' : String(i);
      pointMarkers.push(map.marker({
        at: [p.lat, p.lng], html: pin(kind, label), anchor: 'bottom', zIndex: 10 + i,
      }));
    }
    if (coords.length >= 2) {
      if (plan) plan.setCoords(coords);
      else plan = map.route(coords, { dashed: true, width: 5 });
    } else if (plan) {
      plan.setCoords([]);
    }
  }

  /** Показать всё сразу: свою машину, точки заказа и остаток маршрута. */
  function fitAll() {
    const all = orderCoords(ctx.store.get().order || {});
    const at = ctx.tracker.at() || ctx.store.get().at;
    if (at) all.push(at);
    if (all.length > 1) {
      map.fitPoints(all, { padding: { top: 70, right: 60, bottom: 60, left: 60 } });
    } else if (all.length === 1) {
      map.setView(all[0], 15, { animate: true });
    }
  }

  const putCar = (at, heading) => {
    if (!at) return;
    if (!carMarker) {
      carMarker = map.marker({
        at, html: pin('car'), anchor: 'center', zIndex: 40, rotate: true,
        heading: typeof heading === 'number' ? heading : 0,
      });
    } else {
      carMarker.moveTo(at, { duration: 800, heading });
    }
  };

  /* ── остаток пути: расстояние, время и линия ──────────────────────────── */

  const nav = { key: '', at: null, reqAt: 0, busy: false, info: null };

  function targetPoint(order) {
    const points = order.points || [];
    if (!points.length) return null;
    const p = TO_PICKUP.indexOf(order.status) >= 0 ? points[0] : points[points.length - 1];
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
    const to = targetPoint(order);
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
    paintLeg();
    paintEta();
  }

  function paintLeg() {
    const line = nav.info && nav.info.line;
    if (!line || line.length < 2) {
      if (leg) { leg.remove(); leg = null; }
      return;
    }
    if (leg) leg.setCoords(line);
    else leg = map.route(line, { width: 6 });
  }

  /* Строку остатка пути собираем один раз и дальше меняем только цифры:
     она обновляется каждые несколько секунд, и пересборка узлов давала бы
     заметное подмигивание. */
  const etaLabel = el('span');
  const etaDist = el('b');
  const etaTime = el('b');
  const etaRough = el('span', { className: 'muted-2' }, t('job.route_straight'));
  etaRow.append(ico(ICONS.nav), etaLabel, etaDist, el('span', null, '·'), etaTime, etaRough);

  function paintEta() {
    const order = ctx.store.get().order;
    if (!order) return;
    const toPickup = TO_PICKUP.indexOf(order.status) >= 0;
    const info = nav.info;
    etaLabel.textContent = (toPickup ? t('job.to_pickup_left') : t('job.to_drop_left')) + ':';
    etaDist.textContent = info ? distance(info.distance_m) : '—';
    etaTime.textContent = info ? duration(info.duration_s) : '—';
    etaRough.hidden = !(info && info.rough);
  }

  /* Кнопки навигаторов тоже живут постоянно: точку они спрашивают в момент
     нажатия. Заодно запоминают выбор — его берёт долгое нажатие на адрес. */
  function openNavTo(code) {
    const order = ctx.store.get().order;
    const to = order ? targetPoint(order) : null;
    if (!to) return;
    rememberNav(code);
    haptic(16);
    const links = navLinks(code, to.lat, to.lng);
    openNav(links.app, links.web);
  }

  navsRow.append(
    el('button', {
      className: 'btn btn--ghost', type: 'button',
      title: t('job.open_nav'), 'aria-label': t('job.nav_ya'),
      onClick: () => openNavTo('ya'),
    }, ico(ICONS.nav), t('job.nav_short_ya')),
    el('button', {
      className: 'btn btn--ghost', type: 'button',
      title: t('job.open_nav'), 'aria-label': t('job.nav_2gis'),
      onClick: () => openNavTo('2gis'),
    }, ico(ICONS.nav), t('job.nav_2gis')));

  function paintNavs() {
    const order = ctx.store.get().order;
    navsRow.hidden = !(order && targetPoint(order));
  }

  /* ── адрес следующей точки ───────────────────────────────────────────────
     Одна строка сверху, крупно. Нажатие копирует адрес — его часто диктуют
     по телефону; долгое нажатие открывает навигатор, которым человек
     пользуется сам. */
  const longAddr = onLongPress(nextBtn, 520, () => openNavTo(preferredNav()));
  stop.push(() => longAddr.destroy());

  nextBtn.addEventListener('click', () => {
    if (longAddr.long()) return;        // навигатор уже открылся, копировать не надо
    const order = ctx.store.get().order;
    const to = order ? targetPoint(order) : null;
    const addr = to && to.addr;
    if (!addr) return;
    copyText(addr, t('job.copied'));
  });

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
    const points = (order && order.points) || [];
    const toPickup = !order || TO_PICKUP.indexOf(order.status) >= 0;
    const point = (order && targetPoint(order)) ||
      (toPickup ? points[0] : points[points.length - 1]);
    const addr = point && point.addr ? shortAddr(point.addr) : t('order.on_map');
    const kicker = toPickup ? t('courier.offer_pickup') : t('courier.offer_drop');
    if (nextKicker.textContent !== kicker) nextKicker.textContent = kicker;
    if (nextAddr.textContent !== addr) nextAddr.textContent = addr;
    nextBtn.setAttribute('aria-label', kicker + ': ' + addr + '. ' + t('job.copy_addr'));
  }

  /* ── чат с клиентом ───────────────────────────────────────────────────── */

  const unreadBadge = el('span', { className: 'sg-unread', hidden: true });
  const chatBtn = el('button', {
    className: 'btn btn--ghost btn--icon sg-chatbtn', type: 'button',
    'aria-label': t('chat.title'), title: t('chat.title'),
    onClick: () => showChat(),
  }, ico(ICONS.chat), unreadBadge);

  /* Телефон клиента и чат стоят в шапке панели, а не в списке: список водитель
     сворачивает, чтобы видеть дорогу, а позвонить нужно в одно касание из
     любого положения панели. */
  const callBtn = el('a', {
    className: 'btn btn--primary', href: '#', hidden: true,
    'aria-label': t('courier.call_client'),
  }, ico(ICONS.phone), t('common.call'));
  quickRow.append(callBtn, chatBtn);

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
    const points = order.points || [];
    const contact = points[0] || {};
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

  const onShow = () => {
    if (document.visibilityState !== 'visible') return;
    pollChat();
    refreshLeg(true);
    checkStill(null);
  };
  document.addEventListener('visibilitychange', onShow);
  stop.push(() => document.removeEventListener('visibilitychange', onShow));

  /* ── счётчик ожидания ──────────────────────────────────────────────────
     Цифры тикают раз в секунду, поэтому узлы собраны один раз: пересборка
     карточки каждую секунду — это мигание прямо под рукой водителя. */
  let waitTimer = 0;
  let waitShown = false;
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
    // Счётчик появился или пропал — панель стала выше или ниже, пересчитываем.
    // Каждую секунду этого не делаем: цифры меняются, высота — нет.
    if (canWait !== waitShown) {
      waitShown = canWait;
      if (panel) panel.sync();
    }
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

  /* ── «вы стоите на месте» ────────────────────────────────────────────────
     Самая частая ошибка за смену: груз уже выгружен, а статус так и остался
     «в пути». Молча стоящая пять минут машина — повод мягко об этом спросить.
     Никаких модальных окон: строка в шапке панели, один короткий толчок
     вибрацией и кнопка «понятно», после которой мы замолкаем до следующей
     остановки. */
  const STILL_MS = 5 * 60 * 1000;
  const STILL_MOVE_M = 80;            // меньше — это дрожание датчика, а не поездка
  const STILL_EVERY_MS = 30000;

  const stillTitle = el('span', { className: 'sg-still__t' });
  const stillHide = el('button', {
    className: 'sg-still__x', type: 'button',
    onClick: () => {
      still.muted = true;
      haptic();
      showStill(false);
    },
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
    if (panel) panel.sync();
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
    const minutes = Math.floor((Date.now() - still.at) / 60000);
    if (minutes < 5) return;
    stillTitle.textContent = t('job.still', { time: tp(minutes, 'common.n_min') });
    if (still.muted || still.on) return;
    showStill(true);
    haptic([14, 70, 14]);
  }

  const stillTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') checkStill(null);
  }, STILL_EVERY_MS);
  stop.push(() => clearInterval(stillTimer));

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

  /* ── клиент, адреса, деньги ── */
  let lastStatus = '';
  let lastCard = '';

  /* Карточка заказа приходит с сервера при каждом обновлении состояния, но
     меняется в ней от силы раз за поездку. Сравниваем содержимое и молча
     выходим, если оно то же самое: иначе список адресов пересобирался бы
     каждые несколько секунд прямо под пальцем. */
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
      // Ничего важного не поменялось — трогаем только то, что живёт своей
      // жизнью: остаток пути, ожидание и счётчик непрочитанных.
      paintEta();
      paintWait();
      paintUnread();
      return;
    }
    lastCard = key;

    const points = order.points || [];
    const step = FLOW[order.status];

    statusRow.replaceChildren(
      el('span', { className: 'badge badge--accent' }, order.public_id || ''),
      el('span', { className: 'h3 grow truncate' }, step ? t(step.now) : t('track.done')));
    paintUnread();
    paintNext();

    // Пока едем за грузом — перед глазами отправитель, после погрузки — получатель.
    const toPickup = TO_PICKUP.indexOf(order.status) >= 0;
    const contact = toPickup ? points[0] : points[points.length - 1];
    const who = (contact && contact.name) || t('rate.client_of');
    // У точки может не быть своего телефона — тогда звоним тому, кто заказал.
    // Курьер не должен остаться без связи только потому, что поле пустое.
    const tel = telHref((contact && contact.phone) || (order.client && order.client.phone));

    // Кнопка звонка в шапке: клиента набирают одним касанием, не разворачивая
    // панель и не выискивая номер в списке адресов.
    callBtn.hidden = !tel;
    if (tel) {
      callBtn.href = tel;
      callBtn.setAttribute('aria-label', t('courier.call_client') + ': ' + who);
    }

    clientBox.hidden = !contact;
    if (contact) {
      // replaceChildren — не el(): пустые места он превращает в слово «null»
      // прямо на экране, поэтому список детей собираем сами.
      const known = contact.phone || (order.client && order.client.phone) || '';
      const kids = [
        el('span', { className: 'avatar avatar--accent' }, initials(who) || '·'),
        el('div', { className: 'grow' },
          el('div', { className: 'job__client-name' }, who),
          el('div', { className: 'muted t-sm' },
            known ? fmtPhone(known) : (contact.addr || '')),
          clientRating(order.client)),
      ];
      // Второй кнопки звонка здесь нет нарочно: она стоит в шапке панели и
      // видна всегда. Два одинаковых действия рядом только сбивают с толку.
      clientBox.replaceChildren(...kids);
    }

    const extras = extrasText(order, ctx.store.get().config);
    extrasBox.replaceChildren();
    if (order.loaders) extrasBox.appendChild(pill(ICONS.me, tp(order.loaders, 'common.n_loader')));
    if (extras) extrasBox.appendChild(pill(ICONS.box, extras));
    if (order.distance_m) extrasBox.appendChild(pill(ICONS.job, distance(order.distance_m)));
    if (order.duration_s) extrasBox.appendChild(pill(ICONS.clock, duration(order.duration_s)));
    extrasBox.hidden = !extrasBox.children.length;

    pointsBox.replaceChildren();
    for (let i = 0; i < points.length; i++) {
      pointsBox.appendChild(pointRow(points[i], i, points.length, true));
    }
    if (order.comment) {
      pointsBox.appendChild(el('div', { className: 'point__note' },
        t('courier.client_comment') + ': ' + order.comment));
    }

    const paid = order.payment_status === 'paid';
    moneyBox.replaceChildren(
      el('div', { className: 'job__money-row' },
        el('span', null, t('track.price')),
        el('b', null, money(order.price_total || 0))),
      el('div', { className: 'job__money-row' },
        el('span', null, t('courier.commission')),
        el('b', null, money(order.commission || 0))),
      el('div', { className: 'job__money-row job__money-row--big' },
        el('span', null, t('courier.payout')),
        el('b', null, money(order.courier_payout || 0))),
      el('div', { className: 'job__money-row' },
        el('span', null, paid ? t('track.paid') : t('order.pay_cash')),
        el('b', null, paid ? money(order.paid_amount || order.price_total || 0)
          : money(order.price_total || 0))));

    paintAct(order);
    paintWait();
    paintNavs();
    paintEta();
    drawOrder(order);

    // Сменился шаг заказа — показываем панель целиком и пересчитываем остаток
    // пути: цель переехала с погрузки на выгрузку.
    const changed = lastStatus && lastStatus !== order.status;
    const first = !lastStatus;
    lastStatus = order.status;
    if (panel) panel.sync();
    if (changed) {
      if (panel) panel.to('full', true);
      fitAll();
      refreshLeg(true);
    }
    // Часы стоянки отсчитываем от смены статуса, а не от входа на экран:
    // иначе напоминание прилетало бы через пять минут после каждого открытия.
    if (changed || first) stillReset(ctx.tracker.at() || ctx.store.get().at);
  }

  /* ── главная кнопка внизу ── */
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

  async function move(target, btn) {
    const order = ctx.store.get().order;
    if (!order) return;
    haptic(16);
    if (btn) spinner(btn, true);
    try {
      const res = await api.post('/courier/orders/' + order.id + '/status', { status: target });
      ctx.store.set({ order: res.order || null, waiting: res.waiting || null });
      if (target === 'done') {
        if (typeof ctx.finished === 'function') ctx.finished(order.id);
        ctx.store.set({ order: null, busy: false });
        showFinish(res.price || {}, res.order || order);
        ctx.refresh();
        ctx.go('/shift');
      }
    } catch (e) {
      toast((e && e.message) || t('err.unknown'), { type: 'err', ms: 4500 });
      ctx.refresh();
    } finally {
      if (btn) spinner(btn, false);
    }
  }

  paintOrder();
  panel = panelDrag(jobBox, panelBox, scrollBox, grip, headBox);
  stop.push(() => panel.destroy());
  panel.sync();

  putCar(ctx.tracker.at(), ctx.tracker.heading());
  fitAll();
  refreshLeg(true);

  stop.push(ctx.store.select((s) => s.order, () => paintOrder()));
  stop.push(ctx.store.select((s) => s.waiting, () => paintWait()));
  stop.push(ctx.onFix((point) => {
    putCar([point.lat, point.lng], point.heading);
    refreshLeg(false);
    checkStill(point);
  }));

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
   столбиком не съезжает на сутки из-за часового пояса сервиса. */
function chartRange(period) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const start = new Date(day.getTime());
  if (period === 'week') start.setDate(start.getDate() - ((day.getDay() + 6) % 7));
  else if (period === 'month') start.setDate(1);
  else start.setDate(start.getDate() - 6);     // «сегодня» — на фоне недели
  const days = Math.round((day.getTime() - start.getTime()) / 86400000) + 1;
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
  const caption = el('b', { className: 'sg-bars__pick' });
  const box = el('div', { className: 'sg-bars' },
    el('div', { className: 'sg-bars__head' },
      el('span', null, t('earn.by_days')), caption),
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
    caption.textContent = (index === bestAt ? t('earn.best') + ': ' : '') +
      date(day.at) + ' · ' + money(day.sum) +
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
  markShift, shiftSeconds, getGoal, setGoal,
};
