import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const media = { ".html": "text/html", ".css": "text/css", ".mjs": "text/javascript", ".json": "application/json", ".md": "text/plain" };
createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const file = pathname === "/" ? "/index.html" : pathname;
  const type = media[extname(file)];
  if (!type || !/^\/(?:data\/)?[\w.-]+$/.test(file)) return response.writeHead(404).end();
  try {
    const content = await readFile(new URL("." + file, import.meta.url));
    response.writeHead(200, { "Content-Type": type + "; charset=utf-8" }).end(content);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
  }
}).listen(Number(process.argv[2] ?? 4176), "127.0.0.1", function () {
  console.log(`http://127.0.0.1:${this.address().port}`);
});
