package kg.sprintergo.courier;

import android.content.Context;
import android.webkit.JavascriptInterface;

/**
 * Мостик между веб-приложением и телефоном.
 *
 * Веб знает, вошёл ли курьер и на линии ли он, — но не умеет держать связь с
 * погасшим экраном. Телефон умеет, но не знает, кто вошёл. Поэтому веб кричит
 * сюда три вещи: «вот токен», «я на линии», «я ушёл». Всё остальное приложение
 * делает само.
 *
 * Наружу этот мост не торчит: WebView открывает только наш домен, и методы
 * доступны лишь странице оттуда.
 */
final class Bridge {

  interface Host {
    void onShiftChanged(boolean on);

    void onAddressTyped(String typed);
  }

  private final Context ctx;
  private final Prefs prefs;
  private final Host host;

  Bridge(Context ctx, Prefs prefs, Host host) {
    this.ctx = ctx.getApplicationContext();
    this.prefs = prefs;
    this.host = host;
  }

  /** Веб сообщает, что человек вошёл: дальше служба говорит с сервером сама. */
  @JavascriptInterface
  public void setToken(String token) {
    prefs.setToken(token == null ? "" : token.trim());
  }

  /** Человек вышел из аккаунта — забываем всё и гасим смену. */
  @JavascriptInterface
  public void clearToken() {
    prefs.setToken("");
    prefs.setOnShift(false);
    ShiftService.stop(ctx);
    host.onShiftChanged(false);
  }

  /** Адрес сервиса. Страница подтверждает им саму себя: раз веб отвечает,
      значит адрес верный, и служба пойдёт туда же. Нужен и при переезде. */
  @JavascriptInterface
  public void setBase(String base) {
    prefs.setBase(base);
  }

  /** Адрес, который водитель ввёл на первом запуске. Проверяем его и открываем.
      Отвечает страница-настройка, а не сайт: до сайта мы ещё не дошли. */
  @JavascriptInterface
  public void useAddress(String typed) {
    host.onAddressTyped(typed);
  }

  /** Главное: курьер вышел на линию или ушёл с неё. */
  @JavascriptInterface
  public void setShift(boolean on) {
    prefs.setOnShift(on);
    if (on) ShiftService.start(ctx); else ShiftService.stop(ctx);
    host.onShiftChanged(on);
  }

  /** Веб спрашивает, внутри ли он приложения, — чтобы не предлагать его скачать. */
  @JavascriptInterface
  public boolean isApp() {
    return true;
  }

  /** Короткая вибрация: подтверждение нажатия там, где веб её не умеет. */
  @JavascriptInterface
  public void buzz(int ms) {
    android.os.Vibrator v = (android.os.Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
    if (v == null || !v.hasVibrator()) return;
    int len = Math.max(5, Math.min(200, ms));
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      v.vibrate(android.os.VibrationEffect.createOneShot(len,
          android.os.VibrationEffect.DEFAULT_AMPLITUDE));
    } else {
      v.vibrate(len);
    }
  }
}
