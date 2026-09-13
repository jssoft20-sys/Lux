#!/usr/bin/env bash
# Sprinter Go — обновить конфиг nginx из архива, сохранив выпущенный certbot-ом SSL-блок.
# Запуск: sudo bash /home/gotaxi/deploy/update-nginx.sh sprintergo.kg
set -euo pipefail
DOMAIN="${1:-sprintergo.kg}"
SITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$SITE_DIR/deploy/nginx.conf"
if [[ -d /etc/nginx/sites-available ]]; then DST="/etc/nginx/sites-available/$DOMAIN.conf"; else DST="/etc/nginx/conf.d/$DOMAIN.conf"; fi
[[ $EUID -ne 0 ]] && { echo "Запустите с sudo"; exit 1; }
cp "$DST" "$DST.bak.$(date +%s)" 2>/dev/null || true

# Берём из текущего конфига строки, добавленные certbot (ssl_certificate, include options-ssl, dhparam)
CERT="$(grep -E 'ssl_certificate(_key)? ' "$DST" 2>/dev/null | head -2 || true)"
OPTS="$(grep -E 'options-ssl-nginx|ssl-dhparams' "$DST" 2>/dev/null | sort -u || true)"

sed -e "s#sprintergo\.kg#$DOMAIN#g" -e "s#root /home/gotaxi;#root $SITE_DIR;#" "$SRC" > "$DST.new"
if [[ -n "$CERT" ]]; then
  # Основной server-блок: 80 → 443 ssl http2 + сертификаты; плюс отдельный редирект с 80
  python3 - "$DST.new" "$DOMAIN" "$CERT" "$OPTS" <<'PY'
import sys,re
path,domain,cert,opts=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
s=open(path,encoding='utf-8').read()
main=re.search(r'server \{\n    listen 80;\n    listen \[::\]:80;\n    server_name '+re.escape(domain)+r';\n',s)
assert main, 'main server block not found'
ssl_block='server {\n    listen 443 ssl http2;\n    listen [::]:443 ssl http2;\n    server_name '+domain+';\n'+''.join('    '+l.strip()+'\n' for l in cert.splitlines())+''.join('    '+l.strip()+'\n' for l in opts.splitlines())
s=s[:main.start()]+ssl_block+s[main.end():]
# www → https без www: переписываем блок www на редирект по 80 и 443
s=s.replace('server {\n    listen 80;\n    listen [::]:80;\n    server_name www.'+domain+';\n    return 301 https://'+domain+'$request_uri;\n}',
 'server {\n    listen 80;\n    listen [::]:80;\n    server_name '+domain+' www.'+domain+';\n    return 301 https://'+domain+'$request_uri;\n}\nserver {\n    listen 443 ssl http2;\n    listen [::]:443 ssl http2;\n    server_name www.'+domain+';\n'+''.join('    '+l.strip()+'\n' for l in cert.splitlines())+''.join('    '+l.strip()+'\n' for l in opts.splitlines())+'    return 301 https://'+domain+'$request_uri;\n}')
open(path,'w',encoding='utf-8').write(s)
PY
fi
mv "$DST.new" "$DST"
nginx -t && systemctl reload nginx && echo "✔ nginx обновлён: https://$DOMAIN (HTTP/2, security-заголовки, кэш)" || { echo "✖ Ошибка в конфиге, откатываю"; cp "$(ls -t "$DST".bak.* | head -1)" "$DST"; nginx -t; exit 1; }
