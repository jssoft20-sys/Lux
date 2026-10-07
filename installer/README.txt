PayGo 1.13.9.77 — ставится поверх 1.13.9.40 … 1.13.9.76

  bash /home/PayGo-1.13.9.77-Update/install.sh --check   только проверка
  bash /home/PayGo-1.13.9.77-Update/install.sh           установка (сама откатится при ошибке)

Откат: bash /home/PayGo-backup-before-1.13.9.77-<время>/rollback.sh
База данных не меняется.

Если админка не открывается из-за VPN, а VPN выключен (или нужен доступ с конкретного адреса):
  cd /home/PayGo && sudo -u paygo env PYTHONPATH=backend venv/bin/python -m paygo.cli vpn-block off
  включить обратно:        ... -m paygo.cli vpn-block on
  разрешить один адрес:    ... -m paygo.cli vpn-block --allow 1.2.3.4

Мгновенные уведомления Optima (по умолчанию включены; опрос истории работает всегда):
  cd /home/PayGo && sudo -u paygo env PYTHONPATH=backend venv/bin/python -m paygo.cli optima-push off && systemctl restart paygo-optima-live
  включить обратно:  ... -m paygo.cli optima-push on && systemctl restart paygo-optima-live
