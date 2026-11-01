# OTLP trial (P0)

Goal: see what Copilot actually sends, before building anything on it. Nothing here interprets the data.
`captureContent` stays off, so no prompts or code are sent.

## 1. Start the collector
    node team\otel\otel-dump.mjs
Leave it running. It saves everything to `%USERPROFILE%\team-otel-dump`. If port 4318 is busy: `--port 4319` and use that port below.

## 2. Point the clients at it
Use `127.0.0.1`, not `localhost`. On Windows `localhost` can resolve to IPv6 and miss the collector.

### VS Code (user settings.json)
    "github.copilot.chat.otel.enabled": true,
    "github.copilot.chat.otel.exporterType": "otlp-http",
    "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
    "github.copilot.chat.otel.captureContent": false,
    "github.copilot.chat.otel.captureIdentity": false

Ask for JSON, because this collector cannot read protobuf. Set the variables in the shell that starts VS Code, then restart it:

    $env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/json"
    $env:COPILOT_OTEL_PROTOCOL = "http/json"
    code .

Environment variables override the settings. I don't know which of the two protocol variables Copilot reads, so both are set.

### Copilot CLI (PowerShell, same window)
    $env:COPILOT_OTEL_ENABLED = "true"
    $env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
    $env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/json"
    copilot
The CLI supports HTTP only.

### IntelliJ
No documented setting that I found. Try the same environment variables in the shell that starts the IDE. If nothing arrives, IntelliJ does not send OTLP. That is a valid result.

## 3. Generate something worth looking at
In each client, run one short chat that loads a skill and starts a subagent. For example `/run story/PROJ-101.md` and stop at the first gate. A plain "hello" will not show skills or subagents.

## 4. Read the result
    node team\otel\otel-summary.mjs
It prints counts and names only, never prompt text, and answers five questions:
1. Was JSON accepted, or only protobuf?
2. Is the git branch on the spans?
3. Do skill names and custom agent names show up?
4. Are subagent runs linked to their parent?
5. Which client sent data (look for IntelliJ)?

If it prints a WARNING about content attributes, `captureContent` is on. Turn it off.
Paste the summary output back here. Do not paste `requests.jsonl`.

## If nothing arrives
- Collector window shows no lines: the client did not send. Check the settings and that the shell started the client after you set the variables.
- Only protobuf: see the note printed by the summary.
- Corporate proxy: calls to `127.0.0.1` should bypass it. If not, add `127.0.0.1` to `NO_PROXY`.

## Start the collector at logon (instead of by hand)
From PowerShell in this folder:

    .\otel-task.ps1            install the task and start it now
    .\otel-task.ps1 -Status    task state and whether the port is listening
    .\otel-task.ps1 -Remove    stop and delete it

It copies `otel-dump.mjs` and `otel-summary.mjs` to `%USERPROFILE%\.copilot\team\otel\`, so the task keeps working if you delete the Downloads folder.
Run the summary from there: `node $HOME\.copilot\team\otel\otel-summary.mjs`.
If PowerShell blocks the script: `powershell -ExecutionPolicy Bypass -File .\otel-task.ps1`.
The dump file grows without limit. Fine for a trial, not for permanent use.

## Daily collector and per-ticket report
The trial scripts above only dump raw data. For daily use:

| File | What it does |
|---|---|
| `otel-collect.mjs` | Keeps one compact record per span in `~/.copilot/team/telemetry/spool/YYYY-MM-DD.jsonl`. Drops prompts, tool arguments, metrics and logs. Removes duplicates from exporter retries. Deletes spool files older than 30 days. `GET /health` shows counters. |
| `otel-report.mjs <TICKET>` | Matches spans to the ticket and prints credits, tokens, LLM calls, tool errors and loops per phase. |
| `otel-lib.mjs` | Shared code. |
| `otel-lib.test.mjs` | Tests. Run `node --test team\otel\otel-lib.test.mjs`. |

`.\otel-task.ps1` now installs the daily collector. Add `-Dump` to go back to the raw trial collector (they cannot run together, both use the port).

### How a span gets a ticket
Spans carry no ticket, branch or repo. The call log does: `team.mjs` records the exact time of every call.
1. A `team.mjs` call that happened inside a terminal tool span ties that span to the call's ticket and repo.
2. Spans that share a trace, a conversation or a chat session with that span belong to the same ticket. A subagent is linked through its parent chat session.
3. If one conversation covers two tickets in a row, each span goes to the nearest call in time. Spans more than 10 minutes from every call are left out (`--slack-min` changes this).

The report prints how many calls matched a terminal span. If that number is low, the collector was not running during the work, or the terminal tool has another name.

### Try it
1. `.\otel-task.ps1` (or run `node team\otel\otel-collect.mjs`).
2. Do a real `/run` session.
3. `node team\otel\otel-report.mjs PROJ-101`
4. Paste the output here. It has counts, phase names and agent names only.

### Which skills ran
`otel-report.mjs` prints a "Skill evidence" table. No single source is trusted:

| Column | Meaning |
|---|---|
| noted | the skill called `team note-skill` as its first action. The agent can skip this. |
| inferred | the call log shows a step only that skill performs (for example `init-change` for team-explore). The agent cannot skip it if the step happened. |
| hook | a Copilot hook saw `SKILL.md` being read. Needs the discovery hook, see `team\hooks\README.md`. |
| telemetry | a span carried `skill_name`. Not seen so far in VS Code. |

The note column flags mismatches, for example "step happened but no read of the skill was seen". team-test-plan's draft pass leaves no call, so it only shows as inferred after the refine pass.
