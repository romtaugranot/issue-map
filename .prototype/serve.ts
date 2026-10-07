// PROTOTYPE — wipe me. Serves .prototype/ on http://localhost:4173.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
const root = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const file = join(root, path === "/" ? "pane.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": extname(file) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404).end("not found"); }
}).listen(4173, () => console.log("http://localhost:4173"));
