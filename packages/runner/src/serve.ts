// The runtime agent container's static applet server (see docs/designs/code-versions.md#immutable-built-versions).
//
// Environment: DIST_DIR (required), PORT (default 8080).

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const dist = process.env.DIST_DIR;
if (!dist) throw new Error("DIST_DIR is required");
const port = Number(process.env.PORT ?? 8080);

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^([/\\]\.\.)+/, "");
  const file = join(dist, path.endsWith("/") || path.endsWith("\\") ? "index.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`[serve] ${dist} on :${port}`));
