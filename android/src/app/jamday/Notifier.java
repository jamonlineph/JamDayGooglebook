package app.jamday;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** Posts notifications and schedules reminders with AlarmManager so they fire while JamDay is closed. */
final class Notifier {
    static final String CHANNEL = "reminders";
    static final String POST = "android.permission.POST_NOTIFICATIONS";
    private static final String TAG = "JamDay";

    private Notifier() { }

    static String permission(Context c) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(POST) != PackageManager.PERMISSION_GRANTED) {
            return c.getSharedPreferences("jd", 0).getBoolean("asked", false) ? "denied" : "default";
        }
        if (Build.VERSION.SDK_INT >= 24) {
            try {
                NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
                Object on = NotificationManager.class.getMethod("areNotificationsEnabled").invoke(nm);
                if (Boolean.FALSE.equals(on)) return "denied";
            } catch (Exception ignored) { }
        }
        return "granted";
    }

    private static void ensureChannel(Context c, NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            Class<?> ch = Class.forName("android.app.NotificationChannel");
            Object channel = ch.getConstructor(String.class, CharSequence.class, int.class)
                    .newInstance(CHANNEL, c.getString(R.string.channel_name), 4 /* IMPORTANCE_HIGH */);
            ch.getMethod("setDescription", String.class).invoke(channel, c.getString(R.string.channel_desc));
            NotificationManager.class.getMethod("createNotificationChannel", ch).invoke(nm, channel);
        } catch (Exception e) {
            Log.w(TAG, "Could not create notification channel", e);
        }
    }

    @SuppressWarnings("deprecation")
    static void post(Context c, String key, String title, String body, String id) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || key == null || !"granted".equals(permission(c))) return;
        ensureChannel(c, nm);

        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (id != null && id.length() > 0) open.putExtra("openId", id);
        PendingIntent tap = PendingIntent.getActivity(c, key.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                b = (Notification.Builder) Notification.Builder.class.getConstructor(Context.class, String.class).newInstance(c, CHANNEL);
            } catch (Exception e) {
                b = new Notification.Builder(c);
            }
        } else {
            b = new Notification.Builder(c);
        }
        String text = body == null ? "" : body;
        b.setSmallIcon(R.drawable.ic_notify)
                .setColor(0xFFBC243C)
                .setContentTitle(title == null || title.length() == 0 ? "JamDay" : title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(tap)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setPriority(Notification.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis());
        nm.notify(key.hashCode(), b.build());
    }

    private static PendingIntent alarmIntent(Context c, String key, JSONObject o) {
        Intent i = new Intent(c, ReminderReceiver.class);
        i.setAction("app.jamday.REMINDER");
        i.setData(Uri.parse("jamday://reminder/" + Uri.encode(key)));
        if (o != null) {
            i.putExtra("key", key);
            i.putExtra("title", o.optString("title"));
            i.putExtra("body", o.optString("body"));
            i.putExtra("id", o.optString("id"));
        }
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Replaces every scheduled reminder with the plan from the web app: [{key, at, title, body, id}]. */
    static synchronized void schedule(Context c, String json) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        SharedPreferences sp = c.getSharedPreferences("jd", 0);
        for (String k : sp.getStringSet("alarms", Collections.<String>emptySet())) am.cancel(alarmIntent(c, k, null));
        Set<String> keep = new HashSet<String>();
        try {
            JSONArray a = new JSONArray(json);
            for (int n = 0; n < a.length(); n++) {
                JSONObject o = a.getJSONObject(n);
                String key = o.getString("key");
                long at = o.getLong("at");
                if (at <= System.currentTimeMillis()) continue;
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(c, key, o));
                keep.add(key);
            }
        } catch (JSONException e) {
            Log.w(TAG, "Bad reminder plan", e);
        }
        sp.edit().putStringSet("alarms", keep).apply();
    }

    static synchronized void markFired(Context c, String key) {
        SharedPreferences sp = c.getSharedPreferences("jd", 0);
        try {
            JSONArray a = new JSONArray(sp.getString("fired", "[]"));
            a.put(key);
            JSONArray trimmed = new JSONArray();
            for (int n = Math.max(0, a.length() - 300); n < a.length(); n++) trimmed.put(a.get(n));
            sp.edit().putString("fired", trimmed.toString()).apply();
        } catch (JSONException ignored) { }
    }

    static String firedKeys(Context c) {
        return c.getSharedPreferences("jd", 0).getString("fired", "[]");
    }
}
