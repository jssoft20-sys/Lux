#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Завести курьера напрямую в базе, минуя регистрацию и модерацию.

Пригодится, когда водителя надо добавить руками: он не осилил регистрацию,
или вы заводите первую бригаду до запуска. Курьер сразу активен и может входить.

Запуск:
  python3 tools/mkcourier.py почта пароль "Имя Фамилия" телефон [класс] [марка] [госномер]

Класс машины должен совпадать с классом тарифа: express, van, truck, truck_big.
Посмотреть доступные:  python3 tools/mkcourier.py --classes
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import auth, db  # noqa: E402


def open_db():
    db.init(os.environ.get('SG_DB') or os.path.join(ROOT, 'data', 'sprintergo.sqlite3'))


def main():
    if '--classes' in sys.argv:
        open_db()
        rows = db.rows('SELECT code, name_ru, vehicle_class, capacity_kg FROM tariffs ORDER BY sort')
        print('Классы машин из тарифов:')
        for r in rows:
            print(f"  {r['vehicle_class']:12} — {r['name_ru']} (до {r['capacity_kg']} кг)")
        return 0

    if len(sys.argv) < 5:
        print(__doc__)
        return 2

    email = sys.argv[1].strip().lower()
    password = sys.argv[2]
    name = sys.argv[3].strip()
    phone = sys.argv[4].strip()
    vclass = sys.argv[5] if len(sys.argv) > 5 else 'van'
    car = sys.argv[6] if len(sys.argv) > 6 else ''
    plate = sys.argv[7] if len(sys.argv) > 7 else ''

    if len(password) < 8:
        print('Пароль должен быть не короче 8 символов.')
        return 2

    open_db()
    known = [r['vehicle_class'] for r in db.rows('SELECT DISTINCT vehicle_class FROM tariffs')]
    if known and vclass not in known:
        print(f'Класс «{vclass}» не совпадает ни с одним тарифом. Есть: {", ".join(known)}')
        print('Курьер с чужим классом просто не будет получать заказы.')
        return 2

    try:
        phone = auth.normalize_phone(phone)
    except Exception:
        pass

    exists = db.row('SELECT id FROM users WHERE email=?', (email,))
    user = {'role': 'courier', 'email': email, 'name': name, 'phone': phone,
            'password_hash': auth.hash_password(password), 'status': 'active', 'lang': 'ru'}
    if exists:
        uid = exists['id']
        db.update('users', user, 'id=?', (uid,))
        action = 'обновлён'
    else:
        user['created_at'] = db.now()
        uid = db.insert('users', user)
        action = 'создан'

    # Курьера завели руками — значит документы владелец уже посмотрел вживую.
    # Иначе он войдёт, но заказов не получит: диспетчер отсеивает непроверенных.
    prof = {'vehicle_class': vclass, 'car_model': car, 'car_plate': plate,
            'verify_status': 'approved', 'verified_at': db.now()}
    if db.row('SELECT 1 FROM couriers WHERE user_id=?', (uid,)):
        db.update('couriers', prof, 'user_id=?', (uid,))
    else:
        prof['user_id'] = uid
        db.insert('couriers', prof)

    print(f'Курьер {name} {action}.')
    print(f'  почта:  {email}')
    print(f'  класс:  {vclass}')
    print('  проверка: пройдена (заведён вручную)')
    print('  входить здесь: /courier')
    return 0


if __name__ == '__main__':
    sys.exit(main())
