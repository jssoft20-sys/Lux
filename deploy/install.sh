#!/usr/bin/env bash
# One-shot installer: run on the server as root from the folder where Helip.zip is located.
#   bash install.sh
set -euo pipefail
DIR=/home/Helip
PORT=${PORT:-7033}

if ! command -v node >/dev/null 2>&1; then
  echo ">> Node.js not found, installing Node 20 LTS..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs unzip
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs unzip
  else
    echo "Install Node.js >= 18 manually, then re-run." && exit 1
  fi
fi
echo ">> Node $(node --version)"

mkdir -p "$DIR"
if [ -f Helip.zip ]; then
  echo ">> Unpacking Helip.zip into $DIR"
  unzip -oq Helip.zip -d "$DIR"
fi
cd "$DIR"
mkdir -p data

echo ">> Installing systemd service"
cp deploy/helip.service /etc/systemd/system/helip.service
sed -i "s/^Environment=PORT=.*/Environment=PORT=$PORT/" /etc/systemd/system/helip.service
systemctl daemon-reload
systemctl enable helip >/dev/null
systemctl restart helip

if command -v ufw >/dev/null 2>&1; then ufw allow "$PORT"/tcp >/dev/null 2>&1 || true; fi
if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --permanent --add-port="$PORT"/tcp >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 || true; fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
sleep 1
systemctl --no-pager --lines=3 status helip || true
echo
echo "=================================================="
echo "  HeliHop is running:  http://${IP:-<server-ip>}:$PORT"
echo "  Logs:    journalctl -u helip -f"
echo "  Restart: systemctl restart helip"
echo "=================================================="
