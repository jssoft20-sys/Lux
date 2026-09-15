package kg.sprintergo.courier;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Небольшая память приложения: адрес сервиса, токен курьера, состояние смены.
 *
 * Токен здесь лежит не в открытом виде — он перемешан с ключом, который зависит
 * от установки. Это не шифрование и не притворяется им: от человека с рутом оно
 * не спасёт. Смысл скромнее — чтобы токен не лежал читаемой строкой в файле,
 * который утащит первое попавшееся приложение с доступом к резервным копиям.
 */
final class Prefs {

  private static final String FILE = "sg";
  private static final String K_TOKEN = "t";
  private static final String K_BASE = "base";
  private static final String K_SHIFT = "shift";
  private static final String K_SALT = "salt";

  static final String DEFAULT_BASE = "https://sprintergo.kg/go";

  private final SharedPreferences sp;

  Prefs(Context c) {
    sp = c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
  }

  private byte[] key() {
    String salt = sp.getString(K_SALT, null);
    if (salt == null) {
      salt = Long.toHexString(System.nanoTime()) + Long.toHexString(new java.util.Random().nextLong());
      sp.edit().putString(K_SALT, salt).apply();
    }
    return salt.getBytes(java.nio.charset.StandardCharsets.UTF_8);
  }

  private String scramble(String text) {
    if (text == null || text.isEmpty()) return "";
    byte[] k = key();
    byte[] b = text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    for (int i = 0; i < b.length; i++) b[i] ^= k[i % k.length];
    return android.util.Base64.encodeToString(b, android.util.Base64.NO_WRAP);
  }

  private String unscramble(String stored) {
    if (stored == null || stored.isEmpty()) return "";
    try {
      byte[] b = android.util.Base64.decode(stored, android.util.Base64.NO_WRAP);
      byte[] k = key();
      for (int i = 0; i < b.length; i++) b[i] ^= k[i % k.length];
      return new String(b, java.nio.charset.StandardCharsets.UTF_8);
    } catch (IllegalArgumentException e) {
      return "";                       // мусор в настройках — считаем, что токена нет
    }
  }

  String token() { return unscramble(sp.getString(K_TOKEN, "")); }

  void setToken(String token) {
    sp.edit().putString(K_TOKEN, scramble(token)).apply();
  }

  /** Адрес сервиса. Меняется только из самого веб-приложения, руками его не трогают. */
  String base() {
    String b = sp.getString(K_BASE, DEFAULT_BASE);
    return b.endsWith("/") ? b.substring(0, b.length() - 1) : b;
  }

  void setBase(String base) {
    if (base != null && base.startsWith("https://")) sp.edit().putString(K_BASE, base).apply();
  }

  boolean onShift() { return sp.getBoolean(K_SHIFT, false); }

  void setOnShift(boolean on) { sp.edit().putBoolean(K_SHIFT, on).apply(); }
}
