// Shared by otel-collect.mjs (writes compact span records) and otel-report.mjs (attributes spans to tickets).
// Pure functions, no I/O, so they can be tested. Node 18+, no dependencies.

// ---------- OTLP/JSON reading ----------
export const val = (v) => {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val);
  return undefined;
};
export const attrs = (list = []) => Object.fromEntries(list.map((a) => [a.key, val(a.value)]));

export function kindOf(name = "") {
  if (name.startsWith("invoke_agent")) return "agent";
  if (name.startsWith("chat ") || name === "chat") return "chat";
  if (name.startsWith("execute_tool")) return "tool";
  if (name.startsWith("execute_hook")) return "hook";
  return "other";
}

const ms = (nano) => Number(BigInt(nano || 0) / 1000000n);

// Turns one OTLP/JSON traces request into compact records. Only an allowlist of metadata is kept.
// Prompt, response, tool arguments and results are never copied, even if the client sends them.
export function compactBody(body) {
  const out = [];
  for (const rs of body?.resourceSpans || []) {
    const res = attrs(rs.resource?.attributes);
    for (const ss of rs.scopeSpans || []) {
      for (const s of ss.spans || []) {
        const a = attrs(s.attributes);
        const rec = {
          v: 1,
          trace: s.traceId,
          span: s.spanId,
          parent: s.parentSpanId || null,
          name: s.name,
          kind: kindOf(s.name),
          start: ms(s.startTimeUnixNano),
          end: ms(s.endTimeUnixNano),
          svc: res["service.name"] ?? null,
          win: res["session.id"] ?? null,
          conv: a["gen_ai.conversation.id"] ?? null,
          chat: a["copilot_chat.chat_session_id"] ?? a["copilot_chat.session_id"] ?? null,
          pchat: a["copilot_chat.parent_chat_session_id"] ?? null,
          agent: a["gen_ai.agent.name"] ?? null,
          mode: a["copilot_chat.mode_name"] ?? null,
          model: a["gen_ai.request.model"] ?? null,
          tool: a["gen_ai.tool.name"] ?? null,
          callId: a["gen_ai.tool.call.id"] ?? null,
          skill: a["github.copilot.tool.parameters.skill_name"] ?? null,
          err: a["error.type"] ?? null,
          tin: a["gen_ai.usage.input_tokens"] ?? 0,
          tout: a["gen_ai.usage.output_tokens"] ?? 0,
          tcache: a["gen_ai.usage.cache_read.input_tokens"] ?? 0,
          treason: a["gen_ai.usage.reasoning.output_tokens"] ?? 0,
          aiu: a["copilot_chat.copilot_usage_nano_aiu"] ?? 0,
          turns: a["copilot_chat.turn_count"] ?? null,
        };
        out.push(rec);
      }
    }
  }
  return out;
}

export function dedupe(spans) {
  const seen = new Set();
  return spans.filter((s) => (seen.has(s.span) ? false : (seen.add(s.span), true)));
}

// ---------- attributing spans to tickets ----------
class UnionFind {
  constructor() { this.p = new Map(); }
  find(k) {
    if (!this.p.has(k)) this.p.set(k, k);
    let r = k;
    while (this.p.get(r) !== r) r = this.p.get(r);
    while (this.p.get(k) !== r) { const n = this.p.get(k); this.p.set(k, r); k = n; }
    return r;
  }
  union(a, b) { this.p.set(this.find(a), this.find(b)); }
}

const spanKeys = (s) => [s.trace && `t:${s.trace}`, s.conv && `c:${s.conv}`, s.chat && `s:${s.chat}`, s.pchat && `s:${s.pchat}`].filter(Boolean);

// calls: records from the call log: { ticket, repo, start_ms, end_ms, ... }
// Rule 1: a team.mjs call that happened inside a terminal tool span ties that span to the call's ticket.
// Rule 2: spans that share a trace, conversation or chat session (a subagent links to its parent chat session) with such a span
//         belong to the same ticket. If one conversation covers several tickets, a span goes to the nearest call in time.
// Rule 3: spans farther than slackMs from every call in their group stay unassigned.
export function attribute(spans, calls, { slackMs = 10 * 60 * 1000, tolMs = 2000, terminalRe = /terminal|bash|shell|powershell|cmd/i } = {}) {
  const uf = new UnionFind();
  for (const s of spans) { const k = spanKeys(s); for (let i = 1; i < k.length; i++) uf.union(k[0], k[i]); }

  const terminals = spans.filter((s) => s.kind === "tool" && s.tool && terminalRe.test(s.tool));
  const groupCalls = new Map(); // root -> [call]
  const directTraces = new Set();
  const directSpans = new Set();
  let matchedCalls = 0;
  for (const c of calls) {
    let best = null;
    for (const t of terminals) {
      if (c.start_ms >= t.start - tolMs && c.end_ms <= t.end + tolMs) {
        if (!best || t.end - t.start < best.end - best.start) best = t;
      }
    }
    if (!best) continue;
    matchedCalls++;
    directSpans.add(best.span);
    directTraces.add(best.trace);
    const k = spanKeys(best)[0];
    if (!k) continue;
    const root = uf.find(k);
    if (!groupCalls.has(root)) groupCalls.set(root, []);
    groupCalls.get(root).push(c);
  }

  const distance = (s, c) => (s.end < c.start_ms ? c.start_ms - s.end : s.start > c.end_ms ? s.start - c.end_ms : 0);
  const result = new Array(spans.length).fill(null);
  const stats = { spans: spans.length, calls: calls.length, matchedCalls, direct: 0, trace: 0, group: 0, outOfSlack: 0, noGroup: 0 };
  spans.forEach((s, i) => {
    const k = spanKeys(s)[0];
    const cs = k ? groupCalls.get(uf.find(k)) : null;
    if (!cs) { stats.noGroup++; return; }
    let near = null, d = Infinity;
    for (const c of cs) { const x = distance(s, c); if (x < d) { d = x; near = c; } }
    if (directSpans.has(s.span)) { result[i] = { ticket: near.ticket, repo: near.repo, how: "direct" }; stats.direct++; return; }
    if (d > slackMs) { stats.outOfSlack++; return; }
    const how = directTraces.has(s.trace) ? "trace" : "group";
    result[i] = { ticket: near.ticket, repo: near.repo, how };
    stats[how]++;
  });
  return { result, stats };
}

// ---------- phases from the call log ----------
// A call that changed the state starts a new phase. Returns [{ state, from }] sorted by time.
export function phasesFromCalls(calls) {
  const rows = calls.filter((c) => c.state_after).sort((a, b) => a.end_ms - b.end_ms);
  const phases = [];
  for (const c of rows) {
    if (!phases.length || phases[phases.length - 1].state !== c.state_after) phases.push({ state: c.state_after, from: c.end_ms });
  }
  return phases;
}
export function phaseAt(phases, t) {
  let cur = null;
  for (const p of phases) if (p.from <= t) cur = p.state; else break;
  return cur;
}

// ---------- totals ----------
export function totals(spans) {
  const t = { llmCalls: 0, tin: 0, tout: 0, tcache: 0, treason: 0, credits: 0, toolCalls: 0, toolErrors: 0, agents: new Set(), skills: new Set() };
  for (const s of spans) {
    if (s.kind === "chat") { t.llmCalls++; t.tin += s.tin; t.tout += s.tout; t.tcache += s.tcache; t.treason += s.treason; t.credits += s.aiu / 1e9; }
    if (s.kind === "tool") { t.toolCalls++; if (s.err) t.toolErrors++; if (s.skill) t.skills.add(s.skill); }
    if ((s.kind === "agent" || s.kind === "chat") && s.agent) t.agents.add(s.agent);
  }
  return t;
}

// Same tool failing n times in a row (by start time) inside one conversation group. Returns [{tool, count}].
export function findLoops(spans, n = 3) {
  const tools = spans.filter((s) => s.kind === "tool").sort((a, b) => a.start - b.start);
  const loops = [];
  let run = [];
  const flush = () => { if (run.length >= n) loops.push({ tool: run[0].tool, count: run.length }); run = []; };
  for (const s of tools) {
    if (s.err && run.length && run[0].tool === s.tool) run.push(s);
    else { flush(); if (s.err) run = [s]; }
  }
  flush();
  return loops;
}

// ---------- which skills ran ----------
// Four kinds of evidence, none of them trusted alone:
//   noted     the skill called `team note-skill` as its first action (the agent can skip this)
//   inferred  the call log shows a step only that skill performs (the agent cannot skip it if the step happened)
//   hook      a Copilot hook saw SKILL.md being read
//   telemetry an execute_tool span carried skill_name
export const SKILLS = [
  { name: "team-run", agent: "orchestrator", says: "a next-action call", test: (c) => c.cmd === "next-action" },
  { name: "team-explore", agent: "orchestrator", says: "init-change", test: (c) => c.cmd === "init-change" },
  { name: "team-propose", agent: "orchestrator", says: "set-status proposed", test: (c) => c.cmd === "set-status" && c.detail === "proposed" },
  { name: "team-test-plan", agent: "qe", says: "set-ready test_plan (the draft pass leaves no call)", test: (c) => c.cmd === "set-ready" },
  { name: "team-apply", agent: "dev", says: "set-status applying", test: (c) => c.cmd === "set-status" && c.detail === "applying" },
  { name: "team-review", agent: "reviewer", says: "next-action saw review.md (summary or wait-gate-2)", test: (c) => c.cmd === "next-action" && /^(summary|wait-gate-2)/.test(c.detail || "") },
  { name: "team-summary", agent: "orchestrator", says: "next-action saw the summary (wait-gate-2)", test: (c) => c.cmd === "next-action" && /^wait-gate-2/.test(c.detail || "") },
];

export function skillEvidence({ calls = [], hookSkills = [], telemetrySkills = [], hookBy = {} }) {
  const ok = calls.filter((c) => !c.code);
  const noted = new Set(calls.filter((c) => c.cmd === "note-skill").map((c) => String(c.detail || "").split(" ")[0]));
  const hook = new Set(hookSkills);
  const tele = new Set(telemetrySkills);
  return SKILLS.map((k) => {
    const row = { skill: k.name, agent: k.agent, noted: noted.has(k.name), inferred: ok.some(k.test), hook: hook.has(k.name), hookBy: hookBy[k.name] || [], telemetry: tele.has(k.name), signature: k.says };
    const seen = row.noted || row.inferred || row.hook || row.telemetry;
    if (!seen) row.flag = "no evidence";
    else if (row.inferred && !row.noted && !row.hook && !row.telemetry) row.flag = "step happened but no read of the skill was seen: the hook is not installed or did not fire, or the step ran without the skill";
    else if (row.noted && !row.inferred && !["team-test-plan", "team-summary"].includes(k.name)) row.flag = "skill started but its step is not in the call log yet";
    else if (row.hook && !row.noted && !row.inferred && !row.telemetry) row.flag = "loaded only: read but no step followed, so it was not applied";
    else row.flag = null;
    return row;
  });
}

// ---------- who did it ----------
// Friendly names for the agent labels Copilot uses.
export function roleOf(s) {
  const a = s.agent || "";
  const sub = /^tool\/runSubagent-(.+)$/.exec(a);
  if (sub) return `${sub[1]} (subagent)`;
  if (a === "panel/editAgent" || a === "GitHub Copilot Chat") return s.mode ? `main [${s.mode}]` : "main chat";
  if (["title", "progressMessages"].includes(a) || a.startsWith("copilotLanguageModelWrapper")) return "helper";
  return a || null;
}
// A tool span has no agent name of its own. Walk up its parents until a span that has one.
export function resolveRole(span, byId) {
  let s = span;
  for (let i = 0; i < 20 && s; i++) {
    const r = roleOf(s);
    if (r) return r;
    s = s.parent ? byId.get(s.parent) : null;
  }
  return null;
}

// The hook reports a longer id than the span (for example the span id plus a "__vscode-..." suffix). Match exactly, then by the part before "__", then by prefix.
export function findSpanByCallId(hookId, byCall) {
  if (!hookId) return null;
  if (byCall.has(hookId)) return byCall.get(hookId);
  const head = String(hookId).split("__")[0];
  if (byCall.has(head)) return byCall.get(head);
  for (const [k, s] of byCall) if (k.length >= 16 && String(hookId).startsWith(k)) return s;
  return null;
}
