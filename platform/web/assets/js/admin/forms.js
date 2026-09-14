/* Кирпичи админки: тексты, деньги, формы и проверка цены.

   Всё, что повторяется во всех разделах, собрано здесь, чтобы страницы
   занимались делом, а не разметкой полей. Три вещи, ради которых файл и появился:

   1. Деньги. Человек вводит сомы, сервер принимает тыйыны. Перевод живёт в одном
      месте и в обе стороны — иначе рано или поздно тариф уедет в сто раз.
   2. Формы. Проверка до отправки, понятная ошибка у самого поля, защита от
      двойного нажатия и предупреждение, если уходишь с несохранённым.
   3. Проверка цены. Тот же расчёт, что на сервере, — чтобы видеть итог до
      сохранения тарифа. Настоящую цену заказа всё равно считает сервер.
*/

import { el, toast, confirm as ask, spinner } from '../core/ui.js';
import { t as coreT, tp, has as hasKey, getLang } from '../core/i18n.js';

/* ─────────────────────────────────────────────────────── тексты

   Общий словарь в core/lang.*.js покрывает почти всё, но у панели есть свои
   подписи, которых там нет. Держим их рядом с кодом, который их показывает,
   и отдаём через тот же t(): для вызывающего разницы нет. */

const EXTRA = {
  ru: {
    'adm.gate_sub': 'Панель управления сервисом',
    'adm.enter': 'Войти',
    'adm.only_admin': 'Этот вход только для администраторов',
    'adm.more': 'Ещё',
    'adm.sections': 'Разделы',
    'adm.period_year': 'Год',
    'adm.period_all': 'Всё время',
    'adm.live_on': 'Данные идут в реальном времени',
    'adm.live_off': 'Связь с сервером потерялась, восстанавливаем',
    'adm.ov_conversion': 'Конверсия поиска',
    'adm.ov_conversion_hint': 'Доля поисков, которые закончились назначенным курьером',
    'adm.ov_by_day': 'Заказы по дням',
    'adm.ov_last': 'Последние заказы',
    'adm.ov_nobody': 'Сейчас на линии никого',
    'adm.ov_top': 'Кто больше всех возит',
    'adm.ov_by_tariff': 'По тарифам',
    'adm.ov_payout': 'Курьерам',
    'adm.ov_new_couriers': 'Новых курьеров',
    'adm.ov_empty_period': 'За этот период заказов не было',
    'adm.map_legend': 'Что на карте',
    'adm.map_no_geo': 'Где машина — неизвестно',
    'adm.map_empty': 'Никого не видно: на линии пусто',
    'adm.open_card': 'Открыть карточку',
    'adm.page_of': 'Страница {n} из {m}',
    'adm.rows_total': 'Всего {n}',
    'adm.order_actions': 'Ручное вмешательство',
    'adm.order_mark_paid': 'Отметить оплаченным',
    'adm.order_unmark_paid': 'Снять отметку об оплате',
    'adm.order_status_set': 'Сменить статус',
    'adm.order_pick_courier': 'Кому отдать заказ',
    'adm.order_no_couriers': 'Свободных курьеров сейчас нет',
    'adm.order_offers': 'Предложения курьерам',
    'adm.order_track': 'Ссылка для клиента',
    'adm.order_payout': 'Курьеру',
    'adm.order_distance': 'Расстояние',
    'adm.order_duration': 'Время в пути',
    'adm.order_waiting': 'Ожидание',
    'adm.ev_created': 'Заказ создан',
    'adm.ev_search_started': 'Начали искать машину',
    'adm.ev_dispatch_round': 'Разослали предложения',
    'adm.ev_offer_sent': 'Предложение курьеру',
    'adm.ev_offer_declined': 'Курьер отказался',
    'adm.ev_offer_expired': 'Курьер не успел ответить',
    'adm.ev_assigned': 'Курьер назначен',
    'adm.ev_unassigned': 'Курьера сняли с заказа',
    'adm.ev_status': 'Сменили статус',
    'adm.ev_waiting_start': 'Начали считать ожидание',
    'adm.ev_waiting_stop': 'Ожидание закончилось',
    'adm.ev_done': 'Заказ завершён',
    'adm.ev_cancelled': 'Заказ отменён',
    'adm.ev_search_expired': 'Машину так и не нашли',
    'adm.ev_search_cancelled': 'Поиск остановлен',
    'adm.ev_search_restart': 'Поиск запустили заново',
    'adm.ev_payment_started': 'Клиент пошёл платить',
    'adm.ev_payment_paid': 'Оплата прошла',
    'adm.ev_payment_failed': 'Оплата не прошла',
    'adm.ev_payment_pending': 'Ждём оплату',
    'adm.ev_payment_reset': 'Отметку об оплате сняли',
    'adm.ev_payment_offline': 'Платит наличными курьеру',
    'adm.ev_comment': 'Комментарий',
    'adm.ev_rated': 'Поставили оценку',
    'adm.ev_client': 'Действие клиента',
    'adm.ev_system': 'Служебная запись',
    'adm.actor_admin': 'оператор',
    'adm.actor_client': 'клиент',
    'adm.actor_courier': 'курьер',
    'adm.actor_system': 'сервис',
    'adm.cour_acceptance': 'Берёт заказов',
    'adm.cour_earned': 'Заработал',
    'adm.cour_car': 'Машина',
    'adm.cour_history': 'Последние заказы курьера',
    'adm.cour_money': 'Деньги',
    'adm.cour_block_reason': 'Что написать курьеру',
    'adm.cour_block_hint': 'Этот текст уйдёт ему на почту вместе с блокировкой',
    'adm.prio_low': 'Заказы дойдут до него в последнюю очередь',
    'adm.prio_zero': 'Обычная очередь: всё решают расстояние и рейтинг',
    'adm.prio_high': 'При прочих равных заказ уйдёт ему',
    'adm.prio_weight': 'Вес приоритета в раздаче сейчас — {n}',
    'adm.cli_spent': 'Потратил',
    'adm.cli_since_label': 'С нами с',
    'adm.cli_orders': 'Последние заказы',
    'adm.calc_title': 'Проверка цены',
    'adm.calc_km': 'Расстояние, км',
    'adm.calc_min': 'Время в пути, мин',
    'adm.calc_wait': 'Ожидание, мин',
    'adm.calc_loaders': 'Грузчиков',
    'adm.calc_hint': 'Считаем по тем же правилам, что и сервер, — чтобы увидеть цену до сохранения.',
    'adm.calc_min_hit': 'Сработала минималка тарифа',
    'adm.unsaved_title': 'Есть несохранённое',
    'adm.unsaved_text': 'Если уйти сейчас, изменения пропадут',
    'adm.unsaved_mark': 'Не сохранено',
    'adm.leave': 'Уйти',
    'adm.stay': 'Остаться',
    'adm.need_number': 'Здесь нужно число',
    'adm.range_hint': 'От {min} до {max}',
    'adm.range_from': 'Не меньше {min}',
    'adm.range_to': 'Не больше {max}',
    'adm.set_router': 'Маршрутизатор',
    'adm.set_base_url': 'Адрес сайта',
    'adm.set_base_url_hint': 'По нему собираются ссылки в письмах и ссылка отслеживания заказа',
    'adm.secret_saved': 'Ключ уже сохранён. Оставьте поле пустым, чтобы не менять',
    'adm.secret_empty': 'Пока не заполнено',
    'adm.disp_share': 'Доля в оценке — {n}%',
    'adm.disp_share_none': 'Все веса на нуле: курьера выберет одно расстояние',
    'adm.mail_queue': 'Ждут отправки',
    'adm.mail_ok': 'Ушло',
    'adm.mail_bad': 'Не ушло',
    'adm.mail_off': 'Отправка писем выключена',
    'adm.mail_empty': 'Писем пока не было',
    'adm.nothing_changed': 'Менять нечего',
    'adm.currency': 'Валюта',
    'adm.tz_hint': 'Например, Asia/Bishkek',
    'adm.wa': 'WhatsApp поддержки',
    'adm.max_zoom': 'Предельное приближение',
    'adm.geo_country': 'Страна для подсказок',
    'adm.route_speed': 'Средняя скорость, км/ч',
    'adm.pay_lifetime': 'Сколько ждём оплату, с',
    'adm.session_days': 'Сколько дней живёт вход',
    'adm.allow_scheduled': 'Разрешить заказ ко времени',
    'adm.reset_filters': 'Сбросить фильтры',
    'adm.tariff_orders': 'Заказов по тарифу',
    'adm.orders_live': 'Сейчас в работе',
    'adm.pick_tariff': 'Выберите тариф слева или заведите новый',
    'adm.pick_extra': 'Выберите услугу слева или заведите новую',
    'adm.back_to_list': 'К списку',
    'adm.reason_timeout': 'никто не откликнулся за отведённое время',
    'adm.reason_rounds': 'предложили всем, кто был рядом',
    'adm.group_weights': 'Веса подбора',
    'adm.group_loaders': 'Грузчики',
    'adm.group_list': 'Показ в списке',
    'adm.center_lat': 'Центр: широта',
    'adm.center_lng': 'Центр: долгота',
    'adm.smtp_none': 'Без шифрования',
  },
  ky: {
    'adm.gate_sub': 'Сервисти башкаруу панели',
    'adm.enter': 'Кирүү',
    'adm.only_admin': 'Бул кирүү администраторлор үчүн гана',
    'adm.more': 'Дагы',
    'adm.sections': 'Бөлүмдөр',
    'adm.period_year': 'Жыл',
    'adm.period_all': 'Бардык убакыт',
    'adm.live_on': 'Маалымат түз эфирде келип турат',
    'adm.live_off': 'Сервер менен байланыш үзүлдү, кайра туташтырып жатабыз',
    'adm.ov_conversion': 'Издөөнүн конверсиясы',
    'adm.ov_conversion_hint': 'Курьер табылган издөөлөрдүн үлүшү',
    'adm.ov_by_day': 'Күндөр боюнча заказдар',
    'adm.ov_last': 'Акыркы заказдар',
    'adm.ov_nobody': 'Азыр линияда эч ким жок',
    'adm.ov_top': 'Эң көп иштеген курьерлер',
    'adm.ov_by_tariff': 'Тарифтер боюнча',
    'adm.ov_payout': 'Курьерлерге',
    'adm.ov_new_couriers': 'Жаңы курьерлер',
    'adm.ov_empty_period': 'Бул мезгилде заказ болгон жок',
    'adm.map_legend': 'Картада эмне бар',
    'adm.map_no_geo': 'Унаанын жери белгисиз',
    'adm.map_empty': 'Эч ким көрүнбөйт: линияда бош',
    'adm.open_card': 'Картканы ачуу',
    'adm.page_of': '{m} беттин {n}-си',
    'adm.rows_total': 'Баары {n}',
    'adm.order_actions': 'Кол менен башкаруу',
    'adm.order_mark_paid': 'Төлөндү деп белгилөө',
    'adm.order_unmark_paid': 'Төлөм белгисин алып салуу',
    'adm.order_status_set': 'Статусту өзгөртүү',
    'adm.order_pick_courier': 'Заказды кимге беребиз',
    'adm.order_no_couriers': 'Азыр бош курьер жок',
    'adm.order_offers': 'Курьерлерге жиберилген сунуштар',
    'adm.order_track': 'Кардар үчүн шилтеме',
    'adm.order_payout': 'Курьерге',
    'adm.order_distance': 'Аралык',
    'adm.order_duration': 'Жолдогу убакыт',
    'adm.order_waiting': 'Күтүү',
    'adm.ev_created': 'Заказ түзүлдү',
    'adm.ev_search_started': 'Унаа издөө башталды',
    'adm.ev_dispatch_round': 'Сунуштар таратылды',
    'adm.ev_offer_sent': 'Курьерге сунуш кетти',
    'adm.ev_offer_declined': 'Курьер баш тартты',
    'adm.ev_offer_expired': 'Курьер жооп берүүгө үлгүрбөдү',
    'adm.ev_assigned': 'Курьер дайындалды',
    'adm.ev_unassigned': 'Курьер заказдан алынды',
    'adm.ev_status': 'Статус өзгөрдү',
    'adm.ev_waiting_start': 'Күтүү эсептеле баштады',
    'adm.ev_waiting_stop': 'Күтүү токтоду',
    'adm.ev_done': 'Заказ аякталды',
    'adm.ev_cancelled': 'Заказ жокко чыгарылды',
    'adm.ev_search_expired': 'Унаа табылган жок',
    'adm.ev_search_cancelled': 'Издөө токтотулду',
    'adm.ev_search_restart': 'Издөө кайрадан башталды',
    'adm.ev_payment_started': 'Кардар төлөөгө өттү',
    'adm.ev_payment_paid': 'Төлөм өттү',
    'adm.ev_payment_failed': 'Төлөм өткөн жок',
    'adm.ev_payment_pending': 'Төлөм күтүлүүдө',
    'adm.ev_payment_reset': 'Төлөм белгиси алынды',
    'adm.ev_payment_offline': 'Курьерге накталай төлөйт',
    'adm.ev_comment': 'Комментарий',
    'adm.ev_rated': 'Баа берилди',
    'adm.ev_client': 'Кардардын аракети',
    'adm.ev_system': 'Кызматтык жазуу',
    'adm.actor_admin': 'оператор',
    'adm.actor_client': 'кардар',
    'adm.actor_courier': 'курьер',
    'adm.actor_system': 'сервис',
    'adm.cour_acceptance': 'Заказ алуусу',
    'adm.cour_earned': 'Тапкан акчасы',
    'adm.cour_car': 'Унаасы',
    'adm.cour_history': 'Курьердин акыркы заказдары',
    'adm.cour_money': 'Акча',
    'adm.cour_block_reason': 'Курьерге эмне жазабыз',
    'adm.cour_block_hint': 'Бул текст бөгөттөө менен кошо почтасына кетет',
    'adm.prio_low': 'Заказдар ага эң акырында жетет',
    'adm.prio_zero': 'Кадимки кезек: баарын аралык менен рейтинг чечет',
    'adm.prio_high': 'Башкалар тең болсо, заказ ага кетет',
    'adm.prio_weight': 'Азыр таратуудагы приоритеттин салмагы — {n}',
    'adm.cli_spent': 'Короткону',
    'adm.cli_since_label': 'Бизде катталган',
    'adm.cli_orders': 'Акыркы заказдар',
    'adm.calc_title': 'Бааны текшерүү',
    'adm.calc_km': 'Аралык, км',
    'adm.calc_min': 'Жолдогу убакыт, мүн',
    'adm.calc_wait': 'Күтүү, мүн',
    'adm.calc_loaders': 'Жүкчүлөр',
    'adm.calc_hint': 'Сервер менен бирдей эреже боюнча эсептейбиз — баа сактаганга чейин көрүнсүн.',
    'adm.calc_min_hit': 'Тарифтин эң аз баасы иштеди',
    'adm.unsaved_title': 'Сакталбаган нерсе бар',
    'adm.unsaved_text': 'Азыр чыксаңыз, өзгөрүүлөр жоголот',
    'adm.unsaved_mark': 'Сакталган жок',
    'adm.leave': 'Чыгуу',
    'adm.stay': 'Калуу',
    'adm.need_number': 'Бул жерге сан керек',
    'adm.range_hint': '{min} менен {max} ортосунда',
    'adm.range_from': '{min} дегенден аз болбосун',
    'adm.range_to': '{max} дегенден көп болбосун',
    'adm.set_router': 'Маршрутизатор',
    'adm.set_base_url': 'Сайттын дареги',
    'adm.set_base_url_hint': 'Каттардагы жана заказды көзөмөлдөө шилтемелери ушундан чогулат',
    'adm.secret_saved': 'Ачкыч сакталып турат. Өзгөртпөс үчүн талааны бош калтырыңыз',
    'adm.secret_empty': 'Азырынча толтурулган жок',
    'adm.disp_share': 'Баалоодогу үлүшү — {n}%',
    'adm.disp_share_none': 'Бардык салмактар нөлдө: курьерди аралык гана чечет',
    'adm.mail_queue': 'Жөнөтүүнү күтүүдө',
    'adm.mail_ok': 'Кеткени',
    'adm.mail_bad': 'Кетпегени',
    'adm.mail_off': 'Кат жөнөтүү өчүрүлгөн',
    'adm.mail_empty': 'Азырынча кат болгон жок',
    'adm.nothing_changed': 'Өзгөртө турган нерсе жок',
    'adm.currency': 'Валюта',
    'adm.tz_hint': 'Мисалы, Asia/Bishkek',
    'adm.wa': 'Колдоонун WhatsApp',
    'adm.max_zoom': 'Эң жогорку жакындатуу',
    'adm.geo_country': 'Сунуштар үчүн өлкө',
    'adm.route_speed': 'Орточо ылдамдык, км/с',
    'adm.pay_lifetime': 'Төлөмдү канча күтөбүз, сек',
    'adm.session_days': 'Кирүү канча күн жашайт',
    'adm.allow_scheduled': 'Убакыт коюп заказ берүүгө уруксат',
    'adm.reset_filters': 'Чыпкаларды тазалоо',
    'adm.tariff_orders': 'Тариф боюнча заказдар',
    'adm.orders_live': 'Азыр иштөөдө',
    'adm.pick_tariff': 'Сол жактан тариф тандаңыз же жаңысын түзүңүз',
    'adm.pick_extra': 'Сол жактан кызмат тандаңыз же жаңысын түзүңүз',
    'adm.back_to_list': 'Тизмеге',
    'adm.reason_timeout': 'берилген убакытта эч ким жооп бербеди',
    'adm.reason_rounds': 'жакын жердегилердин баарына сунуш кетти',
    'adm.group_weights': 'Тандоо салмактары',
    'adm.group_loaders': 'Жүкчүлөр',
    'adm.group_list': 'Тизмеде көрсөтүү',
    'adm.center_lat': 'Борбор: кеңдик',
    'adm.center_lng': 'Борбор: узундук',
    'adm.smtp_none': 'Шифрлөөсүз',
  },
};

function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => {
    const v = vars[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/** Тот же t(), что и везде, плюс собственные подписи панели. */
export function t(key, vars) {
  if (hasKey(key)) return coreT(key, vars);
  const dict = EXTRA[getLang()] || EXTRA.ru;
  const raw = dict[key] || EXTRA.ru[key];
  return typeof raw === 'string' ? fill(raw, vars) : coreT(key, vars);
}

export { tp };

/* ─────────────────────────────────────────────────────── числа и деньги */

/** Строку из поля — в число. Пустое поле это null, мусор — NaN. */
export function parseNum(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw)
    .replace(/[\s ]/g, '').replace(',', '.');
  if (!s) return null;
  if (!/^-?\d*\.?\d*$/.test(s) || s === '-' || s === '.') return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}

/** Сомы из поля — в целые тыйыны. Половина тыйына уходит вверх. */
export function somToTiyin(raw) {
  const v = parseNum(raw);
  if (v === null) return null;
  if (Number.isNaN(v)) return NaN;
  return Math.round(v * 100);
}

/** Тыйыны — в строку для поля ввода: без разрядов, с запятой у копеек. */
export function tiyinToSom(value) {
  const v = Math.round(Number(value) || 0);
  const whole = Math.trunc(v / 100);
  const rest = Math.abs(v % 100);
  if (!rest) return String(whole);
  return (v < 0 && whole === 0 ? '-0' : String(whole)) + ',' + String(rest).padStart(2, '0');
}

/* ─────────────────────────────────────────────────────── проверка цены

   Повторяет server/pricing.py: те же целые тыйыны, те же округления.
   Нужна ровно для одного — показать итог, пока тариф ещё настраивают.
   Цену заказа по-прежнему считает сервер, здесь только предпросмотр. */

function mulQty(price, qty) {
  const p = Math.round(Number(price) || 0);
  const q = Math.round((Number(qty) || 0) * 100);
  if (p <= 0 || q <= 0) return 0;
  return Math.floor((p * q + 50) / 100);
}

export function commissionFor(total, rule) {
  const sum = Math.max(0, Math.round(Number(total) || 0));
  const kind = (rule && rule.kind) === 'fixed' ? 'fixed' : 'percent';
  const value = Number((rule && rule.value) || 0);
  let c = kind === 'fixed'
    ? Math.round(value)
    : Math.floor((sum * Math.round(value * 100) + 5000) / 10000);
  const low = Math.round(Number((rule && rule.min) || 0));
  const high = Math.round(Number((rule && rule.max) || 0));
  if (low > 0) c = Math.max(c, low);
  if (high > 0) c = Math.min(c, high);
  return Math.max(0, Math.min(c, sum));
}

/**
 * Расчёт по тарифу. tariff — поля как в базе (деньги в тыйынах),
 * input — {distance_m, duration_s, waiting_s, loaders, hours},
 * env — {commission:{kind,value,min,max}, min_price, waiting_free_min}.
 */
export function quoteTariff(tariff, input, env) {
  const T = tariff || {};
  const inp = input || {};
  const e = env || {};
  const distance = Math.max(0, Math.round(Number(inp.distance_m) || 0));
  const duration = Math.max(0, Math.round(Number(inp.duration_s) || 0));
  const waiting = Math.max(0, Math.round(Number(inp.waiting_s) || 0));

  const base = Math.max(0, Math.round(Number(T.base_price) || 0));
  const incTenths = Math.max(0, Math.round((Number(T.included_km) || 0) * 10));
  const tenths = Math.floor((distance + 50) / 100);
  const paidTenths = Math.max(0, tenths - incTenths);
  const priceDistance = Math.floor((Math.max(0, Math.round(Number(T.per_km) || 0)) * paidTenths + 5) / 10);

  const minutes = Math.ceil(duration / 60);
  const paidMin = Math.max(0, minutes - Math.max(0, Math.round(Number(T.included_min) || 0)));
  const priceTime = Math.max(0, Math.round(Number(T.per_min) || 0)) * paidMin;

  let minHours = Number(T.loader_min_hours);
  if (!(minHours > 0)) minHours = 1;
  const asked = Number(inp.hours) || 0;
  const workHours = asked > 0 ? asked : Math.max(1, Math.ceil((duration + waiting) / 3600));
  const loaderHours = Math.max(workHours, minHours);
  const perLoader = mulQty(T.loader_hour_price, loaderHours);
  const wantLoaders = Math.max(0, Math.round(Number(inp.loaders) || 0));
  const freeLoaders = Math.max(0, Math.round(Number(T.loaders_included) || 0));
  const paidLoaders = Math.max(0, wantLoaders - freeLoaders);
  const priceLoaders = perLoader * paidLoaders;

  const waitMinutes = Math.ceil(waiting / 60);
  const freeWait = T.waiting_free_min === null || T.waiting_free_min === undefined
    ? Math.max(0, Math.round(Number(e.waiting_free_min) || 0))
    : Math.max(0, Math.round(Number(T.waiting_free_min) || 0));
  const paidWait = Math.max(0, waitMinutes - freeWait);
  const priceWaiting = Math.max(0, Math.round(Number(T.waiting_per_min) || 0)) * paidWait;

  const subtotal = base + priceDistance + priceTime + priceLoaders + priceWaiting;
  const floor = Math.max(Math.max(0, Math.round(Number(T.min_price) || 0)),
    Math.max(0, Math.round(Number(e.min_price) || 0)));
  const total = Math.max(subtotal, floor);
  const commission = commissionFor(total, e.commission);
  return {
    base,
    distance: priceDistance,
    time: priceTime,
    loaders: priceLoaders,
    waiting: priceWaiting,
    subtotal,
    min_extra: total - subtotal,
    total,
    commission,
    payout: total - commission,
    billable_km: paidTenths / 10,
    billable_min: paidMin,
    paid_loaders: paidLoaders,
    hours: loaderHours,
  };
}

/* ─────────────────────────────────────────────────────── ошибки */

/** Понятный текст ошибки: сообщение сервера, если оно есть. */
export function errText(e) {
  if (!e) return t('err.unknown');
  if (e.message) return e.message;
  return t('err.unknown');
}

/* ─────────────────────────────────────────────────────── несохранённое

   Форма, в которой что-то поменяли, попадает в этот список. Пока список не пуст,
   браузер спросит подтверждение при закрытии вкладки, а переходы между разделами
   пройдут через свой вопрос. */

const DIRTY = new Set();

window.addEventListener('beforeunload', (e) => {
  if (!DIRTY.size) return;
  e.preventDefault();
  e.returnValue = '';
});

export function hasUnsaved() {
  return DIRTY.size > 0;
}

/** Спросить, можно ли уходить. true — можно. */
export async function guardLeave() {
  if (!DIRTY.size) return true;
  const ok = await ask({
    title: t('adm.unsaved_title'),
    text: t('adm.unsaved_text'),
    ok: t('adm.leave'),
    cancel: t('adm.stay'),
    danger: true,
  });
  if (ok) DIRTY.clear();
  return ok;
}

/* ─────────────────────────────────────────────────────── поля */

let uid = 0;

/* Подпись поля: либо ключ словаря в label, либо готовый текст в labelText. */
function labelText(def) {
  if (def.labelText) return def.labelText;
  return def.label ? t(def.label) : '';
}

function hintText(def) {
  if (def.hintText) return def.hintText;
  return def.hint ? t(def.hint) : '';
}

function hasHint(def) {
  return !!(def.hint || def.hintText);
}

function optionLabel(o) {
  if (o.text) return o.text;
  return o.label ? t(o.label) : String(o.value);
}

/* Собирает узел поля и возвращает всё, что понадобится форме дальше. */
function buildField(def, form) {
  const id = 'af' + (++uid);
  const hint = el('span', { className: 'field__hint' }, hintText(def));
  let input = null;
  let wrap = null;
  let read = () => null;
  let write = () => {};

  if (def.kind === 'switch') {
    input = el('input', { type: 'checkbox', id, 'aria-describedby': id + '-h' });
    hint.id = id + '-h';
    wrap = el('div', { className: 'form__f form__f--sw' },
      el('div', { className: 'grow' },
        el('label', { className: 'form__cap', htmlFor: id }, labelText(def)),
        hasHint(def) ? hint : null),
      el('label', { className: 'switch' }, input, el('span', { className: 'switch__track' })));
    read = () => !!input.checked;
    write = (v) => { input.checked = !!v; };
  } else if (def.kind === 'range') {
    const out = el('b', { className: 'num form__range-val' }, '0');
    input = el('input', {
      type: 'range', id, className: 'form__range',
      min: String(def.min === undefined ? 0 : def.min),
      max: String(def.max === undefined ? 100 : def.max),
      step: String(def.step || 1),
    });
    wrap = el('div', { className: 'form__f form__f--range' },
      el('div', { className: 'row between gap-2' },
        el('label', { className: 'form__cap', htmlFor: id }, labelText(def)), out),
      input, hint);
    read = () => Number(input.value);
    write = (v) => {
      const n = Number(v);
      input.value = String(Number.isFinite(n) ? n : 0);
      out.textContent = def.suffix ? input.value + ' ' + def.suffix : input.value;
    };
    input.addEventListener('input', () => {
      out.textContent = def.suffix ? input.value + ' ' + def.suffix : input.value;
    });
  } else if (def.kind === 'chips') {
    const box = el('div', { className: 'chips form__chips' });
    let picked = [];
    const paint = () => {
      box.replaceChildren(...(def.options || []).map((o) => el('button', {
        type: 'button',
        className: 'chip' + (picked.includes(o.value) ? ' chip--on' : ''),
        onClick: () => {
          picked = picked.includes(o.value)
            ? picked.filter((x) => x !== o.value)
            : picked.concat([o.value]);
          paint();
          form.touch(def.name);
        },
      }, optionLabel(o))));
    };
    wrap = el('div', { className: 'form__f' },
      el('span', { className: 'form__cap' }, labelText(def)), box, hint);
    read = () => picked.slice();
    write = (v) => { picked = Array.isArray(v) ? v.slice() : []; paint(); };
    input = box;
  } else if (def.kind === 'select') {
    input = el('select', { className: 'field__input', id });
    for (const o of def.options || []) {
      input.appendChild(el('option', { value: String(o.value) }, optionLabel(o)));
    }
    wrap = el('label', {
      className: 'field field--sel field--fill form__f', htmlFor: id,
    }, input, el('span', { className: 'field__label' }, labelText(def)), hint);
    read = () => (def.number ? Number(input.value) : input.value);
    write = (v) => { input.value = String(v === null || v === undefined ? '' : v); };
  } else if (def.kind === 'textarea') {
    input = el('textarea', {
      className: 'field__input', id, placeholder: ' ', rows: def.rows || 3,
      maxLength: def.maxlength || 2000,
    });
    wrap = el('label', { className: 'field form__f', htmlFor: id },
      input, el('span', { className: 'field__label' }, labelText(def)), hint);
    read = () => input.value.trim();
    write = (v) => { input.value = v === null || v === undefined ? '' : String(v); };
  } else {
    const numeric = def.kind === 'number' || def.kind === 'money';
    input = el('input', {
      className: 'field__input', id, placeholder: ' ',
      type: def.kind === 'password' ? 'password' : (def.kind === 'email' ? 'email' : 'text'),
      inputMode: numeric ? 'decimal' : (def.kind === 'email' ? 'email' : 'text'),
      autocomplete: def.autocomplete || 'off',
      maxLength: def.maxlength || 200,
    });
    wrap = el('label', { className: 'field form__f', htmlFor: id },
      input, el('span', { className: 'field__label' }, labelText(def)), hint);
    if (def.kind === 'money') {
      read = () => somToTiyin(input.value);
      write = (v) => { input.value = v === null || v === undefined || v === '' ? '' : tiyinToSom(v); };
    } else if (def.kind === 'number') {
      read = () => parseNum(input.value);
      write = (v) => { input.value = v === null || v === undefined ? '' : String(v).replace('.', ','); };
    } else {
      read = () => input.value.trim();
      write = (v) => { input.value = v === null || v === undefined ? '' : String(v); };
    }
  }

  if (def.span) wrap.style.setProperty('--span', String(def.span));
  if (def.className) wrap.className += ' ' + def.className;

  const cell = {
    def, wrap, input, hint, read, write,
    error(message) {
      if (message) {
        wrap.classList.add('field--err', 'form__f--err');
        hint.textContent = message;
        if (!hint.isConnected) wrap.appendChild(hint);
      } else {
        wrap.classList.remove('field--err', 'form__f--err');
        hint.textContent = hintText(def);
        if (!hasHint(def) && hint.isConnected && def.kind !== 'switch') hint.remove();
      }
    },
  };
  if (!hasHint(def) && def.kind !== 'switch' && hint.isConnected) hint.remove();
  return cell;
}

/* ─────────────────────────────────────────────────────── форма */

/**
 * Форма по описанию полей.
 *
 * spec = {
 *   fields: [{name, kind, label, hint, group, span, required, min, max, options…}],
 *   values: {...},                  начальные значения (деньги — в тыйынах)
 *   submit: 'common.save',          подпись кнопки
 *   extra: [{label, kind, onClick}] дополнительные кнопки справа
 *   onSubmit: async (values, changed) => {},
 *   onChange: (values, name) => {},
 *   base: {...}                     чем считать «было», если оно не равно показанному
 *   guard: true                     следить за несохранённым
 * }
 */
export function createForm(spec) {
  const defs = (spec.fields || []).filter(Boolean);
  const cells = new Map();
  const guard = spec.guard !== false;
  let base = {};
  let busy = false;
  let alive = true;

  const grid = el('div', { className: 'form__grid' });
  const root = el('form', { className: 'form', noValidate: true });
  const mark = el('span', { className: 'form__mark' }, t('adm.unsaved_mark'));

  const form = {
    el: root,
    touch(name) { onEdit(name); },
  };

  let group = null;
  for (const def of defs) {
    if (def.group && def.group !== group) {
      group = def.group;
      const head = el('div', { className: 'form__head' }, t(def.group));
      head.style.setProperty('--span', '2');
      grid.appendChild(head);
    }
    const cell = buildField(def, form);
    cells.set(def.name, cell);
    grid.appendChild(cell.wrap);
    // Переключатель и список сообщают о себе через change, остальные — по каждому
    // нажатию: живой калькулятор тарифа должен считать, пока человек печатает.
    const evt = def.kind === 'switch' || def.kind === 'select' ? 'change' : 'input';
    if (cell.input && def.kind !== 'chips') {
      cell.input.addEventListener(evt, () => onEdit(def.name));
    }
  }

  const saveBtn = el('button', {
    className: 'btn btn--primary', type: 'submit',
  }, t(spec.submit || 'common.save'));

  const foot = el('div', { className: 'form__foot' }, saveBtn, mark);
  for (const a of spec.extra || []) {
    if (!a) continue;
    if (a instanceof Node) { foot.appendChild(a); continue; }
    foot.appendChild(el('button', {
      className: 'btn btn--' + (a.kind || 'ghost'),
      type: 'button',
      onClick: () => a.onClick(form),
    }, t(a.label)));
  }
  root.append(grid, foot);

  function values() {
    const out = {};
    for (const [name, cell] of cells) out[name] = cell.read();
    return out;
  }

  function same(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => String(v) === String(b[i]));
    }
    if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
    return String(a) === String(b);
  }

  /** Только то, что человек действительно поменял: настройки шлём точечно. */
  function changed() {
    const out = {};
    for (const [name, cell] of cells) {
      const now = cell.read();
      if (!same(now, base[name])) out[name] = now;
    }
    return out;
  }

  function dirty() {
    return Object.keys(changed()).length > 0;
  }

  function refreshDirty() {
    const bad = guard && dirty();
    root.classList.toggle('is-dirty', bad);
    if (bad) DIRTY.add(root);
    else DIRTY.delete(root);
  }

  function onEdit(name) {
    const cell = cells.get(name);
    if (cell) cell.error('');
    refreshDirty();
    if (spec.onChange) {
      try {
        spec.onChange(values(), name, form);
      } catch (e) {
        console.error('[admin] обработчик формы упал', e);
      }
    }
  }

  /* Подсказка о границах. У половины полей задан только пол или только
     потолок — писать «от 0 до undefined» нельзя. */
  function rangeText(def) {
    const low = def.minText !== undefined ? def.minText : def.min;
    const high = def.maxText !== undefined ? def.maxText : def.max;
    if (def.max === undefined) return t('adm.range_from', { min: low });
    if (def.min === undefined) return t('adm.range_to', { max: high });
    return t('adm.range_hint', { min: low, max: high });
  }

  /** Проверка до отправки: обязательные поля, числа и границы. */
  function validate() {
    const bad = [];
    for (const [name, cell] of cells) {
      const def = cell.def;
      const v = cell.read();
      cell.error('');
      if (def.kind === 'number' || def.kind === 'money') {
        if (Number.isNaN(v)) { cell.error(t('adm.need_number')); bad.push(name); continue; }
        if (v === null) {
          if (def.required) { cell.error(t('common.required')); bad.push(name); }
          continue;
        }
        if ((def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max)) {
          cell.error(rangeText(def));
          bad.push(name);
        }
        continue;
      }
      if (def.required && (v === '' || v === null || v === undefined ||
        (Array.isArray(v) && !v.length))) {
        cell.error(t('common.required'));
        bad.push(name);
        continue;
      }
      if (def.kind === 'email' && v && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(v)) {
        cell.error(t('err.bad_email'));
        bad.push(name);
      }
    }
    return bad;
  }

  async function submit() {
    if (busy || !alive) return;
    const bad = validate();
    if (bad.length) {
      const cell = cells.get(bad[0]);
      if (cell && cell.input && cell.input.focus) cell.input.focus();
      toast(t('err.validation'), { type: 'err' });
      return;
    }
    const patch = changed();
    busy = true;
    spinner(saveBtn, true);
    try {
      const res = await spec.onSubmit(values(), patch, form);
      if (res !== false && alive) markSaved();
    } catch (e) {
      const field = e && (e.field || (e.extra && e.extra.field));
      if (field && cells.has(field)) {
        cells.get(field).error(errText(e));
        cells.get(field).input.focus();
      }
      toast(errText(e), { type: 'err' });
    } finally {
      busy = false;
      spinner(saveBtn, false);
    }
  }

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  function set(patch) {
    for (const [name, value] of Object.entries(patch || {})) {
      const cell = cells.get(name);
      if (cell) cell.write(value);
    }
    refreshDirty();
  }

  function markSaved(next) {
    base = Object.assign({}, values(), next || {});
    if (next) set(next);
    refreshDirty();
  }

  function reset(next) {
    set(Object.assign({}, base, next || {}));
    markSaved();
  }

  Object.assign(form, {
    values,
    changed,
    dirty,
    set,
    reset,
    submit,
    markSaved,
    validate,
    get(name) {
      const cell = cells.get(name);
      return cell ? cell.read() : undefined;
    },
    error(name, message) {
      const cell = cells.get(name);
      if (cell) cell.error(message);
    },
    field(name) {
      return cells.get(name);
    },
    destroy() {
      alive = false;
      DIRTY.delete(root);
    },
  });

  set(spec.values || {});
  base = values();
  // Иногда показанное значение и сохранённое — разные вещи (например, поле
  // комиссии переключили с процентов на сумму). Тогда «что изменилось»
  // считаем от того, что реально лежит на сервере.
  if (spec.base) Object.assign(base, spec.base);
  refreshDirty();
  return form;
}
