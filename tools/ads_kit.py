#!/usr/bin/env python3
"""Генерирует набор для Google Ads (импорт в Google Ads Editor): кампании, группы, ключи, минус-слова,
адаптивные поисковые объявления, объявления «только звонок», расширения. Проверяет лимиты символов.
Выход: ads/ (CSV в UTF-8 с BOM для Google Ads Editor) + ads/google-ads-plan.md
"""
import csv, os, sys, io

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ads')
os.makedirs(OUT, exist_ok=True)
SITE = 'https://sprintergo.kg/'
PHONE = '+996 755 555 357'
STATUS = 'Paused'   # импортируется на паузе — включаете сами после проверки
LANG = 'ru'
LOCATION = 'Bishkek, Kyrgyzstan'
NETWORK = 'Google search'

def L(s, n, what):
    if len(s) > n:
        sys.exit(f'СЛИШКОМ ДЛИННО ({len(s)}>{n}) {what}: {s}')
    return s

# ---------------------------------------------------------------- Общие тексты (лимиты: заголовок 30, описание 90, путь 15)
COMMON_HEADLINES = [
    'Грузовое такси от 1 500 сом', 'Подача в выбранное время', 'Цена известна до начала работ',
    '0 скрытых платежей', 'Грузчики в форме и с опытом', 'Работаем с 2015 года', 'Заявка в WhatsApp 24/7',
    'Упаковка и сборка мебели', 'Рассчитайте стоимость онлайн', 'Машины до 5 тонн', 'Договор и чек',
    'Оплата после выполнения работ',
]
COMMON_DESCRIPTIONS = [
    'Спринтер или газель с грузчиками в выбранное время. Упакуем, перевезём, соберём мебель.',
    'Фиксированная цена после расчёта, 0 скрытых платежей. Оплата после выполнения работ.',
    'Переезды и грузоперевозки по Бишкеку и Чуйской области. Договор и чек. Работаем 7 дней.',
    'Рассчитайте стоимость за минуту и отправьте заявку в WhatsApp. Ответим быстро.',
]
for h in COMMON_HEADLINES: L(h, 30, 'headline')
for d in COMMON_DESCRIPTIONS: L(d, 90, 'description')

# ---------------------------------------------------------------- Структура: кампания → группы → (ключи, спец-заголовки, путь)
# Ключи: (текст, тип) — Exact / Phrase. Цены и «сом» в ключах не нужны — их ловит Phrase.
CAMPAIGNS = [
    {
        'name': 'SG | Поиск | Грузоперевозки', 'budget': 700,
        'groups': [
            {'name': 'Грузоперевозки Бишкек', 'path': ('gruzoperevozki', 'bishkek'),
             'headlines': ['Грузоперевозки в Бишкеке', 'Грузоперевозки по Бишкеку', 'Грузоперевозки недорого'],
             'keywords': [('грузоперевозки бишкек', 'Exact'), ('грузоперевозки бишкек', 'Phrase'), ('грузоперевозки по бишкеку', 'Phrase'),
                          ('грузоперевозки в бишкеке', 'Phrase'), ('грузоперевозки недорого бишкек', 'Phrase'), ('грузоперевозки по городу', 'Phrase'),
                          ('заказать грузоперевозку', 'Phrase'), ('грузоперевозки цена', 'Phrase')]},
            {'name': 'Грузовое такси', 'path': ('gruzovoe-taksi', 'bishkek'),
             'headlines': ['Грузовое такси в Бишкеке', 'Грузовое такси Бишкек', 'Грузовое такси с грузчиками'],
             'keywords': [('грузовое такси бишкек', 'Exact'), ('грузовое такси', 'Phrase'), ('грузовое такси бишкек', 'Phrase'),
                          ('грузовое такси недорого', 'Phrase'), ('грузовое такси с грузчиками', 'Phrase'), ('грузотакси бишкек', 'Phrase')]},
            {'name': 'Спринтер / Газель / Портер', 'path': ('sprinter', 'gazel'),
             'headlines': ['Заказать спринтер в Бишкеке', 'Газель и спринтер с грузчиками', 'Спринтер, газель, портер'],
             'keywords': [('заказать спринтер бишкек', 'Phrase'), ('спринтер грузоперевозки', 'Phrase'), ('спринтер для перевозки', 'Phrase'),
                          ('заказать газель бишкек', 'Phrase'), ('газель грузоперевозки бишкек', 'Phrase'), ('газель с грузчиками', 'Phrase'),
                          ('портер бишкек', 'Phrase'), ('портер грузоперевозки', 'Phrase'), ('аренда спринтера с водителем', 'Phrase')]},
            {'name': 'Перевозка мебели и техники', 'path': ('perevozka', 'mebeli'),
             'headlines': ['Перевозка мебели в Бишкеке', 'Перевезём мебель и технику', 'Перевозка холодильника, дивана'],
             'keywords': [('перевозка мебели бишкек', 'Phrase'), ('перевозка мебели', 'Phrase'), ('перевезти мебель', 'Phrase'),
                          ('перевозка холодильника', 'Phrase'), ('перевозка дивана', 'Phrase'), ('перевозка пианино бишкек', 'Phrase'),
                          ('перевозка техники бишкек', 'Phrase'), ('перевозка стройматериалов бишкек', 'Phrase')]},
        ],
    },
    {
        'name': 'SG | Поиск | Переезды', 'budget': 600,
        'groups': [
            {'name': 'Квартирный переезд', 'path': ('pereezd', 'kvartira'),
             'headlines': ['Квартирный переезд в Бишкеке', 'Переезд квартиры под ключ', 'Переезд за один день'],
             'keywords': [('квартирный переезд бишкек', 'Exact'), ('квартирный переезд', 'Phrase'), ('переезд квартиры бишкек', 'Phrase'),
                          ('переезд бишкек', 'Phrase'), ('переезд под ключ бишкек', 'Phrase'), ('услуги переезда бишкек', 'Phrase'),
                          ('переезд с грузчиками', 'Phrase'), ('компания по переезду бишкек', 'Phrase'), ('переезд в другую квартиру', 'Phrase')]},
            {'name': 'Офисный переезд', 'path': ('pereezd', 'ofis'),
             'headlines': ['Офисный переезд в Бишкеке', 'Переезд офиса без простоя', 'Перевезём офис за выходные'],
             'keywords': [('офисный переезд бишкек', 'Exact'), ('офисный переезд', 'Phrase'), ('переезд офиса', 'Phrase'),
                          ('перевозка офиса бишкек', 'Phrase'), ('перевозка офисной мебели', 'Phrase')]},
        ],
    },
    {
        'name': 'SG | Поиск | Грузчики', 'budget': 400,
        'groups': [
            {'name': 'Услуги грузчиков', 'path': ('gruzchiki', 'bishkek'),
             'headlines': ['Грузчики в Бишкеке', 'Услуги грузчиков от 500 сом', 'Грузчики + машина'],
             'keywords': [('грузчики бишкек', 'Exact'), ('услуги грузчиков бишкек', 'Exact'), ('грузчики бишкек', 'Phrase'), ('услуги грузчиков', 'Phrase'),
                          ('нанять грузчиков', 'Phrase'), ('грузчики недорого', 'Phrase'), ('грузчики с машиной', 'Phrase'), ('вызвать грузчиков', 'Phrase'),
                          ('грузчики на час', 'Phrase'), ('подъём мебели на этаж', 'Phrase')]},
        ],
    },
    {
        'name': 'SG | Поиск | Сборка мебели', 'budget': 300,
        'groups': [
            {'name': 'Сборка и разборка мебели', 'path': ('sborka', 'mebeli'),
             'headlines': ['Сборка мебели в Бишкеке', 'Сборка мебели от 500 сом', 'Гарантия на сборку 6 месяцев'],
             'keywords': [('сборка мебели бишкек', 'Exact'), ('сборка мебели', 'Phrase'), ('сборщик мебели бишкек', 'Phrase'),
                          ('разборка мебели', 'Phrase'), ('сборка кухни бишкек', 'Phrase'), ('сборка шкафа', 'Phrase'), ('сборка мебели на дому', 'Phrase')]},
        ],
    },
]

# Минус-слова на уровне аккаунта (общий список для всех кампаний)
NEGATIVES = [
    'работа', 'вакансии', 'вакансия', 'требуется', 'резюме', 'зарплата', 'водитель', 'курсы', 'обучение',
    'купить', 'продажа', 'продам', 'б/у', 'бу', 'запчасти', 'ремонт', 'диски', 'шины', 'аренда без водителя',
    'своими руками', 'самостоятельно', 'бесплатно', 'скачать', 'видео', 'фото', 'игра', 'форум', 'отзывы о',
    'ош', 'джалал-абад', 'каракол', 'нарын', 'талас', 'баткен', 'алматы', 'казахстан', 'россия', 'москва',
    'международные', 'из китая', 'из россии', 'карго', 'авиа', 'жд', 'контейнер', 'фура', 'тягач',
    'мерседес спринтер цена', 'sprinter цена', 'сборка мебели видео', 'инструкция',
]

# Расширения
SITELINKS = [
    ('Калькулятор стоимости', 'Считайте онлайн за минуту', 'Цена известна до подачи', SITE + '#calc'),
    ('Цены и тарифы', 'Минимальный от 1 500 сом', 'Стандарт, Премиум', SITE + '#prices'),
    ('Автопарк', 'Спринтер, газель, 3 и 5 т', 'Подберём под объём', SITE + '#fleet'),
    ('Отзывы клиентов', 'Переезды и сборка мебели', 'Реальные истории', SITE + '#reviews'),
]
CALLOUTS = ['Договор и чек', '0 скрытых платежей', 'Оплата после работы', 'Грузчики в форме', 'С 2015 года', 'Заявки 24/7', 'Подача в выбранное время']
SNIPPET = ('Услуги', ['Квартирный переезд', 'Офисный переезд', 'Грузчики', 'Упаковка', 'Сборка мебели', 'Грузовое такси'])
for s in SITELINKS: L(s[0], 25, 'sitelink'); L(s[1], 35, 'sitelink d1'); L(s[2], 35, 'sitelink d2')
for c in CALLOUTS: L(c, 25, 'callout')

# ---------------------------------------------------------------- Формирование строк для Google Ads Editor
COLS = ['Campaign', 'Campaign Type', 'Campaign Status', 'Budget', 'Budget type', 'Bid Strategy Type', 'Networks', 'Languages', 'Location',
        'Ad Group', 'Ad Group Status', 'Max CPC', 'Keyword', 'Criterion Type', 'Status',
        'Ad type', 'Final URL', 'Path 1', 'Path 2'] + [f'Headline {i}' for i in range(1, 16)] + [f'Headline {i} position' for i in range(1, 4)] + \
       [f'Description {i}' for i in range(1, 5)] + ['Description 1 position',
        'Sitelink text', 'Sitelink description line 1', 'Sitelink description line 2', 'Sitelink final URL',
        'Callout text', 'Structured snippet header', 'Structured snippet values', 'Phone number', 'Country code', 'Business name']

rows = []
def row(**kw):
    r = {c: '' for c in COLS}
    r.update(kw); rows.append(r); return r

for camp in CAMPAIGNS:
    C = camp['name']
    row(**{'Campaign': C, 'Campaign Type': 'Search', 'Campaign Status': STATUS, 'Budget': camp['budget'], 'Budget type': 'Daily',
           'Bid Strategy Type': 'Maximize clicks', 'Networks': NETWORK, 'Languages': LANG, 'Location': LOCATION})
    for sl in SITELINKS:
        row(**{'Campaign': C, 'Sitelink text': sl[0], 'Sitelink description line 1': sl[1], 'Sitelink description line 2': sl[2], 'Sitelink final URL': sl[3]})
    for co in CALLOUTS:
        row(**{'Campaign': C, 'Callout text': co})
    row(**{'Campaign': C, 'Structured snippet header': SNIPPET[0], 'Structured snippet values': ';'.join(SNIPPET[1])})
    row(**{'Campaign': C, 'Phone number': PHONE, 'Country code': 'KG'})
    for g in camp['groups']:
        G = g['name']
        row(**{'Campaign': C, 'Ad Group': G, 'Ad Group Status': STATUS, 'Max CPC': 25})
        for kw, mt in g['keywords']:
            row(**{'Campaign': C, 'Ad Group': G, 'Keyword': kw, 'Criterion Type': mt, 'Status': STATUS})
        heads = [L(h, 30, f'{G} headline') for h in g['headlines']] + COMMON_HEADLINES
        heads = heads[:15]
        r = {'Campaign': C, 'Ad Group': G, 'Ad type': 'Responsive search ad', 'Final URL': SITE, 'Path 1': L(g['path'][0], 15, 'path1'), 'Path 2': L(g['path'][1], 15, 'path2'), 'Status': STATUS}
        for i, h in enumerate(heads, 1): r[f'Headline {i}'] = h
        r['Headline 1 position'] = '1'          # ключевой заголовок группы всегда первый
        for i, d in enumerate(COMMON_DESCRIPTIONS, 1): r[f'Description {i}'] = d
        row(**r)

# Кампания «только звонок» (мобильные, вызов сразу из объявления)
CALL_C = 'SG | Звонки | Мобильные'
row(**{'Campaign': CALL_C, 'Campaign Type': 'Search', 'Campaign Status': STATUS, 'Budget': 400, 'Budget type': 'Daily',
       'Bid Strategy Type': 'Maximize clicks', 'Networks': NETWORK, 'Languages': LANG, 'Location': LOCATION})
row(**{'Campaign': CALL_C, 'Phone number': PHONE, 'Country code': 'KG'})
row(**{'Campaign': CALL_C, 'Ad Group': 'Звонок: грузоперевозки', 'Ad Group Status': STATUS, 'Max CPC': 30})
for kw, mt in [('грузоперевозки бишкек', 'Phrase'), ('грузовое такси', 'Phrase'), ('грузчики бишкек', 'Phrase'), ('переезд бишкек', 'Phrase'), ('заказать газель', 'Phrase'), ('заказать спринтер', 'Phrase')]:
    row(**{'Campaign': CALL_C, 'Ad Group': 'Звонок: грузоперевозки', 'Keyword': kw, 'Criterion Type': mt, 'Status': STATUS})
r = {'Campaign': CALL_C, 'Ad Group': 'Звонок: грузоперевозки', 'Ad type': 'Call ad', 'Final URL': SITE, 'Phone number': PHONE, 'Country code': 'KG',
     'Business name': 'Sprinter Go', 'Status': STATUS,
     'Headline 1': L('Грузоперевозки в Бишкеке', 30, 'call h1'), 'Headline 2': L('Спринтер + грузчики сейчас', 30, 'call h2'),
     'Description 1': L('Подача машины в выбранное время. Цена известна до начала работ.', 90, 'call d1'),
     'Description 2': L('Переезды, грузчики, упаковка. Звоните — ответим сразу.', 90, 'call d2')}
row(**r)

# Минус-слова: общий список (в Editor: Shared library → Negative keyword lists; в CSV — как кампания-независимые строки)
for n in NEGATIVES:
    for camp in CAMPAIGNS + [{'name': CALL_C}]:
        row(**{'Campaign': camp['name'], 'Keyword': n, 'Criterion Type': 'Negative Phrase', 'Status': 'Enabled'})

def write_csv(name, data, cols):
    p = os.path.join(OUT, name)
    with io.open(p, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader()
        for r in data: w.writerow({c: r.get(c, '') for c in cols})
    return p

write_csv('google-ads-import.csv', rows, COLS)
# Отдельные файлы (если удобнее импортировать по частям)
write_csv('keywords.csv', [r for r in rows if r['Keyword'] and 'Negative' not in r['Criterion Type']], ['Campaign', 'Ad Group', 'Keyword', 'Criterion Type', 'Status'])
write_csv('negative-keywords.csv', [r for r in rows if 'Negative' in r['Criterion Type']], ['Campaign', 'Keyword', 'Criterion Type', 'Status'])
write_csv('ads.csv', [r for r in rows if r['Ad type']], ['Campaign', 'Ad Group', 'Ad type', 'Final URL', 'Path 1', 'Path 2'] + [f'Headline {i}' for i in range(1, 16)] + ['Headline 1 position'] + [f'Description {i}' for i in range(1, 5)] + ['Phone number', 'Country code', 'Business name', 'Status'])

# Человекочитаемый план
kw_total = len([r for r in rows if r['Keyword'] and 'Negative' not in r['Criterion Type']])
ads_total = len([r for r in rows if r['Ad type']])
plan = f"""# Google Ads для sprintergo.kg — готовый план запуска

Файлы в этой папке:
- `google-ads-import.csv` — всё сразу для Google Ads Editor (кампании, группы, ключи, минус-слова, объявления, расширения). Всё импортируется **на паузе** — включаете после проверки.
- `keywords.csv`, `negative-keywords.csv`, `ads.csv` — то же по частям.

Итого: {len(CAMPAIGNS) + 1} кампаний, {sum(len(c['groups']) for c in CAMPAIGNS) + 1} групп, {kw_total} ключевых фраз, {len(NEGATIVES)} минус-слов, {ads_total} объявлений. Все заголовки ≤ 30 символов, описания ≤ 90 — проверено скриптом.

## 1. Что сделать до запуска (30 минут)

1. Аккаунт: https://ads.google.com → создать аккаунт для «Sprinter Go», валюта **KGS** (или USD), часовой пояс Бишкек. Платёж — карта.
2. **Отслеживание конверсий** (без него Google не сможет оптимизировать под заявки):
   - Google Ads → Цели → Конверсии → Новое действие → «Веб-сайт» → вручную создать 3 действия: **WhatsApp** (лид, ценность 300 сом), **Звонок** (лид, 300 сом), **Заявка из калькулятора** (лид, 500 сом). Категория «Отправка формы для потенциальных клиентов» / «Контакт».
   - Скопировать тег Google (`AW-XXXXXXXXX`) и ярлыки конверсий (`AW-XXXXXXXXX/AbCdEfGh`).
   - В `index.html` перед `</body>` раскомментировать блок Google tag и добавить настройки (сайт уже умеет отправлять события):
     ```html
     <script async src="https://www.googletagmanager.com/gtag/js?id=AW-XXXXXXXXX"></script>
     <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments)}}gtag('js',new Date());gtag('config','AW-XXXXXXXXX');
     window.SG_TRACK={{ ads:{{ whatsapp:'AW-XXXXXXXXX/ярлык1', call:'AW-XXXXXXXXX/ярлык2', form:'AW-XXXXXXXXX/ярлык3' }} }};</script>
     ```
   - Проверка: открыть сайт, нажать «Написать в WhatsApp» — в Google Ads через 1–3 часа появится конверсия (или сразу в Tag Assistant).
3. Установить **Google Ads Editor** (бесплатно): https://ads.google.com/intl/ru/home/tools/ads-editor/ → войти → скачать аккаунт.

## 2. Импорт кампаний (5 минут)

Google Ads Editor → Аккаунт → Импорт → «Из файла…» → выбрать `google-ads-import.csv` → Editor покажет сопоставление колонок (всё должно определиться автоматически) → «Завершить и проверить изменения» → **Опубликовать**.
Если Editor не принял какую-то строку — импортируйте по частям: сначала `keywords.csv` (создаст кампании и группы), затем `ads.csv`, затем `negative-keywords.csv`; расширения (дополнительные ссылки, уточнения, номер телефона) добавьте в интерфейсе Google Ads, тексты ниже.

После импорта в интерфейсе Google Ads проверьте у каждой кампании:
- **Местоположение**: Бишкек + радиус 30 км (Presence: «Люди, находящиеся в целевом местоположении», не «интересующиеся»).
- **Язык**: русский. Сети: только Поиск (отключить КМС и поисковых партнёров).
- **Расписание**: все дни 07:00–23:00 (заявки в WhatsApp принимаете 24/7, ночью можно оставить со ставкой −50 %).
- **Устройства**: мобильные +20 % (звонки идут с телефонов).
- **Стратегия**: первые 2–3 недели «Максимум кликов» с предельной ценой клика 25–30 сом; после 30 конверсий переключить на «Максимум конверсий» (затем — целевая цена за конверсию).

## 3. Бюджеты

| Кампания | Бюджет/день | Зачем |
|---|---|---|
| SG · Поиск · Грузоперевозки | 700 сом | Самые горячие запросы: «грузоперевозки», «грузовое такси», «спринтер/газель» |
| SG · Поиск · Переезды | 600 сом | Квартирные и офисные переезды — высокий чек |
| SG · Поиск · Грузчики | 400 сом | Частые запросы, ниже чек |
| SG · Поиск · Сборка мебели | 300 сом | Допуслуга, дешёвые клики |
| SG · Звонки · Мобильные | 400 сом | Объявления «Позвонить» — звонок в один тап |
| **Итого** | **≈2 400 сом/день (~$27)** | Можно стартовать с половины: уменьшите бюджеты пропорционально |

## 4. Тексты (уже в CSV)

Общие заголовки: {' · '.join(COMMON_HEADLINES)}

Описания:
{chr(10).join('- ' + d for d in COMMON_DESCRIPTIONS)}

Дополнительные ссылки: {' · '.join(s[0] + ' → ' + s[3] for s in SITELINKS)}
Уточнения: {' · '.join(CALLOUTS)}
Структурированное описание — {SNIPPET[0]}: {', '.join(SNIPPET[1])}
Номер для звонков: {PHONE}

## 5. Первые 2 недели: что смотреть

- **Поисковые запросы** (Ключевые слова → Поисковые запросы): всё нерелевантное («работа», «купить спринтер», другие города) — в минус-слова. Раз в 2–3 дня.
- **Показатель качества** ключей ≥ 6: если ниже — сделайте заголовок объявления ближе к запросу.
- **Цена лида**: ориентир 150–400 сом за обращение в WhatsApp/звонок. Дороже 600 сом — снижайте ставку ключа или отключайте.
- **Часы и дни**: через 2 недели отключите время без конверсий.
- **Не трогайте** стратегию чаще раза в 2 недели: алгоритму нужно время на обучение.

## 6. Когда пойдут первые заявки

- Включите **ремаркетинг** (КМС по посетителям сайта, 100 сом/день) — возвращает тех, кто считал стоимость, но не написал.
- Добавьте **Google Business Profile** и привяжите к Ads: появятся расширения с адресом и отзывами.
- Соберите 10+ отзывов на карточке Google — это поднимает CTR объявлений.
"""
with io.open(os.path.join(OUT, 'google-ads-plan.md'), 'w', encoding='utf-8') as f:
    f.write(plan)
print('ads kit written:', OUT, '| rows', len(rows), '| keywords', kw_total, '| ads', ads_total, '| negatives', len(NEGATIVES))
