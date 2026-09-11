package kg.paygo.admin;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;

public class BankAssistService extends AccessibilityService {
    public static volatile BankAssistService instance;
    public static volatile long lastHumanActivity=0;
    private boolean down=true;
    private final Handler h=new Handler(Looper.getMainLooper());
    private final Runnable loop=new Runnable(){ public void run(){ if(Prefs.openBank(BankAssistService.this)&&System.currentTimeMillis()-lastHumanActivity>=12000) performScroll(); h.postDelayed(this,1800); }};
    @Override protected void onServiceConnected(){ instance=this; lastHumanActivity=System.currentTimeMillis(); h.post(loop); }
    @Override public void onAccessibilityEvent(AccessibilityEvent e){ int t=e.getEventType(); if(t==AccessibilityEvent.TYPE_VIEW_CLICKED||t==AccessibilityEvent.TYPE_VIEW_SCROLLED||t==AccessibilityEvent.TYPE_TOUCH_INTERACTION_START||t==AccessibilityEvent.TYPE_TOUCH_INTERACTION_END) lastHumanActivity=System.currentTimeMillis(); }
    @Override public void onInterrupt(){}
    @Override public void onDestroy(){instance=null;h.removeCallbacksAndMessages(null);super.onDestroy();}
    public void performScroll(){ if(android.os.Build.VERSION.SDK_INT<24)return; android.util.DisplayMetrics dm=getResources().getDisplayMetrics(); float x=dm.widthPixels*.55f, cy=dm.heightPixels*.62f; float dy=96f*dm.density; Path p=new Path(); p.moveTo(x,cy); p.lineTo(x, down?cy-dy:cy+dy); down=!down; GestureDescription g=new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p,0,280)).build(); dispatchGesture(g,null,null); }
}
