#!/usr/bin/env node
// Reads what otel-dump.mjs saved and prints the answers to the P0 questions.
// It prints names, counts and totals, never prompt text or attribute values (except a few safe ones listed below).
//   node otel-summary.mjs [--dir <dump dir>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const i = process.argv.indexOf("--dir");
const dir = i > -1 ? process.argv[i + 1] : path.join(os.homedir(), "team-otel-dump");
const file = path.join(dir, "requests.jsonl");
if (!fs.existsSync(file)) { console.log(`Nothing at ${file}. Is the collector running and the exporter pointed at it?`); process.exit(1); }
console.log(`Dump file: ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);

const reqs = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const val = (v) => {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val);
  return undefined;
};
const attrs = (list = []) => Object.fromEntries(list.map((a) => [a.key, val(a.value)]));
const count = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
const show = (title, m, max = 15, fmt = (v) => String(v)) => {
  console.log(`\n${title}`);
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  if (!rows.length) console.log("  (none)");
  for (const [k, v] of rows) console.log(`  ${fmt(v).padStart(10)}  ${k}`);
};
// Keys that can hold prompt, response, code or command text. Everything else is metadata.
const CONTENT_KEYS = new Set([
  "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.tool.definitions",
  "gen_ai.tool.call.arguments", "gen_ai.tool.call.result",
  "github.copilot.tool.parameters.command", "github.copilot.tool.parameters.file_path", "github.copilot.tool.parameters.mcp_server_name",
  "copilot_chat.hook_input", "copilot_chat.hook_output",
]);
const MAYBE_CONTENT = ["copilot_chat.request.options", "copilot_chat.request.shape", "copilot_chat.debug_log_label"];

const byPath = new Map(), types = new Map();
let jsonReqs = 0, binReqs = 0;
for (const r of reqs) { count(byPath, r.path); count(types, r.type || "none"); r.binFile ? binReqs++ : jsonReqs++; }
console.log(`Requests: ${reqs.length}  (JSON: ${jsonReqs}, binary/protobuf: ${binReqs})`);
show("Paths", byPath); show("Content types", types);
if (binReqs && !jsonReqs) {
  console.log("\nRESULT 1: only protobuf arrived. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json and COPILOT_OTEL_PROTOCOL=http/json, restart the client, run again.");
  process.exit(0);
}

const services = new Map(), spanNames = new Map(), agents = new Map(), models = new Map();
const tools = new Map(), toolErrors = new Map(), skills = new Map(), branches = new Map(), repos = new Map();
const attrKeys = new Set(), contentKeys = new Set(), maybeKeys = new Set(), metricNames = new Map(), logNames = new Map();
const resKeys = new Map(), resValues = new Map(), logAttrKeys = new Set();
const sessions = new Set(), chatSessions = new Set(), parentChatSessions = new Set(), conversations = new Set();
const tokByInvoke = new Map(), aiuByAgent = new Map(), aiuBySpan = new Map(), tokByAgent = new Map();
const spanById = new Map(), spans = [];
let tokIn = 0, tokOut = 0, tokCache = 0, tokReason = 0, aiuTotal = 0, aiuSpans = 0;
let first = Infinity, last = 0;

const noteResource = (res) => {
  for (const [k, v] of Object.entries(res)) {
    count(resKeys, k);
    if (!resValues.has(k)) resValues.set(k, new Set());
    resValues.get(k).add(String(v));
  }
  if (res["session.id"]) sessions.add(res["session.id"]);
};

for (const r of reqs.filter((r) => r.body && typeof r.body === "object")) {
  for (const rs of r.body.resourceSpans || []) {
    const res = attrs(rs.resource?.attributes); noteResource(res);
    count(services, res["service.name"] ?? "?");
    for (const ss of rs.scopeSpans || []) for (const s of ss.spans || []) {
      const a = attrs(s.attributes);
      const sp = { ...s, a };
      spans.push(sp); spanById.set(s.spanId, sp);
      const t0 = Number(BigInt(s.startTimeUnixNano || 0) / 1000000n), t1 = Number(BigInt(s.endTimeUnixNano || 0) / 1000000n);
      if (t0) first = Math.min(first, t0); last = Math.max(last, t1);
      count(spanNames, s.name);
      for (const k of Object.keys(a)) { attrKeys.add(k); if (CONTENT_KEYS.has(k)) contentKeys.add(k); if (MAYBE_CONTENT.includes(k)) maybeKeys.add(k); }
      if (a["gen_ai.conversation.id"]) conversations.add(a["gen_ai.conversation.id"]);
      if (a["copilot_chat.session_id"]) sessions.add(a["copilot_chat.session_id"]);
      if (a["copilot_chat.chat_session_id"]) chatSessions.add(a["copilot_chat.chat_session_id"]);
      if (a["copilot_chat.parent_chat_session_id"]) parentChatSessions.add(a["copilot_chat.parent_chat_session_id"]);
      const agent = a["gen_ai.agent.name"] || "(none)";
      if (a["gen_ai.agent.name"]) count(agents, agent);
      if (a["gen_ai.request.model"]) count(models, a["gen_ai.request.model"]);
      if (a["gen_ai.tool.name"]) { count(tools, a["gen_ai.tool.name"]); if (a["error.type"]) count(toolErrors, a["gen_ai.tool.name"]); }
      if (a["github.copilot.tool.parameters.skill_name"]) count(skills, a["github.copilot.tool.parameters.skill_name"]);
      if (a["github.copilot.git.branch"]) count(branches, a["github.copilot.git.branch"]);
      if (a["github.copilot.git.repository"]) count(repos, a["github.copilot.git.repository"]);
      const inTok = a["gen_ai.usage.input_tokens"] || 0, outTok = a["gen_ai.usage.output_tokens"] || 0;
      // invoke_agent spans carry the totals of their chat spans. Count tokens on chat spans only, or everything is doubled.
      if (/^chat /.test(s.name)) {
        tokIn += inTok; tokOut += outTok;
        tokCache += a["gen_ai.usage.cache_read.input_tokens"] || 0; tokReason += a["gen_ai.usage.reasoning.output_tokens"] || 0;
        if (inTok || outTok) count(tokByAgent, agent, inTok + outTok);
      }
      if (/^invoke_agent/.test(s.name) && (inTok || outTok)) count(tokByInvoke, agent, inTok + outTok);
      const nano = a["copilot_chat.copilot_usage_nano_aiu"];
      if (typeof nano === "number") { aiuTotal += nano; aiuSpans++; count(aiuByAgent, agent, nano); count(aiuBySpan, s.name, nano); }
    }
  }
  for (const rm of r.body.resourceMetrics || []) {
    noteResource(attrs(rm.resource?.attributes));
    for (const sm of rm.scopeMetrics || []) for (const m of sm.metrics || []) count(metricNames, m.name);
  }
  for (const rl of r.body.resourceLogs || []) {
    noteResource(attrs(rl.resource?.attributes));
    for (const sl of rl.scopeLogs || []) for (const l of sl.logRecords || []) {
      count(logNames, l.eventName || val(l.body) || "log");
      Object.keys(attrs(l.attributes)).forEach((k) => { logAttrKeys.add(k); if (CONTENT_KEYS.has(k)) contentKeys.add(k); });
    }
  }
}

let subagentLinks = 0, rootInvoke = 0, invokeTotal = 0;
for (const s of spans) if (/^invoke_agent/.test(s.name)) {
  invokeTotal++;
  const parent = s.parentSpanId ? spanById.get(s.parentSpanId) : null;
  if (parent && /^execute_tool/.test(parent.name)) subagentLinks++;
  if (!s.parentSpanId) rootInvoke++;
}

console.log(`\nWindow covered: ${first < Infinity ? ((last - first) / 60000).toFixed(1) + " minutes" : "n/a"}`);
console.log(`Distinct: session.id ${sessions.size}, chat_session_id ${chatSessions.size}, parent_chat_session_id ${parentChatSessions.size}, conversation.id ${conversations.size}`);
show("service.name", services);
show("Resource attribute keys (with number of distinct values)", new Map([...resKeys].map(([k]) => [k, resValues.get(k).size])), 30);
show("Span names", spanNames);
show("Agent names (gen_ai.agent.name)", agents);
show("Models", models);
show("Tools", tools, 20);
console.log("\nTool error rate");
for (const [t, n] of [...tools.entries()].sort((a, b) => b[1] - a[1])) if (toolErrors.get(t)) console.log(`  ${String(toolErrors.get(t)).padStart(4)} of ${String(n).padEnd(4)} ${t}`);
if (!toolErrors.size) console.log("  (none)");
show("Skills (execute_tool skill_name)", skills);
show("Git branches on spans", branches); show("Git repositories on spans", repos);
show("Metrics seen", metricNames, 25); show("Log/event names seen (top 12)", logNames, 12);
console.log(`\nTokens on chat spans (each LLM call counted once): input ${tokIn}, output ${tokOut}, cache read ${tokCache} (${tokIn ? Math.round((100 * tokCache) / tokIn) : 0}% of input), reasoning ${tokReason}`);
show("Tokens (in+out) by agent, from chat spans", tokByAgent, 10);
show("Tokens (in+out) on invoke_agent spans, a roll-up of the above", tokByInvoke, 10);
console.log(`\ncopilot_chat.copilot_usage_nano_aiu: on ${aiuSpans} spans, total ${aiuTotal} nano = ${(aiuTotal / 1e9).toFixed(4)} AIU (if the unit is 1e-9 AIU; compare with your GitHub usage page)`);
show("nano AIU by agent", aiuByAgent, 10, (v) => v.toLocaleString("en-US"));
show("nano AIU by span name", aiuBySpan, 10, (v) => v.toLocaleString("en-US"));
console.log(`\ninvoke_agent spans: ${invokeTotal}, root: ${rootInvoke}, child of a tool call (subagent): ${subagentLinks}`);

console.log("\n--- The checks ---");
console.log(`1. JSON accepted:        ${jsonReqs ? "YES" : "NO"}`);
console.log(`2. Git branch present:   ${branches.size ? "YES (" + [...branches.keys()].slice(0, 3).join(", ") + ")" : "NO"}`);
console.log(`3. Skill names present:  ${skills.size ? "YES (" + [...skills.keys()].slice(0, 5).join(", ") + ")" : "NO (or no skill was loaded in this chat)"}`);
console.log(`   Custom agent names:   ${[...agents.keys()].filter((a) => !/\//.test(a) && !["title", "progressMessages", "GitHub Copilot Chat"].includes(a)).join(", ") || "none seen"}`);
console.log(`4. Subagent parent link: ${subagentLinks ? "YES" : "NO (or no subagent was started)"}`);
console.log(`5. Which clients sent:   ${[...services.keys()].join(", ") || "none"}  (look for IntelliJ and the CLI here)`);
console.log(`6. Credits on spans:     ${aiuSpans ? "YES (copilot_usage_nano_aiu)" : "NO"}`);
if (contentKeys.size) console.log(`\nWARNING: content attributes are present: ${[...contentKeys].join(", ")}. Turn captureContent off before collecting real work.`);
else console.log("\nContent capture: no content attributes seen (good).");
if (maybeKeys.size) console.log(`Not sure about: ${[...maybeKeys].join(", ")}. Look at one value yourself in requests.jsonl before sharing the dump.`);
console.log(`\nSpan attribute keys (${attrKeys.size}):\n  ${[...attrKeys].sort().join("\n  ")}`);
console.log(`\nLog record attribute keys (${logAttrKeys.size}):\n  ${[...logAttrKeys].sort().join("\n  ")}`);
