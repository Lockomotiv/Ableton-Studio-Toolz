// Spracherkennung: in der App über Androids SpeechRecognizer (funktioniert auch offline, wenn das
// deutsche Sprachpaket installiert ist), im Browser über die Web Speech API (Chrome/Edge/Safari).
const N = typeof window !== 'undefined' ? window.FHNative : undefined;

export function voiceAvailable() {
  if (N && N.startVoice) return true;
  // Browser erlauben das Mikrofon nur auf sicheren Seiten (https) – auf http (z. B. iPad im Heimnetz) gar nicht erst anbieten
  return typeof window !== 'undefined' && window.isSecureContext !== false && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

let active = null;

/**
 * Startet eine Aufnahme.
 * handlers: { onPartial(text), onFinal(text), onError(msg), onLevel(0..1), onEnd() }
 */
export function listen(handlers) {
  stop();
  const h = { onPartial() {}, onFinal() {}, onError() {}, onLevel() {}, onEnd() {}, ...handlers };
  if (N && N.startVoice) {
    window.__fhVoice = (type, payload) => {
      if (type === 'partial') h.onPartial(payload);
      else if (type === 'final') h.onFinal(payload);
      else if (type === 'error') h.onError(errorText(payload));
      else if (type === 'level') h.onLevel(Number(payload) || 0);
      else if (type === 'end') { active = null; h.onEnd(); }
    };
    active = { native: true };
    N.startVoice();
    return active;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { h.onError('Spracheingabe wird von diesem Browser nicht unterstützt. Bitte tippen.'); h.onEnd(); return null; }
  const r = new SR();
  r.lang = 'de-DE'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let finalText = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
    }
    if (interim) h.onPartial(finalText + interim);
    h.onLevel(Math.random() * 0.6 + 0.3);
  };
  r.onerror = (e) => h.onError(errorText(e.error));
  r.onend = () => { if (finalText) h.onFinal(finalText.trim()); active = null; h.onEnd(); };
  r.start();
  active = { web: r };
  return active;
}

export function stop() {
  if (!active) return;
  if (active.native && N) N.stopVoice();
  if (active.web) try { active.web.stop(); } catch { /* egal */ }
}
export function cancel() {
  if (!active) return;
  if (active.native && N) (N.cancelVoice || N.stopVoice).call(N);
  if (active.web) try { active.web.abort(); } catch { /* egal */ }
  active = null;
}

function errorText(code) {
  const map = {
    'no-speech': 'Ich habe nichts gehört. Einfach nochmal versuchen.',
    'no-match': 'Das habe ich nicht verstanden. Bitte nochmal.',
    'not-allowed': 'Kein Zugriff aufs Mikrofon. Bitte in den Einstellungen erlauben.',
    'permission': 'Kein Zugriff aufs Mikrofon. Bitte in den Einstellungen erlauben.',
    'network': 'Spracherkennung braucht gerade Internet. Tipp: Offline-Sprachpaket „Deutsch“ in Android installieren.',
    'audio-capture': 'Kein Mikrofon gefunden.',
    'busy': 'Spracherkennung ist beschäftigt. Gleich nochmal versuchen.',
    'unavailable': 'Auf diesem Gerät ist keine Spracherkennung installiert (Google-App bzw. „Speech Services by Google“).',
    'aborted': '',
    'service-not-allowed': 'Spracheingabe ist hier nicht verfügbar – einfach die Diktier-Taste 🎤 der Tastatur nutzen.',
    'language-not-supported': 'Deutsch ist für die Spracheingabe nicht verfügbar – bitte die Diktier-Taste der Tastatur nutzen.',
  };
  return map[code] ?? 'Spracheingabe fehlgeschlagen (' + code + ').';
}
