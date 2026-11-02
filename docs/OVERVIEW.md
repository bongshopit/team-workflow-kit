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
| summary and PR | orchestrator | team-summary | `<TICKET>-summary.md`, `<TICKET>-audit.md` |
| **Gate 2** | human merges, then `set-status done` | | |

The orchestrator never edits source or `status.json`. It asks `team next-action` what to do and delegates to `qe`, `dev` and `reviewer` as subagents.

## Repo map
| Path | What |
|---|---|
| `.github/agents/`, `skills/`, `prompts/` | The only copy of the agents (orchestrator, dev, qe, reviewer), seven skills and `/run`. VS Code opens `kit`, so it reads these. |
| `team/scripts/team.mjs` | Commands: init-change, set-status, set-ready, request-review, approve, validate-change, record-failure, next-action, note-skill, calls, audit (`retro` is the old name). Writes `status.json`. Logs every call to `~/.copilot/team/calls/<TICKET>.jsonl`, with the reason when it fails. 25 tests. |
| `team/scripts/team-hook.mjs`, `team/hooks/` | Copilot hook: logs which skill was read, by which tool call, in which session. No content. `install-hooks.ps1` installs it. |
| `team/otel/` | Collector (OTLP on 127.0.0.1:4318, daily spool), `otel-report.mjs` (cost, phases, roles, skills, failures), `otel-audit.mjs` (markdown audit), `otel-task.ps1` (logon task). 26 tests. |
| `~/.copilot/team/tickets/<TICKET>/` | Per ticket, on the machine: `ticket.json` (repos and their change folders) and `audit.md` (whole ticket). The contract itself stays in each repo, committed with the PR. |
| `demo-workspace/` | Three Java repos (order, inventory, notification), stories PROJ-101 to 105, `setup.mjs` to create or `--reset` the git baseline. |
| `HANDOFF.md` | Running log of findings and open tasks. This file is the stable summary. |

## How it is observed
1. **Call log**: every `team.mjs` call with time, state before and after, exit code and failure reason. This is the workflow backbone.
2. **OTLP from Copilot Chat** (VS Code): credits per LLM call, tokens, tool calls, errors, agent role. Spans are tied to a ticket by the time of its `team.mjs` calls.
3. **Hook**: deterministic evidence of which skill was read and by which agent (joined to telemetry by tool call id).
4. **Audit** (`team audit <folder>`): all of the above for one ticket, as markdown in the change folder.

VS Code only so far. Copilot CLI and IntelliJ are not tested.

## What is proven, what is not
Proven on PROJ-101 (real Copilot, VS Code):
- The full flow from explore to summary runs, with `qe`, `dev` and `reviewer` as real subagents.
- First full run cost 21.2 credits (reviewer 8.2: 74 single-file reads, one rework round). After the review-cost rule and explicit subagent delegation: about 7.6 credits, 15 reviewer reads, 1 failed tool call. One run each, so treat the percentages as indicative.
- Hook, telemetry and call log join cleanly: 143 of 143 hook events matched a span.

Not proven: multi-repo dependencies (PROJ-103, 104), a story changing version mid-flight (PROJ-105), real `mvn test` on the Java repos, ACs read from Jira (they are passed by hand to `init-change`), CLI and IntelliJ, cost on different models.

## Improvement flow (agreed design, two speeds)
The audit is about the workflow run on one ticket. The retro is the team's sprint meeting. They are kept apart on purpose.

**Per ticket, on the developer's machine (fast)**
1. At `done`, `team audit` writes `<TICKET>-audit.md` and, next, `audit.json` (numbers, model, workflow version, quality counters, signals). The audit agent adds 3 to 5 qualitative lines from `review.md`, the rework reasons and the gate edits.
2. If there are signals, the developer runs `/improve` in a new chat. It applies one small change to the skills, agents or prompts as a commit on `local/<dev>` in the kit, with the signal, the hypothesis and the baseline numbers in the commit message, and adds a ledger row.
3. The change is a trial. It stays a trial for 2 to 3 tickets; the ledger marks it for revert if cost improves but quality counters (findings, rework rounds, gate edits) get worse.

**Per sprint, for the team (slow)**
4. The sprint report (`team report --since <date>`) shows the tickets, the outliers, and every developer's local trials grouped by file and signal, with before and after numbers.
5. The team reads it next to the human retro. Trials that held are cherry-picked onto `main` by the workflow owner. The benchmark suite (PROJ-101 to 105 on the baseline repos) runs once on the merged result as a regression check.

**Rules**
- The improver never edits during a ticket, and runs only when the audit has signals.
- It applies narrow efficiency changes (read budgets, batching, ordering) by itself. Anything touching review criteria, gates, "Never" rules or `team.mjs` waits for the developer's yes.
- One open trial per developer at a time, so a change in the numbers can be pinned on one change.
- Every audit row records the workflow version (hash of the skills and agents) and the model, because credits depend on the model and developers run slightly different workflows.
- Audit files carry no per-person statistics: the unit is ticket and repo.

**Why this shape**: a single ticket is noisy, so the fast loop stays local and reversible; the team only adopts what held up. Cost alone is a trap (the reviewer got about five times cheaper; quality counters are what show it still catches problems). The ledger travels with the work because each `audit.json` is committed with its PR; local trials travel as commits on a shared remote.

Alternatives considered: production-only sprint loop (too slow), auto-proposals after every ticket without a signal (costs credits, learns from noise), A/B variants across tickets (needs more tickets than the team closes).

## Audit and improve agents (first version)
Not part of a ticket run. Both start in a new chat.
- `/audit PROJ-101` (agent `audit`, skill `team-audit`): runs `team ticket`, `team calls`, `otel-report.mjs`, `team audit`, checks the evidence is complete (telemetry arrived, spans matched), classifies each finding (`kit-bug`, `workflow-gap`, `model-behaviour`, `environment`, `expected`) and writes `~/.copilot/team/tickets/<TICKET>/audit-review.md` with at most 3 ranked proposals. It changes nothing else.
- `/improve PROJ-101` (agent `improve`, skill `team-improve`), with the kit folder open: applies one proposal on branch `local/<dev>` with tests, commits with signal, hypothesis and baseline, and adds a row to `docs/improvement-ledger.md`. One open trial at a time; gates, "Never" rules, review criteria and `team.mjs` need the developer's yes; never commits to `main`, never pushes.
This replaces pasting outputs into a chat by hand. Not proven yet: how well a Copilot model does the diagnosis compared with a person.

## Build order
1. `audit.json` with workflow version stamp, model, quality counters, signals; human notes at Gate 2.
2. `/improve`: improver agent and skill, the commit convention, ledger row, trial tracking and the revert flag.
3. `team report --since`: the sprint view and the list of commits to cherry-pick.
4. Benchmark runner for the merge check.

Other open work: Java conventions in the skills, ACs from Jira, multi-repo tests (PROJ-103, 104), story version comparison (PROJ-105), `install.ps1`, CLI and IntelliJ telemetry, scope guard through a `preToolUse` hook (only once hooks are proven).

Animated overview for presenting the design workflow: `docs/workflow-overview.html` (open in a browser; space plays or pauses, arrows move between scenes, F for fullscreen).
