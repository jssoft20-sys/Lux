#!/usr/bin/env bash
# Sprinter Go — привязка домена к сайту одной командой (nginx + HTTPS через Let's Encrypt).
# Запуск: sudo bash /home/gotaxi/deploy/setup-domain.sh sprintergo.kg admin@sprintergo.kg
#   $1 — домен (без www), $2 — email для уведомлений Let's Encrypt (необязательно)
set -euo pipefail

DOMAIN="${1:-sprintergo.kg}"
EMAIL="${2:-}"
SITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"          # /home/gotaxi
CONF_SRC="$SITE_DIR/deploy/nginx.conf"

if [[ $EUID -ne 0 ]]; then echo "Запустите с sudo: sudo bash $0 $DOMAIN"; exit 1; fi

echo "▶ 1/6 Устанавливаю nginx и certbot"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx curl >/dev/null
  WEB_USER="www-data"
  SITES_AVAILABLE="/etc/nginx/sites-available"; SITES_ENABLED="/etc/nginx/sites-enabled"
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q epel-release || true
  dnf install -y -q nginx certbot python3-certbot-nginx curl
  WEB_USER="nginx"
  SITES_AVAILABLE="/etc/nginx/conf.d"; SITES_ENABLED=""
else
  echo "Неизвестный дистрибутив: установите nginx и certbot вручную"; exit 1
fi

echo "▶ 2/6 Права на файлы сайта"
chmod 755 /home "$SITE_DIR"
chown -R "$WEB_USER":"$WEB_USER" "$SITE_DIR"
chmod +x "$SITE_DIR"/*.sh 2>/dev/null || true

echo "▶ 3/6 Конфиг nginx для $DOMAIN"
mkdir -p "$SITES_AVAILABLE"
CONF_DST="$SITES_AVAILABLE/$DOMAIN.conf"
sed -e "s#sprintergo\.kg#$DOMAIN#g" -e "s#root /home/gotaxi;#root $SITE_DIR;#" "$CONF_SRC" > "$CONF_DST"
if [[ -n "$SITES_ENABLED" ]]; then
  ln -sf "$CONF_DST" "$SITES_ENABLED/$DOMAIN.conf"
  rm -f "$SITES_ENABLED/default"
fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "▶ 4/6 Файрвол: открываю 80 и 443"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then firewall-cmd --permanent --add-service=http >/dev/null; firewall-cmd --permanent --add-service=https >/dev/null; firewall-cmd --reload >/dev/null; fi

echo "▶ 5/6 Проверяю, что DNS домена указывает на этот сервер"
MY_IP="$(curl -s --max-time 5 https://api.ipify.org || curl -s --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | head -n1 || true)"
echo "   IP сервера: ${MY_IP:-?}   A-запись $DOMAIN: ${DNS_IP:-не найдена}"
if [[ -z "$DNS_IP" || ( -n "$MY_IP" && "$DNS_IP" != "$MY_IP" ) ]]; then
  echo "   ⚠ DNS ещё не указывает на сервер (обновление занимает от 5 минут до нескольких часов)."
  echo "   Сайт уже открывается по http://$DOMAIN после обновления DNS. Для HTTPS повторите позже:"
  echo "     sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
  exit 0
fi

echo "▶ 6/6 Выпускаю HTTPS-сертификат Let's Encrypt"
EMAIL_ARGS=(--register-unsafely-without-email)
[[ -n "$EMAIL" ]] && EMAIL_ARGS=(-m "$EMAIL")
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --redirect --agree-tos --non-interactive "${EMAIL_ARGS[@]}"; then
  systemctl reload nginx
  echo ""
  echo "✔ Готово: https://$DOMAIN  (www → без www, http → https, автопродление сертификата включено)"
else
  echo ""
  echo "⚠ Сертификат для www.$DOMAIN не выпустился (обычно нет A-записи для www). Пробую только $DOMAIN…"
  certbot --nginx -d "$DOMAIN" --redirect --agree-tos --non-interactive "${EMAIL_ARGS[@]}" && systemctl reload nginx \
    && echo "✔ Готово: https://$DOMAIN (добавьте A-запись www и повторите команду certbot для www)"
fi
echo "   Проверка: curl -I https://$DOMAIN/"
echo "   Python-сервер на 7022 больше не нужен: $SITE_DIR/stop.sh"
