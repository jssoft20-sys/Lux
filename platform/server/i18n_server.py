# -*- coding: utf-8 -*-
"""Тексты, которые сервер говорит человеку напрямую: статусы, ошибки, письма.

У фронтенда свои переводы в lang.ru.js и lang.ky.js, но сервер тоже разговаривает
с людьми — письмом на почту или текстом ошибки в ответе API. Ключи здесь те же,
что на фронте, и тон тот же: человек не должен видеть в письме одно, а на экране
другое.

Кыргызский написан живым языком, а не подстрочником с русского. Где по-кыргызски
фраза строится иначе — она и написана иначе, даже если перестаёт совпадать
с русской слово в слово.
"""
from datetime import datetime, timedelta, timezone

from . import settings

LANGS = ('ru', 'ky')
DEFAULT_LANG = 'ru'

# Бишкек круглый год +6 без переводов часов — этого хватает, если в системе
# нет базы часовых поясов (на голом Alpine, например, её часто нет).
FALLBACK_TZ = timezone(timedelta(hours=6))

# Неразрывный пробел: в письме и в SMS число не должно отрываться от единицы
# переносом строки — «1 250» и «сом» на разных строках читаются как ошибка.
NBSP = '\u00a0'


# ─────────────────────────────────────────────────────────────── русский

RU = {
    # ── статусы заказа ───────────────────────────────────────────────────────
    'status.draft': 'Не оформлен',
    'status.searching': 'Ищем машину',
    'status.assigned': 'Курьер назначен',
    'status.to_pickup': 'Едет за грузом',
    'status.at_pickup': 'На погрузке',
    'status.in_transit': 'В пути',
    'status.at_dropoff': 'На разгрузке',
    'status.done': 'Завершён',
    'status.cancelled': 'Отменён',
    'status.expired': 'Машина не нашлась',

    # ── статусы оплаты ───────────────────────────────────────────────────────
    'status.pay_none': 'Наличными курьеру',
    'status.pay_pending': 'Ждём оплату',
    'status.pay_paid': 'Оплачен',
    'status.pay_failed': 'Оплата не прошла',
    'status.pay_refunded': 'Деньги возвращены',

    # ── статусы людей и предложений ──────────────────────────────────────────
    'status.user_pending': 'На проверке',
    'status.user_active': 'Работает',
    'status.user_blocked': 'Заблокирован',
    'status.online': 'На линии',
    'status.offline': 'Не на линии',
    'status.busy': 'На заказе',
    'status.offer_sent': 'Отправлено',
    'status.offer_accepted': 'Принято',
    'status.offer_declined': 'Отклонено',
    'status.offer_expired': 'Не успел ответить',

    # ── ошибки ───────────────────────────────────────────────────────────────
    'err.server': 'Сервис споткнулся. Мы уже разбираемся',
    'err.bad_request': 'Запрос не принят, проверьте данные',
    'err.unauthorized': 'Нужно войти',
    'err.session': 'Сессия закончилась, войдите заново',
    'err.forbidden': 'Нет доступа к этому разделу',
    'err.not_found': 'Ничего не нашлось',
    'err.conflict': 'Данные успели измениться, обновите страницу',
    'err.too_many': 'Слишком часто. Подождите немного',
    'err.too_large': 'Слишком много данных за раз',
    'err.validation': 'Проверьте заполненные поля',
    'err.field_required': 'Поле обязательное',
    'err.bad_phone': 'Телефон не похож на настоящий',
    'err.bad_email': 'Почта написана с ошибкой',
    'err.bad_password': 'Пароль не подходит',
    'err.password_short': 'Пароль короче восьми символов',
    'err.wrong_login': 'Неверная почта или пароль',
    'err.email_taken': 'На эту почту уже есть аккаунт',
    'err.account_pending': 'Аккаунт ещё на проверке. Мы напишем, как только всё проверим',
    'err.account_blocked': 'Аккаунт заблокирован. Напишите в поддержку, разберёмся',
    'err.registration_closed': 'Регистрация временно закрыта',
    'err.reset_expired': 'Ссылка устарела, запросите новую',
    'err.order_not_found': 'Такого заказа нет',
    'err.order_gone': 'Заказ уже в работе, изменить не получится',
    'err.no_couriers': 'Свободных машин сейчас нет',
    'err.price_changed': 'Цена пересчиталась, посмотрите новую',
    'err.point_outside': 'Этот адрес вне зоны работы сервиса',
    'err.same_points': 'Адреса подачи и доставки совпадают',
    'err.route_failed': 'Не удалось построить маршрут',
    'err.payment_failed': 'Оплата не прошла',
    'err.payment_cancelled': 'Оплата отменена',
    'err.save_failed': 'Не получилось сохранить',
    'err.load_failed': 'Не получилось загрузить данные',
    'err.unknown': 'Что-то пошло не так',

    # ── оплата ───────────────────────────────────────────────────────────────
    'pay.cash': 'Наличными курьеру',
    'pay.online': 'Онлайн',
    'pay.manual': 'По счёту от оператора',
    'pay.cash_hint': 'Рассчитаетесь с курьером на месте — наличными или переводом.',
    'pay.manual_hint': 'Счёт на оплату выставит оператор, заказ уже принят в работу.',
    'pay.offline_hint': 'Онлайн-оплата сейчас недоступна, рассчитаетесь с курьером на месте.',
    'pay.wait_hint': 'Заказ уйдёт в работу, как только пройдёт оплата.',
    'pay.done': 'Оплата прошла, ищем машину',
    'pay.failed': 'Оплата не прошла. Попробуйте ещё раз или платите наличными курьеру',

    # ── общее для писем ──────────────────────────────────────────────────────
    'mail.hello': 'Здравствуйте, {name}!',
    'mail.colleague': 'коллега',
    'mail.hello_plain': 'Здравствуйте!',
    'mail.footer_auto': 'Письмо пришло автоматически, отвечать на него не нужно.',
    'mail.footer_support': 'Вопросы — звоните {phone}, поможем.',
    'mail.link_fallback': 'Кнопка не открывается? Скопируйте ссылку в браузер: {url}',
    'mail.from': 'Откуда',
    'mail.to': 'Куда',
    'mail.stops': 'Промежуточные точки',
    'mail.distance': 'Расстояние',
    'mail.duration': 'Время в пути',
    'mail.tariff': 'Тариф',
    'mail.car': 'Машина',
    'mail.plate': 'Госномер',
    'mail.phone': 'Телефон',
    'mail.courier': 'Курьер',
    'mail.date': 'Дата',
    'mail.order': 'Заказ',
    'mail.payment': 'Оплата',
    'mail.loaders': 'Грузчики',
    'mail.total': 'Итого',
    'mail.payout': 'Вам за заказ',
    'mail.price': 'Стоимость',
    'mail.pickup_near': 'До точки погрузки',

    # ── письмо: заявка курьера принята ───────────────────────────────────────
    'mail.courier_welcome.subject': 'Заявка принята — проверяем документы',
    'mail.courier_welcome.pre': 'Анкета у нас, проверим и откроем доступ',
    'mail.courier_welcome.title': 'Заявка принята',
    'mail.courier_welcome.lead': 'Спасибо, {name}. Анкета у нас, и мы уже её смотрим.',
    'mail.courier_welcome.p1': 'В рабочее время проверка занимает пару часов, иногда до конца дня. '
                              'Как только всё сойдётся, пришлём письмо на этот адрес — и можно '
                              'выходить на линию.',
    'mail.courier_welcome.p2': 'Держите под рукой техпаспорт и водительское удостоверение: если '
                              'что-то не сойдётся, мы позвоним и уточним, а не отклоним молча.',
    'mail.courier_welcome.note': 'Не подавали заявку? Значит, кто-то ошибся адресом — просто '
                                'удалите это письмо, аккаунт без подтверждения не заработает.',

    # ── письмо: курьера одобрили ─────────────────────────────────────────────
    'mail.courier_approved.subject': 'Готово, можно выходить на линию',
    'mail.courier_approved.pre': 'Документы проверены, доступ открыт',
    'mail.courier_approved.title': 'Доступ открыт',
    'mail.courier_approved.lead': 'Документы проверили, {name}. Аккаунт активен — заходите '
                                 'и включайте «На линии».',
    'mail.courier_approved.p1': 'Заказы приходят прямо на экран: адреса, расстояние и сумма '
                               'на руки видны сразу. Кто первым нажал «Беру» — тот и везёт, '
                               'поэтому держите звук включённым.',
    'mail.courier_approved.button': 'Войти в приложение',
    'mail.courier_approved.note': 'Чем быстрее отвечаете на предложения, тем чаще они приходят: '
                                 'подбор учитывает, как часто вы берёте заказы.',

    # ── письмо: отказ курьеру ────────────────────────────────────────────────
    'mail.courier_rejected.subject': 'По заявке пока отказ',
    'mail.courier_rejected.pre': 'Пока не получилось открыть доступ',
    'mail.courier_rejected.title': 'Пока не получилось',
    'mail.courier_rejected.lead': 'Мы посмотрели анкету, {name}, и сейчас открыть доступ '
                                 'не можем.',
    'mail.courier_rejected.reason': 'Причина',
    'mail.courier_rejected.p1': 'Это не навсегда. Если документы обновились, машина поменялась '
                               'или в анкете была опечатка — подайте заявку ещё раз, мы '
                               'посмотрим заново.',
    'mail.courier_rejected.note': 'Считаете, что вышло недоразумение? Позвоните {phone}, '
                                 'разберёмся вручную.',

    # ── письмо: новый заказ рядом ────────────────────────────────────────────
    'mail.courier_new_order.subject': 'Новый заказ рядом — {price}',
    'mail.courier_new_order.pre': '{from_addr} → {to_addr}',
    'mail.courier_new_order.title': 'Новый заказ рядом',
    'mail.courier_new_order.lead': 'Подача в {near} от вас. Успеете — забирайте.',
    'mail.courier_new_order.lead_plain': 'Свободная машина нужна прямо сейчас.',
    'mail.courier_new_order.button': 'Открыть в приложении',
    'mail.courier_new_order.note': 'Предложение живёт недолго: кто первым нажал «Беру», '
                                  'тот и везёт.',

    # ── письмо: сброс пароля ─────────────────────────────────────────────────
    'mail.password_reset.subject': 'Новый пароль для {service}',
    'mail.password_reset.pre': 'Ссылка на смену пароля, действует час',
    'mail.password_reset.title': 'Новый пароль',
    'mail.password_reset.lead': 'Кто-то попросил сменить пароль для {email}. Если это были '
                               'вы — нажмите кнопку.',
    'mail.password_reset.button': 'Задать новый пароль',
    'mail.password_reset.note': 'Ссылка работает час и только один раз. Если это были не вы — '
                               'ничего делать не нужно, старый пароль останется в силе.',

    # ── письмо: сводка админу ────────────────────────────────────────────────
    'mail.admin_daily.subject': 'Сводка за {date}',
    'mail.admin_daily.pre': 'Заказы, выручка и комиссия за день',
    'mail.admin_daily.title': 'Итоги дня',
    'mail.admin_daily.lead': '{date}, {city}. Коротко о том, как прошёл день.',
    'mail.admin_daily.button': 'Открыть админку',
    'mail.admin_daily.orders': 'Заказов создано',
    'mail.admin_daily.done': 'Выполнено',
    'mail.admin_daily.cancelled': 'Отменено',
    'mail.admin_daily.expired': 'Без машины',
    'mail.admin_daily.revenue': 'Выручка',
    'mail.admin_daily.commission': 'Комиссия сервиса',
    'mail.admin_daily.avg': 'Средний чек',
    'mail.admin_daily.couriers_new': 'Новых курьеров',
    'mail.admin_daily.couriers_online': 'Выходило на линию',
    'mail.admin_daily.clients_new': 'Новых клиентов',
    'mail.admin_daily.top': 'Больше всех сделал {name} — {count}',
    'mail.admin_daily.empty': 'За этот день заказов не было. Тихий день тоже бывает.',

    # ── письмо: чек клиенту ──────────────────────────────────────────────────
    'mail.order_receipt.subject': 'Чек по заказу {public_id}',
    'mail.order_receipt.pre': 'Заказ выполнен, итог — {total}',
    'mail.order_receipt.title': 'Заказ выполнен',
    'mail.order_receipt.lead': 'Спасибо, что выбрали {service}. Вот как сложилась стоимость '
                              'заказа {public_id}.',
    'mail.order_receipt.button': 'Оценить поездку',
    'mail.order_receipt.note': 'Что-то в чеке непонятно? Позвоните {phone} и назовите номер '
                              'заказа — поднимем все расчёты.',

    # ── письмо: проверка почты из админки ────────────────────────────────────
    'mail.test.subject': 'Проверка почты {service}',
    'mail.test.pre': 'Если письмо дошло, SMTP настроен верно',
    'mail.test.title': 'Почта работает',
    'mail.test.lead': 'Это проверочное письмо из админки. Раз оно у вас — сервис умеет '
                      'писать людям.',
    'mail.test.note': 'Письмо отправлено вручную из раздела настроек. Клиенты и курьеры '
                      'такие письма не получают.',
    'mail.test.host': 'Сервер',
    'mail.test.secure': 'Шифрование',
    'mail.test.sender': 'Отправитель',
}


# ─────────────────────────────────────────────────────────────── кыргызский

KY = {
    'status.draft': 'Аякталган эмес',
    'status.searching': 'Унаа изделүүдө',
    'status.assigned': 'Курьер дайындалды',
    'status.to_pickup': 'Жүккө бара жатат',
    'status.at_pickup': 'Жүктөөдө',
    'status.in_transit': 'Жолдо',
    'status.at_dropoff': 'Түшүрүүдө',
    'status.done': 'Аякталды',
    'status.cancelled': 'Жокко чыгарылды',
    'status.expired': 'Унаа табылган жок',

    'status.pay_none': 'Курьерге накталай',
    'status.pay_pending': 'Төлөм күтүлүүдө',
    'status.pay_paid': 'Төлөндү',
    'status.pay_failed': 'Төлөм өтпөдү',
    'status.pay_refunded': 'Акча кайтарылды',

    'status.user_pending': 'Текшерүүдө',
    'status.user_active': 'Иштеп жатат',
    'status.user_blocked': 'Бөгөттөлгөн',
    'status.online': 'Линияда',
    'status.offline': 'Линияда эмес',
    'status.busy': 'Заказда',
    'status.offer_sent': 'Жөнөтүлдү',
    'status.offer_accepted': 'Кабыл алынды',
    'status.offer_declined': 'Баш тартылды',
    'status.offer_expired': 'Жооп бербей калды',

    'err.server': 'Сервисте ката кетти. Оңдоп жатабыз',
    'err.bad_request': 'Сурам кабыл алынган жок, маалыматты текшериңиз',
    'err.unauthorized': 'Кирүү керек',
    'err.session': 'Сессия бүттү, кайра кириңиз',
    'err.forbidden': 'Бул бөлүмгө уруксат жок',
    'err.not_found': 'Эч нерсе табылган жок',
    'err.conflict': 'Маалымат өзгөрүп кетти, баракты жаңыртыңыз',
    'err.too_many': 'Өтө көп аракет. Бир аз күтө туруңуз',
    'err.too_large': 'Бир жолу жөнөтүлгөн маалымат өтө көп',
    'err.validation': 'Толтурулган талааларды текшериңиз',
    'err.field_required': 'Талаа толтурулушу керек',
    'err.bad_phone': 'Телефон номери туура эмес',
    'err.bad_email': 'Почта ката жазылган',
    'err.bad_password': 'Сырсөз туура келбейт',
    'err.password_short': 'Сырсөз сегиз белгиден кыска',
    'err.wrong_login': 'Почта же сырсөз туура эмес',
    'err.email_taken': 'Бул почта менен аккаунт бар',
    'err.account_pending': 'Аккаунт азырынча текшерүүдө. Бүткөн соң кат жазабыз',
    'err.account_blocked': 'Аккаунт бөгөттөлгөн. Колдоо кызматына жазыңыз, чечебиз',
    'err.registration_closed': 'Катталуу убактылуу жабык',
    'err.reset_expired': 'Шилтеменин мөөнөтү бүткөн, жаңысын сураңыз',
    'err.order_not_found': 'Мындай заказ жок',
    'err.order_gone': 'Заказ иштеп жатат, өзгөртүүгө болбойт',
    'err.no_couriers': 'Азыр бош унаа жок',
    'err.price_changed': 'Баа кайра эсептелди, жаңысын караңыз',
    'err.point_outside': 'Бул дарек сервис иштеген аймактан тышкары',
    'err.same_points': 'Алуу жана жеткирүү дареги бирдей',
    'err.route_failed': 'Маршрут курулган жок',
    'err.payment_failed': 'Төлөм өтпөй калды',
    'err.payment_cancelled': 'Төлөм жокко чыгарылды',
    'err.save_failed': 'Сактоо мүмкүн болбоду',
    'err.load_failed': 'Маалымат жүктөлбөй калды',
    'err.unknown': 'Бир жерден ката кетти',

    'pay.cash': 'Курьерге накталай',
    'pay.online': 'Онлайн',
    'pay.manual': 'Оператор чыгарган эсеп боюнча',
    'pay.cash_hint': 'Курьер менен ордунда эсептешесиз — накталай же которуу менен.',
    'pay.manual_hint': 'Төлөм эсебин оператор чыгарат, заказ иштеп баштады.',
    'pay.offline_hint': 'Онлайн төлөм азыр иштебей турат, курьер менен ордунда эсептешесиз.',
    'pay.wait_hint': 'Төлөм өткөн соң заказ ишке кетет.',
    'pay.done': 'Төлөм өттү, унаа издеп жатабыз',
    'pay.failed': 'Төлөм өтпөй калды. Кайра аракет кылыңыз же курьерге накталай төлөңүз',

    'mail.hello': 'Саламатсызбы, {name}!',
    'mail.colleague': 'кесиптеш',
    'mail.hello_plain': 'Саламатсызбы!',
    'mail.footer_auto': 'Бул кат автоматтык түрдө жөнөтүлдү, жооп жазуунун кереги жок.',
    'mail.footer_support': 'Суроолор болсо {phone} номерине чалыңыз, жардам беребиз.',
    'mail.link_fallback': 'Баскыч ачылбай жатабы? Шилтемени браузерге көчүрүңүз: {url}',
    'mail.from': 'Кайдан',
    'mail.to': 'Кайда',
    'mail.stops': 'Аралык чекиттер',
    'mail.distance': 'Аралык',
    'mail.duration': 'Жолдогу убакыт',
    'mail.tariff': 'Тариф',
    'mail.car': 'Унаа',
    'mail.plate': 'Мамлекеттик номери',
    'mail.phone': 'Телефон',
    'mail.courier': 'Курьер',
    'mail.date': 'Күнү',
    'mail.order': 'Заказ',
    'mail.payment': 'Төлөм',
    'mail.loaders': 'Жүкчүлөр',
    'mail.total': 'Жалпы',
    'mail.payout': 'Сизге тиеси',
    'mail.price': 'Баасы',
    'mail.pickup_near': 'Жүк алуу чекитине чейин',

    'mail.courier_welcome.subject': 'Арызыңыз кабыл алынды — документтериңизди текшерип жатабыз',
    'mail.courier_welcome.pre': 'Анкетаңыз бизде, текшерип, уруксат беребиз',
    'mail.courier_welcome.title': 'Арызыңыз кабыл алынды',
    'mail.courier_welcome.lead': 'Рахмат, {name}. Анкетаңыз бизге жетти, азыр карап жатабыз.',
    'mail.courier_welcome.p1': 'Иш убагында текшерүү эки-үч саатка созулат, кээде кечке чейин. '
                              'Баары төп келгенде ушул дарекке кат жөнөтөбүз — андан соң '
                              'линияга чыга берсеңиз болот.',
    'mail.courier_welcome.p2': 'Техпаспорт менен айдоочулук күбөлүгүңүздү жаныңызда кармаңыз: '
                              'бир нерсе төп келбесе, унчукпай четке какпайбыз, чалып сурайбыз.',
    'mail.courier_welcome.note': 'Арыз бербеген болсоңуз, кимдир бирөө дарегин жаңылыш жазган '
                                'экен — катты өчүрүп койсоңуз болот, ырастоосуз аккаунт '
                                'иштебейт.',

    'mail.courier_approved.subject': 'Даяр, линияга чыга берсеңиз болот',
    'mail.courier_approved.pre': 'Документтер текшерилди, аккаунт ачылды',
    'mail.courier_approved.title': 'Аккаунтуңуз ачылды',
    'mail.courier_approved.lead': 'Документтериңизди текшердик, {name}. Аккаунт иштейт — '
                                 'кирип, «Линияда» дегенди күйгүзүңүз.',
    'mail.courier_approved.p1': 'Заказдар түз эле экранга түшөт: дарек, аралык жана колуңузга '
                               'тиечү сумма дароо көрүнөт. Ким «Алам» дегенди биринчи басса, '
                               'заказ ошонуку — үнүн өчүрүп койбоңуз.',
    'mail.courier_approved.button': 'Колдонмого кирүү',
    'mail.courier_approved.note': 'Сунуштарга канчалык тез жооп берсеңиз, ошончолук көп заказ '
                                 'түшөт: тандоо сиздин жообуңузду эсепке алат.',

    'mail.courier_rejected.subject': 'Арызыңыз азырынча жактырылган жок',
    'mail.courier_rejected.pre': 'Азырынча уруксат бере албадык',
    'mail.courier_rejected.title': 'Азырынча болбой турат',
    'mail.courier_rejected.lead': 'Анкетаңызды карадык, {name}, бирок азыр уруксат бере '
                                 'албайбыз.',
    'mail.courier_rejected.reason': 'Себеби',
    'mail.courier_rejected.p1': 'Бул биротоло эмес. Документтериңиз жаңыланса, унааңыз '
                               'алмашса же анкетада ката кетсе — кайра арыз бериңиз, дагы '
                               'бир жолу карайбыз.',
    'mail.courier_rejected.note': 'Түшүнбөстүк болду деп ойлосоңуз, {phone} номерине чалыңыз, '
                                 'кол менен карап чыгабыз.',

    'mail.courier_new_order.subject': 'Жакын жерде жаңы заказ — {price}',
    'mail.courier_new_order.pre': '{from_addr} → {to_addr}',
    'mail.courier_new_order.title': 'Жакын жерде жаңы заказ',
    'mail.courier_new_order.lead': 'Жүк сизден {near} аралыкта. Үлгүрсөңүз, алып коюңуз.',
    'mail.courier_new_order.lead_plain': 'Дал ушул азыр бош унаа керек.',
    'mail.courier_new_order.button': 'Колдонмодон ачуу',
    'mail.courier_new_order.note': 'Сунуш көпкө турбайт: ким «Алам» дегенди биринчи басса, '
                                  'заказ ошонуку.',

    'mail.password_reset.subject': '{service} үчүн жаңы сырсөз',
    'mail.password_reset.pre': 'Сырсөз жаңылоо шилтемеси, бир саат иштейт',
    'mail.password_reset.title': 'Жаңы сырсөз',
    'mail.password_reset.lead': 'Кимдир бирөө {email} үчүн сырсөздү жаңылоону сурады. Бул сиз '
                               'болсоңуз, баскычты басыңыз.',
    'mail.password_reset.button': 'Жаңы сырсөз коюу',
    'mail.password_reset.note': 'Шилтеме бир саат жана бир жолу гана иштейт. Эгер бул сиз '
                               'эмес болсоңуз, эч нерсе кылбаңыз — эски сырсөзүңүз ордунда '
                               'калат.',

    'mail.admin_daily.subject': '{date} күнүнүн жыйынтыгы',
    'mail.admin_daily.pre': 'Күндүк заказ, түшкөн акча жана комиссия',
    'mail.admin_daily.title': 'Күндүн жыйынтыгы',
    'mail.admin_daily.lead': '{date}, {city}. Күн кандай өткөнү жөнүндө кыскача.',
    'mail.admin_daily.button': 'Админканы ачуу',
    'mail.admin_daily.orders': 'Заказ түшкөн',
    'mail.admin_daily.done': 'Аткарылды',
    'mail.admin_daily.cancelled': 'Жокко чыгарылды',
    'mail.admin_daily.expired': 'Унаасыз калды',
    'mail.admin_daily.revenue': 'Түшкөн акча',
    'mail.admin_daily.commission': 'Сервистин комиссиясы',
    'mail.admin_daily.avg': 'Орточо чек',
    'mail.admin_daily.couriers_new': 'Жаңы курьерлер',
    'mail.admin_daily.couriers_online': 'Линияга чыкты',
    'mail.admin_daily.clients_new': 'Жаңы кардарлар',
    'mail.admin_daily.top': 'Эң көп заказды {name} аткарды — {count}',
    'mail.admin_daily.empty': 'Бул күнү заказ болгон жок. Тынч күн да болот.',

    'mail.order_receipt.subject': '{public_id} заказы боюнча чек',
    'mail.order_receipt.pre': 'Заказ аткарылды, жыйынтыгы — {total}',
    'mail.order_receipt.title': 'Заказ аткарылды',
    'mail.order_receipt.lead': 'Бизди тандаганыңыз үчүн рахмат. {public_id} заказынын баасы '
                              'мына мындай чыкты.',
    'mail.order_receipt.button': 'Баа берүү',
    'mail.order_receipt.note': 'Чектеги бир нерсе түшүнүксүз болсо, {phone} номерине чалып, '
                              'заказдын номерин айтыңыз — баарын кайра карап чыгабыз.',

    'mail.test.subject': '{service} почтасын текшерүү',
    'mail.test.pre': 'Кат жетсе, SMTP туура тууралган',
    'mail.test.title': 'Почта иштейт',
    'mail.test.lead': 'Бул админкадан жөнөтүлгөн сыноо каты. Кат сизге жетсе, сервис адамдарга '
                      'кат жаза алат деген сөз.',
    'mail.test.note': 'Кат жөндөөлөр бөлүмүнөн кол менен жөнөтүлдү. Кардарлар менен курьерлер '
                      'мындай кат албайт.',
    'mail.test.host': 'Сервер',
    'mail.test.secure': 'Шифрлөө',
    'mail.test.sender': 'Жөнөтүүчү',
}

TEXTS = {'ru': RU, 'ky': KY}

MONTHS_RU = ('января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
             'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря')
MONTHS_KY = ('январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
             'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь')


# ─────────────────────────────────────────────────────────────── подстановка

class _Blanks(dict):
    """Недостающая переменная превращается в пустоту, а не в исключение.
    Письмо без одной строчки лучше, чем письмо, которое не ушло."""

    def __missing__(self, key):
        return ''


def norm_lang(lang):
    lang = str(lang or '').strip().lower()[:2]
    return lang if lang in LANGS else DEFAULT_LANG


def _service_vars():
    """Название сервиса, телефон и город подставляются в тексты сами: писать их
    в каждом вызове t() — лишняя работа и лишний повод забыть."""
    try:
        return {
            'service': settings.get('service.name', 'Sprinter Go'),
            'phone': settings.get('service.phone', ''),
            'city': settings.get('service.city', ''),
        }
    except Exception:
        # настройки читаются из базы, а её может ещё не быть (ранний старт, тесты)
        return {'service': 'Sprinter Go', 'phone': '', 'city': ''}


def t(key, lang=DEFAULT_LANG, **vars):
    """Текст по ключу. Нет перевода на кыргызский — отдаём русский, нет ключа
    вовсе — отдаём сам ключ: так пропажа сразу видна и ничего не падает."""
    lang = norm_lang(lang)
    text = TEXTS[lang].get(key)
    if text is None:
        text = RU.get(key)
    if text is None:
        return key
    data = _service_vars()
    data.update(vars)
    try:
        return text.format_map(_Blanks(data))
    except (IndexError, KeyError, ValueError):
        return text


def has(key, lang=DEFAULT_LANG):
    return key in TEXTS[norm_lang(lang)] or key in RU


def status_name(code, lang=DEFAULT_LANG):
    """Название статуса заказа: 'in_transit' → «В пути»."""
    return t('status.%s' % (code or 'draft'), lang)


def payment_name(code, lang=DEFAULT_LANG):
    """Название состояния оплаты: 'paid' → «Оплачен»."""
    return t('status.pay_%s' % (code or 'none'), lang)


def user_status_name(code, lang=DEFAULT_LANG):
    return t('status.user_%s' % (code or 'pending'), lang)


def error_text(code, lang=DEFAULT_LANG, **vars):
    """Сообщение об ошибке по коду ApiError. Неизвестный код — общая фраза."""
    key = 'err.%s' % (code or 'unknown')
    return t(key, lang, **vars) if has(key, lang) else t('err.unknown', lang)


# ─────────────────────────────────────────────────────────────── форматы

def _tz():
    """Часовой пояс сервиса. Базы часовых поясов в системе может не быть —
    тогда берём постоянный +6, для Бишкека это ровно то же самое."""
    name = str(settings.get('service.tz', 'Asia/Bishkek') or '')
    if not name:
        return FALLBACK_TZ
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:
        return FALLBACK_TZ


def local_dt(unix):
    return datetime.fromtimestamp(int(unix or 0), tz=timezone.utc).astimezone(_tz())


def fmt_money(tiyin, lang=DEFAULT_LANG, unit=True):
    """Деньги: 125000 тыйынов → «1 250 сом». Тыйыны показываем, только если они есть."""
    try:
        v = int(tiyin or 0)
    except (TypeError, ValueError):
        v = 0
    sign = '−' if v < 0 else ''
    v = abs(v)
    som, tiy = divmod(v, 100)
    body = '{:,}'.format(som).replace(',', NBSP)
    if tiy:
        body += ',%02d' % tiy
    if not unit:
        return sign + body
    return '%s%s%sсом' % (sign, body, NBSP)


def fmt_distance(meters, lang=DEFAULT_LANG):
    """Расстояние: до километра — в метрах, дальше — с одним знаком после запятой."""
    try:
        m = int(meters or 0)
    except (TypeError, ValueError):
        m = 0
    if m < 1000:
        return '%d%sм' % (max(0, m), NBSP)
    km = m / 1000.0
    text = ('%.1f' % km).rstrip('0').rstrip('.').replace('.', ',')
    return '%s%sкм' % (text, NBSP)


def fmt_duration(seconds, lang=DEFAULT_LANG):
    """Длительность: «12 мин», «1 ч 20 мин», «2 ч»."""
    try:
        s = max(0, int(seconds or 0))
    except (TypeError, ValueError):
        s = 0
    minutes = (s + 30) // 60
    h, m = divmod(minutes, 60)
    unit_h = 'ч' if lang != 'ky' else 'саат'
    unit_m = 'мин' if lang != 'ky' else 'мүн'
    if h and m:
        return '%d%s%s %d%s%s' % (h, NBSP, unit_h, m, NBSP, unit_m)
    if h:
        return '%d%s%s' % (h, NBSP, unit_h)
    return '%d%s%s' % (m, NBSP, unit_m)


def fmt_date(unix, lang=DEFAULT_LANG, year=False):
    """Дата словами: «13 сентября» по-русски, «13-сентябрь» по-кыргызски."""
    d = local_dt(unix)
    lang = norm_lang(lang)
    if lang == 'ky':
        out = '%d-%s' % (d.day, MONTHS_KY[d.month - 1])
    else:
        out = '%d %s' % (d.day, MONTHS_RU[d.month - 1])
    if year:
        out += ' %d' % d.year
    return out


def fmt_time(unix, lang=DEFAULT_LANG):
    return local_dt(unix).strftime('%H:%M')


def fmt_dt(unix, lang=DEFAULT_LANG, year=False):
    """Дата и время в часовом поясе сервиса: «13 сентября, 14:30»."""
    return '%s, %s' % (fmt_date(unix, lang, year), fmt_time(unix, lang))
