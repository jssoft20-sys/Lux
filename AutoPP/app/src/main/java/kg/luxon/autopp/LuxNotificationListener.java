package kg.luxon.autopp;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class LuxNotificationListener extends NotificationListenerService {
    public static volatile boolean connected=false;
    private final ExecutorService luxon=Executors.newFixedThreadPool(16), bingo=Executors.newFixedThreadPool(16);
    @Override public void onListenerConnected(){connected=true;}
    @Override public void onListenerDisconnected(){connected=false;}
    @Override public void onNotificationPosted(StatusBarNotification sbn){
        if(!Prefs.localEnabled(this)||!Prefs.remoteEnabled(this))return;
        Set<String> selected=Prefs.selectedPackages(this); if(!selected.isEmpty()&&!selected.contains(sbn.getPackageName()))return;
        Notification n=sbn.getNotification(); if(n==null)return;
        CharSequence title=n.extras.getCharSequence(Notification.EXTRA_TITLE), text=n.extras.getCharSequence(Notification.EXTRA_TEXT);
        String t=(title==null?"":title.toString()), msg=(text==null?"":text.toString());
        String payload; try{payload=new JSONObject().put("package",sbn.getPackageName()).put("title",t).put("text",msg).put("posted_at",sbn.getPostTime()).toString();}catch(Exception e){return;}
        if(Prefs.luxonEnabled(this))luxon.submit(()->send("LuxOn",Prefs.luxonEndpoint(this),payload));
        if(Prefs.bingoEnabled(this))bingo.submit(()->send("Bingo",Prefs.bingoEndpoint(this),payload));
    }
    private void send(String route,String url,String payload){ try{Http.Result r=Http.json(this,"POST",url,new JSONObject(payload)); AdminClient.event(this,route,r.ok(),r.code,r.ms,payload,r.error);}catch(Exception e){AdminClient.event(this,route,false,-1,0,payload,e.toString());} }
}
