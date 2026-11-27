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
  HostingInfo,
  TransferInfo,
  ReceivedFile,
} from "@lom/shared-types";
import { validateCommand, type HubItem, type HubProject } from "@lom/protocol";

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

  hubProjects: () => invoke<HubProject[]>("hub_projects"),
  hubProjectUpsert: (project: HubProject) => invoke<HubProject>("hub_project_upsert", { project }),
  hubItems: (projectId: string) => invoke<HubItem[]>("hub_items", { projectId }),
  hubMerge: (projectId: string, items: HubItem[]) => invoke<HubItem[]>("hub_merge", { projectId, items }),

  transferInfo: () => invoke<TransferInfo>("transfer_info"),
  transferBegin: (id: string, name: string, size: number, sha256: string) =>
    invoke<{ id: string; fileName: string; resumeOffset: number }>("transfer_begin", { id, name, size, sha256 }),
  /** Rohbytes ohne JSON-Umweg (Tauri-Binär-IPC) */
  transferWrite: (id: string, offset: number, data: Uint8Array) =>
    invoke<number>("transfer_write", data, { headers: { "x-transfer-id": id, "x-offset": String(offset) } }),
  transferFinish: (id: string) =>
    invoke<{ id: string; fileName: string; path: string; size: number; sha256: string; verified: boolean }>("transfer_finish", { id }),
  transferCancel: (id: string, keepPartial: boolean) => invoke<void>("transfer_cancel", { id, keepPartial }),
  transferList: () => invoke<ReceivedFile[]>("transfer_list"),
  transferPreview: (fileName: string) => invoke<ArrayBuffer>("transfer_preview", { fileName }),
  transferImport: (fileName: string, projectDir: string) => invoke<string>("transfer_import", { fileName, projectDir }),

  abletonoscInfo: () =>
    invoke<{ available: boolean; commit: string | null; target: string | null; installed: boolean; installedLocalOnly: boolean | null }>("abletonosc_info"),
  abletonoscInstall: (localOnly: boolean) =>
    invoke<{ target: string; backup: string | null; localOnly: boolean; commit: string; files: number }>("abletonosc_install", { localOnly }),

  hostingStart: (port: number) => invoke<HostingInfo>("hosting_start", { port }),
  hostingStop: () => invoke<HostingInfo>("hosting_stop"),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Unbekannter Fehler";
}
