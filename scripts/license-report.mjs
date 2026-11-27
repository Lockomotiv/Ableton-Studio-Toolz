#!/usr/bin/env node
// Erzeugt THIRD_PARTY_NOTICES.md und docs/licenses/license-summary.json aus
// `cargo metadata` (aufgelöster Abhängigkeitsgraph) und package-lock.json
// (nur Laufzeitabhängigkeiten). Markiert Copyleft- und unbekannte Lizenzen.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], { cwd: ROOT, maxBuffer: 1 << 28 }).toString());

// Nur Pakete, die über normale (nicht dev/build-only) Kanten von unseren Crates erreichbar sind.
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
const seen = new Set();
const stack = [...meta.workspace_members];
while (stack.length) {
  const id = stack.pop();
  if (seen.has(id)) continue;
  seen.add(id);
  for (const d of nodes.get(id)?.deps ?? []) {
    if (d.dep_kinds.some((k) => k.kind === null || k.kind === "build")) stack.push(d.pkg);
  }
}
const rust = [...seen]
  .map((id) => pkgs.get(id))
  .filter((p) => !meta.workspace_members.includes(p.id))
  .map((p) => ({ eco: "cargo", name: p.name, version: p.version, license: p.license ?? (p.license_file ? `Datei: ${p.license_file}` : "UNBEKANNT"), repo: p.repository ?? "" }))
  .sort((a, b) => a.name.localeCompare(b.name));

const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const npm = Object.entries(lock.packages)
  .filter(([k, v]) => k.startsWith("node_modules/") && !v.dev && !v.link)
  .map(([k, v]) => ({ eco: "npm", name: k.replace(/^.*node_modules\//, ""), version: v.version, license: v.license ?? "UNBEKANNT", repo: "" }))
  .sort((a, b) => a.name.localeCompare(b.name));

const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|SSPL)\b/i;
const all = [...rust, ...npm];
const flagged = all.filter((p) => COPYLEFT.test(p.license) || /UNBEKANNT|Datei:/.test(p.license));
const byLicense = {};
for (const p of all) byLicense[p.license] = (byLicense[p.license] ?? 0) + 1;

mkdirSync(join(ROOT, "docs", "licenses"), { recursive: true });
writeFileSync(join(ROOT, "docs", "licenses", "license-summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), counts: { cargo: rust.length, npm: npm.length }, byLicense, flagged }, null, 2));

const row = (p) => `| ${p.eco} | ${p.name} | ${p.version} | ${p.license} |`;
const md = `# THIRD_PARTY_NOTICES

LOCK-O-MOTIV Connect Studio ${meta.packages.find((p) => p.name === "lom-connect-studio")?.version ?? ""} verwendet folgende Drittkomponenten.
Automatisch erzeugt mit \`node scripts/license-report.mjs\` aus dem aufgelösten Cargo-Abhängigkeitsgraph
(alle Zielplattformen, ohne Dev-Abhängigkeiten) und den npm-Laufzeitabhängigkeiten.

> **Hinweis (Sprint 1):** Diese Liste nennt Lizenz-Kennungen. Die vollständigen Lizenztexte werden vor
> dem Beta-Release (Sprint 5) mit einem Werkzeug wie \`cargo-about\` in diese Datei bzw. den Installer übernommen.

## Mitgelieferte Komponenten außerhalb des Programmcodes

| Komponente | Version | Lizenz | Verwendung |
|---|---|---|---|
| AbletonOSC (ideoforms/AbletonOSC), Copyright (c) Daniel John Jones and contributors | Commit 0ca68214bd62 | MIT | Remote Script für Ableton Live; im Installer enthalten, wird nur auf Klick in die User Library kopiert (optional mit Bind-Adresse 127.0.0.1). Lizenztext: \`resources/AbletonOSC/LICENSE.md\` |
| python-osc (in AbletonOSC enthalten, Ordner \`pythonosc/\`) | wie AbletonOSC | Unlicense (gemeinfrei) | OSC-Codec innerhalb von AbletonOSC |

## Nicht mitgeliefert

| Komponente | Lizenz | Verwendung |
|---|---|---|
| Microsoft Edge WebView2 Runtime | Microsoft-Lizenz | Bestandteil von Windows 11 |
| Ableton Live | proprietär | wird weder mitgeliefert noch verändert |

## Zusammenfassung

${Object.entries(byLicense).sort((a, b) => b[1] - a[1]).map(([l, n]) => `* ${l}: ${n}`).join("\n")}

**Copyleft- oder ungeklärte Lizenzen (manuell zu prüfen):** ${flagged.length === 0 ? "keine" : ""}
${flagged.map((p) => `* ${p.eco} ${p.name} ${p.version}: ${p.license}`).join("\n")}

## Rust-Crates (${rust.length})

| Ökosystem | Paket | Version | Lizenz |
|---|---|---|---|
${rust.map(row).join("\n")}

## npm-Pakete im ausgelieferten Frontend (${npm.length})

| Ökosystem | Paket | Version | Lizenz |
|---|---|---|---|
${npm.map(row).join("\n")}
`;
writeFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), md);
console.log(`THIRD_PARTY_NOTICES.md: ${rust.length} Crates, ${npm.length} npm-Pakete, ${flagged.length} markiert`);
for (const f of flagged) console.log(`  ⚠ ${f.eco} ${f.name} ${f.version}: ${f.license}`);
