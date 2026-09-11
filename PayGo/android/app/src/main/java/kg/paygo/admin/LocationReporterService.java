package kg.paygo.admin;

import android.Manifest;
import android.app.*;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import org.json.JSONObject;

public class LocationReporterService extends Service implements LocationListener {
    private LocationManager lm;
    @Override public void onCreate(){ super.onCreate(); createChannel(); Notification n=new Notification.Builder(this,"autopp_location").setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("AutoPP").setContentText("Геолокация включена").setOngoing(true).build(); startForeground(2203,n); lm=(LocationManager)getSystemService(LOCATION_SERVICE); startLocation(); }
    private void createChannel(){ if(Build.VERSION.SDK_INT>=26)((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel("autopp_location","AutoPP location",NotificationManager.IMPORTANCE_LOW)); }
    private void startLocation(){ if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return; try{lm.requestLocationUpdates(LocationManager.GPS_PROVIDER,5000,0,this);}catch(Exception ignored){} try{lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,5000,0,this);}catch(Exception ignored){} }
    @Override public void onLocationChanged(Location l){ if(!Prefs.locationConsent(this)||!Prefs.activated(this))return; new Thread(()->{try{ JSONObject b=new JSONObject().put("device_id",Prefs.deviceId(this)).put("consent",true).put("lat",l.getLatitude()).put("lon",l.getLongitude()).put("accuracy",l.getAccuracy()); Http.json(this,"POST",Prefs.ADMIN_BASE+"/api/device/location",b);}catch(Exception ignored){} }).start(); }
    @Override public int onStartCommand(Intent i,int f,int id){ return START_STICKY; }
    @Override public void onDestroy(){ if(lm!=null)try{lm.removeUpdates(this);}catch(Exception ignored){} super.onDestroy(); }
    @Override public android.os.IBinder onBind(Intent i){ return null; }
}
