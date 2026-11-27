#!/usr/bin/env node
// Rendert eine HTML-Datei mit Chromium (Playwright) zu einem A4-PDF.
//   node scripts/render-pdf.mjs <eingabe.html> <ausgabe.pdf>
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPlaywright } from "../tests/e2e/util.mjs";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("Aufruf: node scripts/render-pdf.mjs <eingabe.html> <ausgabe.pdf>");
  process.exit(2);
}
const { chromium } = loadPlaywright();
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(pathToFileURL(resolve(input)).href, { waitUntil: "networkidle" });
await p.pdf({ path: resolve(output), format: "A4", printBackground: true, preferCSSPageSize: true });
await b.close();
console.log(`PDF: ${output}`);
