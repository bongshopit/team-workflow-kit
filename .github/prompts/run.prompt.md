---
description: Run or continue one story through the team workflow
agent: orchestrator
---
Run the team workflow for this story: ${input:story:Ticket id or story file, e.g. PROJ-123 or story/PROJ-123.md}

Load the `team-run` skill and follow it exactly.
- Find the change folder for this story in this repo. If none exists, start with `team-explore`.
- Ask `node $HOME/.copilot/team/team.mjs next-action <folder> --json` and do only what it says.
- Delegate to the dev, qe and reviewer agents as the skill's table says. Do not do their work yourself.
- Stop at Gate 1 (approval), Gate 2 (merge) and blocked changes. Tell me what to review and the exact command to run next.
- Never edit `status.json`, never approve, never skip a gate.
- The story is the only input. Do not ask for the PRD.
