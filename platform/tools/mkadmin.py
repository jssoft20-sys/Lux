#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Создать или пересоздать администратора напрямую в базе.

Нужно, когда пароль первого запуска потерян, а также для приёмочных тестов.
Запуск:  python3 tools/mkadmin.py почта пароль [Имя]
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import db, auth  # noqa: E402


def main():
    if len(sys.argv) < 3:
        print('Использование: python3 tools/mkadmin.py почта пароль [Имя]')
        return 2
    email = sys.argv[1].strip().lower()
    password = sys.argv[2]
    name = sys.argv[3] if len(sys.argv) > 3 else 'Администратор'
    if len(password) < 8:
        print('Пароль должен быть не короче 8 символов.')
        return 2

    db_path = os.environ.get('SG_DB') or os.path.join(ROOT, 'data', 'sprintergo.sqlite3')
    db.init(db_path)

    exists = db.row('SELECT id FROM users WHERE email=?', (email,))
    data = {
        'role': 'admin', 'email': email, 'name': name,
        'password_hash': auth.hash_password(password),
        'status': 'active', 'lang': 'ru',
    }
    if exists:
        db.update('users', data, 'id=?', (exists['id'],))
        print(f'Пароль администратора {email} обновлён.')
    else:
        data['created_at'] = db.now()
        db.insert('users', data)
        print(f'Администратор {email} создан.')
    print('Входить здесь: /admin')
    return 0


if __name__ == '__main__':
    sys.exit(main())
