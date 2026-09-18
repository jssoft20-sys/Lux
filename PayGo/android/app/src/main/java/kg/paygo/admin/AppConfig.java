package kg.paygo.admin;

import android.net.Uri;

/**
 * Единственное место, где задан адрес веб-приложения.
 * Чтобы собрать приложение под другой адрес — измените START_URL и пересоберите APK.
 */
public final class AppConfig {

    /** Стартовый URL мобильной админ-панели PayGo. */
    public static final String START_URL = "https://wwweeewww.fit/paygo/";

    /** Хост приложения: его страницы открываются внутри WebView, остальное — во внешних приложениях. */
    public static final String APP_HOST = Uri.parse(START_URL).getHost();

    /** Добавляется к стандартному User-Agent WebView, чтобы сервер мог отличить приложение от браузера. */
    public static final String USER_AGENT_SUFFIX = " PayGoApp/1.0";

    private AppConfig() {
    }

    /** true, если ссылка ведёт на хост приложения (или его поддомен). */
    public static boolean isAppHost(Uri uri) {
        if (uri == null || APP_HOST == null) return false;
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(java.util.Locale.ROOT);
        String appHost = APP_HOST.toLowerCase(java.util.Locale.ROOT);
        return host.equals(appHost) || host.endsWith("." + appHost);
    }
}
