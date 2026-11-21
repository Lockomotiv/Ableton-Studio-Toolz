import type { AppInfo, LiveStatus } from "@lom/shared-types";

export type BadgeState = "mock" | "connected" | "disconnected" | "checking";

export function badgeState(info: AppInfo | null, status: LiveStatus | null, statusError: string | null): BadgeState {
  if (!info) return "checking";
  if (info.adapter === "mock") return "mock";
  if (status && status.adapter === "abletonOsc" && status.connection === "connected") return "connected";
  if (statusError) return "disconnected";
  return "checking";
}

/** Zeigt ausschließlich den tatsächlich ermittelten Zustand an. */
export function ConnectionBadge(props: { info: AppInfo | null; status: LiveStatus | null; statusError: string | null }) {
  const state = badgeState(props.info, props.status, props.statusError);
  const text: Record<BadgeState, [string, string]> = {
    mock: ["MOCK-MODUS", "Keine Verbindung zu Ableton – alle Werte simuliert"],
    connected: ["Mit Ableton verbunden", `Ableton Live ${props.status?.liveVersion ?? "?"} · AbletonOSC`],
    disconnected: ["Nicht verbunden", props.statusError ?? ""],
    checking: ["Prüfe Verbindung …", "Warte auf Antwort von AbletonOSC"],
  };
  const [title, sub] = text[state];
  return (
    <div className={`badge badge-${state}`} data-testid="connection-badge" data-state={state} title={sub}>
      <span className="badge-dot" aria-hidden />
      <div>
        <div className="badge-title">{title}</div>
        <div className="badge-sub">{sub}</div>
      </div>
    </div>
  );
}
