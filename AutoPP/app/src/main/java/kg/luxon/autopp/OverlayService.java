package kg.luxon.autopp;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;

public class OverlayService extends Service {
    private WindowManager wm; private View root; private WindowManager.LayoutParams lp; private PowerManager.WakeLock wake;
    private float dx,dy; private int sx,sy; private ToneGenerator tone; private Vibrator vibrator;
    @Override public void onCreate(){
        super.onCreate();
        createChannel();
        createHardNotificationChannel();
        startForeground(2202,new Notification.Builder(this,"autopp_overlay")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("AutoPP")
            .setContentText("Плавающая панель активна")
            .setOngoing(true)
            .build());
        tone=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,80);
        vibrator=(Vibrator)getSystemService(Context.VIBRATOR_SERVICE);
        show();
    }
    private void createChannel(){if(Build.VERSION.SDK_INT>=26)((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel("autopp_overlay","AutoPP overlay",NotificationManager.IMPORTANCE_LOW));}
    private void createHardNotificationChannel(){if(Build.VERSION.SDK_INT>=26){android.app.NotificationChannel ch=new android.app.NotificationChannel("autopp_hard","AutoPP notifications",NotificationManager.IMPORTANCE_HIGH);ch.enableVibration(true);ch.enableLights(true);ch.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build());((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);}}
    private void show(){ if(Build.VERSION.SDK_INT>=23&&!Settings.canDrawOverlays(this)){stopSelf();return;} wm=(WindowManager)getSystemService(WINDOW_SERVICE);
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setGravity(Gravity.CENTER_HORIZONTAL);panel.setPadding(dp(12),dp(10),dp(12),dp(10));
        android.graphics.drawable.GradientDrawable bg=new android.graphics.drawable.GradientDrawable();
        bg.setColors(new int[]{0xFF1DB954,0xFF0A0E0C});bg.setOrientation(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM);
        bg.setCornerRadius(dp(28));bg.setStroke(dp(2),0xFF65FF3D);panel.setBackground(bg);
        LinearLayout header=new LinearLayout(this);header.setOrientation(LinearLayout.HORIZONTAL);header.setGravity(Gravity.CENTER_VERTICAL);
        ImageView logo=new ImageView(this);logo.setImageResource(kg.luxon.autopp.R.drawable.luxon_logo);header.addView(logo,new LinearLayout.LayoutParams(dp(40),dp(40)));
        Button start=new Button(this);start.setAllCaps(false);start.setText(Prefs.openBank(this)?"⏸":"▶");start.setTextSize(18);start.setTextColor(Color.BLACK);
        android.graphics.drawable.GradientDrawable btnBg=new android.graphics.drawable.GradientDrawable();btnBg.setColor(0xFF65FF3D);btnBg.setCornerRadius(dp(12));start.setBackground(btnBg);
        header.addView(start,new LinearLayout.LayoutParams(dp(50),dp(48),1));
        Button close=new Button(this);close.setText("✕");close.setTextSize(18);close.setTextColor(Color.BLACK);close.setBackground(btnBg);
        header.addView(close,new LinearLayout.LayoutParams(dp(50),dp(48)));
        panel.addView(header);
        LinearLayout controls=new LinearLayout(this);controls.setOrientation(LinearLayout.HORIZONTAL);controls.setGravity(Gravity.CENTER);controls.setPadding(0,dp(8),0,0);
        Button up=button("↑");up.setOnClickListener(v->{performCustomScroll(true);vibrate();});controls.addView(up,new LinearLayout.LayoutParams(dp(44),dp(44)));
        Button down=button("↓");down.setOnClickListener(v->{performCustomScroll(false);vibrate();});controls.addView(down,new LinearLayout.LayoutParams(dp(44),dp(44)));
        panel.addView(controls);
        start.setOnClickListener(v->{
            boolean on=!Prefs.openBank(this);Prefs.openBank(this,on);start.setText(on?"⏸":"▶");BankAssistService.lastHumanActivity=System.currentTimeMillis();
            if(on){acquireWake();tone.startTone(ToneGenerator.TONE_PROP_ACK,150);hardNotify("Запущено");}
            else{releaseWake();tone.startTone(ToneGenerator.TONE_PROP_NACK,150);hardNotify("Остановлено");}
        });
        close.setOnClickListener(v->stopSelf());
        panel.setOnTouchListener((v,e)->{switch(e.getAction()){case MotionEvent.ACTION_DOWN:sx=lp.x;sy=lp.y;dx=e.getRawX();dy=e.getRawY();return true;case MotionEvent.ACTION_MOVE:lp.x=sx+(int)(e.getRawX()-dx);lp.y=sy+(int)(e.getRawY()-dy);wm.updateViewLayout(root,lp);BankAssistService.lastHumanActivity=System.currentTimeMillis();return true;case MotionEvent.ACTION_UP:snap();return true;}return false;});
        int type=Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE;
        lp=new WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT,WindowManager.LayoutParams.WRAP_CONTENT,type,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,PixelFormat.TRANSLUCENT);
        lp.gravity=Gravity.TOP|Gravity.START;lp.x=20;lp.y=180;root=panel;wm.addView(root,lp);if(Prefs.openBank(this))acquireWake();
    }
    private Button button(String txt){Button b=new Button(this);b.setText(txt);b.setAllCaps(false);b.setTextColor(Color.BLACK);b.setTextSize(16);
        android.graphics.drawable.GradientDrawable g=new android.graphics.drawable.GradientDrawable();g.setColor(0xFF65FF3D);g.setCornerRadius(dp(10));b.setBackground(g);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(dp(44),dp(44));p.setMargins(dp(4),0,dp(4),0);b.setLayoutParams(p);return b;}
    private void performCustomScroll(boolean up){if(BankAssistService.instance==null)return;
        if(Build.VERSION.SDK_INT<24)return;android.util.DisplayMetrics dm=getResources().getDisplayMetrics();float x=dm.widthPixels*.55f,cy=dm.heightPixels*.62f;float dy=60f*dm.density;
        android.graphics.Path p=new android.graphics.Path();p.moveTo(x,cy);p.lineTo(x,up?cy-dy:cy+dy);
        android.accessibilityservice.GestureDescription g=new android.accessibilityservice.GestureDescription.Builder().addStroke(new android.accessibilityservice.GestureDescription.StrokeDescription(p,0,200)).build();
        BankAssistService.instance.dispatchGesture(g,null,null);
    }
    private void vibrate(){if(vibrator!=null){if(Build.VERSION.SDK_INT>=26)vibrator.vibrate(android.os.VibrationEffect.createOneShot(80,android.os.VibrationEffect.DEFAULT_AMPLITUDE));else vibrator.vibrate(80);}}
    private void hardNotify(String msg){if(Build.VERSION.SDK_INT>=26){
        android.app.Notification n=new android.app.Notification.Builder(this,"autopp_hard").setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("AutoPP").setContentText(msg).setAutoCancel(true).build();
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify((int)System.currentTimeMillis(),n);
    }}
    private void snap(){if(wm==null||lp==null)return;android.util.DisplayMetrics d=new android.util.DisplayMetrics();wm.getDefaultDisplay().getMetrics(d);lp.x=lp.x+d.widthPixels/2<d.widthPixels/2?dp(8):d.widthPixels-(root.getWidth()+dp(8));wm.updateViewLayout(root,lp);}
    private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density+.5f);}
    private void acquireWake(){if(wake==null){PowerManager p=(PowerManager)getSystemService(POWER_SERVICE);wake=p.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK|PowerManager.ON_AFTER_RELEASE,"AutoPP:OpenBank");wake.setReferenceCounted(false);}if(!wake.isHeld())wake.acquire();}
    private void releaseWake(){if(wake!=null&&wake.isHeld())wake.release();}
    @Override public int onStartCommand(Intent i,int f,int id){return START_STICKY;}
    @Override public void onDestroy(){releaseWake();if(root!=null&&wm!=null)try{wm.removeView(root);}catch(Exception ignored){}if(tone!=null)tone.release();super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
}
