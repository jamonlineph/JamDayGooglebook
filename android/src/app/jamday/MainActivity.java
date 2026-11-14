package app.jamday;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * JamDay for Android: hosts the JamDay web app (bundled in assets/www) in a WebView.
 * Files are served from https://appassets.androidplatform.net/ so the app runs as a
 * secure origin (ES modules, IndexedDB) and works fully offline.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START = "https://" + HOST + "/app/index.html";
    static final int REQ_FILE = 11, REQ_SAVE = 12, REQ_NOTIF = 13;

    WebView web;
    ValueCallback<Uri[]> fileCallback;
    byte[] pendingSave;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(isNight() ? 0xFF17151A : 0xFFFAF8F6);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUserAgentString(s.getUserAgentString() + " JamDayAndroid/" + versionName());
        web.addJavascriptInterface(new Bridge(), "JamDayAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        setContentView(web);

        if (state != null) web.restoreState(state);
        if (state == null || web.getUrl() == null) web.loadUrl(startUrl(getIntent()));
    }

    String startUrl(Intent i) {
        String id = i != null ? i.getStringExtra("openId") : null;
        return START + (id != null && id.length() > 0 ? "#/open/" + Uri.encode(id) : "");
    }

    boolean isNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "1"; }
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        String id = i.getStringExtra("openId");
        if (id != null && id.length() > 0) web.evaluateJavascript("window.jamdayOpen && window.jamdayOpen(" + JSONObject.quote(id) + ")", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        // Let the web app close its top-most layer first (dialog, launcher, detail pane…).
        web.evaluateJavascript("(window.jamdayBack && window.jamdayBack()) ? 'closed' : 'none'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (v != null && v.contains("closed")) return;
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Serving the bundled web app                                         */
    /* ------------------------------------------------------------------ */

    static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }

    WebResourceResponse serve(Uri u) {
        String path = u.getPath();
        if (path == null || path.length() == 0 || path.equals("/")) path = "/index.html";
        if (path.endsWith("/")) path += "index.html";
        String type = mime(path);
        try {
            InputStream in = getAssets().open("www" + path);
            WebResourceResponse r = new WebResourceResponse(type, type.startsWith("text/") || type.contains("json") || type.contains("svg") ? "utf-8" : null, in);
            Map<String, String> h = new HashMap<String, String>();
            h.put("Cache-Control", "no-cache");
            r.setResponseHeaders(h);
            return r;
        } catch (IOException e) {
            WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream("Not found".getBytes()));
            r.setStatusCodeAndReasonPhrase(404, "Not Found");
            return r;
        }
    }

    /** Opens anything outside the app (meeting links, maps, mailto…) in the right app. */
    boolean route(Uri u) {
        if (HOST.equals(u.getHost())) return false;
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        if (scheme.equals("blob") || scheme.equals("data") || scheme.equals("about") || scheme.equals("javascript")) return true;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            return HOST.equals(u.getHost()) ? serve(u) : null;
        }

        // API 24+ (no @Override: we compile against API 23, Android still dispatches to it)
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            return route(req.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, String url) {
            return route(Uri.parse(url));
        }
    }

    class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            String type = "*/*";
            String[] types = p.getAcceptTypes();
            if (types != null && types.length == 1 && types[0] != null && types[0].contains("/")) type = types[0];
            i.setType(type);
            if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(Intent.createChooser(i, "Choose files"), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                cb.onReceiveValue(null);
                return false;
            }
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d("JamDay", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE) {
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                ClipData cd = data.getClipData();
                if (cd != null && cd.getItemCount() > 0) {
                    out = new Uri[cd.getItemCount()];
                    for (int k = 0; k < out.length; k++) out[k] = cd.getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    out = new Uri[] { data.getData() };
                }
            }
            if (fileCallback != null) fileCallback.onReceiveValue(out);
            fileCallback = null;
            return;
        }
        if (req == REQ_SAVE) {
            if (res == RESULT_OK && data != null && data.getData() != null && pendingSave != null) {
                OutputStream os = null;
                try {
                    os = getContentResolver().openOutputStream(data.getData());
                    os.write(pendingSave);
                    Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Couldn't save the file", Toast.LENGTH_LONG).show();
                } finally {
                    if (os != null) try { os.close(); } catch (IOException ignored) { }
                }
            }
            pendingSave = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        if (req == REQ_NOTIF) {
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            web.evaluateJavascript("window.jamdayPermissionResult && window.jamdayPermissionResult('" + (ok ? "granted" : "denied") + "')", null);
        }
    }

    void applyBars(int color, boolean dark) {
        Window w = getWindow();
        w.setStatusBarColor(color);
        w.setNavigationBarColor(color);
        web.setBackgroundColor(color);
        View d = w.getDecorView();
        int lightStatus = 0x00002000; // View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR (API 23)
        int lightNav = 0x00000010;    // View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR (API 26)
        int f = d.getSystemUiVisibility();
        if (dark) f &= ~(lightStatus | lightNav);
        else { f |= lightStatus; if (Build.VERSION.SDK_INT >= 26) f |= lightNav; }
        d.setSystemUiVisibility(f);
    }

    /* ------------------------------------------------------------------ */
    /* window.JamDayAndroid — called from the web app                      */
    /* ------------------------------------------------------------------ */

    class Bridge {
        @JavascriptInterface
        public String platform() { return "android"; }

        @JavascriptInterface
        public String version() { return versionName(); }

        @JavascriptInterface
        public String notificationPermission() { return Notifier.permission(MainActivity.this); }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Notifier.POST) != PackageManager.PERMISSION_GRANTED) {
                        getSharedPreferences("jd", 0).edit().putBoolean("asked", true).apply();
                        requestPermissions(new String[] { Notifier.POST }, REQ_NOTIF);
                    } else {
                        web.evaluateJavascript("window.jamdayPermissionResult && window.jamdayPermissionResult('" + Notifier.permission(MainActivity.this) + "')", null);
                    }
                }
            });
        }

        @JavascriptInterface
        public void showNotification(String key, String title, String body, String id) {
            Notifier.post(MainActivity.this, key, title, body, id);
        }

        @JavascriptInterface
        public void scheduleReminders(String json) { Notifier.schedule(MainActivity.this, json); }

        @JavascriptInterface
        public String firedKeys() { return Notifier.firedKeys(MainActivity.this); }

        @JavascriptInterface
        public void saveFile(final String name, final String mime, String base64) {
            final byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingSave = bytes;
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(mime == null || mime.length() == 0 ? "application/octet-stream" : mime);
                    i.putExtra(Intent.EXTRA_TITLE, name);
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (ActivityNotFoundException e) {
                        pendingSave = null;
                        Toast.makeText(MainActivity.this, "No app available to save files", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void setSystemBars(final String color, final boolean dark) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try { applyBars(Color.parseColor(color), dark); } catch (IllegalArgumentException ignored) { }
                }
            });
        }
    }
}
