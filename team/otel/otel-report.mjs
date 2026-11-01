#!/usr/bin/env node
// Per-ticket report: credits, tokens, LLM calls, tool errors and loops by phase, from the spool and the call log.
//   node otel-report.mjs PROJ-101 [--home <dir>] [--slack-min 10] [--json]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { flowFromCalls, renderAudit } from "./otel-audit.mjs";
import { attribute, phasesFromCalls, phaseAt, totals, findLoops, dedupe, skillEvidence, roleOf as roleName, resolveRole, findSpanByCallId } from "./otel-lib.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const valueFlags = new Set(["--home", "--slack-min"]);
const ticket = args.find((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));
const home = flag("home", process.env.TEAM_HOME || path.join(os.homedir(), ".copilot", "team"));
const slackMin = Number(flag("slack-min", 10));
const asJson = args.includes("--json");
if (!ticket) { console.error("usage: node otel-report.mjs <TICKET> [--home dir] [--slack-min 10] [--json]"); process.exit(64); }

const callsFile = path.join(home, "calls", `${ticket}.jsonl`);
if (!fs.existsSync(callsFile)) { console.error(`No call log for ${ticket} at ${callsFile}. Run the workflow with team.mjs first.`); process.exit(1); }
const calls = fs.readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
// A repo name guessed by note-skill (before the change folder exists) can be wrong, for example the folder VS Code is open on.
// The repos that ran real commands (init-change, set-status ...) are the truth; when there is exactly one, every note belongs to it.
const realRepos = [...new Set(calls.filter((c) => c.cmd !== "note-skill").map((c) => c.repo).filter((r) => r && r !== "(unknown)"))];
if (realRepos.length === 1) for (const c of calls) if (c.cmd === "note-skill" || !c.repo || c.repo === "(unknown)") c.repo = realRepos[0];
const t0 = Math.min(...calls.map((c) => c.start_ms)) - slackMin * 60000;
const t1 = Math.max(...calls.map((c) => c.end_ms)) + slackMin * 60000;

// Load spool days that overlap the ticket (plus a day either side), then all calls of other tickets in the same window
// so a conversation shared by two tickets is split correctly.
const spoolDir = path.join(home, "telemetry", "spool");
let spans = [];
if (fs.existsSync(spoolDir)) {
  for (const f of fs.readdirSync(spoolDir).filter((f) => f.endsWith(".jsonl")).sort()) {
    for (const l of fs.readFileSync(path.join(spoolDir, f), "utf8").split("\n").filter(Boolean)) {
      try { const s = JSON.parse(l); if (s.end >= t0 - 86400000 && s.start <= t1 + 86400000) spans.push(s); } catch { /* skip a bad line */ }
    }
  }
}
spans = dedupe(spans);
const allCalls = [...calls];
const callsDir = path.join(home, "calls");
for (const f of fs.readdirSync(callsDir)) {
  if (f === `${ticket}.jsonl`) continue;
  for (const l of fs.readFileSync(path.join(callsDir, f), "utf8").split("\n").filter(Boolean)) {
    try { const c = JSON.parse(l); if (c.end_ms >= t0 && c.start_ms <= t1) allCalls.push(c); } catch { /* skip */ }
  }
}

const { result, stats } = attribute(spans, allCalls, { slackMs: slackMin * 60000 });
const mine = spans.filter((_, i) => result[i]?.ticket === ticket);
const how = spans.map((_, i) => result[i]).filter((r) => r?.ticket === ticket);
const repos = [...new Set(calls.map((c) => c.repo))];
const roleOf = (s) => roleName(s) || "(none)";
const cmdCounts = new Map();
const skillNotes = [];
for (const c of calls) {
  const key = c.cmd === "next-action" ? "next-action" : c.cmd;
  cmdCounts.set(key, (cmdCounts.get(key) || 0) + 1);
  if (c.cmd === "note-skill") skillNotes.push(c.detail);
}

// Hook events (written by team-hook.mjs) carry no ticket, so they are matched by time to this ticket's window.
const hookFile = path.join(home, "hooks", "events.jsonl");
const hookAll = [];
if (fs.existsSync(hookFile)) {
  for (const l of fs.readFileSync(hookFile, "utf8").split("\n").filter(Boolean)) {
    try { const e = JSON.parse(l); if (e.at_ms >= t0 && e.at_ms <= t1) hookAll.push(e); } catch { /* skip */ }
  }
}
// The hook only knows the folder VS Code is open on (for example "kit"), which is often not the ticket's repo. Keep an event if it names no repo,
// names one of this ticket's repos, or shares a tool call id with a span assigned to this ticket.
const byId = new Map(spans.map((s) => [s.span, s]));
const byCall = new Map(spans.filter((s) => s.callId).map((s) => [s.callId, s]));
const mineIds = new Set(mine.map((s) => s.span));
const hookEvents = hookAll.filter((e) => {
  if (!e.repo || e.repo === "(unknown)" || repos.includes(e.repo)) return true;
  const sp = findSpanByCallId(e.tool_use_id, byCall);
  return Boolean(sp && mineIds.has(sp.span));
});
const hookSkills = [...new Set(hookEvents.map((e) => e.skill).filter(Boolean))];
const telemetrySkills = [...new Set(mine.map((s) => s.skill).filter(Boolean))];
// A hook event and a telemetry tool span share the tool call id, so a skill read can be tied to the agent that did it.
const hookBy = {};
for (const e of hookEvents) {
  if (!e.skill) continue;
  const sp = findSpanByCallId(e.tool_use_id, byCall);
  const who = (sp && resolveRole(sp, byId)) || "?";
  (hookBy[e.skill] ||= new Set()).add(who);
}
for (const k of Object.keys(hookBy)) hookBy[k] = [...hookBy[k]];
const evidence = skillEvidence({ calls, hookSkills, telemetrySkills, hookBy });
const shape = (s) => (s ? `${String(s).slice(0, 10)}… (len ${String(s).length})` : "none");
const idDiag = {
  hookEventsWithId: hookEvents.filter((e) => e.tool_use_id).length,
  hookEventsMatched: hookEvents.filter((e) => findSpanByCallId(e.tool_use_id, byCall)).length,
  spansWithCallId: byCall.size,
  toolSpans: spans.filter((s) => s.kind === "tool").length,
  hookIdShape: shape(hookEvents.find((e) => e.tool_use_id)?.tool_use_id),
  spanIdShape: shape([...byCall.keys()][0]),
};
const report = { ticket, flow: flowFromCalls(calls), repos, skillEvidence: evidence, idDiag, hookEvents: hookEvents.length, scriptCalls: Object.fromEntries(cmdCounts), skillNotes, repoSpansNote: "agents are by role",  coverage: { ...stats, assignedToTicket: mine.length }, perRepo: {} };
for (const repo of repos) {
  const repoCalls = calls.filter((c) => c.repo === repo);
  const phases = phasesFromCalls(repoCalls);
  const repoSpans = spans.filter((_, i) => result[i]?.ticket === ticket && result[i].repo === repo);
  const buckets = new Map();
  for (const s of repoSpans) {
    const p = phaseAt(phases, (s.start + s.end) / 2) ?? "before init-change (explore)";
    if (!buckets.has(p)) buckets.set(p, []);
    buckets.get(p).push(s);
  }
  const order = ["before init-change (explore)", ...phases.map((p) => p.state)];
  const rows = [];
  for (const name of [...new Set(order)]) {
    const b = buckets.get(name) || [];
    if (!b.length) continue;
    const t = totals(b);
    rows.push({ phase: name, from: b.reduce((m, s) => Math.min(m, s.start), Infinity), to: b.reduce((m, s) => Math.max(m, s.end), 0),
      llmCalls: t.llmCalls, credits: +t.credits.toFixed(3), tokensIn: t.tin, tokensCache: t.tcache, tokensOut: t.tout,
      toolCalls: t.toolCalls, toolErrors: t.toolErrors, agents: [...new Set(b.filter((x) => x.kind === "chat").map(roleOf))], skills: [...t.skills], loops: findLoops(b) });
  }
  // Which tools each role used, and which ones failed with what error type.
  const toolMix = new Map(), failMix = new Map();
  for (const x of repoSpans.filter((x) => x.kind === "tool")) {
    const who = resolveRole(x, byId) || "(none)";
    const k = `${who}|${x.tool || "?"}`;
    toolMix.set(k, (toolMix.get(k) || 0) + 1);
    if (x.err) { const f = `${who}|${x.tool || "?"}|${x.err}`; failMix.set(f, (failMix.get(f) || 0) + 1); }
  }
  const toolsByRole = [...toolMix].map(([k, count]) => { const [role, tool] = k.split("|"); return { role, tool, count }; }).sort((a, b) => b.count - a.count);
  const failures = [...failMix].map(([k, count]) => { const [role, tool, error] = k.split("|"); return { role, tool, error, count }; }).sort((a, b) => b.count - a.count);
  const all = totals(repoSpans);
  const byRole = new Map();
  for (const x of repoSpans.filter((x) => x.kind === "chat")) {
    const k = roleOf(x);
    const r = byRole.get(k) || { role: k, credits: 0, llmCalls: 0, tokensIn: 0, tokensOut: 0 };
    r.credits += x.aiu / 1e9; r.llmCalls++; r.tokensIn += x.tin; r.tokensOut += x.tout;
    byRole.set(k, r);
  }
  report.perRepo[repo] = { toolsByRole, failures, byRole: [...byRole.values()].map((r) => ({ ...r, credits: +r.credits.toFixed(3) })).sort((a, b) => b.credits - a.credits), phases: rows, total: { credits: +all.credits.toFixed(3), llmCalls: all.llmCalls, tokensIn: all.tin, tokensCache: all.tcache, tokensOut: all.tout, toolCalls: all.toolCalls, toolErrors: all.toolErrors }, skills: [...all.skills] };
}
if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
if (args.includes("--md")) {
  const md = renderAudit(report, report.flow);
  const out = flag("out", null);
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, md); console.log(`wrote ${out}`); } else process.stdout.write(md);
  process.exit(0);
}

const n = (x) => x.toLocaleString("en-US");
const mins = (a, b) => (b > a && isFinite(a) ? `${((b - a) / 60000).toFixed(1)} min` : "-");
console.log(`Telemetry for ${ticket}  (${repos.join(", ")})`);
const c = report.coverage;
console.log(`Spans in window: ${c.spans}. Assigned to this ticket: ${c.assignedToTicket}. Calls matched to a terminal span: ${c.matchedCalls} of ${c.calls}.`);
console.log(`  by rule: direct ${c.direct}, same trace ${c.trace}, same conversation ${c.group}. Left out: ${c.outOfSlack} too far from any call, ${c.noGroup} in no ticket conversation.`);
if (c.matchedCalls < c.calls) console.log(`  NOTE: ${c.calls - c.matchedCalls} call(s) matched no terminal span. Check that the collector was running and the terminal tool name matches.`);
console.log(`Script calls: ${[...cmdCounts].map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
console.log(`\nSkill evidence (hook events in window: ${report.hookEvents}${fs.existsSync(hookFile) ? "" : ", hook not installed"})`);
console.log(`  tool-call id join: ${idDiag.hookEventsMatched} of ${idDiag.hookEventsWithId} hook events matched a span (${idDiag.spansWithCallId} of ${idDiag.toolSpans} tool spans carry an id; hook id ${idDiag.hookIdShape}, span id ${idDiag.spanIdShape})`);
console.log(`  ${"skill".padEnd(16)} ${"noted".padEnd(6)} ${"inferred".padEnd(9)} ${"hook".padEnd(5)} ${"telemetry".padEnd(10)} read by / note`);
const mark = (b) => (b ? "yes" : "-");
for (const e of evidence) console.log(`  ${e.skill.padEnd(16)} ${mark(e.noted).padEnd(6)} ${mark(e.inferred).padEnd(9)} ${mark(e.hook).padEnd(5)} ${mark(e.telemetry).padEnd(10)} ${[e.hookBy.length ? e.hookBy.join(", ") : "", e.flag || ""].filter(Boolean).join("  | ")}`);
for (const [repo, r] of Object.entries(report.perRepo)) {
  console.log(`\n== ${repo}: ${r.total.credits} credits, ${r.total.llmCalls} LLM calls, ${r.total.toolCalls} tool calls (${r.total.toolErrors} failed)`);
  console.log(`   tokens: in ${n(r.total.tokensIn)} (cached ${n(r.total.tokensCache)}), out ${n(r.total.tokensOut)}`);
  if (r.skills.length) console.log(`   skills seen in telemetry: ${r.skills.join(", ")}`);
  console.log("   by role:");
  for (const x of r.byRole) console.log(`     ${x.role.padEnd(26)} ${String(x.credits).padStart(7)} cr  ${String(x.llmCalls).padStart(3)} LLM  in ${n(x.tokensIn)}  out ${n(x.tokensOut)}`);
  console.log("   by phase:");
  for (const p of r.phases) {
    console.log(`   ${p.phase.padEnd(30)} ${mins(p.from, p.to).padStart(9)}  ${String(p.credits).padStart(7)} cr  ${String(p.llmCalls).padStart(3)} LLM  ${String(p.toolCalls).padStart(3)} tools  ${String(p.toolErrors).padStart(2)} err  agents: ${p.agents.join(", ") || "-"}`);
    for (const l of p.loops) console.log(`      LOOP: ${l.tool} failed ${l.count} times in a row`);
  }
}

for (const [repo, r] of Object.entries(report.perRepo)) {
  if (r.failures.length) {
    console.log(`\n   failed tool calls (${repo}):`);
    for (const f of r.failures.slice(0, 10)) console.log(`     ${f.role.padEnd(24)} ${f.tool.padEnd(22)} ${String(f.error).padEnd(18)} x${f.count}`);
  }
  console.log(`\n   top tools by role (${repo}):`);
  const seen = {};
  for (const t of r.toolsByRole) { seen[t.role] = (seen[t.role] || 0) + 1; if (seen[t.role] <= 4) console.log(`     ${t.role.padEnd(24)} ${t.tool.padEnd(22)} x${t.count}`); }
}

