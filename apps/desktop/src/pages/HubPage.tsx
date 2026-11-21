import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveStatus, Settings } from "@lom/shared-types";
import {
  createItem, editItem, maxClock, newId, STATUS_LABEL, STATUS_ORDER, TRACK_TEMPLATE,
  type HubItem, type HubKind, type HubProject, type TaskStatus,
} from "@lom/protocol";
import { api, errorMessage } from "../api";
import { useSession } from "../collab/SessionContext";

export function HubPage(props: { settings: Settings; onSettings: (s: Settings) => void; liveStatus: LiveStatus | null }) {
  const { session, snap, hubTick, bumpHub } = useSession();
  const { settings } = props;
  const sessionProject = snap?.core.phase !== "ended" ? snap?.core.project ?? null : null;
  const [projects, setProjects] = useState<HubProject[]>([]);
  const [projectId, setProjectId] = useState(settings.activeProjectId);
  const [items, setItems] = useState<HubItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newProject, setNewProject] = useState("");
  const [quick, setQuick] = useState("");
  const [quickKind, setQuickKind] = useState<HubKind>("note");
  const [attachTempo, setAttachTempo] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);

  const activeId = sessionProject?.id ?? projectId;
  const me = settings.displayName || "Ich";
  const partner = snap?.core.peerName ?? null;

  const loadProjects = useCallback(async () => {
    const p = await api.hubProjects();
    setProjects(p);
    if (!sessionProject && !p.some((x) => x.id === projectId) && p[0]) setProjectId(p[0].id);
  }, [projectId, sessionProject]);

  useEffect(() => {
    loadProjects().catch((e) => setError(errorMessage(e)));
  }, [loadProjects, hubTick]);

  useEffect(() => {
    if (!activeId) {
      setItems([]);
      return;
    }
    api.hubItems(activeId).then(setItems).catch((e) => setError(errorMessage(e)));
  }, [activeId, hubTick]);

  const save = async (changed: HubItem[]) => {
    try {
      await api.hubMerge(activeId, changed);
      session?.core.publishHub(changed);
      bumpHub();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const ctx = () => ({ author: me, site: settings.siteId || "local", clock: maxClock(items) });

  const addQuick = async () => {
    if (!quick.trim() || !activeId) return;
    const ls = props.liveStatus;
    const liveRef = attachTempo && ls ? `${ls.tempo.toFixed(1)} BPM${ls.isPlaying ? " · lief gerade" : ""}` : "";
    await save([createItem({ projectId: activeId, kind: quickKind, title: quick, liveRef }, ctx())]);
    setQuick("");
  };

  const addTemplate = async () => {
    const c = ctx();
    const existing = new Set(items.filter((i) => !i.deleted).map((i) => i.title));
    const fresh = TRACK_TEMPLATE.filter((t) => !existing.has(t.title)).map((t, k) =>
      createItem({ projectId: activeId, kind: "task", title: t.title, body: t.body, status: "todo" }, { ...c, clock: c.clock + k }),
    );
    if (fresh.length) await save(fresh);
  };

  const patch = (it: HubItem, p: Parameters<typeof editItem>[1]) => save([editItem(it, p, { site: settings.siteId || "local", clock: maxClock(items) })]);

  const createProject = async () => {
    const name = newProject.trim();
    if (!name) return;
    const p = await api.hubProjectUpsert({ id: newId(), name, createdMs: Date.now() });
    setNewProject("");
    setProjectId(p.id);
    props.onSettings(await api.settingsSave({ ...settings, activeProjectId: p.id }));
    await loadProjects();
  };

  const visible = useMemo(() => items.filter((i) => !i.deleted).sort((a, b) => a.createdMs - b.createdMs), [items]);
  const tasks = visible.filter((i) => i.kind === "task");
  const done = tasks.filter((t) => t.status === "done").length;
  const currentName = sessionProject?.name ?? projects.find((p) => p.id === activeId)?.name ?? "";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Projekt-Hub</h1>
          <p className="muted">Ideen festhalten, Aufgaben planen, Track gemeinsam fertigstellen</p>
        </div>
        <div className={`sync-badge ${sessionProject && snap?.core.phase === "connected" ? "on" : ""}`} data-testid="hub-sync">
          {sessionProject && snap?.core.phase === "connected" ? `● Live geteilt mit ${partner ?? "Partner"}` : "○ Lokal – wird bei der nächsten Session abgeglichen"}
        </div>
      </header>
      {error && <div className="banner banner-error">{error}</div>}

      <section className="hub-top">
        <div className="card">
          <div className="row">
            {sessionProject ? (
              <span className="project-name" data-testid="hub-project">{currentName} <span className="tag">Session-Projekt</span></span>
            ) : (
              <select
                className="input"
                value={activeId}
                data-testid="hub-project-select"
                onChange={async (e) => {
                  setProjectId(e.target.value);
                  props.onSettings(await api.settingsSave({ ...settings, activeProjectId: e.target.value }));
                }}
              >
                {projects.length === 0 && <option value="">– Projekt anlegen –</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {!sessionProject && (
              <>
                <input className="input" placeholder="Neues Projekt …" value={newProject} onChange={(e) => setNewProject(e.target.value)} data-testid="hub-new-project" />
                <button className="btn" onClick={createProject} data-testid="btn-hub-new-project">Anlegen</button>
              </>
            )}
            <span className="spacer" />
            {tasks.length > 0 && (
              <div className="progress" title={`${done} von ${tasks.length} Aufgaben fertig`}>
                <div className="progress-bar" style={{ width: `${(done / tasks.length) * 100}%` }} />
                <span>{done}/{tasks.length} fertig</span>
              </div>
            )}
          </div>
          <form
            className="row quick"
            onSubmit={(e) => {
              e.preventDefault();
              void addQuick();
            }}
          >
            <select className="input kind-select" value={quickKind} onChange={(e) => setQuickKind(e.target.value as HubKind)}>
              <option value="note">💡 Idee</option>
              <option value="task">☐ Aufgabe</option>
            </select>
            <input
              className="input grow"
              placeholder={activeId ? "Idee oder Aufgabe festhalten … (Enter)" : "Zuerst ein Projekt anlegen"}
              value={quick}
              disabled={!activeId}
              onChange={(e) => setQuick(e.target.value)}
              data-testid="hub-quick"
            />
            <label className="switch small" title="Aktuelles Tempo aus Live an die Idee anhängen">
              <input type="checkbox" checked={attachTempo} onChange={(e) => setAttachTempo(e.target.checked)} /> Live-Tempo anhängen
            </label>
            <button className="btn btn-accent" type="submit" disabled={!activeId || !quick.trim()} data-testid="btn-hub-add">Festhalten</button>
            <button className="btn" type="button" disabled={!activeId} onClick={addTemplate} data-testid="btn-hub-template">Vorlage „Track fertigstellen“</button>
          </form>
        </div>
      </section>

      <section className="board" data-testid="hub-board">
        {STATUS_ORDER.map((st) => (
          <div key={st} className={`column col-${st}`} data-column={st}>
            <div className="column-head">
              {STATUS_LABEL[st]} <span className="muted">{visible.filter((i) => i.status === st).length}</span>
            </div>
            {visible.filter((i) => i.status === st).map((it) => (
              <HubCard
                key={it.id}
                item={it}
                editing={editing === it.id}
                onEdit={() => setEditing(it.id)}
                onDone={() => setEditing(null)}
                me={me}
                partner={partner}
                onPatch={(p) => patch(it, p)}
              />
            ))}
          </div>
        ))}
      </section>
      <p className="hint">
        Änderungen werden lokal gespeichert und in einer Session sofort mit dem Partner abgeglichen. Konflikte löst der Hub automatisch
        (letzte Änderung gewinnt, auf beiden Seiten gleich).
      </p>
    </div>
  );
}

function HubCard(props: {
  item: HubItem;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  me: string;
  partner: string | null;
  onPatch: (p: Partial<Pick<HubItem, "title" | "body" | "status" | "assignee" | "deleted" | "kind">>) => void;
}) {
  const { item: it } = props;
  const [title, setTitle] = useState(it.title);
  const [body, setBody] = useState(it.body);
  useEffect(() => {
    setTitle(it.title);
    setBody(it.body);
  }, [it.title, it.body]);
  const idx = STATUS_ORDER.indexOf(it.status);
  const move = (d: number) => props.onPatch({ status: STATUS_ORDER[Math.min(3, Math.max(0, idx + d))] as TaskStatus });

  return (
    <div className={`hub-card kind-${it.kind}`} data-testid="hub-card" data-title={it.title}>
      {props.editing ? (
        <div className="form">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details, Links, Takte …" />
          <div className="row">
            <button
              className="btn btn-small btn-accent"
              onClick={() => {
                if (title !== it.title || body !== it.body) props.onPatch({ title: title.trim() || it.title, body });
                props.onDone();
              }}
            >
              Speichern
            </button>
            <button className="btn btn-small" onClick={props.onDone}>Abbrechen</button>
          </div>
        </div>
      ) : (
        <>
          <div className="hub-card-title" onDoubleClick={props.onEdit}>
            <span>{it.kind === "note" ? "💡" : it.status === "done" ? "☑" : "☐"}</span> {it.title}
          </div>
          {it.body && <div className="hub-card-body">{it.body}</div>}
          <div className="hub-card-meta">
            {it.liveRef && <span className="tag">♪ {it.liveRef}</span>}
            <span>{it.author}</span>
            {it.assignee && <span className="tag">→ {it.assignee}</span>}
          </div>
          <div className="hub-card-actions">
            <button className="icon" title="Zurück" disabled={idx === 0} onClick={() => move(-1)}>◀</button>
            <button className="icon" title="Weiter" disabled={idx === 3} onClick={() => move(1)} data-testid="hub-card-next">▶</button>
            <select
              className="mini"
              value={it.assignee ?? ""}
              onChange={(e) => props.onPatch({ assignee: e.target.value || null })}
              title="Zuständig"
            >
              <option value="">offen</option>
              <option value={props.me}>{props.me}</option>
              {props.partner && props.partner !== props.me && <option value={props.partner}>{props.partner}</option>}
              {it.assignee && it.assignee !== props.me && it.assignee !== props.partner && <option value={it.assignee}>{it.assignee}</option>}
            </select>
            {it.kind === "note" && (
              <button className="icon" title="In Aufgabe umwandeln" onClick={() => props.onPatch({ kind: "task", status: "todo" })}>☐</button>
            )}
            <button className="icon" title="Bearbeiten" onClick={props.onEdit}>✎</button>
            <button className="icon" title="Löschen" onClick={() => props.onPatch({ deleted: true })}>🗑</button>
          </div>
        </>
      )}
    </div>
  );
}
