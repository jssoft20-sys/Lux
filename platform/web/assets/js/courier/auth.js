/* Аккаунт курьера: вход, регистрация, восстановление пароля, проверка
   документов и профиль.

   Разметка обеих форм входа лежит прямо в courier.html — так экран входа
   появляется мгновенно, ещё до того как браузер разберёт модули. Здесь только
   поведение: переключение вкладок, отправка, разбор ошибок и экран «заявка
   на проверке».

   Ошибки сервера показываем полем, а не общим тостом: человек должен видеть,
   в какой именно строке анкеты опечатка, а не гадать по красной плашке сверху.

   Проверка документов живёт здесь же по одной причине: это продолжение входа.
   Пока фото с паспортом не одобрили, аккаунт есть, а работы нет, и человеку
   нужно объяснить это ровно один раз и в одном месте.
*/

import { api, ApiError } from '../core/api.js';
import { t, extend, getLang, setLang, applyTo, tp, LANGS } from '../core/i18n.js';
import { el, toast, sheet, confirm as ask, haptic, spinner, photoViewer, mountStars } from '../core/ui.js';
import { money, num, phone as fmtPhone, plate as fmtPlate, initials } from '../core/fmt.js';
import { bindPlate, getTheme, applyTheme } from './work.js';

/* ─────────────────────────────────────────────────────── свои строки

   В общий словарь не лезем: lang.ru.js правят соседние модули. Здесь только
   то, что нужно этому экрану. Уже занятый ключ extend() не перетирает. */

extend({
  ru: {
    'app.title': 'Приложение для водителей',
    'app.sub': 'Заказы приходят со звуком, даже когда экран погас',
    'app.sub_size': 'Звук на новый заказ при погасшем экране · {size} МБ',
    'app.get': 'Скачать',
    'vfy.title': 'Проверка документов',
    'vfy.why_title': 'Зачем это нужно',
    'vfy.why': 'Клиент пускает вас в свой дом и отдаёт свои вещи. Мы должны знать, ' +
      'кто за рулём. Снимок видят только вы и администратор — клиенту он не показывается ' +
      'и никуда больше не уходит.',
    'vfy.how': 'Как снять',
    'vfy.sample': 'Так выглядит правильный снимок',
    'vfy.rule_face': 'Лицо видно целиком: без кепки, капюшона и тёмных очков',
    'vfy.rule_doc': 'Паспорт раскрыт на странице с фотографией',
    'vfy.rule_hold': 'Держите паспорт в руке рядом с лицом',
    'vfy.rule_light': 'Светло, без бликов, пальцы не закрывают буквы',
    'vfy.rule_sharp': 'Снимок резкий: имя и номер паспорта читаются',
    'vfy.shoot': 'Сделать фото',
    'vfy.gallery': 'Выбрать из галереи',
    'vfy.retake': 'Переснять',
    'vfy.preview': 'Проверьте снимок',
    'vfy.preview_hint': 'Всё читается? Тогда отправляем.',
    'vfy.send': 'Отправить на проверку',
    'vfy.size': '{w}×{h} точек, {kb} КБ',
    'vfy.sent': 'Фото ушло на проверку',
    'vfy.pending_title': 'Проверяем',
    'vfy.pending_text': 'Обычно это занимает до суток. Как только проверим, ' +
      'заказы начнут приходить — мы сообщим.',
    'vfy.approved_title': 'Проверка пройдена',
    'vfy.approved_text': 'Всё в порядке. Выходите на линию — заказы будут приходить.',
    'vfy.rejected_title': 'Проверка не пройдена',
    'vfy.rejected_text': 'Прочитайте замечание и пришлите новый снимок.',
    'vfy.note': 'Замечание проверяющего',
    'vfy.again': 'Отправить заново',
    'vfy.other': 'Прислать другой снимок',
    'vfy.refresh': 'Обновить статус',
    'vfy.your_photo': 'Ваш снимок',
    'vfy.open_photo': 'Открыть снимок',
    'vfy.bad_file': 'Это не похоже на фотографию. Снимите камерой или выберите из галереи',
    'vfy.too_big': 'Снимок слишком тяжёлый даже после сжатия. Попробуйте снять ещё раз',
    'vfy.locked_title': 'Заказы придут после проверки',
    'vfy.locked_text': 'Пока документы не проверены, выйти на линию нельзя. ' +
      'Это одна фотография и пара минут.',
    'vfy.go': 'Пройти проверку',
    'vfy.wait_go': 'Посмотреть, как идёт проверка',
    'vfy.to_shift': 'Перейти к смене',
    'vfy.status_none': 'Не пройдена',
    'vfy.status_pending': 'На проверке',
    'vfy.status_approved': 'Пройдена',
    'vfy.status_rejected': 'Отказ',

    'acc.photo': 'Фото профиля',
    'acc.photo_hint': 'Его видит клиент, когда вы едете к нему',
    'acc.photo_set': 'Поставить фото',
    'acc.photo_change': 'Сменить фото',
    'acc.photo_saved': 'Фото обновилось',
    'acc.email_fixed': 'Почта — это логин, её меняет только диспетчер',
    'acc.password_change': 'Сменить пароль',
    'acc.password_now': 'Текущий пароль',
    'acc.password_rule': 'Не короче восьми символов',
    'acc.sound': 'Звук заказа',
    'acc.sound_on': 'Сигнал и вибрация',
    'acc.sound_off': 'Заказ придёт молча',
    'acc.rating_hint': 'Рейтинг складывается из оценок клиентов. Чем он выше, ' +
      'тем чаще диспетчер предлагает вам заказы.',
    'acc.rating_count': 'Оценок',
    'acc.no_rating': 'Оценок пока нет',
    'acc.cancelled': 'Отказов',
    'acc.support_text': 'Позвоните диспетчеру — по будням с 9:00 до 20:00 отвечаем сразу.',
    'acc.no_phone': 'Телефон поддержки появится, когда его укажут в настройках сервиса',

    // Копии строк профиля из courier.html: модуль должен работать и сам по себе.
    // Занятые ключи extend() не перетирает, так что общая разметка всё равно главнее.
    'courier.me_since': 'На линии с {year} года',
    'courier.me_data': 'Мои данные',
    'courier.me_car': 'Машина',
    'courier.me_docs': 'Документы и проверка',
    'courier.me_rating': 'Рейтинг',
    'courier.me_lang': 'Язык',
    'courier.me_theme': 'Тема',
    'courier.me_support': 'Поддержка',
  },
  ky: {
    'app.title': 'Айдоочулар үчүн тиркеме',
    'app.sub': 'Экран өчүп турса да, заказдар үн менен келет',
    'app.sub_size': 'Экран өчсө да жаңы заказга үн · {size} МБ',
    'app.get': 'Жүктөө',
    'vfy.title': 'Документтерди текшерүү',
    'vfy.why_title': 'Бул эмне үчүн керек',
    'vfy.why': 'Кардар сизди үйүнө киргизип, буюмун ишенип берет. Ошондуктан рулда ' +
      'ким отурганын билишибиз керек. Сүрөттү сиз жана администратор гана көрөт — ' +
      'кардарга көрсөтүлбөйт, башка эч жакка кетпейт.',
    'vfy.how': 'Кантип тартуу керек',
    'vfy.sample': 'Туура сүрөт ушундай болот',
    'vfy.rule_face': 'Жүз толук көрүнсүн: кепкасыз, капюшонсуз, кара көз айнексиз',
    'vfy.rule_doc': 'Паспорт сүрөтү бар бетинен ачык турсун',
    'vfy.rule_hold': 'Паспортту колуңузда, жүзүңүздүн жанында кармаңыз',
    'vfy.rule_light': 'Жарык болсун, чагылышпасын, манжаңыз тамгаларды жаппасын',
    'vfy.rule_sharp': 'Сүрөт даана болсун: атыңыз жана паспорттун номери окулсун',
    'vfy.shoot': 'Сүрөткө тартуу',
    'vfy.gallery': 'Галереядан тандоо',
    'vfy.retake': 'Кайра тартуу',
    'vfy.preview': 'Сүрөттү карап чыгыңыз',
    'vfy.preview_hint': 'Баары окулуп турабы? Анда жөнөтөбүз.',
    'vfy.send': 'Текшерүүгө жөнөтүү',
    'vfy.size': '{w}×{h} чекит, {kb} КБ',
    'vfy.sent': 'Сүрөт текшерүүгө кетти',
    'vfy.pending_title': 'Текшерип жатабыз',
    'vfy.pending_text': 'Адатта бир суткага чейин созулат. Текшерип бүткөндө ' +
      'заказдар келе баштайт — кабар беребиз.',
    'vfy.approved_title': 'Текшерүүдөн өттүңүз',
    'vfy.approved_text': 'Баары жайында. Линияга чыгыңыз — заказдар келет.',
    'vfy.rejected_title': 'Текшерүүдөн өтпөдү',
    'vfy.rejected_text': 'Эскертүүнү окуп, жаңы сүрөт жөнөтүңүз.',
    'vfy.note': 'Текшергендин эскертүүсү',
    'vfy.again': 'Кайра жөнөтүү',
    'vfy.other': 'Башка сүрөт жөнөтүү',
    'vfy.refresh': 'Абалды жаңыртуу',
    'vfy.your_photo': 'Сиздин сүрөтүңүз',
    'vfy.open_photo': 'Сүрөттү ачуу',
    'vfy.bad_file': 'Бул сүрөткө окшобойт. Камера менен тартыңыз же галереядан тандаңыз',
    'vfy.too_big': 'Сүрөт кысылгандан кийин да оор. Кайра тартып көрүңүз',
    'vfy.locked_title': 'Заказдар текшерүүдөн кийин келет',
    'vfy.locked_text': 'Документтер текшерилмейинче линияга чыга албайсыз. ' +
      'Бул бир сүрөт жана эки мүнөт убакыт.',
    'vfy.go': 'Текшерүүдөн өтүү',
    'vfy.wait_go': 'Текшерүү кандай болуп жатканын көрүү',
    'vfy.to_shift': 'Сменага өтүү',
    'vfy.status_none': 'Өтө элек',
    'vfy.status_pending': 'Текшерүүдө',
    'vfy.status_approved': 'Өткөн',
    'vfy.status_rejected': 'Четке кагылган',

    'acc.photo': 'Профилдин сүрөтү',
    'acc.photo_hint': 'Сиз баратканда кардар ушул сүрөттү көрөт',
    'acc.photo_set': 'Сүрөт коюу',
    'acc.photo_change': 'Сүрөттү алмаштыруу',
    'acc.photo_saved': 'Сүрөт жаңырды',
    'acc.email_fixed': 'Почта — бул логин, аны диспетчер гана өзгөртөт',
    'acc.password_change': 'Сырсөздү алмаштыруу',
    'acc.password_now': 'Учурдагы сырсөз',
    'acc.password_rule': 'Сегиз белгиден кем эмес',
    'acc.sound': 'Заказдын үнү',
    'acc.sound_on': 'Сигнал жана дирилдөө',
    'acc.sound_off': 'Заказ үнсүз келет',
    'acc.rating_hint': 'Рейтинг кардарлардын бааларынан чыгат. Канчалык жогору болсо, ' +
      'диспетчер ошончолук көп заказ сунуштайт.',
    'acc.rating_count': 'Баалар',
    'acc.no_rating': 'Азырынча баа жок',
    'acc.cancelled': 'Баш тартуулар',
    'acc.support_text': 'Диспетчерге чалыңыз — иш күндөрү 9:00дөн 20:00гө чейин дароо жооп беребиз.',
    'acc.no_phone': 'Колдоо телефону сервистин жөндөөлөрүндө көрсөтүлгөндө чыгат',

    'courier.me_since': '{year}-жылдан бери линияда',
    'courier.me_data': 'Менин маалыматым',
    'courier.me_car': 'Унаа',
    'courier.me_docs': 'Документтер жана текшерүү',
    'courier.me_rating': 'Рейтинг',
    'courier.me_lang': 'Тил',
    'courier.me_theme': 'Тема',
    'courier.me_support': 'Колдоо',
  },
});

/* ─────────────────────────────────────────────────────── иконки и стили */

const ICON_OK =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M20 6.5 9.5 17 4 11.6"/></svg>';

/* Иконка из общего набора символов в courier.html. */
function ico(name, mod) {
  return '<svg class="ico' + (mod ? ' ico--' + mod : '') + '" aria-hidden="true">' +
    '<use href="#i-' + name + '"></use></svg>';
}

/* Колокольчик для строки со звуком: в общем наборе его нет, а лезть
   в чужую разметку ради одной иконки не стоит. */
const ICON_BELL =
  '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M18.1 9.6a6.1 6.1 0 1 0-12.2 0c0 5-2.2 6.5-2.2 6.5h16.6s-2.2-1.5-2.2-6.5z"/>' +
  '<path d="M13.8 19.4a2.1 2.1 0 0 1-3.6 0"/></svg>';

const ICON_BELL_OFF =
  '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M18.1 9.6a6.1 6.1 0 0 0-8.7-5.5"/>' +
  '<path d="M6 7.6a6.1 6.1 0 0 0-.1 2c0 5-2.2 6.5-2.2 6.5h13"/>' +
  '<path d="M13.8 19.4a2.1 2.1 0 0 1-3.6 0"/><path d="M4 4l16 16"/></svg>';

/* Схема правильного снимка. Именно схема, а не фотография: чужое лицо на
   образце смущает, а рисунок объясняет то же самое и весит сотню байт. */
const SAMPLE_SVG =
  '<svg class="vfy__pic" viewBox="0 0 240 168" role="img" focusable="false" aria-hidden="true">' +
  '<rect class="vfy__frame" x="8" y="8" width="224" height="152" rx="16"/>' +
  '<circle class="vfy__body" cx="82" cy="56" r="23"/>' +
  '<path class="vfy__body" d="M42 152C42 116 60 88 82 88s40 28 40 64"/>' +
  '<g transform="rotate(-6 174 94)">' +
  '<rect class="vfy__doc" x="136" y="64" width="76" height="60" rx="8"/>' +
  '<rect class="vfy__face" x="145" y="74" width="26" height="32" rx="4"/>' +
  '<path class="vfy__line" d="M180 80h22M180 90h22M180 100h13"/>' +
  '<path class="vfy__hand" d="M152 116v14M164 116v14M176 116v14"/>' +
  '</g>' +
  '<circle class="vfy__okdot" cx="204" cy="32" r="13"/>' +
  '<path class="vfy__oktick" d="m198 32 4.6 4.6L211 27.6"/>' +
  '</svg>';

/* Свои стили держим при себе: courier.css правит соседний модуль, и лезть
   туда за десятком правил — верный способ поймать конфликт. */
const OWN_CSS = `
.vfy { display: flex; flex-direction: column; gap: var(--sp-4); }

.vfy__pic {
  display: block;
  width: 100%;
  max-width: 320px;
  height: auto;
  margin: 0 auto;
}
.vfy__frame { fill: none; stroke: var(--line); stroke-width: 2; stroke-dasharray: 8 7; }
.vfy__body { fill: none; stroke: var(--muted); stroke-width: 3; stroke-linecap: round; }
.vfy__doc { fill: var(--surface-3); stroke: var(--accent); stroke-width: 2.4; }
.vfy__face { fill: none; stroke: var(--muted); stroke-width: 2.2; }
.vfy__line { fill: none; stroke: var(--muted-2); stroke-width: 3; stroke-linecap: round; }
.vfy__hand { fill: none; stroke: var(--muted); stroke-width: 5; stroke-linecap: round; }
.vfy__okdot { fill: var(--ok-soft); stroke: var(--ok); stroke-width: 2; }
.vfy__oktick { fill: none; stroke: var(--ok); stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }

/* Список требований к снимку: галочка слева, текст в две строки справа. */
.vfy__rules { display: flex; flex-direction: column; gap: var(--sp-2); }
.vfy__rule {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-sm);
  line-height: 1.35;
}
.vfy__rule > svg { flex: none; margin-top: 1px; color: var(--ok); }

/* Снимок перед отправкой. Высоту ограничиваем экраном, а не картинкой:
   вертикальное фото с телефона иначе уедет на два экрана вниз. */
.vfy__shot {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  overflow: hidden;
}
.vfy__shot img {
  display: block;
  width: 100%;
  max-height: 52dvh;
  object-fit: contain;
}
.vfy__shot:active { transform: scale(.99); }

/* Кнопки съёмки — столбиком: «Выбрать из галереи» рядом с «Сделать фото»
   на 360 px не помещается, а переносить текст в кнопке нельзя. */
.vfy__acts { display: grid; gap: var(--sp-2); }

.vfy__mark {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin: 0 auto var(--sp-2);
  border-radius: var(--r-full);
  background: var(--ok-soft);
  color: var(--ok);
}
.vfy__mark > svg { width: 28px; height: 28px; }
.vfy__mark--wait { background: var(--warn-soft); color: var(--warn); }
.vfy__mark--err { background: var(--err-soft); color: var(--err); }

/* Заблокированный переключатель смены: видно, что он есть, и видно,
   что нажимать его пока незачем. */
.shift__toggle:disabled { opacity: .5; }
.shift__toggle:disabled:active { transform: none; }


/* Полоса «поставьте приложение» на экране входа. Живёт здесь, а не в общем
   courier.css: её показывает только этот экран, и незачем таскать эти правила
   всем остальным. */
.gate__app {
  display: flex; align-items: center; gap: var(--sp-3);
  margin: 0 0 var(--sp-4); padding: var(--sp-3);
  border: 1px solid var(--line-soft); border-radius: var(--r-lg);
  background: var(--surface-2);
}
.gate__app-ico {
  flex: none; width: 44px; height: 44px; display: grid; place-items: center;
  border-radius: var(--r-md); background: var(--accent); color: var(--on-accent);
}
.gate__app-ico .ico { width: 26px; height: 26px; }
.gate__app-text { min-width: 0; flex: 1 1 auto; }
.gate__app-title { font-weight: 650; font-size: 15px; }
.gate__app-sub { color: var(--muted); font-size: 12.5px; line-height: 1.3; margin-top: 2px; }
.gate__app-btn { flex: none; min-height: 40px; padding-inline: var(--sp-4); }
@media (max-width: 380px) {
  .gate__app { flex-wrap: wrap; }
  .gate__app-btn { width: 100%; }
}
`;

let cssDone = false;

function ensureCss() {
  if (cssDone || !document.head) return;
  cssDone = true;
  document.head.appendChild(el('style', { id: 'sg-account-css', text: OWN_CSS }));
}

/* ─────────────────────────────────────────────────────── общее состояние */

const gate = document.getElementById('gate');
const forms = {
  login: document.getElementById('form-login'),
  register: document.getElementById('form-register'),
};
const tabs = Array.from(document.querySelectorAll('[data-gate-tab]'));

let authed = null;        // что вызвать, когда человек вошёл
let classesLoaded = false;

/* ─────────────────────────────────────────────────────── мелкие помощники */

function field(input) {
  return input && input.closest ? input.closest('.field') : null;
}

function clearErrors(form) {
  for (const f of form.querySelectorAll('.field--err')) f.classList.remove('field--err');
  const box = form.querySelector('.gate__err');
  if (box) {
    box.hidden = true;
    box.textContent = '';
  }
}

/* Показать ошибку: если сервер назвал поле — подсветить его и увести туда фокус. */
function showError(form, err) {
  const box = form.querySelector('.gate__err');
  const message = (err && err.message) || t('err.unknown');
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
  const name = err && err.field;
  const input = name ? form.querySelector('[name="' + name + '"]') : null;
  if (input) {
    const wrap = field(input);
    if (wrap) wrap.classList.add('field--err');
    input.focus({ preventScroll: false });
  }
  haptic([14, 60, 14]);
}

function values(form) {
  const out = {};
  for (const input of form.querySelectorAll('input, select, textarea')) {
    if (!input.name) continue;
    const raw = String(input.value || '').trim();
    if (raw) out[input.name] = raw;
  }
  return out;
}

/* Числа из анкеты приходят строками — приводим к целым, пустые выкидываем. */
function toInt(obj, keys) {
  for (const k of keys) {
    if (obj[k] === undefined) continue;
    const n = parseInt(obj[k], 10);
    if (isFinite(n) && n > 0) obj[k] = n;
    else delete obj[k];
  }
  return obj;
}

async function submitting(form, work) {
  const btn = form.querySelector('button[type="submit"]');
  if (btn && btn.classList.contains('is-loading')) return;
  clearErrors(form);
  spinner(btn, true);
  try {
    await work();
  } catch (e) {
    showError(form, e instanceof ApiError ? e : new ApiError('error', t('err.unknown')));
  } finally {
    spinner(btn, false);
  }
}

/* ─────────────────────────────────────────────────────── вкладки */

function openTab(name) {
  for (const tab of tabs) {
    const on = tab.dataset.gateTab === name;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  for (const key of Object.keys(forms)) {
    if (forms[key]) forms[key].hidden = key !== name;
  }
  if (name === 'register') loadClasses();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ─────────────────────────────────────────────────────── классы машин */

/* Список классов берём из живых тарифов: курьер, выбравший класс, под который
   нет ни одного тарифа, не получит ни одного заказа — и не поймёт почему. */
async function loadClasses() {
  const select = document.getElementById('reg-class');
  if (!select || classesLoaded) return;
  classesLoaded = true;
  let config;
  try {
    config = await api.get('/config', null, { auth: false });
  } catch (e) {
    classesLoaded = false;                 // сеть вернётся — попробуем ещё раз
    return;
  }
  const lang = getLang();
  const seen = new Map();
  for (const tariff of config.tariffs || []) {
    const code = tariff.vehicle_class;
    if (!code || seen.has(code)) continue;
    const name = (lang === 'ky' ? tariff.name_ky : tariff.name_ru) || code;
    const kg = tariff.capacity_kg ? ' · до ' + tariff.capacity_kg + ' ' + t('common.kg') : '';
    seen.set(code, name + kg);
  }
  if (!seen.size) return;
  const keep = select.value;
  select.replaceChildren(el('option', { value: '' }, t('order.tariff_choose')));
  for (const [code, label] of seen) select.appendChild(el('option', { value: code }, label));
  if (keep && seen.has(keep)) select.value = keep;
}

/* ─────────────────────────────────────────────────────── экраны-сообщения */

/* «Заявка принята» и «доступ закрыт» заменяют собой обе формы: отсюда
   человек всё равно никуда не пойдёт, пока с ним не свяжутся. */
function showNotice(title, text, extra) {
  const box = el('div', { className: 'gate__done' },
    el('div', { className: 'gate__done-mark', html: ICON_OK }),
    el('h2', { className: 'gate__title' }, title),
    el('p', { className: 'gate__sub' }, text),
    extra || null,
    el('button', {
      className: 'btn btn--ghost btn--block',
      type: 'button',
      style: { marginTop: 'var(--sp-4)' },
      onClick: () => location.reload(),
    }, t('courier.login')));

  const tabsBox = gate.querySelector('.gate__tabs');
  if (tabsBox) tabsBox.hidden = true;
  for (const key of Object.keys(forms)) {
    if (forms[key]) forms[key].hidden = true;
  }
  const old = gate.querySelector('.gate__done');
  if (old) old.remove();
  const foot = gate.querySelector('.gate__foot');
  gate.insertBefore(box, foot);
}

/* ─────────────────────────────────────────────────────── вход */

function bindLogin() {
  const form = forms.login;
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = values(form);
    if (!data.email) return showError(form, { message: t('err.bad_email'), field: 'email' });
    if (!data.password) return showError(form, { message: t('err.bad_password'), field: 'password' });

    submitting(form, async () => {
      const res = await api.post('/auth/login',
        { email: data.email, password: data.password }, { auth: false });
      api.setToken(res.token);
      form.reset();
      haptic(20);
      if (authed) authed(res.user);
    });
  });

  const forgot = document.getElementById('forgot');
  if (forgot) forgot.addEventListener('click', () => askEmail(form));
}

/* ─────────────────────────────────────────────────────── восстановление пароля */

function askEmail(loginForm) {
  const input = el('input', {
    className: 'field__input',
    type: 'email',
    inputMode: 'email',
    autocomplete: 'username',
    placeholder: ' ',
    value: (loginForm.querySelector('[name="email"]') || {}).value || '',
  });
  const wrap = el('label', { className: 'field' },
    input, el('span', { className: 'field__label' }, t('courier.email')));

  const box = sheet({
    title: t('courier.forgot_title'),
    content: el('div', { className: 'col gap-3' },
      el('p', { className: 'sheet__text' }, t('courier.forgot_hint')), wrap),
    actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      {
        label: t('common.send'),
        kind: 'primary',
        onClick: async () => {
          const email = String(input.value || '').trim();
          if (!email || email.indexOf('@') < 1) {
            toast(t('err.bad_email'), { type: 'err' });
            input.focus();
            return false;
          }
          const res = await api.post('/auth/password/forgot', { email }, { auth: false });
          toast(res.message || t('courier.forgot_sent'), { type: 'ok', ms: 5000 });
          return true;
        },
      },
    ],
  });
  setTimeout(() => input.focus(), 260);
  return box;
}

/* Ссылка из письма приходит как /courier?reset=токен. Проверяем её до того,
   как показать форму: человек не должен придумывать пароль ради «ссылка устарела». */
async function handleResetLink() {
  const params = new URLSearchParams(location.search);
  const token = (params.get('reset') || '').trim();
  if (!token) return false;

  // Токен из адресной строки убираем сразу: он одноразовый, но светиться
  // в истории браузера и в заголовке Referer ему всё равно незачем.
  try {
    const clean = location.pathname + location.hash;
    history.replaceState(history.state, '', clean);
  } catch (e) { /* встроенный браузер может запретить — не страшно */ }

  try {
    await api.get('/auth/password/check', { token }, { auth: false });
  } catch (e) {
    toast((e && e.message) || t('err.reset_expired'), { type: 'err', ms: 5000 });
    return false;
  }
  showResetForm(token);
  return true;
}

function showResetForm(token) {
  const input = el('input', {
    className: 'field__input',
    type: 'password',
    autocomplete: 'new-password',
    placeholder: ' ',
  });
  const wrap = el('label', { className: 'field' },
    input,
    el('span', { className: 'field__label' }, t('courier.password')),
    el('span', { className: 'field__hint' }, t('acc.password_rule')));

  sheet({
    title: t('courier.reset_title'),
    dismissible: false,
    content: wrap,
    actions: [{
      label: t('courier.reset_btn'),
      kind: 'primary',
      onClick: async () => {
        const password = String(input.value || '');
        if (password.length < 8) {
          toast(t('err.password_short'), { type: 'err' });
          input.focus();
          return false;
        }
        const res = await api.post('/auth/password/reset', { token, password }, { auth: false });
        if (res.token) {
          api.setToken(res.token);
          toast(res.message || t('common.saved'), { type: 'ok' });
          if (authed) authed(res.user);
        } else {
          toast(res.message || t('common.saved'), { type: 'ok', ms: 5000 });
        }
        return true;
      },
    }],
  });
  setTimeout(() => input.focus(), 260);
}

/* ─────────────────────────────────────────────────────── регистрация */

function bindRegister() {
  const form = forms.register;
  if (!form) return;

  // Госномер сразу приводим к виду, в котором он живёт в базе.
  bindPlate(form.querySelector('[name="car_plate"]'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = toInt(values(form), ['capacity_kg', 'body_w', 'body_d', 'body_h']);

    const need = [
      ['name', t('err.field_required')],
      ['email', t('err.bad_email')],
      ['phone', t('err.bad_phone')],
      ['password', t('err.bad_password')],
      ['vehicle_class', t('order.need_tariff')],
      ['car_model', t('err.field_required')],
      ['car_plate', t('err.field_required')],
      ['capacity_kg', t('err.field_required')],
    ];
    for (const [key, message] of need) {
      if (!data[key]) return showError(form, { message, field: key });
    }
    if (String(data.password).length < 8) {
      return showError(form, { message: t('err.password_short'), field: 'password' });
    }
    data.lang = getLang();

    submitting(form, async () => {
      const res = await api.post('/auth/register', data, { auth: false });
      form.reset();
      haptic([16, 70, 16]);
      if (res.token) {
        api.setToken(res.token);
        if (authed) authed(res.user);
        return;
      }
      showNotice(
        t('courier.pending_title'),
        res.message || t('courier.pending_text'),
        el('p', { className: 'gate__hint ta-c', style: { marginTop: 'var(--sp-2)' } },
          data.email),
      );
    });
  });
}

/* ─────────────────────────────────────────────────────── глаз у пароля */

function bindEyes() {
  for (const btn of document.querySelectorAll('[data-eye]')) {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.eye);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('is-on', show);
      btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
      input.focus();
    });
  }
}

/* ─────────────────────────────────────────────────────── язык */

function bindLang() {
  const buttons = Array.from(document.querySelectorAll('[data-lang]'));
  const paint = () => {
    const now = getLang();
    for (const b of buttons) b.classList.toggle('is-on', b.dataset.lang === now);
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      if (LANGS.indexOf(b.dataset.lang) < 0) return;
      setLang(b.dataset.lang);
      paint();
      classesLoaded = false;               // названия классов машин тоже переводятся
      if (forms.register && !forms.register.hidden) loadClasses();
      haptic();
    });
  }
  paint();
}

/* ═══════════════════════════════════════════════════════ снимок с телефона */

const PHOTO_SIDE = 1400;              // длинная сторона после сжатия
const PHOTO_Q = 0.82;                 // качество JPEG: буквы в паспорте ещё читаются
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;   // столько принимает сервер (uploads.py)

/* Скрытое поле выбора файла. capture='user' открывает фронтальную камеру —
   человеку надо снять себя с паспортом, а не наоборот. */
function fileInput(capture, onFile) {
  const input = el('input', { type: 'file', accept: 'image/*', hidden: true });
  if (capture) input.setAttribute('capture', capture);
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';        // тот же файл должны принять и во второй раз
    if (file) onFile(file);
  });
  return input;
}

/* Разбор файла в картинку. createImageBitmap сам разворачивает снимок по EXIF —
   иначе портрет с айфона приезжает лёжа. Старый Safari этой опции не знает,
   для него запасной путь через <img>. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) { /* опции нет — идём через <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ApiError('bad_photo', t('vfy.bad_file'), 0));
      img.src = url;
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Ужать снимок перед отправкой: длинная сторона до 1400 px, JPEG 0.82.
 * Без этого фото с телефона весит пять мегабайт и на мобильном интернете
 * до сервера просто не доезжает. Возвращает {url, w, h, bytes}.
 */
async function shrink(file) {
  const src = await decode(file);
  try {
    const w0 = src.width || src.naturalWidth || 0;
    const h0 = src.height || src.naturalHeight || 0;
    if (!w0 || !h0) throw new ApiError('bad_photo', t('vfy.bad_file'), 0);

    const k = Math.min(1, PHOTO_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));

    const canvas = el('canvas', { width: w, height: h });
    const g = canvas.getContext('2d');
    if (!g) throw new ApiError('bad_photo', t('vfy.bad_file'), 0);
    // Белая подложка: у PNG с прозрачностью иначе получится чёрное поле.
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, w, h);
    g.drawImage(src, 0, 0, w, h);

    let url = '';
    try {
      url = canvas.toDataURL('image/jpeg', PHOTO_Q);
    } catch (e) {
      throw new ApiError('bad_photo', t('vfy.bad_file'), 0);
    }
    if (url.indexOf('data:image/jpeg') !== 0) {
      throw new ApiError('bad_photo', t('vfy.bad_file'), 0);
    }
    const bytes = Math.round((url.length - url.indexOf(',') - 1) * 3 / 4);
    if (bytes > PHOTO_MAX_BYTES) throw new ApiError('photo_big', t('vfy.too_big'), 0);
    return { url, w, h, bytes };
  } finally {
    if (typeof src.close === 'function') src.close();
    if (src.src && src.src.indexOf('blob:') === 0) URL.revokeObjectURL(src.src);
  }
}

/* Две кнопки съёмки с уже вшитыми полями выбора файла. onShot получает
   ужатый снимок; пока идёт сжатие, на блоке лежит вуаль.
   Возвращает {node, label} — надпись на главной кнопке меняется по ходу дела:
   в первый раз это «Сделать фото», после отказа — «Отправить заново». */
function shootButtons(onShot) {
  const cam = fileInput('user', take);
  const lib = fileInput(null, take);

  const main = el('button', {
    className: 'btn btn--primary btn--lg btn--block',
    type: 'button',
    onClick: () => { haptic(); cam.click(); },
  }, t('vfy.shoot'));

  const node = el('div', { className: 'vfy__acts' },
    main,
    el('button', {
      className: 'btn btn--ghost btn--lg btn--block',
      type: 'button',
      onClick: () => { haptic(); lib.click(); },
    }, t('vfy.gallery')),
    cam, lib);

  async function take(file) {
    spinner(node, true);
    try {
      onShot(await shrink(file));
    } catch (e) {
      toast((e && e.message) || t('vfy.bad_file'), { type: 'err', ms: 5000 });
    } finally {
      spinner(node, false);
    }
  }

  return { node, label: (text) => { main.textContent = text; } };
}

/* ═══════════════════════════════════════════════════════ проверка документов */

const VERIFY_TITLES = {
  none: 'vfy.locked_title',
  pending: 'vfy.pending_title',
  approved: 'vfy.approved_title',
  rejected: 'vfy.rejected_title',
};

const VERIFY_TEXTS = {
  none: 'vfy.locked_text',
  pending: 'vfy.pending_text',
  approved: 'vfy.approved_text',
  rejected: 'vfy.rejected_text',
};

/** Короткое название состояния проверки — для строки в профиле. */
export function verifyName(status) {
  const key = 'vfy.status_' + statusOf(status);
  return t(key);
}

/* Ссылка на закрытое фото для тега <img>. Заголовок Authorization картинке
   не прицепишь, поэтому сервер разрешает прислать токен параметром — на этом
   маршруте он проверяет права на каждый запрос. */
function photoSrc(url) {
  const raw = String(url || '');
  if (!raw || raw.indexOf('token=') >= 0) return raw;
  const key = api.token();
  if (!key) return raw;
  return raw + (raw.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(key);
}

function statusOf(v) {
  const raw = typeof v === 'string' ? v : (v && v.status);
  const name = String(raw || 'none').toLowerCase();
  return VERIFY_TITLES[name] ? name : 'none';
}

/** Проверка пройдена? Пока состояние не пришло с сервера, считаем, что нет. */
export function verifyOk(v) {
  return !!(v && v.ok === true);
}

function rule(key) {
  return el('div', { className: 'vfy__rule' },
    el('span', { html: ico('check', 'sm') }), t(key));
}

/**
 * Экран проверки документов. Показывает, зачем это нужно, как снимать,
 * даёт снять и переснять, отправляет и следит за решением.
 * ctx = {store, go, setVerify}.
 */
export function renderVerify(root, ctx) {
  ensureCss();
  const box = el('div', { className: 'vfy' });
  root.replaceChildren(box);

  let shot = null;      // ужатый снимок, который ещё не ушёл на сервер
  let sending = false;

  const picker = shootButtons((next) => { shot = next; paint(); });

  /* Пустые места в списке узлов выкидываем сами: replaceChildren превратил бы
     null в строку «null» прямо посреди экрана. */
  function show(...kids) {
    box.replaceChildren(...kids.filter(Boolean));
    applyTo(box);
  }

  /* ── что сейчас показываем ─────────────────────────────────────────── */

  function paint() {
    const v = ctx.store.get().verify || {};
    const status = statusOf(v);
    if (shot) return paintShot();
    if (status === 'approved') return paintDone(v);
    if (status === 'pending') return paintWait(v);
    return paintIntro(v, status);
  }

  /* Первый заход и повторная попытка после отказа: объясняем и даём снять. */
  function paintIntro(v, status) {
    picker.label(status === 'rejected' ? t('vfy.again') : t('vfy.shoot'));
    show(
      status === 'rejected' ? noteCard(v) : null,

      el('section', { className: 'card' },
        el('h2', { className: 'card__title' }, t('vfy.why_title')),
        el('p', { className: 'muted t-sm', style: { marginTop: 'var(--sp-2)' } }, t('vfy.why'))),

      el('section', { className: 'card' },
        el('h2', { className: 'card__title' }, t('vfy.how')),
        el('p', { className: 'muted t-xs ta-c', style: { margin: 'var(--sp-3) 0' } },
          t('vfy.sample')),
        el('div', { html: SAMPLE_SVG }),
        el('div', { className: 'vfy__rules', style: { marginTop: 'var(--sp-4)' } },
          rule('vfy.rule_face'),
          rule('vfy.rule_doc'),
          rule('vfy.rule_hold'),
          rule('vfy.rule_light'),
          rule('vfy.rule_sharp'))),

      picker.node);
  }

  /* Снимок сделан: показываем, что получилось, и даём переснять. */
  function paintShot() {
    const kb = Math.max(1, Math.round(shot.bytes / 1024));
    show(
      el('section', { className: 'card' },
        el('h2', { className: 'card__title' }, t('vfy.preview')),
        el('p', { className: 'muted t-sm', style: { marginTop: 'var(--sp-2)' } },
          t('vfy.preview_hint'))),

      el('button', {
        className: 'vfy__shot',
        type: 'button',
        'aria-label': t('vfy.open_photo'),
        onClick: () => { haptic(); photoViewer(shot.url, { alt: t('vfy.your_photo') }); },
      }, el('img', { src: shot.url, alt: t('vfy.your_photo') })),

      el('p', { className: 'muted-2 t-xs ta-c' },
        t('vfy.size', { w: shot.w, h: shot.h, kb: num(kb) })),

      el('div', { className: 'vfy__acts' },
        el('button', {
          className: 'btn btn--primary btn--lg btn--block' + (sending ? ' is-loading' : ''),
          type: 'button',
          disabled: sending,
          onClick: send,
        }, t('vfy.send')),
        el('button', {
          className: 'btn btn--ghost btn--lg btn--block',
          type: 'button',
          disabled: sending,
          onClick: () => { haptic(); shot = null; paint(); },
        }, t('vfy.retake'))));
  }

  /* Фото ушло, решения ещё нет. */
  function paintWait(v) {
    picker.label(t('vfy.other'));
    show(
      el('section', { className: 'card ta-c' },
        el('div', { className: 'vfy__mark vfy__mark--wait', html: ico('shield') }),
        el('h2', { className: 'card__title' }, t('vfy.pending_title')),
        el('p', { className: 'muted t-sm', style: { marginTop: 'var(--sp-2)' } },
          t('vfy.pending_text'))),
      photoCard(v),
      el('button', {
        className: 'btn btn--ghost btn--lg btn--block',
        type: 'button',
        onClick: () => { haptic(); refresh(true); },
      }, t('vfy.refresh')),
      picker.node);
  }

  /* Проверка пройдена. */
  function paintDone(v) {
    show(
      el('section', { className: 'card ta-c' },
        el('div', { className: 'vfy__mark', html: ICON_OK }),
        el('h2', { className: 'card__title' }, t('vfy.approved_title')),
        el('p', { className: 'muted t-sm', style: { marginTop: 'var(--sp-2)' } },
          t('vfy.approved_text'))),
      photoCard(v),
      el('button', {
        className: 'btn btn--primary btn--lg btn--block',
        type: 'button',
        onClick: () => { haptic(); ctx.go('/shift'); },
      }, t('vfy.to_shift')));
  }

  /* Замечание администратора при отказе — первым делом и целиком. */
  function noteCard(v) {
    return el('section', { className: 'card' },
      el('div', { className: 'row gap-3 items-start' },
        el('span', { className: 'me__ico me__ico--danger', html: ico('shield') }),
        el('div', { className: 'grow' },
          el('h2', { className: 'card__title t-err' }, t('vfy.rejected_title')),
          el('p', { className: 'muted t-sm', style: { marginTop: '4px' } },
            t('vfy.rejected_text')))),
      v.note ? el('div', {
        className: 'card card--flat',
        style: { marginTop: 'var(--sp-3)' },
      }, el('div', { className: 'muted-2 t-xs upper' }, t('vfy.note')),
        el('p', { style: { marginTop: '4px' } }, v.note)) : null);
  }

  /* Уже отправленный снимок: открывается на весь экран по нажатию. */
  function photoCard(v) {
    if (!v.photo_url) return null;
    const src = photoSrc(v.photo_url);
    return el('button', {
      className: 'vfy__shot',
      type: 'button',
      'aria-label': t('vfy.open_photo'),
      onClick: () => { haptic(); photoViewer(src, { alt: t('vfy.your_photo') }); },
    }, el('img', { src, alt: t('vfy.your_photo'), loading: 'lazy' }));
  }

  /* ── отправка и обновление ─────────────────────────────────────────── */

  async function send() {
    if (!shot || sending) return;
    sending = true;
    paint();
    haptic(18);
    try {
      const res = await api.post('/courier/verify', { photo: shot.url });
      shot = null;
      ctx.setVerify(res);
      toast(t('vfy.sent'), { type: 'ok', ms: 5000 });
    } catch (e) {
      toast((e && e.message) || t('err.save_failed'), { type: 'err', ms: 6000 });
    } finally {
      sending = false;
      paint();
    }
  }

  /* loud=false — тихая догрузка при открытии экрана: статус мы уже знаем
     из общего состояния смены, и ругаться на сеть тут не за что. */
  async function refresh(loud) {
    try {
      ctx.setVerify(await api.get('/courier/verify'));
    } catch (e) {
      if (loud && (!(e instanceof ApiError) || !e.isAuth)) {
        toast((e && e.message) || t('err.load_failed'), { type: 'err' });
      }
    }
  }

  paint();
  // Свежее состояние с сервера: в нём есть ссылка на уже отправленный снимок,
  // которой в коротком ответе /courier/state нет.
  refresh(false);

  const off = ctx.store.select((s) => s.verify, () => paint());
  return () => off();
}

/**
 * Замок на переключателе смены. Пока проверка не пройдена, на линию выйти
 * нельзя — но остальной экран остаётся на месте: человек должен видеть,
 * что его ждёт, а не пустоту.
 */
export function lockShift(root, ctx) {
  const toggle = root.querySelector('.shift__toggle');
  const old = root.querySelector('.vfy-lock');
  if (old) old.remove();

  // Пока состояние проверки не пришло с сервера, ничего не запрещаем: показать
  // проверенному курьеру «вам нельзя на линию» хотя бы на секунду — обидно.
  const v = ctx.store.get().verify;
  if (!v || v.ok === true) {
    if (toggle) {
      toggle.disabled = false;
      toggle.removeAttribute('aria-disabled');
    }
    return;
  }
  ensureCss();
  if (toggle) {
    toggle.disabled = true;
    toggle.setAttribute('aria-disabled', 'true');
  }

  const status = statusOf(v);
  const pending = status === 'pending';
  const card = el('section', { className: 'card vfy-lock' },
    el('div', { className: 'row gap-3 items-start' },
      el('span', {
        className: 'me__ico ' + (pending ? 'me__ico--warn' : 'me__ico--danger'),
        html: ico('shield'),
      }),
      el('div', { className: 'grow' },
        el('h2', { className: 'card__title' }, t(VERIFY_TITLES[status])),
        el('p', { className: 'muted t-sm', style: { marginTop: '4px' } },
          t(VERIFY_TEXTS[status])))),
    status === 'rejected' && v && v.note
      ? el('p', { className: 't-err t-sm', style: { marginTop: 'var(--sp-3)' } }, v.note)
      : null,
    el('button', {
      className: 'btn btn--primary btn--block',
      type: 'button',
      style: { marginTop: 'var(--sp-4)' },
      onClick: () => { haptic(); ctx.go('/verify'); },
    }, pending ? t('vfy.wait_go') : t('vfy.go')));

  const shift = root.querySelector('.shift') || root;
  shift.insertBefore(card, shift.firstChild);
}

/* ═══════════════════════════════════════════════════════ звук предложения */

const SOUND_KEY = 'sg_sound';

/** Звонит ли телефон на новый заказ. По умолчанию — да: ради этого сигнала
 *  приложение и держат открытым. */
export function getSound() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch (e) {
    return true;        // хранилище закрыто — пусть лучше звенит
  }
}

export function setSound(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch (e) { /* переживём: настройка продержится до перезагрузки */ }
  return !!on;
}

/* ═══════════════════════════════════════════════════════ профиль */

function slotOf(node, name) {
  return node.querySelector('[data-slot="' + name + '"]');
}

function rowOf(node, name) {
  return node.querySelector('[data-row="' + name + '"]');
}

function put(node, name, value) {
  const target = slotOf(node, name);
  if (target) target.textContent = value == null ? '' : String(value);
  return target;
}

/* Аватар: фото поверх инициалов. Не загрузилось — остались буквы. */
function fillAvatar(node, user) {
  if (!node) return;
  node.replaceChildren(initials(user.name) || '·');
  if (user.avatar) {
    node.appendChild(el('img', { src: user.avatar, alt: '', decoding: 'async' }));
  }
}

function ratingText(value) {
  return String(value != null ? value : 5).replace('.', ',');
}

const THEME_NAMES = { dark: 'common.theme_dark', light: 'common.theme_light', auto: 'common.theme_auto' };

/**
 * Профиль: карточка водителя и список разделов. Разметка целиком лежит
 * в шаблоне #tpl-me внутри courier.html — здесь только заполнение слотов
 * и поведение строк. ctx = {store, go, setLang, refreshTheme, logout}.
 */
export function renderProfile(root, ctx) {
  ensureCss();
  const tpl = document.getElementById('tpl-me');
  if (!tpl || !tpl.content) {
    root.replaceChildren(el('div', { className: 'empty' },
      el('div', { className: 'empty__title' }, t('err.unknown'))));
    return () => {};
  }

  const node = tpl.content.firstElementChild.cloneNode(true);
  root.replaceChildren(node);

  const cam = fileInput('user', takeAvatar);
  const lib = fileInput(null, takeAvatar);
  node.appendChild(cam);
  node.appendChild(lib);

  /* ── заполнение ────────────────────────────────────────────────────── */

  function paint() {
    const state = ctx.store.get();
    const user = state.user || {};
    const profile = user.courier || {};
    const car = profile.car || {};
    const verify = state.verify;
    const rating = profile.rating != null ? profile.rating : 5;

    const ava = slotOf(node, 'avatar');
    fillAvatar(ava, user);

    put(node, 'name', user.name || '—');
    put(node, 'rating', ratingText(rating));
    put(node, 'orders', '· ' + tp(profile.orders_done || 0, 'common.n_order'));

    const stars = slotOf(node, 'stars');
    if (stars) mountStars(stars, { value: rating, readonly: true });

    const year = user.created_at
      ? new Date(user.created_at * 1000).getFullYear()
      : 0;
    put(node, 'since', year ? t('courier.me_since', { year }) : '');

    const badge = slotOf(node, 'verified');
    if (badge) badge.hidden = !verifyOk(verify);

    put(node, 'contacts', [user.phone ? fmtPhone(user.phone) : '', user.email]
      .filter(Boolean).join(' · '));
    put(node, 'car', [car.model, car.plate ? fmtPlate(car.plate) : '']
      .filter(Boolean).join(' · ') || '—');

    put(node, 'docs', '');
    put(node, 'docs_note', verify
      ? verifyName(verify) + (verify.status === 'rejected' && verify.note
        ? ' · ' + verify.note : '')
      : '');
    const docsIco = rowOf(node, 'docs') && rowOf(node, 'docs').querySelector('.me__ico');
    if (docsIco) {
      const status = verify ? statusOf(verify) : '';
      docsIco.className = 'me__ico' + (status === 'approved' ? ' me__ico--ok'
        : status === 'rejected' ? ' me__ico--danger'
          : status ? ' me__ico--warn' : '');
    }

    put(node, 'rating_v', ratingText(rating));
    put(node, 'rating_note', profile.rating_count
      ? t('acc.rating_count') + ': ' + num(profile.rating_count)
      : t('acc.no_rating'));

    put(node, 'lang', t(getLang() === 'ky' ? 'common.lang_ky' : 'common.lang_ru'));
    put(node, 'theme', t(THEME_NAMES[getTheme()] || THEME_NAMES.dark));

    paintSound();
    applyTo(node);
  }

  /* ── строка со звуком: её в шаблоне нет, добавляем своей рукой ─────── */

  const soundNote = el('span', { className: 'me__note' });
  const soundIco = el('span', { className: 'me__ico' });
  const soundInput = el('input', {
    type: 'checkbox',
    checked: getSound(),
    'aria-label': t('acc.sound'),
    onChange: () => {
      setSound(soundInput.checked);
      haptic();
      paintSound();
    },
  });
  const soundRow = el('label', { className: 'list__row me__item' },
    soundIco,
    el('span', { className: 'me__body' },
      el('span', { className: 'me__label' }, t('acc.sound')),
      soundNote),
    el('span', { className: 'switch' }, soundInput, el('span', { className: 'switch__track' })));

  function paintSound() {
    const on = soundInput.checked;
    soundIco.className = 'me__ico' + (on ? ' me__ico--accent' : '');
    soundIco.innerHTML = on ? ICON_BELL : ICON_BELL_OFF;
    soundNote.textContent = t(on ? 'acc.sound_on' : 'acc.sound_off');
  }

  const themeRow = rowOf(node, 'theme');
  if (themeRow && themeRow.parentNode) {
    themeRow.parentNode.insertBefore(soundRow, themeRow.nextSibling);
  }

  /* ── фото профиля ──────────────────────────────────────────────────── */

  async function takeAvatar(file) {
    const ava = slotOf(node, 'avatar');
    spinner(ava, true);
    try {
      const small = await shrink(file);
      const res = await api.post('/courier/photo', { photo: small.url });
      const user = ctx.store.get().user || {};
      ctx.store.set({ user: Object.assign({}, user, { avatar: res.url || res.avatar }) });
      toast(t('acc.photo_saved'), { type: 'ok' });
    } catch (e) {
      toast((e && e.message) || t('vfy.bad_file'), { type: 'err', ms: 5000 });
    } finally {
      spinner(ava, false);
    }
  }

  function askAvatar() {
    sheet({
      title: t('acc.photo'),
      content: el('p', { className: 'sheet__text' }, t('acc.photo_hint')),
      actions: [
        { label: t('vfy.shoot'), kind: 'ghost', onClick: () => cam.click() },
        { label: t('vfy.gallery'), kind: 'primary', onClick: () => lib.click() },
      ],
    });
  }

  const ava = slotOf(node, 'avatar');
  if (ava) {
    ava.setAttribute('role', 'button');
    ava.setAttribute('tabindex', '0');
    ava.setAttribute('aria-label', t('acc.photo'));
    const openAva = () => {
      haptic();
      const user = ctx.store.get().user || {};
      // Есть фото — показываем во весь экран, нет — сразу предлагаем поставить.
      if (user.avatar) photoViewer(user.avatar, { alt: user.name || t('acc.photo') });
      else askAvatar();
    };
    ava.addEventListener('click', openAva);
    ava.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openAva();
    });
  }

  /* ── строки списка ─────────────────────────────────────────────────── */

  const rows = {
    me: () => sheetMe(ctx, askAvatar),
    car: () => sheetCar(ctx),
    docs: () => ctx.go('/verify'),
    rating: () => sheetRating(ctx),
    lang: () => sheetLang(ctx),
    theme: () => sheetTheme(ctx),
    support: () => sheetSupport(ctx),
    logout: async () => {
      if (await ask({
        title: t('courier.logout_confirm'),
        ok: t('common.logout'),
        cancel: t('common.cancel'),
        danger: true,
      })) ctx.logout();
    },
  };
  for (const name of Object.keys(rows)) {
    const button = rowOf(node, name);
    if (button) button.addEventListener('click', () => { haptic(); rows[name](); });
  }

  paint();

  const offUser = ctx.store.select((s) => s.user, () => paint());
  const offVerify = ctx.store.select((s) => s.verify, () => paint());
  return () => { offUser(); offVerify(); };
}

/* ── правка данных ───────────────────────────────────────────────────── */

function textField(label, value, opts = {}) {
  const input = el('input', Object.assign({
    className: 'field__input', type: 'text', placeholder: ' ',
    value: value == null ? '' : String(value),
  }, opts.input || {}));
  const wrap = el('label', { className: 'field' },
    input, el('span', { className: 'field__label' }, label),
    opts.hint ? el('span', { className: 'field__hint' }, opts.hint) : null);
  return { input, wrap };
}

async function save(ctx, patch) {
  const res = await api.patch('/auth/me', patch);
  ctx.store.set({ user: res.user || res });
  toast(t('courier.profile_saved'), { type: 'ok' });
  return true;
}

/* Общий хвост всех форм: сохранить и не закрыть шторку, если сервер поспорил. */
function saveAction(work) {
  return {
    label: t('common.save'),
    kind: 'primary',
    onClick: async () => {
      try {
        return await work();
      } catch (e) {
        toast((e && e.message) || t('err.save_failed'), { type: 'err', ms: 5000 });
        return false;
      }
    },
  };
}

function sheetMe(ctx, onPhoto) {
  const user = ctx.store.get().user || {};
  const name = textField(t('courier.name'), user.name,
    { input: { autocomplete: 'name', maxLength: 80 } });
  const tel = textField(t('common.phone'), user.phone,
    { input: { type: 'tel', inputMode: 'tel', autocomplete: 'tel' }, hint: t('common.phone_ph') });

  const box = sheet({
    title: t('courier.me_data'),
    content: el('div', { className: 'col gap-3' },
      el('button', {
        className: 'btn btn--ghost btn--block',
        type: 'button',
        onClick: () => { box.close(); onPhoto(); },
      }, user.avatar ? t('acc.photo_change') : t('acc.photo_set')),
      name.wrap,
      tel.wrap,
      el('div', { className: 'card card--flat' },
        el('div', { className: 'muted-2 t-xs upper' }, t('common.email')),
        el('div', { className: 'truncate', style: { marginTop: '2px' } }, user.email || '—'),
        el('div', { className: 'muted-2 t-xs', style: { marginTop: '6px' } },
          t('acc.email_fixed'))),
      el('button', {
        className: 'btn btn--ghost btn--block',
        type: 'button',
        onClick: () => { box.close(); sheetPassword(); },
      }, t('acc.password_change'))),
    actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      saveAction(async () => {
        const patch = {
          name: String(name.input.value || '').trim(),
          phone: String(tel.input.value || '').trim(),
        };
        if (!patch.name) {
          toast(t('err.field_required'), { type: 'err' });
          return false;
        }
        return save(ctx, patch);
      }),
    ],
  });
  return box;
}

function sheetCar(ctx) {
  const profile = (ctx.store.get().user || {}).courier || {};
  const car = profile.car || {};
  const body = profile.body || {};

  const model = textField(t('courier.car_model'), car.model, { input: { maxLength: 60 } });
  const plate = textField(t('courier.car_plate'), car.plate, { input: { maxLength: 12 } });
  const color = textField(t('courier.car_color'), car.color, { input: { maxLength: 30 } });
  const cap = textField(t('courier.capacity'), profile.capacity_kg,
    { input: { type: 'number', inputMode: 'numeric', min: 1, max: 20000 } });
  const d = textField(t('courier.body_d'), body.d, { input: { type: 'number', inputMode: 'numeric' } });
  const w = textField(t('courier.body_w'), body.w, { input: { type: 'number', inputMode: 'numeric' } });
  const h = textField(t('courier.body_h'), body.h, { input: { type: 'number', inputMode: 'numeric' } });

  bindPlate(plate.input);

  sheet({
    title: t('courier.me_car'),
    content: el('div', { className: 'col gap-3' },
      model.wrap, plate.wrap, color.wrap, cap.wrap,
      el('div', { className: 'muted t-sm' }, t('courier.body')),
      el('div', { className: 'gate__trio' }, d.wrap, w.wrap, h.wrap)),
    actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      saveAction(async () => {
        const patch = {
          car_model: String(model.input.value || '').trim(),
          car_plate: String(plate.input.value || '').trim(),
          car_color: String(color.input.value || '').trim(),
        };
        for (const [key, ref] of [['capacity_kg', cap], ['body_d', d], ['body_w', w], ['body_h', h]]) {
          const n = parseInt(ref.input.value, 10);
          if (isFinite(n) && n > 0) patch[key] = n;
        }
        if (!patch.car_model || !patch.car_plate) {
          toast(t('err.field_required'), { type: 'err' });
          return false;
        }
        return save(ctx, patch);
      }),
    ],
  });
}

function sheetPassword() {
  const now = textField(t('acc.password_now'), '',
    { input: { type: 'password', autocomplete: 'current-password' } });
  const next = textField(t('courier.password'), '',
    { input: { type: 'password', autocomplete: 'new-password' }, hint: t('acc.password_rule') });

  sheet({
    title: t('acc.password_change'),
    content: el('div', { className: 'col gap-3' }, now.wrap, next.wrap),
    actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      saveAction(async () => {
        const password = String(next.input.value || '');
        if (password.length < 8) {
          toast(t('err.password_short'), { type: 'err' });
          return false;
        }
        await api.patch('/auth/me', {
          password, current_password: String(now.input.value || ''),
        });
        toast(t('courier.profile_saved'), { type: 'ok' });
        return true;
      }),
    ],
  });
}

/* ── рейтинг, язык, тема, поддержка ──────────────────────────────────── */

function kv(key, value) {
  return el('div', { className: 'me__kv' },
    el('span', { className: 'me__k' }, key),
    el('span', { className: 'me__v' }, value));
}

function sheetRating(ctx) {
  const profile = (ctx.store.get().user || {}).courier || {};
  const rating = profile.rating != null ? profile.rating : 5;
  const stars = el('div', { style: { margin: '0 auto' } });

  sheet({
    title: t('courier.me_rating'),
    content: el('div', { className: 'col gap-3' },
      el('div', { className: 'ta-c' },
        stars,
        el('div', { className: 'display', style: { marginTop: 'var(--sp-2)' } },
          ratingText(rating))),
      el('div', { className: 'list' },
        kv(t('acc.rating_count'), num(profile.rating_count || 0)),
        kv(t('courier.orders_done'), num(profile.orders_done || 0)),
        kv(t('acc.cancelled'), num(profile.orders_cancelled || 0)),
        kv(t('courier.acceptance'), profile.acceptance != null
          ? Math.round(profile.acceptance * 100) + '%' : '—'),
        kv(t('courier.balance'), money(profile.balance || 0))),
      el('p', { className: 'muted t-sm' }, t('acc.rating_hint'))),
    actions: [{ label: t('common.close'), kind: 'ghost' }],
  });
  mountStars(stars, { value: rating, readonly: true, size: 'lg' });
}

/* Список с точкой у выбранного пункта: одна форма на язык и на тему. */
function pickList(items, current, onPick) {
  const list = el('div', { className: 'list' });
  for (const [code, label] of items) {
    list.appendChild(el('button', {
      className: 'list__row list__row--tap me__item',
      type: 'button',
      onClick: () => onPick(code),
    },
      el('span', { className: 'me__body' }, el('span', { className: 'me__label' }, label)),
      code === current
        ? el('span', { className: 'me__ico me__ico--accent', html: ico('check', 'sm') })
        : null));
  }
  return list;
}

function sheetLang(ctx) {
  const box = sheet({
    title: t('courier.me_lang'),
    content: pickList([['ru', t('common.lang_ru')], ['ky', t('common.lang_ky')]],
      getLang(), (code) => { ctx.setLang(code); box.close(); }),
    actions: [{ label: t('common.close'), kind: 'ghost' }],
  });
}

function sheetTheme(ctx) {
  const items = [
    ['dark', t('common.theme_dark')],
    ['light', t('common.theme_light')],
    ['auto', t('common.theme_auto')],
  ];
  const box = sheet({
    title: t('courier.me_theme'),
    content: pickList(items, getTheme(), (code) => {
      applyTheme(code);
      haptic();
      box.close();
      // Тему трогает вся оболочка разом: карта и экран пересобираются целиком.
      ctx.refreshTheme();
    }),
    actions: [{ label: t('common.close'), kind: 'ghost' }],
  });
}

function sheetSupport(ctx) {
  const service = (ctx.store.get().config || {}).service || {};
  const raw = String(service.phone || '').trim();
  const digits = raw.replace(/[^\d+]/g, '');

  sheet({
    title: t('courier.me_support'),
    content: el('div', { className: 'col gap-3' },
      el('p', { className: 'sheet__text' }, t('acc.support_text')),
      raw
        ? el('div', { className: 'ta-c h2' }, fmtPhone(raw))
        : el('p', { className: 'muted t-sm' }, t('acc.no_phone'))),
    actions: digits ? [
      {
        label: t('common.whatsapp'),
        kind: 'ghost',
        onClick: () => window.open('https://wa.me/' + digits.replace(/\D/g, ''),
          '_blank', 'noopener'),
      },
      {
        label: t('common.call'),
        kind: 'primary',
        // Не открываем новую вкладку: приложение звонилки должно подхватить
        // переход в этом же окне, иначе на айфоне остаётся пустая страница.
        onClick: () => { location.href = 'tel:' + digits; },
      },
    ] : [{ label: t('common.close'), kind: 'ghost' }],
  });
}

/* ═══════════════════════════════════════════════════════ наружу */

/** Подготовить экран входа. onAuthed(user) вызывается, когда человек вошёл. */
/* ── приложение на телефон ─────────────────────────────────────────────────

   Водитель приходит на страницу входа с телефона. В браузере он потеряет
   заказ, как только свернёт вкладку: фоновой работы там нет. Поэтому прямо
   на входе предлагаем поставить приложение — оно держит связь, когда экран
   погас, и будит человека звуком на новый заказ.

   Показываем только там, где это имеет смысл: Android, обычный браузер.
   Внутри самого приложения и на айфоне полосы нет — на айфоне ставить нечего,
   там работает установка на домашний экран из веб-приложения. */

const APP_URL = '/app/sprintergo-courier.apk';
const APP_INFO = '/app/version.json';

function insideApp() {
  return / SprinterGoApp\//.test(navigator.userAgent || '');
}

function androidBrowser() {
  const ua = navigator.userAgent || '';
  if (!/Android/i.test(ua)) return false;
  if (insideApp()) return false;
  // Установленное веб-приложение — это уже «приложение», не пристаём.
  return !window.matchMedia('(display-mode: standalone)').matches;
}

function base() {
  return (window.SG_BASE || '/').replace(/\/$/, '');
}

async function appInfo() {
  try {
    const r = await fetch(base() + APP_INFO, { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.url ? d : null;
  } catch (e) {
    return null;                      // файла нет — значит приложение ещё не выложили
  }
}

async function mountAppBar() {
  if (!androidBrowser()) return;
  ensureCss();
  const info = await appInfo();
  if (!info) return;
  if (gate.querySelector('.gate__app')) return;

  const size = info.size ? Math.round(info.size / 1024 / 1024 * 10) / 10 : 0;
  const link = el('a', {
    className: 'btn btn--primary gate__app-btn',
    href: base() + (info.url || APP_URL),
    download: 'sprintergo-courier.apk',
    rel: 'noopener',
    onClick: () => haptic(16),
  }, t('app.get'));

  const bar = el('div', { className: 'gate__app' },
    el('div', { className: 'gate__app-ico', html: ico('van') }),
    el('div', { className: 'gate__app-text' },
      el('div', { className: 'gate__app-title' }, t('app.title')),
      el('div', { className: 'gate__app-sub' },
        size ? tp('app.sub_size', { size: String(size).replace('.', ',') }) : t('app.sub'))),
    link);

  const form = gate.querySelector('.gate__tabs');
  if (form && form.parentNode) form.parentNode.insertBefore(bar, form);
  else gate.appendChild(bar);
}

export function initGate(opts = {}) {
  authed = typeof opts.onAuthed === 'function' ? opts.onAuthed : null;

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      openTab(tab.dataset.gateTab);
      haptic();
    });
  }
  bindLogin();
  bindRegister();
  bindEyes();
  bindLang();
  applyTo(gate);
  handleResetLink();
  mountAppBar();          // молча ничего не сделает, если приложение ещё не выложено
  return { open: openTab };
}

/** Показать вход: после выхода из аккаунта и когда сессия протухла. */
export function showGate(message) {
  document.documentElement.dataset.screen = 'gate';
  const tabsBox = gate.querySelector('.gate__tabs');
  if (tabsBox) tabsBox.hidden = false;
  const done = gate.querySelector('.gate__done');
  if (done) done.remove();
  openTab('login');
  applyTo(gate);
  if (message) toast(message, { type: 'info', ms: 4000 });
}

/** Спрятать вход и отдать экран рабочему приложению. */
export function hideGate() {
  document.documentElement.dataset.screen = 'app';
}

/** Человек прошёл модерацию не до конца — показываем, что его ждёт. */
export function showStatusNotice(status, message) {
  document.documentElement.dataset.screen = 'gate';
  if (status === 'blocked') {
    showNotice(t('courier.blocked_title'), message || t('courier.blocked_text'));
  } else {
    showNotice(t('courier.pending_title'), message || t('courier.pending_text'));
  }
}

export default {
  initGate, showGate, hideGate, showStatusNotice,
  renderVerify, renderProfile, lockShift,
  verifyOk, verifyName, getSound, setSound,
};
