// PROTOTYPE — wipe me. Serves .prototype/ on http://localhost:4173, to this machine only.
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(fileURLToPath(new URL(".", import.meta.url)));
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  // Only files inside this folder, whatever the request spells.
  const file = await realpath(resolve(root, "." + (path === "/" ? "/pane.html" : path))).catch(() => null);
  if (!file || !file.startsWith(root + sep)) return void res.writeHead(404).end("not found");
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": extname(file) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404).end("not found"); }
}).listen(4173, "127.0.0.1", () => console.log("http://localhost:4173"));
