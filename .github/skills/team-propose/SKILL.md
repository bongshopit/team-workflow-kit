---
name: team-propose
description: Write the technical proposal and task list for a change in state explored, then record it with the team CLI. The proposal describes the approach, not the requirements.
---

# team-propose

CLI: `node $HOME/.copilot/team/team.mjs` (called `team`).

## Preconditions
`team next-action <folder> --json` says state `explored`. If not, stop.
The QE agent may be writing the test plan at the same time. Do not wait for it.

## Steps
1. Read `explore-report.md` and the story. The ACs and scenarios stay in the story. Refer to them by id (AC1, S2.2). Never copy them.
2. Write `proposal.md` in the change folder:
   - header: Jira, repo, `Approved by: pending`, a line saying requirements live in the story
   - `Approach`: how the code will change, each point tagged with the ACs it serves
   - `Affected code`
   - `API changes`: or `None`
   - `Dependencies`: other repos or tickets and the order, or `None`
   - `Risks`: tagged with scenario ids where relevant
3. Write `tasks.md`:
   - one task = one small step you can verify with a test
   - each task ends with the ACs it serves, for example `(AC1, AC3)`
   - include a task for tests from `test-plan.md` and one for any API contract file
   - format: `- [ ] 1. text`
4. Record it: `team set-status <folder> proposed`. The script checks both files exist and marks `ready.proposal`.
5. Report back: proposal ready. Say the QE refine pass can start.

## Never
- Never restate or "improve" ACs. If one is wrong, say so and ask for a story change.
- Never tick a task or touch `status.json`.
- Never write code in this step.
