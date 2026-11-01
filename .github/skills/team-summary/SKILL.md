---
name: team-summary
description: Orchestrator skill. After a passing review, writes the ticket summary and prepares the pull request for Gate 2. Use when next-action says summary.
---

# team-summary

CLI: `node $HOME/.copilot/team/team.mjs` (called `team`).

## Preconditions
State `review`, `review.md` says `Result: pass`, and `team next-action <folder> --json` says action `summary`.

## First action
Record that this skill started: `team note-skill <TICKET> team-summary --agent <your agent name>`. It changes no state. If it fails, carry on.

## Steps
1. Read `proposal.md`, `tasks.md`, `test-plan.md`, `review.md` and the change's commits.
2. Write `<TICKET>-summary.md` in the change folder:
   - repo and state
   - what changed, in 3 to 5 lines, by AC
   - tasks ticked and test result
   - review result
   - merge order across repos, or `single repo, no dependencies`
   - `Gate 2: waiting for human`
3. Open the pull request (`gh pr create` or the team's usual way) with the summary as its description. Link the Jira ticket. If you cannot open it, print the exact command for the human.
4. Tell the human: Gate 2 is theirs. They review and merge, then run `team set-status <folder> done`.

## Multi-repo
Write one summary per repo and one ticket-level list: repo, PR link, state, merge order. Upstream repos merge first.

## Never
- Never merge. Never run `set-status done`. Both belong to the human at Gate 2.
