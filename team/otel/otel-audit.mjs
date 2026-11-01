// Turns the ticket report (otel-report.mjs --json) and the call log into a markdown audit of one ticket's workflow run. Pure functions, no I/O.
// Everything in it is a measured number or a plain statement of what the data shows. There is no advice text.

const min = (ms) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`);
const n = (x) => Number(x).toLocaleString("en-US");

// What the script calls say about the flow: time in each state, rework rounds, how long the human gates took, failed calls.
export function flowFromCalls(calls) {
  const rows = [...calls].sort((a, b) => a.start_ms - b.start_ms);
  if (!rows.length) return { wallMs: 0, states: [], reworkRounds: 0, gate1WaitMs: null, scriptFailures: [], finalState: null };
  const first = rows[0].start_ms, last = Math.max(...rows.map((c) => c.end_ms));
  const moves = rows.filter((c) => c.code === 0 && c.state_after && c.state_after !== c.state_before);
  const states = moves.map((m, i) => ({ state: m.state_after, at: m.end_ms, ms: (moves[i + 1]?.end_ms ?? last) - m.end_ms, open: !moves[i + 1] }));
  const reworkRounds = moves.filter((m) => m.state_before === "review" && m.state_after === "applying").length;
  const proposed = moves.find((m) => m.state_after === "proposed");
  const approved = moves.find((m) => m.state_after === "approved");
  return {
    wallMs: last - first,
    states,
    reworkRounds,
    gate1WaitMs: proposed && approved ? approved.end_ms - proposed.end_ms : null,
    scriptFailures: rows.filter((c) => c.code).map((c) => ({ cmd: c.cmd, detail: c.detail || "", code: c.code, reason: c.reason || "" })),
    finalState: moves.length ? moves[moves.length - 1].state_after : rows[rows.length - 1].state_after || null,
  };
}

function table(head, body) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...body.map(line)].join("\n");
}

// Rule based signals. Each one states a fact with its numbers.
export function signalsFor(report, flow) {
  const out = [];
  for (const [repo, r] of Object.entries(report.perRepo)) {
    const total = r.total.credits || 0;
    for (const role of r.byRole) {
      const share = total ? role.credits / total : 0;
      if (share >= 0.4 && r.byRole.length > 1) out.push(`${repo}: ${role.role} used ${Math.round(share * 100)}% of the credits (${role.credits} of ${total}, ${role.llmCalls} LLM calls).`);
    }
    for (const t of r.toolsByRole) if (t.tool === "read_file" && t.count >= 40) out.push(`${repo}: ${t.role} made ${t.count} read_file calls.`);
    if (r.total.toolErrors >= 5) out.push(`${repo}: ${r.total.toolErrors} tool calls failed.`);
    for (const p of r.phases) for (const l of p.loops || []) out.push(`${repo}: in ${p.phase}, ${l.tool} failed ${l.count} times in a row.`);
  }
  if (flow.reworkRounds) out.push(`${flow.reworkRounds} rework round${flow.reworkRounds > 1 ? "s" : ""}: review sent the change back to applying.`);
  if (flow.scriptFailures.length) out.push(`${flow.scriptFailures.length} team.mjs call${flow.scriptFailures.length > 1 ? "s" : ""} exited non-zero.`);
  const unseen = (report.skillEvidence || []).filter((e) => !e.noted && !e.inferred && !e.hook && !e.telemetry).map((e) => e.skill);
  if (report.hookEvents === 0) out.push("No hook events were found for this ticket: the hook is not installed, or did not fire.");
  else if (report.hookEvents > 0 && unseen.length && flow.finalState && flow.finalState !== "explored") out.push(`No evidence for: ${unseen.join(", ")}.`);
  const badPaths = (report.pathProblems || []).reduce((n, p) => n + p.count, 0);
  if (badPaths) out.push(`${badPaths} file or folder tool call${badPaths > 1 ? "s" : ""} used a path that did not exist or was a folder (${[...new Set(report.pathProblems.map((p) => `${p.role} ${p.tool}`))].slice(0, 3).join(", ")}).`);
  const c = report.coverage || {};
  if (c.calls && c.matchedCalls < c.calls) out.push(`${c.calls - c.matchedCalls} script call(s) matched no terminal span, so some spans may be unassigned.`);
  return out;
}

export function renderAudit(report, flow, opts = {}) {
  const L = [];
  const repos = Object.keys(report.perRepo);
  const credits = repos.reduce((s, r) => s + report.perRepo[r].total.credits, 0);
  const llm = repos.reduce((s, r) => s + report.perRepo[r].total.llmCalls, 0);
  const tin = repos.reduce((s, r) => s + report.perRepo[r].total.tokensIn, 0);
  const tout = repos.reduce((s, r) => s + report.perRepo[r].total.tokensOut, 0);
  L.push(`# Audit: ${report.ticket}`);
  L.push("");
  L.push(`Repo${repos.length > 1 ? "s" : ""}: ${repos.join(", ") || "(none)"}. Final state: ${flow.finalState || "unknown"}. Generated ${opts.generated || new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"}.`);
  L.push(`From the first to the last team.mjs call: ${min(flow.wallMs)}${flow.gate1WaitMs != null ? ` (of which ${min(flow.gate1WaitMs)} waiting at Gate 1)` : ""}.`);
  L.push(`Credits: ${credits.toFixed(2)}. LLM calls: ${llm}. Tokens in ${n(tin)}, out ${n(tout)}.`);

  L.push("", "## Signals", "");
  const sig = signalsFor(report, flow);
  L.push(...(sig.length ? sig.map((s) => `- ${s}`) : ["- none"]));

  for (const repo of repos) {
    const r = report.perRepo[repo];
    L.push("", `## Cost by role${repos.length > 1 ? `: ${repo}` : ""}`, "");
    L.push(table(["role", "credits", "share", "LLM calls", "tokens in", "tokens out"],
      r.byRole.map((x) => [x.role, x.credits, r.total.credits ? `${Math.round((x.credits / r.total.credits) * 100)}%` : "-", x.llmCalls, n(x.tokensIn), n(x.tokensOut)])));
    L.push("", `## Cost by phase${repos.length > 1 ? `: ${repo}` : ""}`, "");
    L.push(table(["phase", "time", "credits", "LLM calls", "tool calls", "failed", "agents"],
      r.phases.map((p) => [p.phase, min(Math.max(0, p.to - p.from)), p.credits, p.llmCalls, p.toolCalls, p.toolErrors, p.agents.join(", ")])));
  }

  L.push("", "## Flow", "");
  if (flow.states.length) {
    L.push(table(["state", "time in state"], flow.states.map((s) => [s.state, s.open ? `${min(s.ms)} (until the last call)` : min(s.ms)])));
    L.push("", `Rework rounds: ${flow.reworkRounds}.`);
  } else L.push("No state changes recorded.");

  L.push("", "## Skills", "");
  L.push(table(["skill", "read by", "evidence"], (report.skillEvidence || []).map((e) => {
    const ev = [e.hook && "hook read", e.inferred && "step in call log", e.noted && "noted", e.telemetry && "telemetry"].filter(Boolean).join(", ") || "none";
    return [e.skill, (e.hookBy || []).join(", ") || "-", ev];
  })));

  const paths = report.pathProblems || [];
  const fails = repos.flatMap((repo) => report.perRepo[repo].failures.map((f) => ({ repo, ...f })));
  if (flow.scriptFailures.length || fails.length || paths.length) {
    L.push("", "## Failures", "");
    if (flow.scriptFailures.length) {
      L.push("team.mjs calls:", "");
      for (const f of flow.scriptFailures) L.push(`- ${f.cmd}${f.detail ? " " + f.detail : ""}: exit ${f.code}${f.reason ? ", " + f.reason : ""}`);
      L.push("");
    }
    if (fails.length) {
      L.push("Tool calls:", "");
      L.push(table(["role", "tool", "error", "count"], fails.slice(0, 10).map((f) => [f.role, f.tool, f.error, f.count])));
      L.push("");
    }
    if (paths.length) {
      L.push("Paths that did not exist (seen by the hook):", "");
      L.push(table(["role", "tool", "kind", "count"], paths.slice(0, 10).map((p) => [p.role, p.tool, p.kind, p.count])));
    }
  }

  L.push("", "## Coverage", "");
  const c = report.coverage || {};
  L.push(`Spans in the window: ${c.spans ?? "?"}. Assigned to this ticket: ${c.assignedToTicket ?? "?"}. Calls matched to a terminal span: ${c.matchedCalls ?? "?"} of ${c.calls ?? "?"}. Hook events: ${report.hookEvents ?? 0}.`);
  L.push("Credits come from Copilot's telemetry (`copilot_usage_nano_aiu` divided by 1e9). Spans are tied to the ticket by the time of its team.mjs calls.");
  return L.join("\n") + "\n";
}
