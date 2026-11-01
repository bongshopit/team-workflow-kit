// Run with: node --test scripts/team.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "team.mjs");
const HOME_FOR_TESTS = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-")); // keeps the call log out of the real home

function team(args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, TEAM_TEST_CMD: "", TEAM_NOTIFY_CMD: "", TEAM_HOME: HOME_FOR_TESTS, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const ok = (args, env) => {
  const r = team(args, env);
  assert.equal(r.code, 0, `expected success for ${args.join(" ")}\n${r.err}`);
  return r;
};
const fail = (args, code, env) => {
  const r = team(args, env);
  assert.equal(r.code, code, `expected exit ${code} for ${args.join(" ")}, got ${r.code}\n${r.err}`);
  return r;
};

// a fresh repo with a change in state "explored"
function setup() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-"));
  const report = path.join(repo, "report.md");
  fs.writeFileSync(report, "# Findings\n");
  ok(["init-change", repo, "PROJ-123", "--report", report, "--acs", "1,2,3", "--story", "v3"]);
  const folder = path.join(repo, ".team", "changes", "PROJ-123");
  const status = () => JSON.parse(fs.readFileSync(path.join(folder, "status.json"), "utf8"));
  const write = (name, text) => fs.writeFileSync(path.join(folder, name), text);
  return { repo, folder, status, write };
}
const PLAN_V1 = "S1.1 a  target: TBD\nS2.1 b  target: TBD\nS3.1 c  target: TBD\n";
const PLAN_V2 = "S1.1 a  POST /cancel\nS2.1 b  GET /orders\nS3.1 c  POST /cancel\n";
const TASKS_OPEN = "- [ ] 1. one\n- [ ] 2. two\n";
const TASKS_DONE = "- [x] 1. one\n- [x] 2. two\n";

// state proposed with both ready, not yet approved
function toProposed(c) {
  c.write("proposal.md", "# Proposal\n");
  c.write("tasks.md", TASKS_OPEN);
  c.write("test-plan.md", PLAN_V1);
  ok(["set-status", c.folder, "proposed"]);
  c.write("test-plan.md", PLAN_V2);
  ok(["set-ready", c.folder, "test_plan"]);
}
function toApplying(c) {
  toProposed(c);
  ok(["approve", c.folder, "dev-lead"]);
  ok(["set-status", c.folder, "applying"]);
}

test("happy path from explored to done", () => {
  const c = setup();
  assert.equal(c.status().state, "explored");
  assert.deepEqual(c.status().ac_ids, [1, 2, 3]);

  c.write("proposal.md", "# Proposal\n");
  c.write("tasks.md", TASKS_OPEN);
  c.write("test-plan.md", PLAN_V1);
  const p = ok(["set-status", c.folder, "proposed"]);
  assert.match(p.out, /waiting for: test_plan/);
  assert.equal(c.status().ready.proposal, true);

  const early = fail(["set-ready", c.folder, "test_plan"], 5);
  assert.match(early.err, /TBD/);

  c.write("test-plan.md", PLAN_V2);
  const r = ok(["set-ready", c.folder, "test_plan"]);
  assert.match(r.out, /notify: Gate 1 ready for PROJ-123/);
  assert.ok(c.status().review_requested_at);

  ok(["approve", c.folder, "dev-lead"]);
  assert.equal(c.status().proposal_approved_by, "dev-lead");
  ok(["set-status", c.folder, "applying"]);

  fail(["set-status", c.folder, "review", "--skip-tests"], 5); // tasks not ticked
  c.write("tasks.md", TASKS_DONE);
  ok(["set-status", c.folder, "review", "--skip-tests"]);

  fail(["set-status", c.folder, "done", "--skip-tests"], 5); // no review.md yet
  c.write("review.md", "Result: pass\nFindings: none\n");
  c.write("PROJ-123-summary.md", "# Summary\n");
  ok(["set-status", c.folder, "done"]);
  assert.equal(c.status().state, "done");
  assert.deepEqual(c.status().history.map((h) => h.state), ["explored", "proposed", "approved", "applying", "review", "done"]);
});

test("illegal transitions are refused", () => {
  const c = setup();
  fail(["set-status", c.folder, "applying"], 2);
  fail(["set-status", c.folder, "done"], 2);
  assert.equal(c.status().state, "explored");
});

test("approval only through approve, and only when both are ready", () => {
  const c = setup();
  fail(["approve", c.folder, "dev-lead"], 3); // state explored
  c.write("proposal.md", "# P\n");
  c.write("tasks.md", TASKS_OPEN);
  ok(["set-status", c.folder, "proposed"]);
  fail(["approve", c.folder, "dev-lead"], 3); // test plan not ready
  fail(["set-status", c.folder, "approved"], 3); // never by set-status
});

test("set-ready checks every AC has a scenario", () => {
  const c = setup();
  c.write("proposal.md", "# P\n");
  c.write("tasks.md", TASKS_OPEN);
  ok(["set-status", c.folder, "proposed"]);
  c.write("test-plan.md", "S1.1 a  POST\nS2.1 b  GET\n"); // AC3 missing
  const r = fail(["set-ready", c.folder, "test_plan"], 5);
  assert.match(r.err, /AC3/);
});

test("request-review waits for both and notifies once", () => {
  const c = setup();
  c.write("proposal.md", "# P\n");
  c.write("tasks.md", TASKS_OPEN);
  const p = ok(["set-status", c.folder, "proposed"]);
  assert.match(p.out, /waiting for: test_plan/);
  c.write("test-plan.md", PLAN_V2);
  ok(["set-ready", c.folder, "test_plan"]);
  const again = ok(["request-review", c.folder]);
  assert.match(again.out, /already requested/);
});

test("a revised proposal resets approval and the test plan check", () => {
  const c = setup();
  toApplying(c);
  ok(["set-status", c.folder, "blocked", "--reason", "story changed"]);
  ok(["set-status", c.folder, "proposed"]); // human sends it back to the proposal
  const st = c.status();
  assert.equal(st.state, "proposed");
  assert.equal(st.proposal_revision, 1);
  assert.equal(st.proposal_approved_by, null);
  assert.equal(st.ready.test_plan, false);
  fail(["set-status", c.folder, "applying"], 2); // proposed -> applying is not allowed
});

test("blocked needs a reason and resumes where it was", () => {
  const c = setup();
  toApplying(c);
  fail(["set-status", c.folder, "blocked"], 4);
  ok(["set-status", c.folder, "blocked", "--reason", "AC2 is unclear"]);
  assert.equal(c.status().blocked_reason, "AC2 is unclear");
  ok(["set-status", c.folder, "applying"]);
  assert.equal(c.status().blocked_reason, null);
});

test("the same test failing twice blocks the change", () => {
  const c = setup();
  toApplying(c);
  const a = ok(["record-failure", c.folder, "OrderServiceTest.cancel"]);
  assert.match(a.out, /1 time/);
  ok(["record-failure", c.folder, "OtherTest.x"]); // a different test does not count
  assert.equal(c.status().state, "applying");
  const b = ok(["record-failure", c.folder, "OrderServiceTest.cancel"]);
  assert.match(b.out, /BLOCKED/);
  assert.equal(c.status().state, "blocked");
  assert.equal(c.status().blocked_from, "applying");
});

test("review rounds are limited to two", () => {
  const c = setup();
  toApplying(c);
  c.write("tasks.md", TASKS_DONE);
  for (let round = 1; round <= 2; round++) {
    ok(["set-status", c.folder, "review", "--skip-tests"]);
    ok(["set-status", c.folder, "applying"]);
    assert.equal(c.status().retries.review_rounds, round);
  }
  ok(["set-status", c.folder, "review", "--skip-tests"]);
  const r = fail(["set-status", c.folder, "applying"], 6);
  assert.match(r.err, /review rounds exhausted/);
});

test("test command decides whether review is allowed", () => {
  const c = setup();
  toApplying(c);
  c.write("tasks.md", TASKS_DONE);
  const none = fail(["set-status", c.folder, "review"], 5);
  assert.match(none.err, /no test command/);
  fail(["set-status", c.folder, "review"], 5, { TEAM_TEST_CMD: 'node -e "process.exit(1)"' });
  ok(["set-status", c.folder, "review"], { TEAM_TEST_CMD: 'node -e "process.exit(0)"' });
});

test("done cannot be abandoned or reopened", () => {
  const c = setup();
  toApplying(c);
  c.write("tasks.md", TASKS_DONE);
  ok(["set-status", c.folder, "review", "--skip-tests"]);
  c.write("review.md", "Result: pass\n");
  c.write("PROJ-123-summary.md", "# S\n");
  ok(["set-status", c.folder, "done"]);
  fail(["set-status", c.folder, "abandoned"], 2);
  fail(["set-status", c.folder, "applying"], 2);
});

test("review.md with open findings blocks done", () => {
  const c = setup();
  toApplying(c);
  c.write("tasks.md", TASKS_DONE);
  ok(["set-status", c.folder, "review", "--skip-tests"]);
  c.write("review.md", "Result: pass\n- [ ] rename the DTO\n");
  c.write("PROJ-123-summary.md", "# S\n");
  const r = fail(["set-status", c.folder, "done"], 5);
  assert.match(r.err, /open findings/);
});

test("abandon works until done", () => {
  const c = setup();
  ok(["set-status", c.folder, "abandoned"]);
  assert.equal(c.status().state, "abandoned");
});

test("init-change refuses to overwrite and checks its inputs", () => {
  const c = setup();
  const report = path.join(c.repo, "report.md");
  fail(["init-change", c.repo, "PROJ-123", "--report", report, "--acs", "1"], 1);
  fail(["init-change", c.repo, "PROJ-124", "--report", path.join(c.repo, "nope.md"), "--acs", "1"], 5);
  fail(["init-change", c.repo, "bad id", "--report", report, "--acs", "1"], 64);
});

test("next-action follows the state", () => {
  const c = setup();
  const json = (extra = []) => JSON.parse(ok(["next-action", c.folder, "--json", ...extra]).out);

  let a = json();
  assert.equal(a.action, "propose");
  assert.equal(a.also.action, "test-plan"); // runs in parallel with propose

  c.write("proposal.md", "# P\n");
  c.write("tasks.md", TASKS_OPEN);
  c.write("test-plan.md", PLAN_V1);
  assert.equal(json().action, "set-status proposed");

  ok(["set-status", c.folder, "proposed"]);
  assert.equal(json().action, "qe-refine");

  c.write("test-plan.md", PLAN_V2);
  ok(["set-ready", c.folder, "test_plan"]);
  assert.equal(json().action, "wait-gate-1");

  ok(["approve", c.folder, "dev-lead"]);
  assert.equal(json().action, "team-apply");

  ok(["set-status", c.folder, "applying"]);
  assert.match(json().detail, /0 of 2 tasks/);
  c.write("tasks.md", "- [x] 1. one\n- [ ] 2. two\n");
  assert.match(json().detail, /continue at task 2/);

  c.write("tasks.md", TASKS_DONE);
  ok(["set-status", c.folder, "review", "--skip-tests"]);
  assert.equal(json().action, "review");
  c.write("review.md", "Result: pass\n");
  assert.equal(json().action, "summary");
  c.write("PROJ-123-summary.md", "# S\n");
  assert.equal(json().action, "wait-gate-2");

  ok(["set-status", c.folder, "done"]);
  assert.equal(json().action, "none");
});

test("next-action on a blocked change says why", () => {
  const c = setup();
  toApplying(c);
  ok(["set-status", c.folder, "blocked", "--reason", "needs a decision"]);
  const a = JSON.parse(ok(["next-action", c.folder, "--json"]).out);
  assert.equal(a.agent, "human");
  assert.match(a.detail, /needs a decision/);
});

// ---------- call log ----------
const readCalls = (ticket, home = HOME_FOR_TESTS) =>
  fs.readFileSync(path.join(home, "calls", `${ticket}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("every call is logged with time, state change and exit code", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-"));
  fs.writeFileSync(path.join(repo, "r.md"), "# f\n");
  const env = { TEAM_HOME: home };
  ok(["init-change", repo, "PROJ-500", "--report", path.join(repo, "r.md"), "--acs", "1"], env);
  const folder = path.join(repo, ".team", "changes", "PROJ-500");
  fs.writeFileSync(path.join(folder, "proposal.md"), "# p\n");
  fs.writeFileSync(path.join(folder, "tasks.md"), TASKS_OPEN);
  const before = Date.now();
  ok(["set-status", folder, "proposed"], env);
  fail(["set-status", folder, "done"], 2, env);
  const rows = readCalls("PROJ-500", home);
  assert.deepEqual(rows.map((r) => r.cmd), ["init-change", "set-status", "set-status"]);
  assert.equal(rows[0].state_after, "explored");
  assert.equal(rows[0].repo, path.basename(repo));
  assert.equal(rows[1].detail, "proposed");
  assert.equal(rows[1].state_before, "explored");
  assert.equal(rows[1].state_after, "proposed");
  assert.equal(rows[1].code, 0);
  assert.ok(rows[1].start_ms >= before - 5 && rows[1].end_ms >= rows[1].start_ms);
  assert.equal(rows[2].code, 2);
  assert.equal(rows[2].state_after, "proposed");
});

test("next-action logs which action it returned", () => {
  const c = setup();
  ok(["next-action", c.folder, "--json"]);
  const last = readCalls("PROJ-123").filter((r) => r.cmd === "next-action").pop();
  assert.equal(last.detail, "propose + test-plan");
});

test("note-skill records a skill before any change folder exists", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  const r = ok(["note-skill", "PROJ-501", "team-explore", "--agent", "orchestrator"], { TEAM_HOME: home });
  assert.match(r.out, /noted: team-explore \(orchestrator\)/);
  const rows = readCalls("PROJ-501", home);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cmd, "note-skill");
  assert.equal(rows[0].detail, "team-explore (orchestrator)");
  fail(["note-skill", "not-a-ticket", "x"], 64, { TEAM_HOME: home });
});

test("calls prints the log for a ticket", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  ok(["note-skill", "PROJ-502", "team-run"], { TEAM_HOME: home });
  const text = ok(["calls", "PROJ-502"], { TEAM_HOME: home }).out;
  assert.match(text, /note-skill team-run/);
  const json = ok(["calls", "PROJ-502", "--json"], { TEAM_HOME: home }).out.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(json[0].ticket, "PROJ-502");
  fail(["calls", "PROJ-999"], 1, { TEAM_HOME: home });
});

test("TEAM_CALLS=off writes nothing, and a broken log location never breaks a command", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  ok(["note-skill", "PROJ-503", "x"], { TEAM_HOME: home, TEAM_CALLS: "off" });
  assert.equal(fs.existsSync(path.join(home, "calls")), false);
  const blocker = path.join(home, "file-not-dir");
  fs.writeFileSync(blocker, "x");
  const r = ok(["note-skill", "PROJ-503", "x"], { TEAM_HOME: blocker });
  assert.match(r.out, /noted/);
});

test("note-skill finds the repo from the change folder, the ticket's earlier calls, or says unknown", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  const env = { ...process.env, TEAM_HOME: home, TEAM_TEST_CMD: "", TEAM_NOTIFY_CMD: "" };
  const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env, cwd });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "no-git-")); // not inside any repo
  // 1. nothing known yet
  run(["note-skill", "PROJ-600", "team-run"], outside);
  // 2. a repo with a change folder: init-change records the repo, then a note from an unrelated folder reuses it
  const repo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "team-")), "order-service");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "r.md"), "# f\n");
  assert.equal(run(["init-change", repo, "PROJ-600", "--report", path.join(repo, "r.md"), "--acs", "1"], outside).status, 0);
  run(["note-skill", "PROJ-600", "team-test-plan", "--agent", "qe"], outside);
  // 3. a note from inside the repo uses the change folder above the cwd
  run(["note-skill", "PROJ-600", "team-apply"], path.join(repo, ".team"));
  const rows = readCalls("PROJ-600", home).filter((r) => r.cmd === "note-skill");
  assert.deepEqual(rows.map((r) => r.repo), ["(unknown)", "order-service", "order-service"]);
});

test("a failed command logs the reason, so the log says why it exited non-zero", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-repo-"));
  fail(["init-change", repo, "PROJ-503", "--report", path.join(repo, "missing.md"), "--acs", "1"], 5, { TEAM_HOME: home });
  const row = readCalls("PROJ-503", home).find((r) => r.cmd === "init-change");
  assert.equal(row.code, 5);
  assert.match(row.reason, /findings report is missing/);
  assert.match(ok(["calls", "PROJ-503"], { TEAM_HOME: home }).out, /exit 5: findings report is missing/);
});

test("note-skill does not mistake a workspace folder that holds repos for the ticket's repo", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  const env = { ...process.env, TEAM_HOME: home, TEAM_TEST_CMD: "", TEAM_NOTIFY_CMD: "" };
  const ws = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "team-ws-")), "kit");
  fs.mkdirSync(path.join(ws, ".git"), { recursive: true });
  fs.mkdirSync(path.join(ws, "repos", "order-service", ".git"), { recursive: true });
  spawnSync(process.execPath, [SCRIPT, "note-skill", "PROJ-610", "team-run"], { encoding: "utf8", env, cwd: ws });
  // a plain repo (no repos inside) is still recognised
  const plain = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "team-plain-")), "order-service");
  fs.mkdirSync(path.join(plain, ".git"), { recursive: true });
  spawnSync(process.execPath, [SCRIPT, "note-skill", "PROJ-611", "team-run"], { encoding: "utf8", env, cwd: plain });
  assert.equal(readCalls("PROJ-610", home)[0].repo, "(unknown)");
  assert.equal(readCalls("PROJ-611", home)[0].repo, "order-service");
});

test("audit writes <TICKET>-audit.md into the change folder and changes no state", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-repo-"));
  fs.writeFileSync(path.join(repo, "r.md"), "# f\n");
  ok(["init-change", repo, "PROJ-620", "--report", path.join(repo, "r.md"), "--acs", "1"], { TEAM_HOME: home });
  const folder = path.join(repo, ".team", "changes", "PROJ-620");
  const before = fs.readFileSync(path.join(folder, "status.json"), "utf8");
  // a stand-in for the report script: writes the file it is asked to
  const stub = path.join(repo, "stub-report.mjs");
  fs.writeFileSync(stub, 'import fs from "node:fs"; const a = process.argv; fs.writeFileSync(a[a.indexOf("--out") + 1], "# Audit: " + a[2] + "\\n");\n');
  ok(["audit", folder], { TEAM_HOME: home, TEAM_OTEL_REPORT: stub });
  assert.equal(fs.readFileSync(path.join(folder, "PROJ-620-audit.md"), "utf8"), "# Audit: PROJ-620\n");
  assert.equal(fs.readFileSync(path.join(home, "tickets", "PROJ-620", "audit.md"), "utf8"), "# Audit: PROJ-620\n");
  assert.ok(fs.existsSync(path.join(home, "tickets", "PROJ-620", "ticket.json")));
  assert.equal(fs.readFileSync(path.join(folder, "status.json"), "utf8"), before);
  assert.ok(readCalls("PROJ-620", home).some((r) => r.cmd === "audit" && r.code === 0));
  fail(["audit", folder], 64, { TEAM_HOME: home, TEAM_OTEL_REPORT: path.join(repo, "missing.mjs") });
});

test("the old command name retro still works and says it was renamed", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-repo-"));
  fs.writeFileSync(path.join(repo, "r.md"), "# f\n");
  ok(["init-change", repo, "PROJ-621", "--report", path.join(repo, "r.md"), "--acs", "1"], { TEAM_HOME: home });
  const folder = path.join(repo, ".team", "changes", "PROJ-621");
  const stub = path.join(repo, "stub-report.mjs");
  fs.writeFileSync(stub, 'import fs from "node:fs"; const a = process.argv; fs.writeFileSync(a[a.indexOf("--out") + 1], "x\\n");\n');
  const r = ok(["retro", folder], { TEAM_HOME: home, TEAM_OTEL_REPORT: stub });
  assert.ok(fs.existsSync(path.join(folder, "PROJ-621-audit.md")));
  assert.match(r.err || "", /now 'team audit'/);
});

// ---- tickets that span repos ----
function twoRepos(ticket, { dependsOn = "inventory-service" } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "team-home-"));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "team-ws-"));
  const env = { TEAM_HOME: home };
  const make = (name, extra = []) => {
    const repo = path.join(parent, name);
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, "r.md"), "# f\n");
    ok(["init-change", repo, ticket, "--report", path.join(repo, "r.md"), "--acs", "1", ...extra], env);
    return path.join(repo, ".team", "changes", ticket);
  };
  const up = make("inventory-service");
  const down = make("order-service", dependsOn ? ["--depends-on", dependsOn] : []);
  const advance = (folder, to) => {
    fs.writeFileSync(path.join(folder, "proposal.md"), "# P\n");
    fs.writeFileSync(path.join(folder, "tasks.md"), TASKS_OPEN);
    fs.writeFileSync(path.join(folder, "test-plan.md"), PLAN_V2);
    ok(["set-status", folder, "proposed"], env);
    ok(["set-ready", folder, "test_plan"], env);
    ok(["approve", folder, "lead"], env);
    if (to === "approved") return;
    ok(["set-status", folder, "applying"], env);
    fs.writeFileSync(path.join(folder, "tasks.md"), TASKS_DONE);
    ok(["set-status", folder, "review", "--skip-tests"], env);
  };
  return { env, up, down, advance };
}

test("init-change stores depends_on, and a repo cannot depend on itself", () => {
  const t = twoRepos("PROJ-700");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t.down, "status.json"), "utf8")).depends_on, ["inventory-service"]);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-"));
  fs.writeFileSync(path.join(repo, "r.md"), "# f\n");
  fail(["init-change", repo, "PROJ-701", "--report", path.join(repo, "r.md"), "--acs", "1", "--depends-on", path.basename(repo)], 64, t.env);
});

test("a downstream repo waits until its upstream is in review or done", () => {
  const t = twoRepos("PROJ-702");
  t.advance(t.down, "approved");
  const wait = JSON.parse(ok(["next-action", t.down, "--json"], t.env).out);
  assert.equal(wait.action, "wait-upstream");
  assert.match(wait.detail, /inventory-service is explored/);
  const blocked = fail(["set-status", t.down, "applying"], 5, t.env);
  assert.match(blocked.err, /upstream: inventory-service is explored/);
  t.advance(t.up, "review");
  assert.equal(JSON.parse(ok(["next-action", t.down, "--json"], t.env).out).action, "team-apply");
  ok(["set-status", t.down, "applying"], t.env);
});

test("an upstream repo that was never started blocks too, and set-depends can fix a wrong list", () => {
  const t = twoRepos("PROJ-703", { dependsOn: "notification-service" });
  t.advance(t.down, "approved");
  const w = JSON.parse(ok(["next-action", t.down, "--json"], t.env).out);
  assert.equal(w.action, "wait-upstream");
  assert.match(w.detail, /notification-service has no change/);
  ok(["set-depends", t.down, "none"], t.env);
  assert.equal(JSON.parse(ok(["next-action", t.down, "--json"], t.env).out).action, "team-apply");
  ok(["set-depends", t.down, "inventory-service"], t.env);
  assert.equal(JSON.parse(ok(["next-action", t.down, "--json"], t.env).out).action, "wait-upstream");
});

test("ticket lists the repos with state and the merge order, upstream first", () => {
  const t = twoRepos("PROJ-704");
  const text = ok(["ticket", "PROJ-704"], t.env).out;
  const reg = JSON.parse(fs.readFileSync(path.join(t.env.TEAM_HOME, "tickets", "PROJ-704", "ticket.json"), "utf8"));
  assert.deepEqual(Object.keys(reg.repos).sort(), ["inventory-service", "order-service"]);
  assert.match(text, /merge order inventory-service -> order-service/);
  assert.match(text, /order-service\s+explored\s+depends on inventory-service\s+\(waiting\)/);
  const j = JSON.parse(ok(["ticket", "PROJ-704", "--json"], t.env).out);
  assert.deepEqual(j.mergeOrder, ["inventory-service", "order-service"]);
  assert.equal(j.cycle, false);
  fail(["ticket", "PROJ-999"], 1, t.env);
});
