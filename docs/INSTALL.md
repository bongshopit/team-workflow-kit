# Install the team workflow on your machine (Windows, VS Code)

Goal: run one real ticket through the workflow, with telemetry so you can see cost and which skills ran.
Time: about 20 minutes the first time.

## What gets installed where

| What | From the kit | To | Why |
|---|---|---|---|
| `team.mjs` | `team\scripts\` | `%USERPROFILE%\.copilot\team\` | The only writer of `status.json`. Skills call it by this path. |
| `team-hook.mjs` | `team\scripts\` | `%USERPROFILE%\.copilot\team\` | Logs which skill files were read. Names only. |
| otel scripts | `team\otel\` | `%USERPROFILE%\.copilot\team\otel\` | Collector, `team audit`, report. |
| hook config | `team\hooks\` | `%USERPROFILE%\.copilot\hooks\` | Tells VS Code to run the hook. |
| agents, skills, prompts | `.github\` | `.github\` of the folder you open in VS Code | What Copilot loads. |

Nothing is installed globally except the `.copilot\team` and `.copilot\hooks` folders. Remove them to uninstall.

## 0. Check the machine

    node --version        # 18 or newer
    git --version
    mvn -v                # only if your repos run Maven tests

You need VS Code with GitHub Copilot Chat, with agent mode and subagents enabled for your account.
If your organisation blocks hooks, steps 5 still installs but no events will appear. The workflow still runs; only the "which skill was read" evidence is lost.

## 1. Get the kit and run its tests

    cd C:\Users\tmnghia\Downloads\team-workflow-kit\kit
    $KIT = (Get-Location).Path
    node --test team\scripts\team.test.mjs team\otel\otel-lib.test.mjs

All tests must pass. If not, stop and send the output.

## 2. Install the scripts

    $T = "$HOME\.copilot\team"
    New-Item -ItemType Directory -Force $T, "$T\otel" | Out-Null
    Copy-Item "$KIT\team\scripts\team.mjs"      $T -Force
    Copy-Item "$KIT\team\scripts\team-hook.mjs" $T -Force
    Get-ChildItem "$KIT\team\otel\*.mjs" -Exclude "*.test.mjs" | Copy-Item -Destination "$T\otel" -Force
    node "$T\team.mjs" help

`help` should list the commands. `team audit` finds the report script in `$T\otel`, so keep that folder next to `team.mjs`.

Optional shortcut for your shell session (the skills do not need it):

    function team { node "$HOME\.copilot\team\team.mjs" @args }

## 3. Start the telemetry collector

    cd $KIT\team\otel
    .\otel-task.ps1
    .\otel-task.ps1 -Status
    Invoke-RestMethod http://127.0.0.1:4318/health

It installs a Windows scheduled task that starts the collector at logon and starts it now.
If PowerShell blocks the script: `powershell -ExecutionPolicy Bypass -File .\otel-task.ps1`.
If port 4318 is taken, use `-Port 4319` and use the same port in step 4.
The collector keeps compact span records only (no prompts, no code) and deletes files older than 30 days.

## 4. Point VS Code at the collector

Add to your user `settings.json` (Ctrl+Shift+P, "Open User Settings (JSON)"):

    "github.copilot.chat.otel.enabled": true,
    "github.copilot.chat.otel.exporterType": "otlp-http",
    "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
    "github.copilot.chat.otel.captureContent": false,
    "github.copilot.chat.otel.captureIdentity": false

Use `127.0.0.1`, not `localhost`. Keep `captureContent` false.

The collector reads JSON, not protobuf. Make the setting stick for every VS Code start:

    [Environment]::SetEnvironmentVariable("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json", "User")
    [Environment]::SetEnvironmentVariable("COPILOT_OTEL_PROTOCOL", "http/json", "User")

Close every VS Code window and start it again (new environment variables are only read by new processes).

## 5. Install the hook

    cd $KIT\team\hooks
    .\install-hooks.ps1
    .\install-hooks.ps1 -Status

Restart VS Code after this too. Remove later with `.\install-hooks.ps1 -Remove`.

## 6. Install agents and skills into your workspace

Decide which folder you open in VS Code:
- **A parent folder holding several repos** (best for multi-repo tickets): copy once into that folder.
- **One repo**: copy into that repo.

    $W = "C:\path\to\the\folder\you\open\in\VSCode"
    New-Item -ItemType Directory -Force "$W\.github" | Out-Null
    foreach ($d in "agents", "skills", "prompts") { Copy-Item "$KIT\.github\$d" "$W\.github\" -Recurse -Force }

This adds files and leaves any other content of your `.github` alone. Check it:

    Get-ChildItem "$W\.github\agents", "$W\.github\skills" | Select Name

You should see 4 agents (orchestrator, dev, qe, reviewer) and 7 `team-*` skill folders.

Git hygiene in each repo you will change:
- `.team\changes\<TICKET>\` is the change contract. Commit it with the PR.
- Add `.team-scratch/` to `.gitignore` (explore scratch notes).

## 7. Tell the workflow how to run tests

Per repo, the command the dev and reviewer use. Set it for the shell VS Code runs in:

    [Environment]::SetEnvironmentVariable("TEAM_TEST_CMD", "mvn -q test", "User")      # Maven repos
    # npm repos: "npm test"

If your repos differ (Maven and Angular), set it per terminal profile or per repo instead. Restart VS Code afterwards.
Optional: `TEAM_NOTIFY_CMD` runs a command at Gate 1 (for example to send a message).
`TEAM_CALLS=off` stops the call log.

## 8. Check the install end to end

| Check | Command | Expected |
|---|---|---|
| Script runs | `node $HOME\.copilot\team\team.mjs help` | command list |
| Collector alive | `Invoke-RestMethod http://127.0.0.1:4318/health` | counters, no error |
| Hook installed | `.\install-hooks.ps1 -Status` in `team\hooks` | hook file present |
| Agents visible | VS Code Chat, agent picker | orchestrator, dev, qe, reviewer |

## 9. Do a dry run on the demo repos first

This proves the install without touching real code.

    cd $KIT\demo-workspace
    node setup.mjs
    cd repos\order-service
    mvn -q test          # 6 tests pass

Open `demo-workspace` (with `.github` copied in as in step 6) in VS Code, open a NEW chat, pick the **orchestrator** agent and run:

    /run PROJ-101

Follow the prompts. At Gate 1 read the proposal and test plan, then approve in a terminal:

    node $HOME\.copilot\team\team.mjs approve <change folder> <your name>

The orchestrator prints the exact folder. Never retype it by hand. At the end, the PR is yours to merge (Gate 2), then:

    node $HOME\.copilot\team\team.mjs set-status <change folder> done

Reset the demo for another run: `node setup.mjs --reset` in `demo-workspace`, then delete `$HOME\.copilot\team\calls\*` and `$HOME\.copilot\team\hooks\events.jsonl`.

## 10. Run a real ticket

1. Write the story as a file in the shape of `demo-workspace\stories\PROJ-101.md` (summary, ACs, scenarios, affected repos, `depends_on` if several repos).
2. Open the workspace, new chat, orchestrator agent, `/run <story file or ticket id>`.
3. One ticket at a time. For several repos, upstream repo first; the script tells the orchestrator when to wait.
4. Gate 1 (approve) and Gate 2 (merge, `set-status done`) are yours.

## 11. After the run, send the evidence

    node $HOME\.copilot\team\otel\otel-report.mjs <TICKET>
    node $HOME\.copilot\team\team.mjs calls <TICKET>
    node $HOME\.copilot\team\team.mjs ticket <TICKET>
    node $HOME\.copilot\team\team.mjs audit <change folder>

The first three print counts, names and statuses only, so they are safe to paste. The audit is also written to `<TICKET>-audit.md` in the change folder and under `$HOME\.copilot\team\tickets\<TICKET>\`.

## Update

When the kit changes, repeat step 2 (scripts), step 6 (agents and skills) and, if `otel-task.ps1` changed, step 3. Then restart VS Code and start a NEW chat, because an open chat keeps the old agent and skill text.
Compare versions with `git -C $KIT log --oneline -1`.

## Uninstall

    cd $KIT\team\hooks;  .\install-hooks.ps1 -Remove
    cd $KIT\team\otel;   .\otel-task.ps1 -Remove
    Remove-Item -Recurse "$HOME\.copilot\team"
    # remove the .github agents, skills and prompts you copied, and the OTLP settings

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `team.mjs not found` in a skill | Step 2 not done, or run on another user account. Check `$HOME`. |
| `otel-report.mjs not found` on `team audit` | `otel` folder missing next to `team.mjs`. Repeat step 2 and step 3. |
| Collector health fails | Task not running. `.\otel-task.ps1 -Status`; check the port. |
| Report shows 0 spans | VS Code started before the settings or variables. Close all windows, start again, new chat. |
| Only protobuf arrives | The protocol variables were not set in the process that started VS Code. |
| Report shows 0 hook events | Hooks off or blocked by policy, or VS Code not restarted after step 5. |
| Orchestrator is not in the picker | `.github\agents` is not in the folder you opened. |
| Agents skip their skill file | Open a NEW chat after every kit update. Report the run; the hook table shows it. |
| `Illegal status` or `upstream:` errors | Expected guard rails. The message lists the valid states or the blocking repo. |
| Wrong user folder in a path | Use the folder from `team ticket <TICKET> --json`, never type it. |

Known limits: VS Code only for now (Copilot CLI and IntelliJ later); acceptance criteria are read from the story file, not from Jira; agents follow the skills by instruction, so check the "Skills" table in the audit.
