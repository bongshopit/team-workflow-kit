#!/usr/bin/env node
// team.mjs - deterministic helper for the change contract. Node 18+, no dependencies.
// A change lives in <repo>/.team/changes/<TICKET>/ and its state lives in status.json.
// Only this script writes status.json. Agents and humans call it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REVIEW_ROUND_LIMIT = 2; // review -> applying more than this needs a human
const SAME_TEST_FAIL_LIMIT = 2; // the same test failing this many times blocks the change

// Exit codes: 1 generic, 2 illegal transition, 3 approval rule, 4 missing reason,
// 5 validation failed, 6 retry limit reached, 64 usage error.
class Fail extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const TRANSITIONS = {
  explored: ["proposed", "blocked", "abandoned"],
  proposed: ["proposed", "approved", "blocked", "abandoned"], // proposed -> proposed is a revision
  approved: ["applying", "proposed", "blocked", "abandoned"], // approved -> proposed reopens the proposal
  applying: ["review", "blocked", "abandoned"],
  review: ["applying", "done", "blocked", "abandoned"],
  blocked: [], // computed: where it was blocked from, plus applying, proposed, abandoned
  done: [], // terminal, a revert or hotfix is a new change
  abandoned: [],
};

// ---------- small helpers ----------
const now = () => new Date().toISOString();
const statusPath = (folder) => path.join(folder, "status.json");
const filePath = (folder, name) => path.join(folder, name);

function exists(folder, name) {
  const p = filePath(folder, name);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
}
function readText(folder, name) {
  return fs.readFileSync(filePath(folder, name), "utf8");
}
function load(folder) {
  const p = statusPath(folder);
  if (!fs.existsSync(p)) throw new Fail(`no status.json in ${folder}`);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw new Fail(`status.json is not valid JSON: ${e.message}`);
  }
}
function save(folder, st) {
  const tmp = statusPath(folder) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
  fs.renameSync(tmp, statusPath(folder));
}
function repoRootOf(folder) {
  return path.resolve(folder, "..", "..", "..");
}
function taskCounts(folder) {
  if (!exists(folder, "tasks.md")) return { done: 0, open: 0 };
  const t = readText(folder, "tasks.md");
  return {
    done: (t.match(/^\s*- \[[xX]\]/gm) || []).length,
    open: (t.match(/^\s*- \[ \]/gm) || []).length,
  };
}
function parseArgs(argv) {
  const BOOL = new Set(["skip-tests", "json"]);
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (BOOL.has(k)) flags[k] = true;
      else {
        flags[k] = argv[++i];
        if (flags[k] === undefined) throw new Fail(`--${k} needs a value`, 64);
      }
    } else pos.push(a);
  }
  return { pos, flags };
}
function need(v, what) {
  if (!v) throw new Fail(`missing ${what}. Run: node team.mjs help`, 64);
  return v;
}
function allowedFrom(st) {
  if (st.state !== "blocked") return TRANSITIONS[st.state] || [];
  return [...new Set([st.blocked_from, "applying", "proposed", "abandoned"].filter(Boolean))];
}

// ---------- validation ----------
function runTests(folder) {
  const cmd = process.env.TEAM_TEST_CMD;
  const r = spawnSync(cmd, { shell: true, cwd: repoRootOf(folder), encoding: "utf8" });
  return r.status === 0 ? null : `tests failed (${cmd}), exit ${r.status}`;
}

// mode: apply | review | done. Returns a list of problems, empty when fine.
function validate(folder, st, mode, { skipTests = false } = {}) {
  const problems = [];
  if (st.ticket !== path.basename(folder)) problems.push(`ticket "${st.ticket}" does not match folder name`);
  if (mode === "apply") {
    if (!st.proposal_approved_by) problems.push("no approver recorded");
    if (!st.ready.proposal || !st.ready.test_plan) problems.push("proposal and test plan are not both ready");
    for (const f of ["proposal.md", "tasks.md"]) if (!exists(folder, f)) problems.push(`${f} is missing or empty`);
  }
  if (mode === "review" || mode === "done") {
    const { done, open } = taskCounts(folder);
    if (done + open === 0) problems.push("tasks.md has no tasks");
    if (open > 0) problems.push(`${open} task(s) not ticked`);
    if (mode === "review") {
      if (process.env.TEAM_TEST_CMD) {
        const t = runTests(folder);
        if (t) problems.push(t);
      } else if (!skipTests) {
        problems.push("no test command: set TEAM_TEST_CMD or pass --skip-tests");
      }
    }
  }
  if (mode === "done") {
    if (!exists(folder, "review.md")) problems.push("review.md is missing");
    else {
      const r = readText(folder, "review.md");
      if (!/^Result:\s*pass/im.test(r)) problems.push("review.md does not say Result: pass");
      if (/^\s*- \[ \]/m.test(r)) problems.push("review.md has open findings");
    }
    if (!exists(folder, `${st.ticket}-summary.md`)) problems.push(`${st.ticket}-summary.md is missing`);
  }
  return problems;
}

// ---------- the one place a state changes ----------
function move(folder, st, to, { by = "script", reason = "", internalApprove = false, skipTests = false } = {}) {
  const from = st.state;
  if (!TRANSITIONS[from] && from !== "blocked") throw new Fail(`unknown state ${from}`);
  if (!allowedFrom(st).includes(to)) throw new Fail(`illegal transition ${from} -> ${to}`, 2);
  if (to === "approved" && !internalApprove) throw new Fail("use the approve command to approve a proposal", 3);

  if (to === "proposed") {
    for (const f of ["proposal.md", "tasks.md"]) if (!exists(folder, f)) throw new Fail(`${f} is missing or empty`, 5);
    const first = from === "explored" || (from === "blocked" && st.blocked_from === "explored");
    const resume = from === "blocked" && st.blocked_from === "proposed"; // same proposal, no revision
    if (!first && !resume) {
      st.proposal_revision += 1; // a revised proposal needs a fresh approval and a fresh test plan check
      st.proposal_approved_by = null;
      st.approved_at = null;
      st.review_requested_at = null;
      st.ready.test_plan = false;
    }
    st.ready.proposal = true;
  }
  if (to === "applying") {
    const problems = validate(folder, st, "apply");
    if (problems.length) throw new Fail("cannot apply:\n- " + problems.join("\n- "), 5);
    if (from === "review") {
      if (st.retries.review_rounds >= REVIEW_ROUND_LIMIT) {
        throw new Fail(`review rounds exhausted (${REVIEW_ROUND_LIMIT}). Block the change and ask a human`, 6);
      }
      st.retries.review_rounds += 1;
    }
  }
  if (to === "review" || to === "done") {
    const problems = validate(folder, st, to, { skipTests });
    if (problems.length) throw new Fail(`validation failed for ${to}:\n- ` + problems.join("\n- "), 5);
  }
  if (to === "blocked") {
    if (!reason) throw new Fail("blocked needs --reason", 4);
    st.blocked_from = from;
    st.blocked_reason = reason;
  }
  if (from === "blocked") {
    st.blocked_from = null;
    st.blocked_reason = null;
  }

  st.state = to;
  st.history.push({ state: to, at: now(), by });
  save(folder, st);
  return from;
}

// ---------- notification ----------
function maybeRequestReview(folder, st) {
  if (st.state !== "proposed") return `not requested: state is ${st.state}, not proposed`;
  const waiting = [];
  if (!st.ready.proposal) waiting.push("proposal");
  if (!st.ready.test_plan) waiting.push("test_plan");
  if (waiting.length) return `waiting for: ${waiting.join(", ")}`;
  if (st.review_requested_at) return "already requested";
  st.review_requested_at = now();
  save(folder, st);
  const msg = `Gate 1 ready for ${st.ticket} (${st.repo}): approve the approach and the test plan`;
  if (process.env.TEAM_NOTIFY_CMD) {
    spawnSync(process.env.TEAM_NOTIFY_CMD, {
      shell: true,
      stdio: "inherit",
      env: { ...process.env, TEAM_NOTIFY_MESSAGE: msg, TEAM_TICKET: st.ticket },
    });
  }
  return `notify: ${msg}`;
}

// ---------- call log ----------
// Every call is appended to <TEAM_HOME>/calls/<TICKET>.jsonl (default ~/.copilot/team). It lives outside git.
// It records WHEN each call happened, so telemetry can be matched to a ticket by time, and it shows
// whether agents followed the flow. Logging never makes a command fail. TEAM_CALLS=off disables it.
const TICKET_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const teamHome = () => process.env.TEAM_HOME || path.join(os.homedir(), ".copilot", "team");
const callsFile = (ticket) => path.join(teamHome(), "calls", `${ticket}.jsonl`);
const LOG = { detail: undefined };

function gitRootNameFromCwd() {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return path.basename(dir);
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
// Which repo does a skill note belong to? note-skill can run before the change folder exists, and from any directory.
// 1. a change folder for the ticket above the cwd, 2. the git repo around the cwd, 3. the last repo seen in the ticket's call log.
function repoForTicket(ticket) {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, ".team", "changes", ticket))) return path.basename(dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const git = gitRootNameFromCwd();
  if (git) return git;
  try {
    const rows = fs.readFileSync(callsFile(ticket), "utf8").split("\n").filter(Boolean);
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = JSON.parse(rows[i]);
      if (r.repo && r.repo !== "(unknown)") return r.repo;
    }
  } catch {
    /* no log yet */
  }
  return "(unknown)";
}
function callContext(cmd, pos) {
  if (cmd === "init-change" && pos[0] && pos[1]) return { ticket: pos[1], repo: path.basename(path.resolve(pos[0])), folder: null };
  if (cmd === "note-skill" && pos[0]) return { ticket: pos[0], repo: repoForTicket(pos[0]), folder: null };
  if (["help", "calls"].includes(cmd) || !pos[0]) return null;
  const folder = path.resolve(pos[0]);
  return { ticket: path.basename(folder), repo: path.basename(path.resolve(folder, "..", "..", "..")), folder };
}
function stateOf(folder) {
  try {
    return JSON.parse(fs.readFileSync(statusPath(folder), "utf8")).state;
  } catch {
    return null;
  }
}
function logCall(ctx, entry) {
  if (!ctx || process.env.TEAM_CALLS === "off" || !TICKET_RE.test(ctx.ticket)) return;
  try {
    const file = callsFile(ctx.ticket);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ticket: ctx.ticket, repo: ctx.repo, ...entry }) + "\n");
  } catch {
    /* never fail a command because of the log */
  }
}

// ---------- commands ----------
const COMMANDS = {
  "init-change"(pos, flags) {
    const repoRoot = path.resolve(need(pos[0], "repo root"));
    const ticket = need(pos[1], "ticket id");
    if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(ticket)) throw new Fail(`bad ticket id: ${ticket}`, 64);
    const report = need(flags.report, "--report <findings file>");
    const acs = need(flags.acs, "--acs 1,2,3")
      .split(",")
      .map((x) => parseInt(x, 10));
    if (acs.some((n) => !Number.isInteger(n) || n < 1)) throw new Fail("--acs must be a list of positive numbers", 64);
    if (!fs.existsSync(report) || fs.statSync(report).size === 0) throw new Fail("findings report is missing or empty", 5);
    const folder = path.join(repoRoot, ".team", "changes", ticket);
    if (fs.existsSync(statusPath(folder))) throw new Fail(`change already exists: ${folder}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.copyFileSync(report, filePath(folder, "explore-report.md"));
    const by = flags.by || "init-change";
    const st = {
      ticket,
      story: flags.story || null,
      repo: path.basename(repoRoot),
      state: "explored",
      ac_ids: acs,
      ready: { proposal: false, test_plan: false },
      proposal_revision: 0,
      proposal_approved_by: null,
      approved_at: null,
      review_requested_at: null,
      depends_on: [],
      pr_url: null,
      retries: { test_failures: 0, review_rounds: 0, failed_tests: {} },
      blocked_reason: null,
      blocked_from: null,
      history: [{ state: "explored", at: now(), by }],
    };
    save(folder, st);
    console.log(`created ${folder} (state: explored)`);
  },

  "set-status"(pos, flags) {
    const folder = path.resolve(need(pos[0], "change folder"));
    const to = need(pos[1], "target state");
    const st = load(folder);
    LOG.detail = to;
    const from = move(folder, st, to, { by: flags.by || "set-status", reason: flags.reason || "", skipTests: !!flags["skip-tests"] });
    console.log(`${from} -> ${to}`);
    if (to === "proposed") console.log(maybeRequestReview(folder, load(folder)));
  },

  "set-ready"(pos) {
    const folder = path.resolve(need(pos[0], "change folder"));
    const what = need(pos[1], "what is ready (test_plan)");
    LOG.detail = what;
    if (what !== "test_plan") throw new Fail("only test_plan can be set by hand. The proposal is marked ready by set-status proposed", 64);
    const st = load(folder);
    if (st.state !== "proposed") throw new Fail(`set-ready test_plan needs state proposed, state is ${st.state}`, 5);
    if (!exists(folder, "test-plan.md")) throw new Fail("test-plan.md is missing or empty", 5);
    const plan = readText(folder, "test-plan.md");
    const problems = [];
    for (const k of st.ac_ids) if (!new RegExp(`^S${k}\\.\\d+\\b`, "m").test(plan)) problems.push(`AC${k} has no scenario (expected a line starting S${k}.1)`);
    if (/target:\s*TBD/i.test(plan)) problems.push("test plan still has targets marked TBD, the refine pass is not done");
    if (problems.length) throw new Fail("test plan is not ready:\n- " + problems.join("\n- "), 5);
    st.ready.test_plan = true;
    save(folder, st);
    console.log("ready.test_plan = true");
    console.log(maybeRequestReview(folder, load(folder)));
  },

  "request-review"(pos) {
    const folder = path.resolve(need(pos[0], "change folder"));
    console.log(maybeRequestReview(folder, load(folder)));
  },

  approve(pos, flags) {
    const folder = path.resolve(need(pos[0], "change folder"));
    const who = need(pos[1], "approver name");
    const st = load(folder);
    if (st.state !== "proposed") throw new Fail(`approve needs state proposed, state is ${st.state}`, 3);
    if (!st.ready.proposal || !st.ready.test_plan) throw new Fail("proposal and test plan are not both ready", 3);
    st.proposal_approved_by = who;
    st.approved_at = now();
    move(folder, st, "approved", { by: who, internalApprove: true });
    console.log(`approved by ${who}`);
  },

  "validate-change"(pos, flags) {
    const folder = path.resolve(need(pos[0], "change folder"));
    const st = load(folder);
    const modeByState = { approved: "apply", applying: "review", review: "done" };
    const mode = flags.for || modeByState[st.state];
    LOG.detail = mode;
    if (!["apply", "review", "done"].includes(mode)) throw new Fail(`nothing to validate in state ${st.state}. Pass --for apply|review|done`, 64);
    const problems = validate(folder, st, mode, { skipTests: !!flags["skip-tests"] });
    if (problems.length) throw new Fail(`validation failed for ${mode}:\n- ` + problems.join("\n- "), 5);
    console.log(`ok (${mode})`);
  },

  "record-failure"(pos) {
    const folder = path.resolve(need(pos[0], "change folder"));
    const test = need(pos[1], "test name");
    const st = load(folder);
    if (st.state !== "applying") throw new Fail(`record-failure needs state applying, state is ${st.state}`, 5);
    st.retries.test_failures += 1;
    st.retries.failed_tests[test] = (st.retries.failed_tests[test] || 0) + 1;
    const n = st.retries.failed_tests[test];
    if (n >= SAME_TEST_FAIL_LIMIT) {
      move(folder, st, "blocked", { by: "record-failure", reason: `${test} failed ${n} times` });
      console.log(`BLOCKED: ${test} failed ${n} times. A human must decide.`);
    } else {
      save(folder, st);
      console.log(`recorded: ${test} failed ${n} time(s)`);
    }
  },

  "next-action"(pos, flags) {
    const folder = path.resolve(need(pos[0], "change folder"));
    const st = load(folder);
    const has = (f) => exists(folder, f);
    let r;
    switch (st.state) {
      case "explored":
        if (!has("proposal.md") || !has("tasks.md")) r = { action: "propose", agent: "orchestrator", detail: "write proposal.md and tasks.md" };
        else r = { action: "set-status proposed", agent: "orchestrator", detail: "the proposal is written, record it" };
        if (!has("test-plan.md")) r.also = { action: "test-plan", agent: "qe", detail: "draft test-plan.md from the story, in parallel" };
        break;
      case "proposed":
        if (!st.ready.test_plan) {
          r = has("test-plan.md")
            ? { action: "qe-refine", agent: "qe", detail: "map scenarios to endpoints and classes, then set-ready test_plan" }
            : { action: "test-plan", agent: "qe", detail: "draft test-plan.md from the story" };
        } else if (!st.review_requested_at) r = { action: "request-review", agent: "script", detail: "notify Gate 1" };
        else r = { action: "wait-gate-1", agent: "human", detail: "approve the approach and the test plan" };
        break;
      case "approved":
        r = { action: "team-apply", agent: "orchestrator", detail: "validate, then start the dev subagent" };
        break;
      case "applying": {
        const { done, open } = taskCounts(folder);
        r = { action: "dev-resume", agent: "dev", detail: `${done} of ${done + open} tasks ticked, continue at task ${done + 1}` };
        if (open === 0 && done > 0) r = { action: "set-status review", agent: "dev", detail: "all tasks ticked, validate and move to review" };
        break;
      }
      case "review":
        if (!has("review.md")) r = { action: "review", agent: "reviewer", detail: "compare the diff with the proposal and the ACs" };
        else if (!has(`${st.ticket}-summary.md`)) r = { action: "summary", agent: "orchestrator", detail: "write the ticket summary and open the PR" };
        else r = { action: "wait-gate-2", agent: "human", detail: "review the PR and merge" };
        break;
      case "blocked":
        r = { action: "human", agent: "human", detail: `blocked: ${st.blocked_reason}` };
        break;
      default:
        r = { action: "none", agent: "-", detail: `change is ${st.state}` };
    }
    LOG.detail = r.also ? `${r.action} + ${r.also.action}` : r.action;
    if (flags.json) console.log(JSON.stringify({ state: st.state, ...r }));
    else {
      console.log(`state:  ${st.state}\naction: ${r.action}\nagent:  ${r.agent}\ndetail: ${r.detail}`);
      if (r.also) console.log(`also:   ${r.also.action} (${r.also.agent}): ${r.also.detail}`);
    }
  },

  "note-skill"(pos, flags) {
    const ticket = need(pos[0], "ticket id");
    const skill = need(pos[1], "skill name");
    if (!TICKET_RE.test(ticket)) throw new Fail(`bad ticket id: ${ticket}`, 64);
    LOG.detail = flags.agent ? `${skill} (${flags.agent})` : skill;
    console.log(`noted: ${LOG.detail}`);
  },

  calls(pos, flags) {
    const ticket = need(pos[0], "ticket id");
    if (!TICKET_RE.test(ticket)) throw new Fail(`bad ticket id: ${ticket}`, 64);
    const file = callsFile(ticket);
    if (!fs.existsSync(file)) throw new Fail(`no calls recorded for ${ticket} (${file})`);
    const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    if (flags.json) return console.log(rows.map((r) => JSON.stringify(r)).join("\n"));
    for (const r of rows) {
      const states = r.state_before === r.state_after ? r.state_before ?? "-" : `${r.state_before ?? "-"} -> ${r.state_after ?? "-"}`;
      console.log(`${r.end_iso}  ${r.repo.padEnd(18)} ${r.cmd}${r.detail ? " " + r.detail : ""}  [${states}]${r.code ? "  exit " + r.code + (r.reason ? ": " + r.reason : "") : ""}`);
    }
  },

  help() {
    console.log(`node team.mjs <command> ...

  init-change <repo-root> <TICKET> --report <file> --acs 1,2,3 [--story v3]
  set-status <folder> <state> [--reason text] [--by name] [--skip-tests]
  set-ready <folder> test_plan
  request-review <folder>
  approve <folder> <name>
  validate-change <folder> [--for apply|review|done] [--skip-tests]
  record-failure <folder> <test name>
  next-action <folder> [--json]
  note-skill <TICKET> <skill> [--agent name]    record that a skill was started (no state change)
  calls <TICKET> [--json]                       show the recorded calls for a ticket

<folder> is <repo>/.team/changes/<TICKET>. Env: TEAM_TEST_CMD, TEAM_NOTIFY_CMD, TEAM_HOME (call log location), TEAM_CALLS=off.
Exit codes: 2 illegal transition, 3 approval rule, 4 missing reason, 5 validation failed, 6 retry limit.`);
  },
};

function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos.shift() || "help";
  const fn = COMMANDS[cmd];
  if (!fn) throw new Fail(`unknown command ${cmd}. Run: node team.mjs help`, 64);
  const ctx = callContext(cmd, pos);
  const start = Date.now();
  const before = ctx?.folder ? stateOf(ctx.folder) : null;
  let code = 0, reason = null;
  try {
    fn(pos, flags);
  } catch (e) {
    code = e instanceof Fail ? e.code : 1;
    reason = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
    throw e;
  } finally {
    const end = Date.now();
    const folder = ctx?.folder || (cmd === "init-change" ? path.join(path.resolve(pos[0] || "."), ".team", "changes", pos[1] || "") : null);
    logCall(ctx, {
      cmd,
      detail: LOG.detail,
      code,
      reason,
      start_ms: start,
      end_ms: end,
      end_iso: new Date(end).toISOString(),
      state_before: before,
      state_after: folder ? stateOf(folder) : null,
      pid: process.pid,
    });
  }
}

try {
  main();
} catch (e) {
  if (e instanceof Fail) {
    console.error("error: " + e.message);
    process.exit(e.code);
  }
  throw e;
}
