# Team workflow kit: overview

Status at 2026-11-01. Everything here is built in-house: skills, agents and dependency-free Node scripts. No OpenSpec, no third-party libraries.

## What it does
One Jira story at a time, per repo, from the story only. The story already carries its ACs and scenarios (from `wf-plan`). Copilot agents move the change through a fixed set of states. A script is the only thing that writes state. Two human gates stay human.

## The flow
`explored → proposed → approved → applying → review → done` (plus `blocked`, `abandoned`).

| Step | Who | Skill | Output in `<repo>/.team/changes/<TICKET>/` |
|---|---|---|---|
| explore | orchestrator | team-explore | explore-report.md |
| propose, in parallel with test plan | orchestrator, qe | team-propose, team-test-plan | proposal.md, tasks.md, test-plan.md |
| **Gate 1** | human | `team approve` | status.json |
| apply | dev | team-apply | code, tests, ticked tasks |
| review (sent back to apply at most 2 times) | reviewer | team-review | review.md |
| summary and PR | orchestrator | team-summary | `<TICKET>-summary.md`, `<TICKET>-retro.md` |
| **Gate 2** | human merges, then `set-status done` | | |

The orchestrator never edits source or `status.json`. It asks `team next-action` what to do and delegates to `qe`, `dev` and `reviewer` as subagents.

## Repo map
| Path | What |
|---|---|
| `.github/agents/`, `skills/`, `prompts/` | The only copy of the agents (orchestrator, dev, qe, reviewer), seven skills and `/run`. VS Code opens `kit`, so it reads these. |
| `team/scripts/team.mjs` | Commands: init-change, set-status, set-ready, request-review, approve, validate-change, record-failure, next-action, note-skill, calls, retro. Writes `status.json`. Logs every call to `~/.copilot/team/calls/<TICKET>.jsonl`, with the reason when it fails. 25 tests. |
| `team/scripts/team-hook.mjs`, `team/hooks/` | Copilot hook: logs which skill was read, by which tool call, in which session. No content. `install-hooks.ps1` installs it. |
| `team/otel/` | Collector (OTLP on 127.0.0.1:4318, daily spool), `otel-report.mjs` (cost, phases, roles, skills, failures), `otel-retro.mjs` (markdown retro), `otel-task.ps1` (logon task). 26 tests. |
| `demo-workspace/` | Three Java repos (order, inventory, notification), stories PROJ-101 to 105, `setup.mjs` to create or `--reset` the git baseline. |
| `HANDOFF.md` | Running log of findings and open tasks. This file is the stable summary. |

## How it is observed
1. **Call log**: every `team.mjs` call with time, state before and after, exit code and failure reason. This is the workflow backbone.
2. **OTLP from Copilot Chat** (VS Code): credits per LLM call, tokens, tool calls, errors, agent role. Spans are tied to a ticket by the time of its `team.mjs` calls.
3. **Hook**: deterministic evidence of which skill was read and by which agent (joined to telemetry by tool call id).
4. **Retro** (`team retro <folder>`): all of the above for one ticket, as markdown in the change folder.

VS Code only so far. Copilot CLI and IntelliJ are not tested.

## What is proven, what is not
Proven on PROJ-101 (real Copilot, VS Code):
- The full flow from explore to summary runs, with `qe`, `dev` and `reviewer` as real subagents.
- First full run cost 21.2 credits (reviewer 8.2: 74 single-file reads, one rework round). After the review-cost rule and explicit subagent delegation: about 7.6 credits, 15 reviewer reads, 1 failed tool call. One run each, so treat the percentages as indicative.
- Hook, telemetry and call log join cleanly: 143 of 143 hook events matched a span.

Not proven: multi-repo dependencies (PROJ-103, 104), a story changing version mid-flight (PROJ-105), real `mvn test` on the Java repos, ACs read from Jira (they are passed by hand to `init-change`), CLI and IntelliJ, cost on different models.

## Improvement flow (agreed design)
1. At `done`, the ticket's retro is collected into a **ledger** (numbers from `team retro`, not from an LLM).
2. At the sprint retro the team reads the ledger next to the human retro and records its own observations.
3. A human triggers the **improver agent**, which reads the ledger, the human notes and the current skills and writes proposals: evidence, exact change, metric, baseline, risk.
4. A human approves each as a normal git change in this repo. The result is tracked in an improvement ledger.

Rules: the improver never edits during a ticket; it may change skills, agents, prompts and, with tests, `team.mjs`, but not gate rules without an explicit human decision; at most two open improvements at a time; every run records a hash of the skills and agents so before and after can be compared.

## Gaps in that design, and a better one
Gaps:
- **Cost can improve while quality gets worse.** The reviewer became about five times cheaper; nothing yet checks it still catches problems. The ledger needs quality counters: review findings, rework rounds, changes made at Gate 1 and Gate 2, defects after merge.
- **Too little data per sprint.** A small team closes few tickets, and a single ticket is noisy (QE delegation changed between two runs). Proposals judged on production tickets alone are mostly guesses.
- **Credits depend on the model.** Compare tickets only within the same model; record it in each row.
- **A two-week cycle is slow** while the workflow is still changing daily.
- Ledgers are per machine unless the data travels with the work.

Recommended design: production observes, a fixed suite verifies, people decide.
1. **Ledger carried by the repo.** `team retro` also writes `retro.json` into the change folder, committed with the PR. The team ledger is an aggregation across repos (`team report --since <date>`). Rows carry model, workflow version, quality counters and outlier flags (cost above about twice the median, two or more rework rounds, a tool loop). Outliers show at `done`, not at the sprint retro.
2. **Cheap candidates first, no agent.** A rule table turns signals into candidate changes ("a role with 40 or more reads: tighten its skill"). The improver agent is used only to write the actual change for candidates the team picks.
3. **Verify on a benchmark suite before merge.** The demo stories (PROJ-101 to 105) on the baseline repos run as a regression suite (`setup.mjs --reset`, run, `team retro`). A change must not raise cost or rework on the suite, and the suite must still pass review. This is repeatable, which production tickets are not, and answers the noise problem.
4. **Watch production for three tickets after merge**, then mark the improvement kept or reverted.
5. **Sprint retro stays the decision point**: ledger summary and open improvements with before and after numbers, human notes, then the improver run.

Alternatives considered:
| Option | Verdict |
|---|---|
| Production-only, human triggered (the agreed design) | Simple, but slow and noisy; fine as the base. |
| Auto-propose after every ticket | Frequent, but costs credits each time and proposes from single-run noise. Replaced by cheap rule-based candidates. |
| A/B variants of skills across production tickets | Rigorous, needs far more tickets than the team closes. |
| Fixed benchmark suite | Recommended as the verifier; it costs a few credits per run (about 8 for one ticket) and gets stale if the real work changes. |

## Build order
1. `retro.json`, workflow version stamp, model and quality counters, `team report --since`, human notes at Gate 2.
2. Improvement ledger, candidate rules, improver agent and `/improve`.
3. Benchmark runner (script that resets the repos, runs a story, collects the retro) and the verify command.

Other open work: Java conventions in the skills, ACs from Jira, multi-repo tests, story version comparison, `install.ps1`, CLI and IntelliJ telemetry, scope guard through a `preToolUse` hook (only once hooks are proven).
