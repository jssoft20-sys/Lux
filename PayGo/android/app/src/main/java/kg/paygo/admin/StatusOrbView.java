package kg.paygo.admin;

import android.content.Context;
import android.graphics.*;
import android.view.View;

public class StatusOrbView extends View {
    private final Paint p=new Paint(1); private float a;
    public StatusOrbView(Context c){super(c);}
    @Override protected void onDraw(Canvas c){super.onDraw(c);float cx=getWidth()/2f,cy=getHeight()/2f,r=Math.min(cx,cy)*.76f;p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(3*getResources().getDisplayMetrics().density);for(int i=0;i<7;i++){p.setColor(Color.argb(50+i*18,90,255,60));RectF q=new RectF(cx-r+i*9,cy-r+i*9,cx+r-i*9,cy+r-i*9);c.drawArc(q,a+i*24,105+i*7,false,p);}p.setColor(0xFF65FF3D);p.setStrokeWidth(5*getResources().getDisplayMetrics().density);RectF q=new RectF(cx-r,cy-r,cx+r,cy+r);c.drawArc(q,a,54,false,p);c.drawArc(q,a+180,74,false,p);a=(a+2.2f)%360;postInvalidateDelayed(16);}
}
