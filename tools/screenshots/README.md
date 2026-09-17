# Скриншоты через Playwright

Прогоняют реальные пользовательские сценарии (регистрация → KYC → сделка → оплата → отпуск) и админку, снимая экраны.

```bash
# API (dev: OTP_DEV_ECHO=true), mobile preview на :5173, admin preview на :5174 должны быть запущены
npm i -g playwright && npx playwright install chromium
node tools/screenshots/mobile.mjs     # → docs/screenshots/mobile
node tools/screenshots/admin.mjs      # → docs/screenshots/admin (сбрасывает 2FA суперадмина не нужно: скрипт проходит enrolment)
```
