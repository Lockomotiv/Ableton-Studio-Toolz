// Projekt-Hub: Ideen-Notizen und Planer-Aufgaben eines Track-Projekts.
//
// Abgleich: jeder Eintrag trägt eine Lamport-Uhr (`clock`) und die Kennung des
// bearbeitenden Rechners (`site`). Der Stand mit größerem (clock, site) gewinnt –
// auf beiden Seiten identisch entschieden, auch wenn offline bearbeitet wurde.
// Gelöschte Einträge bleiben als "Grabstein" (deleted=true) erhalten, damit das
// Löschen beim Abgleich nicht rückgängig gemacht wird.
// Dieselbe Regel setzt apps/desktop/src-tauri/src/hub.rs beim Speichern durch.

export type HubKind = "note" | "task";
export type TaskStatus = "idea" | "todo" | "doing" | "done";

export interface HubProject {
  id: string;
  name: string;
  createdMs: number;
}

export interface HubItem {
  id: string;
  projectId: string;
  kind: HubKind;
  title: string;
  body: string;
  status: TaskStatus;
  /** Anzeigename der zuständigen Person, null = offen */
  assignee: string | null;
  /** optionaler Bezug ins Live-Set, z. B. "Drop ab Takt 33" oder das BPM beim Festhalten */
  liveRef: string;
  author: string;
  createdMs: number;
  updatedMs: number;
  clock: number;
  site: string;
  deleted: boolean;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  idea: "Ideen",
  todo: "Zu erledigen",
  doing: "In Arbeit",
  done: "Fertig",
};

export const STATUS_ORDER: TaskStatus[] = ["idea", "todo", "doing", "done"];

/** Vorlage "Track fertigstellen" für den Planer. */
export const TRACK_TEMPLATE: { title: string; body: string }[] = [
  { title: "Skizze / Hook festhalten", body: "Kernidee, Tonart und Tempo festlegen" },
  { title: "Drums & Groove", body: "Kick, Snare, Hats, Percussion" },
  { title: "Bass", body: "Bassline und Zusammenspiel mit der Kick" },
  { title: "Harmonien & Melodie", body: "Akkorde, Leads, Pads" },
  { title: "Vocals / Hauptelement", body: "Aufnahme, Comping, Tuning" },
  { title: "Arrangement", body: "Intro, Aufbau, Drop/Refrain, Breakdown, Outro" },
  { title: "Sounddesign & Effekte", body: "Übergänge, Risers, Automationen" },
  { title: "Mixdown", body: "Pegel, EQ, Kompression, Raum" },
  { title: "Mastering", body: "Lautheit, Referenzvergleich" },
  { title: "Export & Ablage", body: "WAV/MP3, Stems, Projekt sammeln und speichern" },
];

export function newId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function maxClock(items: Iterable<HubItem>): number {
  let m = 0;
  for (const i of items) m = Math.max(m, i.clock);
  return m;
}

/** true, wenn `a` gegenüber `b` gewinnt. */
export function wins(a: Pick<HubItem, "clock" | "site">, b: Pick<HubItem, "clock" | "site">): boolean {
  return a.clock > b.clock || (a.clock === b.clock && a.site > b.site);
}

/** Reiner Merge zweier Stände (Map id → Item). Liefert neue Map und übernommene Einträge. */
export function mergeItems(current: Map<string, HubItem>, incoming: HubItem[]): { next: Map<string, HubItem>; applied: HubItem[] } {
  const next = new Map(current);
  const applied: HubItem[] = [];
  for (const it of incoming) {
    const cur = next.get(it.id);
    if (!cur || wins(it, cur)) {
      next.set(it.id, it);
      applied.push(it);
    }
  }
  return { next, applied };
}

export function createItem(
  p: { projectId: string; kind: HubKind; title: string; body?: string; status?: TaskStatus; liveRef?: string },
  ctx: { author: string; site: string; clock: number; now?: number },
): HubItem {
  const now = ctx.now ?? Date.now();
  return {
    id: newId(),
    projectId: p.projectId,
    kind: p.kind,
    title: p.title.trim().slice(0, 200),
    body: (p.body ?? "").slice(0, 8000),
    status: p.status ?? (p.kind === "note" ? "idea" : "todo"),
    assignee: null,
    liveRef: (p.liveRef ?? "").slice(0, 200),
    author: ctx.author,
    createdMs: now,
    updatedMs: now,
    clock: ctx.clock + 1,
    site: ctx.site,
    deleted: false,
  };
}

export function editItem(
  item: HubItem,
  patch: Partial<Pick<HubItem, "title" | "body" | "status" | "assignee" | "liveRef" | "deleted" | "kind">>,
  ctx: { site: string; clock: number; now?: number },
): HubItem {
  return {
    ...item,
    ...patch,
    title: (patch.title ?? item.title).slice(0, 200),
    body: (patch.body ?? item.body).slice(0, 8000),
    updatedMs: ctx.now ?? Date.now(),
    clock: Math.max(ctx.clock, item.clock) + 1,
    site: ctx.site,
  };
}

const STATUSES = new Set<string>(STATUS_ORDER);

/** Prüft einen von außen (Gegenüber) gelieferten Eintrag. */
export function isValidHubItem(x: unknown, projectId: string): x is HubItem {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  const str = (k: string, max: number) => typeof i[k] === "string" && (i[k] as string).length <= max;
  const idOk = (k: string) => typeof i[k] === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(i[k] as string);
  return (
    idOk("id") &&
    idOk("site") &&
    i.projectId === projectId &&
    (i.kind === "note" || i.kind === "task") &&
    str("title", 200) &&
    str("body", 8000) &&
    str("liveRef", 200) &&
    str("author", 64) &&
    typeof i.status === "string" &&
    STATUSES.has(i.status) &&
    (i.assignee === null || str("assignee", 64)) &&
    Number.isSafeInteger(i.clock) &&
    (i.clock as number) >= 0 &&
    Number.isFinite(i.createdMs) &&
    Number.isFinite(i.updatedMs) &&
    typeof i.deleted === "boolean"
  );
}
