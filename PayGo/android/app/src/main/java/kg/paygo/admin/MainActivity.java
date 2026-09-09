package kg.paygo.admin;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.net.URISyntaxException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Single full-screen WebView that hosts the PayGo mobile admin panel.
 */
public class MainActivity extends Activity {

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_CAMERA_PERMISSION_FOR_CHOOSER = 1002;
    private static final int REQ_CAMERA_PERMISSION_FOR_PAGE = 1003;

    private static final String CAPTURE_DIR = "captures";
    private static final long CAPTURE_MAX_AGE_MS = 24L * 60 * 60 * 1000;

    private WebView webView;
    private View splashView;
    private View offlineView;
    private Button retryButton;

    /** Pending <input type=file> callback and its parameters. */
    private ValueCallback<Uri[]> filePathCallback;
    private WebChromeClient.FileChooserParams pendingChooserParams;
    /** FileProvider URI handed to the camera app for the current capture. */
    private Uri cameraOutputUri;

    /** getUserMedia()-style permission request waiting for the Android CAMERA permission. */
    private PermissionRequest pendingPagePermission;

    private boolean mainFrameError;
    private boolean splashDismissed;

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(false);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        splashView = findViewById(R.id.splash);
        offlineView = findViewById(R.id.offline);
        retryButton = findViewById(R.id.retry);
        retryButton.setOnClickListener(v -> retry());

        configureWebView();
        cleanupOldCaptures();

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(AppConfig.START_URL);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        finishFileChooser(null);
        pendingPagePermission = null;
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    // ------------------------------------------------------------------ WebView setup

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);

        // The web app handles its own layout: honour its viewport meta tag, no zoom.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);

        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setGeolocationEnabled(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + AppConfig.USER_AGENT_SUFFIX);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppWebChromeClient());
        webView.setDownloadListener(this::onDownloadRequested);
    }

    private void retry() {
        mainFrameError = false;
        retryButton.setEnabled(false);
        retryButton.setText(R.string.retrying);
        if (webView == null) return;
        String current = webView.getUrl();
        if (current == null || current.isEmpty() || "about:blank".equals(current)) {
            webView.loadUrl(AppConfig.START_URL);
        } else {
            webView.reload();
        }
    }

    private void showOffline() {
        dismissSplash();
        retryButton.setEnabled(true);
        retryButton.setText(R.string.retry);
        offlineView.setVisibility(View.VISIBLE);
    }

    private void hideOffline() {
        if (offlineView.getVisibility() != View.GONE) {
            offlineView.setVisibility(View.GONE);
            retryButton.setEnabled(true);
            retryButton.setText(R.string.retry);
        }
    }

    private void dismissSplash() {
        if (splashDismissed) return;
        splashDismissed = true;
        splashView.animate()
                .alpha(0f)
                .setDuration(200)
                .withEndAction(() -> splashView.setVisibility(View.GONE))
                .start();
    }

    // ------------------------------------------------------------------ navigation

    private class AppWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            mainFrameError = false;
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (!mainFrameError) hideOffline();
            dismissSplash();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!mainFrameError) hideOffline();
            dismissSplash();
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                mainFrameError = true;
                showOffline();
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view != webView) return false;
            // The renderer died: drop the dead WebView and rebuild the screen from scratch.
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.destroy();
            webView = null;
            recreate();
            return true;
        }
    }

    /** @return true if the URL was handled outside the WebView. */
    private boolean handleUrl(Uri uri) {
        if (uri == null || uri.getScheme() == null) return false;
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        if ("https".equals(scheme) || "http".equals(scheme)) {
            if (AppConfig.isAppHost(uri)) return false; // stay inside the app
            openExternal(uri);
            return true;
        }
        if ("about".equals(scheme) || "blob".equals(scheme) || "data".equals(scheme)
                || "javascript".equals(scheme)) {
            return false;
        }
        // tel:, mailto:, tg://, whatsapp:, intent:, market:, ... -> system apps
        openExternal(uri);
        return true;
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        Intent intent;
        try {
            if ("intent".equals(scheme)) {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
            } else if ("tel".equals(scheme)) {
                intent = new Intent(Intent.ACTION_DIAL, uri);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, uri);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (URISyntaxException e) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        } catch (ActivityNotFoundException | SecurityException e) {
            String fallback = null;
            if ("intent".equals(scheme)) {
                try {
                    fallback = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                            .getStringExtra("browser_fallback_url");
                } catch (URISyntaxException ignored) {
                    // no fallback available
                }
            }
            if (fallback != null && !fallback.isEmpty()) {
                Uri fallbackUri = Uri.parse(fallback);
                if (AppConfig.isAppHost(fallbackUri) && webView != null) {
                    webView.loadUrl(fallback);
                } else if (!"intent".equalsIgnoreCase(String.valueOf(fallbackUri.getScheme()))) {
                    openExternal(fallbackUri);
                }
                return;
            }
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------ file chooser / permissions

    private class AppWebChromeClient extends WebChromeClient {

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            // Cancel a chooser that is somehow still pending so the page is not left hanging.
            finishFileChooser(null);
            filePathCallback = callback;
            pendingChooserParams = params;

            if (params != null && params.isCaptureEnabled() && acceptsImages(params)) {
                // <input type=file accept="image/*" capture> -> open the camera directly.
                if (hasPermission(Manifest.permission.CAMERA)) {
                    launchCamera();
                } else {
                    requestPermissions(new String[]{Manifest.permission.CAMERA},
                            REQ_CAMERA_PERMISSION_FOR_CHOOSER);
                }
            } else {
                launchChooser(params);
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            handlePagePermissionRequest(request);
        }
    }

    private boolean hasPermission(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean acceptsImages(WebChromeClient.FileChooserParams params) {
        if (params == null) return true;
        String[] accept = params.getAcceptTypes();
        if (accept == null || accept.length == 0) return true;
        boolean any = false;
        for (String raw : accept) {
            if (raw == null) continue;
            for (String type : raw.split(",")) {
                String t = type.trim().toLowerCase(Locale.ROOT);
                if (t.isEmpty()) continue;
                any = true;
                if (t.startsWith("image/") || t.equals("*/*")
                        || t.equals(".jpg") || t.equals(".jpeg") || t.equals(".png")
                        || t.equals(".webp") || t.equals(".heic")) {
                    return true;
                }
            }
        }
        return !any;
    }

    /** Converts the accept list of an input element into MIME types for ACTION_GET_CONTENT. */
    private static String[] toMimeTypes(WebChromeClient.FileChooserParams params) {
        List<String> result = new ArrayList<>();
        String[] accept = params == null ? null : params.getAcceptTypes();
        if (accept != null) {
            for (String raw : accept) {
                if (raw == null) continue;
                for (String type : raw.split(",")) {
                    String t = type.trim().toLowerCase(Locale.ROOT);
                    if (t.isEmpty()) continue;
                    if (t.startsWith(".")) {
                        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(t.substring(1));
                        if (mime != null && !result.contains(mime)) result.add(mime);
                    } else if (t.contains("/") && !result.contains(t)) {
                        result.add(t);
                    }
                }
            }
        }
        if (result.isEmpty()) result.add("*/*");
        return result.toArray(new String[0]);
    }

    private void launchCamera() {
        Intent camera = buildCameraIntent();
        if (camera == null) {
            launchChooser(pendingChooserParams);
            return;
        }
        try {
            startActivityForResult(camera, REQ_FILE_CHOOSER);
        } catch (ActivityNotFoundException e) {
            cameraOutputUri = null;
            launchChooser(pendingChooserParams);
        }
    }

    private void launchChooser(WebChromeClient.FileChooserParams params) {
        Intent content = new Intent(Intent.ACTION_GET_CONTENT);
        content.addCategory(Intent.CATEGORY_OPENABLE);
        String[] mimeTypes = toMimeTypes(params);
        content.setType(mimeTypes.length == 1 ? mimeTypes[0] : "*/*");
        if (mimeTypes.length > 1) content.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        if (params != null && params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            content.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }

        Intent chooser = Intent.createChooser(content, getString(R.string.chooser_title));
        cameraOutputUri = null;
        if (acceptsImages(params) && hasPermission(Manifest.permission.CAMERA)) {
            Intent camera = buildCameraIntent();
            if (camera != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        try {
            startActivityForResult(chooser, REQ_FILE_CHOOSER);
        } catch (ActivityNotFoundException e) {
            cameraOutputUri = null;
            finishFileChooser(null);
        }
    }

    /** Builds an ACTION_IMAGE_CAPTURE intent writing into the app cache through the FileProvider. */
    private Intent buildCameraIntent() {
        File dir = new File(getCacheDir(), CAPTURE_DIR);
        if (!dir.exists() && !dir.mkdirs()) return null;
        String name = "IMG_" + new SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(new Date()) + ".jpg";
        Uri uri;
        try {
            uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", new File(dir, name));
        } catch (IllegalArgumentException e) {
            return null;
        }
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        intent.setClipData(ClipData.newRawUri("", uri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        for (ResolveInfo info : getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)) {
            grantUriPermission(info.activityInfo.packageName, uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        }
        cameraOutputUri = uri;
        return intent;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            ClipData clip = data == null ? null : data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                List<Uri> uris = new ArrayList<>();
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u != null) uris.add(u);
                }
                if (!uris.isEmpty()) result = uris.toArray(new Uri[0]);
            } else if (data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            } else if (cameraOutputUri != null) {
                result = new Uri[]{cameraOutputUri};
            }
        }
        if (cameraOutputUri != null && (result == null || !cameraOutputUri.equals(result[0]))) {
            deleteCapture(cameraOutputUri);
        }
        cameraOutputUri = null;
        finishFileChooser(result);
    }

    private void finishFileChooser(Uri[] result) {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
        }
        pendingChooserParams = null;
    }

    private void deleteCapture(Uri uri) {
        try {
            getContentResolver().delete(uri, null, null);
        } catch (RuntimeException ignored) {
            // best effort
        }
    }

    private void cleanupOldCaptures() {
        File[] files = new File(getCacheDir(), CAPTURE_DIR).listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - CAPTURE_MAX_AGE_MS;
        for (File f : files) {
            if (f.lastModified() < cutoff) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_CAMERA_PERMISSION_FOR_CHOOSER) {
            if (filePathCallback == null) return;
            if (granted) {
                launchCamera();
            } else {
                Toast.makeText(this, R.string.camera_permission_denied, Toast.LENGTH_SHORT).show();
                launchChooser(pendingChooserParams);
            }
        } else if (requestCode == REQ_CAMERA_PERMISSION_FOR_PAGE) {
            PermissionRequest request = pendingPagePermission;
            pendingPagePermission = null;
            if (request != null) resolvePagePermission(request);
        } else {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        }
    }

    /** Page asked for camera/microphone (getUserMedia). Grant what the app itself is allowed to use. */
    private void handlePagePermissionRequest(PermissionRequest request) {
        boolean wantsCamera = false;
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) wantsCamera = true;
        }
        if (wantsCamera && !hasPermission(Manifest.permission.CAMERA)) {
            if (pendingPagePermission != null) pendingPagePermission.deny();
            pendingPagePermission = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERMISSION_FOR_PAGE);
            return;
        }
        resolvePagePermission(request);
    }

    private void resolvePagePermission(PermissionRequest request) {
        List<String> granted = new ArrayList<>();
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && hasPermission(Manifest.permission.CAMERA)) {
                granted.add(res);
            } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                    && hasPermission(Manifest.permission.RECORD_AUDIO)) {
                granted.add(res);
            }
        }
        try {
            if (granted.isEmpty()) {
                request.deny();
            } else {
                request.grant(granted.toArray(new String[0]));
            }
        } catch (IllegalStateException ignored) {
            // request already handled or the page went away
        }
    }

    // ------------------------------------------------------------------ downloads

    private void onDownloadRequested(String url, String userAgent, String contentDisposition,
                                     String mimeType, long contentLength) {
        if (!URLUtil.isNetworkUrl(url)) {
            // blob:/data: URLs cannot be handed to DownloadManager.
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            if (mimeType != null) request.setMimeType(mimeType);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) request.addRequestHeader("Cookie", cookies);
            if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
            request.setTitle(fileName);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            } else {
                request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
            }
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) throw new IllegalStateException("DownloadManager unavailable");
            dm.enqueue(request);
            Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
        }
    }
}
