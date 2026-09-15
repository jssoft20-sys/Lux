# -*- coding: utf-8 -*-
"""Почта: очередь, SMTP и шаблоны писем.

Письмо уходит в фоновом потоке. Причина простая: SMTP-сервер может думать
и пять секунд, и тридцать, а человек в это время смотрит на крутилку в браузере.
Поэтому обработчик запроса только кладёт письмо в очередь и отвечает, а разговор
с сервером ведёт отдельный поток. Исключение — кнопка «Проверить почту»
в админке: там ответ нужен сразу и честный, поэтому test() шлёт синхронно.

Вёрстка писем — таблицами и инлайн-стилями. Это не вкусовщина: Gmail вырезает
внешние стили, Outlook не понимает flex и grid, а тёмная тема почти везде своя.
Таблица с bgcolor выглядит одинаково и в Gmail, и в Mail.ru, и в почте на телефоне.
Результат каждой отправки пишем в mail_log — иначе на вопрос «а почему курьеру
не пришло письмо» ответить нечем.
"""
import queue
import re
import smtplib
import socket
import ssl
import threading
import time
import traceback
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from html import escape as esc

from . import db, settings
from .core import ApiError, log
from .i18n_server import (fmt_date, fmt_distance, fmt_dt, fmt_duration, fmt_money,
                          norm_lang, payment_name, t)

# ─────────────────────────────────────────────────────────────── константы

SMTP_TIMEOUT = 20             # секунд на разговор с сервером
MAX_QUEUE = 500               # столько писем ждут отправки, дальше — отказ с записью в журнал
RETRY_DELAYS = (15, 60)       # две попытки повтора при обрыве связи
IDLE_CLOSE_S = 20             # через столько тишины закрываем соединение с SMTP

EMAIL_RX = re.compile(r'^[^@\s,;<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$')

# Палитра писем повторяет tokens.css: человек не должен видеть в почте
# другой сервис, чем в приложении.
C_BG = '#0E0E10'
C_CARD = '#17171A'
C_CARD_2 = '#202024'
C_LINE = '#2E2E36'
C_LINE_SOFT = '#24242B'
C_TEXT = '#F6F6F8'
C_SOFT = '#D3D3DC'
C_MUTED = '#9A9AA5'
C_MUTED_2 = '#6E6E78'
C_ACCENT = '#FFDF00'
C_INK = '#16150F'
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"


# ─────────────────────────────────────────────────────────────── настройки SMTP

def config():
    """Текущие настройки почты одним словарём. Читаем на каждую отправку:
    админ поменял пароль — следующее письмо уйдёт уже с новым."""
    secure = str(settings.get('smtp.secure', 'tls') or 'tls').strip().lower()
    if secure not in ('none', 'ssl', 'tls'):
        secure = 'tls'
    host = str(settings.get('smtp.host', '') or '').strip()
    user = str(settings.get('smtp.user', '') or '').strip()
    sender = str(settings.get('smtp.from', '') or '').strip() or user
    name = str(settings.get('smtp.from_name', '') or '').strip() \
        or str(settings.get('service.name', 'Sprinter Go'))
    port = settings.get_int('smtp.port', 465 if secure == 'ssl' else 587)
    return {
        'host': host,
        'port': port if 0 < port < 65536 else 587,
        'secure': secure,
        'user': user,
        'password': str(settings.get('smtp.pass', '') or ''),
        'from': sender,
        'from_name': name,
        # для почтовиков с самоподписанным сертификатом — иначе TLS не поднимется
        'insecure': settings.get_bool('smtp.insecure_tls', False),
    }


def configured(conf=None):
    """Есть ли вообще куда и от кого слать."""
    c = conf or config()
    return bool(c['host'] and c['from'])


def enabled():
    """Письма уходят, только если админ включил почту и заполнил настройки."""
    return settings.get_bool('mail.enabled', False) and configured()


# ─────────────────────────────────────────────────────────────── очередь и поток

_queue = queue.Queue(MAX_QUEUE)
_thread = None
_thread_lock = threading.Lock()
_STOP = {'stop': True}


def start():
    """Поднять фоновый поток. Вызывать необязательно: первое письмо поднимет сам."""
    global _thread
    with _thread_lock:
        if _thread is not None and _thread.is_alive():
            return _thread
        _thread = threading.Thread(target=_run, name='mailer', daemon=True)
        _thread.start()
        return _thread


def stop(timeout=5):
    """Аккуратно дослать то, что в очереди, и закончить. Для остановки сервиса."""
    global _thread
    with _thread_lock:
        th, _thread = _thread, None
    if th is None or not th.is_alive():
        return
    try:
        _queue.put_nowait(_STOP)
    except queue.Full:
        return
    th.join(timeout)


def queue_size():
    return _queue.qsize()


def _run():
    link = None                       # (ключ настроек, живое соединение)
    idle_since = time.monotonic()
    while True:
        try:
            try:
                item = _queue.get(timeout=2)
            except queue.Empty:
                if link is not None and time.monotonic() - idle_since > IDLE_CLOSE_S:
                    link = _close(link)
                continue
            try:
                if item is _STOP:
                    break
                if item['next_at'] > time.time():
                    # повтор ещё не созрел — пропускаем вперёд остальных
                    try:
                        _queue.put_nowait(item)
                    except queue.Full:
                        _record(item, 'failed', 'Очередь переполнена, повтор отменён')
                    time.sleep(0.5)
                    continue
                link = _deliver(item, link)
                idle_since = time.monotonic()
            finally:
                _queue.task_done()
        except Exception:
            # поток отправки не имеет права умирать: без него почта молча пропадёт
            log('почта: сбой в фоновом потоке\n' + traceback.format_exc())
            link = _close(link)
            time.sleep(1)
    _close(link)


def _ensure_worker():
    if _thread is None or not _thread.is_alive():
        start()


# ─────────────────────────────────────────────────────────────── SMTP

def _key(conf):
    return (conf['host'], conf['port'], conf['secure'], conf['user'])


def _ssl_context(conf):
    ctx = ssl.create_default_context()
    if conf['insecure']:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _connect(conf, timeout=SMTP_TIMEOUT):
    """Соединение по выбранному режиму: ssl — сразу шифрованное, tls — STARTTLS,
    none — открытое (так работают локальные релеи вроде postfix на 25 порту)."""
    if conf['secure'] == 'ssl':
        srv = smtplib.SMTP_SSL(conf['host'], conf['port'], timeout=timeout,
                               context=_ssl_context(conf))
    else:
        srv = smtplib.SMTP(conf['host'], conf['port'], timeout=timeout)
        srv.ehlo()
        if conf['secure'] == 'tls':
            srv.starttls(context=_ssl_context(conf))
            srv.ehlo()
    if conf['user']:
        srv.login(conf['user'], conf['password'])
    return srv


def _close(link):
    if link is not None:
        try:
            link[1].quit()
        except Exception:
            try:
                link[1].close()
            except Exception:
                pass
    return None


def _domain(addr):
    return addr.rsplit('@', 1)[-1] if '@' in addr else 'sprintergo.local'


def _build(item, conf):
    """Письмо в двух версиях сразу: текст для тех, кто отключил HTML и для
    антиспам-фильтров, и HTML для всех остальных."""
    msg = EmailMessage()
    msg['Subject'] = item['subject']
    msg['From'] = formataddr((conf['from_name'], conf['from']))
    msg['To'] = item['to']
    msg['Date'] = formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain=_domain(conf['from']))
    msg['Auto-Submitted'] = 'auto-generated'
    msg['X-Mailer'] = 'Sprinter Go'
    if item.get('reply_to'):
        msg['Reply-To'] = item['reply_to']
    msg.set_content(item['text'])
    msg.add_alternative(item['html'], subtype='html')
    return msg


def _deliver(item, link):
    conf = config()
    if not configured(conf):
        _record(item, 'failed', 'Почта не настроена: пустой SMTP-сервер или адрес отправителя')
        return link
    msg = _build(item, conf)
    key = _key(conf)
    if link is not None and link[0] != key:
        link = _close(link)          # настройки поменяли — старое соединение уже не то
    last = None
    for attempt in (0, 1):
        try:
            if link is None:
                link = (key, _connect(conf))
            link[1].send_message(msg)
            _record(item, 'sent', None)
            return link
        except smtplib.SMTPServerDisconnected as e:
            # обычное дело при повторном использовании соединения: сервер устал ждать
            last, link = e, _close(link)
            continue
        except Exception as e:
            last = e
            if not isinstance(e, (smtplib.SMTPSenderRefused, smtplib.SMTPRecipientsRefused,
                                  smtplib.SMTPDataError, smtplib.SMTPNotSupportedError)):
                link = _close(link)
            break
    _after_failure(item, last, conf)
    return link


def _retryable(e):
    """Повторять есть смысл только там, где виновата связь или временная перегрузка.
    Неверный пароль через минуту не станет верным."""
    if isinstance(e, (smtplib.SMTPAuthenticationError, smtplib.SMTPRecipientsRefused,
                      smtplib.SMTPSenderRefused, smtplib.SMTPNotSupportedError,
                      ssl.SSLCertVerificationError)):
        return False
    if isinstance(e, smtplib.SMTPResponseException):
        return 400 <= int(e.smtp_code or 0) < 500
    return isinstance(e, (OSError, smtplib.SMTPException))


def _after_failure(item, exc, conf):
    text = human_error(exc, conf)
    if _retryable(exc) and item['attempt'] < len(RETRY_DELAYS):
        item['attempt'] += 1
        item['next_at'] = time.time() + RETRY_DELAYS[item['attempt'] - 1]
        try:
            _queue.put_nowait(item)
            log('почта: повтор через %d с — %s (%s)'
                % (RETRY_DELAYS[item['attempt'] - 1], item['to'], text))
            return
        except queue.Full:
            pass
    _record(item, 'failed', text)
    log('почта: письмо не ушло —', item['to'], '—', text)


def _record(item, status, error):
    try:
        db.insert('mail_log', {
            'to_addr': str(item.get('to', ''))[:200],
            'subject': str(item.get('subject', ''))[:300],
            'template': str(item.get('template', ''))[:64],
            'status': status,
            'error': str(error)[:500] if error else None,
            'at': db.now(),
        })
    except Exception:
        log('почта: журнал недоступен —', status, item.get('to'))


def recent(limit=100, status=None):
    """Журнал отправок для админки: что, кому, когда и чем закончилось."""
    limit = max(1, min(int(limit or 100), 500))
    if status:
        return db.rows('SELECT * FROM mail_log WHERE status=? ORDER BY id DESC LIMIT ?',
                       (status, limit))
    return db.rows('SELECT * FROM mail_log ORDER BY id DESC LIMIT ?', (limit,))


# ─────────────────────────────────────────────────────────────── понятные ошибки

def _reason(e):
    """Текст ответа сервера без байтовой шелухи."""
    raw = getattr(e, 'smtp_error', None)
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', 'replace')
    raw = (raw or '').strip()
    return raw[:200]


def human_error(e, conf=None):
    """Исключение smtplib → фраза, по которой админ поймёт, что чинить.
    «[Errno 111] Connection refused» не объясняет ничего, «порт закрыт» — объясняет."""
    c = conf or config()
    where = '%s:%s' % (c['host'] or '—', c['port'])
    if e is None:
        return 'Письмо не отправлено по неизвестной причине'

    if isinstance(e, smtplib.SMTPAuthenticationError):
        return ('Сервер не принял логин или пароль (%s). Проверьте пару «пользователь — пароль»; '
                'для Gmail, Яндекса и Mail.ru нужен отдельный пароль приложения, обычный '
                'от аккаунта не подойдёт. Ответ сервера: %s' % (c['user'] or 'без логина', _reason(e)))
    if isinstance(e, smtplib.SMTPSenderRefused):
        return ('Сервер отказался принимать письмо от адреса «%s». Обычно адрес отправителя '
                'должен совпадать с логином или быть подтверждён в кабинете почтовика. '
                'Ответ сервера: %s' % (c['from'], _reason(e)))
    if isinstance(e, smtplib.SMTPRecipientsRefused):
        bad_list = ', '.join(str(k) for k in (e.recipients or {}))
        return ('Сервер отказался доставлять письмо получателю (%s). Проверьте адрес — '
                'возможно, в нём опечатка или такого ящика нет' % (bad_list or 'адрес неизвестен'))
    if isinstance(e, smtplib.SMTPNotSupportedError):
        return ('Сервер %s не поддерживает выбранный режим шифрования. Для порта 465 выбирайте '
                'SSL, для 587 — TLS, для локального релея на 25 — «без шифрования»' % where)
    if isinstance(e, smtplib.SMTPHeloError):
        return 'Сервер %s не поздоровался в ответ — похоже, на этом порту не SMTP' % where
    if isinstance(e, smtplib.SMTPDataError):
        return 'Сервер принял соединение, но отклонил само письмо: %s' % _reason(e)
    if isinstance(e, smtplib.SMTPServerDisconnected):
        return ('Сервер %s оборвал связь. Чаще всего так бывает, когда на порт 465 идут '
                'без SSL или наоборот — на 587 включают SSL вместо TLS' % where)
    if isinstance(e, smtplib.SMTPConnectError):
        return 'Не удалось начать разговор с %s: %s' % (where, _reason(e) or 'сервер молчит')
    if isinstance(e, ssl.SSLCertVerificationError):
        return ('Сертификат сервера %s не прошёл проверку. Если это внутренний почтовик '
                'с самоподписанным сертификатом, включите настройку smtp.insecure_tls' % where)
    if isinstance(e, ssl.SSLError):
        return ('Не получилось договориться о шифровании с %s. Похоже, режим SSL выбран '
                'для порта, где нужен TLS (или наоборот)' % where)
    if isinstance(e, socket.gaierror):
        return 'Не нашли сервер по имени «%s» — проверьте адрес, он пишется без http' % (c['host'] or '—')
    if isinstance(e, ConnectionRefusedError):
        return 'Порт %s закрыт: сервер есть, но соединение отклонено — проверьте номер порта' % where
    if isinstance(e, (socket.timeout, TimeoutError)):
        return ('Сервер %s не ответил за %d секунд. Обычно так себя ведёт закрытый файрволом '
                'порт: у многих хостеров 25-й закрыт, работает 465 или 587' % (where, SMTP_TIMEOUT))
    if isinstance(e, smtplib.SMTPResponseException):
        return 'Сервер ответил ошибкой %s: %s' % (e.smtp_code, _reason(e))
    if isinstance(e, OSError):
        return 'Сеть недоступна для %s: %s' % (where, e)
    return 'Не получилось отправить письмо: %s' % e


# ─────────────────────────────────────────────────────────────── публичные отправки

def _addresses(to):
    """Адреса из строки, списка или кортежа. Строку с запятыми разбираем —
    в настройках админки список получателей обычно пишут в одну строку.
    Кривые и опасные отсеиваем: перевод строки в адресе — это чужие заголовки
    в нашем письме."""
    raw = re.split(r'[,;\s]+', to) if isinstance(to, str) else list(to or ())
    out = []
    for a in raw:
        a = str(a or '').strip()
        if '\n' in a or '\r' in a or not EMAIL_RX.match(a):
            continue
        if a not in out:
            out.append(a)
    return out


def _item(addr, subject, html_body, text_body, template, reply_to=None):
    return {'to': addr, 'subject': subject, 'html': html_body, 'text': text_body,
            'template': template, 'reply_to': reply_to, 'attempt': 0, 'next_at': 0.0}


def _enqueue(item):
    if not enabled():
        _record(item, 'skipped', 'Отправка почты выключена в настройках')
        return False
    try:
        _queue.put_nowait(item)
    except queue.Full:
        _record(item, 'failed', 'Очередь писем переполнена, письмо не принято')
        return False
    _ensure_worker()
    return True


def send(to, template, vars=None, lang='ru'):
    """Письмо по шаблону. Возвращает True, если письмо принято в очередь.

    Ошибка отправки сюда не прилетает — она попадёт в mail_log и в лог сервера:
    заказ не должен падать из-за того, что у почтовика выходной.
    """
    addrs = _addresses(to)
    if not addrs:
        return False
    lang = norm_lang(lang)
    subject, html_body, text_body = render(template, vars, lang)
    ok = False
    for addr in addrs:
        ok = _enqueue(_item(addr, subject, html_body, text_body, template)) or ok
    return ok


def send_raw(to, subject, html, text=None, template='raw'):
    """Письмо с готовым телом — когда текст пишет админ, а не шаблон."""
    addrs = _addresses(to)
    if not addrs:
        return False
    subject = str(subject or '').replace('\n', ' ').replace('\r', ' ').strip()[:300]
    html_body = html or ''
    text_body = text if text is not None else _strip_tags(html_body)
    ok = False
    for addr in addrs:
        ok = _enqueue(_item(addr, subject, html_body, text_body, template)) or ok
    return ok


def test(to):
    """Проверочное письмо для кнопки в админке. Шлём синхронно и, если не вышло,
    объясняем человеческим языком, что именно не так."""
    conf = config()
    addrs = _addresses(to)
    if not addrs:
        raise ApiError('bad_email', 'Адрес написан с ошибкой — проверьте почту получателя', 400)
    if not conf['host']:
        raise ApiError('smtp_not_set', 'Не заполнен адрес SMTP-сервера в настройках почты', 400)
    if not conf['from']:
        raise ApiError('smtp_not_set',
                       'Не заполнен адрес отправителя: без него почтовые сервисы отклонят письмо', 400)

    addr = addrs[0]
    subject, html_body, text_body = render('test', {
        'host': conf['host'], 'port': conf['port'], 'secure': conf['secure'],
        'sender': conf['from'], 'user': conf['user'],
    }, 'ru')
    item = _item(addr, subject, html_body, text_body, 'test')
    started = time.monotonic()
    srv = None
    try:
        srv = _connect(conf)
        srv.send_message(_build(item, conf))
    except Exception as e:
        text = human_error(e, conf)
        _record(item, 'failed', text)
        log('почта: проверка не прошла —', text)
        raise ApiError('mail_failed', text, 502)
    finally:
        if srv is not None:
            try:
                srv.quit()
            except Exception:
                pass
    took = int((time.monotonic() - started) * 1000)
    _record(item, 'sent', None)
    return {'ok': True, 'to': addr, 'ms': took, 'host': conf['host'], 'port': conf['port'],
            'secure': conf['secure'], 'from': conf['from'],
            'message': 'Письмо ушло за %d мс. Если его нет во «Входящих» — загляните в «Спам»' % took}


# ─────────────────────────────────────────────────────────────── сборка письма

def _strip_tags(s):
    """Грубая текстовая версия для send_raw: теги долой, абзацы — переводом строки."""
    s = re.sub(r'(?is)<(script|style).*?</\1>', '', s or '')
    s = re.sub(r'(?i)<br\s*/?>', '\n', s)
    s = re.sub(r'(?i)</(p|div|tr|h[1-6])>', '\n', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return re.sub(r'\n{3,}', '\n\n', s).strip()


def _safe_url(url):
    """В кнопку пускаем только http и https: mailto и javascript в письме не нужны."""
    u = str(url or '').strip()
    if not u or any(ch in u for ch in ' \t\r\n"\'<>'):
        return None
    return u if u[:7].lower() == 'http://' or u[:8].lower() == 'https://' else None


def _text_block(s):
    return {'kind': 'text', 'text': s}


def _rows_block(rows):
    return {'kind': 'rows', 'rows': rows}


def _lines_block(items):
    return {'kind': 'lines', 'items': items}


def _total_block(label, value, hint=None):
    return {'kind': 'total', 'label': label, 'value': value, 'hint': hint}


def _button_block(label, url):
    return {'kind': 'button', 'label': label, 'url': url}


def _note_block(s):
    return {'kind': 'note', 'text': s}


SHELL = """<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" \
"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="{{LANG}}">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" content="" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>{{TITLE}}</title>
<style type="text/css">
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse !important; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  a { color: #FFDF00; }
  @media only screen and (max-width: 620px) {
    .wrap { width: 100% !important; max-width: 100% !important; }
    .pad { padding: 24px 18px 26px 18px !important; }
    .h1 { font-size: 22px !important; line-height: 28px !important; }
    .big { font-size: 25px !important; }
    .btn a { display: block !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:{{BG}};">
<span style="display:none; font-size:1px; color:{{BG}}; line-height:1px; max-height:0; \
max-width:0; opacity:0; overflow:hidden;">{{PRE}}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" \
style="background-color:{{BG}}; width:100%;">
<tr><td align="center" style="padding:26px 12px 40px 12px;">
<table role="presentation" class="wrap" cellpadding="0" cellspacing="0" border="0" width="600" \
style="width:600px; max-width:600px;">
<tr><td align="left" style="padding:0 4px 16px 4px; font-family:{{FONT}}; font-size:17px; \
font-weight:700; letter-spacing:1.6px; color:{{TEXT}};">SPRINTER<span \
style="color:{{ACCENT}};">&nbsp;GO</span></td></tr>
<tr><td style="background-color:{{CARD}}; border:1px solid {{LINE}}; border-radius:20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr><td style="height:4px; line-height:4px; font-size:4px; background-color:{{ACCENT}}; \
border-radius:19px 19px 0 0;">&nbsp;</td></tr>
<tr><td class="pad" style="padding:30px 30px 32px 30px; font-family:{{FONT}};">
{{BODY}}
</td></tr>
</table>
</td></tr>
<tr><td style="padding:18px 10px 0 10px; font-family:{{FONT}}; font-size:12px; \
line-height:19px; color:{{MUTED2}};">{{FOOTER}}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"""


def _footer_html(lang):
    name = esc(str(settings.get('service.name', 'Sprinter Go')))
    city = esc(str(settings.get('service.city', '') or ''))
    phone = str(settings.get('service.phone', '') or '')
    head = ' · '.join(x for x in (name, city) if x)
    if phone:
        head += ' · <a href="tel:%s" style="color:%s; text-decoration:none;">%s</a>' % (
            esc(re.sub(r'[^\d+]', '', phone)), C_MUTED, esc(phone))
    return '%s<br />%s' % (head, esc(t('mail.footer_auto', lang)))


def _footer_text(lang):
    name = str(settings.get('service.name', 'Sprinter Go'))
    city = str(settings.get('service.city', '') or '')
    phone = str(settings.get('service.phone', '') or '')
    head = ' · '.join(x for x in (name, city, phone) if x)
    return '%s\n%s' % (head, t('mail.footer_auto', lang))


def _block_html(b):
    kind = b['kind']
    if kind == 'text':
        return ('<p style="margin:0 0 16px 0; font-size:15px; line-height:23px; color:%s;">%s</p>'
                % (C_SOFT, esc(b['text'])))
    if kind == 'note':
        return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" '
                'style="margin:4px 0 16px 0;"><tr><td style="padding:13px 15px; background-color:%s; '
                'border-left:3px solid %s; border-radius:0 10px 10px 0; font-size:13px; '
                'line-height:20px; color:%s;">%s</td></tr></table>'
                % (C_CARD_2, C_ACCENT, C_MUTED, esc(b['text'])))
    if kind == 'rows':
        out = ['<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
               'style="margin:2px 0 16px 0;">']
        last = len(b['rows']) - 1
        for i, (label, value) in enumerate(b['rows']):
            border = '' if i == last else 'border-bottom:1px solid %s;' % C_LINE_SOFT
            out.append(
                '<tr><td width="42%%" valign="top" style="padding:10px 10px 10px 0; %s font-size:13px; '
                'line-height:19px; color:%s;">%s</td>'
                '<td align="right" valign="top" style="padding:10px 0; %s font-size:14px; '
                'line-height:19px; font-weight:600; color:%s;">%s</td></tr>'
                % (border, C_MUTED, esc(label), border, C_TEXT, esc(value)))
        out.append('</table>')
        return ''.join(out)
    if kind == 'lines':
        out = ['<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
               'style="margin:2px 0 14px 0;">']
        for it in b['items']:
            sub = ('<br /><span style="font-size:12px; color:%s;">%s</span>' % (C_MUTED_2, esc(it['sub']))
                   if it.get('sub') else '')
            out.append(
                '<tr><td valign="top" style="padding:9px 10px 9px 0; border-bottom:1px solid %s; '
                'font-size:14px; line-height:20px; color:%s;">%s%s</td>'
                '<td align="right" valign="top" style="padding:9px 0; border-bottom:1px solid %s; '
                'font-size:14px; line-height:20px; white-space:nowrap; color:%s;">%s</td></tr>'
                % (C_LINE_SOFT, C_SOFT, esc(it['title']), sub, C_LINE_SOFT, C_TEXT, esc(it['sum'])))
        out.append('</table>')
        return ''.join(out)
    if kind == 'total':
        hint = ('<div style="margin-top:6px; font-size:12px; line-height:18px; color:%s;">%s</div>'
                % (C_MUTED_2, esc(b['hint'])) if b.get('hint') else '')
        return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" '
                'style="margin:6px 0 18px 0; background-color:%s; border-radius:14px;">'
                '<tr><td style="padding:16px 18px 17px 18px;">'
                '<div style="font-size:12px; line-height:16px; letter-spacing:.4px; color:%s; '
                'text-transform:uppercase;">%s</div>'
                '<div class="big" style="margin-top:5px; font-size:28px; line-height:34px; '
                'font-weight:700; color:%s;">%s</div>%s</td></tr></table>'
                % (C_CARD_2, C_MUTED, esc(b['label']), C_ACCENT, esc(b['value']), hint))
    if kind == 'button':
        return ('<table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" '
                'align="center" style="margin:8px auto 18px auto;"><tr>'
                '<td align="center" bgcolor="%s" style="border-radius:14px;">'
                '<a href="%s" style="display:inline-block; padding:14px 32px; font-family:%s; '
                'font-size:15px; line-height:20px; font-weight:700; color:%s; text-decoration:none; '
                'border-radius:14px;">%s</a></td></tr></table>'
                % (C_ACCENT, esc(b['url'], quote=True), FONT, C_INK, esc(b['label'])))
    return ''


def _html(doc, lang):
    body = ['<h1 class="h1" style="margin:0 0 12px 0; font-size:25px; line-height:31px; '
            'font-weight:700; color:%s;">%s</h1>' % (C_TEXT, esc(doc['title']))]
    if doc.get('lead'):
        body.append('<p style="margin:0 0 20px 0; font-size:15px; line-height:23px; color:%s;">%s</p>'
                    % (C_MUTED, esc(doc['lead'])))
    for b in doc['blocks']:
        body.append(_block_html(b))
    out = SHELL
    for token, value in (
        ('{{LANG}}', lang), ('{{TITLE}}', esc(doc['title'])), ('{{PRE}}', esc(doc.get('pre', ''))),
        ('{{BODY}}', '\n'.join(x for x in body if x)), ('{{FOOTER}}', _footer_html(lang)),
        ('{{FONT}}', FONT), ('{{BG}}', C_BG), ('{{CARD}}', C_CARD), ('{{LINE}}', C_LINE),
        ('{{TEXT}}', C_TEXT), ('{{ACCENT}}', C_ACCENT), ('{{MUTED2}}', C_MUTED_2),
    ):
        out = out.replace(token, value)
    return out


def _plain(doc, lang):
    out = ['SPRINTER GO', '', doc['title']]
    if doc.get('lead'):
        out += ['', doc['lead']]
    for b in doc['blocks']:
        kind = b['kind']
        if kind in ('text', 'note'):
            out += ['', b['text']]
        elif kind == 'rows':
            out.append('')
            out += ['%s: %s' % (label, value) for label, value in b['rows']]
        elif kind == 'lines':
            out.append('')
            for it in b['items']:
                title = it['title'] + (' (%s)' % it['sub'] if it.get('sub') else '')
                out.append('%s — %s' % (title, it['sum']))
        elif kind == 'total':
            out += ['', '%s: %s' % (b['label'], b['value'])]
            if b.get('hint'):
                out.append(b['hint'])
        elif kind == 'button':
            out += ['', '%s: %s' % (b['label'], b['url'])]
    out += ['', '—', _footer_text(lang)]
    return '\n'.join(out).strip() + '\n'


# ─────────────────────────────────────────────────────────────── данные шаблонов

def _s(v, *keys):
    for k in keys:
        val = v.get(k)
        if val not in (None, ''):
            return str(val).strip()
    return ''


def _i(v, *keys, **kw):
    for k in keys:
        val = v.get(k)
        if val not in (None, ''):
            try:
                return int(val)
            except (TypeError, ValueError):
                continue
    return kw.get('default', 0)


def _name_or(v, lang):
    """Имя или нейтральное обращение: письмо без имени всё равно должно звучать
    как письмо человеку, а не как «Здравствуйте, .»"""
    return _s(v, 'name', 'courier_name') or t('mail.colleague', lang)


def _pairs(items):
    """Пары «подпись — значение» без пустых: пустая строка в письме выглядит
    как недоработка, а не как отсутствие данных."""
    return [(label, value) for label, value in items if value not in (None, '')]


def _tariff_name(src, lang):
    if isinstance(src, dict):
        return str(src.get('name_ky' if lang == 'ky' else 'name_ru') or src.get('name_ru') or '')
    return str(src or '')


def _points(v):
    pts = v.get('points')
    if isinstance(pts, str):
        pts = db.jload(pts, [])
    if not isinstance(pts, list):
        return []
    return [p for p in pts if isinstance(p, dict)]


def _with_order(v):
    """Шаблоны принимают и плоские переменные, и целиком заказ: строка из базы
    или карточка из dispatch.order_card(). Роутеру так меньше работы."""
    o = v.get('order')
    if not isinstance(o, dict):
        return v
    out = dict(o)
    out.update({k: val for k, val in v.items() if k != 'order'})
    return out


def _addr_vars(v):
    """Откуда, куда и сколько точек по дороге."""
    pts = _points(v)
    from_addr = _s(v, 'from_addr') or (str(pts[0].get('addr') or '') if pts else '')
    to_addr = _s(v, 'to_addr') or (str(pts[-1].get('addr') or '') if len(pts) > 1 else '')
    stops = max(0, len(pts) - 2)
    return from_addr, to_addr, stops


def _payment_text(v, lang):
    method = _s(v, 'payment_method') or 'cash'
    status = _s(v, 'payment_status') or 'none'
    if method == 'cash' or status == 'none':
        return t('pay.cash', lang)
    return '%s, %s' % (t('pay.online', lang), payment_name(status, lang).lower())


# ─────────────────────────────────────────────────────────────── шаблоны

def _doc_courier_welcome(v, lang):
    name = _name_or(v, lang)
    rows = _pairs([
        (t('mail.car', lang), _s(v, 'car', 'car_model')),
        (t('mail.plate', lang), _s(v, 'plate', 'car_plate').upper()),
        (t('mail.phone', lang), _s(v, 'phone')),
    ])
    blocks = [_text_block(t('mail.courier_welcome.p1', lang))]
    if rows:
        blocks.append(_rows_block(rows))
    blocks.append(_text_block(t('mail.courier_welcome.p2', lang)))
    blocks.append(_note_block(t('mail.courier_welcome.note', lang)))
    return {
        'subject': t('mail.courier_welcome.subject', lang),
        'pre': t('mail.courier_welcome.pre', lang),
        'title': t('mail.courier_welcome.title', lang),
        'lead': t('mail.courier_welcome.lead', lang, name=name),
        'blocks': blocks,
    }


def _doc_courier_approved(v, lang):
    name = _name_or(v, lang)
    url = _safe_url(_s(v, 'url', 'login_url'))
    blocks = [_text_block(t('mail.courier_approved.p1', lang))]
    if url:
        blocks.append(_button_block(t('mail.courier_approved.button', lang), url))
        blocks.append(_text_block(t('mail.link_fallback', lang, url=url)))
    blocks.append(_note_block(t('mail.courier_approved.note', lang)))
    return {
        'subject': t('mail.courier_approved.subject', lang),
        'pre': t('mail.courier_approved.pre', lang),
        'title': t('mail.courier_approved.title', lang),
        'lead': t('mail.courier_approved.lead', lang, name=name),
        'blocks': blocks,
    }


def _doc_courier_rejected(v, lang):
    name = _name_or(v, lang)
    reason = _s(v, 'reason', 'note')
    blocks = []
    if reason:
        blocks.append(_rows_block([(t('mail.courier_rejected.reason', lang), reason)]))
    blocks.append(_text_block(t('mail.courier_rejected.p1', lang)))
    blocks.append(_note_block(t('mail.courier_rejected.note', lang)))
    return {
        'subject': t('mail.courier_rejected.subject', lang),
        'pre': t('mail.courier_rejected.pre', lang),
        'title': t('mail.courier_rejected.title', lang),
        'lead': t('mail.courier_rejected.lead', lang, name=name),
        'blocks': blocks,
    }


def _doc_courier_new_order(v, lang):
    v = _with_order(v)
    from_addr, to_addr, stops = _addr_vars(v)
    price = _i(v, 'price_total', 'price')
    payout = _i(v, 'courier_payout', 'payout')
    near = _i(v, 'near_m', 'pickup_distance_m', default=-1)
    url = _safe_url(_s(v, 'url'))

    rows = _pairs([
        (t('mail.from', lang), from_addr),
        (t('mail.to', lang), to_addr),
        (t('mail.stops', lang), str(stops) if stops else ''),
        (t('mail.distance', lang), fmt_distance(v.get('distance_m'), lang) if v.get('distance_m') else ''),
        (t('mail.duration', lang), fmt_duration(v.get('duration_s'), lang) if v.get('duration_s') else ''),
        (t('mail.tariff', lang), _tariff_name(v.get('tariff') or v.get('tariff_name'), lang)),
        (t('mail.loaders', lang), str(_i(v, 'loaders')) if _i(v, 'loaders') else ''),
        (t('mail.payment', lang), _payment_text(v, lang)),
    ])
    blocks = [_rows_block(rows)] if rows else []
    if payout > 0:
        blocks.append(_total_block(t('mail.payout', lang), fmt_money(payout, lang),
                                   '%s: %s' % (t('mail.price', lang), fmt_money(price, lang))
                                   if price > 0 else None))
    elif price > 0:
        blocks.append(_total_block(t('mail.price', lang), fmt_money(price, lang)))
    if url:
        blocks.append(_button_block(t('mail.courier_new_order.button', lang), url))
    blocks.append(_note_block(t('mail.courier_new_order.note', lang)))

    lead = (t('mail.courier_new_order.lead', lang, near=fmt_distance(near, lang)) if near >= 0
            else t('mail.courier_new_order.lead_plain', lang))
    return {
        'subject': t('mail.courier_new_order.subject', lang,
                     price=fmt_money(payout or price, lang)),
        'pre': t('mail.courier_new_order.pre', lang,
                 from_addr=from_addr or '—', to_addr=to_addr or '—'),
        'title': t('mail.courier_new_order.title', lang),
        'lead': lead,
        'blocks': blocks,
    }


def _doc_password_reset(v, lang):
    url = _safe_url(_s(v, 'url', 'link'))
    email = _s(v, 'email', 'to')
    blocks = []
    if url:
        blocks.append(_button_block(t('mail.password_reset.button', lang), url))
        blocks.append(_text_block(t('mail.link_fallback', lang, url=url)))
    blocks.append(_note_block(t('mail.password_reset.note', lang)))
    return {
        'subject': t('mail.password_reset.subject', lang),
        'pre': t('mail.password_reset.pre', lang),
        'title': t('mail.password_reset.title', lang),
        'lead': t('mail.password_reset.lead', lang, email=email or _s(v, 'name')),
        'blocks': blocks,
    }


def _doc_admin_daily(v, lang):
    day = v.get('date')
    date_text = day if isinstance(day, str) and day else fmt_date(
        _i(v, 'day_at', 'at', default=db.now()), lang, year=True)
    orders = _i(v, 'orders', 'orders_total')
    money_rows = _pairs([
        (t('mail.admin_daily.orders', lang), str(orders) if 'orders' in v or 'orders_total' in v else ''),
        (t('mail.admin_daily.done', lang), str(_i(v, 'done', 'orders_done')) if ('done' in v or 'orders_done' in v) else ''),
        (t('mail.admin_daily.cancelled', lang), str(_i(v, 'cancelled', 'orders_cancelled')) if ('cancelled' in v or 'orders_cancelled' in v) else ''),
        (t('mail.admin_daily.expired', lang), str(_i(v, 'expired')) if 'expired' in v else ''),
        (t('mail.admin_daily.commission', lang), fmt_money(_i(v, 'commission'), lang) if 'commission' in v else ''),
        (t('mail.admin_daily.avg', lang), fmt_money(_i(v, 'avg_check', 'avg'), lang) if ('avg_check' in v or 'avg' in v) else ''),
        (t('mail.admin_daily.couriers_new', lang), str(_i(v, 'couriers_new')) if 'couriers_new' in v else ''),
        (t('mail.admin_daily.couriers_online', lang), str(_i(v, 'couriers_online')) if 'couriers_online' in v else ''),
        (t('mail.admin_daily.clients_new', lang), str(_i(v, 'clients_new')) if 'clients_new' in v else ''),
    ])
    blocks = []
    if 'revenue' in v:
        blocks.append(_total_block(t('mail.admin_daily.revenue', lang),
                                   fmt_money(_i(v, 'revenue'), lang)))
    if money_rows:
        blocks.append(_rows_block(money_rows))
    if not money_rows and not orders:
        blocks.append(_text_block(t('mail.admin_daily.empty', lang)))
    top_name = _s(v, 'top_courier', 'top_name')
    if top_name:
        blocks.append(_note_block(t('mail.admin_daily.top', lang, name=top_name,
                                    count=_s(v, 'top_count') or '—')))
    url = _safe_url(_s(v, 'url', 'admin_url'))
    if url:
        blocks.append(_button_block(t('mail.admin_daily.button', lang), url))
    return {
        'subject': t('mail.admin_daily.subject', lang, date=date_text),
        'pre': t('mail.admin_daily.pre', lang),
        'title': t('mail.admin_daily.title', lang),
        'lead': t('mail.admin_daily.lead', lang, date=date_text),
        'blocks': blocks,
    }


def _doc_order_receipt(v, lang):
    v = _with_order(v)
    from_addr, to_addr, stops = _addr_vars(v)
    public_id = _s(v, 'public_id', 'id')
    total = _i(v, 'price_total', 'total')
    done_at = _i(v, 'done_at', 'created_at', default=0)
    courier = v.get('courier') if isinstance(v.get('courier'), dict) else {}
    car = courier.get('car') if isinstance(courier.get('car'), dict) else {}

    rows = _pairs([
        (t('mail.date', lang), fmt_dt(done_at, lang) if done_at else ''),
        (t('mail.from', lang), from_addr),
        (t('mail.to', lang), to_addr),
        (t('mail.stops', lang), str(stops) if stops else ''),
        (t('mail.distance', lang), fmt_distance(v.get('distance_m'), lang) if v.get('distance_m') else ''),
        (t('mail.duration', lang), fmt_duration(v.get('duration_s'), lang) if v.get('duration_s') else ''),
        (t('mail.tariff', lang), _tariff_name(v.get('tariff') or v.get('tariff_name'), lang)),
        (t('mail.courier', lang), str(courier.get('name') or _s(v, 'courier_name'))),
        (t('mail.car', lang), ', '.join(x for x in (str(car.get('model') or ''),
                                                    str(car.get('plate') or '').upper()) if x)),
        (t('mail.payment', lang), _payment_text(v, lang)),
    ])
    blocks = [_rows_block(rows)] if rows else []

    lines = v.get('lines') if isinstance(v.get('lines'), list) else []
    items = []
    for ln in lines:
        if not isinstance(ln, dict):
            continue
        title = str(ln.get('title_ky' if lang == 'ky' else 'title_ru') or ln.get('title_ru') or '')
        if not title:
            continue
        qty = ln.get('qty')
        unit = str(ln.get('unit_ky' if lang == 'ky' else 'unit_ru') or '')
        sub = ''
        if qty not in (None, '', 1) and ln.get('unit_price'):
            sub = '%s %s × %s' % (str(qty).replace('.', ','), unit,
                                  fmt_money(ln.get('unit_price'), lang))
        items.append({'title': title, 'sub': sub.strip(),
                      'sum': fmt_money(ln.get('sum'), lang)})
    if items:
        blocks.append(_lines_block(items))
    blocks.append(_total_block(t('mail.total', lang), fmt_money(total, lang)))

    url = _safe_url(_s(v, 'url', 'track_url'))
    if url and _s(v, 'status', 'order_status') != 'cancelled':
        blocks.append(_button_block(t('mail.order_receipt.button', lang), url))
    blocks.append(_note_block(t('mail.order_receipt.note', lang)))
    return {
        'subject': t('mail.order_receipt.subject', lang, public_id=public_id),
        'pre': t('mail.order_receipt.pre', lang, total=fmt_money(total, lang)),
        'title': t('mail.order_receipt.title', lang),
        'lead': t('mail.order_receipt.lead', lang, public_id=public_id),
        'blocks': blocks,
    }


def _doc_test(v, lang):
    secure = {'ssl': 'SSL', 'tls': 'STARTTLS', 'none': 'без шифрования'}.get(
        _s(v, 'secure'), _s(v, 'secure'))
    rows = _pairs([
        (t('mail.test.host', lang), '%s:%s' % (_s(v, 'host'), _s(v, 'port'))),
        (t('mail.test.secure', lang), secure),
        (t('mail.test.sender', lang), _s(v, 'sender')),
        ('SMTP-логин', _s(v, 'user')),
    ])
    blocks = [_rows_block(rows)] if rows else []
    blocks.append(_note_block(t('mail.test.note', lang)))
    return {
        'subject': t('mail.test.subject', lang),
        'pre': t('mail.test.pre', lang),
        'title': t('mail.test.title', lang),
        'lead': t('mail.test.lead', lang),
        'blocks': blocks,
    }


TEMPLATES = {
    'courier_welcome': _doc_courier_welcome,
    'courier_approved': _doc_courier_approved,
    'courier_rejected': _doc_courier_rejected,
    'courier_new_order': _doc_courier_new_order,
    'password_reset': _doc_password_reset,
    'admin_daily': _doc_admin_daily,
    'order_receipt': _doc_order_receipt,
    'test': _doc_test,
}


def render(template, vars=None, lang='ru'):
    """Шаблон → (тема, HTML, текст). Отдельно от отправки: так письмо можно
    показать в админке до того, как оно уйдёт людям."""
    build = TEMPLATES.get(str(template or ''))
    if build is None:
        raise ApiError('bad_template', 'Нет шаблона письма «%s»' % template, 500)
    lang = norm_lang(lang)
    doc = build(dict(vars or {}), lang)
    subject = str(doc['subject']).replace('\n', ' ').replace('\r', ' ').strip()[:300]
    return subject, _html(doc, lang), _plain(doc, lang)


def templates():
    """Список шаблонов для админки."""
    return sorted(TEMPLATES)
