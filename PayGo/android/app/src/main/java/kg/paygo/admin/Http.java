package kg.paygo.admin;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class Http {
    public static final class Result {
        public final int code; public final String body; public final long ms; public final String error;
        Result(int c, String b, long m, String e) { code=c; body=b; ms=m; error=e; }
        public boolean ok(){ return code >= 200 && code < 300; }
    }
    private Http() {}
    public static Result json(Context c, String method, String url, JSONObject body) {
        long t=System.currentTimeMillis(); HttpURLConnection h=null;
        try {
            h=(HttpURLConnection)new URL(url).openConnection();
            int timeout=Math.max(1000, Prefs.timeoutSec(c)*1000);
            h.setConnectTimeout(timeout); h.setReadTimeout(timeout); h.setRequestMethod(method);
            h.setRequestProperty("Accept","application/json"); h.setRequestProperty("Content-Type","application/json; charset=utf-8");
            String token=Prefs.token(c); if(!token.isEmpty()) h.setRequestProperty("X-Device-Token", token);
            if(body!=null){ h.setDoOutput(true); byte[] b=body.toString().getBytes(StandardCharsets.UTF_8); try(OutputStream os=h.getOutputStream()){os.write(b);} }
            int code=h.getResponseCode(); InputStream is=code>=400?h.getErrorStream():h.getInputStream();
            String text=is==null?"":read(is); return new Result(code,text,System.currentTimeMillis()-t,null);
        } catch(Exception e){ return new Result(-1,"",System.currentTimeMillis()-t,e.toString()); }
        finally { if(h!=null)h.disconnect(); }
    }
    public static Result get(Context c, String url, String param, String value) {
        long t=System.currentTimeMillis(); HttpURLConnection h=null;
        try {
            String fullUrl=url+(url.contains("?")?("&"):("?"))+param+"="+java.net.URLEncoder.encode(value,"UTF-8");
            h=(HttpURLConnection)new URL(fullUrl).openConnection();
            int timeout=Math.max(1000, Prefs.timeoutSec(c)*1000);
            h.setConnectTimeout(timeout); h.setReadTimeout(timeout); h.setRequestMethod("GET");
            h.setRequestProperty("Accept","application/json");
            String token=Prefs.token(c); if(!token.isEmpty()) h.setRequestProperty("X-Device-Token", token);
            int code=h.getResponseCode(); InputStream is=code>=400?h.getErrorStream():h.getInputStream();
            String text=is==null?"":read(is); return new Result(code,text,System.currentTimeMillis()-t,null);
        } catch(Exception e){ return new Result(-1,"",System.currentTimeMillis()-t,e.toString()); }
        finally { if(h!=null)h.disconnect(); }
    }
    private static String read(InputStream in)throws IOException { ByteArrayOutputStream o=new ByteArrayOutputStream(); byte[] b=new byte[4096]; int n; while((n=in.read(b))>0)o.write(b,0,n); return o.toString("UTF-8"); }
}
