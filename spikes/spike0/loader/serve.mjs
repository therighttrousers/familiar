// Static server for the loader experiment: loader/public/ and loader/dist/.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const roots = [join(here, "public"), join(here, "dist")];
const types = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
const port = Number(process.env.PORT ?? 5180);

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  for (const root of roots) {
    try {
      const body = await readFile(join(root, path));
      res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
      return res.end(body);
    } catch {}
  }
  res.writeHead(404).end("not found");
}).listen(port, () => console.log(`http://localhost:${port}/`));
