package kg.sprintergo.courier;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.app.Activity;

/**
 * Единственный экран приложения: то же самое веб-приложение курьера, но внутри
 * своей оболочки.
 *
 * Почему не переписывать интерфейс заново на Java: он уже есть, работает и
 * правится в одном месте для всех — браузера, айфона и этого приложения. Java
 * здесь берёт на себя ровно то, чего веб на телефоне не может: связь и
 * координаты при погасшем экране, звук на новый заказ, значок на рабочем столе.
 */
public final class MainActivity extends Activity implements Bridge.Host {

  private static final int REQ_GEO = 10;
  private static final int REQ_BG = 11;
  private static final int REQ_NOTIFY = 12;

  private WebView web;
  private Prefs prefs;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    prefs = new Prefs(this);

    web = new WebView(this);
    setContentView(web);
    setupWeb();

    if (state != null) web.restoreState(state);
    else web.loadUrl(prefs.base() + "/courier");

    askNotifications();
  }

  private void setupWeb() {
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setGeolocationEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);   // звук нового заказа должен играть сам
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    // Веб узнаёт нас по этой приписке: внутри приложения он не предлагает
    // «скачать приложение» и включает мостик вместо обходных путей.
    s.setUserAgentString(s.getUserAgentString() + " SprinterGoApp/1.0");

    web.setBackgroundColor(0xFFF3F1EB);
    web.addJavascriptInterface(new Bridge(this, prefs, this), "SprinterGo");

    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        String host = u.getHost() == null ? "" : u.getHost();
        // Свой домен открываем внутри, чужие ссылки (звонок, навигатор, карты) —
        // наружу: водителю нужен настоящий Навигатор, а не его копия в окне.
        if (host.endsWith("sprintergo.kg")) return false;
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception ignored) { }
        return true;
      }

      @Override public void onPageFinished(WebView v, String url) {
        // Смена могла начаться до перезапуска приложения — говорим об этом вебу,
        // чтобы кнопка «на линии» не выглядела выключенной, пока служба работает.
        if (prefs.onShift()) {
          v.evaluateJavascript(
              "window.dispatchEvent(new CustomEvent('sg-app-shift',{detail:{on:true}}))", null);
        }
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override public void onGeolocationPermissionsShowPrompt(String origin,
                                                               GeolocationPermissions.Callback cb) {
        // Разрешение у системы уже спрошено нами. Веб внутри своего же
        // приложения переспрашивать не должен.
        boolean have = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        if (!have) askGeo();
        cb.invoke(origin, have, false);
      }

      @Override public void onPermissionRequest(PermissionRequest request) {
        request.deny();      // камера и микрофон приложению не нужны
      }
    });
  }

  @Override public void onShiftChanged(boolean on) {
    if (!on) return;
    runOnUiThread(() -> {
      askGeo();
      askBackground();
    });
  }

  // ── разрешения: сначала объясняем, потом просим ───────────────────────────

  private void why(int title, int text, Runnable then) {
    new AlertDialog.Builder(this)
        .setTitle(title)
        .setMessage(text)
        .setCancelable(false)
        .setPositiveButton(R.string.ok, (d, w) -> then.run())
        .show();
  }

  private void askNotifications() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
        == PackageManager.PERMISSION_GRANTED) return;
    why(R.string.why_notify_title, R.string.why_notify,
        () -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY));
  }

  private void askGeo() {
    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        == PackageManager.PERMISSION_GRANTED) return;
    why(R.string.why_location_title, R.string.why_location,
        () -> requestPermissions(new String[]{
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_GEO));
  }

  private void askBackground() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        != PackageManager.PERMISSION_GRANTED) return;
    if (checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        == PackageManager.PERMISSION_GRANTED) return;
    // С Android 11 фоновую геолокацию нельзя спросить окном — только отправить
    // человека в настройки. Поэтому сначала объясняем, зачем туда идти.
    new AlertDialog.Builder(this)
        .setTitle(R.string.why_background_title)
        .setMessage(R.string.why_background)
        .setNegativeButton(R.string.ok, null)
        .setPositiveButton(R.string.settings, (d, w) -> {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName())));
          } else {
            requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, REQ_BG);
          }
        })
        .show();
  }

  @Override public void onRequestPermissionsResult(int code, String[] perms, int[] granted) {
    super.onRequestPermissionsResult(code, perms, granted);
    boolean ok = granted.length > 0 && granted[0] == PackageManager.PERMISSION_GRANTED;
    if (code == REQ_GEO && ok) {
      askBackground();
      if (prefs.onShift()) ShiftService.start(this);     // перезапускаем с правами
    }
  }

  // ── обычные мелочи оболочки ───────────────────────────────────────────────

  @Override public void onBackPressed() {
    if (web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }

  @Override protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    web.saveState(out);
  }

  @Override protected void onDestroy() {
    if (web != null) {
      web.setVisibility(View.GONE);
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }
}
