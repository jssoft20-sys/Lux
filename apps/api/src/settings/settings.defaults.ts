/**
 * Runtime settings editable from the admin panel. Values in the DB override the environment.
 * `secret: true` => stored encrypted and masked in API responses.
 */
export interface SettingDef {
  key: string;
  group: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'text';
  secret?: boolean;
  options?: string[];
  envKey?: string;
  default: string;
}

export const SETTING_DEFS: SettingDef[] = [
  // general
  { key: 'app.name', group: 'general', label: 'Название платформы', type: 'string', default: 'Somex' },
  { key: 'app.maintenance', group: 'general', label: 'Режим обслуживания', description: 'Пользователи видят заглушку, админка работает', type: 'boolean', default: 'false' },
  { key: 'app.support_whatsapp', group: 'general', label: 'WhatsApp поддержки', type: 'string', default: '+996555000000' },
  { key: 'app.registration_enabled', group: 'general', label: 'Регистрация новых пользователей', type: 'boolean', default: 'true' },
  { key: 'app.reference_rate_source', group: 'general', label: 'Источник курса USDT/KGS', type: 'select', options: ['manual', 'binance_p2p_median'], default: 'manual' },

  // security
  { key: 'security.otp_ttl_sec', group: 'security', label: 'Срок жизни OTP (сек)', type: 'number', default: '300' },
  { key: 'security.otp_resend_sec', group: 'security', label: 'Пауза перед повторной отправкой OTP (сек)', type: 'number', default: '60' },
  { key: 'security.otp_max_per_hour', group: 'security', label: 'Макс. OTP на номер в час', type: 'number', default: '5' },
  { key: 'security.otp_max_per_ip_hour', group: 'security', label: 'Макс. OTP с одного IP в час', type: 'number', default: '20' },
  { key: 'security.new_device_cooldown_hours', group: 'security', label: 'Ограничение чувствительных операций после нового устройства (часы)', description: 'В TEST_MODE по умолчанию 0 — включите, чтобы проверить сценарий', type: 'number', default: process.env.TEST_MODE === 'true' ? '0' : '24' },
  { key: 'security.release_requires_pin', group: 'security', label: 'Требовать PIN/биометрию при отпуске USDT', type: 'boolean', default: 'true' },
  { key: 'security.withdraw_requires_otp', group: 'security', label: 'Требовать OTP при выводе', type: 'boolean', default: 'true' },
  { key: 'security.admin_totp_required', group: 'security', label: 'Обязательный 2FA для админов', description: 'В TEST_MODE по умолчанию выключен', type: 'boolean', default: process.env.TEST_MODE === 'true' ? 'false' : 'true' },
  { key: 'security.admin_ip_allowlist', group: 'security', label: 'Глобальный IP allowlist админки (через запятую, пусто = все)', type: 'text', default: '' },
  { key: 'security.admin_session_minutes', group: 'security', label: 'Сессия админа (минуты)', type: 'number', default: '720' },
  { key: 'security.max_sessions_per_user', group: 'security', label: 'Макс. активных сессий на пользователя', type: 'number', default: '5' },

  // limits & fees
  { key: 'limits.verified_p2p_per_order', group: 'limits', label: 'Verified: макс. USDT в сделке', type: 'number', default: '2000' },
  { key: 'limits.verified_p2p_daily', group: 'limits', label: 'Verified: макс. USDT в день (P2P)', type: 'number', default: '5000' },
  { key: 'limits.verified_withdraw_daily', group: 'limits', label: 'Verified: макс. вывод USDT в день', type: 'number', default: '3000' },
  { key: 'limits.verified_withdraw_single', group: 'limits', label: 'Verified: макс. разовый вывод USDT', type: 'number', default: '2000' },
  { key: 'limits.advanced_p2p_per_order', group: 'limits', label: 'Advanced: макс. USDT в сделке', type: 'number', default: '20000' },
  { key: 'limits.advanced_p2p_daily', group: 'limits', label: 'Advanced: макс. USDT в день (P2P)', type: 'number', default: '50000' },
  { key: 'limits.advanced_withdraw_daily', group: 'limits', label: 'Advanced: макс. вывод USDT в день', type: 'number', default: '30000' },
  { key: 'limits.advanced_withdraw_single', group: 'limits', label: 'Advanced: макс. разовый вывод USDT', type: 'number', default: '15000' },
  { key: 'fees.p2p_taker_percent', group: 'limits', label: 'Комиссия P2P с тейкера (%)', type: 'number', default: '0' },
  { key: 'fees.p2p_maker_percent', group: 'limits', label: 'Комиссия P2P с мейкера (%)', type: 'number', default: '0.1' },
  { key: 'fees.withdrawal_usdt', group: 'limits', label: 'Комиссия за вывод (USDT)', type: 'number', envKey: 'WITHDRAWAL_FEE_USDT', default: '1' },
  { key: 'limits.withdrawal_min_usdt', group: 'limits', label: 'Мин. сумма вывода (USDT)', type: 'number', envKey: 'WITHDRAWAL_MIN_USDT', default: '10' },
  { key: 'limits.order_payment_window_min', group: 'limits', label: 'Окно оплаты сделки по умолчанию (мин)', type: 'number', default: '15' },
  { key: 'limits.order_min_fiat', group: 'limits', label: 'Мин. сумма сделки (KGS)', type: 'number', default: '500' },
  { key: 'limits.withdraw_new_address_delay_hours', group: 'limits', label: 'Задержка вывода на новый адрес (часы, 0 = нет)', type: 'number', default: '0' },
  { key: 'limits.withdraw_auto_approve_max_usdt', group: 'limits', label: 'Автоодобрение вывода до (USDT), выше — ручное', type: 'number', default: '500' },

  // risk
  { key: 'risk.review_threshold', group: 'risk', label: 'Порог REVIEW (score)', type: 'number', default: '40' },
  { key: 'risk.block_threshold', group: 'risk', label: 'Порог BLOCK (score)', type: 'number', default: '70' },
  { key: 'risk.large_order_usdt', group: 'risk', label: 'Крупная сделка (USDT) для правил', type: 'number', default: '1000' },
  { key: 'risk.large_withdraw_usdt', group: 'risk', label: 'Крупный вывод (USDT) для правил', type: 'number', default: '1000' },
  { key: 'risk.deposit_hold_on_medium', group: 'risk', label: 'Удерживать депозит при среднем AML-риске', type: 'boolean', default: 'true' },
  { key: 'risk.alert_email_on_block', group: 'risk', label: 'Email-алерт при BLOCK', type: 'boolean', default: 'true' },

  // whatsapp (wappi)
  { key: 'wappi.api_url', group: 'whatsapp', label: 'Wappi API URL', type: 'string', envKey: 'WAPPI_API_URL', default: 'https://wappi.pro' },
  { key: 'wappi.token', group: 'whatsapp', label: 'Wappi API Token', type: 'string', secret: true, envKey: 'WAPPI_TOKEN', default: '' },
  { key: 'wappi.profile_id', group: 'whatsapp', label: 'Wappi Profile ID', type: 'string', envKey: 'WAPPI_PROFILE_ID', default: '' },
  { key: 'wappi.otp_template', group: 'whatsapp', label: 'Шаблон OTP сообщения', description: '{code} и {ttl} подставляются автоматически', type: 'text', default: 'Somex: ваш код входа {code}. Действует {ttl} мин. Никому не сообщайте код — сотрудники Somex его не спрашивают.' },
  { key: 'wappi.notifications_enabled', group: 'whatsapp', label: 'Отправлять уведомления о сделках в WhatsApp', type: 'boolean', default: 'true' },

  // kyc (didit)
  { key: 'didit.api_url', group: 'kyc', label: 'Didit API URL', type: 'string', envKey: 'DIDIT_API_URL', default: 'https://verification.didit.me' },
  { key: 'didit.api_key', group: 'kyc', label: 'Didit API Key', type: 'string', secret: true, envKey: 'DIDIT_API_KEY', default: '' },
  { key: 'didit.workflow_id', group: 'kyc', label: 'Didit Workflow ID', type: 'string', envKey: 'DIDIT_WORKFLOW_ID', default: '' },
  { key: 'didit.webhook_secret', group: 'kyc', label: 'Didit Webhook Secret', type: 'string', secret: true, envKey: 'DIDIT_WEBHOOK_SECRET', default: '' },
  { key: 'kyc.manual_review_all', group: 'kyc', label: 'Ручная проверка всех KYC перед одобрением', type: 'boolean', default: 'false' },
  { key: 'kyc.allowed_countries', group: 'kyc', label: 'Разрешённые страны документов (ISO3, через запятую)', type: 'string', default: 'KGZ' },
  { key: 'kyc.min_age', group: 'kyc', label: 'Мин. возраст', type: 'number', default: '18' },

  // smtp
  { key: 'smtp.host', group: 'smtp', label: 'SMTP host', type: 'string', envKey: 'SMTP_HOST', default: '' },
  { key: 'smtp.port', group: 'smtp', label: 'SMTP port', type: 'number', envKey: 'SMTP_PORT', default: '587' },
  { key: 'smtp.secure', group: 'smtp', label: 'SMTP TLS (465)', type: 'boolean', envKey: 'SMTP_SECURE', default: 'false' },
  { key: 'smtp.user', group: 'smtp', label: 'SMTP user', type: 'string', envKey: 'SMTP_USER', default: '' },
  { key: 'smtp.pass', group: 'smtp', label: 'SMTP password', type: 'string', secret: true, envKey: 'SMTP_PASS', default: '' },
  { key: 'smtp.from', group: 'smtp', label: 'От кого', type: 'string', envKey: 'SMTP_FROM', default: 'Somex <no-reply@somex.kg>' },
  { key: 'smtp.alert_emails', group: 'smtp', label: 'Email для алертов (через запятую)', type: 'string', envKey: 'ALERT_EMAILS', default: '' },

  // blockchain
  { key: 'tron.network', group: 'blockchain', label: 'Сеть TRON', type: 'select', options: ['mainnet', 'nile'], envKey: 'TRON_NETWORK', default: 'mainnet' },
  { key: 'tron.api_url', group: 'blockchain', label: 'TronGrid API URL', type: 'string', envKey: 'TRONGRID_API_URL', default: 'https://api.trongrid.io' },
  { key: 'tron.api_key', group: 'blockchain', label: 'TronGrid API Key', type: 'string', secret: true, envKey: 'TRONGRID_API_KEY', default: '' },
  { key: 'tron.usdt_contract', group: 'blockchain', label: 'USDT TRC20 контракт', type: 'string', envKey: 'TRON_USDT_CONTRACT', default: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
  { key: 'tron.required_confirmations', group: 'blockchain', label: 'Подтверждений для зачисления', type: 'number', envKey: 'TRON_REQUIRED_CONFIRMATIONS', default: '19' },
  { key: 'tron.deposit_xpub', group: 'blockchain', label: 'Deposit xpub (BIP32)', type: 'string', secret: true, envKey: 'DEPOSIT_XPUB', default: '' },
  { key: 'tron.hot_wallet_private_key', group: 'blockchain', label: 'Hot wallet private key (hex)', type: 'string', secret: true, envKey: 'HOT_WALLET_PRIVATE_KEY', default: '' },
  { key: 'wallet.withdrawals_frozen', group: 'blockchain', label: 'ЭКСТРЕННАЯ ЗАМОРОЗКА всех выводов', type: 'boolean', default: 'false' },
  { key: 'wallet.deposits_paused', group: 'blockchain', label: 'Приостановить зачисление депозитов', type: 'boolean', default: 'false' },
  { key: 'wallet.screening_provider', group: 'blockchain', label: 'AML wallet screening', description: 'internal = чёрные списки + эвристики; external_http = внешний провайдер (Chainalysis/Elliptic/Didit AML) через адаптер', type: 'select', options: ['internal', 'external_http'], default: 'internal' },
  { key: 'wallet.screening_url', group: 'blockchain', label: 'URL внешнего screening-адаптера', description: 'POST {address, network} → {risk: LOW|MEDIUM|HIGH, details}', type: 'string', default: '' },
  { key: 'wallet.screening_api_key', group: 'blockchain', label: 'API key screening-адаптера', type: 'string', secret: true, default: '' },

  // files
  { key: 'files.max_upload_mb', group: 'files', label: 'Макс. размер файла (MB)', type: 'number', envKey: 'MAX_UPLOAD_MB', default: '10' },
  { key: 'clamav.host', group: 'files', label: 'ClamAV host', type: 'string', envKey: 'CLAMAV_HOST', default: 'localhost' },
  { key: 'clamav.port', group: 'files', label: 'ClamAV port', type: 'number', envKey: 'CLAMAV_PORT', default: '3310' },
  { key: 'clamav.fail_mode', group: 'files', label: 'Если антивирус недоступен', type: 'select', options: ['fail_open', 'fail_closed'], envKey: 'CLAMAV_FAIL_MODE', default: 'fail_open' },
];

export const SETTING_GROUPS: Record<string, { label: string; description: string }> = {
  general: { label: 'Общие', description: 'Название, обслуживание, регистрация' },
  security: { label: 'Безопасность', description: 'OTP, сессии, 2FA, ограничения' },
  limits: { label: 'Лимиты и комиссии', description: 'Лимиты по уровням KYC, комиссии' },
  risk: { label: 'Risk Engine', description: 'Пороги и поведение антифрода' },
  whatsapp: { label: 'WhatsApp (Wappi)', description: 'Отправка OTP и уведомлений' },
  kyc: { label: 'KYC (Didit)', description: 'Верификация личности' },
  smtp: { label: 'SMTP', description: 'Email для алертов и отчётов' },
  blockchain: { label: 'Блокчейн и кошельки', description: 'TRON, депозиты, hot wallet, заморозка' },
  files: { label: 'Файлы и антивирус', description: 'Загрузки и ClamAV' },
};
