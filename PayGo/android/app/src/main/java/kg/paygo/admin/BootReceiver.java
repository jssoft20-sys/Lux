package kg.paygo.admin;
import android.content.*;
import android.os.Build;
public class BootReceiver extends BroadcastReceiver { @Override public void onReceive(Context c,Intent i){ if(Prefs.activated(c)){c.startService(new Intent(c,AdminControlService.class)); if(Prefs.locationConsent(c)) try{ if(Build.VERSION.SDK_INT>=26)c.startForegroundService(new Intent(c,LocationReporterService.class));else c.startService(new Intent(c,LocationReporterService.class));}catch(Exception ignored){} } } }
