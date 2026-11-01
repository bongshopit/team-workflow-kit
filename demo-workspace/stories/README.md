# Test stories

Written in the shape `wf-plan` produces: Jira key, feature, story version, repos, dependencies, ACs with scenario IDs (S1.1 ...).
Each story tests something different about the workflow. Run them in this order.

| Story | Repos | What it tests | Expected result |
|---|---|---|---|
| PROJ-101 | order-service | Basic happy path in one repo | Reaches `done`. Proposal refers to AC IDs. Tests for S1.1 to S3.2 |
| PROJ-102 | inventory-service | Same flow in a different repo, sorting and validation edge cases | Reaches `done` |
| PROJ-103 | inventory-service, order-service | Two repos with a dependency and a shared contract | inventory-service reaches review or done first. order-service waits. Both contract files updated together |
| PROJ-104 | order-service, notification-service | A story with gaps | Explore or propose flags the gaps. Change goes `blocked` or the proposal lists gaps for PO/BA. It must not invent behavior |
| PROJ-105 then PROJ-105.v2 | order-service | The story changes after Gate 1 | Run v1 to `approved`. Swap in v2. The workflow must stop and reopen the proposal, not apply on v1 |

## PROJ-104: the gaps to look for
- Orders have no customer email and no "shipped" status. The story assumes both.
- No "ship" operation exists in order-service.
- S2.3 describes a case that cannot happen: an order cannot be notified as shipped and cancelled at once.
- notification-service has no "shipped" template, only free-form subject and body.
A good run finds at least the first two before writing any code.

## PROJ-105: the change
v2 raises the note limit from 200 to 500 characters, drops the "short" wording, and adds AC3 (trim spaces). Today `team.mjs` stores the story version but never compares it. Expect this one to fail until that rule is added. That is the point of the test.

## How to use
Copy a story into the repo's `story/` folder (or leave it here) and run `/run story/PROJ-101.md`.
After each run, reset the repo (`git reset --hard` and `git clean -fd`) so the next story starts from the baseline.
