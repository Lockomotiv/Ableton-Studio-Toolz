package de.familyhub.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Startbildschirm-Widget: heutige Termine, fällige Aufgaben und eine Mikrofon-Taste. */
public class FamilyWidget extends AppWidgetProvider {
    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, FamilyWidget.class));
        for (int id : ids) update(c, m, id);
    }

    private static PendingIntent launch(Context c, String action, int code) {
        Intent i = new Intent(c, MainActivity.class).setAction(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void update(Context c, AppWidgetManager m, int id) {
        SharedPreferences p = c.getSharedPreferences("familyhub", Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        String lines = "App öffnen, um den Stand zu laden";
        String foot = "";
        try {
            String raw = p.getString("widget", null);
            if (raw != null) {
                JSONObject o = new JSONObject(raw);
                StringBuilder sb = new StringBuilder();
                JSONArray ls = o.optJSONArray("lines");
                if (ls != null) for (int i = 0; i < ls.length(); i++) sb.append(sb.length() > 0 ? "\n" : "").append(ls.getString(i));
                JSONArray tp = o.optJSONArray("tasksPreview");
                if (tp != null) for (int i = 0; i < tp.length() && i < 2; i++) sb.append(sb.length() > 0 ? "\n" : "").append("☐ ").append(tp.getString(i));
                lines = sb.length() > 0 ? sb.toString() : "Heute ist nichts geplant 🌤";
                int tasks = o.optInt("tasks"), shop = o.optInt("shopping");
                foot = tasks + (tasks == 1 ? " Aufgabe fällig" : " Aufgaben fällig") + " · " + shop + " auf der Einkaufsliste · " + new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new Date(o.optLong("updated")));
                if (o.optBoolean("child")) foot = "";
            }
        } catch (Exception ignored) { }
        v.setTextViewText(R.id.w_lines, lines);
        v.setTextViewText(R.id.w_foot, foot);
        v.setViewVisibility(R.id.w_foot, foot.isEmpty() ? View.GONE : View.VISIBLE);
        v.setOnClickPendingIntent(R.id.w_root, launch(c, Intent.ACTION_MAIN, 100 + id));
        v.setOnClickPendingIntent(R.id.w_mic, launch(c, "de.familyhub.app.VOICE", 200 + id));
        v.setOnClickPendingIntent(R.id.w_add, launch(c, "de.familyhub.app.ADD", 300 + id));
        m.updateAppWidget(id, v);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { for (int id : ids) update(c, m, id); }
}
