# PayGo — Android-приложение

Обёртка (WebView) над мобильной админ-панелью PayGo. Приложение открывает
веб-версию 1:1: чат, загрузка файлов, съёмка фото с камеры, внешние ссылки
(`tel:`, Telegram) открываются в системных приложениях, кнопка «Назад» ходит по
истории, при обрыве связи показывается экран «Нет соединения» с кнопкой
«Повторить».

* Пакет: `kg.paygo.admin`, версия `1.0.0`, Android 7.0+ (minSdk 24, targetSdk 34).
* User-Agent WebView дополняется суффиксом ` PayGoApp/1.0` (константа
  `USER_AGENT_SUFFIX` в `AppConfig.java`) — по нему сервер может отличить
  приложение от браузера.
* **Адрес панели** задан в одном месте:
  `app/src/main/java/kg/paygo/admin/AppConfig.java` → `START_URL`
  (сейчас `https://wwweeewww.fit/paygo/`). Все ссылки на этот хост открываются
  внутри приложения, остальные — во внешнем браузере/приложении.

## Сборка

Нужны JDK 17+ и Android SDK (`platforms;android-34`, `build-tools;34.0.0`).
Путь к SDK — через переменную `ANDROID_HOME` или файл `local.properties`
(`sdk.dir=/путь/к/android-sdk`, файл не коммитится).

```bash
cd android
# Gradle 8.9+ (wrapper скачает нужную версию сам):
./gradlew assembleDebug            # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease          # app/build/outputs/apk/release/app-release.apk
```

Вместо `./gradlew` можно использовать системный `gradle` (8.9 и новее).

### Подпись release-сборки

Ключ и пароли **не хранятся в репозитории**. Укажите их одним из способов:

1. Файл `android/keystore.properties` (уже в `.gitignore`):

   ```properties
   storeFile=/абсолютный/путь/paygo-release.jks
   storePassword=...
   keyAlias=paygo
   keyPassword=...
   ```

2. Или переменные окружения `PAYGO_KEYSTORE_FILE`, `PAYGO_KEYSTORE_PASSWORD`,
   `PAYGO_KEY_ALIAS`, `PAYGO_KEY_PASSWORD`.

Без них release-APK собирается неподписанным (его нельзя установить).
Создать новый ключ:

```bash
keytool -genkeypair -keystore paygo-release.jks -storetype PKCS12 -alias paygo \
  -keyalg RSA -keysize 2048 -validity 10000
```

Обновления приложения должны быть подписаны тем же ключом — берегите `.jks`
и пароли.

## Установка APK на Android

1. Скопируйте `PayGo.apk` на телефон (Telegram, почта, USB) и откройте файл.
2. Если Android спросит — разрешите установку из неизвестных источников:
   **Настройки → Безопасность (или Приложения) → Установка неизвестных
   приложений** → выберите приложение, из которого открываете APK (например,
   «Файлы» или Telegram) → **Разрешить**.
3. Нажмите «Установить». При первом фото с камеры приложение попросит доступ к
   камере.

`PayGo-debug.apk` — запасная отладочная сборка, подписана другим ключом:
перед установкой одной сборки поверх другой удалите предыдущую.
