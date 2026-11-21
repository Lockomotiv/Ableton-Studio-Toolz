// Gemeinsame Helfer für die E2E-Tests.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createRequire } from "node:module";

/** Playwright aus dem Projekt oder (falls vorinstalliert) global laden. */
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    return require(require.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH ?? "").split(":"), "/opt/node-tools/node_modules"] }));
  }
}

/** Liefert apps/desktop/dist über HTTP aus (für Browser-Teilnehmer). */
export function serveDir(dir) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const p = join(dir, rel === "/" ? "index.html" : rel);
    if (!p.startsWith(dir) || !existsSync(p)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }).end(readFileSync(p));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}
