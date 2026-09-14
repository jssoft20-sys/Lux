# -*- coding: utf-8 -*-
"""Карточка заказа для мессенджера: картинка 1200×630 и страница с Open Graph.

Человек кидает ссылку на заказ в WhatsApp или Телеграм — и там должна появиться
карточка с маршрутом и статусом, а не голая строка с адресом. Мессенджер приходит
за превью роботом: без cookie, без токена отслеживания и без второго шанса. Поэтому
здесь всё считается из одного public_id и показывается ровно то, что не стыдно
увидеть постороннему: статус, город, улицы без номеров домов, расстояние, время
и машина. Ни телефонов, ни квартир, ни имени клиента — их тут нет даже в разметке.

Картинку рисуем сами, пиксель за пикселем: сторонних библиотек в проекте нет, а
PNG — формат простой. Восьмибитный RGB, фильтр строк нулевой, сжатие zlib из
стандартной библиотеки. Шрифт тоже свой: таблица растровых глифов 5×7 на русские,
кыргызские и латинские буквы, цифры и знаки, которая масштабируется целым числом.
Текст на карточке — прописными: так растровый шрифт читается крупно и ровно.

Два адреса у карточки, и это не прихоть:
    /share/AB12CD        короткая ссылка, её и отправляют людям
    /api/v1/share/AB12CD то же самое через обычный роутер
Ядро отдаёт в роутер только пути /api/…, поэтому короткий адрес подключается
через отдачу статики — см. hook_static() внизу файла. Язык в короткой ссылке
задаётся хвостом пути: /share/AB12CD.ky, потому что до строки запроса на этом
пути мы не дотягиваемся.
"""
import gzip
import hashlib
import html as html_mod
import math
import os
import re
import struct
import threading
import time
import zlib

from . import db, i18n_server as i18n, settings
from .core import LIMIT, Router, log

API = '/api/v1'
router = Router()

# Размер карточки: 1200×630 — то, что ждут и Телеграм, и WhatsApp, и Фейсбук.
CARD_W, CARD_H = 1200, 630

# Минута кэша. Статус заказа меняется куда чаще, но мессенджеры дёргают превью
# пачками, и пересобирать картинку на каждый запрос незачем.
TTL_S = 60

# Сколько карточек держим в памяти. Одна картинка — около 60 КБ, полтораста
# заказов в минуту у нас не бывает, но предел всё равно нужен.
CACHE_MAX = 150

# Сколько запросов с одного адреса в минуту доходит до сборки карточки.
# Попадания в кэш не считаем: мессенджер часто ходит десятком роботов сразу.
BUILD_PER_MIN = 60

# Номер заказа: буквы и цифры без путаницы, восемь знаков (см. public.py).
PID_RX = re.compile(r'^[0-9A-Z]{4,16}$')

# Короткий путь: /share/AB12CD, /share/AB12CD.ky, /share/AB12CD.png
PATH_RX = re.compile(r'^/share/([0-9A-Za-z]{4,16})(?:\.(ru|ky))?(\.png)?/?$')

# Адрес сайта, каким его видит посетитель. Проверяем строго: значение уходит
# в мета-теги, а Host приходит снаружи и доверять ему нельзя.
HOST_RX = re.compile(r'^[A-Za-z0-9.\-]{1,200}(:\d{1,5})?$')


# ─────────────────────────────────────────────────────────────── тексты

# Свои строки модуль приносит сам: общий словарь правят соседние экраны.
# Кыргызский — как говорят в Бишкеке, а не подстрочник с русского.
TEXTS = {
    'ru': {
        'share.brand_sub': 'Грузоперевозки',
        'share.order': 'Заказ',
        'share.from': 'Откуда',
        'share.to': 'Куда',
        'share.distance': 'Расстояние',
        'share.eta': 'В пути',
        'share.car': 'Машина',
        'share.stops': 'Точек в маршруте',
        'share.open': 'Открыть отслеживание',
        'share.order_own': 'Заказать машину',
        'share.made_at': 'Оформлен {when}',
        'share.note': 'По этой ссылке видно только статус заказа. '
                      'Адреса с номером дома, телефоны и данные клиента по ней не показываются.',
        'share.lang_other': 'Кыргызча',
        'share.nothing': '—',
        'share.approx': 'примерно {value}',

        'share.title.draft': 'Заказ оформляется',
        'share.title.searching': 'Ищем машину',
        'share.title.assigned': 'Машина назначена',
        'share.title.to_pickup': 'Машина едет за грузом',
        'share.title.at_pickup': 'Грузимся',
        'share.title.in_transit': 'Заказ в пути',
        'share.title.at_dropoff': 'Разгружаемся',
        'share.title.done': 'Заказ доставлен',
        'share.title.cancelled': 'Заказ отменён',
        'share.title.expired': 'Машина не нашлась',

        'share.desc.head': '{status} · {city}',
        'share.desc.route': '{a} → {b}',
        'share.desc.tail': '{distance}, {duration}',
        'share.page_title': '{status} · заказ {pid} · {service}',

        'share.404.title': 'Заказ не найден',
        'share.404.text': 'Похоже, ссылка устарела или в ней потерялся символ. '
                          'Попросите отправителя прислать её ещё раз.',
        'share.404.short': 'Ссылка устарела или в ней ошибка',
        'share.404.btn': 'Открыть {service}',
    },
    'ky': {
        'share.brand_sub': 'Жүк ташуу',
        'share.order': 'Заказ',
        'share.from': 'Кайдан',
        'share.to': 'Кайда',
        'share.distance': 'Аралык',
        'share.eta': 'Жолдо',
        'share.car': 'Унаа',
        'share.stops': 'Маршруттагы чекиттер',
        'share.open': 'Байкоону ачуу',
        'share.order_own': 'Унаа чакыруу',
        'share.made_at': '{when} берилген',
        'share.note': 'Бул шилтемеде заказдын абалы гана көрүнөт. '
                      'Үйдүн номери, телефондор жана кардардын маалыматы көрсөтүлбөйт.',
        'share.lang_other': 'Русский',
        'share.nothing': '—',
        'share.approx': 'болжол менен {value}',

        'share.title.draft': 'Заказ даярдалууда',
        'share.title.searching': 'Унаа издеп жатабыз',
        'share.title.assigned': 'Унаа дайындалды',
        'share.title.to_pickup': 'Унаа жүккө бара жатат',
        'share.title.at_pickup': 'Жүктөп жатабыз',
        'share.title.in_transit': 'Заказ жолдо',
        'share.title.at_dropoff': 'Түшүрүп жатабыз',
        'share.title.done': 'Заказ жеткирилди',
        'share.title.cancelled': 'Заказ жокко чыгарылды',
        'share.title.expired': 'Унаа табылган жок',

        'share.desc.head': '{status} · {city}',
        'share.desc.route': '{a} → {b}',
        'share.desc.tail': '{distance}, {duration}',
        'share.page_title': '{status} · {pid} заказы · {service}',

        'share.404.title': 'Заказ табылган жок',
        'share.404.text': 'Шилтеме эскирип калган го, же бир белги жоголгон. '
                          'Жибергенден кайра сурап коюңуз.',
        'share.404.short': 'Шилтеме эскирген же ката кеткен',
        'share.404.btn': '{service} ачуу',
    },
}


def say(key, lang='ru', **vars):
    """Свой текст по ключу. Нет перевода — отдаём русский, нет ключа — сам ключ."""
    lang = i18n.norm_lang(lang)
    text = TEXTS.get(lang, {}).get(key) or TEXTS['ru'].get(key)
    if text is None:
        return key
    try:
        return text.format(**vars) if vars else text
    except (KeyError, IndexError, ValueError):
        return text


def status_title(status, lang='ru'):
    """Заголовок карточки по статусу. Свой, крупный: «Заказ в пути» читается
    лучше сухого «В пути» из общего словаря статусов."""
    key = 'share.title.%s' % (status or 'draft')
    if key in TEXTS['ru']:
        return say(key, lang)
    return i18n.status_name(status, lang)


# Цвет заголовка и точки: жёлтый — работа идёт, зелёный — доехали, красный — нет.
TONE = {
    'done': 'ok',
    'cancelled': 'err',
    'expired': 'err',
}


# ─────────────────────────────────────────────────────────────── данные заказа

# Номер дома в конце строки: «Киевская 120», «Чуй, 12/1», «Ахунбаева 45а».
HOUSE_RX = re.compile(r'[\s,]+(д\.?\s*|дом\s*)?\d+\s*[а-яёa-z]?(\s*[/\-]\s*\d+\s*[а-яёa-z]?)?$',
                      re.IGNORECASE)


def soft_addr(addr):
    """Адрес без точного дома: постороннему показываем улицу, а не подъезд клиента.

    Геокодер отдаёт заголовок вида «Киевская, 120» или название места («ЦУМ»),
    квартира и подъезд лежат отдельными полями и сюда не попадают вовсе.
    """
    text = str(addr or '').strip()
    if not text:
        return ''
    head = text.split(',')[0].strip()
    short = HOUSE_RX.sub('', head).strip(' ,.-')
    return short or head


def _car_of(order, lang):
    """Машина: марка и госномер, если курьер назначен, иначе название тарифа.

    Номер машины — вещь уличная, его видит любой прохожий, поэтому показывать
    его не стыдно; имя и телефон курьера сюда не попадают вовсе.
    """
    if order.get('courier_id'):
        car = db.row('SELECT car_model, car_plate FROM couriers WHERE user_id=?',
                     (order['courier_id'],))
        if car:
            model = str(car.get('car_model') or '').strip()
            plate = str(car.get('car_plate') or '').strip().upper()
            if model or plate:
                return model, plate
    if order.get('tariff_id'):
        tariff = db.row('SELECT name_ru, name_ky FROM tariffs WHERE id=?', (order['tariff_id'],))
        if tariff:
            name = tariff.get('name_ky' if i18n.norm_lang(lang) == 'ky' else 'name_ru')
            if name:
                return str(name), ''
    return '', ''


def card_data(pid, lang=None):
    """Выжимка по заказу для карточки. None — такого заказа нет.

    Всё лишнее отсекаем прямо здесь, в одном месте: дальше по коду чувствительным
    полям взяться уже неоткуда, и случайно вывести телефон в разметку не получится.
    """
    order = db.row('SELECT public_id, status, lang, points, distance_m, duration_s, '
                   '       courier_id, tariff_id, created_at '
                   'FROM orders WHERE public_id=?', (pid,))
    if not order:
        return None

    lang = i18n.norm_lang(lang or order.get('lang') or 'ru')
    points = db.jload(order.get('points'), []) or []
    addrs = [soft_addr(p.get('addr')) for p in points if isinstance(p, dict)]
    addrs = [a for a in addrs if a]
    distance_m = int(order.get('distance_m') or 0)
    duration_s = int(order.get('duration_s') or 0)
    status = str(order.get('status') or 'draft')
    model, plate = _car_of(order, lang)

    return {
        'pid': str(order['public_id']),
        'lang': lang,
        'status': status,
        'tone': TONE.get(status, 'accent'),
        'title': status_title(status, lang),
        'city': str(settings.get('service.city', 'Бишкек') or ''),
        'service': str(settings.get('service.name', 'Sprinter Go') or 'Sprinter Go'),
        'phone': str(settings.get('service.phone', '') or ''),
        'from': addrs[0] if addrs else '',
        'to': addrs[-1] if len(addrs) > 1 else '',
        'stops': len(points),
        'distance_m': distance_m,
        'duration_s': duration_s,
        'distance': i18n.fmt_distance(distance_m, lang) if distance_m else '',
        'duration': i18n.fmt_duration(duration_s, lang) if duration_s else '',
        'car_model': model,
        'car_plate': plate,
        'car': ' · '.join(p for p in (model, plate) if p),
        'created_at': int(order.get('created_at') or 0),
        'at': db.now(),
    }


# ─────────────────────────────────────────────────────────────── растровый шрифт

FONT_W, FONT_H = 5, 7

# Глифы 5×7: семь строк по пять знаков, «#» — закрашенный пиксель.
# Только прописные: на карточке весь текст идёт капителью, так растровые буквы
# получаются ровными и читаются с превью размером в ноготь.
GLYPHS_SRC = {
    '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
    '1': '..#../.##../..#../..#../..#../..#../.###.',
    '2': '.###./#...#/....#/...#./..#../.#.../#####',
    '3': '#####/...#./..#../...#./....#/#...#/.###.',
    '4': '...#./..##./.#.#./#..#./#####/...#./...#.',
    '5': '#####/#..../####./....#/....#/#...#/.###.',
    '6': '..##./.#.../#..../####./#...#/#...#/.###.',
    '7': '#####/....#/...#./..#../.#.../.#.../.#...',
    '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
    '9': '.###./#...#/#...#/.####/....#/...#./.##..',

    'A': '.###./#...#/#...#/#####/#...#/#...#/#...#',
    'B': '####./#...#/#...#/####./#...#/#...#/####.',
    'C': '.###./#...#/#..../#..../#..../#...#/.###.',
    'D': '####./#...#/#...#/#...#/#...#/#...#/####.',
    'E': '#####/#..../#..../####./#..../#..../#####',
    'F': '#####/#..../#..../####./#..../#..../#....',
    'G': '.###./#...#/#..../#.###/#...#/#...#/.####',
    'H': '#...#/#...#/#...#/#####/#...#/#...#/#...#',
    'I': '.###./..#../..#../..#../..#../..#../.###.',
    'J': '..###/...#./...#./...#./...#./#..#./.##..',
    'K': '#...#/#..#./#.#../##.../#.#../#..#./#...#',
    'L': '#..../#..../#..../#..../#..../#..../#####',
    'M': '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
    'N': '#...#/##..#/#.#.#/#.#.#/#..##/#...#/#...#',
    'O': '.###./#...#/#...#/#...#/#...#/#...#/.###.',
    'P': '####./#...#/#...#/####./#..../#..../#....',
    'Q': '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
    'R': '####./#...#/#...#/####./#.#../#..#./#...#',
    'S': '.###./#...#/#..../.###./....#/#...#/.###.',
    'T': '#####/..#../..#../..#../..#../..#../..#..',
    'U': '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
    'V': '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
    'W': '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
    'X': '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
    'Y': '#...#/#...#/.#.#./..#../..#../..#../..#..',
    'Z': '#####/....#/...#./..#../.#.../#..../#####',

    'А': '.###./#...#/#...#/#####/#...#/#...#/#...#',
    'Б': '#####/#..../#..../####./#...#/#...#/####.',
    'В': '####./#...#/#...#/####./#...#/#...#/####.',
    'Г': '#####/#..../#..../#..../#..../#..../#....',
    'Д': '.####/.#..#/.#..#/.#..#/.#..#/#####/#...#',
    'Е': '#####/#..../#..../####./#..../#..../#####',
    'Ё': '.#.#./#####/#..../####./#..../#..../#####',
    'Ж': '#.#.#/#.#.#/.###./..#../.###./#.#.#/#.#.#',
    'З': '####./....#/....#/.###./....#/....#/####.',
    'И': '#...#/#...#/#..##/#.#.#/##..#/#...#/#...#',
    'Й': '.###./#...#/#..##/#.#.#/##..#/#...#/#...#',
    'К': '#...#/#..#./#.#../##.../#.#../#..#./#...#',
    'Л': '..###/.#..#/.#..#/.#..#/.#..#/.#..#/#...#',
    'М': '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
    'Н': '#...#/#...#/#...#/#####/#...#/#...#/#...#',
    'О': '.###./#...#/#...#/#...#/#...#/#...#/.###.',
    'П': '#####/#...#/#...#/#...#/#...#/#...#/#...#',
    'Р': '####./#...#/#...#/####./#..../#..../#....',
    'С': '.###./#...#/#..../#..../#..../#...#/.###.',
    'Т': '#####/..#../..#../..#../..#../..#../..#..',
    'У': '#...#/#...#/.#.#./..#../..#../.#.../#....',
    'Ф': '..#../.###./#.#.#/#.#.#/#.#.#/.###./..#..',
    'Х': '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
    'Ц': '#...#/#...#/#...#/#...#/#...#/#####/....#',
    'Ч': '#...#/#...#/#...#/.####/....#/....#/....#',
    'Ш': '#.#.#/#.#.#/#.#.#/#.#.#/#.#.#/#.#.#/#####',
    'Щ': '#.#.#/#.#.#/#.#.#/#.#.#/#.#.#/#####/....#',
    'Ъ': '##.../.#.../.#.../.###./.#..#/.#..#/.###.',
    'Ы': '#...#/#...#/#...#/##..#/#.#.#/#.#.#/##..#',
    'Ь': '#..../#..../#..../####./#...#/#...#/####.',
    'Э': '.###./#...#/....#/..###/....#/#...#/.###.',
    'Ю': '#.###/#.#.#/#.#.#/###.#/#.#.#/#.#.#/#.###',
    'Я': '.####/#...#/#...#/.####/..#.#/.#..#/#...#',

    # Кыргызские буквы, которых нет в русском алфавите.
    'Ң': '#...#/#...#/#####/#...#/#...#/#...#/...##',
    'Ө': '.###./#...#/#...#/#####/#...#/#...#/.###.',
    'Ү': '#...#/#...#/.#.#./..#../..#../..#../..#..',

    '.': '...../...../...../...../...../.##../.##..',
    ',': '...../...../...../...../.##../.##../.#...',
    '-': '...../...../...../.###./...../...../.....',
    ':': '...../.##../.##../...../.##../.##../.....',
    '!': '..#../..#../..#../..#../..#../...../..#..',
    '?': '.###./#...#/....#/..##./..#../...../..#..',
    '(': '...#./..#../.#.../.#.../.#.../..#../...#.',
    ')': '.#.../..#../...#./...#./...#./..#../.#...',
    '/': '....#/....#/...#./..#../.#.../#..../#....',
    '+': '...../..#../..#../#####/..#../..#../.....',
    '%': '#...#/#..#./...#./..#../.#.../#..#./#...#',
    '№': '#.#.#/#.#.#/#####/#.#.#/#.#.#/...../..###',
    '·': '...../...../...../..#../...../...../.....',
    '…': '...../...../...../...../...../...../#.#.#',
    '«': '...../..#.#/.#.#./#.#../.#.#./..#.#/.....',
    '»': '...../#.#../.#.#./..#.#/.#.#./#.#../.....',
    '→': '...../..#../...#./#####/...#./..#../.....',
    '"': '.#.#./.#.#./...../...../...../...../.....',
}

GLYPHS = {ch: tuple(src.split('/')) for ch, src in GLYPHS_SRC.items()}

# Знаки, которым в таблице глифов есть замена поближе.
SWAP = {
    '\u00a0': ' ', '\u2009': ' ', '\u202f': ' ',   # неразрывные пробелы из форматов
    '\u2011': '-', '\u2013': '-', '\u2014': '-', '\u2212': '-',
    '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
    '\u2192': '→', '\u00d7': 'X', '\u2026': '…',
    'Ї': 'I', 'І': 'I', 'Ә': 'Ө', 'Һ': 'Х',
}


def prep(text):
    """Строка в вид, который умеет нарисовать наш шрифт: прописные, без хвостов.
    Незнакомый знак превращаем в пробел — дырка лучше, чем слипшиеся слова."""
    out = []
    for ch in str(text or '').upper():
        ch = SWAP.get(ch, ch)
        out.append(ch if ch in GLYPHS or ch == ' ' else ' ')
    return re.sub(r' {2,}', ' ', ''.join(out)).strip()


# Шаг знака в клетках шрифта: пять на глиф и одна на просвет. Пробел уже —
# иначе на крупном кегле слова разъезжаются и заголовок читается как телеграмма.
STEP = FONT_W + 1
SPACE_STEP = 4


def text_width(text, scale):
    """Ширина строки в пикселях без хвостового просвета."""
    if not text:
        return 0
    cells = sum(SPACE_STEP if ch == ' ' else STEP for ch in text)
    return (cells - 1) * scale


def fit_text(text, max_px, scale, min_scale=3):
    """Подгоняем строку под ширину: сперва мельчим кегль, и только потом режем."""
    text = prep(text)
    if not text:
        return '', scale
    size = scale
    while size > min_scale and text_width(text, size) > max_px:
        size -= 1
    if text_width(text, size) <= max_px:
        return text, size
    out = ''
    for ch in text:
        if text_width(out + ch + '…', size) > max_px:
            break
        out += ch
    return (out.rstrip(' ,.-') + '…'), size


# ─────────────────────────────────────────────────────────────── цвета

BG_TOP = (22, 22, 26)
BG_BOTTOM = (13, 13, 15)
SURFACE = (25, 25, 29)
SURFACE_2 = (33, 33, 38)
DASH = (74, 74, 86)      # пунктир между точками маршрута
TEXT = (246, 246, 248)
MUTED = (150, 150, 162)
ACCENT = (255, 223, 0)
INK = (22, 21, 15)
OK = (36, 192, 122)
ERR = (255, 90, 90)

TONE_RGB = {'accent': ACCENT, 'ok': OK, 'err': ERR}


# ─────────────────────────────────────────────────────────────── холст

class Canvas:
    """Холст RGB в памяти и немного примитивов поверх него.

    Всё рисование сводится к заливке горизонтальных отрезков: срез bytearray
    работает на скорости C, а попиксельный цикл на питоне съел бы полсекунды.
    Полупрозрачность считаем только на краях и мелких деталях — там пикселей мало.
    """

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.buf = bytearray(w * h * 3)

    # ── основа ──────────────────────────────────────────────────────────────
    def span(self, y, x0, x1, color):
        """Отрезок одной строки, закрашенный сплошным цветом."""
        if y < 0 or y >= self.h:
            return
        x0 = 0 if x0 < 0 else int(x0)
        x1 = self.w if x1 > self.w else int(x1)
        if x1 <= x0:
            return
        i = (y * self.w + x0) * 3
        self.buf[i:i + (x1 - x0) * 3] = bytes(color) * (x1 - x0)

    def blend(self, x, y, color, alpha):
        """Пиксель поверх того, что уже нарисовано. Для сглаживания краёв."""
        if alpha <= 0 or x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        i = (y * self.w + int(x)) * 3
        b = self.buf
        if alpha >= 1:
            b[i], b[i + 1], b[i + 2] = color[0], color[1], color[2]
            return
        b[i] = int(b[i] + (color[0] - b[i]) * alpha)
        b[i + 1] = int(b[i + 1] + (color[1] - b[i + 1]) * alpha)
        b[i + 2] = int(b[i + 2] + (color[2] - b[i + 2]) * alpha)

    def round_rect(self, x, y, w, h, r, color):
        """Прямоугольник со скруглениями. Край подмешиваем по доле покрытия —
        без этого на радиусе 24 видны ступеньки, и карточка выглядит дёшево."""
        x, y, w, h = int(x), int(y), int(w), int(h)
        r = max(0, min(int(r), w // 2, h // 2))
        for dy in range(h):
            if dy < r:
                d = r - dy - 0.5
            elif dy >= h - r:
                d = dy - (h - r) + 0.5
            else:
                d = 0.0
            if d <= 0:
                self.span(y + dy, x, x + w, color)
                continue
            half = math.sqrt(max(0.0, r * r - d * d))
            inset = r - half
            whole = int(inset)
            frac = 1.0 - (inset - whole)
            self.span(y + dy, x + whole + 1, x + w - whole - 1, color)
            self.blend(x + whole, y + dy, color, frac)
            self.blend(x + w - whole - 1, y + dy, color, frac)

    def circle(self, cx, cy, r, color):
        """Круг со сглаженным краем."""
        cx, cy = float(cx), float(cy)
        top, bottom = int(math.floor(cy - r)), int(math.ceil(cy + r))
        for y in range(top, bottom + 1):
            dy = y + 0.5 - cy
            if abs(dy) > r:
                continue
            half = math.sqrt(max(0.0, r * r - dy * dy))
            left, right = cx - half, cx + half
            whole_l, whole_r = int(math.ceil(left)), int(math.floor(right))
            self.span(y, whole_l, whole_r, color)
            self.blend(whole_l - 1, y, color, whole_l - left)
            self.blend(whole_r, y, color, right - whole_r)

    # ── фон ─────────────────────────────────────────────────────────────────
    def bg_color(self, y):
        """Цвет фона строки: сверху чуть светлее, книзу уходит в ночь."""
        k = y / max(1, self.h - 1)
        return (int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * k),
                int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * k),
                int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * k))

    def background(self):
        for y in range(self.h):
            self.span(y, 0, self.w, self.bg_color(y))

    def glow(self, cx, cy, radius, color, strength=0.13, steps=30):
        """Мягкое свечение в углу. Рисуем кольцами от большого к малому и цвет
        каждого считаем сразу от фона — так не нужно ни разу смешивать попиксельно."""
        for i in range(steps, 0, -1):
            r = radius * i / steps
            a = strength * (1.0 - i / steps) ** 2
            if a <= 0.002:
                continue
            top = max(0, int(cy - r))
            bottom = min(self.h - 1, int(cy + r))
            for y in range(top, bottom + 1):
                dy = y - cy
                half = math.sqrt(max(0.0, r * r - dy * dy))
                bg = self.bg_color(y)
                mix = (int(bg[0] + (color[0] - bg[0]) * a),
                       int(bg[1] + (color[1] - bg[1]) * a),
                       int(bg[2] + (color[2] - bg[2]) * a))
                self.span(y, cx - half, cx + half, mix)

    # ── текст ───────────────────────────────────────────────────────────────
    def text(self, x, y, value, scale, color):
        """Строка прописными. Возвращает ширину — удобно ставить слова подряд."""
        value = prep(value)
        gx = int(x)
        for ch in value:
            glyph = GLYPHS.get(ch)
            if not glyph:
                gx += SPACE_STEP * scale
                continue
            for row in range(FONT_H):
                line = glyph[row]
                col = 0
                while col < FONT_W:
                    if line[col] != '#':
                        col += 1
                        continue
                    run = 1
                    while col + run < FONT_W and line[col + run] == '#':
                        run += 1
                    px = gx + col * scale
                    py = int(y) + row * scale
                    for dy in range(scale):
                        self.span(py + dy, px, px + run * scale, color)
                    col += run
            gx += STEP * scale
        return text_width(value, scale)

    # ── вывод ───────────────────────────────────────────────────────────────
    def png(self):
        """Собираем PNG руками: сигнатура, IHDR, IDAT со сжатыми строками, IEND.

        Фильтр строк нулевой. Для наших заливок этого достаточно: одинаковые
        куски строк zlib схлопывает и без предсказателя, а обход байтов на питоне
        ради пары лишних килобайт экономии стоил бы секунды процессора.
        """
        stride = self.w * 3
        raw = bytearray()
        for y in range(self.h):
            raw.append(0)
            raw += self.buf[y * stride:(y + 1) * stride]
        head = struct.pack('>IIBBBBB', self.w, self.h, 8, 2, 0, 0, 0)
        return (b'\x89PNG\r\n\x1a\n'
                + _chunk(b'IHDR', head)
                + _chunk(b'IDAT', zlib.compress(bytes(raw), 6))
                + _chunk(b'IEND', b''))


def _chunk(tag, data):
    """Кусок PNG: длина, тип, данные и CRC32 по типу с данными."""
    return (struct.pack('>I', len(data)) + tag + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))


# ─────────────────────────────────────────────────────────────── рисование карточки

PAD = 64


def _logo(c, x, y, lang, city=''):
    """Фирменный знак: жёлтый квадрат с фургоном и подпись рядом."""
    c.round_rect(x, y, 64, 64, 18, ACCENT)
    c.round_rect(x + 10, y + 20, 30, 19, 5, INK)          # кузов
    c.round_rect(x + 36, y + 26, 16, 13, 4, INK)          # кабина
    c.circle(x + 19, y + 43, 6.5, INK)                    # колёса
    c.circle(x + 44, y + 43, 6.5, INK)
    c.circle(x + 19, y + 43, 2.6, ACCENT)
    c.circle(x + 44, y + 43, 2.6, ACCENT)

    name_x = x + 84
    used = c.text(name_x, y + 6, 'SPRINTER', 5, TEXT)
    c.text(name_x + used + 14, y + 6, 'GO', 5, ACCENT)
    sub = say('share.brand_sub', lang)
    if city:
        sub = '%s · %s' % (sub, city)
    text, scale = fit_text(sub, 620, 3)
    c.text(name_x, y + 46, text, scale, MUTED)


def _chip(c, right, y, value, lang):
    """Плашка с номером заказа в правом верхнем углу."""
    text, scale = fit_text('%s %s' % (say('share.order', lang), value), 340, 4)
    width = text_width(text, scale) + 44
    height = 56
    x = right - width
    c.round_rect(x, y, width, height, height // 2, SURFACE_2)
    c.text(x + 22, y + (height - FONT_H * scale) // 2, text, scale, ACCENT)


def _route_panel(c, x, y, w, h, data):
    """Схема маршрута: две точки, пунктир между ними и подписи улиц."""
    lang = data['lang']
    c.round_rect(x, y, w, h, 24, SURFACE)

    dot_x = x + 48
    label_x = x + 84
    max_w = (x + w) - label_x - 32
    rows = (
        (say('share.from', lang), data['from'] or say('share.nothing', lang), OK, y + 22),
        (say('share.to', lang), data['to'] or say('share.nothing', lang),
         TONE_RGB.get(data['tone'], ACCENT), y + 110),
    )
    centers = []
    for label, value, color, top in rows:
        c.text(label_x, top, label, 3, MUTED)
        text, scale = fit_text(value, max_w, 6, min_scale=4)
        c.text(label_x, top + 26, text, scale, TEXT)
        middle = top + 26 + FONT_H * scale / 2
        centers.append(middle)
        c.circle(dot_x, middle, 11, color)
        c.circle(dot_x, middle, 5, SURFACE)

    # Пунктир между точками: четыре коротких штриха, как на схеме в приложении.
    start, finish = centers[0] + 16, centers[1] - 16
    step = (finish - start) / 4.0
    if step > 6:
        for i in range(4):
            c.round_rect(dot_x - 2, start + i * step, 4, step - 7, 2, DASH)


def _stat_card(c, x, y, w, h, label, value, lang, color=TEXT):
    """Плитка снизу: мелкая подпись и крупное значение."""
    c.round_rect(x, y, w, h, 18, SURFACE)
    head, head_scale = fit_text(label, w - 40, 3)
    c.text(x + 20, y + 16, head, head_scale, MUTED)
    text, scale = fit_text(value or say('share.nothing', lang), w - 40, 5, min_scale=3)
    c.text(x + 20, y + 44, text, scale, color)


def render_card(data):
    """Карточка целиком. Возвращает готовые байты PNG."""
    lang = data['lang']
    tone = TONE_RGB.get(data['tone'], ACCENT)

    c = Canvas(CARD_W, CARD_H)
    c.background()
    c.glow(CARD_W - 190, 10, 430, ACCENT, 0.13)

    _logo(c, PAD, 44, lang, data['city'])
    _chip(c, CARD_W - PAD, 56, data['pid'], lang)

    title, scale = fit_text(data['title'], CARD_W - 2 * PAD, 11, min_scale=6)
    c.text(PAD, 190 + (77 - FONT_H * scale) // 2, title, scale, tone)

    _route_panel(c, PAD, 300, CARD_W - 2 * PAD, 200, data)

    # Снизу три плитки. Под машину отводим широкую: госномер должен влезать
    # целиком и крупно — именно его человек ищет глазами во дворе.
    gap = 20
    narrow = 260
    wide = CARD_W - 2 * PAD - 2 * narrow - 2 * gap
    car_label = say('share.car', lang)
    car_value = data['car_plate'] or data['car_model']
    if data['car_plate'] and data['car_model']:
        car_label = '%s · %s' % (car_label, data['car_model'])
    _stat_card(c, PAD, 516, narrow, 88,
               say('share.distance', lang), data['distance'], lang)
    _stat_card(c, PAD + narrow + gap, 516, narrow, 88,
               say('share.eta', lang), data['duration'], lang)
    _stat_card(c, PAD + 2 * (narrow + gap), 516, wide, 88,
               car_label, car_value, lang, color=ACCENT)
    return c.png()


_missing = {}


def missing_image(lang='ru'):
    """Картинка «заказа нет». Рисуется один раз на язык: она никогда не меняется."""
    lang = i18n.norm_lang(lang)
    body = _missing.get(lang)
    if body is None:
        body = render_missing(lang)
        _missing[lang] = body
    return body


def render_missing(lang='ru'):
    """Картинка для ссылки на несуществующий заказ: пустой прямоугольник в чате
    выглядит поломкой, а честная надпись — нет."""
    c = Canvas(CARD_W, CARD_H)
    c.background()
    c.glow(CARD_W - 190, 10, 430, ACCENT, 0.10)
    _logo(c, PAD, 44, lang)
    title, scale = fit_text(say('share.404.title', lang), CARD_W - 2 * PAD, 11, min_scale=6)
    c.text(PAD, 250, title, scale, TEXT)
    text, scale = fit_text(say('share.404.short', lang), CARD_W - 2 * PAD, 5)
    c.text(PAD, 350, text, scale, MUTED)
    return c.png()


# ─────────────────────────────────────────────────────────────── страница

PAGE_CSS = """
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#0E0E10; --surface:#17171A; --surface-2:#202024; --line:#2E2E36;
  --text:#F6F6F8; --muted:#9A9AA5; --accent:#FFDF00; --ink:#16150F;
  --ok:#24C07A; --err:#FF5A5A;
  color-scheme:dark light;
}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--text);
  font:16px/1.5 'Inter','Inter Fallback',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  padding:env(safe-area-inset-top) 0 calc(24px + env(safe-area-inset-bottom));
}
.page{max-width:520px;margin:0 auto;padding:16px}
a{color:inherit}

.head{display:flex;align-items:center;gap:12px;padding:8px 4px 20px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;min-height:44px}
.brand__name{font-family:'Onest','Onest Fallback',system-ui,sans-serif;
  font-size:19px;font-weight:700;letter-spacing:-.02em}
.brand__name span{color:var(--accent)}
.lang{
  margin-left:auto;display:inline-flex;align-items:center;justify-content:center;
  min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);
  color:var(--muted);text-decoration:none;font-size:14px
}

.card{background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:20px}
.card__id{margin:0;color:var(--muted);font-size:13px;letter-spacing:.08em;text-transform:uppercase}
.card__title{
  font-family:'Onest','Onest Fallback',system-ui,sans-serif;
  margin:8px 0 6px;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-.02em;
  display:flex;align-items:center;gap:10px;overflow-wrap:anywhere
}
.card__sub{margin:0;color:var(--muted);font-size:14px}
.dot{width:12px;height:12px;border-radius:50%;background:var(--accent);flex:0 0 auto}
.dot--ok{background:var(--ok)}
.dot--err{background:var(--err)}

.route{list-style:none;margin:20px 0 0;padding:16px;background:var(--surface-2);border-radius:18px}
.route li{display:grid;grid-template-columns:22px 1fr;gap:4px 10px;align-items:start}
.route li+li{margin-top:14px}
.route__pin{
  width:14px;height:14px;margin-top:5px;border-radius:50%;
  background:var(--ok);box-shadow:0 0 0 4px rgba(36,192,122,.16)
}
.route__pin--b{background:var(--accent);box-shadow:0 0 0 4px rgba(255,223,0,.16)}
.route__label{grid-column:2;color:var(--muted);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.route__value{grid-column:2;font-size:18px;font-weight:600;word-break:break-word}

.stats{list-style:none;display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 0;padding:0}
.stats li{
  flex:1 1 140px;background:var(--surface-2);border-radius:14px;padding:12px 14px
}
.stats b{display:block;font-size:17px;font-weight:700;overflow-wrap:anywhere}
.stats span{display:block;margin-top:2px;color:var(--muted);font-size:12px;
  letter-spacing:.06em;text-transform:uppercase}

.btn{
  display:flex;align-items:center;justify-content:center;gap:8px;
  min-height:52px;margin-top:12px;padding:0 20px;border-radius:16px;
  font-size:17px;font-weight:700;text-decoration:none;
  border:1px solid transparent
}
.btn--primary{background:var(--accent);color:var(--ink)}
.btn--ghost{background:transparent;color:var(--text);border-color:var(--line)}
.btn:active{transform:translateY(1px)}

.note{margin:16px 2px 0;color:var(--muted);font-size:13px;line-height:1.45}
.foot{margin:20px 4px 0;color:var(--muted);font-size:13px;text-align:center}
.foot a{color:var(--muted)}

@media (min-width:560px){
  .card__title{font-size:34px}
  .page{padding:28px 16px}
}
@media (prefers-color-scheme:light){
  :root{
    --bg:#F4F4F6; --surface:#FFFFFF; --surface-2:#F0F0F3; --line:#E2E2E8;
    --text:#131316; --muted:#6E6E78
  }
}
@media (prefers-reduced-motion:reduce){
  .btn:active{transform:none}
}
"""

LOGO_SVG = ('<svg viewBox="0 0 48 44" width="34" height="32" aria-hidden="true" focusable="false">'
            '<rect x="1" y="9" width="27" height="19" rx="5" fill="#FFDF00"/>'
            '<path d="M28 14h8l7 8v6H28z" fill="#FFDF00"/>'
            '<circle cx="13" cy="33" r="6" fill="none" stroke="#FFDF00" stroke-width="4"/>'
            '<circle cx="35" cy="33" r="6" fill="none" stroke="#FFDF00" stroke-width="4"/>'
            '</svg>')


def esc(value):
    return html_mod.escape(str(value if value is not None else ''), quote=True)


def _meta(name, value, prop=True):
    key = 'property' if prop else 'name'
    return '  <meta %s="%s" content="%s">' % (key, name, esc(value))


def describe(data):
    """Подпись под карточкой в мессенджере: статус, маршрут, километры и минуты."""
    lang = data['lang']
    parts = [say('share.desc.head', lang, status=data['title'], city=data['city'])]
    if data['from'] and data['to']:
        parts.append(say('share.desc.route', lang, a=data['from'], b=data['to']))
    if data['distance'] and data['duration']:
        parts.append(say('share.desc.tail', lang,
                         distance=data['distance'], duration=data['duration']))
    return ' · '.join(p for p in parts if p)


def render_page(data, origin='', base='/'):
    """Страница превью: мета-теги для роботов и человеческая карточка для людей."""
    lang = data['lang']
    other = 'ky' if lang == 'ru' else 'ru'
    pid = data['pid']
    title = say('share.page_title', lang, status=data['title'], pid=pid, service=data['service'])
    desc = describe(data)
    page_url = '%s%sshare/%s' % (origin, base, pid)
    img_url = '%s%sshare/%s.%s.png' % (origin, base, pid, lang)
    track_url = '%s#/order/%s' % (base, pid)
    tone_class = {'ok': ' dot--ok', 'err': ' dot--err'}.get(data['tone'], '')

    stats = []
    if data['distance']:
        stats.append((data['distance'], say('share.distance', lang)))
    if data['duration']:
        stats.append((say('share.approx', lang, value=data['duration']), say('share.eta', lang)))
    if data['car']:
        stats.append((data['car'], say('share.car', lang)))
    if data['stops'] > 2:
        stats.append((str(data['stops']), say('share.stops', lang)))

    sub = [data['city']]
    if data['created_at']:
        sub.append(say('share.made_at', lang, when=i18n.fmt_dt(data['created_at'], lang)))

    out = ['<!doctype html>',
           '<html lang="%s">' % lang,
           '<head>',
           '  <meta charset="utf-8">',
           '  <meta name="viewport" content="width=device-width, initial-scale=1, '
           'viewport-fit=cover">',
           '  <title>%s</title>' % esc(title),
           _meta('description', desc, prop=False),
           # Ссылку на заказ незачем показывать в поиске: она живёт день и никому,
           # кроме получателя, не нужна. Мессенджеры этот запрет не читают — им и не надо.
           _meta('robots', 'noindex, nofollow', prop=False),
           '  <meta name="theme-color" content="#0E0E10" '
           'media="(prefers-color-scheme: dark)">',
           '  <meta name="theme-color" content="#F4F4F6" '
           'media="(prefers-color-scheme: light)">',
           _meta('og:type', 'website'),
           _meta('og:site_name', data['service']),
           _meta('og:title', title),
           _meta('og:description', desc),
           _meta('og:url', page_url),
           _meta('og:image', img_url),
           _meta('og:image:secure_url', img_url),
           _meta('og:image:type', 'image/png'),
           _meta('og:image:width', CARD_W),
           _meta('og:image:height', CARD_H),
           _meta('og:image:alt', desc),
           _meta('og:locale', 'ru_RU' if lang == 'ru' else 'ky_KG'),
           _meta('twitter:card', 'summary_large_image', prop=False),
           _meta('twitter:title', title, prop=False),
           _meta('twitter:description', desc, prop=False),
           _meta('twitter:image', img_url, prop=False),
           '  <link rel="canonical" href="%s">' % esc(page_url),
           '  <link rel="icon" href="%sfavicon.svg">' % esc(base),
           # Шрифты берём те же, что и приложение: страницу открывают сразу после
           # карточки в чате, и она не должна выглядеть чужой. Файла нет — браузер
           # молча возьмёт системный, ничего не сломается.
           '  <link rel="stylesheet" href="%sassets/css/fonts.css">' % esc(base),
           '  <style>%s</style>' % PAGE_CSS,
           '</head>',
           '<body>',
           '<div class="page">',
           '  <header class="head">',
           '    <a class="brand" href="%s">%s<span class="brand__name">Sprinter<span>Go</span>'
           '</span></a>' % (esc(base), LOGO_SVG),
           '    <a class="lang" href="%sshare/%s.%s" hreflang="%s">%s</a>'
           % (esc(base), esc(pid), other, other, esc(say('share.lang_other', lang))),
           '  </header>',
           '  <main class="card">',
           '    <p class="card__id">%s %s</p>' % (esc(say('share.order', lang)), esc(pid)),
           '    <h1 class="card__title"><span class="dot%s" aria-hidden="true"></span>%s</h1>'
           % (tone_class, esc(data['title'])),
           '    <p class="card__sub">%s</p>' % esc(' · '.join(s for s in sub if s)),
           '    <ul class="route">',
           '      <li><span class="route__pin" aria-hidden="true"></span>'
           '<span class="route__label">%s</span>'
           '<span class="route__value">%s</span></li>'
           % (esc(say('share.from', lang)), esc(data['from'] or say('share.nothing', lang))),
           '      <li><span class="route__pin route__pin--b" aria-hidden="true"></span>'
           '<span class="route__label">%s</span>'
           '<span class="route__value">%s</span></li>'
           % (esc(say('share.to', lang)), esc(data['to'] or say('share.nothing', lang))),
           '    </ul>']

    if stats:
        out.append('    <ul class="stats">')
        for value, label in stats:
            out.append('      <li><b>%s</b><span>%s</span></li>' % (esc(value), esc(label)))
        out.append('    </ul>')

    out += ['    <a class="btn btn--primary" href="%s">%s</a>'
            % (esc(track_url), esc(say('share.open', lang))),
            '    <a class="btn btn--ghost" href="%s">%s</a>'
            % (esc(base), esc(say('share.order_own', lang))),
            '    <p class="note">%s</p>' % esc(say('share.note', lang)),
            '  </main>']

    foot = [data['service'], data['city']]
    tail = ' · '.join(p for p in foot if p)
    if data['phone']:
        tail += ' · <a href="tel:%s">%s</a>' % (esc(re.sub(r'[^\d+]', '', data['phone'])),
                                                esc(data['phone']))
    out += ['  <footer class="foot">%s</footer>' % tail,
            '</div>',
            '</body>',
            '</html>']
    return '\n'.join(out)


def render_missing_page(lang='ru', base='/'):
    """Страница для ссылки, по которой заказа нет."""
    lang = i18n.norm_lang(lang)
    service = str(settings.get('service.name', 'Sprinter Go') or 'Sprinter Go')
    title = say('share.404.title', lang)
    return '\n'.join([
        '<!doctype html>',
        '<html lang="%s">' % lang,
        '<head>',
        '  <meta charset="utf-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1, '
        'viewport-fit=cover">',
        '  <title>%s · %s</title>' % (esc(title), esc(service)),
        _meta('robots', 'noindex, nofollow', prop=False),
        '  <meta name="theme-color" content="#0E0E10" '
        'media="(prefers-color-scheme: dark)">',
        '  <link rel="icon" href="%sfavicon.svg">' % esc(base),
        '  <style>%s</style>' % PAGE_CSS,
        '</head>',
        '<body>',
        '<div class="page">',
        '  <header class="head">',
        '    <a class="brand" href="%s">%s<span class="brand__name">Sprinter<span>Go</span>'
        '</span></a>' % (esc(base), LOGO_SVG),
        '  </header>',
        '  <main class="card">',
        '    <h1 class="card__title"><span class="dot dot--err" aria-hidden="true"></span>%s</h1>'
        % esc(title),
        '    <p class="note">%s</p>' % esc(say('share.404.text', lang)),
        '    <a class="btn btn--primary" href="%s">%s</a>'
        % (esc(base), esc(say('share.404.btn', lang, service=service))),
        '  </main>',
        '</div>',
        '</body>',
        '</html>',
    ])


# ─────────────────────────────────────────────────────────────── кэш

_lock = threading.RLock()
_cache = {}          # (вид, pid, язык) -> {'at': время, 'body': данные или байты}
_origin = {'value': '', 'read': False}


def _cache_get(key):
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit['at'] < TTL_S:
            return hit
        if hit:
            _cache.pop(key, None)
        return None


def _cache_put(key, body):
    entry = {'at': time.time(), 'body': body}
    with _lock:
        if len(_cache) >= CACHE_MAX:
            # Выкидываем самое старое — заказ, которым делились полчаса назад,
            # уже никто не открывает.
            for old in sorted(_cache, key=lambda k: _cache[k]['at'])[:CACHE_MAX // 3]:
                _cache.pop(old, None)
        _cache[key] = entry
    return entry


def data_for(pid, lang):
    """Данные заказа с минутным кэшем: за превью приходят сразу несколько роботов."""
    key = ('data', pid, lang or '')
    hit = _cache_get(key)
    if hit:
        return hit['body']
    data = card_data(pid, lang)
    if data is None:
        return None
    _cache_put(key, data)
    return data


def peek_image(pid, lang):
    """Готовая картинка, если она уже лежит в кэше. Ничего не рисует и не считает."""
    data = _cache_get(('data', pid, lang or ''))
    if not data:
        return None
    hit = _cache_get(('png', pid, data['body']['lang']))
    return hit['body'] if hit else None


def image_for(pid, lang):
    """Готовая картинка заказа. None — заказа нет."""
    data = data_for(pid, lang)
    if data is None:
        return None
    key = ('png', pid, data['lang'])
    hit = _cache_get(key)
    if hit:
        return hit['body']
    body = render_card(data)
    _cache_put(key, body)
    return body


# ─────────────────────────────────────────────────────────────── адреса

_state = {'base': '/'}


def base_path():
    """Префикс установки: «/» или «/go/». Ставится в register() из приложения."""
    return _state['base']


def remember_origin(scheme, host):
    """Запоминаем, под каким адресом сервис видят снаружи.

    Нужно для абсолютных ссылок в мета-тегах: робот мессенджера читает og:image
    до того, как выполнит хоть строчку разметки, и относительный адрес понимают
    не все. Домен берём из заголовков запроса и тут же кладём в файл рядом с
    базой: короткая ссылка приходит через отдачу статики, где заголовков нет,
    и после перезапуска вспомнить домен иначе неоткуда.
    """
    host = str(host or '').split(',')[0].strip()
    if not host or not HOST_RX.match(host):
        return
    scheme = 'https' if str(scheme or '').lower().startswith('https') else 'http'
    value = '%s://%s' % (scheme, host)
    if _origin['value'] == value:
        return
    _origin['value'] = value
    _origin['read'] = True
    try:
        with open(os.path.join(spool_dir(create=True), 'origin'), 'w', encoding='utf-8') as f:
            f.write(value)
    except OSError:
        pass                      # не записалось — переживём, ссылки станут относительными


def known_origin():
    """Запомненный адрес сайта: из памяти, а если сервис только поднялся — из файла."""
    if _origin['value'] or _origin['read']:
        return _origin['value']
    _origin['read'] = True
    try:
        with open(os.path.join(spool_dir(), 'origin'), encoding='utf-8') as f:
            value = f.read().strip()
    except OSError:
        return ''
    scheme, _, host = value.partition('://')
    if scheme in ('http', 'https') and HOST_RX.match(host or ''):
        _origin['value'] = value
    return _origin['value']


def origin_from(ctx):
    """Адрес сайта для этого запроса: сперва заголовки, потом то, что запомнили."""
    host = ctx.header('X-Forwarded-Host') or ctx.header('Host') or ''
    proto = ctx.header('X-Forwarded-Proto') or ''
    remember_origin(proto or 'http', host)
    host = str(host).split(',')[0].strip()
    if host and HOST_RX.match(host):
        scheme = 'https' if str(proto).lower().startswith('https') else 'http'
        return '%s://%s' % (scheme, host)
    return known_origin()


def share_url(public_id, origin=''):
    """Ссылка на карточку заказа — её и отправляют в мессенджер."""
    return '%s%sshare/%s' % (origin or known_origin(), base_path(),
                             str(public_id or '').upper())


def image_url(public_id, lang='ru', origin=''):
    """Адрес картинки заказа. Язык прячем в путь, чтобы работала короткая ссылка."""
    return '%s%sshare/%s.%s.png' % (origin or known_origin(), base_path(),
                                    str(public_id or '').upper(), i18n.norm_lang(lang))


def parse_target(raw, query_lang=None):
    """Разбор хвоста адреса: «AB12CD», «AB12CD.ky», «AB12CD.png», «AB12CD.ky.png».

    Язык прячем в путь, а не в строку запроса: короткая ссылка приходит к нам
    через отдачу статики, а туда строка запроса не доезжает.
    """
    text = str(raw or '').strip()
    image = False
    if text.lower().endswith('.png'):
        image, text = True, text[:-4]
    lang = None
    for code in ('ru', 'ky'):
        if text.lower().endswith('.' + code):
            lang, text = code, text[:-3]
            break
    pid = text.upper()
    if not PID_RX.match(pid):
        return None
    if query_lang and str(query_lang).lower() in ('ru', 'ky'):
        lang = str(query_lang).lower()
    return pid, lang, image


# ─────────────────────────────────────────────────────────────── маршруты

def _send(ctx, body, ctype, status=200):
    """Ответ файлом: с ETag и минутным кэшем. Разметка и картинка не секретные —
    пусть их держит у себя и браузер, и прокси мессенджера."""
    h = ctx.h
    cache = 'public, max-age=%d' % TTL_S
    etag = '"%s"' % hashlib.md5(body).hexdigest()[:20]
    if status == 200 and ctx.header('If-None-Match') == etag:
        h.send_response(304)
        h.send_header('ETag', etag)
        h.send_header('Cache-Control', cache)
        h.end_headers()
        return
    h.send_response(status)
    h.send_header('Content-Type', ctype)
    h.send_header('Content-Length', str(len(body)))
    h.send_header('ETag', etag)
    h.send_header('Cache-Control', cache)
    h._security_headers()
    h.end_headers()
    if ctx.method != 'HEAD':
        h.wfile.write(body)


def _allowed(ctx):
    """Сборку карточки ограничиваем по адресу. Попадания в кэш сюда не доходят,
    поэтому честный робот мессенджера в предел не упрётся никогда."""
    return LIMIT.check('share:' + ctx.ip, BUILD_PER_MIN, 60)


@router.get('/share/{pid}.png')
@router.get(API + '/share/{pid}.png')
def route_image(ctx, pid):
    target = parse_target(pid + '.png', ctx.q('lang'))
    if not target:
        return _send(ctx, missing_image(_lang_of(ctx)), 'image/png', 404)
    return _image_response(ctx, target[0], target[1])


@router.get('/share/{pid}')
@router.get(API + '/share/{pid}')
def route_page(ctx, pid):
    target = parse_target(pid, ctx.q('lang'))
    if not target:
        return _page_response(ctx, None, _lang_of(ctx))
    if target[2]:
        return _image_response(ctx, target[0], target[1])
    return _page_response(ctx, target[0], target[1])


def _lang_of(ctx):
    """Язык гостя: параметр, потом заголовок браузера, потом русский."""
    want = str(ctx.q('lang') or '').lower()
    if want in ('ru', 'ky'):
        return want
    head = str(ctx.header('Accept-Language') or '').lower()
    return 'ky' if head.startswith('ky') else 'ru'


def _image_response(ctx, pid, lang):
    body = peek_image(pid, lang)
    if body is None:
        if not _allowed(ctx):
            # Перебирать номера заказов бессмысленно, но пусть это будет и недёшево.
            return _send(ctx, missing_image(lang or 'ru'), 'image/png', 429)
        body = image_for(pid, lang)
    if body is None:
        return _send(ctx, missing_image(lang or _lang_of(ctx)), 'image/png', 404)
    return _send(ctx, body, 'image/png')


def _page_response(ctx, pid, lang):
    origin = origin_from(ctx)
    base = base_path()
    if pid:
        data = data_for(pid, lang)
        if data is not None:
            body = render_page(data, origin, base).encode('utf-8')
            return _send(ctx, body, 'text/html; charset=utf-8')
    body = render_missing_page(lang or _lang_of(ctx), base).encode('utf-8')
    return _send(ctx, body, 'text/html; charset=utf-8', 404)


def register(app):
    """Подключение к приложению — вызывается из app.py."""
    _state['base'] = getattr(app, 'base', '/') or '/'
    app.router.include(router)
    log('карточки для мессенджеров:', '%sshare/{номер}' % _state['base'])
    # Заодно подслушиваем адрес сайта на обычных запросах API: карточку просит
    # робот без заголовка Host у нас в руках, а абсолютные ссылки ему нужны.
    before = getattr(app, 'before', None)
    if isinstance(before, list):
        before.append(_watch_origin)
    return router


def _watch_origin(ctx):
    """Хук на каждый запрос API: запомнить домен сервиса и молча уйти.

    Заказ появляется только после запроса из приложения, так что к моменту, когда
    ссылкой на него поделятся, домен мы уже знаем. Учимся один раз: дальше проверка
    стоит одно обращение к словарю и в горячий путь API ничего не добавляет.
    """
    try:
        if not known_origin():
            remember_origin(ctx.header('X-Forwarded-Proto') or 'http',
                            ctx.header('X-Forwarded-Host') or ctx.header('Host') or '')
    except Exception:
        pass


# У соседних роутеров точка входа называется по-разному; поддерживаем оба имени.
mount = register
