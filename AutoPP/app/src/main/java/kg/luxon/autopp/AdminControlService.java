package kg.luxon.autopp;

import android.app.*;
import android.content.Context;
import android.content.Intent;
import android.os.*;

public class AdminControlService extends Service {
    private HandlerThread thread; private Handler h;
    private final Runnable tick=new Runnable(){ public void run(){ if(Prefs.activated(AdminControlService.this)){ AdminClient.heartbeat(AdminControlService.this); AdminClient.fetchConfig(AdminControlService.this); } h.postDelayed(this,5000); }};
    @Override public void onCreate(){ super.onCreate(); thread=new HandlerThread("autopp-admin"); thread.start(); h=new Handler(thread.getLooper()); h.post(tick); }
    @Override public int onStartCommand(Intent i,int f,int id){ return START_STICKY; }
    @Override public void onDestroy(){ if(h!=null)h.removeCallbacksAndMessages(null); if(thread!=null)thread.quitSafely(); super.onDestroy(); }
    @Override public android.os.IBinder onBind(Intent i){ return null; }
}
