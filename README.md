# Team workflow kit (GitHub Copilot)

One Jira story at a time, per repo, from the story only. Built in-house: skills, agents and one dependency-free Node script.

## Layout
- `team/scripts/team.mjs` the only thing that writes `status.json` (Node 18+). `team.test.mjs` has 16 tests.
- `.github/skills/` team-run, team-explore, team-propose, team-test-plan, team-apply, team-review, team-summary
- `.github/agents/` orchestrator, dev, qe, reviewer
- `.github/prompts/` run, letsgo
- This `.github` folder is the single source. Edit skills and agents here only.
- `demo/` Scenario 1 on a sample repo (`run-demo.mjs`, `baseline/`, `story/`, `fixtures/`, `run-log.json`)
- `demo-run.html` replay of the recorded run

## Install
Skills call `node $HOME/.copilot/team/team.mjs`, so the script must live there.

PowerShell:
    New-Item -ItemType Directory -Force $HOME\.copilot\team | Out-Null
    Copy-Item team\scripts\team.mjs $HOME\.copilot\team\
    # skills, agents and prompts: copy .github into the repo (or a parent folder) you open in VS Code
    Copy-Item .github <your workspace folder> -Recurse

Set `TEAM_TEST_CMD` per repo (`mvn -q test`, `npm test`). Optional `TEAM_NOTIFY_CMD` sends the Gate 1 message.
Check the skill and agent folder locations against your Copilot version. I could not test them against Copilot here.

## Run the demo
    node demo/run-demo.mjs --pause            step by step, Enter to continue (for presenting)
    node demo/run-demo.mjs --record out.json  save the run
    node demo/run-demo.mjs --keep             keep the temp repo to look around
It builds a temp git repo from `demo/baseline`, calls the real `team.mjs`, and ends in state `done` with 9 passing tests.

## What the demo is not
It is a scripted replay. The agent-written files (proposal, test plan, code, review) come from `demo/fixtures`. It proves the scripts, the state rules and the artifacts. It does not prove that Copilot follows the skills. Run `team-run PROJ-123` in Copilot on a real repo for that.

## Known gaps
ACs are passed by hand to `init-change` (not read from Jira). No scope guard, no overlap check across repos, story version stored but not compared, `next-action` cannot wake a dead session.
