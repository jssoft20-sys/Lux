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
        CharSequence text=n.extras.getCharSequence(Notification.EXTRA_TEXT);
        String msg=(text==null?"":text.toString());
        if(Prefs.bingoEnabled(this))bingo.submit(()->Http.get(this,Prefs.bingoEndpoint(this),"text",msg));
    }
}
