# Discovery hook

Purpose: find out how VS Code loads a skill and what the hook payload looks like, and record skill reads without relying on the agent.

    .\install-hooks.ps1            install
    .\install-hooks.ps1 -Status    events logged so far
    .\install-hooks.ps1 -Remove    uninstall

It writes `%USERPROFILE%\.copilot\team\hooks\events.jsonl`: event name, tool name, argument key names, a skill name when a path like `.../skills/<name>/SKILL.md` appears, and the payload key names. No argument values, prompts or code.
It always prints `{}` and exits 0, so it never blocks a tool. The log stops growing at 5 MB. `TEAM_HOOK_LOG=off` disables it.

After one session that loads a skill, run `node team\otel\otel-report.mjs PROJ-101`. The "Skill evidence" table shows what the hook saw.
To look at the raw events yourself: `Get-Content $HOME\.copilot\team\hooks\events.jsonl | Select-Object -First 20`. They contain names only, so they are safe to paste.

## What the real VS Code payload holds (seen on a live run)
Keys: `timestamp, hook_event_name, session_id, transcript_path, tool_name, tool_input, tool_response, tool_use_id, cwd` (sessionStart adds `source, model`).
There is no agent name in the payload. The hook now logs `session`, `tool_use_id`, `repo` (name only) and `model`. The report joins `tool_use_id` to the telemetry tool call id, then walks the span parents to name the agent that read each skill.
Never stored: `tool_response`, `transcript_path`, the cwd path, argument values.
Open: does `tool_use_id` equal `gen_ai.tool.call.id`, and do subagent tool calls fire hooks. The next real run answers both.
