---
name: team-apply
description: Dev skill. Implements an approved change in one repo, task by task, with tests, then validates and moves it to review. Use when the change state is approved or applying.
---

# team-apply

CLI: `node $HOME/.copilot/team/team.mjs` (called `team`). Work only inside this repo and its change folder.
Set `TEAM_TEST_CMD` to the repo's build and test command (for example `mvn -q test` or `npm test`).

## Preconditions
- State is `approved` or `applying`. If not, stop.
- `proposal.md`, `tasks.md` and `test-plan.md` exist.

## First action
Record that this skill started: `team note-skill <TICKET> team-apply --agent <your agent name>`. It changes no state. If it fails, carry on.

## Steps
1. If the state is `approved`: `team set-status <folder> applying`. If it refuses, stop and report why.
2. Read `proposal.md`, `tasks.md` and `test-plan.md`. The tests you write come from the plan's scenarios.
3. For each unticked task, in order:
   1. Implement it. Keep changes small and inside the proposal's scope.
   2. Run `TEAM_TEST_CMD`.
   3. If tests fail, fix and rerun. When a test fails a second time run `team record-failure <folder> "<test name>"`. If it says BLOCKED, stop and report.
   4. When green, tick the task in `tasks.md` (`- [x]`).
   5. Commit with the ticket id in the message.
4. If you need something outside this repo or outside the proposal, or a requirement is unclear: `team set-status <folder> blocked --reason "<why>"`, then stop.
5. When every task is ticked: `team validate-change <folder> --for review`, then `team set-status <folder> review`.
6. Report: tasks done, test result, state `review`.

## Resuming
If you are restarted, run `team next-action <folder>`. It tells you the first unticked task. Check the working tree for half-done edits, keep or revert them, rerun tests, continue.

## Never
- Never edit `status.json`, the story, the proposal or the test plan. Disagreement goes through `blocked`.
- Never tick a task whose tests are not green.
- Never touch another repo, merge, or deploy.
