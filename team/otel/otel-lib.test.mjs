// Run with: node --test team/otel/otel-lib.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compactBody, attribute, phasesFromCalls, phaseAt, totals, findLoops, dedupe, skillEvidence, roleOf, resolveRole, findSpanByCallId } from "./otel-lib.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- builders ----
const S = (o) => ({ v: 1, parent: null, kind: "other", svc: "copilot-chat", win: "w1", conv: null, chat: null, pchat: null, agent: null, model: null, tool: null, skill: null, err: null, tin: 0, tout: 0, tcache: 0, treason: 0, aiu: 0, ...o });
const terminal = (o) => S({ kind: "tool", name: "execute_tool run_in_terminal", tool: "run_in_terminal", ...o });
const chat = (o) => S({ kind: "chat", name: "chat m", ...o });
const call = (o) => ({ ticket: "PROJ-1", repo: "order-service", cmd: "next-action", code: 0, ...o });

test("compactBody keeps metadata and drops content", () => {
  const a = (k, v) => ({ key: k, value: typeof v === "number" ? { intValue: String(v) } : { stringValue: v } });
  const body = { resourceSpans: [{ resource: { attributes: [a("service.name", "copilot-chat"), a("session.id", "w9")] }, scopeSpans: [{ spans: [{
    traceId: "t1", spanId: "s1", parentSpanId: "p0", name: "chat mai", startTimeUnixNano: "1700000000000000000", endTimeUnixNano: "1700000002000000000",
    attributes: [a("gen_ai.usage.input_tokens", 1000), a("gen_ai.usage.output_tokens", 50), a("gen_ai.usage.cache_read.input_tokens", 900),
      a("copilot_chat.copilot_usage_nano_aiu", 2500000000), a("gen_ai.input.messages", "SECRET PROMPT"), a("gen_ai.tool.call.arguments", "SECRET ARGS"),
      a("copilot_chat.chat_session_id", "cs1"), a("gen_ai.conversation.id", "cv1")] }] }] }] };
  const [r] = compactBody(body);
  assert.equal(r.kind, "chat");
  assert.equal(r.start, 1700000000000);
  assert.equal(r.end - r.start, 2000);
  assert.equal(r.aiu, 2500000000);
  assert.equal(r.tcache, 900);
  assert.equal(r.chat, "cs1");
  assert.equal(r.win, "w9");
  assert.ok(!JSON.stringify(r).includes("SECRET"));
});

test("a call inside a terminal span ties the whole trace to the ticket", () => {
  const spans = [
    S({ name: "invoke_agent X", kind: "agent", trace: "T1", span: "a", start: 0, end: 10000, conv: "C1" }),
    chat({ trace: "T1", span: "b", start: 100, end: 900, conv: "C1", aiu: 1e9 }),
    terminal({ trace: "T1", span: "c", start: 1000, end: 5000, conv: "C1" }),
  ];
  const { result, stats } = attribute(spans, [call({ start_ms: 2000, end_ms: 2500 })]);
  assert.deepEqual(result.map((r) => r.ticket), ["PROJ-1", "PROJ-1", "PROJ-1"]);
  assert.deepEqual(result.map((r) => r.how), ["trace", "trace", "direct"]);
  assert.equal(stats.matchedCalls, 1);
});

test("a subagent is linked through the parent chat session", () => {
  const spans = [
    terminal({ trace: "T1", span: "c", start: 1000, end: 5000, chat: "S1" }),
    chat({ trace: "T2", span: "d", start: 1500, end: 1600, chat: "S2", pchat: "S1", aiu: 5 }),
    chat({ trace: "T3", span: "e", start: 1500, end: 1600, chat: "S9", aiu: 5 }), // unrelated chat
  ];
  const { result } = attribute(spans, [call({ start_ms: 2000, end_ms: 2200 })]);
  assert.equal(result[1].ticket, "PROJ-1");
  assert.equal(result[1].how, "group");
  assert.equal(result[2], null);
});

test("only terminal tools are used to match calls", () => {
  const spans = [S({ kind: "tool", name: "execute_tool read_file", tool: "read_file", trace: "T1", span: "r", start: 0, end: 9000, conv: "C1" })];
  const { result, stats } = attribute(spans, [call({ start_ms: 100, end_ms: 200 })]);
  assert.equal(result[0], null);
  assert.equal(stats.matchedCalls, 0);
});

test("the tightest terminal span wins when spans overlap", () => {
  const spans = [
    terminal({ trace: "T1", span: "wide", start: 0, end: 100000, conv: "C-wide" }),
    terminal({ trace: "T2", span: "tight", start: 1900, end: 2700, conv: "C-tight" }),
    chat({ trace: "T2", span: "x", start: 1000, end: 1100, conv: "C-tight" }),
    chat({ trace: "T1", span: "y", start: 50, end: 60, conv: "C-wide" }),
  ];
  const { result } = attribute(spans, [call({ start_ms: 2000, end_ms: 2100 })]);
  assert.equal(result[2].ticket, "PROJ-1"); // same conversation as the tight span
  assert.equal(result[3], null); // wide span's conversation has no matched call
});

test("one conversation covering two tickets splits by the nearest call", () => {
  const spans = [
    terminal({ trace: "T1", span: "c1", start: 1000, end: 3000, conv: "C1" }),
    terminal({ trace: "T2", span: "c2", start: 200000, end: 203000, conv: "C1" }),
    chat({ trace: "T3", span: "m1", start: 20000, end: 21000, conv: "C1" }), // close to the first call
    chat({ trace: "T4", span: "m2", start: 190000, end: 191000, conv: "C1" }), // close to the second
  ];
  const calls = [call({ ticket: "PROJ-1", start_ms: 2000, end_ms: 2200 }), call({ ticket: "PROJ-2", repo: "inventory-service", start_ms: 201000, end_ms: 201200 })];
  const { result } = attribute(spans, calls, { slackMs: 600000 });
  assert.equal(result[2].ticket, "PROJ-1");
  assert.equal(result[3].ticket, "PROJ-2");
  assert.equal(result[3].repo, "inventory-service");
});

test("spans far from every call in their conversation stay unassigned", () => {
  const spans = [
    terminal({ trace: "T1", span: "c1", start: 1000, end: 3000, conv: "C1" }),
    chat({ trace: "T9", span: "late", start: 3000 + 3600000, end: 3000 + 3600500, conv: "C1" }),
  ];
  const { result, stats } = attribute(spans, [call({ start_ms: 2000, end_ms: 2200 })], { slackMs: 600000 });
  assert.equal(result[1], null);
  assert.equal(stats.outOfSlack, 1);
});

test("phases come from state changes in the call log", () => {
  const calls = [
    call({ cmd: "init-change", end_ms: 1000, state_before: null, state_after: "explored" }),
    call({ end_ms: 2000, state_before: "explored", state_after: "explored" }),
    call({ end_ms: 3000, state_before: "explored", state_after: "proposed" }),
    call({ end_ms: 5000, state_before: "proposed", state_after: "approved" }),
  ];
  const ph = phasesFromCalls(calls);
  assert.deepEqual(ph.map((p) => p.state), ["explored", "proposed", "approved"]);
  assert.equal(phaseAt(ph, 500), null);
  assert.equal(phaseAt(ph, 2500), "explored");
  assert.equal(phaseAt(ph, 4000), "proposed");
  assert.equal(phaseAt(ph, 9000), "approved");
});

test("totals count credits and tokens on chat spans only", () => {
  const spans = [
    S({ kind: "agent", name: "invoke_agent a", agent: "qe", tin: 999, tout: 999, aiu: 9e9 }), // a roll-up, must not be counted
    chat({ tin: 100, tout: 10, tcache: 80, aiu: 2e9 }),
    chat({ tin: 50, tout: 5, tcache: 0, aiu: 1e9 }),
    S({ kind: "tool", name: "execute_tool x", tool: "x", err: "boom", skill: "team-run" }),
  ];
  const t = totals(spans);
  assert.equal(t.tin, 150);
  assert.equal(t.credits, 3);
  assert.equal(t.llmCalls, 2);
  assert.equal(t.toolErrors, 1);
  assert.deepEqual([...t.agents], ["qe"]);
  assert.deepEqual([...t.skills], ["team-run"]);
});

test("findLoops spots the same tool failing in a row", () => {
  const t = (i, err) => S({ kind: "tool", name: "execute_tool read_file", tool: "read_file", start: i, end: i + 1, err });
  assert.deepEqual(findLoops([t(1, "e"), t(2, "e"), t(3, "e"), t(4, null), t(5, "e")]), [{ tool: "read_file", count: 3 }]);
  assert.deepEqual(findLoops([t(1, "e"), t(2, null), t(3, "e"), t(4, "e")]), []);
});

test("dedupe removes repeated span ids", () => {
  assert.equal(dedupe([S({ span: "a" }), S({ span: "a" }), S({ span: "b" })]).length, 2);
});

// ---- the collector and the report, end to end ----
const post = (port, url, body, type = "application/json") =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: url, method: "POST", headers: { "content-type": type } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    r.on("error", reject); r.end(body);
  });
const get = (port, url) => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path: url }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d))); }).on("error", reject));

test("collector writes compact spans, drops metrics and content, and the report attributes them", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "otel-home-"));
  const port = 4600 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, [path.join(DIR, "otel-collect.mjs"), "--port", String(port), "--home", home], { stdio: "ignore" });
  try {
    for (let i = 0; i < 30; i++) { try { await get(port, "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const base = Date.now() - 60000;
    const ns = (ms) => String(BigInt(ms) * 1000000n);
    const a = (k, v) => ({ key: k, value: typeof v === "number" ? { intValue: String(v) } : { stringValue: v } });
    const span = (id, name, t0, t1, attrs) => ({ traceId: "TR1", spanId: id, name, startTimeUnixNano: ns(t0), endTimeUnixNano: ns(t1), attributes: attrs });
    const body = { resourceSpans: [{ resource: { attributes: [a("service.name", "copilot-chat"), a("session.id", "w1")] }, scopeSpans: [{ spans: [
      span("s1", "chat mai", base, base + 1000, [a("gen_ai.usage.input_tokens", 100), a("gen_ai.usage.output_tokens", 10), a("copilot_chat.copilot_usage_nano_aiu", 1500000000), a("gen_ai.conversation.id", "cv1"), a("gen_ai.input.messages", "TOP SECRET")]),
      span("s2", "execute_tool run_in_terminal", base + 2000, base + 6000, [a("gen_ai.tool.name", "run_in_terminal"), a("gen_ai.conversation.id", "cv1")]),
    ] }] }] };
    assert.equal(await post(port, "/v1/traces", JSON.stringify(body)), 200);
    assert.equal(await post(port, "/v1/traces", JSON.stringify(body)), 200); // retry: must not duplicate
    assert.equal(await post(port, "/v1/metrics", "{}"), 200);
    assert.equal(await post(port, "/v1/logs", "{}"), 200);
    assert.equal(await post(port, "/v1/traces", "\x0a\x00", "application/x-protobuf"), 200);
    const h = await get(port, "/health");
    assert.equal(h.spans, 2);
    assert.equal(h.duplicates, 2);
    assert.equal(h.droppedMetrics, 1);
    assert.equal(h.droppedProtobuf, 1);

    const spool = path.join(home, "telemetry", "spool");
    const text = fs.readdirSync(spool).map((f) => fs.readFileSync(path.join(spool, f), "utf8")).join("");
    assert.ok(!text.includes("TOP SECRET"));
    assert.equal(text.trim().split("\n").length, 2);

    // a call log for the ticket, inside the terminal span
    fs.mkdirSync(path.join(home, "calls"), { recursive: true });
    const entry = { ticket: "PROJ-7", repo: "order-service", cmd: "init-change", code: 0, start_ms: base + 3000, end_ms: base + 3500, state_before: null, state_after: "explored" };
    fs.writeFileSync(path.join(home, "calls", "PROJ-7.jsonl"), JSON.stringify(entry) + "\n");
    const rep = spawnSync(process.execPath, [path.join(DIR, "otel-report.mjs"), "PROJ-7", "--home", home, "--json"], { encoding: "utf8" });
    assert.equal(rep.status, 0, rep.stderr);
    const j = JSON.parse(rep.stdout);
    assert.equal(j.coverage.matchedCalls, 1);
    assert.equal(j.coverage.assignedToTicket, 2);
    assert.equal(j.perRepo["order-service"].total.credits, 1.5);
    assert.deepEqual(j.perRepo["order-service"].phases.map((p) => p.phase), ["before init-change (explore)", "explored"]);
    const txt = spawnSync(process.execPath, [path.join(DIR, "otel-report.mjs"), "PROJ-7", "--home", home], { encoding: "utf8" });
    assert.match(txt.stdout, /== order-service: 1.5 credits/);
  } finally {
    proc.kill();
  }
});

// ---- skill evidence ----
test("skill evidence combines noted, inferred, hook and telemetry", () => {
  const calls = [
    call({ cmd: "note-skill", detail: "team-run (orchestrator)" }),
    call({ cmd: "next-action", detail: "propose + test-plan" }),
    call({ cmd: "note-skill", detail: "team-explore (orchestrator)" }),
    call({ cmd: "init-change" }),
    call({ cmd: "set-status", detail: "proposed" }), // team-propose, no read seen
    call({ cmd: "set-ready", detail: "test_plan" }),
    call({ cmd: "note-skill", detail: "team-apply (dev)" }), // noted, but no applying call
    call({ cmd: "set-status", detail: "applying", code: 2 }), // refused: must not count as evidence
  ];
  const rows = Object.fromEntries(skillEvidence({ calls, hookSkills: ["team-test-plan"], telemetrySkills: [] }).map((r) => [r.skill, r]));
  assert.equal(rows["team-run"].noted && rows["team-run"].inferred, true);
  assert.equal(rows["team-run"].flag, null);
  assert.equal(rows["team-explore"].flag, null);
  assert.equal(rows["team-propose"].inferred, true);
  assert.equal(rows["team-propose"].noted, false);
  assert.match(rows["team-propose"].flag, /no read of the skill/);
  assert.equal(rows["team-test-plan"].hook, true);
  assert.equal(rows["team-apply"].noted, true);
  assert.equal(rows["team-apply"].inferred, false);
  assert.match(rows["team-apply"].flag, /not in the call log/);
  assert.equal(rows["team-review"].flag, "no evidence");
});

test("review and summary are inferred from what next-action saw", () => {
  const rows = Object.fromEntries(skillEvidence({ calls: [call({ cmd: "next-action", detail: "summary" })] }).map((r) => [r.skill, r]));
  assert.equal(rows["team-review"].inferred, true);
  assert.equal(rows["team-summary"].inferred, false);
  const after = Object.fromEntries(skillEvidence({ calls: [call({ cmd: "next-action", detail: "wait-gate-2" })] }).map((r) => [r.skill, r]));
  assert.equal(after["team-summary"].inferred, true);
});

// ---- the discovery hook ----
const HOOK = path.join(DIR, "..", "scripts", "team-hook.mjs");
const runHook = (event, stdin, env = {}) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hook-home-"));
  const r = spawnSync(process.execPath, [HOOK, event], { input: stdin, encoding: "utf8", env: { ...process.env, TEAM_HOME: home, ...env } });
  const file = path.join(home, "hooks", "events.jsonl");
  const rows = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { r, rows, home };
};

test("hook sees a SKILL.md read in camelCase and snake_case payloads, and stores no values", () => {
  const camel = runHook("postToolUse", JSON.stringify({ toolName: "read_file", toolArgs: JSON.stringify({ filePath: "C:\\repo\\.github\\skills\\team-run\\SKILL.md", secret: "TOPSECRET" }) }));
  assert.equal(camel.r.status, 0);
  assert.equal(camel.r.stdout.trim(), "{}");
  assert.equal(camel.rows[0].skill, "team-run");
  assert.equal(camel.rows[0].tool, "read_file");
  assert.deepEqual(camel.rows[0].arg_keys.sort(), ["filePath", "secret"]);
  assert.ok(!JSON.stringify(camel.rows).includes("TOPSECRET"));
  const snake = runHook("PostToolUse", JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/home/u/.copilot/skills/team-apply/SKILL.md" }, session_id: "s" }));
  assert.equal(snake.rows[0].skill, "team-apply");
  assert.ok(snake.rows[0].payload_keys.includes("session_id"));
});

test("hook ignores other files, survives bad input, and can be turned off", () => {
  assert.equal(runHook("postToolUse", JSON.stringify({ toolName: "read_file", toolArgs: { path: "/repo/src/App.java" } })).rows[0].skill, null);
  const bad = runHook("postToolUse", "not json at all");
  assert.equal(bad.r.status, 0);
  assert.equal(bad.r.stdout.trim(), "{}");
  assert.equal(bad.rows.length, 1);
  assert.equal(runHook("postToolUse", "{}", { TEAM_HOOK_LOG: "off" }).rows.length, 0);
  const none = runHook("sessionStart", "");
  assert.equal(none.r.status, 0);
});

test("the report shows skill evidence from the call log and the hook log", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "otel-home-"));
  fs.mkdirSync(path.join(home, "calls"), { recursive: true });
  fs.mkdirSync(path.join(home, "hooks"), { recursive: true });
  const t = Date.now() - 120000;
  const rows = [
    call({ ticket: "PROJ-8", cmd: "note-skill", detail: "team-run (orchestrator)", start_ms: t, end_ms: t + 50, state_before: null, state_after: null }),
    call({ ticket: "PROJ-8", cmd: "init-change", start_ms: t + 1000, end_ms: t + 1100, state_before: null, state_after: "explored" }),
  ];
  fs.writeFileSync(path.join(home, "calls", "PROJ-8.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(path.join(home, "hooks", "events.jsonl"), JSON.stringify({ at_ms: t + 500, event: "postToolUse", tool: "read_file", skill: "team-explore", arg_keys: [], payload_keys: [] }) + "\n");
  const rep = spawnSync(process.execPath, [path.join(DIR, "otel-report.mjs"), "PROJ-8", "--home", home, "--json"], { encoding: "utf8" });
  assert.equal(rep.status, 0, rep.stderr);
  const j = JSON.parse(rep.stdout);
  const byName = Object.fromEntries(j.skillEvidence.map((e) => [e.skill, e]));
  assert.equal(byName["team-explore"].hook, true);
  assert.equal(byName["team-explore"].inferred, true);
  assert.equal(byName["team-run"].noted, true);
  const txt = spawnSync(process.execPath, [path.join(DIR, "otel-report.mjs"), "PROJ-8", "--home", home], { encoding: "utf8" }).stdout;
  assert.match(txt, /Skill evidence \(hook events in window: 1\)/);
  assert.match(txt, /team-explore\s+-\s+yes\s+yes/);
});

// ---- real payload shape seen in VS Code, and tying a hook event to an agent ----
test("hook stores ids, repo name and model, and nothing else from the payload", () => {
  const repo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hk-")), "order-service");
  fs.mkdirSync(path.join(repo, ".team", "changes"), { recursive: true });
  const sub = path.join(repo, "src");
  fs.mkdirSync(sub);
  const payload = { timestamp: "t", hook_event_name: "PostToolUse", session_id: "sess-1", transcript_path: "C:/secret/transcript.json",
    tool_name: "read_file", tool_input: { filePath: "/x/.github/skills/team-propose/SKILL.md", startLine: 1, endLine: 9 }, tool_response: "TOP SECRET FILE TEXT", tool_use_id: "call_abc", cwd: sub };
  const { r, rows } = runHook("postToolUse", JSON.stringify(payload));
  assert.equal(r.status, 0);
  const e = rows[0];
  assert.equal(e.skill, "team-propose");
  assert.equal(e.skill_src, ".github");
  assert.equal(e.session, "sess-1");
  assert.equal(e.tool_use_id, "call_abc");
  assert.equal(e.repo, "order-service");
  const text = JSON.stringify(rows);
  assert.ok(!text.includes("TOP SECRET") && !text.includes("transcript.json") && !text.includes(repo));
  const start = runHook("sessionStart", JSON.stringify({ hook_event_name: "SessionStart", session_id: "s", source: "new", model: "gpt-x", cwd: sub }));
  assert.equal(start.rows[0].model, "gpt-x");
  assert.equal(start.rows[0].source, "new");
});

test("a tool span takes its role from the nearest parent that has an agent", () => {
  const spans = [
    S({ span: "root", name: "invoke_agent qe", kind: "agent", agent: "qe" }),
    S({ span: "llm", parent: "root", name: "chat m", kind: "chat", agent: "tool/runSubagent-qe" }),
    S({ span: "tool", parent: "llm", name: "execute_tool read_file", kind: "tool", tool: "read_file", callId: "call_1" }),
    S({ span: "orphan", name: "execute_tool read_file", kind: "tool", tool: "read_file" }),
  ];
  const byId = new Map(spans.map((s) => [s.span, s]));
  assert.equal(resolveRole(byId.get("tool"), byId), "qe (subagent)");
  assert.equal(resolveRole(byId.get("orphan"), byId), null);
  assert.equal(roleOf(S({ agent: "panel/editAgent" })), "main chat");
  assert.equal(roleOf(S({ agent: "title" })), "helper");
});

test("the report says which agent read each skill, joining hook events to spans by tool call id", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "otel-home-"));
  for (const d of ["calls", "hooks", path.join("telemetry", "spool")]) fs.mkdirSync(path.join(home, d), { recursive: true });
  const t = Date.now() - 120000;
  fs.writeFileSync(path.join(home, "calls", "PROJ-8.jsonl"), JSON.stringify(call({ ticket: "PROJ-8", cmd: "init-change", start_ms: t + 5000, end_ms: t + 5100, state_before: null, state_after: "explored" })) + "\n");
  const spans = [
    S({ trace: "T1", span: "root", name: "invoke_agent qe", kind: "agent", agent: "qe", start: t, end: t + 9000, conv: "C1" }),
    chat({ trace: "T1", span: "llm", parent: "root", agent: "tool/runSubagent-qe", start: t + 100, end: t + 900, conv: "C1" }),
    S({ trace: "T1", span: "rd", parent: "llm", name: "execute_tool read_file", kind: "tool", tool: "read_file", callId: "call_77", start: t + 1000, end: t + 1100, conv: "C1" }),
    terminal({ trace: "T1", span: "term", parent: "llm", start: t + 4000, end: t + 6000, conv: "C1" }),
  ];
  fs.writeFileSync(path.join(home, "telemetry", "spool", "d.jsonl"), spans.map((s) => JSON.stringify(s)).join("\n") + "\n");
  fs.writeFileSync(path.join(home, "hooks", "events.jsonl"), JSON.stringify({ at_ms: t + 1050, event: "postToolUse", tool: "read_file", skill: "team-test-plan", tool_use_id: "call_77", repo: "order-service", arg_keys: [], payload_keys: [] }) + "\n");
  const j = JSON.parse(spawnSync(process.execPath, [path.join(DIR, "otel-report.mjs"), "PROJ-8", "--home", home, "--json"], { encoding: "utf8" }).stdout);
  const row = j.skillEvidence.find((e) => e.skill === "team-test-plan");
  assert.equal(row.hook, true);
  assert.deepEqual(row.hookBy, ["qe (subagent)"]);
});

test("a hook id with a longer suffix still finds its span", () => {
  const sp = { span: "a" };
  const m = new Map([["call_ABCDEFGHIJKLMNOPQRSTUVWXYZ1", sp]]);
  assert.equal(findSpanByCallId("call_ABCDEFGHIJKLMNOPQRSTUVWXYZ1__vscode-1761234567890", m), sp);
  assert.equal(findSpanByCallId("call_ABCDEFGHIJKLMNOPQRSTUVWXYZ1", m), sp);
  assert.equal(findSpanByCallId("call_other", m), null);
  assert.equal(findSpanByCallId(null, m), null);
});

test("a skill that was only read is flagged as loaded, not applied", () => {
  const rows = skillEvidence({ calls: [], hookSkills: ["team-review"] });
  const r = rows.find((e) => e.skill === "team-review");
  assert.equal(r.hook, true);
  assert.match(r.flag, /loaded only/);
});

test("a hook event from the folder VS Code is open on still counts when its tool call belongs to the ticket", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "otel-home-"));
  for (const d of ["calls", "hooks", path.join("telemetry", "spool")]) fs.mkdirSync(path.join(home, d), { recursive: true });
  const t = Date.now() - 120000;
  fs.writeFileSync(path.join(home, "calls", "PROJ-9.jsonl"), JSON.stringify(call({ ticket: "PROJ-9", cmd: "init-change", start_ms: t + 5000, end_ms: t + 5100, state_before: null, state_after: "explored" })) + "\n");
  const spans = [
    S({ trace: "T1", span: "root", name: "invoke_agent", kind: "agent", agent: "orchestrator", start: t, end: t + 9000, conv: "C1" }),
    chat({ trace: "T1", span: "llm", parent: "root", agent: "panel/editAgent", start: t + 100, end: t + 900, conv: "C1" }),
    S({ trace: "T1", span: "rd", parent: "llm", name: "execute_tool read_file", kind: "tool", tool: "read_file", callId: "call_ZZZZZZZZZZZZZZZZZZZZ", start: t + 1000, end: t + 1100, conv: "C1" }),
    terminal({ trace: "T1", span: "term", parent: "llm", start: t + 4000, end: t + 6000, conv: "C1" }),
  ];
  fs.writeFileSync(path.join(home, "telemetry", "spool", "d.jsonl"), spans.map((s) => JSON.stringify(s)).join("\n") + "\n");
  fs.writeFileSync(path.join(home, "hooks", "events.jsonl"), JSON.stringify({ at_ms: t + 1050, event: "postToolUse", tool: "read_file", skill: "team-run", tool_use_id: "call_ZZZZZZZZZZZZZZZZZZZZ__vscode-1", repo: "kit", arg_keys: [], payload_keys: [] }) + "\n");
  const j = JSON.parse(spawnSync(process.execPath, [path.join(DIR, "otel-report.mjs"), "PROJ-9", "--home", home, "--json"], { encoding: "utf8" }).stdout);
  assert.equal(j.hookEvents, 1);
  assert.equal(j.skillEvidence.find((e) => e.skill === "team-run").hook, true);
});

// ---- audit ----
import { flowFromCalls, renderAudit, signalsFor } from "./otel-audit.mjs";

test("flow: time in each state, rework rounds, gate wait and failed calls come from the call log", () => {
  const T = 1_000_000;
  const mk = (cmd, at, before, after, extra = {}) => call({ cmd, start_ms: T + at, end_ms: T + at + 100, state_before: before, state_after: after, code: 0, ...extra });
  const calls = [
    mk("init-change", 0, null, "explored"),
    mk("set-status", 60000, "explored", "proposed", { detail: "proposed" }),
    mk("approve", 360000, "proposed", "approved"),
    mk("set-status", 370000, "approved", "applying"),
    mk("set-status", 400000, "applying", "review"),
    mk("set-status", 460000, "review", "applying"),
    mk("validate-change", 470000, "applying", "applying", { code: 5, reason: "tasks not ticked" }),
    mk("set-status", 480000, "applying", "review"),
  ];
  const f = flowFromCalls(calls);
  assert.equal(f.reworkRounds, 1);
  assert.equal(f.gate1WaitMs, 300000);
  assert.equal(f.finalState, "review");
  assert.deepEqual(f.states.map((s) => s.state), ["explored", "proposed", "approved", "applying", "review", "applying", "review"]);
  assert.equal(f.scriptFailures.length, 1);
  assert.equal(f.scriptFailures[0].reason, "tasks not ticked");
});

test("audit markdown has the sections, the numbers and the signals", () => {
  const report = {
    ticket: "PROJ-1", hookEvents: 5, coverage: { spans: 10, assignedToTicket: 8, calls: 3, matchedCalls: 3 },
    skillEvidence: [{ skill: "team-review", hook: true, inferred: true, noted: false, telemetry: false, hookBy: ["reviewer (subagent)"] }, { skill: "team-summary", hook: false, inferred: false, noted: false, telemetry: false, hookBy: [] }],
    perRepo: { "order-service": {
      total: { credits: 10, llmCalls: 20, tokensIn: 1000, tokensOut: 100, toolErrors: 6, toolCalls: 30 },
      byRole: [{ role: "reviewer (subagent)", credits: 6, llmCalls: 12, tokensIn: 600, tokensOut: 60 }, { role: "main chat", credits: 4, llmCalls: 8, tokensIn: 400, tokensOut: 40 }],
      phases: [{ phase: "review", from: 0, to: 120000, credits: 6, llmCalls: 12, toolCalls: 20, toolErrors: 6, agents: ["reviewer (subagent)"], loops: [{ tool: "read_file", count: 4 }] }],
      toolsByRole: [{ role: "reviewer (subagent)", tool: "read_file", count: 50 }],
      failures: [{ role: "reviewer (subagent)", tool: "read_file", error: "Error", count: 6 }],
    } },
  };
  const flow = { wallMs: 600000, states: [{ state: "review", at: 0, ms: 120000, open: true }], reworkRounds: 1, gate1WaitMs: 300000, scriptFailures: [{ cmd: "validate-change", detail: "review", code: 5, reason: "tasks not ticked" }], finalState: "review" };
  const md = renderAudit(report, flow, { generated: "test" });
  for (const part of ["# Audit: PROJ-1", "## Signals", "## Cost by role", "## Cost by phase", "## Flow", "## Skills", "## Failures", "## Coverage", "reviewer (subagent)", "Rework rounds: 1", "exit 5, tasks not ticked", "waiting at Gate 1"]) assert.ok(md.includes(part), part);
  const sig = signalsFor(report, flow).join("\n");
  assert.match(sig, /reviewer \(subagent\) used 60% of the credits/);
  assert.match(sig, /50 read_file calls/);
  assert.match(sig, /read_file failed 4 times in a row/);
  assert.match(sig, /1 rework round:/);
  assert.match(sig, /No evidence for: team-summary/);
});

test("report --md --out writes the audit file", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "otel-home-"));
  for (const d of ["calls", "hooks", path.join("telemetry", "spool")]) fs.mkdirSync(path.join(home, d), { recursive: true });
  const t = Date.now() - 120000;
  fs.writeFileSync(path.join(home, "calls", "PROJ-12.jsonl"), JSON.stringify(call({ ticket: "PROJ-12", cmd: "init-change", start_ms: t + 5000, end_ms: t + 5100, state_before: null, state_after: "explored" })) + "\n");
  const out = path.join(home, "out", "PROJ-12-audit.md");
  const r = spawnSync(process.execPath, [path.join(DIR, "otel-report.mjs"), "PROJ-12", "--home", home, "--md", "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(out, "utf8"), /# Audit: PROJ-12/);
});

test("a retried subagent call gets its own role label", () => {
  assert.equal(roleOf(S({ agent: "retry-error-tool/runSubagent-reviewer" })), "reviewer (subagent retry)");
  assert.equal(roleOf(S({ agent: "tool/runSubagent-reviewer" })), "reviewer (subagent)");
});

test("an audit call counts as evidence that team-summary ran", () => {
  const rows = skillEvidence({ calls: [call({ cmd: "audit", code: 0 })], hookSkills: ["team-summary"] });
  const r = rows.find((e) => e.skill === "team-summary");
  assert.equal(r.inferred, true);
  assert.equal(r.flag, null);
});

test("hook classifies the path the agent used without keeping it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-"));
  fs.writeFileSync(path.join(dir, "a.txt"), "x");
  const check = (args) => runHook("postToolUse", JSON.stringify({ hook_event_name: "PostToolUse", session_id: "s", tool_name: "read_file", tool_input: args, tool_use_id: "c", cwd: dir })).rows[0].path_check;
  assert.equal(check({ filePath: path.join(dir, "a.txt") }), "ok");
  assert.equal(check({ filePath: dir }), "directory");
  assert.equal(check({ filePath: path.join(dir, "nope.txt") }), "missing");
  assert.equal(check({ filePath: "src/a.txt" }), "relative");
  assert.equal(check({ filePath: "C:\\Users\\somebody-else-entirely\\x\\y.txt" }), "wrong-home");
  const text = JSON.stringify(runHook("postToolUse", JSON.stringify({ tool_name: "read_file", tool_input: { filePath: path.join(dir, "nope.txt") }, cwd: dir })).rows);
  assert.ok(!text.includes("nope.txt"));
});

test("hook adds whether the path is outside the session folder or in a dot folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  fs.mkdirSync(path.join(dir, ".team"));
  const row = (filePath) => runHook("postToolUse", JSON.stringify({ tool_name: "read_file", tool_input: { filePath }, tool_use_id: "c", cwd: dir })).rows[0];
  const inside = row(path.join(dir, ".team", "x.md"));
  assert.equal(inside.path_outside, false);
  assert.equal(inside.path_dot, true);
  const outside = row(path.join(os.tmpdir(), "elsewhere", "y.md"));
  assert.equal(outside.path_outside, true);
  assert.equal(outside.path_dot, false);
  assert.equal(row("src/a.md").path_outside, null);
});

test("failed file calls are grouped by kind of path, with failed of total", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "otel-home-"));
  for (const d of ["calls", "hooks", path.join("telemetry", "spool")]) fs.mkdirSync(path.join(home, d), { recursive: true });
  const t = Date.now() - 120000;
  fs.writeFileSync(path.join(home, "calls", "PROJ-13.jsonl"), JSON.stringify(call({ ticket: "PROJ-13", cmd: "init-change", start_ms: t + 5000, end_ms: t + 5100, state_before: null, state_after: "explored" })) + "\n");
  const id = (n) => `call_${String(n).repeat(24)}`;
  const spans = [
    S({ trace: "T1", span: "root", name: "invoke_agent", kind: "agent", agent: "dev", start: t, end: t + 9000, conv: "C1" }),
    chat({ trace: "T1", span: "llm", parent: "root", agent: "tool/runSubagent-dev", start: t + 100, end: t + 900, conv: "C1" }),
    S({ trace: "T1", span: "a", parent: "llm", name: "execute_tool read_file", kind: "tool", tool: "read_file", callId: id(1), err: "Error", start: t + 1000, end: t + 1100, conv: "C1" }),
    S({ trace: "T1", span: "b", parent: "llm", name: "execute_tool read_file", kind: "tool", tool: "read_file", callId: id(2), start: t + 1200, end: t + 1300, conv: "C1" }),
    S({ trace: "T1", span: "c", parent: "llm", name: "execute_tool read_file", kind: "tool", tool: "read_file", callId: id(3), start: t + 1400, end: t + 1500, conv: "C1" }),
    terminal({ trace: "T1", span: "term", parent: "llm", start: t + 4000, end: t + 6000, conv: "C1" }),
  ];
  fs.writeFileSync(path.join(home, "telemetry", "spool", "d.jsonl"), spans.map((s) => JSON.stringify(s)).join("\n") + "\n");
  const ev = (n, extra) => JSON.stringify({ at_ms: t + 1000 + n * 100, event: "postToolUse", tool: "read_file", tool_use_id: id(n) + "__vscode-1", repo: "kit", arg_keys: [], payload_keys: [], ...extra });
  fs.writeFileSync(path.join(home, "hooks", "events.jsonl"), [ev(1, { path_check: "ok", path_outside: true, path_dot: false }), ev(2, { path_check: "ok", path_outside: true, path_dot: false }), ev(3, { path_check: "ok", path_outside: false, path_dot: true })].join("\n") + "\n");
  const j = JSON.parse(spawnSync(process.execPath, [path.join(DIR, "otel-report.mjs"), "PROJ-13", "--home", home, "--json"], { encoding: "utf8" }).stdout);
  assert.equal(j.pathProblems.length, 1);
  assert.deepEqual({ role: j.pathProblems[0].role, kind: j.pathProblems[0].kind, count: j.pathProblems[0].count, total: j.pathProblems[0].total }, { role: "dev (subagent)", kind: "ok+outside", count: 1, total: 2 });
});

test("roleOf names Copilot's built-in execution subagent", () => {
  assert.equal(roleOf({ agent: "executionSubagentTool" }), "execution helper (built-in)");
});

test("attribute ties a team.mjs call to an execution_subagent tool span", () => {
  const spans = [{ span: "t1", kind: "tool", tool: "execution_subagent", start: 1000, end: 5000, trace: "x", conv: "c" }];
  const calls = [{ ticket: "PROJ-1", repo: "r", start_ms: 2500, end_ms: 3000 }];
  const out = attribute(spans, calls);
  assert.equal(out.stats.matchedCalls, 1);
});
