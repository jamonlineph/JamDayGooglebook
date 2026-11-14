package app.jamday;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires a scheduled reminder, even when JamDay isn't running. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String key = i.getStringExtra("key");
        if (key == null) return;
        Notifier.markFired(c, key);
        Notifier.post(c, key, i.getStringExtra("title"), i.getStringExtra("body"), i.getStringExtra("id"));
    }
}
