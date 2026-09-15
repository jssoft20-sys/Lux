/* Оформление заказа: адреса, машина, грузчики, подъём к двери и контакты.

   Три шага в одной шторке: адреса → заказ → контакты. Отдельной анкеты про
   подъезды больше нет: подъезд, квартиру, этаж и домофон человек уточняет
   кнопкой «Детали» прямо у своей строки адреса, и только если ему есть что
   уточнить. Заполненное тут же встаёт серой строкой под адресом, так что видно
   без открывания, что курьер уже знает.

   «От двери до двери» — один переключатель на весь заказ, а не по одному у
   каждой точки: подниматься к двери на погрузке и не подниматься на разгрузке
   не просит никто, зато два одинаковых тумблера подряд раздражают всех. Сервер
   берёт надбавку за каждую точку, поэтому включённый переключатель уходит к
   нему строкой {code:'door_to_door', qty:<сколько точек в маршруте>} и флажком
   у каждой точки — курьеру важно знать, что подниматься надо везде.

   Машины нарисованы здесь же, в SVG: пикап, спринтер и два грузовика с тентом.
   Человек выбирает не строчку в списке, а машину, которую увидит во дворе.
   Размер кузова переключается сегментами S M L XL — так все варианты видно
   сразу, без выпадающего списка и лишнего экрана.

   Цену считает сервер. Здесь она только показывается: перед созданием заказа
   бэкенд пересчитает всё заново по своим тарифам.
*/

import { api } from '../core/api.js';
import { t, tp, getLang, extend } from '../core/i18n.js';
import { createStore } from '../core/store.js';
import {
  el, toast, sheet, haptic, chip, segmented, rowGroup, infoStory, pressable,
} from '../core/ui.js';
import { pin } from '../core/map.js';
import { money, num, duration, NBSP } from '../core/fmt.js';
import { icon, iconBtn, errText, nameOf, dur } from './app.js';
import { pickAddress, rememberPoint, detailsLine, noteMyPlace } from './address.js';

/* Свои строки держим при себе: общий словарь правят соседние модули.
   Кыргызский — живой бишкекский, а не подстрочник с русского. */
extend({
  ru: {
    'car.kg': '{v} кг',
    'car.t': '{v} т',
    'car.cap': 'Максимум {v}',
    'car.body': 'Кузов {v} м',
    'car.size': 'Кузов',

    'trip.title': 'Маршрут',
    'trip.jam': 'с пробками',
    'trip.free': 'дорога свободна',
    'trip.free_time': 'без пробок {v}',

    'pts.details': 'Детали',
    'pts.fill': 'Подъезд, квартира, этаж — если нужно',
    'pts.no_addr': 'Выберите адрес',
    'pts.add': 'Адрес',

    'load.none': 'Нет',
    // Коротко: рядом стоит переключатель, и длинная подпись обрывается на
    // многоточии — строка выглядит сломанной, хотя всё работает.
    'load.zero': 'Помощь не нужна',

    'd2d.title': 'От двери до двери',
    'd2d.on_two': 'Курьер поднимется к двери на обоих адресах',
    'd2d.on_many': 'Курьер поднимется к двери на всех адресах',
    'd2d.off': 'Курьер ждёт у машины, так дешевле',
    'd2d.lift': 'На {v} этаже без лифта так намного проще',

    'info.delivery': 'О доставке',
    'info.loaders': 'О грузчиках',
    'info.body': 'О кузове {v}',
    'info.wait': 'Об ожидании',
    'info.door': 'О подъёме к двери',

    'st.delivery_t': 'Как проходит доставка',
    'st.delivery_1': 'Курьер приезжает на выбранной машине к первому адресу и звонит вам. '
      + 'Дальше — по тем адресам, которые вы поставили в заказе, в том же порядке.',
    'st.delivery_2': 'Цена на жёлтой кнопке окончательная: подача, километры и время в ней '
      + 'уже посчитаны. Вырасти она может, только если вы сами добавите адрес, грузчика '
      + 'или ожидание сверх бесплатного.',
    'st.delivery_3': 'Машину видно на карте с той секунды, как её взял курьер.',

    'st.loaders_t': 'Грузчики',
    'st.loaders_1': 'Без грузчиков водитель только везёт: выносить и заносить вещи придётся самим.',
    'st.loaders_2': 'Один грузчик — это сам водитель: он поможет погрузить и выгрузить. '
      + 'Двое и больше — с водителем приедут ещё люди.',
    'st.loaders_free': 'У этой машины {n} уже в цене, платить за них отдельно не нужно.',
    'st.loaders_paid': 'Каждый грузчик сверх включённых — {price} в час.',

    'st.body_t': 'Кузов {v}',
    'st.body_size': 'Внутри {d} м в длину, {w} м в ширину и {h} м в высоту.',
    'st.body_cap': 'Выдерживает до {v}.',
    'st.body_tip': 'Смотрите не на вес, а на длину: диван 2,2 метра в полутораметровый '
      + 'кузов не войдёт, каким бы лёгким он ни был.',

    'st.wait_t': 'Ожидание',
    'st.wait_free': 'В цену входит {n} минут бесплатного ожидания на каждом адресе.',
    'st.wait_paid': 'Дальше каждая минута — {price}. Счётчик включает курьер, и вы видите '
      + 'его прямо в заказе, а не узнаёте о нём в конце.',
    'st.wait_tip': 'Пока курьер ждёт, он никуда не уедет: заказ остаётся вашим.',

    'st.d2d_t': 'От двери до двери',
    'st.d2d_1': 'Обычно курьер ждёт у машины, а вещи до подъезда вы подносите сами. '
      + 'Так дешевле всего.',
    'st.d2d_2': 'С этим переключателем курьер поднимается к самой двери на каждом адресе '
      + 'маршрута. Это отдельная работа, поэтому надбавка берётся за каждый адрес.',
  },
  ky: {
    'car.kg': '{v} кг',
    'car.t': '{v} тонна',
    'car.cap': 'Эң көбү {v}',
    'car.body': 'Кузов {v} м',
    'car.size': 'Кузов',

    'trip.title': 'Маршрут',
    'trip.jam': 'тыгын менен',
    'trip.free': 'жол бош',
    'trip.free_time': 'тыгынсыз {v}',

    'pts.details': 'Толугураак',
    'pts.fill': 'Подъезд, батир, кабат — керек болсо',
    'pts.no_addr': 'Дарек тандаңыз',
    'pts.add': 'Дарек',

    'load.none': 'Жок',
    'load.zero': 'Жардам керек эмес',

    'd2d.title': 'Эшиктен эшикке',
    // Кыргызчада ээни түшүрүп койсо да түшүнүктүү: катар эки сапка батат.
    'd2d.on_two': 'Эки даректе тең эшигиңизге чейин көтөрөт',
    'd2d.on_many': 'Бардык даректе эшигиңизге чейин көтөрөт',
    'd2d.off': 'Курьер унаанын жанында күтөт, арзаныраак',
    'd2d.lift': '{v}-кабат, лифт жок — мындай бир топ жеңил',

    'info.delivery': 'Жеткирүү жөнүндө',
    'info.loaders': 'Жүкчүлөр жөнүндө',
    'info.body': 'Кузов {v} жөнүндө',
    'info.wait': 'Күтүү жөнүндө',
    'info.door': 'Көтөрүү жөнүндө',

    'st.delivery_t': 'Жеткирүү кантип өтөт',
    'st.delivery_1': 'Курьер тандалган унаа менен биринчи даректе болот жана сизге чалат. '
      + 'Андан ары — заказда койгон даректер боюнча, ошол эле ирет менен.',
    'st.delivery_2': 'Сары баскычтагы баа акыркы баа: унаа чакыруу, километр жана убакыт '
      + 'ошонун ичинде. Ал дарек, жүкчү же кошумча күтүү кошсоңуз гана өзгөрөт.',
    'st.delivery_3': 'Курьер заказды алганда эле унаа картадан көрүнөт.',

    'st.loaders_t': 'Жүкчүлөр',
    'st.loaders_1': 'Жүкчүсүз айдооч жүктү ташыйт гана: буюмдарды өзүңүз чыгарып, өзүңүз киргизесиз.',
    'st.loaders_2': 'Бир жүкчү — бул айдоочунун өзү: жүктөөгө, түшүрүүгө жардам берет. '
      + 'Эки же андан көп болсо, айдооч менен дагы киши келет.',
    'st.loaders_free': 'Бул унаада {n} баанын ичинде, өзүнчө төлөнбөйт.',
    'st.loaders_paid': 'Кошумча ар бир жүкчү — саатына {price}.',

    'st.body_t': 'Кузов {v}',
    'st.body_size': 'Ичи {d} м узун, {w} м кең, {h} м бийик.',
    'st.body_cap': 'Көтөрүмдүүлүгү — {v}.',
    'st.body_tip': 'Салмакка эмес, узундукка караңыз: 2,2 метр диван бир жарым метрлик '
      + 'кузовго батпайт, канчалык жеңил болсо да.',

    'st.wait_t': 'Күтүү',
    'st.wait_free': 'Ар бир даректе {n} мүнөт бекер күтүү баанын ичинде.',
    'st.wait_paid': 'Андан кийин ар бир мүнөт — {price}. Эсепти курьер өзү күйгүзөт, сиз аны '
      + 'заказдан көрүп турасыз, аягында билбейсиз.',
    'st.wait_tip': 'Курьер күтүп турганда эч жакка кетпейт: заказ сиздики бойдон калат.',

    'st.d2d_t': 'Эшиктен эшикке',
    'st.d2d_1': 'Адатта курьер унаанын жанында күтөт, буюмду подъездге чейин өзүңүз '
      + 'жеткиресиз. Эң арзаны ушул.',
    'st.d2d_2': 'Бул которгуч менен курьер маршруттагы ар бир даректе эшигиңизге чейин '
      + 'көтөрөт. Бул өзүнчө жумуш, ошондуктан кошумча акы ар бир дарекке эсептелет.',
  },
});

const QUOTE_PAUSE = 320;       // пауза перед пересчётом цены, чтобы не дёргать сервер
const MAX_LOADERS = 8;
const LOADER_SEGS = 2;         // «Нет 1 2» — грузчиков сверх двух берут в допуслугах
const SEG_LIMIT = 6;           // больше шести сегментов на 360 px не читаются
const JAM_STEP = 60;           // разницу меньше минуты человек не заметит, и врать про неё незачем
const DOOR_CODE = 'door_to_door';   // так подъём к двери называется в расчёте на сервере

/* ─────────────────────────────────────────────────────── машины в SVG */

/* Колесо: тёмная покрышка и ступица в цвет кузова. Все машины стоят на одной
   линии — 32 по вертикали, поэтому в ряду они выглядят одной семьёй. */
function wheel(cx, r) {
  const rr = r || 6;
  return '<circle class="sgv__tyre" cx="' + cx + '" cy="32" r="' + rr + '"/>' +
    '<circle class="sgv__hub" cx="' + cx + '" cy="32" r="' + (rr * 0.38).toFixed(1) + '"/>';
}

/* Каждая машина — несколько чистых фигур: кузов, стекло, колёса. Мелочи вроде
   рёбер тента добавлены только там, где они помогают узнать машину. */
const ART = {
  // Пикап: открытый борт с грузом сзади, кабина и капот впереди. Коробки рисуем
  // до борта — тогда борт закрывает их снизу, как в жизни.
  express: () =>
    '<rect class="sgv__cargo" x="12" y="10" width="11" height="8" rx="1.5"/>' +
    '<rect class="sgv__cargo" x="25" y="12" width="9" height="6" rx="1.5"/>' +
    '<rect class="sgv__deck" x="8" y="17" width="30" height="13" rx="2.5"/>' +
    '<path class="sgv__body" d="M38 30V13c0-2.2 1.8-4 4-4h12c1.4 0 2.7.7 3.4 1.9L61 17h9' +
      'c2.8 0 5 2.2 5 5v5.5c0 1.4-1.1 2.5-2.5 2.5H38z"/>' +
    '<path class="sgv__glass" d="M43 12h10.5l4.6 6.4H43z"/>' +
    '<rect class="sgv__glass" x="70.5" y="20.5" width="4" height="3.4" rx="1.4"/>' +
    wheel(18) + wheel(64),

  // Спринтер: высокая крыша, короткий нос и заваленное лобовое стекло во всю
  // кабину. Стекло идёт вдоль наклона кузова и держится внутри его обвода.
  van: () =>
    '<path class="sgv__body" d="M11 6h35l12 9 8 1.6c3.3.7 5.6 3.6 5.6 7V27c0 1.7-1.3 3-3 3H11' +
      'c-2.2 0-4-1.8-4-4V10c0-2.2 1.8-4 4-4z"/>' +
    '<path class="sgv__glass" d="M44 8.4h4.6l7.9 6.9H44z"/>' +
    '<path class="sgv__line" d="M41 10v19"/>' +
    '<rect class="sgv__cargo" x="13" y="20" width="20" height="1.6" rx=".8"/>' +
    wheel(22) + wheel(62),

  // Трёхтонник: тент с рёбрами и отдельная кабина, между ними рама.
  truck: () =>
    '<path class="sgv__deck" d="M6 30V13c0-2.8 2.2-5 5-5h38c2.8 0 5 2.2 5 5v17H6z"/>' +
    '<path class="sgv__line" d="M6 15h48M18 15.5v14M30 15.5v14M42 15.5v14"/>' +
    '<rect class="sgv__body" x="16" y="27.5" width="46" height="3" rx="1.5"/>' +
    '<path class="sgv__body" d="M56 30V14c0-2.2 1.8-4 4-4h9.4c1.6 0 3 .9 3.7 2.3l3.4 6.9' +
      'c.3.6.5 1.3.5 2v6.3c0 1.4-1.1 2.5-2.5 2.5H56z"/>' +
    '<path class="sgv__glass" d="M60 13h9l3.6 7.2H60z"/>' +
    wheel(26) + wheel(66),

  // Пятитонник: тент выше и длиннее, кабина со спальником, задняя ось спаренная.
  truck_big: () =>
    '<path class="sgv__deck" d="M4 30V11c0-2.8 2.2-5 5-5h44c2.8 0 5 2.2 5 5v19H4z"/>' +
    '<path class="sgv__line" d="M4 13h54M15 13.5v16M27 13.5v16M39 13.5v16M51 13.5v16"/>' +
    '<rect class="sgv__body" x="12" y="27.5" width="54" height="3" rx="1.5"/>' +
    '<path class="sgv__body" d="M60 30V11c0-2.2 1.8-4 4-4h9c1.5 0 2.9.8 3.6 2.1l2.9 5.4' +
      'c.3.6.5 1.2.5 1.9v11.1c0 1.4-1.1 2.5-2.5 2.5H60z"/>' +
    '<path class="sgv__glass" d="M64 10h8.6l3.4 6.4H64z"/>' +
    wheel(16) + wheel(30) + wheel(70),
};

const ART_BY_ICON = {
  car: 'express', pickup: 'express', van: 'van', bus: 'van',
  truck: 'truck', 'truck-big': 'truck_big', truck_big: 'truck_big',
};

/* Какую машину рисовать. Класс из тарифа главный, иконка — запасной вариант,
   а если админ придумал свой класс, судим по грузоподъёмности: показать пикап
   там, где приедет пятитонник, хуже, чем угадать по весу. */
function vehicleKind(tf) {
  const cls = String((tf && tf.vehicle_class) || '').toLowerCase();
  if (ART[cls]) return cls;
  const byIcon = ART_BY_ICON[String((tf && tf.icon) || '').toLowerCase()];
  if (byIcon) return byIcon;
  const kg = Number(tf && tf.capacity_kg) || 0;
  if (kg >= 4000) return 'truck_big';
  if (kg >= 2000) return 'truck';
  if (kg >= 700) return 'van';
  return 'express';
}

function vehicleArt(tf) {
  return '<svg class="sgv" viewBox="0 0 84 44" aria-hidden="true" focusable="false">' +
    '<ellipse class="sgv__shade" cx="42" cy="39.2" rx="31" ry="2.2"/>' +
    ART[vehicleKind(tf)]() + '</svg>';
}

/* ─────────────────────────────────────────────────────── значки и картинки */

/* Коробка у точки отправления и флажок у точки назначения: концы маршрута
   должны отличаться не только словом, но и формой — список читают в спешке. */
const ART_FROM =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 3.1 20.2 7.4v9.2L12 20.9 3.8 16.6V7.4z" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linejoin="round"/>' +
  '<path d="M3.8 7.4 12 11.7l8.2-4.3M12 11.7v9.2" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linejoin="round"/></svg>';

const ART_TO =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M6.4 20.4V4.2" fill="none" stroke="currentColor" stroke-width="1.9" ' +
  'stroke-linecap="round"/>' +
  '<path d="M6.4 5h11.2l-2.6 4 2.6 4H6.4z" fill="currentColor"/></svg>';

/* Картинки пояснительных экранов рисуем сами: у Яндекса берём язык формы,
   а не его имущество. Один стиль на все четыре — контур плюс жёлтое пятно. */
function storyArt(body) {
  return '<svg class="sga" viewBox="0 0 200 140" aria-hidden="true" focusable="false">' + body + '</svg>';
}

const STORY_ART = {
  // Путь от коробки к флажку: две точки и пунктир между ними.
  delivery: () => storyArt(
    '<circle class="sga__blob" cx="100" cy="76" r="54"/>' +
    '<path class="sga__dash" d="M44 96c26 8 36-20 58-24s30 22 54 10"/>' +
    '<rect class="sga__fill" x="28" y="76" width="32" height="26" rx="4"/>' +
    '<path class="sga__ink" d="M28 84h32M44 76v26"/>' +
    '<path class="sga__ink" d="M156 106V44"/>' +
    '<path class="sga__fill" d="M156 46h32l-8 11 8 11h-32z"/>'),

  // Двое несут диван: головы, руки к сиденью и по две ноги. Ноги важны: с одной
  // человечек читается как сломанный значок, а не как грузчик.
  loaders: () => storyArt(
    '<circle class="sga__blob" cx="100" cy="72" r="54"/>' +
    '<rect class="sga__fill" x="66" y="64" width="68" height="34" rx="6"/>' +
    '<path class="sga__ink" d="M66 78h68"/>' +
    '<circle class="sga__ink" cx="36" cy="46" r="11"/>' +
    '<path class="sga__ink" d="M36 57v26M36 64l30 8M36 83l-9 26M36 83l9 26"/>' +
    '<circle class="sga__ink" cx="164" cy="46" r="11"/>' +
    '<path class="sga__ink" d="M164 57v26M164 64l-30 8M164 83l9 26M164 83l-9 26"/>'),

  // Часы: жёлтый круг, стрелки и риски по кругу.
  wait: () => storyArt(
    '<circle class="sga__fill" cx="100" cy="70" r="52"/>' +
    '<circle class="sga__ink" cx="100" cy="70" r="52"/>' +
    '<path class="sga__ink" d="M100 36v8M100 96v8M66 70h8M126 70h8"/>' +
    '<path class="sga__ink" d="M100 70V44M100 70l22 13"/>'),

  // Подъём к двери: дверь, ступени и коробка, которую вносят.
  door: () => storyArt(
    '<circle class="sga__blob" cx="104" cy="72" r="54"/>' +
    '<path class="sga__ink" d="M28 120h34v-16h34V88h34V72h34"/>' +
    '<rect class="sga__ink" x="130" y="24" width="44" height="48" rx="4"/>' +
    '<circle class="sga__ink" cx="138" cy="50" r="3"/>' +
    '<rect class="sga__fill" x="56" y="70" width="30" height="26" rx="4"/>' +
    '<path class="sga__ink" d="M56 78h30M71 70v26"/>'),
};

/* ─────────────────────────────────────────────────────── мелочи */

function digits(s) {
  return String(s || '').replace(/\D/g, '');
}

/* Расстояние с одним знаком после запятой: «12,4 км». Меньше километра
   показываем метрами — десятые доли там всё равно врут. */
function distText(m) {
  const v = Math.max(0, Number(m) || 0);
  if (v < 950) return Math.round(v / 10) * 10 + NBSP + 'м';
  return (v / 1000).toFixed(1).replace('.', ',') + NBSP + 'км';
}

/** Число в метрах из сантиметров базы: «3,0». Человек прикидывает диван в метрах. */
function metres(cm) {
  return (Math.max(0, Number(cm) || 0) / 100).toFixed(1).replace('.', ',');
}

/* Сколько увезёт голой цифрой: «300 кг», «3 т». Отдельно от «Максимум …»:
   в пояснительном экране та же величина стоит в другой фразе. */
function capPlain(tf) {
  const kg = Math.round(Number(tf && tf.capacity_kg) || 0);
  if (kg <= 0) return '';
  if (kg >= 1000) {
    const tons = Math.round(kg / 100) / 10;
    return t('car.t', { v: String(tons).replace('.', ',') });
  }
  return t('car.kg', { v: num(kg) });
}

/* То же самое строкой под картинкой машины: «Максимум 300 кг». */
function capText(tf) {
  const v = capPlain(tf);
  return v ? t('car.cap', { v }) : '';
}

/* Размеры кузова: длина × ширина × высота в метрах. */
function dimText(tf) {
  const raw = [tf && tf.body_d, tf && tf.body_w, tf && tf.body_h].map((v) => Number(v) || 0);
  if (raw.some((v) => v <= 0)) return '';
  return t('car.body', { v: raw.map(metres).join('×') });
}

/* Ярлык размера кузова для сегментов. Считаем по грузоподъёмности: админ волен
   назвать тариф как угодно, а S M L XL человек читает одинаково везде. */
const SIZE_STEPS = [[500, 'S'], [1500, 'M'], [3000, 'L'], [5000, 'XL']];

function sizeLabel(tf) {
  const kg = Number(tf && tf.capacity_kg) || 0;
  for (const [limit, label] of SIZE_STEPS) {
    if (kg <= limit) return label;
  }
  return 'XXL';
}

/** Ярлыки для всего списка машин. Две машины одного веса разводим цифрой,
    иначе в сегментах стояли бы две неотличимые буквы «M». */
function sizeLabels(list) {
  const used = new Map();
  return list.map((tf) => {
    const base = sizeLabel(tf);
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return n === 1 ? base : base + n;
  });
}

/** Подпись точки: первая — откуда, последняя — куда, между ними промежуточные. */
function pointLabel(i, total) {
  if (i === 0) return t('order.from');
  if (i === total - 1) return t('order.to');
  return t('order.point', { n: i + 1 });
}

function pointHint(i) {
  return i === 0 ? t('order.from_ph') : t('order.to_ph');
}

/* Этаж числом. «5а» и «5 этаж» считаем пятым этажом, пустое и «цоколь» — нулём:
   по этому числу решаем, советовать ли подъём к двери, и врать тут нельзя. */
function floorNum(value) {
  const m = String(value || '').trim().match(/^\d{1,3}/);
  return m ? Number(m[0]) : 0;
}

/* Цифра доезжает до нового значения за --dur-3, а не прыгает: скачок цены
   человек читает как ошибку расчёта. Промежуточные кадры округляем до сома —
   мелькающие тыйыны выглядят как рябь. */
function moneyBox(node) {
  let shown = null;             // что сейчас на экране, в тыйынах
  let target = null;
  let raf = 0;

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function jump(v) {
    shown = v;
    node.textContent = money(v);
  }

  return {
    set(value) {
      const next = Math.round(Number(value) || 0);
      if (target === next) {
        // Уже едем ровно туда же. Если счёт закончился, а текст в узле сменили
        // со стороны, ставим число обратно.
        if (!raf && shown !== next) jump(next);
        return;
      }
      target = next;
      const from = shown;
      stop();
      const time = dur('--dur-3', 380);
      if (from === null || from === next || time <= 20) {
        jump(next);
        return;
      }
      // Время берём сами, а не из аргумента кадра: его передаёт не всякая среда,
      // а без него счётчик посчитал бы NaN и показал бы его человеку.
      const started = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - started) / time);
        const eased = 1 - Math.pow(1 - k, 3);
        // Узел уже сняли с экрана — досчитывать некому и незачем.
        if (k >= 1 || !node.isConnected) {
          raf = 0;
          jump(next);
          return;
        }
        jump(Math.round((from + (next - from) * eased) / 100) * 100);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    /** Цены нет вовсе: показываем прочерк или ошибку и забываем прошлое число. */
    clear(text) {
      stop();
      shown = null;
      target = null;
      node.textContent = text;
    },
    stop,
  };
}

/* Поле с плавающей меткой. Метка идёт после поля — так её поднимает соседний
   селектор, без единой строчки скрипта. */
function field(label, value, opts = {}) {
  const props = {
    className: 'field__input',
    placeholder: ' ',
    value: value || '',
    inputmode: opts.inputmode || null,
    autocomplete: opts.autocomplete || 'off',
    enterkeyhint: opts.enterkeyhint || null,
    maxLength: opts.maxLength || 200,
  };
  // У textarea свойство type только для чтения — трогать его нельзя.
  if (!opts.multiline) props.type = opts.type || 'text';
  const input = el(opts.multiline ? 'textarea' : 'input', props);
  const node = el('label', { className: 'field' },
    input,
    el('span', { className: 'field__label' }, label),
    opts.hint ? el('span', { className: 'field__hint' }, opts.hint) : null,
  );
  return { node, input, get value() { return input.value.trim(); } };
}

/** Кнопка шага: жёлтая, во всю ширину, проседает под пальцем. */
function ctaButton(label, onClick, priceNode) {
  return pressable(el('button', { type: 'button', className: 'sg-cta', onClick },
    el('span', { className: 'sg-cta__label' }, label),
    priceNode || null), { scale: .98 });
}

/* ─────────────────────────────────────────────────────── экран */

export function mountOrder(app) {
  const tariffs = app.tariffs.filter((x) => x && x.id);
  const sizes = sizeLabels(tariffs);
  const sizeOf = (id) => {
    const i = tariffs.findIndex((x) => x.id === id);
    return i < 0 ? '' : sizes[i];
  };

  /* «Повторить заказ» из истории приносит готовую заготовку: те же адреса с
     подъездами, та же машина. Забираем её один раз — второй вызов вернёт null. */
  const draft = typeof app.takeDraft === 'function' ? app.takeDraft() : null;
  const draftList = (draft && Array.isArray(draft.points) ? draft.points : [])
    .filter((p) => p && p.lat != null && p.lng != null)
    .map((p) => Object.assign({}, p));
  const draftPoints = draftList.length >= 2 ? draftList : null;
  const draftTariff = draft && tariffs.some((x) => x.id === draft.tariffId) ? draft.tariffId : 0;

  /* Подъём к двери в прошлом заказе лежал среди допуслуг. Достаём его оттуда и
     убираем из набора: иначе он ушёл бы на сервер дважды — и строкой услуги,
     и своей позицией, а надбавка выросла бы на ровном месте. */
  const draftExtras = draft && draft.extras ? Object.assign({}, draft.extras) : {};
  const draftDoor = !!draftExtras[DOOR_CODE] ||
    draftList.some((p) => p && p.door_to_door);
  delete draftExtras[DOOR_CODE];

  const store = createStore({
    step: draftPoints ? 'tariff' : 'addr',
    points: draftPoints || [null, null],
    tariffId: draftTariff || (tariffs.length ? tariffs[0].id : 0),
    loaders: draft ? Math.max(0, Math.min(MAX_LOADERS, Number(draft.loaders) || 0)) : 0,
    door: draftDoor,            // один переключатель на весь заказ
    extras: draftExtras,        // код услуги → количество
    route: null,
    prices: {},                 // id тарифа → итог в тыйынах
    quotes: {},                 // id тарифа → полный расчёт сервера
    quote: null,
    // Надбавку за подъём к двери знаем ещё до первого расчёта — из /config.
    // Как придёт ответ сервера, цифру заменим на ту, по которой он считает.
    doorPrice: Math.max(0, Number(app.cfg && app.cfg.price && app.cfg.price.door_to_door) || 0),
    priceState: 'idle',         // idle | wait | ok | err
    priceError: null,
    busy: false,
  });

  const me = app.me();
  const contacts = {
    phone: me.phone || '', name: me.name || '',
    comment: (draft && draft.comment) || '', agree: true,
  };

  let view = null;              // {name, node, update}
  let bonusBox = null;          // переключатель списания бонусов на шаге подтверждения
  let markers = [];
  let line = null;
  let quoteTimer = 0;
  let quoteCtrl = null;
  let mapKey = '';
  let dead = false;
  const runningBoxes = new Set();   // счётчики цены, которые надо остановить на выходе

  /* Счётчик цены с учётом на выходе: досчитывать цифру в узле, которого уже нет
     на экране, незачем. Остановленный счётчик не ломается — он просто начнёт
     следующий отсчёт заново. */
  function newMoneyBox(node) {
    const box = moneyBox(node);
    runningBoxes.add(box);
    return box;
  }

  function stopBoxes() {
    for (const box of runningBoxes) box.stop();
    runningBoxes.clear();
  }

  /* ── данные ──────────────────────────────────────────────────────────── */

  const tariffById = (id) => tariffs.find((x) => x.id === id) || tariffs[0] || null;

  function filled(state) {
    return state.points.filter((p) => p && p.lat != null);
  }

  function coords(state) {
    return filled(state).map((p) => [p.lat, p.lng]);
  }

  function ready(state) {
    const pts = state.points;
    return pts.length >= 2 && pts[0] && pts[0].lat != null &&
      pts[pts.length - 1] && pts[pts.length - 1].lat != null;
  }

  function extrasList(state) {
    return Object.keys(state.extras)
      .map((code) => ({ code, qty: state.extras[code] }))
      .filter((x) => x.qty > 0);
  }

  /** Сколько точек оплачивается подъёмом к двери: включено — значит все. */
  function doorCount(state) {
    return state.door ? filled(state).length : 0;
  }

  /* Что уходит в поле extras запроса: выбранное из каталога плюс подъём к двери
     отдельной строкой. pricing.py ждёт его именно так — и в расчёте цены, и в
     самом заказе, где та же строка переживёт до закрытия. */
  function quoteExtras(state) {
    const list = extrasList(state);
    const doors = doorCount(state);
    if (doors > 0) list.push({ code: DOOR_CODE, qty: doors });
    return list;
  }

  /* Точки для расчёта — объектами, а не парами чисел. Сервер берёт километры
     только из объектов, пару [lat, lng] он до расчёта не пускает вовсе: на
     сорока километрах это триста сомов на кнопке против полутора тысяч в чеке.
     Флажок подъёма ставим у каждой точки, как и в самом заказе, — цену должны
     считать по одним и тем же данным, а не по двум разным. */
  function quotePoints(state) {
    return filled(state).map((p) => ({
      lat: p.lat, lng: p.lng, door_to_door: !!state.door,
    }));
  }

  function total(state) {
    const v = state.prices[state.tariffId];
    return typeof v === 'number' ? v : null;
  }

  /* ── карта ───────────────────────────────────────────────────────────── */

  function syncMap(state) {
    const pts = state.points;
    const key = pts.map((p) => (p ? p.lat.toFixed(5) + ',' + p.lng.toFixed(5) : '-')).join(';');
    if (key === mapKey) return;
    mapKey = key;

    for (const m of markers) m.remove();
    markers = [];
    const set = [];
    pts.forEach((p, i) => {
      if (!p || p.lat == null) return;
      const first = i === 0;
      markers.push(app.marker({
        at: [p.lat, p.lng],
        html: first ? pin('a') : pin('b', pts.length > 2 ? String(i + 1) : ''),
        anchor: first ? 'center' : 'bottom',
        zIndex: 10 + i,
      }));
      set.push([p.lat, p.lng]);
    });

    if (!set.length) {
      if (line) { line.remove(); line = null; }
      return;
    }
    if (set.length < 2 && line) { line.remove(); line = null; }
    app.fit(set, { maxZoom: set.length > 1 ? 16 : 15.5 });
  }

  function drawRoute(path) {
    if (!path || path.length < 2) return;
    if (line) line.setCoords(path);
    else line = app.route(path, { width: 6 });
    app.fit(path, { maxZoom: 16 });
  }

  /* ── цена ────────────────────────────────────────────────────────────── */

  /* Пересчёт с задержкой: пока палец жмёт сегменты грузчиков, сервер не трогаем.
     Начатый запрос сразу отменяем — его ответ уже про старые условия и, придя
     последним, показал бы неверную цену. */
  function schedulePrice() {
    clearTimeout(quoteTimer);
    if (quoteCtrl) {
      quoteCtrl.abort();
      quoteCtrl = null;
    }
    const state = store.get();
    if (!ready(state) || !tariffs.length) {
      store.set({ prices: {}, quotes: {}, quote: null, priceState: 'idle', priceError: null });
      return;
    }
    store.set({ priceState: 'wait' });
    quoteTimer = setTimeout(runPrice, QUOTE_PAUSE);
  }

  async function runPrice() {
    if (dead) return;
    if (quoteCtrl) quoteCtrl.abort();
    quoteCtrl = new AbortController();
    const mine = quoteCtrl;
    const state = store.get();
    const pts = coords(state);
    const body = {
      points: quotePoints(state),
      loaders: state.loaders,
      extras: quoteExtras(state),
      lang: getLang(),
    };

    // Линия маршрута нужна только карте: не получилась — цена всё равно посчитается.
    api.post('/geo/route', { points: pts }, { signal: mine.signal })
      .then((r) => {
        if (dead || mine !== quoteCtrl) return;
        store.set({ route: r });
        drawRoute(r.route);
      })
      .catch(() => {});

    const answers = await Promise.all(tariffs.map((tf) => api
      .post('/price/quote', Object.assign({ tariff_id: tf.id }, body), { signal: mine.signal })
      .then((r) => ({ id: tf.id, r }))
      .catch((e) => ({ id: tf.id, e }))));
    if (dead || mine !== quoteCtrl) return;

    const prices = {};
    const quotes = {};
    let fail = null;
    for (const a of answers) {
      if (a.r) {
        prices[a.id] = a.r.total;
        quotes[a.id] = a.r;
      } else if (a.e && a.e.code !== 'aborted') {
        fail = a.e;
      }
    }
    if (!Object.keys(prices).length) {
      store.set({ priceState: 'err', priceError: fail, quote: null });
      return;
    }

    // Надбавка за подъём к двери одна на все тарифы, но берём её из ответа:
    // на экране должна стоять та цифра, по которой сервер и посчитает заказ.
    let doorPrice = state.doorPrice;
    for (const id of Object.keys(quotes)) {
      const v = Number(quotes[id].door_price);
      if (isFinite(v) && v >= 0) {
        doorPrice = v;
        break;
      }
    }

    store.set({
      prices, quotes, quote: quotes[state.tariffId] || null, doorPrice,
      priceState: 'ok', priceError: null,
    });
  }

  /* Смена машины ничего не пересчитывает: цены всех машин приходят одним заходом,
     поэтому новая цифра стоит на экране в тот же кадр. Сервер зовём, только если
     этой машины в ответе не было. */
  function pickTariff(id) {
    const state = store.get();
    if (state.tariffId === id) return;
    const known = state.quotes[id];
    store.set({ tariffId: id, quote: known || null });
    if (!known) schedulePrice();
  }

  /* ── действия ────────────────────────────────────────────────────────── */

  async function choose(i) {
    const state = store.get();
    const point = await pickAddress(app, {
      title: pointLabel(i, state.points.length),
      placeholder: pointHint(i),
      value: state.points[i],
      near: app.map.getCenter(),
    });
    if (dead) return;
    // Шторку занимал поиск адреса, наш шаг из неё убрали — собираем заново.
    view = null;
    if (!point) {
      render(store.get(), true);
      return;
    }
    const pts = store.get().points.slice();
    // Точка уехала в другое место — подъезд и квартира от прошлого дома там уже
    // ничего не значат, и курьер по ним только заплутает. Кого встречать
    // оставляем: это про человека, а не про дом.
    const was = pts[i];
    const here = was && was.lat != null &&
      Math.abs(was.lat - point.lat) < 3e-4 && Math.abs(was.lng - point.lng) < 3e-4;
    pts[i] = here
      ? Object.assign({}, was, point)
      : Object.assign({}, point, {
        name: (was && was.name) || '', phone: (was && was.phone) || '',
      });
    // Оба конца маршрута известны — дальше собирать нечего, идём к машине.
    const full = ready({ points: pts });
    const step = store.get().step;
    store.set({ points: pts, step: full && step === 'addr' ? 'tariff' : step });
    schedulePrice();
  }

  function addPoint() {
    const pts = store.get().points.slice();
    if (pts.length >= app.maxPoints) {
      toast(t('order.max_points'), { type: 'info' });
      return;
    }
    pts.push(null);
    store.set({ points: pts });
    choose(pts.length - 1);
  }

  function removePoint(i) {
    const pts = store.get().points.slice();
    if (pts.length <= 2) return;
    pts.splice(i, 1);
    store.set({ points: pts });
    schedulePrice();
  }

  /* Детали адреса: подъезд, этаж, лифт, домофон и кто встретит. Ничего из этого
     не обязательно — шторка так и подписана. Сервер принимает их в самой точке,
     поэтому храним прямо в ней. */
  function openDetails(i) {
    const state = store.get();
    const p = state.points[i] || {};
    const entrance = field(t('order.entrance'), p.entrance, { maxLength: 16, inputmode: 'numeric' });
    const flat = field(t('order.flat'), p.flat, { maxLength: 16 });
    const floor = field(t('order.floor'), p.floor, { maxLength: 16, inputmode: 'numeric' });
    const intercom = field(t('order.intercom'), p.intercom, { maxLength: 32 });
    const comment = field(t('order.point_comment'), p.comment,
                          { multiline: true, maxLength: 300, hint: t('order.point_comment_ph') });
    const cname = field(t('order.contact_name'), p.name, { maxLength: 80, autocomplete: 'name' });
    const cphone = field(t('order.contact_phone'), p.phone,
                         { type: 'tel', inputmode: 'tel', maxLength: 32, autocomplete: 'tel' });

    /* Лифт — два чипа, а не переключатель: выключенный переключатель нельзя
       отличить от «не спрашивали», а по «без лифта» мы советуем подъём к двери. */
    let lift = p.lift === true ? true : (p.lift === false ? false : null);
    const liftYes = chip(t('order.has_lift'), { on: lift === true, size: 'lg' });
    const liftNo = chip(t('order.no_lift'), { on: lift === false, size: 'lg' });

    function paintLift() {
      liftYes.setOn(lift === true);
      liftNo.setOn(lift === false);
    }
    const setLift = (v) => {
      lift = lift === v ? null : v;      // повторный тап снимает выбор
      paintLift();
    };
    liftYes.addEventListener('click', () => setLift(true));
    liftNo.addEventListener('click', () => setLift(false));

    const rows = el('div', { className: 'sg-fields' },
      el('div', { className: 'sg-dgrid' }, entrance.node, flat.node, floor.node, intercom.node),
      el('div', { className: 'chips sg-lift' }, liftYes, liftNo),
      comment.node,
      el('div', { className: 'sg-group' }, t('order.contact')),
      cname.node,
      cphone.node,
    );

    const actions = [{
      label: t('common.save'),
      kind: 'primary',
      className: 'btn--lg btn--block',
      onClick: () => {
        const pts = store.get().points.slice();
        pts[i] = Object.assign({}, pts[i] || {}, {
          entrance: entrance.value, flat: flat.value, floor: floor.value,
          intercom: intercom.value, comment: comment.value, lift,
          name: cname.value, phone: cphone.value,
        });
        store.set({ points: pts });
        haptic(18);
      },
    }];
    if (store.get().points.length > 2) {
      actions.unshift({
        label: t('order.remove_point'),
        kind: 'danger',
        onClick: () => removePoint(i),
      });
    }

    sheet({
      title: t('order.details'),
      content: el('div', null,
        el('p', { className: 'sheet__text' }, p.addr || t('pts.no_addr')),
        rows),
      actions,
    });
  }

  /* ── пояснительные экраны ────────────────────────────────────────────── */

  /* Четыре вопроса, которые человек задаёт диспетчеру по телефону каждый раз.
     Отвечаем на них здесь, цифрами из текущего тарифа, а не общими словами. */
  function tellDelivery() {
    infoStory({
      title: t('st.delivery_t'),
      text: [t('st.delivery_1'), t('st.delivery_2'), t('st.delivery_3')],
      art: STORY_ART.delivery(),
      tone: 'cream',
    });
  }

  function tellLoaders() {
    const tf = tariffById(store.get().tariffId);
    const free = tf ? Number(tf.loaders_included) || 0 : 0;
    const hour = tf ? Number(tf.loader_hour_price) || 0 : 0;
    infoStory({
      title: t('st.loaders_t'),
      text: [
        t('st.loaders_1'),
        t('st.loaders_2'),
        free > 0 ? t('st.loaders_free', { n: tp(free, 'common.n_loader') }) : null,
        hour > 0 ? t('st.loaders_paid', { price: money(hour) }) : null,
      ].filter(Boolean),
      art: STORY_ART.loaders(),
      tone: 'mint',
    });
  }

  function tellBody() {
    const tf = tariffById(store.get().tariffId);
    if (!tf) return;
    const size = sizeOf(tf.id);
    const cap = capPlain(tf);
    const dims = [tf.body_d, tf.body_w, tf.body_h].map((v) => Number(v) || 0);
    infoStory({
      title: t('st.body_t', { v: size }),
      text: [
        nameOf(tf, 'desc'),
        dims.every((v) => v > 0)
          ? t('st.body_size', { d: metres(dims[0]), w: metres(dims[1]), h: metres(dims[2]) })
          : null,
        cap ? t('st.body_cap', { v: cap }) : null,
        t('st.body_tip'),
      ].filter(Boolean),
      art: vehicleArt(tf),
      className: 'sheet--car',
      tone: 'sky',
    });
  }

  function tellWaiting() {
    const tf = tariffById(store.get().tariffId);
    const free = tf ? Number(tf.waiting_free_min) || 0 : 0;
    const perMin = tf ? Number(tf.waiting_per_min) || 0 : 0;
    infoStory({
      title: t('st.wait_t'),
      text: [
        free > 0 ? t('st.wait_free', { n: free }) : null,
        perMin > 0 ? t('st.wait_paid', { price: money(perMin) }) : null,
        t('st.wait_tip'),
      ].filter(Boolean),
      art: STORY_ART.wait(),
      tone: 'peach',
    });
  }

  function tellDoor() {
    infoStory({
      title: t('st.d2d_t'),
      text: [t('st.d2d_1'), t('st.d2d_2')],
      art: STORY_ART.door(),
      tone: 'lilac',
    });
  }

  /* ── выбор машины списком ────────────────────────────────────────────── */

  /* Запасной путь для админа, который завёл больше шести тарифов: сегменты на
     360 px превратились бы в нечитаемые кружки, поэтому машины уходят в шторку
     полным списком — с названием, вместимостью и ценой. */
  function openCars() {
    const state = store.get();
    let box = null;
    const rows = tariffs.map((tf, i) => ({
      icon: vehicleArt(tf),
      hint: sizes[i],
      label: nameOf(tf),
      sub: capText(tf),
      value: typeof state.prices[tf.id] === 'number' ? money(state.prices[tf.id]) : '',
      className: tf.id === state.tariffId ? 'is-on' : '',
      onClick: () => {
        pickTariff(tf.id);
        if (box) box.close();
      },
    }));
    box = sheet({
      title: t('order.tariff_choose'),
      content: rowGroup(rows, { flat: true, className: 'sg-cars' }),
      actions: [{ label: t('common.close'), kind: 'ghost' }],
    });
  }

  /* Допуслуги: количественные со счётчиком, разовые переключателем.
     Итог внизу обновляется сам — подписка живёт ровно столько, сколько шторка. */
  function openExtras() {
    const list = el('div', { className: 'col' });
    const state0 = store.get();
    const fit = (e) => !Array.isArray(e.tariff_ids) || e.tariff_ids.indexOf(state0.tariffId) >= 0;
    const items = app.extras.filter(fit);

    if (!items.length) {
      list.appendChild(el('div', { className: 'empty' },
        el('div', { className: 'empty__title' }, t('order.extras_none'))));
    }

    for (const ex of items) {
      const unit = getLang() === 'ky' ? (ex.unit_ky || '') : (ex.unit_ru || '');
      const price = money(ex.price) + (unit ? ' / ' + unit : '');
      const text = el('div', { className: 'grow' },
        el('div', { className: 'sg-opt__title' }, nameOf(ex)),
        el('div', { className: 'sg-opt__sub' }, price));

      if (ex.kind === 'fixed') {
        const box = el('input', { type: 'checkbox', checked: !!store.get().extras[ex.code] });
        box.addEventListener('change', () => {
          const next = Object.assign({}, store.get().extras);
          if (box.checked) next[ex.code] = 1;
          else delete next[ex.code];
          store.set({ extras: next });
          schedulePrice();
          haptic();
        });
        /* Вся строка — метка тумблера. Сам тумблер 48×28, и попасть в него
           пальцем с первого раза удаётся не всем; строка целиком даёт те же
           56 px, что и у любой другой кнопки в сервисе. */
        const row = el('label', { className: 'sg-extra sg-extra--tap' }, text,
          el('span', { className: 'switch' }, box, el('span', { className: 'switch__track' })));
        list.appendChild(pressable(row, { scale: .995 }));
      } else {
        const step = Number(ex.step) > 0 ? Number(ex.step) : 1;
        const low = Number(ex.min_qty) > 0 ? Number(ex.min_qty) : 1;
        const high = Number(ex.max_qty) > 0 ? Number(ex.max_qty) : 20;
        const count = stepper({
          value: store.get().extras[ex.code] || 0,
          min: 0, max: high, step, lowest: low,
          onChange: (v) => {
            const next = Object.assign({}, store.get().extras);
            if (v > 0) next[ex.code] = v;
            else delete next[ex.code];
            store.set({ extras: next });
            schedulePrice();
          },
        });
        list.appendChild(el('div', { className: 'sg-extra' }, text,
          el('div', { className: 'none' }, count.node)));
      }
    }

    // Итог держим в подвале шторки: цена меняется на лету, и её должно быть видно,
    // не доскроллив список до конца. Пока считается — прежнее число гаснет, но стоит.
    const value = el('span', { className: 'sg-total__val' });
    const box = newMoneyBox(value);
    const sum = el('div', { className: 'sg-total' },
      el('span', { className: 'sg-total__name' }, t('order.price_total')), value);
    const paint = (s) => {
      const v = total(s);
      if (v === null) box.clear(s.priceState === 'err' ? t('common.error') : '—');
      else box.set(v);
      value.classList.toggle('is-stale', v !== null && s.priceState === 'wait');
    };
    paint(store.get());
    const off = store.on(paint);

    sheet({
      title: t('order.extras'),
      content: el('div', null,
        el('p', { className: 'sheet__text' }, t('order.extras_hint')), list),
      actions: [sum, { label: t('common.done'), kind: 'primary' }],
      onClose: () => {
        off();
        box.stop();
        runningBoxes.delete(box);
      },
    });
  }

  /* ── создание заказа ─────────────────────────────────────────────────── */

  async function submit(btn) {
    const state = store.get();
    if (!ready(state)) {
      toast(state.points[0] ? t('order.need_to') : t('order.need_from'), { type: 'err' });
      store.set({ step: 'addr' });
      return;
    }
    if (!state.tariffId) {
      toast(t('order.need_tariff'), { type: 'err' });
      return;
    }
    if (digits(contacts.phone).length < 9) {
      toast(t('order.need_phone'), { type: 'err' });
      store.set({ step: 'confirm' });
      return;
    }
    if (!contacts.agree) {
      toast(t('order.confirm_hint'), { type: 'info' });
      return;
    }

    store.set({ busy: true });
    if (btn) btn.disabled = true;
    try {
      const body = {
        phone: contacts.phone,
        name: contacts.name,
        tariff_id: state.tariffId,
        loaders: state.loaders,
        extras: quoteExtras(state),
        comment: contacts.comment,
        lang: getLang(),
        // Сколько списать бонусами. Сервер всё равно пересчитает по своему
        // потолку — здесь только просьба, а не решение.
        bonus_spend: bonusBox ? bonusBox.value() : 0,
        // Подъём к двери шлём и строкой в extras, и флажком у каждой точки:
        // по строке сервер считает надбавку, по флажку курьер видит, что
        // подниматься надо везде, а не угадывает.
        points: filled(state).map((p) => ({
          addr: p.addr || p.subtitle || '',
          lat: p.lat, lng: p.lng,
          entrance: p.entrance || '', flat: p.flat || '', floor: p.floor || '',
          intercom: p.intercom || '', comment: p.comment || '',
          name: p.name || '', phone: p.phone || '',
          door_to_door: !!state.door,
        })),
      };
      const res = await api.post('/orders', body);
      app.setMe({ phone: contacts.phone, name: contacts.name });
      app.saveOrder(res.public_id, res.track_token);
      for (const p of state.points) rememberPoint(p);
      haptic(24);
      if (res.payment && res.payment.url) {
        location.href = res.payment.url;     // заказ ждёт оплаты на стороне банка
        return;
      }
      app.go('/order/' + res.public_id, { t: res.track_token });
      return;
    } catch (e) {
      toast(errText(e), { type: 'err' });
      const code = e && e.code;
      if (code === 'point_outside' || code === 'same_points' ||
          code === 'few_points' || code === 'bad_point' || code === 'too_many_points') {
        store.set({ step: 'addr' });
      }
      if (code === 'bad_phone') store.set({ step: 'confirm' });
    } finally {
      store.set({ busy: false });
      if (btn) btn.disabled = false;
    }
  }

  /* ── счётчик ─────────────────────────────────────────────────────────── */

  /* Свой счётчик поверх классов components.css: у допуслуг бывает дробный шаг
     и своя нижняя граница, до которой прыгаем сразу с нуля. */
  function stepper(o) {
    let value = Number(o.value) || 0;
    const step = Number(o.step) || 1;
    const low = o.lowest === undefined ? step : Number(o.lowest);
    const min = Number(o.min) || 0;
    const max = Number(o.max) || 99;

    const show = el('span', { className: 'stepper__val' });
    // Подписи кнопок — сами знаки: скринридер прочитает «минус» и «плюс»,
    // и это ровно то, что делает кнопка.
    const minus = el('button', { type: 'button', className: 'stepper__btn' }, '−');
    const plus = el('button', { type: 'button', className: 'stepper__btn' }, '+');
    const node = el('div', { className: 'stepper' }, minus, show, plus);

    function paint() {
      show.textContent = String(Math.round(value * 10) / 10);
      minus.disabled = value <= min;
      plus.disabled = value >= max;
    }
    function set(v) {
      value = Math.max(min, Math.min(max, Math.round(v * 10) / 10));
      paint();
      haptic();
      if (o.onChange) o.onChange(value);
    }
    minus.addEventListener('click', () => set(value - (value <= low ? value - min : step)));
    plus.addEventListener('click', () => set(value < low ? low : value + step));
    paint();
    return { node, set, value: () => value };
  }

  /* ── карточка адресов ────────────────────────────────────────────────── */

  /** Крестик «убрать адрес»: значок без подписи, поэтому имя даём руками —
      иначе скринридер прочитает пустую кнопку. */
  function dropChip(i) {
    const node = chip('', {
      icon: icon('trash'), title: t('order.remove_point'),
      className: 'sg-det sg-det--x',
      onClick: (e) => { e.stopPropagation(); removePoint(i); },
    });
    node.setAttribute('aria-label', t('order.remove_point'));
    return node;
  }

  /* Список адресов одной карточкой с разделителями: у каждой строки справа
     «Детали», под адресом — то, что человек там уже уточнил. Пересобираем её
     только когда в ней правда что-то поменялось: иначе карточка моргала бы
     на каждый кадр пересчёта цены. */
  function addressCard() {
    const box = el('div', { className: 'sg-sect' });
    let key = '';

    function build(state) {
      const pts = state.points;
      const rows = pts.map((p, i) => {
        const has = !!(p && p.lat != null);
        const line = has ? detailsLine(p) : '';
        const tail = has
          ? chip(t('pts.details'), {
            className: 'sg-det' + (line ? ' chip--on' : ''),
            onClick: (e) => {
              e.stopPropagation();      // «Детали» открывают форму, а не поиск адреса
              openDetails(i);
            },
          })
          : (pts.length > 2 ? dropChip(i) : null);
        return {
          icon: i === 0 ? ART_FROM : ART_TO,
          hint: pointLabel(i, pts.length),
          label: has ? (p.addr || t('order.on_map')) : t('pts.no_addr'),
          sub: has ? (line || t('pts.fill')) : pointHint(i),
          className: 'sg-addr' + (has ? '' : ' is-empty'),
          onClick: () => choose(i),
          end: tail,
          // Пустой строке уголок нужен: он и говорит, что по ней нажимают.
          chevron: !tail,
        };
      });
      if (pts.length < app.maxPoints) {
        rows.push(el('div', { className: 'sg-addmore' },
          chip(t('pts.add'), { icon: icon('plus'), onClick: addPoint })));
      }
      box.replaceChildren(rowGroup(rows));
    }

    return {
      node: box,
      update(state) {
        const pts = state.points;
        const next = getLang() + '|' + pts.length + '|' + pts.map((p) => (p && p.lat != null
          ? p.lat.toFixed(5) + ',' + p.lng.toFixed(5) + '|' + (p.addr || '') + '|' + detailsLine(p)
          : '-')).join(';');
        if (next === key) return;
        key = next;
        build(state);
      },
    };
  }

  /* ── шаг «адреса» ────────────────────────────────────────────────────── */

  function stepAddr() {
    const card = addressCard();
    const next = ctaButton(t('common.continue'), () => store.set({ step: 'tariff' }));
    next.hidden = true;

    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t('order.title')),
          el('div', { className: 'sg-head__sub' }, t('order.subtitle')))),
      el('div', { className: 'sg-body' }, card.node),
      el('div', { className: 'sg-foot' }, next),
    );

    function update(state) {
      card.update(state);
      next.hidden = !ready(state);
      app.panel.refresh();
    }

    return { name: 'addr', node, update };
  }

  /* ── шаг «заказ»: машина, грузчики, подъём к двери, адреса ───────────── */

  function stepTariff() {
    const headTitle = el('div', { className: 'sg-head__title' });
    const headSub = el('div', { className: 'sg-head__sub' });

    // ── карточка машины: картинка и две спокойные строки под ней
    const art = el('div', { className: 'sg-car__art', 'aria-hidden': 'true' });
    const capLine = el('div', { className: 'sg-car__line' });
    const dimLine = el('div', { className: 'sg-car__line' });
    const carCard = el('div', { className: 'sg-car' }, art,
      el('div', { className: 'sg-car__cap' }, capLine, dimLine));

    // ── кузов: сегменты, пока машин не больше шести, иначе строка со списком
    const bySheet = tariffs.length > SEG_LIMIT;
    const sizeSeg = bySheet ? null : segmented(
      tariffs.map((tf, i) => ({ value: tf.id, label: sizes[i] })),
      { value: store.get().tariffId, label: t('car.size'), onChange: pickTariff });
    const carValue = el('span');

    // ── грузчики
    const loadersSub = el('span');
    const loadSeg = segmented(loaderItems(store.get().loaders), {
      value: store.get().loaders,
      label: t('order.loaders'),
      onChange: (v) => { store.set({ loaders: v }); schedulePrice(); },
    });

    // ── от двери до двери: один переключатель на весь заказ
    const doorSub = el('span');
    const doorPlus = el('span', { className: 'sg-plus' });
    const doorInput = el('input', { type: 'checkbox', 'aria-label': t('d2d.title') });
    doorInput.addEventListener('change', () => {
      store.set({ door: doorInput.checked });
      schedulePrice();
      haptic(16);
    });
    // Тумблер внутри метки: нажать можно всю строку, а не 44 px самого тумблера.
    const doorRow = el('label', { className: 'sg-row' },
      el('span', { className: 'rowgroup__main' },
        el('span', { className: 'rowgroup__label' }, t('d2d.title')),
        el('span', { className: 'rowgroup__sub' }, doorSub)),
      doorPlus,
      el('span', { className: 'switch' }, doorInput, el('span', { className: 'switch__track' })));
    pressable(doorRow, { scale: .995 });

    // Подсказка про этаж без лифта стоит под карточкой, а не строкой внутри неё:
    // спрятанная строка группы всё равно занимала бы свои шестьдесят пикселей.
    const doorTip = el('div', { className: 'sg-tipline', hidden: true });

    // ── чипы с пояснениями
    const bodyLabel = el('span');
    const chips = el('div', { className: 'chips' },
      chip(t('info.delivery'), { info: true, onClick: tellDelivery }),
      chip(t('info.loaders'), { info: true, onClick: tellLoaders }),
      chip(bodyLabel, { info: true, onClick: tellBody }),
      // Подпись у справочного чипа своя, не такая же, как у переключателя:
      // две одинаковые надписи «От двери до двери» на одном экране читаются как
      // две кнопки, хотя вторая всего лишь объясняет первую.
      chip(t('info.door'), { info: true, onClick: tellDoor }),
      chip(t('info.wait'), { info: true, onClick: tellWaiting }));

    const extrasVal = el('span');
    const options = rowGroup([
      bySheet
        ? { label: t('car.size'), value: carValue, onClick: openCars }
        : { label: t('car.size'), end: sizeSeg },
      { label: t('order.loaders'), sub: loadersSub, end: loadSeg },
      doorRow,
      /* Выбранные услуги перечисляем под названием, а не справа от него: на
         360 px «Дополнительные услуги» и перечисление делят одну строку так,
         что не помещается ни то ни другое. */
      { label: t('order.extras'), sub: extrasVal, onClick: openExtras, className: 'sg-optrow' },
      chips,
    ]);

    // ── маршрут: заголовок с расстоянием и временем, под ним карточка адресов
    const tripMeta = el('div', { className: 'sg-trip' });
    const card = addressCard();
    const trip = el('div', { className: 'sg-sect' },
      el('div', { className: 'sg-sect__head' },
        el('div', { className: 'sg-sect__title' }, t('trip.title')), tripMeta),
      card.node);

    // ── подвал
    const note = el('div', { className: 'sg-note' }, t('order.price_note'));
    const retry = el('button', {
      type: 'button', className: 'btn btn--ghost btn--block', hidden: true,
      onClick: () => schedulePrice(),
    }, t('common.retry'));
    const priceBox = el('span', { className: 'sg-cta__price' }, '—');
    const priceMoney = newMoneyBox(priceBox);
    const cta = ctaButton(t('order.submit'), () => go(), priceBox);

    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        pressable(iconBtn('back', 'sg-back', t('common.back'),
                          () => store.set({ step: 'addr' })), { scale: .9 }),
        el('div', { className: 'sg-head__text' }, headTitle, headSub)),
      el('div', { className: 'sg-body sg-body--gap' }, carCard, options, doorTip, trip),
      el('div', { className: 'sg-foot' }, retry, note, cta),
    );

    /* Шаг приезжает со сжатием, и бегунок переключателя, померенный в этот
       момент, встал бы мимо кнопки. Меряем ещё раз, когда шаг доехал. */
    setTimeout(() => {
      if (sizeSeg) sizeSeg.sync();
      loadSeg.sync();
    }, dur('--dur-2', 240) + 60);

    /* Телефон уже знаем — заказываем сразу, иначе уходим на шаг с контактами. */
    function go() {
      if (digits(contacts.phone).length >= 9 && contacts.name) submit(cta);
      else store.set({ step: 'confirm' });
    }

    let carKey = '';
    let routeKey = '';

    /* Машина сменилась — картинка приезжает заново, а не подменяется втихую:
       движение подтверждает, что нажатие сработало. */
    function paintCar(state) {
      const tf = tariffById(state.tariffId);
      if (!tf) return;
      const key = tf.id + '|' + getLang();
      if (key === carKey) return;
      carKey = key;

      art.innerHTML = vehicleArt(tf);
      art.classList.remove('is-in');
      void art.offsetWidth;              // фиксируем кадр, иначе анимация не перезапустится
      art.classList.add('is-in');

      headTitle.textContent = nameOf(tf);
      headSub.textContent = dimText(tf) || capText(tf);
      capLine.textContent = nameOf(tf, 'desc');
      dimLine.textContent = capText(tf);
      bodyLabel.textContent = t('info.body', { v: sizeOf(tf.id) });
      carValue.textContent = nameOf(tf) + ' · ' + sizeOf(tf.id);
      if (sizeSeg) sizeSeg.set(tf.id);
    }

    /* Расстояние, время с пробками и слово, объясняющее, почему дольше.
       Обещать двадцать минут в шесть вечера — враньё, за которое перед
       человеком отвечает курьер. */
    function paintTrip(state) {
      const r = state.route;
      const key = r ? [r.distance_m, r.duration_s, r.duration_traffic_s].join('|') : '';
      if (key === routeKey) return;
      routeKey = key;
      if (!r) {
        tripMeta.replaceChildren();
        return;
      }
      const free = Math.max(0, Number(r.duration_s) || 0);
      const jam = Math.max(free, Number(r.duration_traffic_s) || 0);
      const slower = jam - free >= JAM_STEP;
      if (slower) tripMeta.title = t('trip.free_time', { v: duration(free) });
      else tripMeta.removeAttribute('title');
      tripMeta.replaceChildren(
        el('span', { className: 'sg-trip__km' }, distText(r.distance_m)),
        el('span', { className: 'sg-trip__time' }, duration(jam)),
        el('span', { className: 'sg-trip__jam' + (slower ? '' : ' is-free') },
           slower ? t('trip.jam') : t('trip.free')));
    }

    function update(state) {
      paintCar(state);
      paintTrip(state);
      card.update(state);

      // Часть грузчиков у тарифа уже в цене — про них честно говорим отдельно.
      const tf = tariffById(state.tariffId);
      const free = tf ? Number(tf.loaders_included) || 0 : 0;
      if (state.loaders === 0) loadersSub.textContent = t('load.zero');
      else if (free >= state.loaders) loadersSub.textContent = t('order.loaders_included', { n: state.loaders });
      else loadersSub.textContent = tp(state.loaders, 'common.n_loader');
      loadSeg.set(state.loaders);

      // Подъём к двери: цифра рядом с тумблером — за все точки сразу, чтобы
      // человек видел настоящую надбавку, а не цену за один подъезд.
      const pts = Math.max(2, filled(state).length);
      const unit = Math.max(0, Number(state.doorPrice) || 0);
      const q = state.quote;
      // Включено — берём цифру из ответа сервера, но только пока он считал ровно
      // столько же точек: его прошлый ответ был про другой маршрут. Выключено —
      // показываем, во что подъём обойдётся, чтобы решать до нажатия, а не в чеке.
      const sum = state.door && q && typeof q.door_to_door === 'number' &&
        q.door_points === doorCount(state) ? q.door_to_door : unit * pts;
      doorInput.checked = state.door;
      doorSub.textContent = state.door
        ? (pts > 2 ? t('d2d.on_many') : t('d2d.on_two'))
        : t('d2d.off');
      doorPlus.textContent = sum > 0 ? '+' + money(sum) : '';
      doorPlus.classList.toggle('is-on', state.door);
      doorPlus.classList.toggle('is-stale', state.door && state.priceState === 'wait');

      // Пятый этаж пешком — это другая работа. Говорим об этом там, где человек
      // ещё может передумать, а не когда курьер уже во дворе.
      const walk = state.points.find((p) => p && p.lift === false && floorNum(p.floor) > 1);
      const advise = !state.door && !!walk;
      doorTip.hidden = !advise;
      if (advise) doorTip.textContent = t('d2d.lift', { v: floorNum(walk.floor) });

      const chosen = extrasList(state);
      extrasVal.textContent = chosen.length
        ? chosen.map((x) => {
          const ex = app.extras.find((e) => e.code === x.code);
          return ex ? nameOf(ex) : x.code;
        }).join(', ')
        : t('order.extras_none');

      const money0 = total(state);
      const wait = state.priceState === 'wait';
      const bad = state.priceState === 'err';
      if (money0 === null) priceMoney.clear(wait ? '' : '—');
      else priceMoney.set(money0);
      priceBox.classList.toggle('is-wait', money0 === null && wait);
      priceBox.classList.toggle('is-stale', money0 !== null && wait);
      note.textContent = bad ? errText(state.priceError) : t('order.price_note');
      note.classList.toggle('t-err', bad);
      retry.hidden = !bad;
      cta.disabled = money0 === null || state.busy;
      app.panel.refresh();
    }

    return { name: 'tariff', node, update };
  }

  /** Сегменты грузчиков: «Нет 1 2 3». Заготовка из истории могла привезти
      больше — тогда её значение тоже попадает в ряд, иначе оно молча пропало бы. */
  function loaderItems(current) {
    const top = Math.max(LOADER_SEGS, Math.min(MAX_LOADERS, Number(current) || 0));
    const out = [{ value: 0, label: t('load.none') }];
    for (let n = 1; n <= top; n++) out.push({ value: n, label: String(n) });
    return out;
  }

  /* ── шаг «контакты» ──────────────────────────────────────────────────── */

  function stepConfirm() {
    const phone = field(t('order.phone'), contacts.phone, {
      type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxLength: 32,
      hint: t('order.phone_hint'), enterkeyhint: 'next',
    });
    const name = field(t('order.name'), contacts.name, {
      autocomplete: 'name', maxLength: 80, hint: t('order.name_ph'),
    });
    const comment = field(t('order.comment'), contacts.comment, {
      multiline: true, maxLength: 500, hint: t('order.comment_ph'),
    });

    phone.input.addEventListener('input', () => { contacts.phone = phone.input.value; refreshCta(); });
    name.input.addEventListener('input', () => { contacts.name = name.input.value; });
    comment.input.addEventListener('input', () => { contacts.comment = comment.input.value; });

    const agree = pressable(el('button', {
      type: 'button', className: 'sg-agree' + (contacts.agree ? ' is-on' : ''),
      'aria-pressed': contacts.agree ? 'true' : 'false',
      onClick: () => {
        contacts.agree = !contacts.agree;
        agree.classList.toggle('is-on', contacts.agree);
        agree.setAttribute('aria-pressed', contacts.agree ? 'true' : 'false');
        refreshCta();
        haptic();
      },
    },
      el('span', { className: 'sg-agree__box', html: icon('check') }),
      el('span', { className: 'grow' }, t('order.confirm_hint'))), { scale: .99 });

    const priceBox = el('span', { className: 'sg-cta__price' }, '—');
    const priceMoney = newMoneyBox(priceBox);
    const cta = ctaButton(t('order.confirm'), () => submit(cta), priceBox);

    // Списание бонусов. Виджет живёт в профиле и сам ходит на сервер за тем,
    // сколько можно списать по этой сумме: доверять цифре с экрана нельзя.
    bonusBox = (app.bonus && typeof app.bonus.spend === 'function')
      ? app.bonus.spend({ onChange: () => { refreshCta(); app.panel.refresh(); } })
      : null;

    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        pressable(iconBtn('back', 'sg-back', t('common.back'),
                          () => store.set({ step: 'tariff' })), { scale: .9 }),
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t('order.confirm')))),
      el('div', { className: 'sg-body' },
        el('div', { className: 'sg-fields' }, phone.node, name.node, comment.node, agree),
        bonusBox ? bonusBox.node : null),
      el('div', { className: 'sg-foot' }, cta),
    );

    function refreshCta() {
      const state = store.get();
      const sum = total(state);
      cta.disabled = state.busy || sum === null ||
        digits(contacts.phone).length < 9 || !contacts.agree;
    }

    function update(state) {
      const sum = total(state);
      const wait = state.priceState === 'wait';
      if (sum === null) priceMoney.clear(wait ? '' : '—');
      else priceMoney.set(sum);
      priceBox.classList.toggle('is-wait', sum === null && wait);
      priceBox.classList.toggle('is-stale', sum !== null && wait);
      if (bonusBox && sum !== null) bonusBox.setTotal(sum);
      refreshCta();
      app.panel.refresh();
    }

    return { name: 'confirm', node, update };
  }

  /* ── сборка ──────────────────────────────────────────────────────────── */

  const BUILD = { addr: stepAddr, tariff: stepTariff, confirm: stepConfirm };
  const ORDER = ['addr', 'tariff', 'confirm'];

  function render(state, back) {
    if (!view || view.name !== state.step) {
      stopBoxes();                       // счётчики прошлого шага уходят вместе с ним
      if (bonusBox) { bonusBox.destroy(); bonusBox = null; }
      const next = (BUILD[state.step] || stepAddr)();
      next.update(state);
      app.panel.show(next.node, { back: !!back });
      view = next;
    } else {
      view.update(state);
    }
    syncMap(state);
  }

  /* Шаг назад анимируем в обратную сторону: движение подсказывает, куда человек
     идёт, не хуже стрелки в шапке. */
  store.on((state, prev) => {
    if (dead) return;
    render(state, ORDER.indexOf(state.step) < ORDER.indexOf(prev.step));
  });

  /* Подставляем адрес подачи по геолокации: без разрешения ничего не спрашиваем
     повторно и молча остаёмся с пустым полем. */
  function guessOrigin() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      if (dead) return;
      const state = store.get();
      const ll = [pos.coords.latitude, pos.coords.longitude];
      // Поиск адреса считает от этой точки расстояние до каждой подсказки.
      noteMyPlace(ll);
      if (state.points[0]) return;             // человек успел ввести адрес сам
      app.map.setView(ll, 16, { animate: true });
      try {
        const r = await api.post('/geo/reverse', { lat: ll[0], lng: ll[1] });
        if (dead || store.get().points[0]) return;
        const pts = store.get().points.slice();
        pts[0] = { addr: r.title || '', subtitle: r.subtitle || '', lat: ll[0], lng: ll[1] };
        store.set({ points: pts });
      } catch (e) {
        /* адрес не узнали — человек введёт его сам, это не повод шуметь */
      }
    }, () => {}, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  render(store.get(), false);
  // Заготовка из истории уже с адресами: считаем цену сразу, но где человек,
  // всё равно спрашиваем — без этого в поиске адреса не будет расстояний.
  if (draftPoints) schedulePrice();
  guessOrigin();

  return {
    relang() {
      view = null;
      render(store.get(), false);
    },
    destroy() {
      dead = true;
      clearTimeout(quoteTimer);
      if (quoteCtrl) quoteCtrl.abort();
      stopBoxes();
      if (app.cancelPick) app.cancelPick();
    },
  };
}

export default mountOrder;
