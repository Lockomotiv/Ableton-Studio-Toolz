package de.familyhub.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (c.getSharedPreferences("familyhub", Context.MODE_PRIVATE).getBoolean("child", false)) return;
        Reminders.ensureChannel(c);
        String title = i.getStringExtra("title");
        String body = i.getStringExtra("body");
        PendingIntent open = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class).putExtra("action", "heute"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, "reminders")
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(c.getColor(R.color.icon_bg))
                .setContentTitle(title == null || title.isEmpty() ? "FamilyHub" : title)
                .setContentText(body == null ? "" : body)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(open)
                .build();
        try { c.getSystemService(NotificationManager.class).notify(7000 + i.getIntExtra("slot", 0), n); } catch (SecurityException ignored) { }
    }
}
