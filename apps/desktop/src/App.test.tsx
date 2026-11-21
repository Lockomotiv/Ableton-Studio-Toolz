// Komponententests der Oberfläche mit simuliertem Tauri-IPC.
// Diese Tests prüfen NUR die Darstellungslogik; das echte Backend wird in den
// Rust-Tests und in tests/e2e geprüft.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import App from "./App";
import { badgeState } from "./components/ConnectionBadge";
import type { AppInfo, LiveStatus, Settings } from "@lom/shared-types";

const info = (adapter: AppInfo["adapter"]): AppInfo => ({
  version: "0.1.0",
  platform: "test",
  dataDir: "/tmp/x",
  adapter,
  adapterError: null,
  oscSendPort: 11000,
  oscListenPort: 11001,
});

const status = (over: Partial<LiveStatus> = {}): LiveStatus => ({
  adapter: "mock",
  connection: "simulated",
  liveVersion: null,
  isPlaying: false,
  tempo: 120,
  loopEnabled: false,
  numTracks: 0,
  queryMs: 0,
  ...over,
});

const settings: Settings = { role: "host", defaultMode: "remote", adapter: "mock", setupCompleted: true };

describe("badgeState", () => {
  it("meldet Mock niemals als verbunden", () => {
    expect(badgeState(info("mock"), status(), null)).toBe("mock");
  });
  it("meldet Verbindung nur bei echter Antwort", () => {
    expect(badgeState(info("abletonOsc"), null, null)).toBe("checking");
    expect(badgeState(info("abletonOsc"), null, "Timeout")).toBe("disconnected");
    expect(
      badgeState(info("abletonOsc"), status({ adapter: "abletonOsc", connection: "connected" }), null),
    ).toBe("connected");
    // Status vom Mock bei gesetztem OSC-Adapter (Umschaltphase) zählt nicht als verbunden
    expect(badgeState(info("abletonOsc"), status(), null)).toBe("checking");
  });
});

describe("App", () => {
  let playing = false;
  const calls: string[] = [];

  beforeEach(() => {
    playing = false;
    calls.length = 0;
    mockIPC((cmd, args) => {
      calls.push(cmd);
      switch (cmd) {
        case "app_info":
          return info("mock");
        case "settings_get":
          return settings;
        case "daw_status":
          return status({ isPlaying: playing });
        case "daw_tracks":
          return [];
        case "daw_execute": {
          const c = (args as { command: { type: string } }).command;
          if (c.type === "play") playing = true;
          if (c.type === "stop") playing = false;
          return { command: c, adapter: "mock", verified: true, totalMs: 0.1, note: "Mock-Modus" };
        }
        default:
          return null;
      }
    });
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("startet im Mock-Modus und kennzeichnet ihn sichtbar", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("connection-badge").dataset.state).toBe("mock"));
    expect(await screen.findByTestId("mock-banner")).toBeTruthy();
  });

  it("Play/Stop aktualisiert den Transportstatus", async () => {
    render(<App />);
    const play = await screen.findByTestId("btn-play");
    await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(play);
    await waitFor(() => expect(screen.getByTestId("transport-state").textContent).toContain("Läuft"));
    fireEvent.click(screen.getByTestId("btn-stop"));
    await waitFor(() => expect(screen.getByTestId("transport-state").textContent).toContain("Gestoppt"));
    expect(calls.filter((c) => c === "daw_execute")).toHaveLength(2);
  });

  it("ungültiges Tempo wird vor dem Senden abgelehnt", async () => {
    render(<App />);
    const input = await screen.findByTestId("tempo-input");
    await waitFor(() => expect((screen.getByTestId("btn-play") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("btn-set-tempo"));
    await waitFor(() => expect(screen.getByTestId("command-log").textContent).toMatch(/BPM muss zwischen/));
    expect(calls).not.toContain("daw_execute");
  });
});
