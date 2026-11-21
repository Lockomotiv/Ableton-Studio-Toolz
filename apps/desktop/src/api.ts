import { invoke } from "@tauri-apps/api/core";
import type {
  AdapterKind,
  AppInfo,
  CommandOutcome,
  DawCommand,
  DiagnosticCheck,
  LiveStatus,
  MetricsSummary,
  OscErrorEvent,
  ProbeResult,
  Settings,
  TrackInfo,
} from "@lom/shared-types";
import { validateCommand } from "@lom/protocol";

/** Typisierte Wrapper um die Tauri-Kommandos aus src-tauri/src/lib.rs. */
export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  status: () => invoke<LiveStatus>("daw_status"),
  tracks: () => invoke<TrackInfo[]>("daw_tracks"),
  probe: () => invoke<ProbeResult>("daw_probe"),
  execute: (command: DawCommand) => {
    const problem = validateCommand(command);
    if (problem) return Promise.reject({ kind: "invalidArgument", message: problem });
    return invoke<CommandOutcome>("daw_execute", { command });
  },
  errors: () => invoke<OscErrorEvent[]>("daw_errors"),
  metrics: () => invoke<MetricsSummary>("daw_metrics"),
  setAdapter: (kind: AdapterKind) => invoke<AppInfo>("set_adapter", { kind }),
  diagnostics: () => invoke<DiagnosticCheck[]>("run_diagnostics"),
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSave: (settings: Settings) => invoke<Settings>("settings_save", { settings }),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Unbekannter Fehler";
}
