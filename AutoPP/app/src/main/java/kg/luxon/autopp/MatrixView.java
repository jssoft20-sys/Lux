package kg.luxon.autopp;

import android.content.Context;
import android.graphics.*;
import android.view.View;
import java.util.Random;

public class MatrixView extends View {
    private final Paint p=new Paint(1); private final Random r=new Random(); private float[] ys; private int cols;
    public MatrixView(Context c){super(c);p.setTypeface(Typeface.MONOSPACE);p.setTextSize(18*getResources().getDisplayMetrics().scaledDensity);p.setColor(0x405AFF38);setAlpha(.45f);}
    @Override protected void onSizeChanged(int w,int h,int ow,int oh){cols=Math.max(1,w/(int)p.getTextSize());ys=new float[cols];for(int i=0;i<cols;i++)ys[i]=r.nextInt(Math.max(1,h));}
    @Override protected void onDraw(Canvas c){super.onDraw(c);if(ys==null)return;for(int i=0;i<cols;i++){char ch=(char)('0'+r.nextInt(10));c.drawText(String.valueOf(ch),i*p.getTextSize(),ys[i],p);ys[i]+=p.getTextSize();if(ys[i]>getHeight()&&r.nextFloat()>.92f)ys[i]=0;}postInvalidateDelayed(55);}
}
