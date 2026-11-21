package de.familyhub.app;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/** Plant Erinnerungen mit echtem Titel. Die Oberfläche liefert immer die komplette Liste der nächsten 30 Tage. */
final class Reminders {
    private Reminders() { }
    private static final int BASE = 5000;

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("familyhub-reminders", Context.MODE_PRIVATE); }

    static PendingIntent intent(Context c, int slot, JSONObject item) {
        Intent i = new Intent(c, ReminderReceiver.class).putExtra("slot", slot);
        if (item != null) i.putExtra("title", item.optString("title")).putExtra("body", item.optString("body"));
        return PendingIntent.getBroadcast(c, BASE + slot, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void clear(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        int n = prefs(c).getInt("count", 0);
        for (int i = 0; i < n; i++) am.cancel(intent(c, i, null));
        prefs(c).edit().clear().apply();
    }

    static void replace(Context c, String json) {
        try {
            JSONArray items = new JSONArray(json);
            int old = prefs(c).getInt("count", 0);
            AlarmManager am = c.getSystemService(AlarmManager.class);
            for (int i = items.length(); i < old; i++) am.cancel(intent(c, i, null));
            prefs(c).edit().putString("items", items.toString()).putInt("count", items.length()).apply();
            schedule(c, items);
        } catch (Exception ignored) { }
    }

    static void restore(Context c) {
        try { schedule(c, new JSONArray(prefs(c).getString("items", "[]"))); } catch (Exception ignored) { }
    }

    private static void schedule(Context c, JSONArray items) throws Exception {
        if (c.getSharedPreferences("familyhub", Context.MODE_PRIVATE).getBoolean("child", false)) return;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        long now = System.currentTimeMillis();
        for (int i = 0; i < items.length() && i < 150; i++) {
            JSONObject it = items.getJSONObject(i);
            long at = it.getLong("at");
            if (at <= now || at > now + 45L * 86400000L) { am.cancel(intent(c, i, null)); continue; }
            PendingIntent pi = intent(c, i, it);
            // Genaue Wecker brauchen eine Sonderfreigabe; ohne sie plant Android mit wenigen Minuten Spielraum.
            if (android.os.Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setWindow(AlarmManager.RTC_WAKEUP, at, 60_000, pi);
            else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    static void ensureChannel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        android.app.NotificationChannel ch = new android.app.NotificationChannel("reminders", "Erinnerungen", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Termine und Aufgaben aus FamilyHub");
        nm.createNotificationChannel(ch);
    }
}
