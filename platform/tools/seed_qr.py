#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Положить в базу выпущенный код оплаты, как это сделал бы банк.

Нужен прогонам интерфейса: сам банк из-за границы недоступен, а экран оплаты
проверять надо. Печатает номер заказа, токен и сумму брони одной строкой JSON.

  python3 tools/seed_qr.py [телефон]
"""
import base64, json, os, sys, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import db, payments, settings  # noqa: E402


def tiny_qr_png():
    """Квадратик 64×64 вместо картинки банка: экрану важно, что она пришла."""
    n, rows = 64, []
    for y in range(n):
        line = bytearray([0])
        for x in range(n):
            dark = ((x // 8) + (y // 8)) % 2 == 0 or x < 8 or y < 8
            line += bytes([0 if dark else 255] * 3)
        rows.append(bytes(line))
    raw = zlib.compress(b''.join(rows), 9)

    def chunk(kind, data):
        import struct
        return (struct.pack('>I', len(data)) + kind + data
                + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff))

    import struct
    ihdr = struct.pack('>IIBBBBB', n, n, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', raw) + chunk(b'IEND', b''))


def main():
    db.init(os.environ.get('SG_DB')
            or os.path.join(os.environ.get('SG_DATA') or os.path.join(ROOT, 'data'),
                            'sprintergo.sqlite3'))
    phone = sys.argv[1] if len(sys.argv) > 1 else None
    where = 'WHERE phone=?' if phone else ''
    args = (phone,) if phone else ()
    client = db.row('SELECT * FROM clients %s ORDER BY id DESC LIMIT 1' % where, args)
    order = db.row('SELECT * FROM orders WHERE client_id=? ORDER BY id DESC LIMIT 1',
                   (client['id'],)) if client else db.row(
                       'SELECT * FROM orders ORDER BY id DESC LIMIT 1')
    if not order:
        print(json.dumps({'error': 'заказов в базе нет'}, ensure_ascii=False))
        return 1

    payments._ensure_schema()
    amount = max(5000, int(order.get('commission') or 0) // 2)
    now = db.now()
    tid = 'test-%d' % order['id']
    db.execute('DELETE FROM payment_qr WHERE order_id=?', (order['id'],))
    db.insert('payment_qr', {
        'transaction_id': tid, 'order_id': order['id'], 'public_id': order['public_id'],
        'provider': 'optima', 'amount': amount, 'status': 'pending',
        'qr_url': 'https://optimabank.kg/qr/' + tid,
        'qr_base64': base64.b64encode(tiny_qr_png()).decode('ascii'),
        'note': 'Бронь заказа ' + order['public_id'], 'sale_point': 1, 'cash': 1,
        'created_at': now, 'expires_at': now + 600, 'checked_at': 0, 'paid_amount': 0,
    })
    db.update('orders', {'status': 'draft', 'payment_method': 'online',
                         'payment_status': 'pending', 'payment_id': tid},
              'id=?', (order['id'],))
    print(json.dumps({'public_id': order['public_id'], 'token': order['track_token'],
                      'amount': amount, 'transaction_id': tid}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
