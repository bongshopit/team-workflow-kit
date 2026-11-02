---
name: team-improve
description: Improve agent skill. Takes one proposal from a ticket's audit-review.md, applies it to the kit on a local branch with tests, commits it with signal, hypothesis and baseline, and adds a ledger row. Use in the kit folder, in a new chat.
---

# team-improve

## Input
A ticket id (the audit must exist: `$HOME/.copilot/team/tickets/<TICKET>/audit-review.md`) and optionally a proposal number. Default: proposal 1.

## Steps
1. Read `audit-review.md` and the proposal. Find the kit: `$HOME/.copilot/team/kit-version.json` has the kit folder; confirm you are in it (`git rev-parse --show-toplevel`).
2. Check the ledger `docs/improvement-ledger.md`:
   - If a row of this developer is `open`, stop. Say which trial is open and that it needs 2 to 3 tickets before another change. One open trial at a time.
3. Decide the kind:
   - `kit-bug` (scripts or report wrong): fix it with a test that fails before and passes after. It is not a trial.
   - `workflow-gap` (skills, agents, prompts): a trial.
   - `environment` or `model-behaviour` with no instruction to change: do not edit; write what the developer should do, and stop.
4. If the change touches a gate, a "Never" rule, review criteria, `validate-change` checks or anything that lets an agent do something a human owns, stop and ask for a yes. Do not apply it first.
5. Make sure you are on `local/<git user.name>` (create it from `main` if missing). Run `node --test team/scripts/team.test.mjs team/otel/otel-lib.test.mjs`. All must pass before you edit.
6. Make the smallest change that addresses the finding. Edit only the files the proposal names. Keep the style of the surrounding text.
7. Run the tests again. For a script change, add or adjust a test.
8. Commit with this message:
   ```
   improve(<area>): <one line>

   Signal: <finding id and the number from the audit>
   Hypothesis: <what should get better, by how much>
   Baseline: <ticket, credits, failures or the counter you expect to move>
   Trial: yes | no (kit-bug)
   Source: <TICKET> audit-review proposal <n>
   ```
9. Add a row to `docs/improvement-ledger.md`: date, developer, ticket, commit, file(s), signal, baseline, status `open` (trial) or `fixed` (kit-bug). Commit it with the change.
10. Tell the developer: what changed in two lines; to refresh the installed copy run `.\workflow-kit-install.ps1 -Status`, then the installer without `-SkipTests` if files differ; and that the trial needs the next 2 to 3 tickets, each with `/audit`, before it is judged.

## Never
- Never commit to `main`. Never push. Never edit during a ticket run.
- Never apply two proposals in one run.
- Never remove a check that makes an agent safer to save credits.
