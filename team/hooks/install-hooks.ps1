<#
.SYNOPSIS
  Installs the discovery hook for Copilot agent hooks. It logs tool names and skill reads, never prompts or code.

.EXAMPLE
  .\install-hooks.ps1           copy team-hook.mjs to ~\.copilot\team and the hook file to ~\.copilot\hooks
  .\install-hooks.ps1 -Remove   delete the hook file (the script and the log stay)
  .\install-hooks.ps1 -Status   show whether the hook file exists and how many events were logged
#>
param([switch]$Remove, [switch]$Status)
$ErrorActionPreference = "Stop"
$hookDir = Join-Path $HOME ".copilot\hooks"
$teamDir = Join-Path $HOME ".copilot\team"
$hookFile = Join-Path $hookDir "team-discovery.json"
$log = Join-Path $teamDir "hooks\events.jsonl"

if ($Status) {
  Write-Host "Hook file : $(if (Test-Path $hookFile) { $hookFile } else { 'not installed' })"
  Write-Host "Script    : $(if (Test-Path (Join-Path $teamDir 'team-hook.mjs')) { 'present' } else { 'missing' })"
  if (Test-Path $log) { Write-Host "Events    : $((Get-Content $log | Measure-Object -Line).Lines) logged in $log" } else { Write-Host "Events    : none yet" }
  exit 0
}
if ($Remove) {
  if (Test-Path $hookFile) { Remove-Item $hookFile; Write-Host "Removed $hookFile" } else { Write-Host "Nothing to remove." }
  exit 0
}
$scripts = Join-Path $PSScriptRoot "..\scripts\team-hook.mjs"
if (-not (Test-Path $scripts)) { throw "team-hook.mjs not found at $scripts" }
New-Item -ItemType Directory -Force $hookDir, $teamDir | Out-Null
Copy-Item $scripts $teamDir -Force
Copy-Item (Join-Path $PSScriptRoot "team-discovery.hooks.json") $hookFile -Force
Write-Host "Installed $hookFile and $teamDir\team-hook.mjs"
Write-Host "Restart VS Code, run a chat that loads a skill, then run: .\install-hooks.ps1 -Status"
Write-Host "If no events appear, hooks may be off in VS Code or blocked by your organization's policy."
