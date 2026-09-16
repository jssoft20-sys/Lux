/* Экран оплаты брони: QR Оптима Банка, автопроверка и переход дальше.

   Клиент платит вперёд только комиссию сервиса — это бронь. Остальное он отдаёт
   курьеру наличными, и об этом на экране написано первой же строкой: человек не
   должен гадать, почему с заказа на полторы тысячи просят полторы сотни.

   Как это работает:

     1. POST /pay/{pid}/qr  — сервер выпускает код в банке и отдаёт готовую
        картинку PNG в base64. Логотип в середину кладём вёрсткой поверх — сама
        картинка остаётся банковской, её же и сохраняет кнопка «Сохранить код».
     2. Дальше экран ждёт сам. Раз в три секунды опрашивает GET /pay/{pid}/status
        и одновременно слушает поток событий заказа: что придёт первым, то и
        сработает. Никаких «нажмите, если оплатили» — это вранью открытая дверь.
     3. Деньги пришли — галочка рисуется линией, лёгкая вибрация, и через
        полторы секунды экран отдаёт управление хозяину: дальше поиск машины.

   Экран не залипает ни в одном состоянии. Банк молчит, платёж отклонён, код
   протух, оплата вовсе выключена — у каждого случая свой понятный текст и живая
   кнопка: выпустить новый код, попробовать ещё раз, позвонить нам или отменить
   заказ. Человек с вещами на улице не должен упираться в мёртвый экран.

   Как подключить (экран сам ничего не переключает, он только сообщает):

     import { createPayStep } from './pay.js';
     const step = createPayStep(app, {
       pid, token,
       order,              // необязательно: чтобы сразу показать суммы
       subscribe,          // необязательно: (fn) => отписка, чужой поток заказа
       onPaid()   { ... }  // деньги пришли, можно показывать поиск машины
       onSkip()   { ... }  // платить нечего: оплата выключена или заказ закрыт
       onCancel() { ... }  // человек хочет отменить заказ
       onDone(reason, qr)  // необязательно: один обработчик вместо трёх
     });
     // step = {name, node, mount(), update(order), relang(), destroy()}

   Кнопка «Отменить заказ» появляется, только если дали onCancel: отменять заказ
   у нас умеет экран отслеживания, со своим вопросом и причиной. Если хозяин не
   дал ни одного обработчика, экран уходит на страницу заказа сам.

   Шаг сам замечает, что его сняли с панели, и в этот момент останавливает опрос
   и закрывает поток: звать destroy() хозяину не обязательно, но можно.

   Или целым экраном, как mountTrack: mountPay(app, pid, token, opts).

   Никаких зависимостей: только ядро, ES-модуль и руки.
*/

import { api } from '../core/api.js';
import { t, getLang, extend } from '../core/i18n.js';
import { el, toast, haptic } from '../core/ui.js';
import { money } from '../core/fmt.js';
import { icon, errText } from './app.js';

/* Свои строки: общий словарь правят соседние модули, лезть туда незачем.
   Кыргызский — как говорят в Бишкеке, а не как переводит машина. */
extend({
  ru: {
    'pay.title': 'Оплата брони',
    'pay.lead': 'Платите только бронь {sum} — остальное отдадите курьеру наличными',
    'pay.lead_short': 'Это бронь. Остальное — курьеру наличными',
    'pay.scan': 'Отсканируйте в приложении банка',
    'pay.making': 'Готовим код',
    'pay.rest': 'Курьеру наличными — {sum}',
    'pay.total': 'Весь заказ — {sum}',
    'pay.left': 'Код действует ещё {time}',
    'pay.open_bank': 'Открыть в приложении банка',
    'pay.save': 'Сохранить код',
    'pay.saved': 'Код сохранён',
    'pay.save_fail': 'Не получилось сохранить — сделайте снимок экрана',
    'pay.checking': 'Проверяем оплату',
    'pay.wait_note': 'Как оплатите, экран сам пойдёт дальше',
    'pay.done_title': 'Оплата прошла',
    'pay.done_text': 'Начинаем искать машину',
    'pay.offline': 'Связи нет. Проверим оплату, как только она появится',
    'pay.expired_title': 'Код устарел',
    'pay.expired_text': 'Прошло десять минут. Выпустим новый — старым больше не платите.',
    'pay.refresh': 'Выпустить новый код',
    'pay.declined_title': 'Оплата не прошла',
    'pay.declined_text': 'Банк не принял платёж. Если деньги списались, они вернутся сами.',
    'pay.bank_title': 'Банк не отвечает',
    'pay.bank_text': 'Попробуйте ещё раз через минуту или позвоните нам.',
    'pay.net_title': 'Связь пропала',
    'pay.net_text': 'Проверьте интернет и попробуйте ещё раз — заказ никуда не денется.',
    'pay.retry': 'Попробовать ещё раз',
    'pay.off_title': 'Платить сейчас не нужно',
    'pay.off_text': 'Рассчитаетесь с курьером на месте.',
    'pay.closed_title': 'Заказ уже закрыт',
    'pay.closed_text': 'Платить по нему нечего.',
    'pay.go_on': 'Продолжить',
    'pay.call': 'Позвонить в поддержку',
    'pay.cancel': 'Отменить заказ',
    'pay.qr_alt': 'QR-код для оплаты брони',
  },
  ky: {
    'pay.title': 'Бронду төлөө',
    'pay.lead': 'Бир гана {sum} бронь төлөйсүз — калганын курьерге накталай бересиз',
    'pay.lead_short': 'Бул бронь. Калганы — курьерге накталай',
    'pay.scan': 'Банкыңыздын тиркемесинен сканерлеңиз',
    'pay.making': 'Код даярдалып жатат',
    'pay.rest': 'Курьерге накталай — {sum}',
    'pay.total': 'Заказдын толук баасы — {sum}',
    'pay.left': 'Код дагы {time} иштейт',
    'pay.open_bank': 'Банк тиркемесинде ачуу',
    'pay.save': 'Кодду сактоо',
    'pay.saved': 'Код сакталды',
    'pay.save_fail': 'Сактай албадык — экранга сүрөт тартып алыңыз',
    'pay.checking': 'Төлөмдү текшерип жатабыз',
    'pay.wait_note': 'Төлөп бүтөрүңүз менен экран өзү андан ары өтөт',
    'pay.done_title': 'Төлөм өттү',
    'pay.done_text': 'Унаа издеп баштадык',
    'pay.offline': 'Байланыш жок. Кайра пайда болгондо төлөмдү текшеребиз',
    'pay.expired_title': 'Коддун убактысы бүттү',
    'pay.expired_text': 'Он мүнөт өттү. Жаңысын чыгарабыз — эскиси менен төлөбөңүз.',
    'pay.refresh': 'Жаңы код чыгаруу',
    'pay.declined_title': 'Төлөм өтпөй калды',
    'pay.declined_text': 'Банк төлөмдү кабыл алган жок. Акча алынып калса, өзү кайтат.',
    'pay.bank_title': 'Банк жооп бербей жатат',
    'pay.bank_text': 'Бир мүнөттөн кийин кайра аракет кылыңыз же бизге чалыңыз.',
    'pay.net_title': 'Байланыш үзүлдү',
    'pay.net_text': 'Интернетти текшерип, кайра аракет кылыңыз — заказ жоголбойт.',
    'pay.retry': 'Кайра аракет кылуу',
    'pay.off_title': 'Азыр төлөөнүн кереги жок',
    'pay.off_text': 'Курьер менен ордунда эсептешесиз.',
    'pay.closed_title': 'Заказ жабылып калган',
    'pay.closed_text': 'Ага төлөй турган эч нерсе жок.',
    'pay.go_on': 'Улантуу',
    'pay.call': 'Колдоо кызматына чалуу',
    'pay.cancel': 'Заказды жокко чыгаруу',
    'pay.qr_alt': 'Бронду төлөө үчүн QR-код',
  },
});

/* ─────────────────────────────────────────────────────── постоянные */

const WAIT_LIMIT_S = 600;      // десять минут ожидания, дальше предлагаем новый код
const POLL_MIN_S = 3;          // чаще сервер и не ответит: у него свой предел в 2 с
const POLL_GAP_MS = 2400;      // страховка от двух опросов подряд после пробуждения
const DONE_DELAY_MS = 1500;    // столько держим галочку, прежде чем уйти дальше
const NET_QUIET = 3;           // столько неудач молчим: короткий провал связи не новость
const TICK_MS = 1000;
const SHOW_GRACE_MS = 10000;   // столько ждём, пока хозяин покажет собранный шаг

/* Заказы, по которым платить уже нечего. */
const CLOSED = ['cancelled', 'done', 'expired'];

/* Состояния экрана. Классом is-<состояние> на корне живёт вся их вёрстка. */
const PHASES = ['issue', 'wait', 'paid', 'expired', 'declined', 'bank', 'net', 'off', 'closed'];

/* Знак Sprinter Go в середину кода. Рисуем разметкой, а не картинкой из папки:
   сервис умеют вешать в подпапку /go/, и путь к файлу там другой — а знак должен
   встать в центр кода при любой установке. Мельче пятой части стороны, в белом
   поле: код после этого читается всеми сканерами, мы проверяли на своих. */
const LOGO_SVG =
  '<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false">' +
  '<rect width="512" height="512" rx="116" fill="#FFDF00"/>' +
  '<g fill="#16150F">' +
  '<path d="M96 196a24 24 0 0 1 24-24h150a24 24 0 0 1 24 24v130H96z"/>' +
  '<path d="M310 216h58a24 24 0 0 1 19.6 10.2l32 45.6A24 24 0 0 1 424 286v40h-114z"/>' +
  '<rect x="326" y="232" width="56" height="38" rx="8" fill="#FFDF00"/>' +
  '<rect x="96" y="326" width="328" height="20" rx="10"/>' +
  '<circle cx="172" cy="352" r="40"/><circle cx="368" cy="352" r="40"/>' +
  '</g><g fill="#FFDF00">' +
  '<circle cx="172" cy="352" r="15"/><circle cx="368" cy="352" r="15"/>' +
  '</g></svg>';

/* Огонёк, который спокойно обходит код по кругу. Длина периметра приведена к 100,
   поэтому штрих задаётся простыми числами и не зависит от размера экрана. */
const ORBIT_SVG =
  '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
  '<rect x="1.5" y="1.5" width="97" height="97" rx="9" ry="9" pathLength="100"/>' +
  '</svg>';

/* Галочка рисуется линией: сначала обводится круг, потом сама галка. */
const CHECK_SVG =
  '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
  '<circle class="sg-pay__check-ring" cx="32" cy="32" r="28" pathLength="100"/>' +
  '<path class="sg-pay__check-mark" d="M19 33 28.5 42.5 46 22" pathLength="100"/>' +
  '</svg>';

/* ─────────────────────────────────────────────────────── мелочи */

const nowMs = () => Date.now();

/** Секунды → «9:32». Отрицательное время показываем нулём, а не минусом. */
function clock(sec) {
  const v = Math.max(0, Math.round(sec));
  const m = Math.floor(v / 60);
  const s = v % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

/** Картинка кода из ответа банка. Сервер срезает префикс сам, но чужой ответ
    мог прийти и с ним — тогда берём строку как есть. */
function imageSrc(b64) {
  const raw = String(b64 || '').trim();
  if (!raw) return '';
  return raw.startsWith('data:') ? raw : 'data:image/png;base64,' + raw;
}

/** Ссылка в приложение банка. Пускаем только http(s): чужая схема из ответа
    сервера — это не «удобно», это дыра. */
function bankLink(url) {
  const raw = String(url || '').trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

/** Телефон поддержки из настроек сервиса — последний выход из любого тупика. */
function supportPhone(app) {
  const s = (app && app.cfg && app.cfg.service) || {};
  return String(s.phone || '').replace(/[^\d+]/g, '');
}

/** Сколько ждать этот код: берём разницу серверных отметок, а не разницу с
    часами телефона. Часы на телефоне бывают сбиты на час, и тогда свежий код
    «протухал» бы в первую же секунду. */
function waitSeconds(qr) {
  const made = Number(qr && qr.created_at) || 0;
  const till = Number(qr && qr.expires_at) || 0;
  const ttl = till > made ? till - made : WAIT_LIMIT_S;
  return Math.max(60, Math.min(ttl, WAIT_LIMIT_S));
}

/* ─────────────────────────────────────────────────────── экран */

export function createPayStep(app, opts = {}) {
  const pid = String(opts.pid || '').trim().toUpperCase();
  const token = String(opts.token || '');
  const base = '/pay/' + encodeURIComponent(pid);

  let order = opts.order || null;
  let qr = null;              // последний выпущенный код
  let phase = 'issue';        // issue | wait | paid | expired | declined | bank | off | closed
  let note = '';              // что сказал сервер: его слова точнее наших догадок
  let noImage = false;        // банк отдал только ссылку, картинки кода нет
  let started = false;
  let dead = false;
  let shown = false;          // узел уже побывал на экране
  const born = nowMs();

  let pollTimer = 0;
  let tickTimer = 0;
  let doneTimer = 0;
  let lastPollAt = 0;
  let pollEvery = POLL_MIN_S;
  let fails = 0;              // подряд неудачных опросов
  let checking = false;       // вернулись из банка и ждём ответ на свой вопрос
  let online = true;
  let deadline = 0;           // местное время, когда предложим новый код
  let unsubscribe = null;
  let stream = null;

  /* ── разметка ─────────────────────────────────────────────────────── */

  const title = el('div', { className: 'sg-head__title' }, t('pay.title'));
  const lead = el('div', { className: 'sg-head__sub' }, t('pay.lead_short'));

  const img = el('img', {
    className: 'sg-pay__img', alt: t('pay.qr_alt'), decoding: 'async', hidden: true,
    // Картинка не раскрылась — рваный base64 или обрезанный ответ. Пустая рамка
    // на месте кода выглядит как поломка, поэтому убираем её и оставляем кнопку.
    onError: () => {
      if (dead || phase !== 'wait' || noImage) return;
      noImage = true;
      img.hidden = true;
      logo.hidden = true;
      if (!bankLink(qr && qr.qr_url)) {
        phase = 'bank';
        note = '';
      }
      paint();
    },
  });
  const logo = el('span', { className: 'sg-pay__logo', html: LOGO_SVG, hidden: true });
  const orbit = el('span', { className: 'sg-pay__orbit', html: ORBIT_SVG });
  const veil = el('span', { className: 'sg-pay__veil' },
    el('span', { className: 'sg-pay__veil-dots' }, el('i'), el('i'), el('i')),
    el('span', { className: 'sg-pay__veil-text' }, t('pay.making')));
  const check = el('span', { className: 'sg-pay__check', html: CHECK_SVG, hidden: true });

  const code = el('div', { className: 'sg-pay__code' }, img, logo, check, veil);
  const stage = el('div', { className: 'sg-pay__stage' }, orbit, code);

  const sum = el('div', { className: 'sg-pay__sum' }, '—');
  const hint = el('div', { className: 'sg-pay__hint' }, t('pay.scan'));
  const rest = el('div', { className: 'sg-pay__rest' });
  const timer = el('div', { className: 'sg-pay__timer' });

  const live = el('div', {
    className: 'sg-pay__live', role: 'status', 'aria-live': 'polite',
  }, hint, rest, timer);

  const stateIcon = el('span', { className: 'sg-pay__state-icon', html: icon('alert') });
  const stateTitle = el('div', { className: 'sg-pay__state-title' });
  const stateText = el('div', { className: 'sg-pay__state-text' });
  const stateBox = el('div', {
    className: 'sg-pay__state', role: 'status', 'aria-live': 'polite', hidden: true,
  }, stateIcon, stateTitle, stateText);

  const body = el('div', { className: 'sg-body sg-pay__body' },
    stage, sum, live, stateBox);

  const actions = el('div', { className: 'sg-pay__actions' });
  const foot = el('div', { className: 'sg-foot sg-pay__foot' }, actions);

  const node = el('div', { className: 'sg-step sg-pay is-issue' },
    el('div', { className: 'sg-head' }, el('div', { className: 'sg-head__text' }, title, lead)),
    body, foot);

  /* ── кнопки ───────────────────────────────────────────────────────── */

  function button(kind, text, onClick, small) {
    return el('button', {
      type: 'button',
      className: 'btn btn--' + kind + (small ? ' btn--block' : ' btn--lg btn--block'),
      onClick,
    }, text);
  }

  function callButton() {
    const phone = supportPhone(app);
    if (!phone) return null;
    return el('a', { className: 'btn btn--ghost btn--block', href: 'tel:' + phone },
      el('span', { className: 'sg-pay__btn-icon', html: icon('phone') }), t('pay.call'));
  }

  function cancelButton() {
    if (typeof opts.onCancel !== 'function') return null;
    return button('danger', t('pay.cancel'), () => leave('cancel'), true);
  }

  /** Второстепенные кнопки стоят в ряд: на невысоком экране каждая лишняя
      строка кнопок отъедает у кода столько же, сколько он сам просит. */
  function row(...kids) {
    const list = kids.filter(Boolean);
    if (!list.length) return null;
    return el('div', { className: 'sg-pay__row' }, list);
  }

  /** Кнопки под кодом. Их немного и они меняются целиком: так проще держать в
      голове, что видно человеку в каждом состоянии. */
  function paintActions() {
    const list = [];
    if (phase === 'wait') {
      const link = bankLink(qr && qr.qr_url);
      const has = !!(qr && qr.qr_base64);
      if (link) {
        list.push(el('a', {
          className: 'btn btn--primary btn--lg btn--block',
          href: link, target: '_blank', rel: 'noopener',
        }, t('pay.open_bank')));
        list.push(row(has ? button('ghost', t('pay.save'), saveCode, true) : null,
                      cancelButton()));
      } else {
        if (has) list.push(button('primary', t('pay.save'), saveCode));
        list.push(row(cancelButton()));
      }
    } else if (phase === 'issue') {
      list.push(row(cancelButton()));
    } else if (phase === 'expired' || phase === 'declined') {
      list.push(button('primary', t('pay.refresh'), () => issue(true)));
      list.push(row(phase === 'declined' ? callButton() : null, cancelButton()));
    } else if (phase === 'bank' || phase === 'net') {
      list.push(button('primary', t('pay.retry'), () => issue(true)));
      list.push(row(phase === 'bank' ? callButton() : null, cancelButton()));
    } else if (phase === 'off' || phase === 'closed') {
      list.push(button('primary', t('pay.go_on'), () => leave('skip')));
    }
    actions.replaceChildren(...list.filter(Boolean));
    if (app && app.panel && typeof app.panel.refresh === 'function') app.panel.refresh();
  }

  /* ── отрисовка ────────────────────────────────────────────────────── */

  const STATE_TEXT = {
    expired: ['pay.expired_title', 'pay.expired_text', 'clock'],
    declined: ['pay.declined_title', 'pay.declined_text', 'alert'],
    bank: ['pay.bank_title', 'pay.bank_text', 'alert'],
    net: ['pay.net_title', 'pay.net_text', 'alert'],
    off: ['pay.off_title', 'pay.off_text', 'check'],
    closed: ['pay.closed_title', 'pay.closed_text', 'note'],
  };

  function paint() {
    // Отсюда же узнаём, что шаг наконец показали: дальше сторож имеет право
    // считать пропажу узла с экрана концом работы.
    if (!shown && node.isConnected) shown = true;
    // Классы состояния переключаем по одному: className целиком тут трогать нельзя,
    // на узле в это время висят классы перехода от самой шторки.
    for (const name of PHASES) node.classList.toggle('is-' + name, name === phase);
    title.textContent = phase === 'paid' ? t('pay.done_title') : t('pay.title');

    const amount = qr ? Number(qr.amount) || 0 : prepayGuess();
    const total = qr && qr.price_total ? Number(qr.price_total) : Number((order || {}).price_total) || 0;
    const cash = qr && qr.cash_rest != null ? Number(qr.cash_rest) : Math.max(0, total - amount);

    lead.textContent = amount > 0
      ? t('pay.lead', { sum: money(amount) })
      : t('pay.lead_short');

    const bad = STATE_TEXT[phase];
    stage.hidden = !!bad || (noImage && phase !== 'issue');
    sum.hidden = !!bad;
    live.hidden = !!bad;
    stateBox.hidden = !bad;

    if (bad) {
      stateIcon.innerHTML = icon(bad[2]);
      stateTitle.textContent = t(bad[0]);
      // Слово сервера точнее нашего: он знает, что именно ответил банк.
      stateText.textContent = note || t(bad[1]);
      paintActions();
      return;
    }

    sum.textContent = amount > 0 ? money(amount) : '—';
    rest.textContent = cash > 0 ? t('pay.rest', { sum: money(cash) })
      : (total > 0 ? t('pay.total', { sum: money(total) }) : '');
    rest.hidden = !rest.textContent;

    if (phase === 'paid') {
      hint.textContent = t('pay.done_text');
      timer.textContent = '';
      timer.hidden = true;
    } else if (phase === 'issue') {
      hint.textContent = t('pay.making');
      timer.textContent = '';
      timer.hidden = true;
    } else if (!online) {
      hint.textContent = t('pay.offline');
      paintTimer();
    } else if (checking) {
      // Человек вернулся из приложения банка — первым делом скажем, что уже смотрим.
      hint.textContent = t('pay.checking');
      paintTimer();
    } else {
      // Кода на экране нет — сканировать нечего, зато есть кнопка в банк.
      hint.textContent = noImage ? t('pay.wait_note') : t('pay.scan');
      paintTimer();
    }
    paintActions();
  }

  /** Пока кода нет, показываем хотя бы то, что знаем о заказе: комиссию.
      Пустое место на месте суммы человек читает как поломку. */
  function prepayGuess() {
    const o = order || {};
    const commission = Number(o.commission) || 0;
    return commission > 0 ? commission : 0;
  }

  function paintTimer() {
    if (phase !== 'wait' || !deadline) {
      timer.hidden = true;
      return;
    }
    const left = Math.max(0, Math.round((deadline - nowMs()) / 1000));
    timer.hidden = false;
    timer.textContent = online ? t('pay.left', { time: clock(left) }) : t('pay.wait_note');
  }

  /* ── выпуск кода ──────────────────────────────────────────────────── */

  async function issue(refresh) {
    if (dead) return;
    stopPolling();
    phase = 'issue';
    note = '';
    noImage = false;
    checking = false;
    if (refresh) {
      qr = null;
      img.hidden = true;
      logo.hidden = true;
    }
    veil.hidden = false;
    check.hidden = true;
    paint();

    let res;
    try {
      res = await api.post(base + '/qr', { t: token, lang: getLang() },
                           refresh ? { params: { refresh: 1 } } : {});
    } catch (e) {
      if (dead) return;
      // Заказ закрыт — платить нечего. До сервера не дошли вовсе — виновата связь,
      // и говорить про банк тут нечестно. Всё остальное — беда на стороне банка.
      phase = e.status === 409 ? 'closed' : (e.status === 0 ? 'net' : 'bank');
      note = e.status === 0 ? '' : (e.message || errText(e));
      veil.hidden = true;
      paint();
      return;
    }
    if (dead) return;

    if (res && res.enabled === false) {
      phase = 'off';
      note = String(res.message || '');
      veil.hidden = true;
      paint();
      return;
    }
    if (res && (res.paid === true || res.status === 'paid')) {
      qr = Object.assign({}, qr, res);
      succeed(res);
      return;
    }

    qr = res || {};
    pollEvery = Math.max(POLL_MIN_S, Number(res && res.poll_every_s) || POLL_MIN_S);
    deadline = nowMs() + waitSeconds(qr) * 1000;

    const src = imageSrc(qr.qr_base64);
    noImage = !src;
    if (src) {
      img.src = src;
      img.hidden = false;
      logo.hidden = false;
      veil.hidden = true;
    } else if (bankLink(qr.qr_url)) {
      // Картинки нет, зато есть ссылка в приложение банка — это тоже рабочий
      // путь: прячем пустой квадрат и оставляем человеку кнопку.
      img.hidden = true;
      logo.hidden = true;
      veil.hidden = true;
    } else {
      // Ни кода, ни ссылки — платить нечем. Это беда банка, а не человека.
      phase = 'bank';
      note = '';
      veil.hidden = true;
      paint();
      return;
    }
    phase = 'wait';
    fails = 0;
    online = true;
    paint();
    startPolling();
  }

  /* ── ожидание оплаты ──────────────────────────────────────────────── */

  function startPolling(delay) {
    stopPolling();
    if (dead || phase !== 'wait') return;
    pollTimer = setTimeout(poll, delay == null ? pollEvery * 1000 : delay);
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = 0;
  }

  /* Один секундный будильник на весь экран. Он же сторож: хозяин снимает шаг
     с панели молча, и только по этой проверке мы узнаём, что нас больше нет. */
  function startTicking() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (!alive()) return;
      if (phase !== 'wait') return;
      paintTimer();
      if (deadline && nowMs() >= deadline) expire();
    }, TICK_MS);
  }

  function expire() {
    stopPolling();
    phase = 'expired';
    note = '';
    paint();
  }

  /** Экран мог уйти вместе со своим шагом: хозяин просто снимает узел с панели,
      никого не предупреждая. Тогда останавливаемся сами — иначе опрос будет
      стучаться в сервер до конца сессии.

      Первые секунды не в счёт: шаг успевают собрать раньше, чем показать. */
  function alive() {
    if (dead) return false;
    if (node.isConnected) {
      shown = true;
      return true;
    }
    if (!shown && nowMs() - born < SHOW_GRACE_MS) return true;
    destroy();
    return false;
  }

  async function poll() {
    pollTimer = 0;
    if (!alive() || phase !== 'wait') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      startPolling();
      return;
    }
    const since = nowMs() - lastPollAt;
    if (since < POLL_GAP_MS) {
      startPolling(POLL_GAP_MS - since);
      return;
    }
    lastPollAt = nowMs();

    let res;
    try {
      res = await api.get(base + '/status', { t: token, lang: getLang() });
    } catch (e) {
      if (!alive() || phase !== 'wait') return;
      // 429 — это мы сами частим, а не поломка: молча ждём следующего круга.
      let touched = false;
      if (e.status !== 429) {
        fails += 1;
        // Один провал связи — не новость. Молчим, пока не станет ясно, что беда.
        if (fails >= NET_QUIET && online) {
          online = false;
          touched = true;
        }
      }
      if (checking) {
        checking = false;
        touched = true;
      }
      if (touched) paint();
      startPolling();
      return;
    }
    if (!alive() || phase !== 'wait') return;

    fails = 0;
    // Перерисовываем, только если что-то поменялось: кнопки собираются заново,
    // а перебирать их под пальцем у человека — верный способ сорвать нажатие.
    if (!online || checking) {
      online = true;
      checking = false;
      paint();
    }
    apply(res);
    if (phase === 'wait') startPolling();
  }

  /** Разбор ответа о состоянии оплаты — и от опроса, и от потока событий. */
  function apply(res) {
    if (!res || typeof res !== 'object') return;
    if (res.paid === true || res.status === 'paid' || res.payment_status === 'paid') {
      succeed(res);
      return;
    }
    if (res.qr_status === 'failed' || res.status === 'failed' || res.payment_status === 'failed') {
      stopPolling();
      phase = 'declined';
      note = '';
      paint();
      return;
    }
    const st = String(res.order_status || res.status || '');
    if (CLOSED.indexOf(st) >= 0) {
      stopPolling();
      phase = 'closed';
      note = '';
      paint();
      return;
    }
    // Суммы могли пересчитаться, пока человек искал телефон.
    if (res.amount != null || res.cash_rest != null) {
      qr = Object.assign({}, qr, {
        amount: res.amount != null ? res.amount : (qr && qr.amount),
        cash_rest: res.cash_rest != null ? res.cash_rest : (qr && qr.cash_rest),
        price_total: res.price_total != null ? res.price_total : (qr && qr.price_total),
      });
      paint();
    }
  }

  /* ── деньги пришли ────────────────────────────────────────────────── */

  function succeed(res) {
    if (phase === 'paid') return;
    stopPolling();
    phase = 'paid';
    note = '';
    if (res) {
      qr = Object.assign({}, qr || {}, {
        amount: res.paid_amount || res.amount || (qr && qr.amount) || 0,
        cash_rest: res.cash_rest != null ? res.cash_rest : (qr && qr.cash_rest),
        price_total: res.price_total != null ? res.price_total : (qr && qr.price_total),
      });
    }
    veil.hidden = true;
    check.hidden = false;
    // Короткая двойная вибрация — та же, что у принятого заказа: рука уже знает.
    haptic([16, 60, 24]);
    paint();
    doneTimer = setTimeout(() => {
      doneTimer = 0;
      leave('paid');
    }, DONE_DELAY_MS);
  }

  /* ── сохранить картинку ───────────────────────────────────────────── */

  /** Скачивание через Blob, а не через ссылку на data: — iOS с data-ссылкой
      норовит открыть картинку вместо сохранения. */
  function saveCode() {
    const raw = String((qr && qr.qr_base64) || '').trim();
    if (!raw) {
      toast(t('pay.save_fail'), { type: 'err' });
      return;
    }
    try {
      const clean = raw.startsWith('data:') ? raw.split(',')[1] : raw;
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const link = el('a', { href: url, download: 'sprinter-go-' + pid + '.png' });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      toast(t('pay.saved'), { type: 'ok' });
      haptic();
    } catch (e) {
      toast(t('pay.save_fail'), { type: 'err' });
    }
  }

  /* ── выход ────────────────────────────────────────────────────────── */

  /** Сообщаем хозяину, что делать дальше. Хозяина нет — уходим на страницу
      заказа сами: человек не должен остаться на экране без выхода. */
  function leave(reason) {
    const fn = reason === 'paid' ? opts.onPaid
      : reason === 'cancel' ? opts.onCancel : opts.onSkip;
    const done = typeof fn === 'function' ? fn : opts.onDone;
    if (typeof done === 'function') {
      done(reason, qr);
      return;
    }
    if (app && typeof app.go === 'function') {
      app.go('/order/' + encodeURIComponent(pid), { t: token });
    }
  }

  /* ── поток событий заказа ─────────────────────────────────────────── */

  function onOrderEvent(name, data) {
    if (!alive() || !data || typeof data !== 'object') return;
    if (name !== 'order' && name !== 'payment' && name !== 'status') return;
    apply(data);
  }

  function listen() {
    // Хозяин уже держит поток заказа — второй EventSource к тому же адресу
    // ни к чему: у браузера их на домен всего шесть.
    if (typeof opts.subscribe === 'function') {
      unsubscribe = opts.subscribe(onOrderEvent);
      return;
    }
    stream = api.stream('/orders/' + encodeURIComponent(pid) + '/stream', {
      auth: false,
      params: { t: token, lang: getLang() },
      onEvent: onOrderEvent,
    });
  }

  /* Вернулись в вкладку — скорее всего, из приложения банка. Не досиживаем
     паузу, спрашиваем сразу и честно говорим, что уже проверяем. */
  function onVisible() {
    if (!alive() || phase !== 'wait') return;
    if (document.visibilityState !== 'visible') return;
    if (!checking) {
      checking = true;
      paint();
    }
    startPolling(120);
  }

  function onOnline() {
    if (!alive() || phase !== 'wait') return;
    startPolling(120);
  }

  /* ── жизненный цикл ───────────────────────────────────────────────── */

  function start() {
    if (started || dead) return;
    started = true;
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    startTicking();
    listen();
    issue(false);
  }

  function destroy() {
    if (dead) return;
    dead = true;
    stopPolling();
    if (tickTimer) clearInterval(tickTimer);
    if (doneTimer) clearTimeout(doneTimer);
    tickTimer = 0;
    doneTimer = 0;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    if (stream) stream.close();
    stream = null;
  }

  paint();
  // Хозяин может забыть позвать mount() — тогда запускаемся сами следующим кадром.
  setTimeout(() => { if (!dead && !started) start(); }, 0);

  return {
    name: 'pay',
    node,

    mount() { start(); },

    /** Заказ обновился снаружи: суммы и статус могли поменяться. Принимаем и
        сам заказ, и состояние экрана отслеживания — ему так удобнее. */
    update(next) {
      if (dead || !next || typeof next !== 'object') return;
      // Хозяин зовёт update и со своим состоянием экрана, и с самим заказом.
      // Пока заказ не загрузился, обновлять нечего — ждём следующего вызова.
      const fresh = next.order && typeof next.order === 'object' ? next.order
        : (next.public_id || next.status || next.price_total != null ? next : null);
      if (!fresh) return;
      order = Object.assign({}, order || {}, fresh);
      apply({
        payment_status: order.payment_status,
        order_status: order.status,
        price_total: order.price_total,
      });
      if (!dead) paint();
    },

    relang() {
      img.alt = t('pay.qr_alt');
      veil.querySelector('.sg-pay__veil-text').textContent = t('pay.making');
      paint();
    },

    destroy,
  };
}

/* ─────────────────────────────────────────────────────── целый экран */

/** Оплата как самостоятельный экран: показывает себя в шторке и возвращает
    то же, что mountTrack — {relang, destroy}. */
export function mountPay(app, pid, token, opts = {}) {
  const step = createPayStep(app, Object.assign({}, opts, { pid, token }));
  app.panel.show(step.node);
  step.mount();
  return {
    node: step.node,
    update(next) { step.update(next); },
    relang() { step.relang(); },
    destroy() { step.destroy(); },
  };
}

export default mountPay;
