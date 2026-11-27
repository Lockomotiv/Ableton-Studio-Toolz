#!/usr/bin/env node
// Kopiert die geprüfte AbletonOSC-Version (Commit siehe COMMIT) aus dem Vendor-Checkout
// in die Installer-Ressourcen: apps/desktop/src-tauri/resources/AbletonOSC
// Nur Laufzeitdateien (keine Tests, Clients, Logs, Caches).
// Voraussetzung: scripts/fetch-abletonosc.(sh|ps1)
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const COMMIT = "0ca68214bd62c9b5cb641ca34006cfd70ba94430";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "tests", "integration", "abletonosc-harness", "vendor", "AbletonOSC");
const DEST = join(ROOT, "apps", "desktop", "src-tauri", "resources", "AbletonOSC");

if (!existsSync(join(SRC, "manager.py"))) {
  console.error(`AbletonOSC fehlt unter ${SRC} – zuerst scripts/fetch-abletonosc.sh bzw. .ps1 ausführen`);
  process.exit(1);
}
const head = execFileSync("git", ["-C", SRC, "rev-parse", "HEAD"]).toString().trim();
if (head !== COMMIT) {
  console.error(`AbletonOSC-Checkout ist ${head}, erwartet ${COMMIT}`);
  process.exit(1);
}
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
const skip = (p) => /(^|[\\/])(__pycache__|\.git)([\\/]|$)/.test(p) || p.endsWith(".pyc");
for (const f of ["LICENSE.md", "README.md", "__init__.py", "manager.py"]) cpSync(join(SRC, f), join(DEST, f));
for (const d of ["abletonosc", "pythonosc"]) cpSync(join(SRC, d), join(DEST, d), { recursive: true, filter: (p) => !skip(p) });
writeFileSync(join(DEST, "COMMIT"), COMMIT + "\n");
writeFileSync(
  join(DEST, "THIRD_PARTY.txt"),
  `AbletonOSC – https://github.com/ideoforms/AbletonOSC – Commit ${COMMIT}
Lizenz: MIT (siehe LICENSE.md), Copyright (c) Daniel John Jones and contributors.

Enthält im Ordner pythonosc/ eine Kopie von python-osc (https://github.com/attwad/python-osc),
lizenziert unter der Unlicense (gemeinfrei).

Mitgeliefert von LOCK-O-MOTIV Connect Studio unverändert. Bei der Installation mit der Option
"Nur lokal erreichbar" ändert Connect Studio ausschließlich die Standard-Bind-Adresse in
abletonosc/osc_server.py von 0.0.0.0 auf 127.0.0.1 (siehe CONNECT_STUDIO.txt im installierten Ordner).
`,
);
let n = 0;
const count = (d) => readdirSync(d).forEach((e) => (statSync(join(d, e)).isDirectory() ? count(join(d, e)) : n++));
count(DEST);
console.log(`AbletonOSC ${COMMIT.slice(0, 7)} → ${DEST} (${n} Dateien)`);
