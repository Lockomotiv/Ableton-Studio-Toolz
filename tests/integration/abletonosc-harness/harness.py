#!/usr/bin/env python3
"""
AbletonOSC-Testgegenstelle für LOCK-O-MOTIV Connect Studio.

Startet den ECHTEN AbletonOSC-Code (Manager + alle Handler, gepinnter Commit,
siehe ABLETONOSC_COMMIT) ohne Ableton Live. Ersetzt werden ausschließlich:

  * das Modul `Live` und das Ableton-Framework (`ableton.v2.control_surface`,
    `_Framework`) durch minimale Stubs,
  * das Live-Objektmodell (Song, Track, ClipSlot …) durch ein In-Memory-Modell,
  * die Bind-Adresse: 127.0.0.1 statt 0.0.0.0 (der Test soll nichts im LAN öffnen),
  * Ports sind per Argument wählbar (Standard 11000/11001 wie AbletonOSC).

OSC-Parsing, Adress-Dispatch, Antwortformat und /live/error-Meldungen stammen
damit unverändert aus AbletonOSC. Das ersetzt KEINEN Test mit echtem Ableton
Live: Timing, Quantisierung und Live-spezifisches Verhalten werden nicht
nachgebildet.

Jede Zustandsänderung wird als Zeile `EVENT <json>` auf stdout ausgegeben,
damit Tests die Wirkung unabhängig vom OSC-Rückkanal prüfen können.
"""
import argparse
import contextlib
import json
import os
import sys
import time
import types

ABLETONOSC_COMMIT = "0ca68214bd62c9b5cb641ca34006cfd70ba94430"

ap = argparse.ArgumentParser()
ap.add_argument("--abletonosc", required=True, help="Pfad zum AbletonOSC-Checkout (Ordnername AbletonOSC)")
ap.add_argument("--listen-port", type=int, default=11000)
ap.add_argument("--response-port", type=int, default=11001)
ap.add_argument("--tracks", type=int, default=4)
ap.add_argument("--scenes", type=int, default=4)
args = ap.parse_args()


def emit(kind, **data):
    print("EVENT " + json.dumps({"kind": kind, **data}), flush=True)


# ------------------------------------------------------------------ Live-Objektmodell
class _Listenable:
    """Beantwortet add_X_listener / remove_X_listener / X_has_listener generisch."""

    def __getattr__(self, name):
        if name.startswith("add_") and name.endswith("_listener"):
            return lambda fn: None
        if name.startswith("remove_") and name.endswith("_listener"):
            return lambda fn: None
        if name.endswith("_has_listener"):
            return lambda fn: False
        raise AttributeError(name)


class Param(_Listenable):
    def __init__(self, owner, name, value):
        object.__setattr__(self, "_owner", owner)
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "_value", value)

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        object.__setattr__(self, "_value", float(v))
        emit("param", track=self._owner, param=self.name, value=float(v))


class MixerDevice:
    def __init__(self, idx):
        self.volume = Param(idx, "volume", 0.85)
        self.panning = Param(idx, "panning", 0.0)


class ClipSlot(_Listenable):
    def __init__(self, song, t, s, has_clip):
        self._song, self._t, self._s = song, t, s
        self.has_clip = has_clip
        self.is_playing = False
        self.is_triggered = False
        self.controls_other_clips = False
        self.is_group_slot = False
        self.playing_status = 0
        self.will_record_on_start = False
        self.has_stop_button = True
        self.clip = None

    def fire(self, *a):
        if self.has_clip:
            self.is_playing = True
            self._song.is_playing = True
            emit("clip_fire", track=self._t, slot=self._s)

    def stop(self, *a):
        self.is_playing = False


class TrackView(_Listenable):
    selected_device = None


class Track(_Listenable):
    def __init__(self, song, idx, scenes):
        self.name = f"Harness Track {idx + 1}"
        self.mixer_device = MixerDevice(idx)
        self.clip_slots = [ClipSlot(song, idx, s, has_clip=(s + idx) % 2 == 0) for s in range(scenes)]
        self.arrangement_clips = []
        self.devices = []
        self.view = TrackView()
        for p in ("arm", "mute", "solo", "is_foldable", "is_grouped", "can_be_armed", "has_midi_input"):
            setattr(self, p, False)
        self.is_visible = True
        self.has_audio_input = self.has_audio_output = True
        self.has_midi_output = False
        self.color = 0
        self.color_index = 0
        self.current_monitoring_state = 1
        self.fold_state = 0
        self.fired_slot_index = -1
        self.playing_slot_index = -1
        self.output_meter_level = self.output_meter_left = self.output_meter_right = 0.0


class Scene(_Listenable):
    def __init__(self, i):
        self.name = f"Scene {i + 1}"


class SongView(_Listenable):
    def __init__(self, song):
        self.selected_track = song.tracks[0] if song.tracks else None
        self.selected_scene = song.scenes[0] if song.scenes else None


SONG_PROPS_EMIT = {"tempo", "is_playing", "loop", "is_ableton_link_enabled"}


class Song(_Listenable):
    def __init__(self, n_tracks, n_scenes):
        self._ready = False
        self.tempo = 120.0
        self.is_playing = False
        self.loop = False
        self.loop_start = 0.0
        self.loop_length = 16.0
        self.current_song_time = 0.0
        self.metronome = False
        self.is_ableton_link_enabled = False
        self.signature_numerator = 4
        self.signature_denominator = 4
        self.can_undo = self.can_redo = False
        self.song_length = 64.0
        self.session_record = False
        self.session_record_status = 0
        self.scenes = [Scene(i) for i in range(n_scenes)]
        self.tracks = [Track(self, i, n_scenes) for i in range(n_tracks)]
        self.return_tracks = []
        self.cue_points = []
        self.view = SongView(self)
        self._ready = True

    def __setattr__(self, k, v):
        if k in ("loop", "is_ableton_link_enabled"):
            v = bool(v)  # Live speichert loop als bool
        object.__setattr__(self, k, v)
        if k in SONG_PROPS_EMIT and self.__dict__.get("_ready"):
            emit("song", prop=k, value=v)

    def start_playing(self):
        self.is_playing = True

    def continue_playing(self):
        self.is_playing = True

    def stop_playing(self):
        self.is_playing = False


SONG = Song(args.tracks, args.scenes)


# ------------------------------------------------------------------ Modul-Stubs
class _App:
    average_process_usage = 0.0

    def get_major_version(self):
        return 12

    def get_minor_version(self):
        return 1


Live = types.ModuleType("Live")
Live.Application = types.SimpleNamespace(get_application=lambda: _App())
Live.Track = types.SimpleNamespace(Track=Track)
Live.Clip = types.SimpleNamespace(MidiNoteSpecification=lambda **kw: kw)
Live.MidiMap = types.SimpleNamespace(map_midi_cc=lambda *a: None, MapMode=types.SimpleNamespace(absolute=0))
sys.modules["Live"] = Live

SCHEDULED = []


class Component:
    def __init__(self, *a, **k):
        pass

    @property
    def song(self):
        return SONG


class ControlSurface:
    def __init__(self, c_instance):
        pass

    @property
    def song(self):
        return SONG

    def schedule_message(self, delay, fn):
        SCHEDULED.append(fn)

    @contextlib.contextmanager
    def component_guard(self):
        yield

    def show_message(self, msg):
        print(f"[Live-Statuszeile] {msg}", flush=True)

    def request_rebuild_midi_map(self):
        pass

    def disconnect(self):
        pass


for name in ("ableton", "ableton.v2", "ableton.v2.control_surface", "ableton.v2.control_surface.component",
             "_Framework", "_Framework.EncoderElement"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["ableton.v2.control_surface"].ControlSurface = ControlSurface
sys.modules["ableton.v2.control_surface.component"].Component = Component
sys.modules["_Framework.EncoderElement"].EncoderElement = object

# ------------------------------------------------------------------ AbletonOSC laden
pkg_dir = os.path.abspath(args.abletonosc)
if os.path.basename(pkg_dir) != "AbletonOSC":
    sys.exit("Der Checkout-Ordner muss 'AbletonOSC' heißen (Python-Paketname).")
sys.path.insert(0, os.path.dirname(pkg_dir))

import AbletonOSC  # noqa: E402
import AbletonOSC.abletonosc.osc_server as osc_mod  # noqa: E402

osc_mod.OSC_RESPONSE_PORT = args.response_port
osc_mod.OSCServer.__init__.__defaults__ = (
    ("127.0.0.1", args.listen_port),
    ("127.0.0.1", args.response_port),
)

manager = AbletonOSC.create_instance(None)
print(f"HARNESS READY listen=127.0.0.1:{args.listen_port} response={args.response_port} "
      f"tracks={args.tracks} scenes={args.scenes} abletonosc={ABLETONOSC_COMMIT}", flush=True)

# ------------------------------------------------------------------ Live-Tick (~100 ms)
try:
    while True:
        due = SCHEDULED[:]
        SCHEDULED.clear()
        for fn in due:
            fn()
        time.sleep(0.1)
except KeyboardInterrupt:
    pass
