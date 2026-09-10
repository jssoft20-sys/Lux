# AutoPP Android Studio source (reconstructed)

Это **восстановленный исходный проект**, созданный на базе поведения последней ветки AutoPP, а не оригинальный исходник, из которого когда-то был собран APK.

## Package
`kg.luxon.autopp`

## Что есть в проекте
- API-key activation через `http://45.10.41.115:8080/api/device/heartbeat`.
- Heartbeat/config polling и удалённая блокировка через `/api/device/config`.
- LuxOn/Bingo — независимые каналы отправки уведомлений.
- Выбор нескольких приложений.
- PIN `972936` перед просмотром/изменением endpoint-адресов.
- Runtime request точной геолокации; при согласии пользователя foreground location service отправляет координаты примерно раз в 5 секунд.
- Плавающая панель поверх других приложений (`OverlayService`): лого, Start/Pause, закрытие, drag + snap к краям, звук.
- Accessibility service для небольшого scroll-gesture; после пользовательской активности выдерживается пауза.
- Notification listener.
- Автозапуск управляющей службы после перезагрузки.
- Matrix/неоновый главный экран без внешних UI-библиотек.

## Сборка
Открыть папку в Android Studio Hedgehog/Koala/Ladybug или новее и выполнить **Build > Generate Signed Bundle / APK**.

Для обновления поверх уже установленного APK необходимо подписать новый APK **тем же keystore**, которым подписана установленная версия. В этот ZIP приватный signing key намеренно не включён.

## Важное про геолокацию
Непрерывная геолокация запускается только после системного разрешения Android и работает через видимую foreground-службу. Это сделано намеренно, чтобы пользователь видел активное использование геолокации.

## Админ API
Клиент ожидает сервер по адресу `http://45.10.41.115:8080`. Маршруты совместимы с AutoPP Admin v1.2:
- `POST /api/device/heartbeat`
- `GET /api/device/config`
- `POST /api/device/events/batch`
- `POST /api/device/location`
- `POST /relay/luxon`
- `POST /relay/bingo`
