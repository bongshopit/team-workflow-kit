---
name: team-test-plan
description: QE skill. Drafts a test plan from the story's ACs and scenarios, flags gaps to the PO/BA, then refines it against the proposal and marks it ready. Two passes, draft and refine.
---

# team-test-plan

CLI: `node $HOME/.copilot/team/team.mjs` (called `team`). You write only `test-plan.md` in the change folder, and test files when asked.

## First action
Record that this skill started: `team note-skill <TICKET> team-test-plan --agent qe`. It changes no state. If it fails, carry on.

## Pass 1: draft (state explored, no test-plan.md yet)
Runs in parallel with the proposal. Do not wait for it.
1. Read the story: ACs and their scenarios (`S<ac>.<n>`). The scenarios are the source. Do not rewrite them.
2. Write `test-plan.md`:
   - one line per scenario: `S1.1 short name   level   target: TBD`
   - `level` is `unit`, `integration` or `e2e`, chosen for the cheapest test that proves the scenario
   - `Coverage: N of M ACs`
   - `Gaps for PO/BA:` unclear or untestable scenarios, missing negative cases, or `none`
3. If there are gaps, report them. Do not fix them yourself.

## Pass 2: refine (state proposed, `test-plan.md` has `target: TBD`)
1. Read `proposal.md`.
2. Replace every `target: TBD` with the real target: endpoint, class or screen. Keep scenario ids and levels unless the proposal makes a level wrong, and say why if you change one.
3. Run `team set-ready <folder> test_plan`. It checks every AC has a scenario and no `TBD` is left. Fix what it reports.
4. When both the proposal and test plan are ready, the script notifies Gate 1 by itself.

## Never
- Never edit the story, the ACs, the proposal or `status.json`.
- Never mark ready with `TBD` targets or an uncovered AC.
