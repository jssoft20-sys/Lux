#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Google Ads — файлы для массовой загрузки через ВЕБ-интерфейс (Инструменты → Массовые действия → Загрузки).

Один файл = одна сущность, имена колонок строго по шаблонам Google (сентябрь 2026).
Загружать строго по порядку номеров в имени файла.

Источник данных — тот же ads_kit.py (те же группы, ключи, тексты).
Выход: ads/upload/*.csv
"""
import csv, io, os, re, sys, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'ads', 'upload')
os.makedirs(OUT, exist_ok=True)

# ── берём данные из ads_kit.py, не дублируя их ───────────────────────────────
spec = importlib.util.spec_from_file_location('ads_kit', os.path.join(ROOT, 'tools', 'ads_kit.py'))
kit = importlib.util.module_from_spec(spec)
_stdout = sys.stdout
sys.stdout = io.StringIO()          # ads_kit печатает отчёт — глушим
try:
    spec.loader.exec_module(kit)
finally:
    sys.stdout = _stdout

GROUPS = kit.GROUPS
NEGATIVES = kit.NEGATIVES
RU_HEADLINES, RU_DESCRIPTIONS = kit.RU_HEADLINES, kit.RU_DESCRIPTIONS
KG_HEADLINES, KG_DESCRIPTIONS = kit.KG_HEADLINES, kit.KG_DESCRIPTIONS
SITELINKS, CALLOUTS = kit.SITELINKS, kit.CALLOUTS
SITE, PHONE = kit.SITE, kit.PHONE
CURRENCY, KGS_PER_USD = kit.CURRENCY, kit.KGS_PER_USD
BUDGET_KGS, MAX_CPC_KGS = kit.BUDGET_KGS, kit.MAX_CPC_KGS
MAX_CPC, fmt = kit.MAX_CPC, kit.fmt

CAMPAIGN = 'SG Поиск Бишкек'          # без | — символ мешает в некоторых таблицах
NEG_LIST = 'SG минус-слова'
BUDGET = kit.BUDGET_MAIN     # в валюте аккаунта, не в сомах
STATUS = 'Paused'                      # всё создаётся на паузе
LANGUAGES = 'ru;ky;en'                 # покрывает язык браузера у жителей Бишкека
LOCATION = 'Bishkek, Kyrgyzstan'
MATCH = {'Broad': 'Broad match', 'Phrase': 'Phrase match', 'Exact': 'Exact match'}
BAD_CHARS = re.compile(r'[!@%,*]')

problems = []

def write(name, header, rows):
    path = os.path.join(OUT, name)
    with io.open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(header)
        for r in rows:
            w.writerow(r)
    return name, len(rows)

report = []

# ── 1. Кампания ──────────────────────────────────────────────────────────────
report.append(write('1-kampaniya.csv',
    ['Action', 'Campaign status', 'Campaign', 'Campaign type', 'Networks',
     'Budget', 'Budget type', 'Bid strategy type', 'Language', 'Location'],
    [['Add', STATUS, CAMPAIGN, 'Search', 'Google search',
      BUDGET, 'Daily', 'Maximize clicks', LANGUAGES, LOCATION]]))

# ── 2. Группы объявлений ─────────────────────────────────────────────────────
report.append(write('2-gruppy.csv',
    ['Action', 'Campaign', 'Ad group', 'Status'],
    [['Add', CAMPAIGN, g['name'], STATUS] for g in GROUPS]))

# ── 3. Ключевые слова ────────────────────────────────────────────────────────
kw_rows = []
seen = set()
for g in GROUPS:
    for kw, mt in g['keywords']:
        if BAD_CHARS.search(kw):
            problems.append(f'запрещённый символ в ключе: {kw}')
        key = (g['name'], kw, mt)
        if key in seen:
            problems.append(f'дубль ключа: {kw} ({mt}) в {g["name"]}')
            continue
        seen.add(key)
        kw_rows.append(['Add', STATUS, CAMPAIGN, g['name'], kw, MATCH[mt]])
report.append(write('3-klyuchevye-slova.csv',
    ['Action', 'Keyword status', 'Campaign', 'Ad group', 'Keyword', 'Match Type'], kw_rows))

# ── 4. Адаптивные поисковые объявления ───────────────────────────────────────
# ВНИМАНИЕ: первое описание — колонка «Description», без единицы. Так в шаблоне Google.
ad_header = (['Action', 'Ad status', 'Campaign', 'Ad group', 'Ad type'] +
             [f'Headline {i}' for i in range(1, 16)] +
             ['Description', 'Description 2', 'Description 3', 'Description 4',
              'Path 1', 'Path 2', 'Final URL'])
ad_rows = []
for g in GROUPS:
    pool = KG_HEADLINES if g.get('kg') else RU_HEADLINES
    heads = (g['headlines'] + [h for h in pool if h not in g['headlines']])[:15]
    heads += [''] * (15 - len(heads))
    descs = (g['descriptions'] + [''] * 4)[:4]
    for h in heads:
        if h and len(h) > 30:
            problems.append(f'заголовок >30: {h}')
    for d in descs:
        if d and len(d) > 90:
            problems.append(f'описание >90: {d}')
    if len([h for h in heads if h]) < 3 or len([d for d in descs if d]) < 2:
        problems.append(f'мало ассетов в группе {g["name"]}')
    ad_rows.append(['Add', STATUS, CAMPAIGN, g['name'], 'Responsive search ad'] +
                   heads + descs + [g['path'][0], g['path'][1], SITE])
report.append(write('4-obyavleniya.csv', ad_header, ad_rows))

# ── 5. Список минус-слов ─────────────────────────────────────────────────────
report.append(write('5-minus-slova.csv',
    ['Action', 'Negative keyword list name', 'Negative keyword', 'Keyword or list', 'Match type'],
    [['Add', NEG_LIST, n, 'Keyword', 'Phrase match'] for n in NEGATIVES]))

# ── 6. Привязка списка минус-слов к кампании ─────────────────────────────────
# В колонке «Negative keyword» указывается ИМЯ СПИСКА, а «Keyword or list» = List.
report.append(write('6-privyazka-minus-slov.csv',
    ['Action', 'Negative keyword', 'Keyword or list', 'Campaign'],
    [['Add', NEG_LIST, 'List', CAMPAIGN]]))

# ── 7. Дополнительные ссылки ─────────────────────────────────────────────────
report.append(write('7-dop-ssylki.csv',
    ['Row Type', 'Action', 'Asset action', 'Level', 'Campaign', 'Ad group',
     'Sitelink text', 'Final URL', 'Description', 'Description 2'],
    [['Sitelink', 'Add', 'Create new', 'Campaign', CAMPAIGN, '', s[0], s[3], s[1], s[2]]
     for s in SITELINKS]))

# ── 8. Уточнения ─────────────────────────────────────────────────────────────
report.append(write('8-utochneniya.csv',
    ['Row type', 'Action', 'Campaign', 'Ad group', 'Callout text'],
    [['Callout extension', 'add', CAMPAIGN, '', c] for c in CALLOUTS]))

# ── памятка ──────────────────────────────────────────────────────────────────
readme = f"""# Массовая загрузка в Google Ads через браузер

Google Ads Editor не нужен. Всё заливается из браузера, в том числе из Safari на iPhone
в режиме «Запросить сайт для ПК».

## Куда загружать

Обычный аккаунт: страница **Кампании** (или Группы объявлений / Объявления / Ключевые слова)
→ значок **три точки** над таблицей → значок загрузки → выбрать файл → **Просмотр** → **Применить**.

Управляющий аккаунт: **Инструменты → Массовые действия → Загрузки → «+»**.

## Порядок загрузки — строго такой

Файлы ссылаются друг на друга по имени кампании и группы, поэтому порядок обязателен.
Загрузите ключи раньше групп — получите ошибку «ad group not found».

| № | Файл | Что создаёт | Строк |
|---|---|---|---|
{chr(10).join(f'| {i + 1} | `{n}` | — | {c} |' for i, (n, c) in enumerate(report))}

## Валюта — читайте до загрузки

Google Ads не поддерживает сом. Аккаунт для Кыргызстана заводится в **{CURRENCY}**, и сменить
валюту после создания аккаунта нельзя. Поэтому в файле `1-kampaniya.csv` бюджет записан
как **{BUDGET}** — это {BUDGET_KGS} сом по курсу {KGS_PER_USD}.

Если бы там стояло 1200, Google понял бы это как {fmt(1200) if CURRENCY == 'USD' else '1200'} в день,
то есть {1200 * (1 if CURRENCY == 'KGS' else KGS_PER_USD):,.0f} сом. Перед «Применить» посмотрите
в предпросмотре, какая сумма попала в бюджет.

Курс сдвинулся — поправьте `KGS_PER_USD` в `tools/ads_kit.py` и перегенерируйте файлы.

## Важное

- **Всё создаётся на паузе.** Включите кампанию вручную после проверки — так бюджет
  не начнёт тратиться до того, как вы всё посмотрите.
- **Нажимайте «Просмотр» перед «Применить».** Предпросмотр показывает, что именно будет
  создано, и ловит ошибки. Учтите: предпросмотр показывает первые 1 000 строк, а применяются все.
- **Тип соответствия задан отдельной колонкой `Match Type`**, а не кавычками в ключе.
  Так надёжнее: кавычки в CSV легко ломаются при открытии в Excel.
- **Откат есть**: Инструменты → Массовые действия → Все массовые действия → «Отменить».
  Работает один раз и не возвращает удалённые объекты.

## После загрузки доделайте руками (файлами это не задаётся)

1. **Чуйская область** в местоположениях кампании (в файле только Бишкек).
   Там же проверьте: «Люди в целевом местоположении», а не «интересующиеся».
2. **Языки** — при желании поставьте «все языки» для максимального охвата
   (в файле стоят русский, кыргызский, английский).
3. **Ассет «Номер телефона»**: Объявления и ассеты → Ассеты → «+» → Номер телефона →
   {PHONE}, страна Кыргызстан. Отдельных объявлений «только звонок» с февраля 2026 больше нет.
4. **Структурированное описание**, тип «Услуги»: Квартирный переезд, Офисный переезд,
   Грузчики, Упаковка, Сборка мебели, Грузовое такси, Жүк ташуу.
5. **Корректировка для мобильных** +20 %.
6. **Предел цены клика {fmt(MAX_CPC)}** ({MAX_CPC_KGS} сом): кампания → Настройки → Ставки →
   «Максимум кликов» → галочка «Установить предельную цену за клик» → {MAX_CPC}.
   Файлом это не задаётся: при стратегии «Максимум кликов» предел живёт на уровне кампании.
7. **Конверсии** — если ещё не настроены, сделайте до включения кампании. Ценность конверсии
   тоже вводится в валюте аккаунта: {fmt(kit.money(300))} за WhatsApp и звонок,
   {fmt(kit.money(500))} за заявку из калькулятора.

## Если файл не принимается

- Первая строка файла должна быть строкой заголовков. Ничего выше неё быть не должно.
- URL только полный, с https://
- Имя кампании в файлах 2–8 должно совпадать с файлом 1 посимвольно: **{CAMPAIGN}**
- Скачайте официальный шаблон внутри интерфейса (Инструменты → Массовые действия →
  Загрузки → «+» → ссылка «воспользуйтесь шаблонами») и сверьте заголовки колонок.
"""
with io.open(os.path.join(OUT, 'КАК-ЗАГРУЖАТЬ.md'), 'w', encoding='utf-8') as f:
    f.write(readme)

print('Файлы для массовой загрузки:', OUT)
for n, c in report:
    print(f'  {n:32} {c:4} строк')
print('проблем:', len(problems))
for p in problems[:10]:
    print('  !', p)
