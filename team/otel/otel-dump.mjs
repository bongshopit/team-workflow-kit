#!/usr/bin/env node
// P0 trial collector. Listens for OTLP/HTTP from Copilot clients and saves every request to disk, unchanged.
// Nothing is interpreted here. Run otel-summary.mjs afterwards to see what arrived.
//
//   node otel-dump.mjs [--port 4318] [--out <dir>] [--keep-metrics]
// Metric requests are acknowledged but not saved unless --keep-metrics is given.
//
// Default output dir: ~/team-otel-dump  (requests.jsonl for JSON bodies, req-<n>.bin for protobuf bodies)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const port = Number(arg("port", 4318));
const out = arg("out", path.join(os.homedir(), "team-otel-dump"));
const keepMetrics = process.argv.includes("--keep-metrics"); // metrics repeat what spans and logs already say, and arrive every few seconds
let metricsDropped = 0;
fs.mkdirSync(out, { recursive: true });
const jsonl = path.join(out, "requests.jsonl");
let n = 0;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const type = String(req.headers["content-type"] || "");
    const isJson = type.includes("json");
    const enc = String(req.headers["content-encoding"] || "");
    n += 1;
    let note = `${req.method} ${req.url} ${type || "no content-type"} ${body.length} bytes`;
    try {
      if (enc.includes("gzip")) {
        // Some exporters compress. Decompress so the summary can read it.
        const raw = zlib.gunzipSync(body);
        return handle(raw, true);
      }
      handle(body, false);
    } catch (e) {
      note += ` (error: ${e.message})`;
      console.log(note);
      res.writeHead(500).end();
    }

    function handle(buf, wasGzip) {
      if (!keepMetrics && String(req.url).endsWith("/v1/metrics")) {
        metricsDropped++;
        res.writeHead(200, { "content-type": isJson ? "application/json" : type || "application/x-protobuf" }).end(isJson ? "{}" : undefined);
        return;
      }
      if (isJson) {
        let parsed = null;
        try { parsed = JSON.parse(buf.toString("utf8")); } catch { /* keep as text */ }
        fs.appendFileSync(jsonl, JSON.stringify({ n, at: new Date().toISOString(), path: req.url, type, gzip: wasGzip, body: parsed ?? buf.toString("utf8") }) + "\n");
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } else {
        const file = path.join(out, `req-${n}.bin`);
        fs.writeFileSync(file, buf);
        fs.appendFileSync(jsonl, JSON.stringify({ n, at: new Date().toISOString(), path: req.url, type, gzip: wasGzip, bytes: buf.length, binFile: path.basename(file) }) + "\n");
        res.writeHead(200, { "content-type": type || "application/x-protobuf" }).end(); // empty body is a valid OTLP response
      }
      console.log(`#${n} ${note}${wasGzip ? " (gzip)" : ""} -> ${isJson ? "saved as JSON" : "saved as binary (PROTOBUF?)"}`);
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OTLP dump collector on http://127.0.0.1:${port}  ->  ${out}`);
  console.log(`Metrics are ${keepMetrics ? "saved" : "dropped (use --keep-metrics to save them)"}. Ctrl+C to stop. Then run: node otel-summary.mjs`);
});
server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${port} is busy. Try --port 4319 and point the exporter there.` : e.message);
  process.exit(1);
});
