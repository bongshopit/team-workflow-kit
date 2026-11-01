#!/usr/bin/env node
// Discovery hook for Copilot agent hooks (VS Code preview, Copilot CLI). Node 18+, no dependencies.
// Called as:  node team-hook.mjs <eventName>      with the event JSON on stdin.
// It writes one line per event to <TEAM_HOME>/hooks/events.jsonl, so the report can see which skills were read
// and what the hook payload looks like. It stores names only: the event, the tool, the argument KEY names,
// a skill name when a SKILL.md path appears in the arguments, the session and tool-call ids, the repo name taken from the cwd, and the model on session start.
// Argument values, tool responses, prompts, transcript paths and file contents are never stored.
// It never blocks anything: it always prints {} and exits 0. TEAM_HOOK_LOG=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_LOG_BYTES = 5 * 1024 * 1024; // discovery only: stop writing past this size
const SKILL_RE = /[\\/]skills[\\/]([^\\/\s"']+)[\\/]SKILL\.md/i;

function findSkill(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") {
    const m = SKILL_RE.exec(value);
    if (m) return m[1];
    if (/^\s*[{[]/.test(value)) { try { return findSkill(JSON.parse(value), depth + 1); } catch { return null; } }
    return null;
  }
  if (Array.isArray(value)) { for (const v of value) { const s = findSkill(v, depth + 1); if (s) return s; } return null; }
  if (typeof value === "object") { for (const v of Object.values(value)) { const s = findSkill(v, depth + 1); if (s) return s; } }
  return null;
}
// Which kind of folder the skill came from (".github", ".copilot", ".claude", ...). Only that one folder name is kept, never the path.
const SRC_RE = /([^\\/\s"']+)[\\/]skills[\\/][^\\/\s"']+[\\/]SKILL\.md/i;
function findSkillSrc(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") {
    const m = SRC_RE.exec(value);
    if (m) return m[1];
    if (/^\s*[{[]/.test(value)) { try { return findSkillSrc(JSON.parse(value), depth + 1); } catch { return null; } }
    return null;
  }
  if (Array.isArray(value)) { for (const v of value) { const x = findSkillSrc(v, depth + 1); if (x) return x; } return null; }
  if (typeof value === "object") { for (const v of Object.values(value)) { const x = findSkillSrc(v, depth + 1); if (x) return x; } }
  return null;
}
function keysOf(value) {
  if (typeof value === "string" && /^\s*\{/.test(value)) { try { value = JSON.parse(value); } catch { return []; } }
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

// The repo is the nearest folder above the cwd that holds .team/changes, else the nearest git root. Only its name is stored, never the path.
function repoFromCwd(cwd) {
  if (typeof cwd !== "string" || !cwd) return null;
  let dir = path.resolve(cwd), git = null;
  for (let i = 0; i < 15; i++) {
    try {
      if (fs.existsSync(path.join(dir, ".team", "changes"))) return path.basename(dir);
      if (!git && fs.existsSync(path.join(dir, ".git"))) git = path.basename(dir);
    } catch { /* ignore */ }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return git;
}

function describe(event, payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const tool = p.toolName ?? p.tool_name ?? p.tool ?? null;
  const args = p.toolArgs ?? p.tool_input ?? p.toolInput ?? p.arguments ?? null;
  return {
    at_ms: Date.now(),
    event,
    tool: typeof tool === "string" ? tool : null,
    arg_keys: keysOf(args),
    skill: findSkill(args),
    skill_src: findSkillSrc(args),
    agent: typeof (p.agentType ?? p.agent_type ?? p.agentName) === "string" ? (p.agentType ?? p.agent_type ?? p.agentName) : null,
    has_agent_id: Boolean(p.agentId ?? p.agent_id),
    // Identifiers only. session_id and tool_use_id let the report join this event to a telemetry span; neither holds content.
    session: p.session_id ?? p.sessionId ?? null,
    tool_use_id: p.tool_use_id ?? p.toolUseId ?? p.tool_call_id ?? null,
    repo: repoFromCwd(p.cwd),
    model: typeof p.model === "string" ? p.model : null,
    source: typeof p.source === "string" ? p.source : null,
    payload_keys: Object.keys(p),
  };
}

function main() {
  const event = process.argv[2] || "unknown";
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch { /* no stdin */ }
  let payload = {};
  try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { payload = {}; }
  if (process.env.TEAM_HOOK_LOG !== "off") {
    try {
      const dir = path.join(process.env.TEAM_HOME || path.join(os.homedir(), ".copilot", "team"), "hooks");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "events.jsonl");
      if (!fs.existsSync(file) || fs.statSync(file).size < MAX_LOG_BYTES) fs.appendFileSync(file, JSON.stringify(describe(event, payload)) + "\n");
    } catch { /* never fail a hook because of the log */ }
  }
  process.stdout.write("{}\n");
}

main();
