const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const routes = new Map([["/", "index.html"]]);
for (const file of [
  "index.html", "app.js", "catalog.js", "checkout-ui.js", "offer.mjs", "related.json", "style.css",
]) {
  routes.set("/" + file, file);
}
for (const asset of fs.readdirSync(path.join(__dirname, "assets"), { withFileTypes: true })) {
  if (asset.isFile() && Object.hasOwn(types, path.extname(asset.name))) {
    routes.set("/assets/" + asset.name, "assets/" + asset.name);
  }
}

process.env.MANGOFY_CHECKOUT_URL ??= "https://arvoredenatal.repousotiamarlene.online/vlixx62";
const checkout = import("./api/checkout.mjs");

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end)
    && start < size && start <= end ? { start, end } : false;
}

async function serveFile(req, res, file) {
  const filePath = path.join(__dirname, file);
  const { size, mtimeMs } = await fs.promises.stat(filePath);
  const extension = path.extname(file);
  const video = extension === ".mp4";
  const etag = '"' + size.toString(16) + "-" + Math.trunc(mtimeMs).toString(16) + '"';
  res.setHeader("Content-Type", types[extension]);
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("ETag", etag);
  if (video) res.setHeader("Accept-Ranges", "bytes");
  if (req.headers["if-none-match"] === etag) return res.writeHead(304).end();

  const ifRange = req.headers["if-range"];
  const range = video && (!ifRange || ifRange === etag)
    ? parseRange(req.headers.range, size) : null;
  if (range === false) {
    res.setHeader("Content-Range", "bytes */" + size);
    return res.writeHead(416).end();
  }
  if (range) {
    res.setHeader("Content-Length", range.end - range.start + 1);
    res.setHeader("Content-Range", "bytes " + range.start + "-" + range.end + "/" + size);
    res.statusCode = 206;
  } else {
    res.setHeader("Content-Length", size);
  }
  if (req.method === "HEAD") return res.end();
  await pipeline(fs.createReadStream(filePath, range ?? undefined), res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/api/checkout") {
      const { default: handler } = await checkout;
      await handler(req, res);
      return;
    }
    const file = routes.get(pathname);
    if (!file) return res.writeHead(404).end("Página não encontrada.");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.writeHead(405).end();
    }
    await serveFile(req, res, file);
  } catch {
    if (res.headersSent || res.destroyed) return res.destroy();
    res.setHeader("Cache-Control", "no-store");
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Serviço indisponível no momento.");
  }
});

const port = process.env.PORT || "3000";
server.listen(/^\d+$/.test(port) ? Number(port) : port);
module.exports = server;
