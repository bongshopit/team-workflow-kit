---
name: team-review
description: Reviewer skill. Compares the diff of a change in state review with its proposal, the story's ACs and the team conventions, and writes review.md with a pass or fail result.
---

# team-review

CLI: `node $HOME/.copilot/team/team.mjs` (called `team`). Read-only except for `review.md`.

## Preconditions
`team next-action <folder> --json` says action `review` (state `review`).

## Keep the review cheap
A measured review used 74 single-file reads, each one a separate model call that re-sent the whole context. To avoid that:
- Fetch everything in one go: run `git diff --stat <base>...<branch>` and `git diff <base>...<branch>` together in one terminal command, and read the four change documents in the same turn (ask for all the reads at once).
- Work from the diff. Open a whole file only when the diff lacks the context a finding needs, and then request all such files in one turn.
- Take paths from the diff and the change documents. Do not list directories and do not guess paths. A read that fails once is not retried with another guess; use `git ls-files <name>` once instead.
- Never re-read a file already read. Run the tests once (`TEAM_TEST_CMD`), not after every check.
- Starting budget: about 25 file reads. If you need more, say why in `review.md`.

## Steps
1. Read `proposal.md`, `tasks.md`, `test-plan.md` and the story's ACs.
2. Get the diff of the change branch against the base branch (`git diff <base>...<branch>`).
3. Check:
   - every proposal point is implemented, and nothing outside the proposal's scope changed
   - each AC is covered by at least one test that matches a scenario in the plan
   - tests pass (run `TEAM_TEST_CMD`)
   - team conventions: naming, error handling, no leftover debug code, API contract file updated when the API changed
4. Write `review.md`:
   - `Reviewer: reviewer agent`
   - `Compared:` what you compared
   - one line per AC: `AC1: covered by ...`
   - `Conventions: ok` or the problems
   - `Findings:` `none`, or one `- [ ] <finding>` per issue with file and line
   - last line `Result: pass` or `Result: fail`
5. Report the result. On `fail` the orchestrator sends the change back with `team set-status <folder> applying` (maximum 2 rounds).

## Never
- Never edit source, tests, the proposal or `status.json`.
- Never pass with an open finding. Open findings are `- [ ]` lines.
