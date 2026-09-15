package kg.sprintergo.courier;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Служба смены. Живёт ровно столько, сколько курьер на линии, и делает две вещи,
 * которых браузер на телефоне не умеет:
 *
 *   1. Шлёт координаты, пока экран погашен. Клиент видит, где едет машина, а
 *      диспетчер знает, кому предложить следующий заказ.
 *   2. Держит открытым поток событий и будит человека звуком, когда приходит
 *      предложение. Без этого водитель узнавал бы о заказе, только сам заглянув
 *      в телефон, — и заказ уходил бы соседу.
 *
 * Постоянное уведомление здесь не для красоты: это единственный способ в
 * современном Android не быть выгруженным из памяти через пару минут.
 */
public final class ShiftService extends Service implements Sse.Listener {

  private static final String TAG = "SgShift";

  static final String ACTION_START = "kg.sprintergo.courier.START";
  static final String ACTION_STOP = "kg.sprintergo.courier.STOP";

  private static final String CH_SHIFT = "shift";
  private static final String CH_OFFER = "offers";
  private static final int ID_SHIFT = 1;
  private static final int ID_OFFER_BASE = 100;

  /** Как часто просим у телефона координаты. Чаще пяти секунд смысла нет: точка
   *  всё равно не обновляется быстрее, а батарея тает заметно. */
  private static final long GEO_EVERY_MS = 5000;
  private static final float GEO_EVERY_M = 15f;

  /** Реже этого точку на сервер не шлём, даже если телефон отдаёт чаще. */
  private static final long SEND_EVERY_MS = 4000;

  private Prefs prefs;
  private LocationManager lm;
  private PowerManager.WakeLock wake;
  private Sse sse;
  private final Handler main = new Handler(Looper.getMainLooper());

  private long lastSent;
  private int offerSeq;
  private volatile boolean linkAlive;

  @Override public IBinder onBind(Intent intent) { return null; }

  @Override public void onCreate() {
    super.onCreate();
    prefs = new Prefs(this);
    lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
    channels();
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? ACTION_START : intent.getAction();
    if (ACTION_STOP.equals(action)) {
      stopEverything();
      return START_NOT_STICKY;
    }

    startForeground(ID_SHIFT, shiftNote(getString(R.string.shift_hint)));
    holdWake();
    listenGeo();
    listenEvents();
    // START_STICKY: если система всё-таки нас убьёт под нехваткой памяти,
    // она поднимет службу обратно — смена не должна молча прекращаться.
    return START_STICKY;
  }

  @Override public void onDestroy() {
    stopEverything();
    super.onDestroy();
  }

  private void stopEverything() {
    if (sse != null) { sse.stop(); sse = null; }
    try { lm.removeUpdates(geo); } catch (SecurityException ignored) { }
    releaseWake();
    stopForeground(true);
    stopSelf();
  }

  // ── уведомления ───────────────────────────────────────────────────────────

  private void channels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = getSystemService(NotificationManager.class);

    NotificationChannel shift = new NotificationChannel(
        CH_SHIFT, getString(R.string.ch_shift_name), NotificationManager.IMPORTANCE_LOW);
    shift.setDescription(getString(R.string.ch_shift_desc));
    shift.setShowBadge(false);
    nm.createNotificationChannel(shift);

    // Заказ — это важно: звук, вибрация и всплывающее окно поверх всего.
    NotificationChannel offer = new NotificationChannel(
        CH_OFFER, getString(R.string.ch_offer_name), NotificationManager.IMPORTANCE_HIGH);
    offer.setDescription(getString(R.string.ch_offer_desc));
    offer.enableVibration(true);
    offer.setVibrationPattern(new long[]{0, 220, 120, 220});
    nm.createNotificationChannel(offer);
  }

  private PendingIntent openApp() {
    Intent i = new Intent(this, MainActivity.class)
        .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getActivity(this, 0, i, flags);
  }

  private Notification shiftNote(String text) {
    Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, CH_SHIFT) : new Notification.Builder(this);
    return b.setContentTitle(getString(R.string.shift_on))
        .setContentText(text)
        .setSmallIcon(R.drawable.ic_notify)
        .setContentIntent(openApp())
        .setOngoing(true)
        .setShowWhen(false)
        .build();
  }

  private void updateShiftNote(String text) {
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (nm != null) nm.notify(ID_SHIFT, shiftNote(text));
  }

  private void offerNote(JSONObject o) {
    String addr = o.optString("addr", o.optString("from", ""));
    String price = o.optString("price_text", "");
    String dist = o.optString("distance_text", "");
    StringBuilder line = new StringBuilder();
    if (!price.isEmpty()) line.append(price);
    if (!dist.isEmpty()) line.append(line.length() > 0 ? " · " : "").append(dist);

    Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, CH_OFFER) : new Notification.Builder(this);
    b.setContentTitle(getString(R.string.offer_title))
        .setContentText(addr.isEmpty() ? line.toString() : addr)
        .setSmallIcon(R.drawable.ic_notify)
        .setContentIntent(openApp())
        .setAutoCancel(true)
        .setCategory(Notification.CATEGORY_CALL);
    if (!addr.isEmpty() && line.length() > 0) {
      b.setStyle(new Notification.BigTextStyle().bigText(addr + "\n" + line));
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      b.setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE);
      b.setPriority(Notification.PRIORITY_HIGH);
    }
    NotificationManager nm = getSystemService(NotificationManager.class);
    // У каждого предложения свой номер: два заказа подряд не должны затирать
    // друг друга — водитель вправе увидеть оба.
    if (nm != null) nm.notify(ID_OFFER_BASE + (offerSeq++ % 8), b.build());
  }

  // ── координаты ────────────────────────────────────────────────────────────

  private final LocationListener geo = new LocationListener() {
    @Override public void onLocationChanged(Location loc) { send(loc); }
    @Override public void onStatusChanged(String p, int s, Bundle e) { }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }
  };

  private boolean mayLocate() {
    return checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
        == PackageManager.PERMISSION_GRANTED;
  }

  private void listenGeo() {
    if (!mayLocate()) {
      updateShiftNote(getString(R.string.why_location));
      return;
    }
    try {
      // Просим оба источника: спутники точнее, сеть отвечает в подземном паркинге.
      if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, GEO_EVERY_MS, GEO_EVERY_M, geo,
            Looper.getMainLooper());
      }
      if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
        lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, GEO_EVERY_MS * 3, GEO_EVERY_M * 4,
            geo, Looper.getMainLooper());
      }
    } catch (SecurityException e) {
      Log.w(TAG, "координаты запрещены: " + e);
    }
  }

  private void send(Location loc) {
    long now = System.currentTimeMillis();
    if (now - lastSent < SEND_EVERY_MS) return;
    lastSent = now;

    final String token = prefs.token();
    if (token.isEmpty()) return;
    final String url = prefs.base() + "/api/v1/courier/geo";
    final double lat = loc.getLatitude(), lng = loc.getLongitude();
    final float heading = loc.hasBearing() ? loc.getBearing() : -1f;
    final float speed = loc.hasSpeed() ? loc.getSpeed() : -1f;
    final float acc = loc.hasAccuracy() ? loc.getAccuracy() : -1f;

    new Thread(() -> {
      try {
        JSONObject body = new JSONObject();
        body.put("lat", lat);
        body.put("lng", lng);
        if (heading >= 0) body.put("heading", Math.round(heading));
        if (speed >= 0) body.put("speed", Math.round(speed * 3.6));   // м/с → км/ч
        if (acc >= 0) body.put("accuracy", Math.round(acc));
        post(url, token, body.toString());
      } catch (Exception e) {
        Log.w(TAG, "координаты не ушли: " + e);
      }
    }, "sg-geo").start();
  }

  private void post(String url, String token, String json) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    try {
      c.setRequestMethod("POST");
      c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
      c.setRequestProperty("Authorization", "Bearer " + token);
      c.setConnectTimeout(12000);
      c.setReadTimeout(12000);
      c.setDoOutput(true);
      byte[] raw = json.getBytes(StandardCharsets.UTF_8);
      c.setFixedLengthStreamingMode(raw.length);
      try (OutputStream os = c.getOutputStream()) { os.write(raw); }
      c.getResponseCode();               // ответ нам не нужен, важен сам факт отправки
    } finally {
      c.disconnect();
    }
  }

  // ── поток событий ─────────────────────────────────────────────────────────

  private void listenEvents() {
    if (sse != null) return;
    String token = prefs.token();
    if (token.isEmpty()) return;
    sse = new Sse(prefs.base() + "/api/v1/courier/stream", token, this);
    sse.start();
  }

  @Override public void onEvent(String event, String data) {
    if (!"offer".equals(event)) return;
    try {
      JSONObject o = new JSONObject(data);
      main.post(() -> offerNote(o));
    } catch (Exception e) {
      Log.w(TAG, "не разобрал предложение: " + e);
    }
  }

  @Override public void onLink(boolean alive) {
    if (alive == linkAlive) return;
    linkAlive = alive;
    main.post(() -> updateShiftNote(alive ? getString(R.string.shift_hint)
                                          : getString(R.string.no_net)));
  }

  // ── сон телефона ──────────────────────────────────────────────────────────

  private void holdWake() {
    if (wake != null && wake.isHeld()) return;
    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sprintergo:shift");
    wake.setReferenceCounted(false);
    // Без ограничения по времени: смена длится столько, сколько длится, а
    // отпускаем мы его сами, когда курьер уходит с линии.
    wake.acquire();
  }

  private void releaseWake() {
    if (wake != null && wake.isHeld()) wake.release();
    wake = null;
  }

  // ── запуск снаружи ────────────────────────────────────────────────────────

  static void start(Context c) {
    Intent i = new Intent(c, ShiftService.class).setAction(ACTION_START);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i);
    else c.startService(i);
  }

  static void stop(Context c) {
    c.startService(new Intent(c, ShiftService.class).setAction(ACTION_STOP));
  }
}
