package kg.sprintergo.courier;

import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Поток событий с сервера. Это обычный HTTP, который не закрывается: сервер
 * пишет в него строки вида «event: offer» и «data: {…}» по мере того, как что-то
 * происходит. Ни библиотек, ни постоянного опроса — соединение просто висит.
 *
 * Почему так, а не через Firebase: пуши Google требуют аккаунта, ключей и живут
 * своей жизнью. Здесь мы сами держим связь и сами показываем уведомление, и всё
 * это работает на любом телефоне, включая те, где сервисов Google нет вовсе.
 */
final class Sse implements Runnable {

  interface Listener {
    /** Пришло событие. Возвращать ничего не надо, обработка на стороне слушателя. */
    void onEvent(String event, String data);

    /** Связь появилась или пропала — чтобы показать это человеку. */
    void onLink(boolean alive);
  }

  private static final String TAG = "SgSse";

  /** С чего начинаем ждать после обрыва и докуда растём. Мгновенный повтор в цикле
   *  разрядил бы батарею быстрее, чем что-либо ещё в этом приложении. */
  private static final long RETRY_MIN_MS = 2000;
  private static final long RETRY_MAX_MS = 60000;

  /** Сервер шлёт «ping» раз в двадцать секунд. Втрое дольше — значит связь мертва,
   *  хотя сокет об этом ещё не знает: так бывает в лифте и в метро. */
  private static final int READ_TIMEOUT_MS = 65000;

  private final String url;
  private final String token;
  private final Listener listener;

  private volatile boolean stopped;
  private volatile HttpURLConnection live;
  private Thread thread;

  Sse(String url, String token, Listener listener) {
    this.url = url;
    this.token = token;
    this.listener = listener;
  }

  void start() {
    if (thread != null) return;
    thread = new Thread(this, "sg-sse");
    thread.setDaemon(true);
    thread.start();
  }

  void stop() {
    stopped = true;
    HttpURLConnection c = live;
    if (c != null) {
      // disconnect() будит поток, застрявший на чтении: иначе он висел бы до
      // таймаута, а человек уже ушёл с линии.
      try { c.disconnect(); } catch (Exception ignored) { }
    }
    if (thread != null) thread.interrupt();
    thread = null;
  }

  @Override public void run() {
    long wait = RETRY_MIN_MS;
    while (!stopped) {
      boolean worked = false;
      try {
        worked = listen();
      } catch (Exception e) {
        Log.w(TAG, "поток оборвался: " + e);
      }
      listener.onLink(false);
      if (stopped) return;
      // Если связь держалась хоть сколько-то, начинаем ждать заново с малого:
      // обрыв через час — это не то же самое, что сервер, который лежит.
      wait = worked ? RETRY_MIN_MS : Math.min(RETRY_MAX_MS, wait * 2);
      try { Thread.sleep(wait); } catch (InterruptedException e) { return; }
    }
  }

  /** Один заход. true — связь состоялась и что-то пришло. */
  private boolean listen() throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    live = c;
    c.setRequestProperty("Accept", "text/event-stream");
    c.setRequestProperty("Cache-Control", "no-cache");
    c.setRequestProperty("Authorization", "Bearer " + token);
    c.setConnectTimeout(15000);
    c.setReadTimeout(READ_TIMEOUT_MS);
    c.setUseCaches(false);

    int code = c.getResponseCode();
    if (code != 200) {
      Log.w(TAG, "сервер ответил " + code);
      c.disconnect();
      // 401 — токен протух. Ждать смысла нет, пусть человек войдёт заново.
      if (code == 401 || code == 403) stopped = true;
      return false;
    }

    listener.onLink(true);
    boolean any = false;
    try (BufferedReader r = new BufferedReader(
        new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8), 8192)) {
      String event = null;
      StringBuilder data = new StringBuilder();
      String line;
      while (!stopped && (line = r.readLine()) != null) {
        any = true;
        if (line.isEmpty()) {
          // Пустая строка — конец события. Собранное отдаём слушателю.
          if (data.length() > 0) listener.onEvent(event == null ? "message" : event, data.toString());
          event = null;
          data.setLength(0);
          continue;
        }
        if (line.startsWith("event:")) {
          event = line.substring(6).trim();
        } else if (line.startsWith("data:")) {
          if (data.length() > 0) data.append('\n');
          data.append(line.substring(5).trim());
        }
        // «retry:» и комментарии сервера нам не нужны: выдержку считаем сами.
      }
    } finally {
      live = null;
      try { c.disconnect(); } catch (Exception ignored) { }
    }
    return any;
  }
}
