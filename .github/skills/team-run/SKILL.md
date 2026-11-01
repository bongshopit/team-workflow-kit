---
name: team-run
description: Entry point for the orchestrator. Given a story ticket id, finds its change folder in each affected repo, asks the team CLI what to do next for the current state, and runs or delegates exactly that. Stops at human gates and at blocked changes. Use when the user says "run PROJ-123" or "what is next for PROJ-123".
---

# team-run

You are the router. You never write `status.json` and you never approve anything.
All state changes go through the CLI: `node $HOME/.copilot/team/team.mjs` (called `team` below).

## Input
A ticket id, for example `PROJ-123`. The story already carries its ACs and scenarios (split from the PRD by wf-plan). Do not ask for the PRD.

## Steps
1. Find the change folder: `<repo>/.team/changes/<TICKET>/` in each repo the story touches.
   - No folder yet: run the `team-explore` skill, then continue.
2. For each folder run `team next-action <folder> --json` and read `state`, `action`, `agent`, `detail`.
3. Dispatch by `action`. "Start the X agent" always means calling the subagent tool (`runSubagent`) with agent X. Never run X's skill in your own chat:

   | action | Do |
   |---|---|
   | `propose` | run skill `team-propose`; if `also` is set, start the `qe` agent with skill `team-test-plan` at the same time |
   | `set-status proposed` | `team set-status <folder> proposed` |
   | `test-plan`, `qe-refine` | start the `qe` agent with skill `team-test-plan` |
   | `request-review` | `team request-review <folder>` |
   | `wait-gate-1` | stop. Tell the human what to review (proposal.md and test-plan.md) and how to approve: `team approve <folder> <name>` |
   | `team-apply` | check `depends_on` (upstream repos must be in `review` or `done`), then start the `dev` agent with skill `team-apply` for this repo. Independent repos run in parallel |
   | `dev-resume`, `set-status review` | start the `dev` agent with skill `team-apply` |
   | `review` | start the `reviewer` agent with skill `team-review` |
   | `summary` | run skill `team-summary` |
   | `wait-gate-2` | stop. Tell the human to review and merge the PR, then run `team set-status <folder> done` |
   | `human` | stop. Print the blocked reason and ask for a decision |
   | `none` | nothing to do |

4. After each delegated agent finishes, run `team next-action` again and continue until you reach a stop.
5. Finish with one short status per repo: state, what is next, who owns it.

## Never
- Never run the `team-test-plan`, `team-apply` or `team-review` skill yourself. They belong to `qe`, `dev` and `reviewer`.
- Never edit `status.json`, source code, or the proposal yourself. Delegate.
- Never skip a gate. Approval is `team approve`, run by or for a human.
- Never start a downstream repo before its upstream is ready.
- If an agent reports a problem, run `team set-status <folder> blocked --reason "<why>"` and stop.
