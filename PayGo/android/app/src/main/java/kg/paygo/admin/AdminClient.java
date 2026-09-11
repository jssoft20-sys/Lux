package kg.paygo.admin;

import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;

public final class AdminClient {
    private AdminClient() {}
    public static Http.Result heartbeat(Context c) {
        try {
            JSONObject q=new JSONObject().put("pending",0).put("sent",0).put("failed",0);
            JSONArray selected=new JSONArray(); for(String p:Prefs.selectedPackages(c)) selected.put(p);
            JSONObject b=new JSONObject()
                    .put("device_id",Prefs.deviceId(c)).put("model",Build.MANUFACTURER+" "+Build.MODEL)
                    .put("android",Build.VERSION.RELEASE).put("app_version","3.4.3")
                    .put("enabled",Prefs.localEnabled(c)).put("luxon_enabled",Prefs.luxonEnabled(c)).put("bingo_enabled",Prefs.bingoEnabled(c))
                    .put("listener_access",notificationAccess(c)).put("listener_connected",LuxNotificationListener.connected)
                    .put("service_running",true).put("battery_unrestricted",batteryUnrestricted(c)).put("selected_packages",selected).put("queue",q);
            return Http.json(c,"POST",Prefs.ADMIN_BASE+"/api/device/heartbeat",b);
        }catch(Exception e){return new Http.Result(-1,"",0,e.toString());}
    }
    public static Http.Result fetchConfig(Context c) {
        Http.Result r=Http.json(c,"GET",Prefs.ADMIN_BASE+"/api/device/config?device_id="+Prefs.deviceId(c)+"&since="+Prefs.configVersion(c)+"&wait_ms=0",null);
        if(r.ok()) try {
            JSONObject root=new JSONObject(r.body); if(root.optBoolean("changed")){
                Prefs.configVersion(c,root.optInt("version",Prefs.configVersion(c)));
                JSONObject cfg=root.optJSONObject("config"); if(cfg!=null){
                    Prefs.remoteEnabled(c,cfg.optBoolean("enabled",true));
                    Prefs.luxonEnabled(c,cfg.optBoolean("luxon_enabled",true)); Prefs.bingoEnabled(c,cfg.optBoolean("bingo_enabled",true));
                    Prefs.luxonEndpoint(c,cfg.optString("luxon_endpoint",Prefs.luxonEndpoint(c))); Prefs.bingoEndpoint(c,cfg.optString("bingo_endpoint",Prefs.bingoEndpoint(c)));
                    Prefs.p(c).edit().putInt("timeout_sec",cfg.optInt("timeout_sec",1)).apply();
                }
            }
        }catch(Exception ignored){}
        return r;
    }
    public static void event(Context c,String route,boolean ok,int code,long latency,String text,String err){
        try { JSONArray a=new JSONArray().put(new JSONObject().put("route",route).put("ok",ok).put("http_code",code).put("latency_ms",latency).put("text",text).put("error",err==null?"":err));
            JSONObject b=new JSONObject().put("device_id",Prefs.deviceId(c)).put("events",a); Http.json(c,"POST",Prefs.ADMIN_BASE+"/api/device/events/batch",b);
        }catch(Exception ignored){}
    }
    public static boolean notificationAccess(Context c){ String s=Settings.Secure.getString(c.getContentResolver(),"enabled_notification_listeners"); return s!=null&&s.contains(c.getPackageName()); }
    public static boolean batteryUnrestricted(Context c){ if(Build.VERSION.SDK_INT<23)return true; android.os.PowerManager p=(android.os.PowerManager)c.getSystemService(Context.POWER_SERVICE); return p!=null&&p.isIgnoringBatteryOptimizations(c.getPackageName()); }
}
