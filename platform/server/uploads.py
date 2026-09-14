# -*- coding: utf-8 -*-
"""Картинки, которые присылают из браузера: фото с документом и аватар курьера.

Снимок приходит строкой data:image/jpeg;base64,… — так его умеет отдать любой
телефон без multipart и без единой сторонней библиотеки. Здесь эту строку
разбирают, проверяют и кладут файлом в SG_DATA/uploads: рядом с базой, чтобы
резервная копия папки данных забирала и снимки тоже.

Три правила, которые тут нарушать нельзя:

1. Имя файла придумываем сами и никогда не берём из запроса. Всё, что пришло
   снаружи, — это картинка; имя со слешами и точками — это уже чужой каталог.
2. Тип определяем по первым байтам, а не по заголовку data-URL. Подписать
   «image/jpeg» можно чему угодно, включая html со скриптом.
3. Уменьшением занимается приложение на телефоне. Здесь только приём: без
   сторонних библиотек честно ужать jpeg нечем, а врать про это не надо.
"""
import base64
import binascii
import os
import re
import secrets
import threading

from .core import ApiError

# Шести мегабайт хватает с запасом: приложение ужимает снимок до 1400 px по
# длинной стороне, это 200-400 КБ. Запас — на случай, когда фото прислали
# в обход приложения. Выше подниматься нельзя: тело запроса ограничено
# восемью мегабайтами, а base64 раздувает файл на треть.
MAX_BYTES = 6 * 1024 * 1024

# Форматы, которые показывает любой браузер и отдаёт любая камера.
# SVG сюда не пускаем: это документ со скриптами, а не картинка.
TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}
MIMES = {'jpg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp'}

# Имя, которое выдали мы сами: короткий префикс, случайная часть, расширение.
# Всё остальное — не наш файл, и открывать его не за чем.
NAME_RX = re.compile(r'^[a-z]{2,8}_[0-9a-f]{24,64}\.(jpg|png|webp)$')
PREFIX_RX = re.compile(r'^[a-z]{2,8}$')

NAME_BYTES = 16          # 32 шестнадцатеричных знака — подобрать имя нереально

_lock = threading.Lock()
_dir = None


# ─────────────────────────────────────────────────────────────── каталог

def folder(create=False):
    """Куда складываем снимки. Путь считаем один раз: он не меняется на ходу."""
    global _dir
    with _lock:
        if _dir is None:
            root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            data = os.environ.get('SG_DATA') or os.path.join(root, 'data')
            _dir = os.path.abspath(os.path.join(os.path.abspath(data), 'uploads'))
        target = _dir
    if create:
        os.makedirs(target, exist_ok=True)
    return target


# ─────────────────────────────────────────────────────────────── разбор data-URL

def sniff(raw):
    """Настоящий тип картинки по первым байтам. Не узнали — значит, не картинка."""
    if raw[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if raw[:8] == b'\x89PNG\r\n\x1a\x0a':
        return 'image/png'
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return 'image/webp'
    return None


def parse(value):
    """Строка data:image/…;base64,… → (тип, байты). Ошибки — человеческие:
    их читает курьер на улице, а не программист в логе."""
    text = str(value or '').strip()
    if not text:
        raise ApiError('no_photo', 'Фотография не приложена', 400, field='photo')
    if not text[:5].lower() == 'data:':
        raise ApiError('bad_photo',
                       'Фотографию нужно прислать строкой вида data:image/jpeg;base64,…',
                       400, field='photo')

    head, sep, payload = text.partition(',')
    if not sep:
        raise ApiError('bad_photo', 'Фотография пришла обрезанной, отправьте ещё раз',
                       400, field='photo')
    parts = [p.strip() for p in head[5:].lower().split(';')]
    if 'base64' not in parts:
        raise ApiError('bad_photo', 'Фотографию нужно закодировать в base64',
                       400, field='photo')
    declared = parts[0] if parts and '/' in parts[0] else ''
    if declared and declared not in TYPES:
        raise ApiError('photo_type', 'Подойдёт фотография в JPEG, PNG или WEBP',
                       400, field='photo')

    # Прикидываем размер до раскодирования: незачем разворачивать в память
    # десять мегабайт, чтобы потом их же и выбросить.
    payload = re.sub(r'\s+', '', payload)
    if len(payload) // 4 * 3 > MAX_BYTES + 65536:
        raise ApiError('photo_big', _too_big(), 413, field='photo')
    payload += '=' * (-len(payload) % 4)

    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        raise ApiError('bad_photo', 'Не получилось прочитать фотографию: файл повреждён',
                       400, field='photo')
    if len(raw) < 64:
        raise ApiError('bad_photo', 'Фотография пустая, попробуйте снять ещё раз',
                       400, field='photo')
    if len(raw) > MAX_BYTES:
        raise ApiError('photo_big', _too_big(), 413, field='photo')

    real = sniff(raw)
    if real is None:
        raise ApiError('photo_type', 'Это не похоже на фотографию. '
                                     'Подойдёт снимок в JPEG, PNG или WEBP', 400, field='photo')
    return real, raw


def _too_big():
    return ('Фотография тяжелее %d МБ. Снимите ещё раз — приложение ужмёт её само'
            % (MAX_BYTES // (1024 * 1024)))


# ─────────────────────────────────────────────────────────────── файлы

def save(value, prefix='img'):
    """Сохранить картинку из data-URL. Возвращает {name, mime, ext, size}.

    В базу пишем только name: путь к папке однажды поменяется при переезде
    на другой сервер, а имя останется тем же.
    """
    mime, raw = parse(value)
    ext = TYPES[mime]
    tag = prefix if PREFIX_RX.match(str(prefix or '')) else 'img'
    directory = folder(create=True)

    for _ in range(6):
        name = '%s_%s.%s' % (tag, secrets.token_hex(NAME_BYTES), ext)
        full = os.path.join(directory, name)
        if os.path.exists(full):
            continue                       # совпадение немыслимо, но проверить дёшево
        tmp = full + '.part'
        try:
            with open(tmp, 'wb') as f:
                f.write(raw)
            # Переименование атомарно: недописанный файл никто не увидит.
            os.replace(tmp, full)
        except OSError:
            _drop(tmp)
            raise ApiError('save_failed',
                           'Не получилось сохранить фотографию. Попробуйте ещё раз', 500)
        return {'name': name, 'mime': mime, 'ext': ext, 'size': len(raw)}

    raise ApiError('save_failed', 'Не получилось сохранить фотографию. Попробуйте ещё раз', 500)


def valid_name(name):
    """Наше ли это имя файла. Всё, что не подходит под шаблон, — чужое."""
    return bool(NAME_RX.match(str(name or '').strip()))


def mime_of(name):
    ext = str(name or '').rsplit('.', 1)[-1].lower()
    return MIMES.get(ext, 'application/octet-stream')


def path(name, must_exist=True):
    """Полный путь к нашему файлу. Имя проверяем по шаблону и ещё раз сверяем
    получившийся путь с каталогом: одной проверки для выхода за папку мало."""
    clean = str(name or '').strip()
    if not valid_name(clean):
        raise ApiError('not_found', 'Такой фотографии нет', 404)
    directory = folder()
    full = os.path.abspath(os.path.join(directory, clean))
    if os.path.dirname(full) != directory:
        raise ApiError('not_found', 'Такой фотографии нет', 404)
    if must_exist and not os.path.isfile(full):
        raise ApiError('not_found', 'Фотография не найдена: возможно, её уже удалили', 404)
    return full


def read(name):
    """Байты картинки и её тип. Наружу отдаёт роутер — он же проверяет права."""
    full = path(name)
    try:
        with open(full, 'rb') as f:
            raw = f.read()
    except OSError:
        raise ApiError('read_failed', 'Не получилось прочитать фотографию', 500)
    return raw, mime_of(name)


def exists(name):
    try:
        return os.path.isfile(path(name, must_exist=False))
    except ApiError:
        return False


def info(name):
    """Что известно о файле, не читая его целиком: размер и когда положили."""
    try:
        full = path(name, must_exist=False)
        st = os.stat(full)
    except (ApiError, OSError):
        return {'name': str(name or ''), 'exists': False, 'size': 0, 'at': 0,
                'mime': mime_of(name)}
    return {'name': str(name).strip(), 'exists': True, 'size': st.st_size,
            'at': int(st.st_mtime), 'mime': mime_of(name)}


def remove(name):
    """Удалить снимок. Нет файла или имя чужое — просто False, без исключения:
    удаление старого аватара не должно ронять загрузку нового."""
    try:
        full = path(name, must_exist=False)
    except ApiError:
        return False
    return _drop(full)


def _drop(full):
    try:
        os.remove(full)
        return True
    except OSError:
        return False


def url(name, base='/'):
    """Адрес картинки для браузера. Сервис может стоять в подпапке (site.kg/go/),
    поэтому префикс установки передаём снаружи, а не выдумываем здесь."""
    prefix = '/' + str(base or '/').strip().strip('/')
    prefix = prefix if prefix == '/' else prefix + '/'
    return '%sapi/v1/uploads/%s' % (prefix, str(name or '').strip())
