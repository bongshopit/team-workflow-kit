---
name: team-explore
description: Explore a story and the affected repo, write a findings report, and create the change folder with the team CLI. Use as the first step for a ticket that has no change folder yet.
---

# team-explore

CLI: `node $HOME/.copilot/team/team.mjs` (called `team`). Read-only on the repo.

## Input
- Ticket id and the story (from the Jira connector, or a file the human points to).
- The story must carry its ACs, each with at least one scenario. It already contains what the PRD contributed. Do not read or ask for the PRD.

## Steps
1. Read the story. List the AC numbers and their scenarios (`S<ac>.<n>`).
2. Check the story is usable. Stop and ask the human (PO/BA) instead of continuing if:
   - an AC has no scenario,
   - an AC is not testable as written,
   - two ACs contradict each other.
   Do not rewrite or invent ACs.
3. Explore the repo: read the repo context file if one exists, then find the code the story touches (entry points, services, data model, API contract).
4. Write the findings to a scratch file outside the change folder, for example `.team-scratch/explore-report.md`:
   - `Story check:` ACs and scenarios present, gaps or none
   - `Impact:` files and modules affected
   - `Risk:` anything that could break existing behavior
   - `Open questions:` or `none`
   - `Context used:` files you relied on
5. Create the change: `team init-change <repo-root> <TICKET> --report .team-scratch/explore-report.md --acs <comma list of AC numbers> --story <story version>`
6. Report back: the folder path and state `explored`.

## Never
- Never write into the repo source or into `.team/` by hand. `init-change` creates the folder.
- Never change the story or its ACs. Questions go back to the PO/BA.

## Done when
`team next-action <folder>` shows state `explored`.
