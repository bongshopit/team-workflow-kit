<#
.SYNOPSIS
  Installs the team workflow kit: scripts, telemetry collector, hook, agents and skills, settings.

.DESCRIPTION
  Run from the kit folder (the one that holds team\ and .github\). Safe to run again: it overwrites files with the kit's copy.
  Needs Node 18+. Windows PowerShell 5.1 or PowerShell 7.

.EXAMPLE
  .\workflow-kit-install.ps1 -Workspace C:\work\lego -TestCmd "mvn -q test"
      full install, agents and skills copied into C:\work\lego\.github
.EXAMPLE
  .\workflow-kit-install.ps1 -DryRun -Workspace C:\work\lego
      shows what would happen, changes nothing
.EXAMPLE
  .\workflow-kit-install.ps1 -Status
      compares installed files with the kit and checks collector, hook and variables
.EXAMPLE
  .\workflow-kit-install.ps1 -Uninstall            removes scripts, hook, collector task (keeps call logs and telemetry)
  .\workflow-kit-install.ps1 -Uninstall -Purge     also deletes ~\.copilot\team completely
#>
[CmdletBinding()]
param(
  [string]$Workspace,        # folder you open in VS Code. Agents, skills and prompts go to <Workspace>\.github
  [string]$TestCmd,          # sets TEAM_TEST_CMD for your user, for example "mvn -q test"
  [int]$Port = 4318,         # collector port
  [switch]$SkipTests,        # do not run the kit's tests first
  [switch]$SkipCollector,    # do not install the scheduled collector task
  [switch]$SkipHook,         # do not install the hook
  [switch]$PatchSettings,    # add the telemetry keys to VS Code user settings.json (a backup is made)
  [switch]$Status,
  [switch]$Uninstall,
  [switch]$Purge,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Kit      = $PSScriptRoot
$Home_    = $HOME
$Team     = Join-Path $Home_ ".copilot\team"
$TeamOtel = Join-Path $Team "otel"
$HookDir  = Join-Path $Home_ ".copilot\hooks"
$HookFile = Join-Path $HookDir "team-discovery.json"
$Stamp    = Join-Path $Team "kit-version.json"
$Settings = Join-Path $env:APPDATA "Code\User\settings.json"
$TaskName = "TeamOtelCollector"
$GitDirs  = "agents", "skills", "prompts"

function Step($m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   ok    $m" -ForegroundColor Green }
function Note($m) { Write-Host "         $m" }
function Warn($m) { Write-Host "   WARN  $m" -ForegroundColor Yellow }
function Plan($m) { Write-Host "   would $m" -ForegroundColor DarkGray }

function Test-Kit {
  foreach ($p in "team\scripts\team.mjs", "team\scripts\team-hook.mjs", "team\otel\otel-report.mjs", "team\hooks\team-discovery.hooks.json", ".github\agents", ".github\skills") {
    if (-not (Test-Path (Join-Path $Kit $p))) { throw "This does not look like the kit folder: $p is missing next to workflow-kit-install.ps1 ($Kit)." }
  }
}

function Get-Rel($root, $full) { return $full.Substring($root.Length).TrimStart('\', '/') }

# Pairs of (source, destination) for single files.
function Get-FilePairs {
  $pairs = @()
  foreach ($f in "team.mjs", "team-hook.mjs") { $pairs += ,@((Join-Path $Kit "team\scripts\$f"), (Join-Path $Team $f)) }
  Get-ChildItem (Join-Path $Kit "team\otel") -Filter "*.mjs" | Where-Object { $_.Name -notlike "*.test.mjs" } | ForEach-Object {
    $pairs += ,@($_.FullName, (Join-Path $TeamOtel $_.Name))
  }
  $pairs += ,@((Join-Path $Kit "team\hooks\team-discovery.hooks.json"), $HookFile)
  return $pairs
}

# Compare one source file with one installed file. Returns "same", "differs" or "missing".
function Compare-One($src, $dst) {
  if (-not (Test-Path $dst)) { return "missing" }
  if ((Get-FileHash $src -Algorithm SHA256).Hash -eq (Get-FileHash $dst -Algorithm SHA256).Hash) { return "same" }
  return "differs"
}

function Copy-One($src, $dst) {
  if ($DryRun) { Plan "copy $(Split-Path $src -Leaf) -> $dst"; return }
  New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
  Copy-Item $src $dst -Force
}

function Copy-Tree($src, $dst) {
  $n = 0
  foreach ($f in Get-ChildItem $src -Recurse -File) {
    Copy-One $f.FullName (Join-Path $dst (Get-Rel $src $f.FullName)); $n++
  }
  return $n
}

function Compare-Tree($src, $dst) {
  $bad = @(); $total = 0
  foreach ($f in Get-ChildItem $src -Recurse -File) {
    $total++
    $r = Compare-One $f.FullName (Join-Path $dst (Get-Rel $src $f.FullName))
    if ($r -ne "same") { $bad += "$(Get-Rel $src $f.FullName) ($r)" }
  }
  return @{ total = $total; bad = $bad }
}

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect("127.0.0.1", $p, $null, $null)
    return ($iar.AsyncWaitHandle.WaitOne(800) -and $c.Connected)
  } catch { return $false } finally { $c.Close() }
}

function Get-StampWorkspace {
  if (Test-Path $Stamp) { try { return (Get-Content $Stamp -Raw | ConvertFrom-Json).workspace } catch { } }
  return $null
}

function Get-KitCommit {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git -or -not (Test-Path (Join-Path $Kit ".git"))) { return "unknown" }
  $h = (& git -C $Kit rev-parse --short HEAD 2>$null)
  $d = (& git -C $Kit status --porcelain 2>$null)
  if ($d) { return "$h+local-changes" }
  return "$h"
}

# ---------------------------------------------------------------- status
function Show-Status {
  Step "Installed files against the kit ($Kit)"
  $bad = @()
  foreach ($p in Get-FilePairs) { $r = Compare-One $p[0] $p[1]; if ($r -ne "same") { $bad += "$($p[1]) ($r)" } }
  if ($bad.Count -eq 0) { Ok "scripts, otel scripts and hook file match the kit" } else { foreach ($b in $bad) { Warn $b }; Note "Run the installer again to refresh them." }

  $ws = $Workspace; if (-not $ws) { $ws = Get-StampWorkspace }
  if ($ws) {
    foreach ($d in $GitDirs) {
      $src = Join-Path $Kit ".github\$d"; $dst = Join-Path $ws ".github\$d"
      if (-not (Test-Path $src)) { continue }
      $c = Compare-Tree $src $dst
      if ($c.bad.Count -eq 0) { Ok "$ws\.github\$d : $($c.total) files match" } else { Warn "$ws\.github\$d : $($c.bad.Count) of $($c.total) differ"; $c.bad | Select-Object -First 5 | ForEach-Object { Note $_ } }
    }
  } else { Note "No workspace known. Pass -Workspace <folder> to check agents and skills." }

  Step "Runtime"
  if (Test-Path $Stamp) { $s = Get-Content $Stamp -Raw | ConvertFrom-Json; Ok "installed kit version $($s.commit) on $($s.installedAt)" } else { Warn "no kit-version.json: not installed yet" }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { Ok "node $(& node --version)" } else { Warn "node not found on PATH" }
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) { Ok "collector task $($t.State)" } else { Warn "collector task not installed" }
  try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2; Ok "collector answers on $Port : $($h.spans) spans saved" }
  catch { Warn "collector does not answer on port $Port" }
  foreach ($v in "OTEL_EXPORTER_OTLP_PROTOCOL", "COPILOT_OTEL_PROTOCOL", "TEAM_TEST_CMD") {
    $val = [Environment]::GetEnvironmentVariable($v, "User")
    if ($val) { Ok "$v = $val" } else { Warn "$v not set" }
  }
  if (Test-Path $Settings) {
    $raw = Get-Content $Settings -Raw
    if ($raw -match '"github\.copilot\.chat\.otel\.enabled"\s*:\s*true') { Ok "VS Code telemetry setting present" } else { Warn "VS Code telemetry setting missing (see -PatchSettings)" }
  } else { Warn "VS Code user settings.json not found at $Settings" }
  $ev = Join-Path $Team "hooks\events.jsonl"
  if (Test-Path $ev) { Ok "hook events logged: $((Get-Content $ev | Measure-Object -Line).Lines)" } else { Note "hook has logged nothing yet (normal before the first run)" }
}

# ---------------------------------------------------------------- uninstall
function Invoke-Uninstall {
  Step "Uninstall"
  if (Test-Path $HookFile) { if ($DryRun) { Plan "delete $HookFile" } else { Remove-Item $HookFile -Force; Ok "removed $HookFile" } }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    if ($DryRun) { Plan "remove scheduled task $TaskName" } else {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Ok "removed task $TaskName"
    }
  }
  foreach ($v in "OTEL_EXPORTER_OTLP_PROTOCOL", "COPILOT_OTEL_PROTOCOL") {
    if ($DryRun) { Plan "clear user variable $v" } else { [Environment]::SetEnvironmentVariable($v, $null, "User") }
  }
  if ($Purge) {
    if ($DryRun) { Plan "delete $Team (including call logs, telemetry and ticket registry)" }
    elseif (Test-Path $Team) { Remove-Item $Team -Recurse -Force; Ok "deleted $Team" }
  } else {
    foreach ($p in "team.mjs", "team-hook.mjs", "kit-version.json") {
      $f = Join-Path $Team $p
      if (Test-Path $f) { if ($DryRun) { Plan "delete $f" } else { Remove-Item $f -Force } }
    }
    if (Test-Path $TeamOtel) { if ($DryRun) { Plan "delete $TeamOtel" } else { Remove-Item $TeamOtel -Recurse -Force } }
    Ok "scripts removed. Call logs, telemetry and ticket registry in $Team are kept (use -Purge to delete them)."
  }
  Note "Not touched: agents and skills in your workspace .github, VS Code settings, TEAM_TEST_CMD."
}

# ---------------------------------------------------------------- settings patch
function Update-VSCodeSettings {
  $want = [ordered]@{
    "github.copilot.chat.otel.enabled"         = "true"
    "github.copilot.chat.otel.exporterType"    = '"otlp-http"'
    "github.copilot.chat.otel.otlpEndpoint"    = ('"http://127.0.0.1:' + $Port + '"')
    "github.copilot.chat.otel.captureContent"  = "false"
    "github.copilot.chat.otel.captureIdentity" = "false"
  }
  $raw = ""
  if (Test-Path $Settings) { $raw = Get-Content $Settings -Raw }
  $missing = [ordered]@{}
  foreach ($k in $want.Keys) {
    if ($raw -match ('"' + [regex]::Escape($k) + '"\s*:')) {
      if ($raw -notmatch ('"' + [regex]::Escape($k) + '"\s*:\s*' + [regex]::Escape($want[$k]))) { Warn "$k exists with another value. Check it: expected $($want[$k])" }
    } else { $missing[$k] = $want[$k] }
  }
  if ($missing.Count -eq 0) { Ok "VS Code telemetry settings already present"; return }
  $lines = @(); foreach ($k in $missing.Keys) { $lines += ('  "' + $k + '": ' + $missing[$k]) }
  if (-not $PatchSettings) {
    Warn "VS Code telemetry settings missing. Add these to your user settings.json, or run again with -PatchSettings:"
    foreach ($l in $lines) { Note ($l.Trim() + ",") }
    return
  }
  if ($DryRun) { Plan "add $($missing.Count) keys to $Settings"; return }
  New-Item -ItemType Directory -Force (Split-Path $Settings -Parent) | Out-Null
  if ($raw.Trim().Length -eq 0) {
    Set-Content $Settings ("{`r`n" + ($lines -join ",`r`n") + "`r`n}") -Encoding UTF8
  } else {
    Copy-Item $Settings ($Settings + ".bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")) -Force
    $i = $raw.IndexOf("{")
    if ($i -lt 0) { throw "Cannot find '{' in $Settings. Add the keys by hand." }
    $rest = $raw.Substring($i + 1).TrimStart()
    $tail = ","
    if ($rest.StartsWith("}")) { $tail = "" }
    $new = $raw.Substring(0, $i + 1) + "`r`n" + ($lines -join ",`r`n") + $tail + $raw.Substring($i + 1)
    Set-Content $Settings $new -Encoding UTF8
  }
  Ok "added $($missing.Count) keys to $Settings (backup next to it)"
}

# ================================================================ main
Test-Kit
if ($Status)    { Show-Status; exit 0 }
if ($Uninstall) { Invoke-Uninstall; exit 0 }

if ($DryRun) { Write-Host "DRY RUN: nothing will be changed." -ForegroundColor Yellow }
Write-Host "Kit: $Kit  (version $(Get-KitCommit))"

Step "1. Prerequisites"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "node was not found on PATH. Install Node 18 or newer, open a new PowerShell and run this again." }
$ver = (& node --version).TrimStart("v")
if ([int]($ver.Split(".")[0]) -lt 18) { throw "Node $ver is too old. Install Node 18 or newer." }
Ok "node $ver"
if (Get-Command git -ErrorAction SilentlyContinue) { Ok "git present" } else { Warn "git not found. The workflow needs it in the repos you change." }
if (Get-Command mvn -ErrorAction SilentlyContinue) { Ok "mvn present" } else { Note "mvn not found (only needed for Maven repos)." }

Step "2. Kit tests"
if ($SkipTests) { Note "skipped" }
elseif ($DryRun) { Plan "run node --test on team.test.mjs and otel-lib.test.mjs" }
else {
  & node --test (Join-Path $Kit "team\scripts\team.test.mjs") (Join-Path $Kit "team\otel\otel-lib.test.mjs") | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The kit's tests failed. Run: node --test team\scripts\team.test.mjs team\otel\otel-lib.test.mjs  and send me the output. Use -SkipTests to install anyway." }
  Ok "tests pass"
}

Step "3. Scripts into $Team"
foreach ($p in Get-FilePairs) { if ($p[1] -ne $HookFile) { Copy-One $p[0] $p[1] } }
if (-not $DryRun) { Ok "team.mjs, team-hook.mjs and otel scripts copied" }

Step "4. Hook"
if ($SkipHook) { Note "skipped" } else {
  Copy-One (Join-Path $Kit "team\hooks\team-discovery.hooks.json") $HookFile
  if (-not $DryRun) { Ok "hook config at $HookFile" }
}

Step "5. Telemetry collector (scheduled task, starts at logon)"
if ($SkipCollector) { Note "skipped" }
elseif ($DryRun) { Plan "run otel-task.ps1 -Port $Port" }
else {
  if ((Test-Port $Port) -and -not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Warn "Port $Port is in use, probably a collector you started by hand in a terminal. Close that terminal (Ctrl+C), then run: Start-ScheduledTask $TaskName"
  }
  try {
    & (Join-Path $Kit "team\otel\otel-task.ps1") -Port $Port | Out-Null
    Ok "task $TaskName installed"
    if (Test-Port $Port) { Ok "collector listening on $Port" } else { Warn "collector not listening yet. Check later: .\workflow-kit-install.ps1 -Status" }
  } catch { Warn "collector task failed: $($_.Exception.Message). Try: powershell -ExecutionPolicy Bypass -File team\otel\otel-task.ps1" }
}

Step "6. Environment variables (user level)"
foreach ($kv in @(@("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json"), @("COPILOT_OTEL_PROTOCOL", "http/json"))) {
  if ($DryRun) { Plan "set $($kv[0])=$($kv[1])" } else { [Environment]::SetEnvironmentVariable($kv[0], $kv[1], "User"); Set-Item "Env:$($kv[0])" $kv[1] }
}
if ($TestCmd) {
  if ($DryRun) { Plan "set TEAM_TEST_CMD=$TestCmd" } else { [Environment]::SetEnvironmentVariable("TEAM_TEST_CMD", $TestCmd, "User"); $env:TEAM_TEST_CMD = $TestCmd; Ok "TEAM_TEST_CMD = $TestCmd" }
} elseif (-not [Environment]::GetEnvironmentVariable("TEAM_TEST_CMD", "User")) {
  Warn "TEAM_TEST_CMD is not set. Re-run with -TestCmd `"mvn -q test`" (or npm test) so the dev and reviewer can run tests."
}
if (-not $DryRun) { Ok "OTEL protocol variables set to http/json" }

Step "7. VS Code telemetry settings"
Update-VSCodeSettings

Step "8. Agents, skills and prompts"
if ($SkipWorkspace -or -not $Workspace) { Warn "No -Workspace given: agents and skills not copied. Re-run with -Workspace <folder you open in VS Code>." }
else {
  if (-not (Test-Path $Workspace)) { throw "Workspace folder not found: $Workspace" }
  $Workspace = (Resolve-Path $Workspace).Path
  foreach ($d in $GitDirs) {
    $src = Join-Path $Kit ".github\$d"
    if (-not (Test-Path $src)) { continue }
    $n = Copy-Tree $src (Join-Path $Workspace ".github\$d")
    if (-not $DryRun) { Ok "$d : $n files" }
  }
  # keep explore scratch out of git: the workspace itself and each repo directly below it
  $repos = @(); if (Test-Path (Join-Path $Workspace ".git")) { $repos += $Workspace }
  Get-ChildItem $Workspace -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName ".git") } | ForEach-Object { $repos += $_.FullName }
  foreach ($r in $repos) {
    $gi = Join-Path $r ".gitignore"
    $has = (Test-Path $gi) -and ((Get-Content $gi -Raw) -match '(?m)^\s*\.team-scratch/?\s*$')
    if ($has) { continue }
    if ($DryRun) { Plan "add .team-scratch/ to $gi" } else { Add-Content $gi "`r`n.team-scratch/"; Ok "added .team-scratch/ to $gi" }
  }
}

if (-not $DryRun) {
  Step "9. Version stamp and check"
  $obj = [ordered]@{ commit = (Get-KitCommit); installedAt = (Get-Date).ToString("s"); kit = $Kit; workspace = $Workspace }
  New-Item -ItemType Directory -Force $Team | Out-Null
  ($obj | ConvertTo-Json) | Set-Content $Stamp -Encoding UTF8
  & node (Join-Path $Team "team.mjs") help | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok "team.mjs runs" } else { Warn "team.mjs help failed" }
  Show-Status
  Write-Host ""
  Write-Host "Done. Next:" -ForegroundColor Cyan
  Note "1. Close ALL VS Code windows and start VS Code again (new variables and settings are read at start)."
  Note "2. Open $(if ($Workspace) { $Workspace } else { 'your workspace' }), open a NEW chat, pick the orchestrator agent, run /run <ticket>."
  Note "3. After the run: node `"$TeamOtel\otel-report.mjs`" <TICKET>"
  Note "Check any time with: .\workflow-kit-install.ps1 -Status"
}
