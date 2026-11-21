package de.familyhub.app;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Locale;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.SSLException;

/** Alles, was die Weboberfläche vom Handy braucht. Erreichbar als window.FHNative. */
public class NativeBridge {
    private final MainActivity a;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean ttsReady;
    private String pendingSpeak;
    private String launchAction = "";
    private String pendingSaveText;

    NativeBridge(MainActivity a) { this.a = a; }

    void setLaunchAction(String s) { launchAction = s == null ? "" : s; }

    // ---------------- Allgemein ----------------
    @JavascriptInterface
    public String info() {
        try {
            JSONObject o = new JSONObject();
            o.put("platform", "android");
            o.put("version", a.getPackageManager().getPackageInfo(a.getPackageName(), 0).versionName);
            o.put("device", Build.MODEL);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("voice", SpeechRecognizer.isRecognitionAvailable(a));
            return o.toString();
        } catch (Exception e) { return "{\"platform\":\"android\"}"; }
    }

    @JavascriptInterface
    public String consumeLaunchAction() { String s = launchAction; launchAction = ""; return s; }

    @JavascriptInterface
    public void openUrl(String url) {
        Uri u = Uri.parse(url);
        String sc = u.getScheme();
        if (!"https".equals(sc) && !"http".equals(sc) && !"webcal".equals(sc)) return;
        a.runOnUiThread(() -> {
            try { a.startActivity(new Intent(Intent.ACTION_VIEW, u)); }
            catch (ActivityNotFoundException e) { Toast.makeText(a, "Keine passende App gefunden", Toast.LENGTH_SHORT).show(); }
        });
    }

    @JavascriptInterface
    public boolean openApp(String pkg) {
        Intent i = a.getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) return false;
        a.runOnUiThread(() -> a.startActivity(i));
        return true;
    }

    @JavascriptInterface
    public void haptic(String kind) {
        Vibrator v = a.getSystemService(Vibrator.class);
        if (v == null || !v.hasVibrator()) return;
        if ("success".equals(kind)) v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK));
        else v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK));
    }

    @JavascriptInterface
    public void share(String text) {
        a.runOnUiThread(() -> a.startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Teilen")));
    }

    @JavascriptInterface
    public void copy(String text) {
        ClipboardManager cm = a.getSystemService(ClipboardManager.class);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("FamilyHub", text));
    }

    @JavascriptInterface
    public void moveToBack() { a.runOnUiThread(() -> a.moveTaskToBack(true)); }

    @JavascriptInterface
    public void requestNotifications() { a.runOnUiThread(a::requestNotify); }

    @JavascriptInterface
    public void setChildLock(boolean on) {
        a.getSharedPreferences("familyhub", Context.MODE_PRIVATE).edit().putBoolean("child", on).apply();
        if (on) Reminders.clear(a);
        FamilyWidget.refresh(a);
    }

    // ---------------- HTTP ohne CORS ----------------
    @JavascriptInterface
    public void http(String id, String reqJson) {
        pool.execute(() -> {
            JSONObject res = new JSONObject();
            HttpURLConnection c = null;
            try {
                JSONObject req = new JSONObject(reqJson);
                URL url = new URL(req.getString("url"));
                if (!"https".equals(url.getProtocol()) && !"http".equals(url.getProtocol())) throw new IllegalArgumentException("Nur http/https");
                int timeout = Math.max(1000, Math.min(60000, req.optInt("timeout", 8000)));
                c = (HttpURLConnection) url.openConnection();
                c.setConnectTimeout(Math.min(timeout, 6000));
                c.setReadTimeout(timeout);
                c.setInstanceFollowRedirects(false);
                c.setUseCaches(false);
                String method = req.optString("method", "GET");
                c.setRequestMethod(method);
                c.setRequestProperty("Accept", "application/json, text/html;q=0.8, */*;q=0.5");
                JSONObject headers = req.optJSONObject("headers");
                if (headers != null) for (Iterator<String> it = headers.keys(); it.hasNext(); ) { String k = it.next(); c.setRequestProperty(k, headers.getString(k)); }
                if (!req.isNull("body")) {
                    byte[] body = req.getString("body").getBytes(StandardCharsets.UTF_8);
                    c.setDoOutput(true);
                    if (c.getRequestProperty("Content-Type") == null) c.setRequestProperty("Content-Type", "application/json");
                    c.setFixedLengthStreamingMode(body.length);
                    try (OutputStream os = c.getOutputStream()) { os.write(body); }
                }
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                String text = "";
                if (in != null) {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192]; int n;
                    while ((n = in.read(buf)) != -1) { bo.write(buf, 0, n); if (bo.size() > 8 * 1024 * 1024) throw new IllegalStateException("Antwort zu groß"); }
                    in.close();
                    text = bo.toString("UTF-8");
                }
                res.put("status", code);
                res.put("body", text);
                JSONObject h = new JSONObject();
                for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) if (e.getKey() != null && !e.getValue().isEmpty()) h.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue().get(0));
                res.put("headers", h);
            } catch (Exception e) {
                try {
                    String kind = e instanceof SSLException ? "ssl" : e instanceof UnknownHostException ? "dns" : e instanceof SocketTimeoutException ? "timeout" : e instanceof ConnectException ? "connect" : "other";
                    res.put("error", kind.equals("ssl") ? "Zertifikat wird nicht vertraut" : kind.equals("dns") ? "Name nicht gefunden" : kind.equals("timeout") ? "Zeitüberschreitung" : kind.equals("connect") ? "Nicht erreichbar" : String.valueOf(e.getMessage()));
                    res.put("kind", kind);
                } catch (Exception ignored) { }
            } finally { if (c != null) c.disconnect(); }
            a.js("window.__fhNativeCb(" + JSONObject.quote(id) + "," + JSONObject.quote(res.toString()) + ")");
        });
    }

    // ---------------- Spracherkennung ----------------
    void voiceEvent(String type, String payload) {
        a.js("window.__fhVoice&&__fhVoice(" + JSONObject.quote(type) + "," + JSONObject.quote(payload == null ? "" : payload) + ")");
    }

    private Intent speechIntent() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE");
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "de-DE");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Was steht an?");
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, a.getPackageName());
        return i;
    }

    @JavascriptInterface
    public void startVoice() {
        a.runOnUiThread(() -> {
            if (!a.ensureAudio()) return; // wird nach der Freigabe erneut aufgerufen
            if (!SpeechRecognizer.isRecognitionAvailable(a)) { fallbackSpeechActivity(); return; }
            destroyRecognizer();
            recognizer = SpeechRecognizer.createSpeechRecognizer(a);
            recognizer.setRecognitionListener(new RecognitionListener() {
                boolean done = false;
                @Override public void onReadyForSpeech(Bundle b) { voiceEvent("ready", ""); }
                @Override public void onBeginningOfSpeech() { }
                @Override public void onRmsChanged(float rms) { voiceEvent("level", String.valueOf(Math.max(0, Math.min(1, (rms + 2) / 12f)))); }
                @Override public void onBufferReceived(byte[] buffer) { }
                @Override public void onEndOfSpeech() { }
                @Override public void onError(int error) {
                    if (done) return; done = true;
                    // Kein Dienst / Sprache fehlt → Google-Spracheingabe als Dialog versuchen
                    if (error == SpeechRecognizer.ERROR_CLIENT || error == 12 || error == 13 || error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED) { destroyRecognizer(); fallbackSpeechActivity(); return; }
                    voiceEvent("error", errorCode(error));
                    voiceEvent("end", "");
                }
                @Override public void onResults(Bundle b) {
                    if (done) return; done = true;
                    ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (r != null && !r.isEmpty()) voiceEvent("final", r.get(0));
                    else voiceEvent("error", "no-match");
                    voiceEvent("end", "");
                }
                @Override public void onPartialResults(Bundle b) {
                    ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (r != null && !r.isEmpty() && !r.get(0).isEmpty()) voiceEvent("partial", r.get(0));
                }
                @Override public void onEvent(int t, Bundle b) { }
            });
            recognizer.startListening(speechIntent());
        });
    }

    private void fallbackSpeechActivity() {
        try {
            Intent i = speechIntent();
            i.removeExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS);
            a.startActivityForResult(i, MainActivity.REQ_SPEECH);
        } catch (ActivityNotFoundException e) {
            voiceEvent("error", "unavailable");
            voiceEvent("end", "");
        }
    }

    void onSpeechActivityResult(int result, Intent data) {
        if (result == MainActivity.RESULT_OK && data != null) {
            ArrayList<String> r = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (r != null && !r.isEmpty()) voiceEvent("final", r.get(0));
        }
        voiceEvent("end", "");
    }

    private static String errorCode(int e) {
        switch (e) {
            case SpeechRecognizer.ERROR_NO_MATCH: return "no-match";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "no-speech";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "permission";
            case SpeechRecognizer.ERROR_NETWORK: case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "network";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "busy";
            case SpeechRecognizer.ERROR_AUDIO: return "audio-capture";
            default: return "error-" + e;
        }
    }

    @JavascriptInterface
    public void stopVoice() { a.runOnUiThread(() -> { if (recognizer != null) recognizer.stopListening(); }); }

    @JavascriptInterface
    public void cancelVoice() { a.runOnUiThread(this::destroyRecognizer); }

    private void destroyRecognizer() {
        if (recognizer != null) { try { recognizer.cancel(); recognizer.destroy(); } catch (Exception ignored) { } recognizer = null; }
    }

    @JavascriptInterface
    public void speak(String text) {
        a.runOnUiThread(() -> {
            if (tts == null) {
                pendingSpeak = text;
                tts = new TextToSpeech(a, status -> {
                    ttsReady = status == TextToSpeech.SUCCESS;
                    if (ttsReady) { tts.setLanguage(Locale.GERMANY); if (pendingSpeak != null) tts.speak(pendingSpeak, TextToSpeech.QUEUE_FLUSH, null, "fh"); pendingSpeak = null; }
                });
            } else if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "fh");
        });
    }

    // ---------------- Erinnerungen & Widget ----------------
    @JavascriptInterface
    public void scheduleReminders(String json) {
        if (a.getSharedPreferences("familyhub", Context.MODE_PRIVATE).getBoolean("child", false)) { Reminders.clear(a); return; }
        Reminders.replace(a, json);
    }

    @JavascriptInterface
    public void updateWidget(String json) {
        a.getSharedPreferences("familyhub", Context.MODE_PRIVATE).edit().putString("widget", json).apply();
        FamilyWidget.refresh(a);
    }

    // ---------------- Dateien (Sicherung) ----------------
    @JavascriptInterface
    public void saveFile(String name, String text) {
        pendingSaveText = text;
        a.runOnUiThread(() -> a.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, name), MainActivity.REQ_SAVE));
    }

    void onSaveResult(int result, Intent data) {
        if (result != MainActivity.RESULT_OK || data == null || pendingSaveText == null) return;
        try (OutputStream os = a.getContentResolver().openOutputStream(data.getData())) {
            os.write(pendingSaveText.getBytes(StandardCharsets.UTF_8));
            Toast.makeText(a, "Sicherung gespeichert", Toast.LENGTH_SHORT).show();
        } catch (Exception e) { Toast.makeText(a, "Speichern fehlgeschlagen", Toast.LENGTH_SHORT).show(); }
        pendingSaveText = null;
    }

    @JavascriptInterface
    public void pickFile() {
        a.runOnUiThread(() -> a.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), MainActivity.REQ_OPEN));
    }

    void onOpenResult(int result, Intent data) {
        String txt = null;
        if (result == MainActivity.RESULT_OK && data != null) {
            try (InputStream in = a.getContentResolver().openInputStream(data.getData())) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192]; int n;
                while ((n = in.read(buf)) != -1) { bo.write(buf, 0, n); if (bo.size() > 10 * 1024 * 1024) break; }
                txt = bo.toString("UTF-8");
            } catch (Exception ignored) { }
        }
        a.js("window.__fhFile&&__fhFile(" + (txt == null ? "null" : JSONObject.quote(txt)) + ")");
    }

    void destroy() {
        destroyRecognizer();
        if (tts != null) tts.shutdown();
        pool.shutdownNow();
    }
}
