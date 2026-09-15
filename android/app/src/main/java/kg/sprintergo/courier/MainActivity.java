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
import android.webkit.WebResourceError;
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
  /** Сейчас на экране наша страница адреса, а не сайт. */
  private boolean setup;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    prefs = new Prefs(this);

    web = new WebView(this);
    setContentView(web);
    setupWeb();

    if (state != null) web.restoreState(state);
    else if (prefs.hasBase()) open();
    else askAddress(null);

    askNotifications();
  }

  private void open() {
    web.loadUrl(prefs.base() + "/courier");
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
        String own = prefs.host();
        if (!own.isEmpty() && (host.equals(own) || host.endsWith("." + own))) return false;
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception ignored) { }
        return true;
      }

      @Override public void onReceivedError(WebView v, WebResourceRequest req,
                                            WebResourceError err) {
        // Ошибку показываем только для самой страницы: упавшая картинка или
        // плитка карты — не повод выкидывать человека на экран настройки.
        if (req == null || !req.isForMainFrame()) return;
        setup = true;
        askAddress(err == null ? null : String.valueOf(err.getDescription()));
      }

      @Override public void onPageFinished(WebView v, String url) {
        if (setup) return;              // это наша же страница адреса, не сайт
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

  // ── первый запуск: какой это сервис ───────────────────────────────────────

  /* Один и тот же файл APK раздают с разных доменов: сегодня sprintergo.kg,
     завтра сервис переехал, а у кого-то он вообще на своём адресе. Зашивать
     домен в приложение значит выдавать каждому свою сборку — и терять всех, у
     кого адрес другой: приложение молча открывало бы чужой сайт.

     Поэтому спрашиваем один раз, при первом запуске, и проверяем ответ делом:
     стучимся в /api/v1/config по введённому адресу. Отозвался — запоминаем и
     открываем. Нет — говорим, что не нашли, и человек правит опечатку. */

  private static final String SETUP_HTML =
      "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\">"
      + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">"
      + "<style>"
      + ":root{color-scheme:light}"
      + "*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}"
      + "body{margin:0;padding:32px 20px;font:16px/1.5 -apple-system,Roboto,system-ui,sans-serif;"
      + "background:#F3F1EB;color:#14110C;display:flex;flex-direction:column;min-height:100vh}"
      + ".logo{width:56px;height:56px;border-radius:18px;background:#FFDD2D;display:flex;"
      + "align-items:center;justify-content:center;font-size:30px;margin-bottom:22px}"
      + "h1{font-size:26px;line-height:1.2;margin:0 0 10px;letter-spacing:-.02em}"
      + "p{margin:0 0 22px;color:#6F6A60}"
      + "label{display:block;font-size:13px;font-weight:600;color:#6F6A60;margin:0 0 6px;"
      + "text-transform:uppercase;letter-spacing:.04em}"
      + "input{width:100%;padding:16px 18px;font-size:17px;border:2px solid #E4E0D6;border-radius:16px;"
      + "background:#fff;color:inherit;outline:none}"
      + "input:focus{border-color:#14110C}"
      + "button{width:100%;margin-top:16px;padding:18px;font-size:17px;font-weight:700;"
      + "border:0;border-radius:16px;background:#FFDD2D;color:#14110C;cursor:pointer}"
      + "button:active{transform:translateY(1px)}"
      + "button[disabled]{opacity:.55}"
      + ".bad{margin-top:14px;color:#C4341C;font-size:15px;min-height:22px}"
      + ".hint{margin-top:auto;padding-top:28px;color:#8A857A;font-size:14px}"
      + "</style></head><body>"
      + "<div class=\"logo\">\uD83D\uDE9A</div>"
      + "<h1>Адрес сервиса</h1>"
      + "<p>Введите адрес сайта, на котором работает ваша служба. "
      + "Его даёт диспетчер — тот же, что вы открываете в браузере.</p>"
      + "<label for=\"a\">Адрес</label>"
      + "<input id=\"a\" type=\"url\" inputmode=\"url\" autocapitalize=\"off\" "
      + "autocorrect=\"off\" spellcheck=\"false\" placeholder=\"sprintergo.kg\" value=\"%s\">"
      + "<button id=\"b\" type=\"button\">Продолжить</button>"
      + "<div class=\"bad\" id=\"e\">%s</div>"
      + "<p class=\"hint\">Сервис должен работать по https — иначе Android не даст "
      + "приложению ни связь, ни геопозицию.</p>"
      + "<script>"
      + "var i=document.getElementById('a'),b=document.getElementById('b'),e=document.getElementById('e');"
      + "function go(){var v=i.value.trim();if(!v){i.focus();return}"
      + "b.disabled=true;b.textContent='Проверяем\u2026';e.textContent='';"
      + "SprinterGo.useAddress(v)}"
      + "b.addEventListener('click',go);"
      + "i.addEventListener('keydown',function(ev){if(ev.key==='Enter')go()});"
      + "window.sgFailed=function(t){b.disabled=false;b.textContent='Продолжить';e.textContent=t};"
      + "setTimeout(function(){i.focus()},250);"
      + "</script></body></html>";

  private void askAddress(String problem) {
    setup = true;
    String typed = prefs.hasBase() ? prefs.host() : "";
    String bad = problem == null || problem.isEmpty() ? ""
        : "Не открылось: " + esc(problem) + ". Проверьте адрес.";
    String html = String.format(SETUP_HTML, esc(typed), bad);
    runOnUiThread(() -> web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null));
  }

  private static String esc(String s) {
    if (s == null) return "";
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
  }

  @Override public void onAddressTyped(String typed) {
    new Thread(() -> {
      String found = probe(typed);
      runOnUiThread(() -> {
        if (found == null) {
          web.evaluateJavascript(
              "window.sgFailed&&window.sgFailed('Сервис по этому адресу не отвечает. "
              + "Проверьте адрес или спросите у диспетчера.')", null);
          return;
        }
        prefs.setBase(found);
        setup = false;
        open();
      });
    }, "sg-probe").start();
  }

  /* Ищем сервис по введённому адресу. Пробуем и подпапку /go, и корень: сервис
     ставят и так, и так, а человек об этом знать не обязан. */
  private String probe(String typed) {
    String raw = typed == null ? "" : typed.trim();
    if (raw.isEmpty()) return null;
    raw = raw.replaceAll("^https?://", "").replaceAll("/+$", "");
    if (raw.isEmpty() || raw.contains(" ")) return null;
    String[] tails = raw.contains("/") ? new String[]{""} : new String[]{"/go", ""};
    for (String tail : tails) {
      String base = "https://" + raw + tail;
      if (alive(base + "/api/v1/config")) return base;
    }
    return null;
  }

  private boolean alive(String url) {
    java.net.HttpURLConnection c = null;
    try {
      c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
      c.setConnectTimeout(8000);
      c.setReadTimeout(8000);
      c.setRequestProperty("Accept", "application/json");
      if (c.getResponseCode() != 200) return false;
      java.io.InputStream in = c.getInputStream();
      byte[] buf = new byte[2048];
      int n = in.read(buf);
      in.close();
      String head = n > 0 ? new String(buf, 0, n, java.nio.charset.StandardCharsets.UTF_8) : "";
      // Чужой сайт тоже может ответить 200 на что угодно. Убеждаемся, что это
      // наш сервис, а не чья-то заглушка.
      return head.contains("\"service\"") || head.contains("\"tariffs\"");
    } catch (Exception e) {
      return false;
    } finally {
      if (c != null) c.disconnect();
    }
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
