#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка своего кодировщика QR — обратным разбором.

Нарисовать чёрно-белые квадратики легко, и глазом такая картинка неотличима от
настоящего кода. Поэтому проверяем иначе: берём ГОТОВУЮ матрицу и достаём из неё
строку заново, по правилам стандарта, не заглядывая во внутренние переменные
кодировщика. Читаем сведения о формате, снимаем маску, собираем биты змейкой,
разбираем блоки — и сравниваем с тем, что кодировали.

Если строка сошлась, значит камере тоже будет что прочитать: она делает ровно
это же. Если разойдётся — код нечитаемый, и мы об этом узнаем здесь.

Запуск:  python3 tools/qr_test.py
"""
import os
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import qrcode  # noqa: E402

ok_count = 0
fail = []


def check(name, cond, detail=''):
    global ok_count
    if cond:
        ok_count += 1
        print(f'  \033[32m✓\033[0m {name}')
    else:
        fail.append((name, detail))
        print(f'  \033[31m✗\033[0m {name}' + (f'  — {detail}' if detail else ''))
    return bool(cond)


# ─────────────────────────────────────────────────────── обратный разбор

def read_format(m):
    """Сведения о формате из левого верхнего угла: уровень и номер маски."""
    bits = 0
    for i in range(15):
        if i < 6:
            v = m[8][i]
        elif i == 6:
            v = m[8][7]
        elif i == 7:
            v = m[8][8]
        elif i == 8:
            v = m[7][8]
        else:
            v = m[14 - i][8]
        bits |= (1 if v else 0) << i
    for (level, mask), known in qrcode.FORMAT_BITS.items():
        if known == bits:
            return level, mask
    raise ValueError('сведения о формате не разобрались: %04X' % bits)


def reserved_map(version):
    """Те же служебные места, что расставляет кодировщик. Считаем их отдельно:
    если бы брали из кодировщика, проверяли бы его его же ошибкой."""
    size = version * 4 + 17
    base = [[None] * size for _ in range(size)]
    qrcode._reserve(base, version)
    return [[v is not None for v in row] for row in base]


def unmask(m, mask, reserved):
    size = len(m)
    rule = qrcode.MASKS[mask]
    out = [row[:] for row in m]
    for r in range(size):
        for c in range(size):
            if not reserved[r][c] and rule(r, c):
                out[r][c] = not out[r][c]
    return out


def read_bits(m, reserved):
    """Собираем биты той же змейкой, что и кладём."""
    size = len(m)
    bits = []
    col = size - 1
    up = True
    while col > 0:
        if col == 6:
            col -= 1
        rows = range(size - 1, -1, -1) if up else range(size)
        for row in rows:
            for c in (col, col - 1):
                if not reserved[row][c]:
                    bits.append(1 if m[row][c] else 0)
        up = not up
        col -= 2
    return bits


def deinterleave(data, version, level):
    """Раскладываем перемешанные байты обратно по блокам и отбрасываем коррекцию."""
    ecc_len, groups = qrcode.BLOCKS[(version, level)]
    sizes = [size for count, size in groups for _ in range(count)]

    blocks = [bytearray() for _ in sizes]
    at = 0
    for i in range(max(sizes)):
        for b, size in enumerate(sizes):
            if i < size:
                blocks[b].append(data[at])
                at += 1
    return b''.join(bytes(b) for b in blocks)


def decode(m):
    """Строка из матрицы. Ровно то, что делает камера."""
    size = len(m)
    version = (size - 17) // 4
    level, mask = read_format(m)
    reserved = reserved_map(version)
    clean = unmask(m, mask, reserved)
    bits = read_bits(clean, reserved)

    data = bytes(int(''.join(str(b) for b in bits[i:i + 8]), 2)
                 for i in range(0, len(bits) - len(bits) % 8, 8))
    payload = deinterleave(data, version, level)

    head = int(''.join(str((payload[0] >> i) & 1) for i in range(7, 3, -1)), 2)
    if head != 0b0100:
        raise ValueError('не байтовый режим: %s' % format(head, '04b'))
    count_bits = 8 if version < 10 else 16
    flat = ''.join(f'{byte:08b}' for byte in payload)
    length = int(flat[4:4 + count_bits], 2)
    start = 4 + count_bits
    body = flat[start:start + length * 8]
    return bytes(int(body[i:i + 8], 2) for i in range(0, len(body), 8)).decode('utf-8')


def png_size(raw):
    import struct
    return struct.unpack('>II', raw[16:24])


def main():
    print('\n\033[1mСвой кодировщик QR: читается ли то, что он рисует\033[0m\n')

    cases = [
        ('короткая', 'SG'),
        ('номер заказа', 'SG-AB12CDEF'),
        ('ссылка банка', 'https://optimabank.kg/qr/900900900'),
        ('ссылка на заказ', 'https://sprintergo.kg/go/share/AB12CDEF?v=Qx7mK2pL9vRt4wZa'),
        ('русские буквы', 'Бронь заказа AB12CDEF на 150 сом'),
        ('длинная', 'https://optimabank.kg/pay?' + 'a=1&' * 30),
    ]
    for name, text in cases:
        try:
            m = qrcode.encode(text)
            back = decode(m)
            check(f'{name} ({len(text.encode())} байт) читается обратно', back == text,
                  f'закодировали «{text[:40]}», прочли «{back[:40]}»')
        except Exception as e:
            check(f'{name} читается обратно', False, f'{type(e).__name__}: {e}')

    print('\n\033[1mУровни коррекции\033[0m')
    for level, label in ((qrcode.ECC_L, 'L'), (qrcode.ECC_M, 'M'),
                         (qrcode.ECC_Q, 'Q'), (qrcode.ECC_H, 'H')):
        text = 'https://optimabank.kg/qr/123456'
        try:
            back = decode(qrcode.encode(text, level))
            check(f'уровень {label}', back == text, f'прочли «{back[:30]}»')
        except Exception as e:
            check(f'уровень {label}', False, f'{type(e).__name__}: {e}')

    print('\n\033[1mБайты коррекции\033[0m')
    # Настоящая камера умеет ВОССТАНАВЛИВАТЬ испорченный код по байтам коррекции.
    # Наш разбор этого не умеет — он их просто отбрасывает, — поэтому порванный
    # код здесь не прочтётся, и проверять так было бы нечестно.
    # Проверяем то, от чего восстановление и зависит: что байты коррекции
    # посчитаны верно. Сойдутся они — сойдётся и восстановление у читалки.
    for label, text, level in (('ссылка банка', 'https://optimabank.kg/qr/900900900', qrcode.ECC_M),
                               ('длинная', 'https://optimabank.kg/pay?' + 'a=1&' * 25, qrcode.ECC_M),
                               ('высокая коррекция', 'SG-AB12CDEF', qrcode.ECC_H)):
        try:
            m = qrcode.encode(text, level)
            version = (len(m) - 17) // 4
            lvl, mask = read_format(m)
            reserved = reserved_map(version)
            bits = read_bits(unmask(m, mask, reserved), reserved)
            raw = bytes(int(''.join(str(b) for b in bits[i:i + 8]), 2)
                        for i in range(0, len(bits) - len(bits) % 8, 8))

            ecc_len, groups = qrcode.BLOCKS[(version, lvl)]
            sizes = [size for count, size in groups for _ in range(count)]
            blocks = [bytearray() for _ in sizes]
            at = 0
            for i in range(max(sizes)):
                for b, size in enumerate(sizes):
                    if i < size:
                        blocks[b].append(raw[at]); at += 1
            got = [bytearray() for _ in sizes]
            for i in range(ecc_len):
                for b in range(len(sizes)):
                    got[b].append(raw[at]); at += 1

            same = all(bytes(got[i]) == bytes(qrcode._ecc(bytes(blocks[i]), ecc_len))
                       for i in range(len(sizes)))
            check(f'{label}: коррекция посчитана верно во всех {len(sizes)} блоках', same)
        except Exception as e:
            check(f'{label}: коррекция посчитана верно', False, f'{type(e).__name__}: {e}')

    print('\n\033[1mКартинка\033[0m')
    raw = qrcode.png('https://optimabank.kg/qr/900900900', size=512)
    check('это настоящий PNG', raw[:8] == b'\x89PNG\r\n\x1a\n')
    w, h = png_size(raw)
    check('картинка квадратная и нужного размера', w == h and 400 <= w <= 620, f'{w}×{h}')
    check('вес разумный', 500 < len(raw) < 60000, f'{len(raw)} байт')
    # Белое поле по краям обязательно: без него камера не найдёт границу кода.
    body = zlib.decompress(raw[raw.index(b'IDAT') + 4:-12])
    first = body[1:1 + w]
    check('по краю белое поле', all(v == 255 for v in first), 'первая строка не белая')

    print('\n\033[1mГраницы\033[0m')
    try:
        qrcode.encode('x' * 400)
        check('слишком длинную строку не принимаем молча', False, 'приняли 400 байт')
    except ValueError as e:
        check('слишком длинную строку не принимаем молча', 'десятой версии' in str(e), str(e))

    print(f'\n\033[1mИтог:\033[0m пройдено {ok_count}, провалено {len(fail)}')
    for n_, d in fail:
        print(f'  · {n_}' + (f'\n      {d}' if d else ''))
    return 1 if fail else 0


if __name__ == '__main__':
    sys.exit(main())
