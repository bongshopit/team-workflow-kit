---
name: team-audit
description: Audit agent skill. Reads the evidence for one ticket (call log, telemetry report, hook events, change files), classifies what went wrong or cost too much, and proposes small improvements. Use after a ticket run, in a new chat.
---

# team-audit

CLI: `node $HOME/.copilot/team/team.mjs` (called `team`). Report: `node $HOME/.copilot/team/otel/otel-report.mjs`.

## Input
A ticket id, for example `PROJ-101`. Ask for nothing else.

## Steps
1. Gather the evidence. Run these and read the output; do not ask the human for it:
   - `team ticket <TICKET> --json` (repos, change folders, states)
   - `team calls <TICKET>` (every script call with state change and failure reason)
   - `node $HOME/.copilot/team/otel/otel-report.mjs <TICKET>` (cost by role and phase, skills, failed tools, coverage)
   - for each change folder: `team audit <folder>`, then read `<TICKET>-audit.md`, `review.md`, `<TICKET>-summary.md` if they exist
   - the kit version and where the kit is: `$HOME/.copilot/team/kit-version.json`
2. Check that the evidence is complete before judging:
   - "Spans in window: 0" means telemetry did not arrive. Run `Invoke-RestMethod http://127.0.0.1:<port>/health` (port from `kit-version.json`) and say what it shows. Stop the cost analysis there; still analyse the call log and hook events.
   - "Calls matched to a terminal span" much lower than total means span matching is off. Say so; do not trust per-phase numbers.
3. Look for these, in this order:
   - Skill reads: every skill the run reached should show a hook read by the right agent (qe reads team-test-plan, dev reads team-apply, reviewer reads team-review, orchestrator reads team-run, explore, propose, summary). A step that happened without a read is a finding.
   - Process breaks: calls with `exit` codes, guessed status names, a change worked on in the wrong state, an agent doing another agent's work (for example no `qe` role but a test plan exists).
   - Cost: the role or phase that holds more than half the credits; tool calls that failed repeatedly; reads per file; the same tool called many times in a row.
   - Quality: review findings, rework rounds, edits at Gate 1.
   - Gates: any `approve` or `set-status done` not made by the human (the call log shows who ran what only by time; flag anything that looks like an agent ran it).
4. Classify each finding as one of:
   - `kit-bug`: our scripts or report are wrong (for example a number does not add up, a tool name is not recognised).
   - `workflow-gap`: a skill or agent instruction is missing, unclear or too costly.
   - `model-behaviour`: the model ignored a clear instruction. Only after you checked the instruction exists and is clear.
   - `environment`: collector, proxy, settings, permissions.
   - `expected`: not a problem (for example a harmless `list_dir` on a folder).
5. Write `$HOME/.copilot/team/tickets/<TICKET>/audit-review.md`:
   - **Verdict**: 3 to 5 lines. State reached, credits, what mattered most.
   - **Evidence check**: what was complete or missing.
   - **Findings**: a table of id, class, evidence (quote the number or line), impact.
   - **Proposals**: at most 3, ranked. Each has: the finding id, the exact change (file and what to change), expected effect with a number, risk, and whether it touches a gate, a "Never" rule, review criteria or `team.mjs` (those need the developer's yes).
   - **Quality counters**: review findings, rework rounds, tests added, Gate 1 edits.
6. Tell the human the verdict, the top proposal, and: "To apply it, open the kit folder in a new chat and run /improve <TICKET>."

## Never
- Never change any file other than `audit-review.md`.
- Never propose a change without a finding that backs it.
- Never claim a cost saving you cannot compute from the report. One ticket is noisy; say so when a number rests on one run.
