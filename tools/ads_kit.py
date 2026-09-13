#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Google Ads для sprintergo.kg — компактная структура под бюджет 1000–1500 сом/день.

Две кампании (вторую можно не включать):
  1. «SG | Поиск | Бишкек»  — основная, русский + кыргызский, 5 групп
  2. «SG | Звонки»          — только звонок с мобильных (необязательная)

Выход в ads/:
  google-ads-import.csv     — всё сразу для Google Ads Editor
  keywords.csv / negative-keywords.csv / ads.csv
  paste/*.txt               — списки для копипаста прямо в веб-интерфейс Google Ads
  google-ads-plan.md        — пошаговый запуск
"""
import csv, io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'ads')
PASTE = os.path.join(OUT, 'paste')
os.makedirs(PASTE, exist_ok=True)

SITE = 'https://sprintergo.kg/'
PHONE = '+996 755 555 357'
STATUS = 'Paused'
LOCATION = 'Bishkek, Kyrgyzstan; Chuy Region, Kyrgyzstan'
NETWORK = 'Google search'
BUDGET_MAIN = 1200      # сом/день
BUDGET_CALL = 300       # сом/день (вторая кампания, необязательная)
MAX_CPC = 22            # потолок цены клика на старте

errors = []
def L(s, n, what):
    if len(s) > n:
        errors.append(f'{what}: {len(s)}>{n} — {s}')
    return s

# ─────────────────────────────────────────────────────────── тексты (RU)
RU_HEADLINES = [
    'Грузовое такси от 1 500 сом', 'Подача в выбранное время', 'Цена известна до работ',
    '0 скрытых платежей', 'Грузчики в форме и с опытом', 'Работаем с 2015 года',
    'Заявка в WhatsApp 24/7', 'Упаковка и сборка мебели', 'Расчёт стоимости онлайн',
    'Машины до 5 тонн', 'Договор и чек', 'Оплата после работы',
]
RU_DESCRIPTIONS = [
    'Спринтер или газель с грузчиками в выбранное время. Упакуем, перевезём, соберём мебель.',
    'Фиксированная цена после расчёта, 0 скрытых платежей. Оплата после выполнения работ.',
    'Переезды и грузоперевозки по Бишкеку и Чуйской области. Договор и чек. Работаем 7 дней.',
    'Рассчитайте стоимость за минуту и отправьте заявку в WhatsApp. Ответим быстро.',
]

# ─────────────────────────────────────────────────────────── тексты (KG)
KG_HEADLINES = [
    'Бишкекте жүк ташуу',            # грузоперевозки в Бишкеке
    'Жүк такси — 1500 сомдон',       # грузовое такси от 1500
    'Жүкчүлөр менен машина',         # машина с грузчиками
    'Портер, спринтер, газель',
    'Баасы алдын ала белгилүү',      # цена известна заранее
    'Тандаган убакта келебиз',       # приедем в выбранное время
    'WhatsApp аркылуу заказ',        # заказ через WhatsApp
    'Батир көчүрүү кызматы',         # услуга квартирного переезда
    'Эмерек чогултуу 500 сомдон',    # сборка мебели от 500
    '2015-жылдан бери иштейбиз',     # работаем с 2015
    'Жашыруун төлөм жок',            # без скрытых платежей
    'Иштен кийин төлөйсүз',          # платите после работы
]
KG_DESCRIPTIONS = [
    'Жүк ташуучу машина жана жүкчүлөр. Батир, офис көчүрөбүз, эмерек чогултабыз.',
    'Баа сайттагы эсептегичте дароо көрүнөт. Заказ WhatsApp аркылуу, 24 саат.',
    'Бишкек боюнча жүк ташуу: портер, спринтер, 3 жана 5 тонналык унаалар.',
    'Келишим жана чек беребиз. Жүктүн сакталышына толук жооп беребиз.',
]

for h in RU_HEADLINES: L(h, 30, 'RU headline')
for h in KG_HEADLINES: L(h, 30, 'KG headline')
for d in RU_DESCRIPTIONS: L(d, 90, 'RU description')
for d in KG_DESCRIPTIONS: L(d, 90, 'KG description')

# ─────────────────────────────────────────────────────────── группы объявлений
# Тип соответствия: Broad = широкое (охват), Phrase = фразовое (контроль).
# Старт: фразовое по ядру + широкое по самым целевым. После 30 конверсий — больше широкого.
GROUPS = [
    {
        'name': '1 Грузоперевозки и грузовое такси',
        'path': ('gruzoperevozki', 'bishkek'),
        'headlines': ['Грузоперевозки в Бишкеке', 'Грузовое такси Бишкек', 'Грузовое такси с грузчиками'],
        'descriptions': RU_DESCRIPTIONS,
        'keywords': [
            ('грузоперевозки бишкек', 'Broad'), ('грузовое такси бишкек', 'Broad'),
            ('грузоперевозки бишкек', 'Phrase'), ('грузоперевозки по бишкеку', 'Phrase'),
            ('грузоперевозки недорого', 'Phrase'), ('грузовое такси', 'Phrase'),
            ('грузотакси бишкек', 'Phrase'), ('грузовое такси с грузчиками', 'Phrase'),
            ('заказать грузоперевозку', 'Phrase'), ('перевозка мебели бишкек', 'Phrase'),
            ('перевезти холодильник', 'Phrase'), ('перевозка стройматериалов бишкек', 'Phrase'),
            ('перевозка вещей бишкек', 'Phrase'), ('доставка мебели из магазина', 'Phrase'),
        ],
    },
    {
        'name': '2 Портер, спринтер, газель',
        'path': ('porter', 'sprinter'),
        'headlines': ['Заказать портер в Бишкеке', 'Спринтер, газель, портер', 'Портер с грузчиками'],
        'descriptions': RU_DESCRIPTIONS,
        'keywords': [
            ('портер бишкек', 'Broad'), ('заказать газель бишкек', 'Broad'),
            ('такси портер', 'Phrase'), ('портер такси бишкек', 'Phrase'),
            ('портер керек', 'Phrase'), ('заказать портер', 'Phrase'),
            ('портер грузоперевозки', 'Phrase'), ('заказать спринтер бишкек', 'Phrase'),
            ('спринтер грузоперевозки', 'Phrase'), ('газель с грузчиками', 'Phrase'),
            ('газель бишкек заказать', 'Phrase'), ('лабо бишкек', 'Phrase'),
            ('машина для перевозки вещей', 'Phrase'), ('нанять машину для переезда', 'Phrase'),
        ],
    },
    {
        'name': '3 Переезд квартиры и офиса',
        'path': ('pereezd', 'bishkek'),
        'headlines': ['Квартирный переезд Бишкек', 'Переезд под ключ за день', 'Офисный переезд без простоя'],
        'descriptions': RU_DESCRIPTIONS,
        'keywords': [
            ('квартирный переезд бишкек', 'Broad'), ('переезд бишкек', 'Broad'),
            ('квартирный переезд', 'Phrase'), ('переезд квартиры бишкек', 'Phrase'),
            ('услуги переезда бишкек', 'Phrase'), ('переезд с грузчиками', 'Phrase'),
            ('офисный переезд бишкек', 'Phrase'), ('переезд офиса', 'Phrase'),
            ('компания по переезду', 'Phrase'), ('помощь при переезде', 'Phrase'),
        ],
    },
    {
        'name': '4 Грузчики и сборка мебели',
        'path': ('gruzchiki', 'sborka'),
        'headlines': ['Грузчики в Бишкеке', 'Грузчики от 500 сом', 'Сборка мебели с гарантией'],
        'descriptions': RU_DESCRIPTIONS,
        'keywords': [
            ('грузчики бишкек', 'Broad'), ('сборка мебели бишкек', 'Broad'),
            ('грузчик керек', 'Phrase'), ('грузчики керек', 'Phrase'),
            ('услуги грузчиков бишкек', 'Phrase'), ('нанять грузчиков', 'Phrase'),
            ('вызвать грузчиков', 'Phrase'), ('грузчики с машиной', 'Phrase'),
            ('грузчики на час', 'Phrase'), ('подъём мебели на этаж', 'Phrase'),
            ('сборка мебели', 'Phrase'), ('сборщик мебели бишкек', 'Phrase'),
            ('разборка мебели', 'Phrase'), ('сборка кухни бишкек', 'Phrase'),
            ('сборка шкафа бишкек', 'Phrase'),
        ],
    },
    {
        'name': '5 Кыргызча (жүк ташуу)',
        'path': ('juk-tashuu', 'bishkek'),
        'headlines': KG_HEADLINES[:3],
        'descriptions': KG_DESCRIPTIONS,
        'kg': True,
        'keywords': [
            ('жүк ташуу бишкек', 'Broad'), ('жүкчү керек', 'Broad'),
            ('жүк ташуу', 'Phrase'), ('жук ташуу', 'Phrase'),
            ('жүк ташуучу машина', 'Phrase'), ('жук ташуучу машина', 'Phrase'),
            ('жүк такси', 'Phrase'), ('жук такси бишкек', 'Phrase'),
            ('жүкчү керек', 'Phrase'), ('жукчу керек', 'Phrase'),
            ('жүкчүлөр керек', 'Phrase'), ('машина керек жүк ташуу', 'Phrase'),
            ('көчүү үчүн машина', 'Phrase'), ('кочуу учун машина', 'Phrase'),
            ('батир көчүрүү', 'Phrase'), ('батир кочуруу бишкек', 'Phrase'),
            ('үй көчүү бишкек', 'Phrase'), ('эмерек ташуу', 'Phrase'),
            ('эмерек чогултуу', 'Phrase'), ('эмерек чогултуучу керек', 'Phrase'),
            ('портер керек бишкек', 'Phrase'), ('газель керек', 'Phrase'),
        ],
    },
]

# ─────────────────────────────────────────────────────────── минус-слова (RU + KG)
NEGATIVES = [
    # работа и учёба
    'работа', 'вакансия', 'вакансии', 'требуется', 'резюме', 'зарплата', 'подработка', 'ищу работу',
    'курсы', 'обучение', 'жумуш', 'жумуш керек', 'иш издейм', 'айлык',
    # покупка и продажа техники
    'купить', 'продажа', 'продам', 'продается', 'сатылат', 'сатам', 'бу', 'б у', 'запчасти',
    'ремонт', 'шины', 'диски', 'двигатель', 'цена спринтера', 'спринтер купить', 'газель купить',
    'портер купить', 'лизинг', 'кредит', 'рассрочка',
    # не наши услуги и направления
    'карго', 'из китая', 'из россии', 'международные', 'авиа', 'жд', 'контейнер', 'фура',
    'тягач', 'эвакуатор', 'манипулятор', 'кран', 'бетон', 'самосвал', 'вывоз мусора', 'мусор',
    'такси пассажирское', 'пассажирские', 'аренда без водителя', 'прокат',
    # другие города и страны
    'ош', 'жалал абад', 'джалал абад', 'каракол', 'нарын', 'талас', 'баткен', 'иссык куль',
    'алматы', 'казахстан', 'москва', 'россия', 'узбекистан', 'турция',
    # информационные
    'своими руками', 'самостоятельно', 'бесплатно', 'скачать', 'видео', 'фото', 'схема',
    'инструкция', 'форум', 'что такое', 'как стать', 'кандай', 'деген эмне',
]

# ─────────────────────────────────────────────────────────── расширения
SITELINKS = [
    ('Калькулятор стоимости', 'Считайте онлайн за минуту', 'Цена до подачи машины', SITE + '#calc'),
    ('Цены и тарифы', 'Минимальный от 1 500 сом', 'Стандарт и Премиум', SITE + '#prices'),
    ('Автопарк', 'Портер, спринтер, газель', 'Грузовики 3 и 5 тонн', SITE + '#fleet'),
    ('Отзывы клиентов', 'Переезды и сборка мебели', 'Реальные истории', SITE + '#reviews'),
]
CALLOUTS = ['Договор и чек', '0 скрытых платежей', 'Оплата после работы', 'Грузчики в форме',
            'С 2015 года', 'Заявки 24/7', 'Подача в выбранное время', 'Жүкчүлөр менен']
SNIPPET = ('Услуги', ['Квартирный переезд', 'Офисный переезд', 'Грузчики', 'Упаковка',
                      'Сборка мебели', 'Грузовое такси', 'Жүк ташуу'])
for s in SITELINKS:
    L(s[0], 25, 'sitelink'); L(s[1], 35, 'sitelink d1'); L(s[2], 35, 'sitelink d2')
for c in CALLOUTS: L(c, 25, 'callout')
for v in SNIPPET[1]: L(v, 25, 'snippet value')

if errors:
    print('ОШИБКИ ДЛИНЫ:'); [print(' ', e) for e in errors]; sys.exit(1)

# ─────────────────────────────────────────────────────────── CSV для Google Ads Editor
COLS = ['Campaign', 'Campaign Type', 'Campaign Status', 'Budget', 'Budget type', 'Bid Strategy Type',
        'Networks', 'Languages', 'Location', 'Ad Group', 'Ad Group Status', 'Max CPC',
        'Keyword', 'Criterion Type', 'Status', 'Ad type', 'Final URL', 'Path 1', 'Path 2'] + \
       [f'Headline {i}' for i in range(1, 16)] + ['Headline 1 position'] + \
       [f'Description {i}' for i in range(1, 5)] + \
       ['Sitelink text', 'Sitelink description line 1', 'Sitelink description line 2', 'Sitelink final URL',
        'Callout text', 'Structured snippet header', 'Structured snippet values',
        'Phone number', 'Country code', 'Business name']

rows = []
def row(**kw):
    r = {c: '' for c in COLS}; r.update(kw); rows.append(r); return r

MAIN = 'SG | Поиск | Бишкек'
CALL = 'SG | Звонки'

row(Campaign=MAIN, **{'Campaign Type': 'Search', 'Campaign Status': STATUS, 'Budget': BUDGET_MAIN,
    'Budget type': 'Daily', 'Bid Strategy Type': 'Maximize clicks', 'Networks': NETWORK,
    'Languages': 'ru;ky;All', 'Location': LOCATION})
for sl in SITELINKS:
    row(Campaign=MAIN, **{'Sitelink text': sl[0], 'Sitelink description line 1': sl[1],
                          'Sitelink description line 2': sl[2], 'Sitelink final URL': sl[3]})
for co in CALLOUTS:
    row(Campaign=MAIN, **{'Callout text': co})
row(Campaign=MAIN, **{'Structured snippet header': SNIPPET[0], 'Structured snippet values': ';'.join(SNIPPET[1])})
row(Campaign=MAIN, **{'Phone number': PHONE, 'Country code': 'KG'})

for g in GROUPS:
    G = g['name']
    row(Campaign=MAIN, **{'Ad Group': G, 'Ad Group Status': STATUS, 'Max CPC': MAX_CPC})
    for kw, mt in g['keywords']:
        row(Campaign=MAIN, **{'Ad Group': G, 'Keyword': kw, 'Criterion Type': mt, 'Status': STATUS})
    pool = (KG_HEADLINES if g.get('kg') else RU_HEADLINES)
    heads = (g['headlines'] + [h for h in pool if h not in g['headlines']])[:15]
    r = {'Campaign': MAIN, 'Ad Group': G, 'Ad type': 'Responsive search ad', 'Final URL': SITE,
         'Path 1': L(g['path'][0], 15, 'path1'), 'Path 2': L(g['path'][1], 15, 'path2'),
         'Status': STATUS, 'Headline 1 position': '1'}
    for i, h in enumerate(heads, 1): r[f'Headline {i}'] = h
    for i, d in enumerate(g['descriptions'], 1): r[f'Description {i}'] = d
    row(**r)

# вторая кампания: только звонок
row(Campaign=CALL, **{'Campaign Type': 'Search', 'Campaign Status': STATUS, 'Budget': BUDGET_CALL,
    'Budget type': 'Daily', 'Bid Strategy Type': 'Maximize clicks', 'Networks': NETWORK,
    'Languages': 'ru;ky;All', 'Location': LOCATION})
row(Campaign=CALL, **{'Phone number': PHONE, 'Country code': 'KG'})
CALL_G = 'Звонок сейчас'
row(Campaign=CALL, **{'Ad Group': CALL_G, 'Ad Group Status': STATUS, 'Max CPC': 30})
CALL_KW = [('грузоперевозки бишкек', 'Phrase'), ('грузовое такси', 'Phrase'), ('портер керек', 'Phrase'),
           ('грузчик керек', 'Phrase'), ('жүк ташуу', 'Phrase'), ('жүкчү керек', 'Phrase'),
           ('заказать газель', 'Phrase'), ('переезд бишкек', 'Phrase')]
for kw, mt in CALL_KW:
    row(Campaign=CALL, **{'Ad Group': CALL_G, 'Keyword': kw, 'Criterion Type': mt, 'Status': STATUS})
row(Campaign=CALL, **{'Ad Group': CALL_G, 'Ad type': 'Call ad', 'Final URL': SITE, 'Phone number': PHONE,
    'Country code': 'KG', 'Business name': 'Sprinter Go', 'Status': STATUS,
    'Headline 1': L('Грузоперевозки в Бишкеке', 30, 'call h1'),
    'Headline 2': L('Машина и грузчики сейчас', 30, 'call h2'),
    'Description 1': L('Подача в выбранное время. Цена известна до начала работ. Звоните.', 90, 'call d1'),
    'Description 2': L('Жүк ташуу, жүкчүлөр, көчүү. Чалыңыз — дароо жооп беребиз.', 90, 'call d2')})

for n in NEGATIVES:
    for c in (MAIN, CALL):
        row(Campaign=c, **{'Keyword': n, 'Criterion Type': 'Negative Phrase', 'Status': 'Enabled'})

def write_csv(name, data, cols):
    with io.open(os.path.join(OUT, name), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader()
        for r in data: w.writerow({c: r.get(c, '') for c in cols})

write_csv('google-ads-import.csv', rows, COLS)
write_csv('keywords.csv', [r for r in rows if r['Keyword'] and 'Negative' not in r['Criterion Type']],
          ['Campaign', 'Ad Group', 'Keyword', 'Criterion Type', 'Status'])
write_csv('negative-keywords.csv', [r for r in rows if 'Negative' in r['Criterion Type']],
          ['Campaign', 'Keyword', 'Criterion Type', 'Status'])
write_csv('ads.csv', [r for r in rows if r['Ad type']],
          ['Campaign', 'Ad Group', 'Ad type', 'Final URL', 'Path 1', 'Path 2'] +
          [f'Headline {i}' for i in range(1, 16)] + [f'Description {i}' for i in range(1, 5)] +
          ['Phone number', 'Country code', 'Business name', 'Status'])

# ─────────────────────────────────────────────────────────── файлы для копипаста в веб-интерфейс
def paste(name, text):
    with io.open(os.path.join(PASTE, name), 'w', encoding='utf-8') as f:
        f.write(text)

for i, g in enumerate(GROUPS, 1):
    lines = []
    for kw, mt in g['keywords']:
        lines.append(f'"{kw}"' if mt == 'Phrase' else kw)   # кавычки = фразовое, без = широкое
    paste(f'{i}-keywords-{g["path"][0]}.txt', '\n'.join(lines) + '\n')
paste('negatives.txt', '\n'.join(f'"{n}"' for n in NEGATIVES) + '\n')
paste('call-keywords.txt', '\n'.join(f'"{k}"' for k, _ in CALL_KW) + '\n')

ad_txt = ['# Тексты объявлений (копировать в Google Ads → Объявления)\n']
for g in GROUPS:
    pool = (KG_HEADLINES if g.get('kg') else RU_HEADLINES)
    heads = (g['headlines'] + [h for h in pool if h not in g['headlines']])[:15]
    ad_txt.append(f'\n## Группа: {g["name"]}\nURL: {SITE}   Путь: /{g["path"][0]}/{g["path"][1]}\n\nЗаголовки:')
    ad_txt += [f'{i:2}. {h}   ({len(h)})' for i, h in enumerate(heads, 1)]
    ad_txt.append('\nОписания:')
    ad_txt += [f'{i:2}. {d}   ({len(d)})' for i, d in enumerate(g['descriptions'], 1)]
ad_txt.append('\n## Расширения (уровень кампании)\n\nДополнительные ссылки:')
ad_txt += [f'- {s[0]} | {s[1]} | {s[2]} | {s[3]}' for s in SITELINKS]
ad_txt.append('\nУточнения: ' + ' · '.join(CALLOUTS))
ad_txt.append(f'Структурированное описание — {SNIPPET[0]}: ' + ', '.join(SNIPPET[1]))
ad_txt.append(f'Номер телефона: {PHONE}')
paste('ads-text.txt', '\n'.join(ad_txt) + '\n')

kw_total = len([r for r in rows if r['Keyword'] and 'Negative' not in r['Criterion Type']])
broad = len([r for r in rows if r['Criterion Type'] == 'Broad'])

# ─────────────────────────────────────────────────────────── план
plan = f"""# Google Ads для sprintergo.kg — запуск под 1 000–1 500 сом в день

Две кампании, {len(GROUPS) + 1} групп, {kw_total} ключевых фраз (русский + кыргызский), {len(NEGATIVES)} минус-слов.
Всё импортируется **на паузе**: сначала проверяете, потом включаете.

## Почему именно так

При бюджете 1 000–1 500 сом дробить деньги на пять кампаний нельзя — ни одна не наберёт статистику,
и алгоритм Google не обучится. Поэтому весь бюджет в одной поисковой кампании: внутри неё Google сам
перераспределяет показы на то, что приносит заявки. Вторая кампания (только звонок) — маленькая и
необязательная, включайте её на второй неделе.

| Кампания | Бюджет/день | Включать |
|---|---|---|
| SG · Поиск · Бишкек | {BUDGET_MAIN} сом | сразу |
| SG · Звонки | {BUDGET_CALL} сом | со второй недели, если нужны звонки |
| **Итого** | **{BUDGET_MAIN + BUDGET_CALL} сом** | при бюджете 1 000 сом ставьте {BUDGET_MAIN} → 1 000 и вторую не включайте |

## Группы и язык

| Группа | Про что | Ключей |
{chr(10).join(f'| {g["name"]} | {g["path"][0]} | {len(g["keywords"])} |' for g in GROUPS)}

Кыргызские запросы вынесены в отдельную группу с объявлениями на кыргызском — это заметно поднимает
CTR у кыргызоязычной аудитории. Учтены варианты без диакритики («жук ташуу» наряду с «жүк ташуу»),
смешанные запросы («грузчик керек», «портер керек», «такси портер») и латиница брендов машин.

**Важно про язык в настройках**: таргетинг языка в Google Ads смотрит на язык интерфейса браузера,
а не на язык запроса. У большинства в Бишкеке браузер русский, даже если ищут по-кыргызски.
Поэтому в кампании ставьте **все языки** — иначе потеряете половину кыргызских запросов.

## Охват: типы соответствия

{broad} фраз идут **широким** соответствием (максимальный охват), остальные — **фразовым** (контроль).
Такой микс даёт объём, но не пускает бюджет в мусор. Через 2–3 недели, когда наберётся 30+ конверсий,
переведите больше ключей в широкое и переключите стратегию на «Максимум конверсий».

## Порядок запуска

1. **Конверсии сначала, реклама потом.** Без отслеживания Google не понимает, какие клики дают заявки,
   и просто тратит деньги. В Google Ads → Цели → Конверсии создайте три действия: WhatsApp (ценность 300 сом),
   Звонок (300 сом), Заявка из калькулятора (500 сом). Скопируйте тег `AW-XXXXXXXXX` и три ярлыка,
   вставьте в `index.html` перед `</body>` — заготовка там уже есть. Сайт сам отправляет события
   `lead_whatsapp`, `lead_call`, `lead_form`.
2. **Импорт.** Google Ads Editor → Аккаунт → Импорт → из файла → `google-ads-import.csv` → Опубликовать.
   Если Editor заупрямится — в папке `paste/` лежат готовые списки: создаёте кампанию руками и вставляете
   ключи целыми блоками (кавычки = фразовое соответствие, без кавычек = широкое), тексты берёте из `ads-text.txt`.
3. **Проверьте настройки кампании** (после импорта, в веб-интерфейсе):
   - Местоположение: Бишкек + радиус 30 км, Чуйская область. Присутствие: «Люди в целевом местоположении».
   - Языки: **все** (см. выше).
   - Сети: только Поиск. Партнёров поиска и КМС выключить.
   - Устройства: мобильные +20 %.
   - Расписание: круглосуточно (заявки в WhatsApp приходят и ночью).
   - Стратегия: «Максимум кликов», предельная цена клика {MAX_CPC} сом.
4. **Включайте.** Кампанию, группы и объявления снять с паузы.

## Первые две недели

- **Поисковые запросы** — раз в 2 дня. Всё лишнее сразу в минус-слова. Это главный рычаг экономии.
- **Цена заявки**: норма для Бишкека 150–400 сом. Дороже 600 сом — снижайте ставку или отключайте ключ.
- **Стратегию не трогайте** чаще раза в две недели: алгоритму нужно время.
- После 30 конверсий переключите на «Максимум конверсий» — цена заявки обычно падает на 20–40 %.

## Что ещё поднимет отдачу

- **Google Business Profile** — бесплатные показы на Картах по запросу «грузоперевозки рядом».
  Для гео-бизнеса это часто даёт больше заявок, чем платная реклама.
- **Кыргызская версия сайта** — сейчас сайт только на русском. Кыргызоязычный посетитель с кыргызского
  объявления попадает на русскую страницу. В Бишкеке это не критично, но отдельная страница на кыргызском
  подняла бы конверсию этой группы. Могу сделать.
- **Отзывы на карточке Google** — 10+ отзывов заметно повышают CTR объявлений.
"""
with io.open(os.path.join(OUT, 'google-ads-plan.md'), 'w', encoding='utf-8') as f:
    f.write(plan)

print(f'OK | кампаний 2 | групп {len(GROUPS) + 1} | ключей {kw_total} (широких {broad}) | '
      f'минус-слов {len(NEGATIVES)} | объявлений {len([r for r in rows if r["Ad type"]])} | строк {len(rows)}')
