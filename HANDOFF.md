# Handoff: team workflow kit ("build workflow" project)

Read this first. It carries everything decided so far, so work can continue in a Copilot project without the earlier chat.

## Goal
An AI-native delivery workflow built in-house (no OpenSpec, no third-party libraries). Team LEGO, Java/Angular microservices, GitHub Copilot, Windows + PowerShell, Node installed.
One Jira story at a time, per repo, from the story only. The story already carries ACs and detailed scenarios, split from the PRD at PI planning by the existing `wf-plan` skill. Do not ask for the PRD.

## Design decisions
- Change contract per repo: `<repo>/.team/changes/<TICKET>/` with `explore-report.md`, `proposal.md`, `tasks.md`, `test-plan.md`, `status.json`, `review.md`, `<TICKET>-summary.md`.
- States: `explored -> proposed -> approved -> applying -> review -> done`, plus `blocked` and `abandoned`.
  - `proposed -> proposed` is a revision (new approval needed).
  - `approved -> proposed` reopens the proposal.
  - `review -> applying` is capped at 2 rounds.
  - `done` is terminal. `blocked` resumes to where it was blocked from, or to `applying` or `proposed`.
- Only `team.mjs` writes `status.json`. Only `team approve` reaches `approved`.
- `ready` checklist `{proposal, test_plan}` lives in `status.json`. `request-review` notifies Gate 1 only when both are ready.
- Roles: orchestrator (router, follows `next-action`), dev, qe, reviewer. Humans own Gate 1 (approve), Gate 2 (merge) and blocked decisions.
- Parallelism: after `explored`, the orchestrator writes the proposal and QE drafts the test plan at the same time. After `proposed`, QE refines the plan, then `set-ready test_plan`.
- Proposal is technical approach only. It refers to AC and scenario IDs (S1.1) and never copies requirements.

## What exists (all in this kit)
- `team/scripts/team.mjs` (Node 18+, no dependencies) and `team.test.mjs` (16 tests, run `node --test team/scripts/team.test.mjs`).
  Commands: init-change, set-status, set-ready, request-review, approve, validate-change, record-failure, next-action. Env: `TEAM_TEST_CMD`, `TEAM_NOTIFY_CMD`.
  Exit codes: 2 illegal transition, 3 approval rule, 4 missing reason, 5 validation failed, 6 retry limit, 64 usage.
- `.github/skills/`: team-run, team-explore, team-propose, team-test-plan, team-apply, team-review, team-summary.
- `.github/agents/`: orchestrator, dev, qe, reviewer (`*.agent.md`).
- `demo/`: scripted replay of Scenario 1 on a Node sample repo (`node demo/run-demo.mjs --pause`). Ends in `done`, 9 tests green. `demo-run.html` replays the recorded run.

## What is NOT proven
- No skill or agent has run in real Copilot. The replay uses fixtures for agent output.
- Unknown: where Copilot loads skills and agents from in your version, and whether the orchestrator can start dev/qe as subagents, especially in parallel.
- Skills assume a generic test command. Java conventions are not written in yet.

## Known gaps in team.mjs
ACs are passed by hand to `init-change` (not read from Jira). No scope guard. No `files_touched` overlap check across repos. Story version stored but not compared. `next-action` cannot wake a dead session (re-run `team-run`).

## Entry point
Start every session with the prompt `/run <ticket or story file>` (`.github/prompts/run.prompt.md`). It selects the orchestrator agent and loads `team-run`. Re-run it to continue after a gate or a dead session. Verify the `agent:` frontmatter field works in your Copilot version; if not, pick the orchestrator in the dropdown and say "run <ticket>".

## Next tasks, in order
1. Java demo app: tiny Maven + JUnit 5 order-service (no Spring). `TEAM_TEST_CMD="mvn -q test"`.
2. Sample story `story/PROJ-123.md` in wf-plan shape (ACs + scenarios S1.1...). Let `team-run` and `team-explore` accept a story file path (`run story/PROJ-123.md`) since there is no Jira in the test.
3. `team verify-run <folder>`: checks state history order, proposal refers to IDs without copying them, every story scenario appears in test-plan.md and in a test, changed files stay inside the proposal's "Affected code", tasks ticked, tests pass, review says pass. Output a pass/fail list.
4. `install.ps1`: copy team.mjs to `$HOME\.copilot\team\`, skills and agents to the folders Copilot reads, set `TEAM_TEST_CMD`, print what was installed.
5. Run checklist (one page): what to type per stage, what to watch, how to reset (`git reset`, delete `.team/`).
6. Live run in Copilot on the Java demo. Loop: run, verify, tighten skill wording, reset. Expect 2-3 rounds. Watch for: skills not loading, orchestrator improvising instead of using `next-action`, parallel step failing (fallback: two sequential prompts), agents editing `status.json` by hand, ACs copied into the proposal.
7. Later: read ACs from Jira, scope guard, multi-repo `depends_on`, update the older Remotion project and scenario diagrams to the parallel flow.

## Telemetry (OTLP) findings, from a real VS Code run
- Collector trial: `team/otel/` (`otel-dump.mjs`, `otel-summary.mjs`, `otel-task.ps1` registers a logon task `TeamOtelCollector`). Settings in `team/otel/README.md`.
- Works: JSON over OTLP/HTTP is accepted (set `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`). Custom agents show under their own name (`qe`). Subagent spans link to the parent (`parent_chat_session_id`, child of `execute_tool runSubagent`). Tool success and duration are in the logs.
- Credits are on `chat` spans: `copilot_chat.copilot_usage_nano_aiu` / 1e9 = credits (8.69 vs the 8.7 VS Code showed). One sample, VS Code only.
- Token totals: `invoke_agent` spans roll up their `chat` spans. Count `chat` spans only or everything doubles. About 97% of input was cache reads.
- Not present: git branch, repo, workspace, or any ticket on spans. Ticket attribution must come from the call log: match each `team.mjs` call time to the `execute_tool run_in_terminal` span that contains it. Subagents inherit via `parent_chat_session_id`.
- Metrics repeat what spans and logs say and arrive often. The collector drops them unless `--keep-metrics`.
- Not tested yet: Copilot CLI, IntelliJ, and whether skill loads show `github.copilot.tool.parameters.skill_name`.

## Call log (done)
`team.mjs` appends every call to `~/.copilot/team/calls/<TICKET>.jsonl` (time, repo, command, detail, exit code, state before and after). `team note-skill <TICKET> <skill> [--agent x]` records a skill start; every skill's first action calls it. `team calls <TICKET>` prints it. `TEAM_HOME` moves it, `TEAM_CALLS=off` disables it.

## Telemetry tasks
a. Skill evidence (done, needs a real run): `otel-report.mjs` prints noted / inferred / hook / telemetry per skill. Discovery hook: `team/scripts/team-hook.mjs` + `team/hooks/` (install with `install-hooks.ps1`); it logs tool names, argument key names and SKILL.md reads to `~/.copilot/team/hooks/events.jsonl`. Open: confirm hooks fire in VS Code (preview, may be blocked by policy), whether subagent tool calls fire them, and how skills are loaded. Scope for now: VS Code only; Copilot CLI and IntelliJ later.
b. DONE (needs a real run): `otel-collect.mjs` spools compact span records; `otel-report.mjs <TICKET>` attributes them to a ticket through the call log and prints credits, tokens, tool errors and loops per phase. Check how many calls matched a terminal span on real data. Still to add: Copilot CLI and IntelliJ spans, logs for tool success flags.
c. `team audit <folder>` (done, see below): phase times from `status.json`, credits, tokens (cache shown apart), tool errors, loops, skills used vs the call log.
d. `team report` across repos for a sprint, joined with the usage dashboard.

## Working rules for the next session
- Keep it dependency-free. Node scripts, no bash (PowerShell users).
- Any state change goes through `team.mjs`. Add tests for every new command.
- Keep skills short, with preconditions, steps and a Never list.

## Hook findings (VS Code, real run)
- Hooks fire. Skill reads seen: team-run, team-explore, team-test-plan, team-propose.
- Payload has no agent identity. Added `session`, `tool_use_id`, `repo`, `model` to the log, and `read by` in the report skill table (join to telemetry by tool call id).
- team-test-plan and team-propose reads were 18 ms apart. That alone does not prove QE ran in parallel; the `read by` column will show who read them.
- Next: rerun `/run PROJ-101`, then paste `otel-report.mjs PROJ-101`, `team.mjs calls PROJ-101`, head of `events.jsonl`.

## First full run of PROJ-101 (VS Code)
- 21.2 credits: reviewer 8.2, main 6.6, dev 3.5, qe 2.9. Review phase was half the cost: 1 rework round, 74 single-file reads by the reviewer (one model call each), 9 failed reads/list_dir.
- Fix applied: "Keep the review cheap" section in team-review and a rule in reviewer.agent.md. Compare the next run's reviewer credits and read_file count.
- team-summary writes a file only (no team.mjs step) by design; ticket stays in review until the human sets done.
- Call log now records the failure reason for non-zero exits.

## Single source (2026-11-01)
`kit/.github` is the only copy of agents, skills and prompts. The old `kit/copilot` folder was deleted. VS Code is opened on `kit`, so it reads `kit/.github`. The hook log field `skill_src` shows which folder each skill was read from.

## note-skill removed from the skills (2026-11-01)
The hook gives skill evidence for all seven skills (read by the right agent, joined to telemetry by tool call id), so the "First action: note-skill" step was removed from every skill. The `note-skill` command stays in team.mjs for manual use and for clients without hooks (Copilot CLI and IntelliJ are not tested yet; re-add the first action there if their hooks do not report skill reads).
The hook must be installed (`team/hooks/install-hooks.ps1`) or the report shows "no read of the skill was seen".

## team audit (2026-11-01)
Named audit, not retro, so it is not confused with the scrum retro. `team retro` still works for one release and says it was renamed.
`node team.mjs audit <change folder>` writes `<TICKET>-audit.md` into the change folder: signals, cost by role and phase, time per state, rework rounds, Gate 1 wait, skills with who read them, failed script and tool calls, coverage. It changes no state.
It runs `otel/otel-report.mjs --md --out ...` found next to team.mjs (`otel/`, or `../otel/` in the kit), or `TEAM_OTEL_REPORT`. Installed copy: `~/.copilot/team/otel/` needs otel-report.mjs, otel-lib.mjs and otel-retro.mjs.
team-summary runs it as step 2. Re-run it after Gate 2 for the final numbers. The module is `otel/otel-audit.mjs`.
Not built: `team report` (all tickets in a period).

## Improvement flow, two speeds (agreed 2026-11-01)
After a ticket is done: `team audit` -> if it has signals, a fresh `/improve` chat applies one small change locally (a commit on `local/<dev>` in the kit, with signal, hypothesis and baseline in the message) and notes it in the ledger -> at the sprint retro the team reviews the local changes from all developers and cherry-picks the agreed ones. See docs/OVERVIEW.md.

## Multi-repo tickets (2026-11-01)
Decision: one developer runs a ticket across all its repos cloned on one machine. Shared state across developers is not built.
- `init-change ... --depends-on repoA,repoB` (from the story's "Depends on" line); `set-depends <folder> <repos|none>` to fix it.
- Local registry `~/.copilot/team/tickets/<TICKET>/ticket.json` (repo -> change folder). Derived data; any command on a change folder registers it.
- `next-action` in `approved` returns `wait-upstream` until every upstream repo is in review or done; `set-status applying` fails (exit 5, "upstream: ...") the same way.
- `team ticket <TICKET> [--json]`: state per repo, dependencies and the merge order (upstream first).
- team-explore passes `--depends-on`, team-run handles `wait-upstream`, team-summary takes the merge order from `team ticket`, team-review checks the story's "Contract note" for its side.
- Still to test with a real run: PROJ-103 and PROJ-104.

## Where files live (2026-11-01)
- Per repo, committed with the PR: `<repo>/.team/changes/<TICKET>/` (status.json, proposal, tasks, test plan, review, summary, and a copy of `<TICKET>-audit.md`).
- Per ticket, on this machine: `~/.copilot/team/tickets/<TICKET>/ticket.json` (registry) and `audit.md` (whole ticket, all repos). Calls, hooks and telemetry stay under `~/.copilot/team/`.
- Explore scratch stays in the workspace (`.team-scratch/`, git-ignored): agents write there without extra prompts. Moving it under `~/.copilot` would mean agent file edits outside the workspace.

## First real multi-repo run: PROJ-103 (2026-11-01)
- Worked: `wait-upstream` held order-service while inventory-service applied; it continued once inventory reached review. `team ticket` showed both repos and the merge order. About 22 credits for two repos.
- Problem found in the call log: 7 failed calls came from a retyped absolute path (`C:\Users\mnghia\...` instead of `tmnghia`). Likely also behind many failed read_file/list_dir calls (QE and dev looped on them).
- Fixes: `folderArg` in team.mjs resolves a wrong prefix through the registry; skills and agents say to copy the folder from `team ticket --json`; the hook records `path_check` (ok, missing, directory, relative, wrong-home) so the report can show which failed reads were bad paths; failure reasons keep every line; retried subagent calls get their own label; an audit call counts as team-summary evidence; explore writes the report before init-change.
