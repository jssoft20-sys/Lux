package kg.paygo.admin;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;
import java.util.HashSet;
import java.util.Set;

public final class Prefs {
    private static final String NAME = "paygo_autopp";
    public static final String ADMIN_BASE = "http://45.10.41.115:8080";
    private Prefs() {}
    public static SharedPreferences p(Context c) { return c.getSharedPreferences(NAME, Context.MODE_PRIVATE); }
    public static String token(Context c) { return p(c).getString("api_key", ""); }
    public static void token(Context c, String v) { p(c).edit().putString("api_key", v == null ? "" : v.trim()).apply(); }
    public static boolean activated(Context c) { return !token(c).isEmpty(); }
    public static String deviceId(Context c) {
        String id = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ANDROID_ID);
        return id == null ? "unknown" : id;
    }
    public static boolean localEnabled(Context c) { return p(c).getBoolean("local_enabled", true); }
    public static void localEnabled(Context c, boolean v) { p(c).edit().putBoolean("local_enabled", v).apply(); }
    public static boolean remoteEnabled(Context c) { return p(c).getBoolean("remote_enabled", true); }
    public static void remoteEnabled(Context c, boolean v) { p(c).edit().putBoolean("remote_enabled", v).apply(); }
    public static boolean luxonEnabled(Context c) { return p(c).getBoolean("luxon_enabled", true); }
    public static boolean bingoEnabled(Context c) { return p(c).getBoolean("bingo_enabled", true); }
    public static void luxonEnabled(Context c, boolean v) { p(c).edit().putBoolean("luxon_enabled", v).apply(); }
    public static void bingoEnabled(Context c, boolean v) { p(c).edit().putBoolean("bingo_enabled", v).apply(); }
    public static String luxonEndpoint(Context c) { return p(c).getString("luxon_endpoint", "https://hl2ltd35h1y8ao4.spx5hcjq5e7ehaowbv3z83owkyh4udiywz3.ru/backend/auto-pp-1w0fmjjsv6y4r1/"); }
    public static String bingoEndpoint(Context c) { return p(c).getString("bingo_endpoint", Prefs.ADMIN_BASE + "/relay/bingo"); }
    public static void luxonEndpoint(Context c, String v) { p(c).edit().putString("luxon_endpoint", v).apply(); }
    public static void bingoEndpoint(Context c, String v) { p(c).edit().putString("bingo_endpoint", v).apply(); }
    public static int timeoutSec(Context c) { return Math.max(1, p(c).getInt("timeout_sec", 1)); }
    public static boolean openBank(Context c) { return p(c).getBoolean("open_bank", false); }
    public static void openBank(Context c, boolean v) { p(c).edit().putBoolean("open_bank", v).apply(); }
    public static boolean locationConsent(Context c) { return p(c).getBoolean("location_consent", false); }
    public static void locationConsent(Context c, boolean v) { p(c).edit().putBoolean("location_consent", v).apply(); }
    public static Set<String> selectedPackages(Context c) { return new HashSet<>(p(c).getStringSet("selected_packages", new HashSet<>())); }
    public static void selectedPackages(Context c, Set<String> s) { p(c).edit().putStringSet("selected_packages", new HashSet<>(s)).apply(); }
    public static int configVersion(Context c) { return p(c).getInt("config_version", 0); }
    public static void configVersion(Context c, int v) { p(c).edit().putInt("config_version", v).apply(); }
    public static int diamonds(Context c) { return p(c).getInt("diamonds", 0); }
    public static void diamonds(Context c, int v) { p(c).edit().putInt("diamonds", v).apply(); }
    public static void addDiamonds(Context c, int count) { diamonds(c, diamonds(c) + count); }
}
