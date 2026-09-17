#!/usr/bin/env bash
systemctl stop somex 2>/dev/null || pkill -f "node dist/main.js" || true
echo "Somex остановлен"
