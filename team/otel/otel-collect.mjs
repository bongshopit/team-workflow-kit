#!/usr/bin/env node
// Collector for daily use. Receives OTLP/HTTP (JSON), keeps a compact allowlisted record per span,
// and appends it to <TEAM_HOME>/telemetry/spool/YYYY-MM-DD.jsonl. It does not know about tickets:
// otel-report.mjs matches spans to tickets later, using the call log, because the first spans of a run
// arrive before the first team.mjs call.
//
//   node otel-collect.mjs [--port 4318] [--home <dir>] [--keep-days 30]
//
// Metrics and logs are acknowledged and dropped. Protobuf is acknowledged and dropped with one warning.
// GET /health returns counters, for a start-up check.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { compactBody } from "./otel-lib.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const port = Number(arg("port", 4318));
const home = arg("home", process.env.TEAM_HOME || path.join(os.homedir(), ".copilot", "team"));
const keepDays = Number(arg("keep-days", 30));
const spool = path.join(home, "telemetry", "spool");
fs.mkdirSync(spool, { recursive: true });

const counters = { startedAt: new Date().toISOString(), requests: 0, spans: 0, duplicates: 0, droppedMetrics: 0, droppedLogs: 0, droppedProtobuf: 0, errors: 0 };
const recent = new Set(); // span ids seen lately, so an exporter retry does not write twice
let warnedProtobuf = false;

const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function prune() {
  const cutoff = Date.now() - keepDays * 86400000;
  for (const f of fs.readdirSync(spool)) {
    const full = path.join(spool, f);
    try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch { /* ignore */ }
  }
}
prune();
setInterval(prune, 6 * 3600 * 1000).unref();

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, spool, ...counters }));
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    counters.requests++;
    const type = String(req.headers["content-type"] || "");
    const isJson = type.includes("json");
    const reply = () => res.writeHead(200, { "content-type": isJson ? "application/json" : type || "application/x-protobuf" }).end(isJson ? "{}" : undefined);
    try {
      let body = Buffer.concat(chunks);
      if (String(req.headers["content-encoding"] || "").includes("gzip")) body = zlib.gunzipSync(body);
      const url = String(req.url);
      if (url.endsWith("/v1/metrics")) { counters.droppedMetrics++; return reply(); }
      if (url.endsWith("/v1/logs")) { counters.droppedLogs++; return reply(); }
      if (!isJson) {
        counters.droppedProtobuf++;
        if (!warnedProtobuf) { warnedProtobuf = true; console.warn("WARNING: protobuf received and dropped. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json."); }
        return reply();
      }
      const spans = compactBody(JSON.parse(body.toString("utf8")));
      const byDay = new Map();
      for (const s of spans) {
        if (recent.has(s.span)) { counters.duplicates++; continue; }
        recent.add(s.span);
        const d = dayOf(s.end || s.start || Date.now());
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(JSON.stringify(s));
        counters.spans++;
      }
      if (recent.size > 50000) { const keep = [...recent].slice(-20000); recent.clear(); keep.forEach((k) => recent.add(k)); }
      for (const [d, lines] of byDay) fs.appendFileSync(path.join(spool, `${d}.jsonl`), lines.join("\n") + "\n");
      reply();
    } catch (e) {
      counters.errors++;
      console.error(`request ${counters.requests}: ${e.message}`);
      res.writeHead(400).end();
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OTLP collector on http://127.0.0.1:${port}  ->  ${spool}  (keeps ${keepDays} days)`);
  console.log(`Health: http://127.0.0.1:${port}/health`);
});
server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${port} is busy. Another collector may already be running. Try: curl http://127.0.0.1:${port}/health` : e.message);
  process.exit(1);
});
