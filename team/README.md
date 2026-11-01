# team.mjs - change contract helper (draft v0.2)

One file, Node 18+, no dependencies. Works the same in PowerShell, Git Bash and WSL.
It replaces the earlier `set-status.sh`. Only this script writes `status.json`.

    node scripts/team.mjs help
    node --test scripts/team.test.mjs      # 16 tests

A change folder is `<repo>/.team/changes/<TICKET>/`. Every command except `init-change` takes that folder.

## Commands

| Command | Who calls it | What it does |
|---|---|---|
| `init-change <repo> <TICKET> --report <file> --acs 1,2,3 [--story v3]` | orchestrator, end of explore | Creates the folder, copies the findings report, writes `status.json` in state `explored`. Refuses if the change exists. |
| `set-status <folder> proposed` | orchestrator, after propose | Checks `proposal.md` and `tasks.md` exist, sets `ready.proposal`, then runs `request-review`. On a second call it counts as a revision: approval and `ready.test_plan` are cleared. |
| `set-ready <folder> test_plan` | QE agent, after the refine pass | Checks every AC has a scenario (`S<ac>.<n>` lines) and no `target: TBD` is left. Then runs `request-review`. |
| `request-review <folder>` | automatic | Notifies Gate 1 once, only when both `ready` flags are true. Runs `TEAM_NOTIFY_CMD` if set. |
| `approve <folder> <name>` | human (or the session on their behalf) | Needs state `proposed` and both flags ready. Records approver and time, moves to `approved`. The only way to reach `approved`. |
| `set-status <folder> applying` | dev agent | Needs an approver and both flags. From `review` it counts a review round, and refuses after 2. |
| `record-failure <folder> <test>` | dev agent | Counts failures per test. The same test twice moves the change to `blocked`. |
| `set-status <folder> review [--skip-tests]` | dev agent | Runs the validator: all tasks ticked, and `TEAM_TEST_CMD` passes (or `--skip-tests`). |
| `set-status <folder> done` | orchestrator, after merge | Validator: tasks ticked, `review.md` says `Result: pass` with no open `- [ ]`, summary file exists. |
| `set-status <folder> blocked --reason "..."` | anyone | Remembers where it was blocked from. Resume with `set-status <folder> <that state>`. |
| `set-status <folder> abandoned` | human | Allowed in any state except `done`. |
| `validate-change <folder> [--for apply\|review\|done]` | team-apply, dev | Same checks without changing state. |
| `next-action <folder> [--json]` | orchestrator | Prints what to run next for the current state. |

## next-action

| State | Action | Agent |
|---|---|---|
| `explored` | `propose` (and `test-plan` in parallel), then `set-status proposed` | orchestrator, QE |
| `proposed` | `qe-refine`, then `request-review`, then `wait-gate-1` | QE, script, human |
| `approved` | `team-apply` | orchestrator |
| `applying` | `dev-resume` at the first unticked task | dev |
| `review` | `review`, then `summary`, then `wait-gate-2` | reviewer, orchestrator, human |
| `blocked` | `human`, with the reason | human |
| `done`, `abandoned` | `none` | - |

## Allowed transitions

    explored  -> proposed
    proposed  -> proposed (revision) | approved (approve only)
    approved  -> applying | proposed (reopen)
    applying  -> review
    review    -> applying (max 2 rounds) | done
    blocked   -> where it was | applying | proposed
    any except done -> blocked | abandoned
    done      -> nothing (a revert or hotfix is a new change)

## Environment

- `TEAM_TEST_CMD`: command that builds and runs tests, run from the repo root. Example: `mvn -q test`.
- `TEAM_NOTIFY_CMD`: command that posts the Gate 1 message. It gets `TEAM_NOTIFY_MESSAGE` and `TEAM_TICKET`.

## Exit codes

1 general, 2 illegal transition, 3 approval rule, 4 missing reason, 5 validation failed, 6 retry limit reached, 64 usage.

## Not done yet

- Reading ACs from Jira: `--acs` is passed by hand. A plan skill could fill it from the story.
- A scope guard that denies edits outside the repo and change folder.
- `files_touched` for detecting two tickets editing the same file.
- Storing the story version and comparing it with Jira to catch mid-flight edits (`story` is stored, never compared).
