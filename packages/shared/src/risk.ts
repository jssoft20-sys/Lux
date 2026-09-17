/** Risk rule codes evaluated by the Somex Risk Engine. Weights are editable in admin. */
export const RISK_RULES = [
  { code: 'NEW_ACCOUNT', name: 'Новый аккаунт (< 7 дней)', weight: 15 },
  { code: 'NEW_DEVICE', name: 'Новое / незнакомое устройство', weight: 20 },
  { code: 'DEVICE_CHANGED_RECENTLY', name: 'Смена устройства за последние 24ч', weight: 15 },
  { code: 'PHONE_CHANGED_RECENTLY', name: 'Смена телефона / безопасности за 48ч', weight: 25 },
  { code: 'IP_PROXY_VPN', name: 'VPN / Proxy / Tor', weight: 20 },
  { code: 'IP_FOREIGN', name: 'IP вне Кыргызстана', weight: 10 },
  { code: 'IP_SHARED_ACCOUNTS', name: 'IP используется несколькими аккаунтами', weight: 15 },
  { code: 'DEVICE_SHARED_ACCOUNTS', name: 'Устройство используется несколькими аккаунтами', weight: 30 },
  { code: 'VELOCITY_ORDERS', name: 'Слишком много сделок за час', weight: 15 },
  { code: 'VELOCITY_WITHDRAWALS', name: 'Слишком много выводов за сутки', weight: 15 },
  { code: 'AMOUNT_ANOMALY', name: 'Сумма аномально выше обычной', weight: 20 },
  { code: 'FIRST_DEPOSIT_LARGE_ORDER', name: 'Первый депозит + сразу крупная сделка', weight: 25 },
  { code: 'FAST_PASS_THROUGH', name: 'Депозит → вывод менее чем за 1 час', weight: 25 },
  { code: 'NEW_WITHDRAW_ADDRESS', name: 'Новый адрес вывода', weight: 15 },
  { code: 'BLACKLIST_MATCH', name: 'Совпадение с чёрным списком', weight: 100 },
  { code: 'LINKED_TO_BLACKLISTED', name: 'Связь с заблокированным аккаунтом', weight: 40 },
  { code: 'WALLET_SCREENING_HIGH', name: 'Высокий риск адреса (AML)', weight: 60 },
  { code: 'WALLET_SCREENING_MEDIUM', name: 'Средний риск адреса (AML)', weight: 25 },
  { code: 'KYC_NAME_MISMATCH', name: 'ФИО не совпадает с KYC', weight: 50 },
  { code: 'DISPUTE_RATE_HIGH', name: 'Высокая доля споров', weight: 20 },
  { code: 'COUNTERPARTY_HIGH_RISK', name: 'Контрагент с высоким риском', weight: 15 },
  { code: 'NO_KYC', name: 'KYC не пройден', weight: 100 },
  { code: 'SENSITIVE_OPS_COOLDOWN', name: 'Действует период ограничения после смены безопасности', weight: 100 },
] as const;

export type RiskRuleCode = (typeof RISK_RULES)[number]['code'];

export const RISK_THRESHOLDS = { review: 40, block: 70 } as const;
