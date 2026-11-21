import type { CheckStatus, DiagnosticCheck } from "@lom/shared-types";

const LABEL: Record<CheckStatus, string> = {
  pass: "OK",
  warn: "Warnung",
  fail: "Fehler",
  skipped: "übersprungen",
};

export function CheckList(props: { checks: DiagnosticCheck[]; only?: string[] }) {
  const list = props.only ? props.checks.filter((c) => props.only!.includes(c.id)) : props.checks;
  return (
    <ul className="checks" data-testid="check-list">
      {list.map((c) => (
        <li key={c.id} className={`check check-${c.status}`} data-check={c.id} data-status={c.status}>
          <div className="check-head">
            <span className={`pill pill-${c.status}`}>{LABEL[c.status]}</span>
            <span className="check-label">{c.label}</span>
            <span className="check-ms">{c.durationMs.toFixed(0)} ms</span>
          </div>
          {c.detail && <pre className="check-detail">{c.detail}</pre>}
        </li>
      ))}
    </ul>
  );
}
