# -*- coding: utf-8 -*-
"""Свой кодировщик QR. Чистый Python, без единой библиотеки.

Зачем он нужен. Во-первых, демо-оплата: владелец должен увидеть настоящий экран
с настоящим кодом раньше, чем банк выдаст ему ключи. Во-вторых, запас: если банк
однажды пришлёт только ссылку без картинки, нарисовать код будет чем.

Это не заглушка и не картинка, похожая на QR. Здесь настоящий стандарт:
байтовый режим, коррекция ошибок Рида-Соломона, выбор лучшей маски по штрафам.
Код читается обычной камерой телефона.

  encode(text)              -> матрица булевых, True — чёрная точка
  png(text, size=512)       -> готовый PNG в байтах

Поддерживаем версии с 1 по 10 (до 213 байт при уровне M) — ссылке банка этого
хватает с запасом, а таблицы для старших версий раздули бы файл вдвое.
"""

import zlib
import struct

# ─────────────────────────────────────────────────────────── таблицы стандарта

# Уровни коррекции: сколько данных можно потерять и всё равно прочитать код.
# Берём M (около 15 %) — золотая середина: код остаётся некрупным, но переживает
# и блик, и палец на углу экрана.
ECC_L, ECC_M, ECC_Q, ECC_H = 0, 1, 2, 3

# Сколько всего байт данных в версии при каждом уровне коррекции (L, M, Q, H).
# Это байты ПОСЛЕ вычета коррекции, но ДО вычета заголовка — из них ещё уйдёт
# полтора байта на режим и длину.
DATA_CW = {
    1:  (19, 16, 13, 9),      2: (34, 28, 22, 16),     3: (55, 44, 34, 26),
    4:  (80, 64, 48, 36),     5: (108, 86, 62, 46),    6: (136, 108, 76, 60),
    7:  (156, 124, 88, 66),   8: (194, 154, 110, 86),  9: (232, 182, 132, 100),
    10: (274, 216, 154, 122),
}

# Как данные бьются на блоки: (байт коррекции на блок, [(сколько блоков, байт в блоке)]).
# Блоки бывают двух длин, и разница ровно в один байт — но не всегда, поэтому
# длины выписаны явно. Первая же попытка «блоки второй группы на байт длиннее»
# разошлась с действительностью на половине сочетаний, и код не читался.
BLOCKS = {
    (1, 0): (7, [(1, 19)]),    (1, 1): (10, [(1, 16)]),   (1, 2): (13, [(1, 13)]),   (1, 3): (17, [(1, 9)]),
    (2, 0): (10, [(1, 34)]),   (2, 1): (16, [(1, 28)]),   (2, 2): (22, [(1, 22)]),   (2, 3): (28, [(1, 16)]),
    (3, 0): (15, [(1, 55)]),   (3, 1): (26, [(1, 44)]),   (3, 2): (18, [(2, 17)]),   (3, 3): (22, [(2, 13)]),
    (4, 0): (20, [(1, 80)]),   (4, 1): (18, [(2, 32)]),   (4, 2): (26, [(2, 24)]),   (4, 3): (16, [(4, 9)]),
    (5, 0): (26, [(1, 108)]),  (5, 1): (24, [(2, 43)]),   (5, 2): (18, [(2, 15), (2, 16)]),
    (5, 3): (22, [(2, 11), (2, 12)]),
    (6, 0): (18, [(2, 68)]),   (6, 1): (16, [(4, 27)]),   (6, 2): (24, [(4, 19)]),   (6, 3): (28, [(4, 15)]),
    (7, 0): (20, [(2, 78)]),   (7, 1): (18, [(4, 31)]),   (7, 2): (18, [(2, 14), (4, 15)]),
    (7, 3): (26, [(4, 13), (1, 14)]),
    (8, 0): (24, [(2, 97)]),   (8, 1): (22, [(2, 38), (2, 39)]),
    (8, 2): (22, [(4, 18), (2, 19)]), (8, 3): (26, [(4, 14), (2, 15)]),
    (9, 0): (30, [(2, 116)]),  (9, 1): (22, [(3, 36), (2, 37)]),
    (9, 2): (20, [(4, 16), (4, 17)]), (9, 3): (24, [(4, 12), (4, 13)]),
    (10, 0): (18, [(2, 68), (2, 69)]), (10, 1): (26, [(4, 43), (1, 44)]),
    (10, 2): (24, [(6, 19), (2, 20)]), (10, 3): (28, [(6, 15), (2, 16)]),
}


def text_capacity(version, level):
    """Сколько байт самого текста влезает: всё за вычетом режима и длины."""
    head = 4 + (8 if version < 10 else 16)
    return (DATA_CW[version][level] * 8 - head) // 8


# Где стоят выравнивающие квадраты. Для версии 1 их нет вовсе.
ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}

# Готовые строки сведений о формате: уровень коррекции и номер маски вместе с
# их собственной защитой от ошибок. Считать их на лету можно, но таблица короче
# и не даёт ошибиться в редко исполняемом коде.
FORMAT_BITS = {
    (ECC_L, 0): 0x77C4, (ECC_L, 1): 0x72F3, (ECC_L, 2): 0x7DAA, (ECC_L, 3): 0x789D,
    (ECC_L, 4): 0x662F, (ECC_L, 5): 0x6318, (ECC_L, 6): 0x6C41, (ECC_L, 7): 0x6976,
    (ECC_M, 0): 0x5412, (ECC_M, 1): 0x5125, (ECC_M, 2): 0x5E7C, (ECC_M, 3): 0x5B4B,
    (ECC_M, 4): 0x45F9, (ECC_M, 5): 0x40CE, (ECC_M, 6): 0x4F97, (ECC_M, 7): 0x4AA0,
    (ECC_Q, 0): 0x355F, (ECC_Q, 1): 0x3068, (ECC_Q, 2): 0x3F31, (ECC_Q, 3): 0x3A06,
    (ECC_Q, 4): 0x24B4, (ECC_Q, 5): 0x2183, (ECC_Q, 6): 0x2EDA, (ECC_Q, 7): 0x2BED,
    (ECC_H, 0): 0x1689, (ECC_H, 1): 0x13BE, (ECC_H, 2): 0x1CE7, (ECC_H, 3): 0x19D0,
    (ECC_H, 4): 0x0762, (ECC_H, 5): 0x0255, (ECC_H, 6): 0x0D0C, (ECC_H, 7): 0x083B,
}


# ─────────────────────────────────────────────────────────── арифметика Галуа

# Коррекция Рида-Соломона живёт в поле из 256 элементов, где умножение — это
# сложение логарифмов. Таблицы считаем один раз при загрузке модуля.
_EXP = [0] * 512
_LOG = [0] * 256

def _init_tables():
    x = 1
    for i in range(255):
        _EXP[i] = x
        _LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D          # порождающий многочлен поля, как в стандарте
    for i in range(255, 512):
        _EXP[i] = _EXP[i - 255]

_init_tables()


def _mul(a, b):
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _gen_poly(n):
    """Порождающий многочлен для n байт коррекции."""
    g = [1]
    for i in range(n):
        g.append(0)
        for j in range(len(g) - 1, 0, -1):
            g[j] = g[j - 1] ^ _mul(g[j], _EXP[i])
        g[0] = _mul(g[0], _EXP[i])
    return g


def _ecc(data, n):
    """Байты коррекции для блока данных: остаток от деления на порождающий."""
    g = _gen_poly(n)
    rest = list(data) + [0] * n
    for i in range(len(data)):
        f = rest[i]
        if f:
            for j in range(len(g)):
                rest[i + j] ^= _mul(g[j], f)
    return rest[len(data):]


# ─────────────────────────────────────────────────────────── сборка данных

def _pick_version(length, level):
    for v in range(1, 11):
        if text_capacity(v, level) >= length:
            return v
    raise ValueError('Строка длиннее, чем помещается в QR десятой версии: %d байт' % length)


def _bitstream(data, version, level):
    """Данные в биты: режим, длина, сами байты, добивка до полной ёмкости."""
    bits = []

    def put(value, count):
        for i in range(count - 1, -1, -1):
            bits.append((value >> i) & 1)

    put(0b0100, 4)                                  # байтовый режим
    put(len(data), 8 if version < 10 else 16)       # длина
    for byte in data:
        put(byte, 8)

    total = DATA_CW[version][level] * 8
    put(0, min(4, total - len(bits)))               # признак конца, если влезает
    while len(bits) % 8:
        bits.append(0)

    # Хвост добиваем двумя чередующимися байтами — так велит стандарт.
    pad = (0xEC, 0x11)
    i = 0
    while len(bits) < total:
        put(pad[i % 2], 8)
        i += 1

    return bytes(int(''.join(str(b) for b in bits[k:k + 8]), 2)
                 for k in range(0, len(bits), 8))


def _interleave(payload, version, level):
    """Данные и коррекция вперемешку по блокам — иначе царапина убьёт весь код."""
    ecc_len, groups = BLOCKS[(version, level)]
    sizes = [size for count, size in groups for _ in range(count)]
    if sum(sizes) != len(payload):
        # Разойтись это может только при ошибке в таблицах выше. Лучше упасть
        # здесь, чем нарисовать картинку, которую не прочтёт ни одна камера.
        raise ValueError('размеры блоков не сходятся: %d против %d' % (sum(sizes), len(payload)))

    blocks, eccs, at = [], [], 0
    for size in sizes:
        chunk = payload[at:at + size]
        at += size
        blocks.append(chunk)
        eccs.append(_ecc(chunk, ecc_len))

    out = bytearray()
    for i in range(max(sizes)):
        for b in blocks:
            if i < len(b):
                out.append(b[i])
    for i in range(ecc_len):
        for e in eccs:
            out.append(e[i])
    return out


# ─────────────────────────────────────────────────────────── рисование сетки

def _blank(size):
    return [[None] * size for _ in range(size)]


def _put_finder(m, r, c):
    """Большой квадрат в углу — по нему камера находит код и его поворот."""
    for i in range(-1, 8):
        for j in range(-1, 8):
            y, x = r + i, c + j
            if not (0 <= y < len(m) and 0 <= x < len(m)):
                continue
            edge = (0 <= i <= 6 and j in (0, 6)) or (0 <= j <= 6 and i in (0, 6))
            core = 2 <= i <= 4 and 2 <= j <= 4
            m[y][x] = edge or core


def _put_align(m, r, c):
    for i in range(-2, 3):
        for j in range(-2, 3):
            m[r + i][c + j] = max(abs(i), abs(j)) != 1


def _reserve(m, version):
    """Служебные места: углы, полосы, сведения о формате."""
    size = len(m)
    for r, c in ((0, 0), (0, size - 7), (size - 7, 0)):
        _put_finder(m, r, c)

    for i in range(8, size - 8):                    # полосы-линейки
        v = i % 2 == 0
        if m[6][i] is None:
            m[6][i] = v
        if m[i][6] is None:
            m[i][6] = v

    spots = ALIGN[version]
    for r in spots:
        for c in spots:
            near_finder = ((r <= 8 and c <= 8) or (r <= 8 and c >= size - 9)
                           or (r >= size - 9 and c <= 8))
            if not near_finder:
                _put_align(m, r, c)

    m[size - 8][8] = True                           # всегда чёрная точка

    for i in range(9):                              # места под сведения о формате
        if m[8][i] is None:
            m[8][i] = False
        if m[i][8] is None:
            m[i][8] = False
    for i in range(8):
        if m[8][size - 1 - i] is None:
            m[8][size - 1 - i] = False
        if m[size - 1 - i][8] is None:
            m[size - 1 - i][8] = False


def _place(m, data):
    """Данные идут змейкой снизу вверх по два столбца, обходя занятое."""
    size = len(m)
    bits = [(byte >> i) & 1 for byte in data for i in range(7, -1, -1)]
    at = 0
    col = size - 1
    up = True
    while col > 0:
        if col == 6:
            col -= 1                                # столбец-линейка пропускается
        rows = range(size - 1, -1, -1) if up else range(size)
        for row in rows:
            for c in (col, col - 1):
                if m[row][c] is None:
                    m[row][c] = bool(bits[at]) if at < len(bits) else False
                    at += 1
        up = not up
        col -= 2


MASKS = (
    lambda r, c: (r + c) % 2 == 0,
    lambda r, c: r % 2 == 0,
    lambda r, c: c % 3 == 0,
    lambda r, c: (r + c) % 3 == 0,
    lambda r, c: (r // 2 + c // 3) % 2 == 0,
    lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
    lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
    lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
)


def _penalty(m):
    """Штраф за некрасивый узор. Чем ровнее пятна и чем меньше ложных углов,
    тем легче камере: за это стандарт и штрафует."""
    size = len(m)
    score = 0

    # Длинные одноцветные полосы.
    for line in list(m) + [list(col) for col in zip(*m)]:
        run, prev = 1, line[0]
        for v in line[1:]:
            if v == prev:
                run += 1
            else:
                if run >= 5:
                    score += 3 + (run - 5)
                run, prev = 1, v
        if run >= 5:
            score += 3 + (run - 5)

    # Квадраты два на два.
    for r in range(size - 1):
        for c in range(size - 1):
            if m[r][c] == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                score += 3

    # Узор, похожий на угловой квадрат: камера может принять его за настоящий.
    fake = [True, False, True, True, True, False, True]
    for line in list(m) + [list(col) for col in zip(*m)]:
        for i in range(size - 6):
            if line[i:i + 7] == fake:
                before = i >= 4 and not any(line[i - 4:i])
                after = i + 11 <= size and not any(line[i + 7:i + 11])
                if before or after:
                    score += 40

    # Перекос между чёрным и белым.
    dark = sum(1 for row in m for v in row if v)
    score += abs(dark * 100 // (size * size) - 50) // 5 * 10
    return score


def _format_bits(m, level, mask):
    bits = FORMAT_BITS[(level, mask)]
    size = len(m)
    for i in range(15):
        bit = (bits >> i) & 1
        if i < 6:
            m[8][i] = bool(bit)
        elif i == 6:
            m[8][7] = bool(bit)
        elif i == 7:
            m[8][8] = bool(bit)
        elif i == 8:
            m[7][8] = bool(bit)
        else:
            m[14 - i][8] = bool(bit)

        if i < 8:
            m[size - 1 - i][8] = bool(bit)
        else:
            m[8][size - 15 + i] = bool(bit)


def encode(text, level=ECC_M):
    """Матрица кода: True — чёрная точка. Ровно то, что читает камера."""
    data = text.encode('utf-8') if isinstance(text, str) else bytes(text)
    version = _pick_version(len(data), level)
    size = version * 4 + 17

    payload = _bitstream(data, version, level)
    full = _interleave(payload, version, level)

    base = _blank(size)
    _reserve(base, version)
    reserved = [[v is not None for v in row] for row in base]
    _place(base, full)

    # Маску выбираем перебором: восемь вариантов, побеждает наименьший штраф.
    best, best_score = None, None
    for mask in range(8):
        trial = [row[:] for row in base]
        rule = MASKS[mask]
        for r in range(size):
            for c in range(size):
                if not reserved[r][c] and rule(r, c):
                    trial[r][c] = not trial[r][c]
        _format_bits(trial, level, mask)
        score = _penalty(trial)
        if best_score is None or score < best_score:
            best, best_score = trial, score

    return [[bool(v) for v in row] for row in best]


# ─────────────────────────────────────────────────────────── картинка

def _png(width, height, rows):
    """Собираем PNG вручную: подпись, заголовок, данные, конец."""
    def chunk(kind, body):
        return (struct.pack('>I', len(body)) + kind + body
                + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff))

    raw = bytearray()
    for row in rows:
        raw.append(0)                  # строка без фильтра: у нас всего два цвета
        raw += row
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0)   # 8 бит, оттенки серого
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))


def png(text, size=512, border=4, level=ECC_M):
    """Готовая картинка кода. border — белое поле в точках, без него камера
    не отличит край кода от фона; четыре точки требует стандарт."""
    m = encode(text, level)
    n = len(m)
    total = n + border * 2
    scale = max(1, size // total)
    width = total * scale

    rows = []
    for y in range(width):
        gy = y // scale - border
        line = bytearray([255]) * width
        if 0 <= gy < n:
            row = m[gy]
            for gx in range(n):
                if row[gx]:
                    start = (gx + border) * scale
                    for x in range(start, start + scale):
                        line[x] = 0
        rows.append(line)
    return _png(width, width, rows)
